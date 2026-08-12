/**
 * Compression Cache Service
 * Async Pre-Compression Feature
 *
 * Manages cached compression results to avoid blocking message sends.
 * After an LLM response is received, compression is triggered asynchronously
 * and cached for the next message. When the next message is sent:
 * - If compression is ready in memory, use it immediately
 * - If compression is in-flight, wait for it
 * - If no in-memory cache, try to load from database
 * - If no database cache, fall back to synchronous compression
 *
 * Cache is persisted to the database so it survives server restarts.
 */

import { logger } from '@/lib/logger'
import {
  ContextCompressionResult,
  ContextCompressionOptions,
  applyContextCompression,
  CompressibleMessage,
} from '@/lib/chat/context/compression'

/**
 * Build cache key — per-participant in multi-char chats, per-chat in single-char
 */
function cacheKey(chatId: string, participantId?: string): string {
  return participantId ? `${chatId}:${participantId}` : chatId
}

/**
 * Persisted cache entry stored in database
 * Excludes promises since they can't be serialized
 */
export interface PersistedCompressionCache {
  /** The compression result */
  result: ContextCompressionResult
  /** Message count when compression was computed */
  messageCount: number
  /** Timestamp when the cache was created */
  createdAt: number
  /** System prompt hash to detect changes */
  systemPromptHash: string
}

/**
 * In-memory cache entry (includes promise for in-flight compression)
 */
interface CompressionCacheEntry {
  /** The compression result (if completed) */
  result?: ContextCompressionResult
  /** Promise for in-flight compression */
  promise?: Promise<ContextCompressionResult>
  /** Message count when compression was computed */
  messageCount: number
  /** Timestamp when the cache was created */
  createdAt: number
  /** System prompt hash to detect changes */
  systemPromptHash: string
}

/**
 * Options for triggering async pre-compression
 */
export interface AsyncCompressionOptions {
  chatId: string
  participantId?: string
  messages: CompressibleMessage[]
  systemPrompt: string
  compressionOptions: ContextCompressionOptions
}

// In-memory cache for compression results (fast path)
// Key: cacheKey(chatId, participantId) = "chatId" for single-char or "chatId:participantId" for multi-char
// Value: CompressionCacheEntry
const compressionCache = new Map<string, CompressionCacheEntry>()

// Per-chat persistence locks. Serializes load-modify-save of `chat.compressionCache`
// so two finalizers writing different participantId keys can't clobber each other.
// Parent-process only — child handlers never call persistToDatabase/clearFromDatabase.
const persistLocks = new Map<string, Promise<unknown>>()

/**
 * Serialize a load-modify-save block on `chat.compressionCache` for a given chat.
 *
 * The cache is a JSON object keyed by participantId. In a multi-character chat,
 * two finalizers can race: each reads `chat.compressionCache`, sets its own
 * participant's entry, and writes back the whole field. Whichever writes second
 * wins and silently erases the other participant's entry. This chains all writes
 * for a given chatId through a single promise so reads always see the latest
 * persisted state.
 *
 * @internal exported for tests
 */
export function withPersistLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  const prev = persistLocks.get(chatId) ?? Promise.resolve()
  // Run fn whether prev settled successfully or threw — one bad write must not
  // jam the queue. The .then(fn, fn) form invokes fn in either case.
  const next = prev.then(fn, fn)
  persistLocks.set(chatId, next)
  return (next as Promise<T>).finally(() => {
    // Drop the map entry only if nothing newer chained on top.
    if (persistLocks.get(chatId) === next) {
      persistLocks.delete(chatId)
    }
  })
}

/**
 * Simple hash function for system prompt change detection
 */
export function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(16)
}

/**
 * Check if a cache entry is valid for the current context
 * No TTL - cache is only invalidated by system prompt change or if too stale
 *
 * The cached compression summarizes messages UP TO a certain point. If new messages
 * were added since caching, the compression is still valid - those new messages
 * will be included in the "window" (recent messages sent verbatim). The cached
 * history summary covers the OLD messages accurately.
 *
 * We invalidate if:
 * - System prompt changed (character settings, etc.)
 * - Cache is way too old (more than 50 messages behind - would mean a very small summary)
 * - Cache has MORE messages than current (data was deleted)
 */
function isCacheValid(
  entry: { messageCount: number; systemPromptHash: string },
  currentMessageCount: number,
  currentSystemPromptHash?: string
): boolean {
  // Check if system prompt changed (only if hash provided)
  // This is the primary validation - character/settings changes invalidate cache
  if (currentSystemPromptHash && entry.systemPromptHash !== currentSystemPromptHash) {
    return false
  }

  // Cache must have been computed with fewer or equal messages
  // If cache has MORE messages, data was deleted and cache is invalid
  if (entry.messageCount > currentMessageCount) {
    return false
  }

  // Allow cache to be up to 50 messages behind
  // Beyond that, the compressed history would be too small relative to current context
  const messageDiff = currentMessageCount - entry.messageCount
  if (messageDiff > 50) {
    return false
  }

  return true
}

/**
 * Save compression result to database
 * Fire and forget - errors are logged but don't block
 */
async function persistToDatabase(
  chatId: string,
  participantId: string | undefined,
  entry: PersistedCompressionCache
): Promise<void> {
  // Serialize against other writers on this chat — otherwise concurrent
  // finalizers for different participants will load the same snapshot, each
  // add their own participantId key, and the second write erases the first.
  return withPersistLock(chatId, async () => {
    try {
      // Dynamic import to avoid circular dependencies. Must use the factory so
      // child-process callers go through the buffered-write proxy; the raw
      // `@/lib/database/repositories` module would throw "attempt to write a
      // readonly database" against the child's readonly SQLCipher connection.
      const { getRepositories } = await import('@/lib/repositories/factory')
      const repos = getRepositories()

      if (participantId) {
        // Multi-character chat: store as Record<participantId, cache>
        const chat = await repos.chats.findById(chatId)
        const existingCache = (chat?.compressionCache || {}) as Record<string, PersistedCompressionCache>
        existingCache[participantId] = entry
        await repos.chats.update(chatId, {
          compressionCache: existingCache as unknown as Record<string, unknown>,
        })
      } else {
        // Single-character chat: store directly (backward compatible)
        await repos.chats.update(chatId, {
          compressionCache: entry as unknown as Record<string, unknown>,
        })
      }
    } catch (error) {
      logger.error('[CompressionCache] Failed to persist to database', {
        chatId,
        participantId,
      }, error instanceof Error ? error : undefined)
      // Don't throw - persistence failure shouldn't break the flow
    }
  })
}

/**
 * Load compression result from database
 */
async function loadFromDatabase(chatId: string, participantId?: string): Promise<PersistedCompressionCache | null> {
  try {
    // Dynamic import to avoid circular dependencies. See persistToDatabase
    // above for why this must be the factory, not the raw module.
    const { getRepositories } = await import('@/lib/repositories/factory')
    const repos = getRepositories()

    const chat = await repos.chats.findById(chatId)
    if (!chat?.compressionCache) {
      return null
    }

    let cache: unknown
    if (participantId) {
      // Multi-character chat: read from Record<participantId, cache>
      const record = chat.compressionCache as unknown as Record<string, PersistedCompressionCache>
      cache = record[participantId]
      if (!cache) {
        return null
      }
    } else {
      // Single-character chat: try old format first (direct entry), then new format with '_default' key
      cache = chat.compressionCache
      const record = cache as unknown as Record<string, PersistedCompressionCache>
      if (!('result' in (cache as any)) && record['_default']) {
        cache = record['_default']
      }
    }

    // Validate the structure
    const entry = cache as unknown as PersistedCompressionCache
    if (!entry.result || typeof entry.messageCount !== 'number' || !entry.systemPromptHash) {
      return null
    }

    return entry
  } catch (error) {
    logger.error('[CompressionCache] Failed to load from database', {
      chatId,
      participantId,
    }, error instanceof Error ? error : undefined)
    return null
  }
}

/**
 * Clear compression cache from database
 */
async function clearFromDatabase(chatId: string, participantId?: string): Promise<void> {
  // Share the persist lock so a clear can't slip between a persist's read and
  // write (or vice versa). Otherwise a clear can wipe the field after a
  // concurrent persist has already merged its own entry into the snapshot.
  return withPersistLock(chatId, async () => {
    try {
      // Dynamic import to avoid circular dependencies. See persistToDatabase
      // above for why this must be the factory, not the raw module.
      const { getRepositories } = await import('@/lib/repositories/factory')
      const repos = getRepositories()

      if (participantId) {
        // Multi-character chat: delete specific participant key from record
        const chat = await repos.chats.findById(chatId)
        if (chat?.compressionCache) {
          const record = (chat.compressionCache as unknown as Record<string, PersistedCompressionCache>)
          delete record[participantId]
          const isEmpty = Object.keys(record).length === 0
          await repos.chats.update(chatId, {
            compressionCache: isEmpty ? null : (record as unknown as Record<string, unknown>),
          })
        }
      } else {
        // Single-character chat: clear entire field
        await repos.chats.update(chatId, {
          compressionCache: null,
        })
      }
    } catch (error) {
      logger.error('[CompressionCache] Failed to clear from database', {
        chatId,
        participantId,
      }, error instanceof Error ? error : undefined)
    }
  })
}

/**
 * Trigger async pre-compression for the next message
 * Called after an LLM response is received and saved
 */
export function triggerAsyncCompression(options: AsyncCompressionOptions): void {
  const { chatId, participantId, messages, systemPrompt, compressionOptions } = options

  // Don't pre-compress if there aren't enough messages
  if (messages.length <= compressionOptions.windowSize) {
    return
  }

  const systemPromptHash = hashString(systemPrompt)
  const key = cacheKey(chatId, participantId)

  // Check if we already have a valid cache entry
  const existingEntry = compressionCache.get(key)
  if (existingEntry && isCacheValid(existingEntry, messages.length, systemPromptHash)) {
    // Even if cache structure is valid, re-compress when enough new messages
    // have accumulated. Without this, the "dynamic window" grows unbounded
    // (effective window = windowSize + messagesSinceCache), defeating compression.
    const messagesSinceCache = messages.length - existingEntry.messageCount
    if (messagesSinceCache < compressionOptions.windowSize) {
      return
    }
    logger.info('[CompressionCache] Cache valid but stale, re-compressing to incorporate new messages', {
      chatId,
      participantId,
      cachedMessageCount: existingEntry.messageCount,
      currentMessageCount: messages.length,
      messagesSinceCache,
      windowSize: compressionOptions.windowSize,
    })
  }

  logger.info('[CompressionCache] Starting async pre-compression', {
    chatId,
    participantId,
    messageCount: messages.length,
    windowSize: compressionOptions.windowSize,
  })

  // Create the compression promise using an async helper function
  // This avoids unhandled promise rejections by catching all errors
  const runCompression = async (): Promise<ContextCompressionResult> => {
    try {
      const result = await applyContextCompression(
        messages,
        systemPrompt,
        compressionOptions
      )

      // Update in-memory cache entry with result
      const entry = compressionCache.get(key)
      if (entry) {
        entry.result = result
        delete entry.promise
      }

      logger.info('[CompressionCache] Async pre-compression completed', {
        chatId,
        participantId,
        compressionApplied: result.compressionApplied,
        savings: result.compressionDetails?.totalSavings,
      })

      // Persist to database (fire and forget)
      if (result.compressionApplied) {
        const persistedEntry: PersistedCompressionCache = {
          result,
          messageCount: messages.length,
          createdAt: Date.now(),
          systemPromptHash,
        }
        persistToDatabase(chatId, participantId, persistedEntry).catch(() => {
          // Already logged in persistToDatabase
        })
      }

      return result
    } catch (error) {
      logger.error('[CompressionCache] Async pre-compression failed', {
        chatId,
        participantId,
      }, error instanceof Error ? error : undefined)

      // Return a "not applied" result instead of throwing
      // This ensures the promise resolves, avoiding unhandled rejections
      const failureResult: ContextCompressionResult = {
        compressionApplied: false,
        warnings: [`Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      }

      // Update cache with failure result instead of deleting
      const entry = compressionCache.get(key)
      if (entry) {
        entry.result = failureResult
        delete entry.promise
      }

      return failureResult
    }
  }

  const compressionPromise = runCompression()

  // Store the cache entry with the promise
  compressionCache.set(key, {
    promise: compressionPromise,
    messageCount: messages.length,
    createdAt: Date.now(),
    systemPromptHash,
  })
}

/**
 * Result from getCachedCompression with metadata
 */
export interface CachedCompressionResponse {
  /** The compression result */
  result: ContextCompressionResult
  /** Message count when this compression was computed */
  cachedMessageCount: number
  /** Whether this is a fallback to older cache (async wasn't ready) */
  isFallback: boolean
}

/**
 * Get cached compression result, preferring speed over waiting for in-flight compression
 *
 * Checks in this order:
 * 1. In-memory cache with completed result (fastest)
 * 2. Database cache / previous result (fallback when async not ready)
 * 3. Returns undefined (caller should do sync compression)
 *
 * IMPORTANT: This function does NOT wait for in-flight compression. Instead, it
 * falls back to the previous compression result (from database) to avoid blocking.
 * This trades more tokens (larger effective window) for faster response time.
 *
 * @param chatId - The chat ID
 * @param currentMessageCount - Current number of messages (excluding new user message)
 * @param participantId - Participant ID for multi-character chats (optional)
 * @param currentSystemPromptHash - Hash of the current system prompt (optional, for validation)
 * @returns Cached compression response with metadata, or undefined if not available
 */
export async function getCachedCompression(
  chatId: string,
  currentMessageCount: number,
  participantId?: string,
  currentSystemPromptHash?: string
): Promise<CachedCompressionResponse | undefined> {
  // 1. Check in-memory cache first (fastest path)
  const key = cacheKey(chatId, participantId)
  const memoryEntry = compressionCache.get(key)

  if (memoryEntry) {
    // Validate the in-memory entry using the same logic as isCacheValid
    const messageDiff = currentMessageCount - memoryEntry.messageCount
    const cacheHasMoreMessages = memoryEntry.messageCount > currentMessageCount
    const cacheTooStale = messageDiff > 50

    if (cacheHasMoreMessages) {
      compressionCache.delete(key)
    } else if (cacheTooStale) {
      compressionCache.delete(key)
    } else if (currentSystemPromptHash && memoryEntry.systemPromptHash !== currentSystemPromptHash) {
      compressionCache.delete(key)
    } else {
      // In-memory entry is valid
      if (memoryEntry.result) {
        logger.info('[CompressionCache] Using in-memory cached compression result', {
          chatId,
          messageCount: currentMessageCount,
          cachedMessageCount: memoryEntry.messageCount,
        })
        return {
          result: memoryEntry.result,
          cachedMessageCount: memoryEntry.messageCount,
          isFallback: false,
        }
      }

      // 2. If compression is in-flight, DON'T wait - fall back to database instead
      // This trades more tokens (larger window) for faster response
      if (memoryEntry.promise) {
        logger.info('[CompressionCache] Async compression in-flight, checking for fallback cache', {
          chatId,
        })
        // Fall through to database check
      }
    }
  }

  // 3. Check database cache (survives restarts, also serves as fallback)
  const dbEntry = await loadFromDatabase(chatId, participantId)

  if (dbEntry) {
    // Validate the database entry
    if (isCacheValid(dbEntry, currentMessageCount, currentSystemPromptHash)) {
      // Determine if this is a fallback (async was in-flight but we're using older cache)
      const isFallback = !!(memoryEntry?.promise && !memoryEntry.result)

      logger.info('[CompressionCache] Using database cached compression result', {
        chatId,
        messageCount: currentMessageCount,
        cachedMessageCount: dbEntry.messageCount,
        cacheAge: Date.now() - dbEntry.createdAt,
        isFallback,
      })

      // Only populate in-memory cache if there's no in-flight compression
      // (don't overwrite the pending promise entry)
      if (!memoryEntry?.promise) {
        compressionCache.set(key, {
          result: dbEntry.result,
          messageCount: dbEntry.messageCount,
          createdAt: dbEntry.createdAt,
          systemPromptHash: dbEntry.systemPromptHash,
        })
      }

      return {
        result: dbEntry.result,
        cachedMessageCount: dbEntry.messageCount,
        isFallback,
      }
    } else {
      // Clear invalid database cache
      clearFromDatabase(chatId, participantId).catch(() => {
        // Already logged
      })
    }
  }

  // 4. No valid cache found
  return undefined
}

/**
 * Invalidate cache for a chat (both in-memory and database)
 * Called when:
 * - Full context is requested (bypass compression)
 * - Settings change
 * - Chat is deleted
 *
 * @param chatId - The chat ID
 * @param participantId - Optional participant ID. If provided, only that participant's cache is invalidated.
 *                        If not provided, all caches for the chat are invalidated.
 */
export function invalidateCompressionCache(chatId: string, participantId?: string): void {
  if (participantId) {
    // Invalidate specific participant cache
    const key = cacheKey(chatId, participantId)
    if (compressionCache.has(key)) {
      compressionCache.delete(key)
    }
    // Clear from database too (fire and forget)
    clearFromDatabase(chatId, participantId).catch(() => {
      // Already logged
    })
  } else {
    // Invalidate all participant caches for this chat
    const key = chatId
    if (compressionCache.has(key)) {
      compressionCache.delete(key)
    }
    // Delete all per-participant keys for this chat
    const keysToDelete: string[] = []
    const allKeys = Array.from(compressionCache.keys())
    for (const mapKey of allKeys) {
      if (mapKey.startsWith(`${chatId}:`)) {
        keysToDelete.push(mapKey)
      }
    }
    for (const key of keysToDelete) {
      compressionCache.delete(key)
    }
    // Clear from database too (fire and forget)
    clearFromDatabase(chatId).catch(() => {
      // Already logged
    })
  }
}

/**
 * Drop a chat's in-memory compression-cache entries WITHOUT touching the
 * database. For callers that clear `chats.compressionCache` themselves via
 * raw SQL (the stale-chat maintenance sweep — a repo update would bump the
 * chat's `updatedAt`) but still need the in-process `Map` to stay consistent.
 */
export function dropInMemoryCompressionCache(chatId: string): void {
  compressionCache.delete(chatId)
  const allKeys = Array.from(compressionCache.keys())
  for (const mapKey of allKeys) {
    if (mapKey.startsWith(`${chatId}:`)) {
      compressionCache.delete(mapKey)
    }
  }
}

/**
 * Clear all in-memory cached compression results
 * Useful for testing or when settings change globally
 * Note: Does not clear database caches
 */
export function clearCompressionCache(): void {
  compressionCache.clear()
}

/**
 * Get cache statistics for debugging
 */
export function getCompressionCacheStats(): {
  size: number
  entries: Array<{
    cacheKey: string
    messageCount: number
    hasResult: boolean
    hasPromise: boolean
    ageMs: number
  }>
} {
  const entries: Array<{
    cacheKey: string
    messageCount: number
    hasResult: boolean
    hasPromise: boolean
    ageMs: number
  }> = []

  const now = Date.now()
  const allEntries = Array.from(compressionCache.entries())
  for (const [cacheKeyValue, entry] of allEntries) {
    entries.push({
      cacheKey: cacheKeyValue,
      messageCount: entry.messageCount,
      hasResult: !!entry.result,
      hasPromise: !!entry.promise,
      ageMs: now - entry.createdAt,
    })
  }

  return {
    size: compressionCache.size,
    entries,
  }
}
