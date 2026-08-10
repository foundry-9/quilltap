/**
 * Cold-tier conversation-chunk re-embedding (re-index on demand)
 *
 * The stale-chat maintenance sweep cold-tiers quiet chats by NULLing their
 * `conversation_chunks.embedding` BLOBs (content is kept — see
 * `lib/background-jobs/maintenance/collapse-stale-chat-caches.ts`). While
 * cold, a chat stays fully readable and keyword-searchable, but semantic
 * retrieval won't surface it. This module restores warmth transparently:
 * when a cold chat is opened, we detect chunks with content but no
 * embedding and enqueue per-chunk EMBEDDING_GENERATE jobs through the exact
 * pipeline the normal chunk indexer uses (same default profile, same
 * dimensions, same per-entity dedup in `enqueueEmbeddingGenerate`).
 *
 * Fire-and-forget from the chat GET path — a failure here must never break
 * loading the conversation. An in-memory per-chat debounce keeps repeated
 * opens from re-scanning the chunk table on every request; the queue's
 * per-entity dedup is the hard guarantee against stacked jobs.
 *
 * Manual alternative: the existing `?action=render-conversation` chat action
 * re-renders and full-re-embeds the whole conversation.
 *
 * Parent-process only (enqueueing writes job rows).
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service';

const moduleLogger = logger.child({ module: 'scriptorium.cold-chunk-reembed' });

/** Don't re-scan a chat's chunks more than once per window per process. */
const DEBOUNCE_MS = 5 * 60 * 1000;

/** chatId → epoch ms of the last scan kicked off for it. */
const lastScanAt = new Map<string, number>();

/** Test hook: forget all debounce state. */
export function _resetColdChunkReembedDebounceForTesting(): void {
  lastScanAt.clear();
}

/**
 * If the chat has conversation chunks with content but no embedding (the
 * cold-tiered state), enqueue a re-embed job for each through the standard
 * chunk-embedding pipeline. Safe to call on every chat open: debounced
 * in-process, deduped per entity in the queue, and a warm chat exits after
 * one cheap COUNT query.
 *
 * Returns the number of chunks newly enqueued (0 when debounced, warm,
 * chunkless, or no embedding profile is configured).
 */
export async function maybeEnqueueColdChunkReembed(
  userId: string,
  chatId: string,
): Promise<number> {
  const now = Date.now();
  const last = lastScanAt.get(chatId);
  if (last !== undefined && now - last < DEBOUNCE_MS) {
    return 0;
  }
  lastScanAt.set(chatId, now);

  const repos = getRepositories();

  // One GROUP BY count decides cold vs warm without loading chunk bodies.
  const counts = await repos.conversationChunks.countByChatIds([chatId]);
  const chatCounts = counts.get(chatId);
  if (!chatCounts || chatCounts.total === 0 || chatCounts.embedded >= chatCounts.total) {
    return 0;
  }

  // Default profile only — never an arbitrary fallback: every vector in the
  // instance must come from the same profile.
  const embeddingProfiles = await repos.embeddingProfiles.findAll();
  const defaultProfile = embeddingProfiles.find((p) => p.isDefault);
  if (!defaultProfile) {
    moduleLogger.debug('Cold chat detected but no default embedding profile configured — skipping re-embed', {
      chatId,
    });
    return 0;
  }

  const chunks = await repos.conversationChunks.findByChatId(chatId);
  let enqueued = 0;
  for (const chunk of chunks) {
    if (chunk.embedding != null && chunk.embedding.length > 0) continue;
    if (!chunk.content || chunk.content.trim().length === 0) continue;
    const result = await enqueueEmbeddingGenerate(userId, {
      entityType: 'CONVERSATION_CHUNK',
      entityId: chunk.id,
      chatId,
      profileId: defaultProfile.id,
    });
    if (result.isNew) enqueued++;
  }

  if (enqueued > 0) {
    moduleLogger.info('Cold chat reopened — enqueued chunk re-embedding', {
      chatId,
      enqueued,
      totalChunks: chatCounts.total,
      alreadyEmbedded: chatCounts.embedded,
    });
  }
  return enqueued;
}
