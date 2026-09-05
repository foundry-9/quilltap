/**
 * Context Builder Service
 *
 * Handles building the LLM context for chat messages,
 * including message formatting, file attachments, and context management.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { buildContext, type MessageWithParticipant, type BuiltContext, type ContextCompressionResult } from '@/lib/chat/context-manager'
import type { SemanticSearchResult, SearchQueryEmbedding } from '@/lib/memory/memory-service'
import type { MemorySearchExtraction } from '@/lib/memory/cheap-llm-tasks'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { profileUsesNamePrefill } from '@/lib/llm/multi-character-prefill'
import { profileRunsThinkingTurn } from '@/lib/plugins/provider-registry'
import { loadChatFilesForLLM } from '@/lib/chat-files-v2'
import { getErrorMessage } from '@/lib/error-utils'
import {
  processFileAttachmentFallback,
  formatFallbackAsMessagePrefix,
  type FallbackResult,
} from '@/lib/chat/file-attachment-fallback'
import { resolveTimezone } from '@/lib/chat/timestamp-utils'
import { getRepositories } from '@/lib/repositories/factory'
import {
  attributeAdhocAnnouncements,
  collectAnnouncerCharacterIds,
  type CustomAnnouncer,
} from '@/lib/chat/context/announcement-attribution'
import type {
  ChatMetadataBase,
  ChatParticipantBase,
  Character,
  ConnectionProfile,
  MessageEvent,
  TimestampConfig,
} from '@/lib/schemas/types'
import type { AttachedFile } from './types'

const logger = createServiceLogger('ContextBuilderService')

/**
 * Options for building message context
 */
export interface BuildMessageContextOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: ChatParticipantBase
  connectionProfile: ConnectionProfile
  userCharacter: { name: string; description: string } | null
  isMultiCharacter: boolean
  participantCharacters?: Map<string, Character>
  roleplayTemplate: { systemPrompt: string } | null
  chatSettings: { cheapLLMSettings?: Record<string, unknown>; defaultTimestampConfig?: TimestampConfig | null; timezone?: string | null } | null
  toolInstructions?: string
  newUserMessage?: string
  /** The user-controlled participant the human is "Speaking As" for this turn */
  activeUserParticipantId?: string | null
  isContinueMode: boolean
  /** Context compression settings (if enabled) */
  contextCompressionSettings?: ContextCompressionSettings | null
  /** Cheap LLM selection for compression (required if compression is enabled) */
  cheapLLMSelection?: CheapLLMSelection | null
  /** Whether to bypass compression for this request */
  bypassCompression?: boolean
  /** Pre-computed compression result from async cache (avoids blocking on compression) */
  cachedCompressionResult?: ContextCompressionResult | null
  /**
   * Message count when the cached compression was computed.
   * Used to calculate dynamic window size when using a fallback cache.
   */
  cachedCompressionMessageCount?: number
  /** Pre-searched memories from proactive recall (skips internal memory search when provided) */
  preSearchedMemories?: SemanticSearchResult[]
  /** Turn-level recall signals from the proactive distillation (retrospective cadence). */
  recallSignals?: MemorySearchExtraction
  /**
   * Query text + vector the proactive memory search already embedded. Reused
   * (never re-embedded) by the per-turn conversation-summary list when the
   * pre-searched memories are the ones this turn uses.
   */
  preSearchedQueryEmbedding?: SearchQueryEmbedding
  /** Whether to generate a memory recap for this character (chat start or character join) */
  generateMemoryRecap?: boolean
  /** Uncensored fallback options for memory recap in dangerous chats */
  uncensoredFallbackOptions?: UncensoredFallbackOptions
  /** Optional callback to emit status events during context building phases */
  onStatusChange?: (stage: string, message: string) => void
  /**
   * Autonomous-room per-turn context cap (tokens). When set, clamps the
   * model-derived `maxAvailable` budget down to this value so a token-budgeted
   * room paces its run across multiple turns. Undefined for everything else.
   */
  autonomousContextCap?: number
  /**
   * Tokens the caller will add to the payload after this returns — the tool
   * schemas plus any system message the orchestrator splices in (agent-mode
   * instructions, tool-change notice). Held back from the message budget so
   * history is not packed into space they will occupy. See `collectTurnExtras`
   * in `turn-extras.ts`, which builds and measures them together.
   */
  reservedOutgoingTokens?: number
  /**
   * "Nothing to add" turn-skipping — per-turn instruction control. When
   * `offerSkip` is true, a Turn note is injected inviting the character to pass
   * with the `[NOTHING TO ADD]` sentinel; `recentlyAddressed` adds a caution to
   * answer rather than pass. Undefined / `offerSkip: false` → no note. Ephemeral,
   * never persisted.
   */
  turnSkip?: { offerSkip: boolean; recentlyAddressed: boolean; characterName: string }
}

/**
 * Result of context building
 */
export interface MessageContextResult {
  builtContext: BuiltContext
  formattedMessages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }>
  isInitialMessage: boolean
}

/**
 * File processing result
 */
export interface FileProcessingResult {
  attachedFiles: AttachedFile[]
  fileAttachments: Awaited<ReturnType<typeof loadChatFilesForLLM>>
  fallbackResults: FallbackResult[]
  messageContentPrefix: string
  attachmentsToSend: Awaited<ReturnType<typeof loadChatFilesForLLM>>
}

/**
 * Load and process attached files for a message
 */
export async function loadAndProcessFiles(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  fileIds?: string[]
): Promise<FileProcessingResult> {
  if (!fileIds || fileIds.length === 0) {
    return {
      attachedFiles: [],
      fileAttachments: [],
      fallbackResults: [],
      messageContentPrefix: '',
      attachmentsToSend: [],
    }
  }

  // Use the repository to find files linked to the chat
  const chatFiles = await repos.files.findByLinkedTo(chatId)
  const matched = chatFiles.filter(file => fileIds.includes(file.id))

  const attachedFiles: AttachedFile[] = matched.map(file => ({
    id: file.id,
    filepath: `api/files/${file.id}`,
    filename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
  }))

  // Load file data for LLM with provider-aware image resizing
  const fileAttachments = await loadChatFilesForLLM(
    attachedFiles.map(f => f.id),
    { provider: connectionProfile.provider }
  )

  // Process file attachment fallbacks if provider doesn't support them
  const fallbackResults: FallbackResult[] = []
  let messageContentPrefix = ''

  for (let i = 0; i < fileAttachments.length; i++) {
    const fileAttachment = fileAttachments[i]
    const fileMetadata = attachedFiles[i]

    const fallbackResult = await processFileAttachmentFallback(
      fileMetadata,
      fileAttachment,
      connectionProfile,
      repos,
      userId
    )

    fallbackResults.push(fallbackResult)

    // Add fallback content to message prefix
    const fallbackPrefix = formatFallbackAsMessagePrefix(fallbackResult)
    if (fallbackPrefix) {
      messageContentPrefix += fallbackPrefix
    }
  }

  // Keep an attachment only when the provider natively supports it
  // (processFileAttachmentFallback returns type 'unsupported' with no error
  // in that case). Text/image_description results replace the attachment
  // with prefix text; 'unsupported' with an error means fallback was
  // attempted and failed — sending the raw bytes anyway would just trip the
  // provider's "no image input" rejection, so drop it.
  const attachmentsToSend = fileAttachments.filter((_, idx) => {
    const fallback = fallbackResults[idx]
    return !fallback || (fallback.type === 'unsupported' && !fallback.error)
  })

  return {
    attachedFiles,
    fileAttachments,
    fallbackResults,
    messageContentPrefix,
    attachmentsToSend,
  }
}

/**
 * Walk the tail of existingMessages and collect Lantern-image file IDs that
 * the given character has not yet seen, so they can be loaded as vision
 * content on the character's next LLM turn. A Lantern image is any image
 * file ID attached to an ASSISTANT-role message (story background, avatar
 * regeneration, or a `generate_image` tool invocation — all three pipelines
 * write the announcement through postLanternImageNotification).
 *
 * The walk stops at the character's own most recent ASSISTANT message —
 * anything older than that was already surfaced on a previous turn and
 * must not be re-delivered. A `historyCutoff` (ISO timestamp) can be
 * supplied for a joining character with no history access; images older
 * than the cutoff are skipped even on the character's first turn.
 *
 * `lookback` caps how many ASSISTANT messages we scan before giving up
 * (safety bound for very long chats).
 *
 * Returns file IDs in chronological order (oldest first), deduped.
 *
 * Exported for unit testing.
 */
export function collectLanternImageFileIdsForCharacter(
  existingMessages: Array<{ type: string; role?: string; attachments?: string[] | null; participantId?: string | null; createdAt?: string }>,
  characterParticipantId: string,
  isMultiCharacter: boolean,
  historyCutoff: string | null,
  lookback: number,
): string[] {
  const collected: string[] = []
  const seen = new Set<string>()
  let scanned = 0
  for (let i = existingMessages.length - 1; i >= 0 && scanned < lookback; i--) {
    const msg = existingMessages[i]
    if (msg.type !== 'message' || msg.role !== 'ASSISTANT') continue

    const atts = msg.attachments
    const hasAttachments = Array.isArray(atts) && atts.length > 0

    // Anything older than the character's own previous turn was already
    // delivered, so we stop the walk there.
    if (isCharactersOwnPriorResponse(msg, characterParticipantId, isMultiCharacter)) break

    scanned++

    if (!hasAttachments) continue

    // History-access guard: a participant joining mid-chat without history
    // access must not see images from before they joined.
    if (historyCutoff && msg.createdAt && msg.createdAt < historyCutoff) continue

    for (const fileId of atts!) {
      if (typeof fileId === 'string' && !seen.has(fileId)) {
        seen.add(fileId)
        collected.push(fileId)
      }
    }
  }
  return collected.reverse()
}

/**
 * Has this ASSISTANT message been authored by the character we are building
 * context for? Both attachment walkers stop there: anything older was already
 * delivered on a previous turn and must not be re-sent.
 *
 * Multi-character chats set `participantId` on every character response, while
 * Staff notifications leave it null — a direct id match is enough. Single-
 * character chats don't populate participantId on character responses, so we
 * fall back to the structural signal: Staff image notifications always carry
 * attachments and character responses never do, so an ASSISTANT message
 * without attachments is the character's own prior turn.
 */
function isCharactersOwnPriorResponse(
  msg: { attachments?: string[] | null; participantId?: string | null },
  characterParticipantId: string,
  isMultiCharacter: boolean,
): boolean {
  if (isMultiCharacter) return msg.participantId === characterParticipantId
  return !(Array.isArray(msg.attachments) && msg.attachments.length > 0)
}

/**
 * The USER-side counterpart of `collectLanternImageFileIdsForCharacter`: walk
 * the tail of existingMessages and collect the attachments the *human* shared
 * that this character has not yet been shown.
 *
 * Bug 121. A file the user attaches is expanded into prompt text (or carried
 * as raw bytes) at request-assembly time by `loadAndProcessFiles`, from the
 * `fileIds` on that one HTTP request, and the expansion is never written down
 * — `chat_messages` keeps the user's typed words and a pointer. The second
 * character to speak in a multi-character turn is a fresh request with no
 * `fileIds`, assembling context from those rows, so it received the typed
 * words alone: in the reported scene a 29 KB transcript reached 1 of 13 model
 * calls while the attachment chip sat in the UI telling the user otherwise.
 * The Lantern walk could not cover it, because its first filter is
 * `role !== 'ASSISTANT'` and a user upload is a USER-role message.
 *
 * Returns rows in chronological order so the caller can splice each file back
 * in at the message that carried it, rather than restating it at the tail.
 * The same "stop at the character's own prior response" rule bounds the walk
 * and gives the budget for free: a character is shown a given attachment once,
 * on its first turn after the upload, and never again.
 *
 * `historyCutoff` (ISO timestamp) excludes uploads older than a joining
 * character's arrival; `lookback` caps the scan for very long chats.
 *
 * Exported for unit testing.
 */
export function collectUnseenUserAttachmentsForCharacter(
  existingMessages: Array<{ type: string; role?: string; id?: string; attachments?: string[] | null; participantId?: string | null; createdAt?: string; systemSender?: string | null }>,
  characterParticipantId: string,
  isMultiCharacter: boolean,
  historyCutoff: string | null,
  lookback: number,
): Array<{ messageId: string; fileIds: string[] }> {
  const collected: Array<{ messageId: string; fileIds: string[] }> = []
  const seen = new Set<string>()
  let scanned = 0

  for (let i = existingMessages.length - 1; i >= 0 && scanned < lookback; i--) {
    const msg = existingMessages[i]
    if (msg.type !== 'message') continue

    if (msg.role === 'ASSISTANT') {
      if (isCharactersOwnPriorResponse(msg, characterParticipantId, isMultiCharacter)) break
      scanned++
      continue
    }

    if (msg.role !== 'USER') continue
    scanned++

    const atts = msg.attachments
    if (!Array.isArray(atts) || atts.length === 0) continue
    if (!msg.id) continue

    // A joining participant without history access must not see uploads from
    // before they arrived — symmetric with the Lantern walk's own guard.
    if (historyCutoff && msg.createdAt && msg.createdAt < historyCutoff) continue

    const fileIds = atts.filter((id): id is string => typeof id === 'string' && !seen.has(id))
    if (fileIds.length === 0) continue
    for (const id of fileIds) seen.add(id)
    collected.push({ messageId: msg.id, fileIds })
  }

  return collected.reverse()
}

/**
 * How far back either attachment walk will look for a user upload the
 * character has not seen. The real bound is the character's own previous turn;
 * this is the safety cap for a very long chat, or a character that has never
 * spoken and so has no previous turn to stop at.
 */
const USER_ATTACHMENT_LOOKBACK = 20

/**
 * Ceiling on the re-hydrated text a single turn may carry, in characters.
 *
 * The walk already bounds *how many* uploads come back (one pass per
 * character, per upload), but not how large they are, and a user may attach a
 * novel. Files are taken oldest-first until the budget is spent; what does not
 * fit is skipped with a warning rather than silently truncated mid-document,
 * because half a transcript is a worse input than none and a model given one
 * has no way to tell. ~80k characters is roughly 20k tokens — comfortably
 * inside a modern window, and `buildContext` still compresses and trims what
 * this produces like any other message body.
 */
const REHYDRATED_ATTACHMENT_CHAR_BUDGET = 80_000

/**
 * Load the user uploads a character has not yet been shown and turn them back
 * into prompt content. See `collectUnseenUserAttachmentsForCharacter` and bug
 * 121 for why this is a read-side derivation rather than a stored body.
 *
 * Returns the text to splice in ahead of each carrying message, keyed by that
 * message's row id, plus any raw attachments the provider takes natively
 * (images on a vision profile) for the caller to anchor the usual way.
 *
 * Never throws: an unreadable file leaves the turn exactly as it was before
 * this existed.
 */
async function rehydrateUserAttachments(args: {
  messages: Array<{ type: string; role?: string; id?: string; content?: string; attachments?: string[] | null; participantId?: string | null; createdAt?: string }>
  characterParticipantId?: string
  isMultiCharacter: boolean
  historyCutoff: string | null
  connectionProfile: ConnectionProfile
  repos: ReturnType<typeof getRepositories>
  userId: string
}): Promise<{ rehydratedContentByMessageId: Map<string, string>; rehydratedAttachmentsToKeep: unknown[] }> {
  const rehydratedContentByMessageId = new Map<string, string>()
  const rehydratedAttachmentsToKeep: unknown[] = []
  const { characterParticipantId } = args
  if (!characterParticipantId) return { rehydratedContentByMessageId, rehydratedAttachmentsToKeep }

  try {
    const unseen = collectUnseenUserAttachmentsForCharacter(
      args.messages,
      characterParticipantId,
      args.isMultiCharacter,
      args.historyCutoff,
      USER_ATTACHMENT_LOOKBACK,
    )
    if (unseen.length === 0) return { rehydratedContentByMessageId, rehydratedAttachmentsToKeep }

    const repos = args.repos ?? getRepositories()
    let budgetLeft = REHYDRATED_ATTACHMENT_CHAR_BUDGET
    let skippedForBudget = 0

    for (const { messageId, fileIds } of unseen) {
      const loaded = await loadChatFilesForLLM(fileIds, { provider: args.connectionProfile.provider })
      let prefix = ''

      for (const fileAttachment of loaded) {
        const fallbackResult = await processFileAttachmentFallback(
          {
            id: fileAttachment.id,
            filepath: fileAttachment.filepath ?? `/api/v1/files/${fileAttachment.id}`,
            filename: fileAttachment.filename,
            mimeType: fileAttachment.mimeType,
            size: fileAttachment.size,
          },
          fileAttachment,
          args.connectionProfile,
          repos,
          args.userId,
        )

        // Mirror the `loadAndProcessFiles` filter: keep the raw bytes only
        // when the provider takes them natively. A failed fallback drops the
        // file rather than tripping the provider's "no image input" refusal.
        if (fallbackResult.type === 'unsupported') {
          if (!fallbackResult.error) rehydratedAttachmentsToKeep.push(fileAttachment)
          continue
        }

        const text = formatFallbackAsMessagePrefix(fallbackResult)
        if (!text) continue
        if (text.length > budgetLeft) {
          skippedForBudget++
          continue
        }
        budgetLeft -= text.length
        prefix += text
      }

      if (prefix) rehydratedContentByMessageId.set(messageId, prefix)
    }

    if (skippedForBudget > 0) {
      logger.warn('Re-hydrated attachments exceeded the per-turn budget; some were not re-sent', {
        skippedForBudget,
        budget: REHYDRATED_ATTACHMENT_CHAR_BUDGET,
        characterParticipantId,
      })
    }
    if (rehydratedContentByMessageId.size > 0 || rehydratedAttachmentsToKeep.length > 0) {
      logger.debug('Re-hydrated user attachments from history', {
        messagesExpanded: rehydratedContentByMessageId.size,
        rawAttachmentsKept: rehydratedAttachmentsToKeep.length,
        charactersUsed: REHYDRATED_ATTACHMENT_CHAR_BUDGET - budgetLeft,
        characterParticipantId,
      })
    }
  } catch (err) {
    logger.warn('Failed to re-hydrate user attachments from history', {
      error: getErrorMessage(err),
      characterParticipantId,
    })
  }

  return { rehydratedContentByMessageId, rehydratedAttachmentsToKeep }
}

/**
 * Number of ASSISTANT messages that must appear *after* a TOOL message before
 * its result body is elided from the outgoing LLM context. At 3 turns the raw
 * payload is replaced with a compact stub; within the last 3 turns it is sent
 * verbatim. Counting ASSISTANT messages is the turn proxy agreed for both
 * interactive (≈1 per turn) and autonomous (all-ASSISTANT) rooms.
 */
const TOOL_RESULT_VERBATIM_TURNS = 3

/**
 * Render the content string for a single TOOL message in the outgoing context.
 *
 * @param toolData   Parsed tool payload ({ toolName|tool, result, arguments, … })
 * @param assistantAfter  Number of ASSISTANT messages that follow this TOOL msg
 *                         in the filtered sequence. When ≥ TOOL_RESULT_VERBATIM_TURNS
 *                         the result body is replaced with a compact stub.
 * @returns          Formatted content string, role will be USER in the output.
 */
function renderToolResultContent(
  toolData: { toolName?: string; tool?: string; result?: unknown; arguments?: unknown },
  assistantAfter: number,
): string {
  const toolName = toolData.toolName || toolData.tool || 'Unknown'
  if (assistantAfter >= TOOL_RESULT_VERBATIM_TURNS) {
    // Elide: include compact argument summary so context is not opaque.
    let compactArgs = ''
    if (toolData.arguments !== undefined && toolData.arguments !== null) {
      try {
        const raw = JSON.stringify(toolData.arguments)
        compactArgs = raw.length > 200 ? raw.slice(0, 200) + '…' : raw
      } catch {
        compactArgs = String(toolData.arguments).slice(0, 200)
      }
    }
    return `[Tool Result: ${toolName}] (args: ${compactArgs}) — result elided (>3 turns old); call again to re-read.`
  }
  const resultText = toolData.result !== undefined && toolData.result !== null && toolData.result !== ''
    ? String(toolData.result)
    : 'No result'
  return `[Tool Result: ${toolName}]\n${resultText}`
}

/**
 * Build conversation messages for context
 */
export function buildConversationMessages(
  existingMessages: Array<{ type: string; role?: string; content?: string; id?: string; thoughtSignature?: string | null; participantId?: string | null; targetParticipantIds?: string[] | null; createdAt?: string }>,
  isMultiCharacter: boolean
): {
  conversationMessages: Array<{ role: string; content: string; id?: string; thoughtSignature?: string | null }>
  messagesWithParticipants?: MessageWithParticipant[]
} {
  // Filtered sequence: only type=message, roles USER/ASSISTANT/TOOL.
  const filtered = existingMessages.filter(msg => {
    if (msg.type !== 'message') return false
    const role = msg.role
    return role === 'USER' || role === 'ASSISTANT' || role === 'TOOL'
  })

  // Compute assistantAfter[i] — the number of ASSISTANT-role messages that
  // appear after filtered[i]. One O(n) reverse pass; TOOL messages are NOT in
  // the turn partition so counting ASSISTANT-after is the agreed turn proxy
  // for both interactive (≈1 per turn) and autonomous (all-ASSISTANT) rooms.
  const assistantAfter: number[] = new Array(filtered.length).fill(0)
  let trailingAssistants = 0
  for (let i = filtered.length - 1; i >= 0; i--) {
    assistantAfter[i] = trailingAssistants
    if (filtered[i].role === 'ASSISTANT') trailingAssistants++
  }

  // Map to output shape, using renderToolResultContent for TOOL messages.
  const conversationMessages = filtered
    .map((msg, i) => {
      if (msg.role === 'TOOL') {
        try {
          const toolData = JSON.parse(msg.content || '{}')
          return {
            role: 'USER' as const,
            content: renderToolResultContent(toolData, assistantAfter[i]),
            id: msg.id,
          }
        } catch {
          return null
        }
      }

      return {
        role: msg.role as string,
        content: msg.content as string,
        id: msg.id,
        thoughtSignature: msg.role === 'ASSISTANT' ? msg.thoughtSignature : undefined,
      }
    })
    .filter((msg): msg is NonNullable<typeof msg> => msg !== null)

  // Build messages with participant info for multi-character context
  let messagesWithParticipants: MessageWithParticipant[] | undefined

  if (isMultiCharacter) {
    messagesWithParticipants = filtered
      .map((msg, i) => {
        if (msg.role === 'TOOL') {
          try {
            const toolData = JSON.parse(msg.content || '{}')
            return {
              role: 'USER' as const,
              content: renderToolResultContent(toolData, assistantAfter[i]),
              id: msg.id,
              createdAt: msg.createdAt,
              participantId: null,
            }
          } catch {
            return null
          }
        }

        return {
          role: msg.role as string,
          content: msg.content as string,
          id: msg.id,
          thoughtSignature: msg.role === 'ASSISTANT' ? msg.thoughtSignature : undefined,
          participantId: msg.participantId,
          targetParticipantIds: (msg as any).targetParticipantIds || null,
          createdAt: msg.createdAt,
        }
      })
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
  }

  return { conversationMessages, messagesWithParticipants }
}

/**
 * Whisper-role normalization. Staff messages (`systemSender` set) are
 * stored as `role: ASSISTANT` because that's how the Salon UI groups them
 * — but for the LLM they are external annotations to the character, not
 * the character's own speech. Two reasons to re-role them as USER here:
 *
 *   1. Conceptual: the Librarian filing a document, the Host noting the
 *      time, Prospero summarising a project — these are inputs *to* the
 *      character, not utterances *from* it.
 *   2. Practical: Anthropic Sonnet 4.6 rejects requests whose final
 *      message is `role: assistant` with "This model does not support
 *      assistant message prefill. The conversation must end with a user
 *      message." Any chat where a character's response failed and then
 *      synthetic whispers accumulated (Lantern image generation,
 *      memory recap, host event, etc.) ends with assistant-role whispers
 *      at the tail and 400s on the next turn.
 *
 * Exception: whispers that carry attachments stay as `role: ASSISTANT`.
 * `collectLanternImageFileIdsForCharacter` discriminates Lantern-published
 * images structurally as "assistant + attachments" — re-roling those
 * would break the image walker. The whispers we actually need to flip
 * (host, prospero, librarian-no-attach, commonplace) have no attachments,
 * so this carve-out is naturally safe for the prefill-error fix.
 *
 * The opaque-anywhere body swap rides on the same map: where systemSender
 * is set and isOpaqueAnywhere is on, the persona-free `opaqueContent`
 * body replaces `content`. The systemSender field is cleared because no
 * downstream consumer in the LLM-bound path reads it (the field never
 * reaches the wire).
 *
 * Non-whisper messages (`systemSender` null/undefined) pass through
 * untouched. Exported for unit testing.
 */
export function normalizeWhisperRoles<
  T extends {
    role?: string
    content?: string
    opaqueContent?: string | null
    attachments?: string[] | null
    systemSender?: string | null
  }
>(messages: T[], isOpaqueAnywhere: boolean): T[] {
  return messages.map(m => {
    if (!m.systemSender) return m
    const hasAttachments = Array.isArray(m.attachments) && m.attachments.length > 0
    const body = isOpaqueAnywhere ? (m.opaqueContent ?? m.content) : m.content
    return {
      ...m,
      systemSender: null,
      role: hasAttachments ? (m.role ?? 'ASSISTANT') : 'USER',
      content: body,
    }
  })
}

/**
 * Pick the message that image attachments (and the Lantern description
 * prefix) should ride on.
 *
 * Bug 95: this used to be "the last message, if it happens to be role user".
 * Staff whispers format as `role: user` and routinely accumulate after the
 * human's turn — a Host timestamp, a Prospero context memorandum, a
 * connection-profile-change bubble — so on any regenerate or swipe the picture
 * was stapled to "Abigail's current response model is now …" while the
 * Librarian's announcement was telling the model the bytes rode with the
 * user's message. Worse, after a tool call the tail isn't role user at all,
 * and the attachments were dropped on the floor without a word.
 *
 * Preference order:
 *  1. the message flagged as *this* turn's user input (`metadata.isUserTurn`),
 *     set by the context manager where `newUserMessage` is appended;
 *  2. the last `role: user` message whose source row was a genuine human turn
 *     — the regenerate/swipe case, where there is no new user message and the
 *     human's words are already in history;
 *  3. the last `role: user` message of any kind. This is the old behaviour,
 *     kept as a floor: a context shape we haven't anticipated should still
 *     deliver the bytes *somewhere* rather than silently discard them.
 *
 * Returns -1 when there is no user-role message at all, which the caller logs
 * — the attachments genuinely cannot be delivered in that shape.
 *
 * Exported for unit testing.
 */
export function selectAttachmentAnchorIndex(
  contextMessages: Array<{ role: string; metadata?: { messageId?: string; isUserTurn?: boolean } }>,
  userTurnMessageIds: ReadonlySet<string>
): number {
  for (let i = contextMessages.length - 1; i >= 0; i--) {
    if (contextMessages[i].metadata?.isUserTurn) return i
  }
  for (let i = contextMessages.length - 1; i >= 0; i--) {
    const id = contextMessages[i].metadata?.messageId
    if (contextMessages[i].role === 'user' && id && userTurnMessageIds.has(id)) return i
  }
  for (let i = contextMessages.length - 1; i >= 0; i--) {
    if (contextMessages[i].role === 'user') return i
  }
  return -1
}

/**
 * Anti-chorus content rules for multi-character turns, appended to the system
 * message on BOTH anchor routes (the discipline is about what a turn contains,
 * not who speaks it).
 *
 * Motivated by the "committee meeting" failure mode observed with weaker
 * models: every character opens with a roll-call recap of the prior speakers,
 * endorses all of it, claims "the one thing nobody has named," parrots the
 * cast's coined phrases verbatim, and closes by restating the group's action
 * list. The rules target the *shape* of the chorus rather than specific
 * wording — phrase blocklists alone have proven too weak to hold. Exported for
 * unit testing.
 */
export const GROUP_SCENE_DISCIPLINE = `GROUP-SCENE DISCIPLINE — the failure mode of a group scene is the chorus: each character recaps what the others said, agrees with all of it, and adds one small item shaped like everyone else's. Never join a chorus:
- Do not open by summarizing or listing what other characters just said. Everyone present heard it. React to at most one specific thing, or simply act.
- Do not agree-then-add ("X is right — but there's one thing nobody has named"). If all you have is agreement plus a small addendum, give the addendum alone in a sentence or two — or pass the turn if passing is offered.
- Never reuse another character's metaphors, images, or coined phrases. A striking phrase someone else used in this scene is spent; repeating it is a defect, not a callback. If several characters have already said much the same thing, saying it again in your own accent adds nothing.
- Do not restate the plan, the task list, or the group's conclusions. They are already on the record; a speech re-affirming what is decided adds nothing.
- Speak to change something: new information, a genuine objection or disagreement, a question, an action actually taken, a joke, a refusal. Re-pledging your commitment is not a turn.
- Vary register and length. Most real conversational turns are one to three sentences. A long speech is an event, not a default — and never the second one in a row.`

/**
 * In multi-character chats, anchor each reply to the responding character and
 * forbid it from writing anyone else's turn. Two routes, chosen per profile by
 * `multiCharacterPrefill`:
 *
 *   - **prefill** — append an assistant `[Name]` message. The model
 *     structurally continues only that character's line; the leading tag is
 *     stripped downstream by `stripCharacterNamePrefix()`.
 *   - **prose** — append an instruction to the system message instead, leaving
 *     the conversation ending on a user message. We deliberately do NOT tell
 *     the model to emit a `[Name]` tag — that both contradicts the always-on
 *     Identity Reminder ("do not prefix with your name") and teaches weaker
 *     models the very screenplay format they then run away with, writing the
 *     whole cast's turns. Identity is anchored in prose and foreign speaker
 *     tags forbidden outright.
 *
 * Both routes also append {@link GROUP_SCENE_DISCIPLINE} to the system message:
 * the identity anchor keeps a turn attributed to one character, but says
 * nothing about content, and with the previous turns as the strongest style
 * examples in context, models converge into the recap-endorse-echo chorus the
 * discipline block forbids.
 *
 * `finalizeMessageResponse()` truncates a response at the first foreign
 * `[Name]`/`Name:` tag as a structural backstop either way.
 *
 * Mutates `formattedMessages` in place. Exported for unit testing.
 */
export function applyMultiCharacterTurnAnchor(
  formattedMessages: Array<{ role: string; content: string; thoughtSignature?: string; name?: string }>,
  characterName: string,
  usePrefill: boolean
): void {
  const systemIdx = formattedMessages.findIndex(m => m.role === 'system')

  const systemAdditions: string[] = []
  if (!usePrefill) {
    systemAdditions.push(
      `IMPORTANT — this is a multi-character scene. Respond as ${characterName} and ONLY ${characterName}: write only ${characterName}'s own dialogue, actions, and thoughts for this single turn, then stop. Never write, narrate, quote, or continue another participant's turn, and never label any text with another participant's name (no "[Name]" or "Name:" speaker tags for anyone but ${characterName}). Output only ${characterName}'s contribution.`
    )
  }
  systemAdditions.push(GROUP_SCENE_DISCIPLINE)

  if (systemIdx >= 0) {
    formattedMessages[systemIdx] = {
      ...formattedMessages[systemIdx],
      content: formattedMessages[systemIdx].content + '\n\n' + systemAdditions.join('\n\n'),
    }
  }

  if (usePrefill) {
    formattedMessages.push({
      role: 'assistant',
      content: `[${characterName}]`,
      thoughtSignature: undefined,
      name: undefined,
    })
  }
}

/**
 * Build the full message context for the LLM
 */
export async function buildMessageContext(
  options: BuildMessageContextOptions,
  existingMessages: Array<{ type: string; role?: string; content?: string; opaqueContent?: string | null; id?: string; thoughtSignature?: string | null; participantId?: string | null; targetParticipantIds?: string[] | null; createdAt?: string; attachments?: string[] | null; systemSender?: string | null; systemKind?: string | null; customAnnouncer?: CustomAnnouncer | null }>,
  attachmentsToSend: unknown[]
): Promise<MessageContextResult> {
  const {
    userId,
    chat,
    character,
    characterParticipant,
    connectionProfile,
    userCharacter,
    isMultiCharacter,
    participantCharacters,
    roleplayTemplate,
    chatSettings,
    toolInstructions,
    newUserMessage,
    activeUserParticipantId,
    contextCompressionSettings,
    cheapLLMSelection,
    bypassCompression,
    cachedCompressionResult,
    cachedCompressionMessageCount,
    preSearchedMemories,
    recallSignals,
    preSearchedQueryEmbedding,
    generateMemoryRecap: requestMemoryRecap,
    uncensoredFallbackOptions,
  } = options

  // Drop persisted Commonplace Book whispers from LLM context. They live in
  // the transcript for UI visibility, but recall is recomputed per turn and
  // inlined into the new user message body — past whispers piling up across
  // turns would just bloat the context window with stale recall. This filter
  // applies regardless of system transparency.
  //
  // EXCEPTION: the `relevant-conversations` kind (posted on each summary fold)
  // is NOT recomputed per turn and intentionally persists across turns, so it
  // is kept here and reaches the LLM like any other persistent Staff whisper.
  const isStrippableCmpb = (m: { systemSender?: string | null; systemKind?: string | null }) =>
    m.systemSender === 'commonplaceBook' && m.systemKind !== 'relevant-conversations'
  const cmpbStrippedCount = existingMessages.filter(isStrippableCmpb).length
  const messagesWithoutCmpb = cmpbStrippedCount > 0
    ? existingMessages.filter(m => !isStrippableCmpb(m))
    : existingMessages
  if (cmpbStrippedCount > 0) {
  }

  // Name the speaker on ad-hoc announcements. `customAnnouncer` is a rendering
  // field — the Salon paints the name and avatar on the bubble — so without
  // this the model receives an anonymous block of prose and guesses who said
  // it. See lib/chat/context/announcement-attribution.ts.
  const announcerCharacterIds = collectAnnouncerCharacterIds(messagesWithoutCmpb)
  const announcerNames = new Map<string, string>()
  if (announcerCharacterIds.length > 0) {
    const announcerRepos = getRepositories()
    await Promise.all(
      announcerCharacterIds.map(async id => {
        try {
          const character = await announcerRepos.characters.findById(id)
          if (character?.name) announcerNames.set(id, character.name)
        } catch (error) {
          // A deleted or unreadable character stays unnamed rather than
          // blocking the turn; the announcement passes through as it did before.
          logger.warn('[Context] Could not resolve announcer name', {
            characterId: id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    )
  }
  // Always run the pass: a `custom` announcer carries its own display name and
  // needs no lookup, so gating on the resolved-name map would skip it.
  const messagesAttributed = attributeAdhocAnnouncements(messagesWithoutCmpb, announcerNames)

  // Drop whispers the responding character isn't a party to — the same rule
  // `filterWhisperMessages` applies in multi-character mode, enforced here so
  // single-character context can't be the one place a private aside leaks.
  // Operator-only Prospero runs (run-tool with `private: true`) target the
  // userId, so no character participant ever matches and the message is
  // filtered out of every context; a whispered ad-hoc announcement is excluded
  // from every character it wasn't addressed to on the same test.
  const respondingParticipantId = characterParticipant?.id
  const messagesAfterWhisperFilter = respondingParticipantId
    ? messagesAttributed.filter(m => {
        const targets = m.targetParticipantIds
        if (!targets || targets.length === 0) return true
        if (m.participantId === respondingParticipantId) return true
        return targets.includes(respondingParticipantId)
      })
    : messagesAttributed

  // System transparency: when any non-user-character participant in this chat
  // has systemTransparency !== true, the whole chat goes "opaque-anywhere" —
  // every character's LLM context reads Staff messages with the persona-free
  // `opaqueContent` body in place of `content`. This preserves a shared
  // reality across participants: no character should hear the Staff by name
  // when a companion can't. The user character (controlledBy === 'user') does
  // NOT count toward the test — they stay transparent by default. The salon
  // UI is unaffected (the human user always sees Staff-attributed messages
  // with their full persona voicing and avatars).
  //
  // Doc-side gates on `character.systemTransparency` (self_inventory tool
  // availability, peer-vault visibility in doc_* handlers) remain per-character
  // and are unrelated to this swap.
  const llmParticipants = chat.participants.filter(
    p => p.controlledBy !== 'user' && p.status !== 'removed'
  )
  let isOpaqueAnywhere: boolean
  if (isMultiCharacter && participantCharacters) {
    isOpaqueAnywhere = llmParticipants.some(p => {
      const c = participantCharacters.get(p.characterId)
      // Unknown character record → treat as opaque (safer default — better to
      // hide Staff names from one transparent companion than to leak them to
      // an opaque one whose record didn't load).
      return !c || c.systemTransparency !== true
    })
  } else {
    // Single-character mode: the only LLM-controlled non-user character is
    // `character` itself.
    isOpaqueAnywhere = character.systemTransparency !== true
  }

  // Whisper-role normalization (re-role Staff whispers to USER, preserve
  // attachment-bearing whispers as ASSISTANT, apply opaque body swap). See
  // `normalizeWhisperRoles` for the full rationale.
  const filteredExistingMessages = normalizeWhisperRoles(messagesAfterWhisperFilter, isOpaqueAnywhere)

  // Row ids of the *human's* own turns, captured before normalization erases
  // the distinction. Staff whispers are re-roled to USER above, so after this
  // point "role === 'user'" no longer means "the user said it" — and the image
  // attachment anchor needs it to (bug 95).
  const userTurnMessageIds = new Set(
    messagesAfterWhisperFilter
      .filter(m => m.type === 'message' && m.role === 'USER' && !m.systemSender && m.id)
      .map(m => m.id as string)
  )

  // If this is a joining character without history access and they have not
  // yet responded, clamp both attachment walks to messages posted after they
  // joined. Computed from the filtered set so opaque characters never reach
  // Staff attachments either — symmetric with their text-side filter.
  const hasPriorResponse = filteredExistingMessages.some(
    m => m.type === 'message' && m.role === 'ASSISTANT' && m.participantId === characterParticipant?.id
  )
  const attachmentHistoryCutoff = (isMultiCharacter && characterParticipant && !characterParticipant.hasHistoryAccess && !hasPriorResponse)
    ? (characterParticipant.createdAt ?? null)
    : null

  // Bug 121: re-hydrate the human's own attachments out of history.
  //
  // `loadAndProcessFiles` expands the files on *this* request's `fileIds` and
  // the expansion dies with the request — the row keeps the typed words and a
  // pointer. Everyone after the first character to answer therefore saw a bare
  // message where a document had been. Re-deriving from the file here (rather
  // than persisting the expanded body) keeps the file the single source of
  // truth, survives regenerate, swipe, import and restore, and treats an
  // uploaded image exactly like an uploaded transcript: the same
  // `processFileAttachmentFallback` pass either inlines the text, describes
  // the image, or hands the raw bytes back for a provider that takes them.
  //
  // This runs *before* `buildContext` so the tokens are budgeted, compressed
  // and trimmed like any other message content — the Lantern prefix is spliced
  // in after budgeting, which is affordable for a description and would not be
  // for a 29 KB transcript.
  const { rehydratedContentByMessageId, rehydratedAttachmentsToKeep } =
    await rehydrateUserAttachments({
      messages: filteredExistingMessages,
      characterParticipantId: characterParticipant?.id,
      isMultiCharacter,
      historyCutoff: attachmentHistoryCutoff,
      connectionProfile,
      repos: options.repos,
      userId,
    })

  const messagesForConversation = rehydratedContentByMessageId.size > 0
    ? filteredExistingMessages.map(m => {
        const prefix = m.id ? rehydratedContentByMessageId.get(m.id) : undefined
        return prefix ? { ...m, content: prefix + (m.content ?? '') } : m
      })
    : filteredExistingMessages

  // Build conversation messages
  const { conversationMessages, messagesWithParticipants } = buildConversationMessages(
    messagesForConversation,
    isMultiCharacter
  )

  // Determine if this is the first user message (for timestamp START_ONLY mode)
  const isInitialMessage = conversationMessages.filter(m => m.role === 'user' || m.role === 'USER').length === 0

  // Detect if this is the first time this character is responding in this chat
  // (either it's the very first message, or this character just joined an existing chat)
  const isCharacterFirstResponse = isInitialMessage || (
    isMultiCharacter &&
    characterParticipant &&
    !characterParticipant.hasHistoryAccess &&
    messagesWithParticipants !== undefined &&
    !messagesWithParticipants.some(
      m => m.participantId === characterParticipant.id &&
           (m.role === 'assistant' || m.role === 'ASSISTANT')
    )
  )

  // Generate memory recap on first message or character join, unless explicitly overridden
  const shouldGenerateRecap = requestMemoryRecap ?? isCharacterFirstResponse

  // Get timestamp config from chat or user defaults
  const timestampConfig = chat.timestampConfig || chatSettings?.defaultTimestampConfig || null

  // Resolve timezone from fallback chain: per-chat → Salon settings → QUILLTAP_TIMEZONE env var → system default
  const timezone = resolveTimezone(
    timestampConfig?.timezone,
    chatSettings?.timezone
  )

  // Build context with intelligent token management
  const builtContext = await buildContext({
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    userId,
    character,
    userCharacter,
    chat,
    existingMessages: conversationMessages,
    newUserMessage,
    activeUserParticipantId,
    roleplayTemplate,
    embeddingProfileId: undefined, // always use default embedding profile
    skipMemories: false,
    minMemoryImportance: 0.5,
    // Multi-character context building options
    // Phase H: pass the responding participant in both single- and multi-
    // character chats so the system-prompt compiler cache can hit on
    // single-char chats too.
    respondingParticipant: characterParticipant,
    allParticipants: isMultiCharacter ? chat.participants : undefined,
    participantCharacters: isMultiCharacter ? participantCharacters : undefined,
    messagesWithParticipants: isMultiCharacter ? messagesWithParticipants : undefined,
    // Tool instructions (native tool rules or text-block tool instructions)
    toolInstructions,
    // Timestamp injection
    timestampConfig,
    isInitialMessage,
    timezone,
    // Connection profile (for budget-driven compression)
    connectionProfile,
    // Context compression
    contextCompressionSettings,
    cheapLLMSelection,
    bypassCompression,
    cachedCompressionResult,
    cachedCompressionMessageCount,
    // Proactive memory recall
    preSearchedMemories,
    recallSignals,
    preSearchedQueryEmbedding,
    // Memory recap (chat start or character join)
    generateMemoryRecap: shouldGenerateRecap,
    uncensoredFallbackOptions,
    // Aurora Core whisper: skip on continuation / nudge / chained autonomous turn
    isContinueMode: options.isContinueMode,
    // Status callback for streaming events
    onStatusChange: options.onStatusChange,
    // Autonomous-room per-turn context cap (tokens) — clamps the model-derived
    // budget so a token-budgeted room paces its run across multiple turns.
    autonomousContextCap: options.autonomousContextCap,
    // Room held back for the tool schemas and the system messages the caller
    // splices in after this returns.
    reservedOutgoingTokens: options.reservedOutgoingTokens,
    // "Nothing to add" turn-skipping — per-turn ephemeral instruction control.
    turnSkip: options.turnSkip,
  })

  // Log context building results for debugging
  if (builtContext.warnings.length > 0) {
    logger.warn('Context Manager warnings', { warnings: builtContext.warnings })
  }

  // Apply provider-aware message formatting for multi-character support
  const formattedContextMessages = isMultiCharacter
    ? formatMessagesForProvider(
        builtContext.messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          name: msg.name,
          thoughtSignature: msg.thoughtSignature,
        })),
        connectionProfile.provider,
        character.name
      )
    : builtContext.messages

  // Additionally surface image attachments from Lantern notifications
  // (story background, avatar regeneration, or the generate_image tool).
  // Without this, vision-capable providers would only see the announcement
  // text but not the actual image. For non-vision profiles, each loaded
  // attachment is run through processFileAttachmentFallback so the
  // description text is prepended to the last user turn and the raw image
  // is dropped — same machinery loadAndProcessFiles uses for user uploads.
  // Without that step, non-vision providers (e.g. DeepSeek via OpenRouter)
  // reject the request because they're being handed images they can't read.
  const ASSISTANT_IMAGE_LOOKBACK = 6
  let mergedAttachmentsToSend: unknown[] = [...attachmentsToSend, ...rehydratedAttachmentsToKeep]
  let lanternImagePrefix = ''
  try {
    const recentAssistantImageFileIds = collectLanternImageFileIdsForCharacter(
      filteredExistingMessages,
      characterParticipant.id,
      isMultiCharacter,
      attachmentHistoryCutoff,
      ASSISTANT_IMAGE_LOOKBACK,
    )
    if (recentAssistantImageFileIds.length > 0) {
      const extra = await loadChatFilesForLLM(recentAssistantImageFileIds, {
        provider: connectionProfile.provider,
      })
      if (extra.length > 0) {
        const lanternAttachmentsToKeep: typeof extra = []
        for (const fileAttachment of extra) {
          const fileMetadata = {
            id: fileAttachment.id,
            filepath: fileAttachment.filepath ?? `/api/v1/files/${fileAttachment.id}`,
            filename: fileAttachment.filename,
            mimeType: fileAttachment.mimeType,
            size: fileAttachment.size,
          }
          const fallbackResult = await processFileAttachmentFallback(
            fileMetadata,
            fileAttachment,
            connectionProfile,
            options.repos,
            userId,
          )
          const prefix = formatFallbackAsMessagePrefix(fallbackResult)
          if (prefix) {
            lanternImagePrefix += prefix
          }
          // Mirror the loadAndProcessFiles filter: only keep the raw
          // attachment when the provider natively supports it. If the
          // fallback failed, dropping the bytes avoids the provider's
          // "no image input" rejection downstream.
          if (fallbackResult.type === 'unsupported' && !fallbackResult.error) {
            lanternAttachmentsToKeep.push(fileAttachment)
          }
        }
        if (lanternAttachmentsToKeep.length > 0) {
          mergedAttachmentsToSend = [...mergedAttachmentsToSend, ...lanternAttachmentsToKeep]
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load recent assistant image attachments for vision', {
      error: getErrorMessage(err),
    })
  }

  // `formatMessagesForProvider` is a pure map, so indices stay parallel with
  // `builtContext.messages` and an index chosen against one applies to the other.
  const attachmentAnchorIndex = selectAttachmentAnchorIndex(
    builtContext.messages,
    userTurnMessageIds
  )

  if (mergedAttachmentsToSend.length > 0 && attachmentAnchorIndex === -1) {
    logger.warn('Image attachments could not be anchored — no user-role message in context; images will not reach the model', {
      attachmentCount: mergedAttachmentsToSend.length,
      contextMessageCount: builtContext.messages.length,
    })
  }

  // Prepare final messages for LLM
  const formattedMessages = formattedContextMessages.map((msg, idx) => {
    const isAnchor = idx === attachmentAnchorIndex
    const content = isAnchor && lanternImagePrefix
      ? lanternImagePrefix + msg.content
      : msg.content
    if (isAnchor && mergedAttachmentsToSend.length > 0) {
      return {
        role: msg.role,
        content,
        attachments: mergedAttachmentsToSend,
        name: msg.name,
      }
    }
    return {
      role: msg.role,
      content,
      thoughtSignature: msg.thoughtSignature ?? undefined,
      name: msg.name,
    }
  })

  if (isMultiCharacter) {
    applyMultiCharacterTurnAnchor(
      formattedMessages,
      character.name,
      // The thinking answer only matters for a profile that never chose —
      // `profileUsesNamePrefill` honours a stored boolean over any default.
      profileUsesNamePrefill(
        connectionProfile,
        profileRunsThinkingTurn(
          connectionProfile.provider,
          connectionProfile.modelName,
          connectionProfile.parameters as Record<string, unknown> | null | undefined
        )
      ),
    )
  }

  return {
    builtContext,
    formattedMessages,
    isInitialMessage,
  }
}
