/**
 * Scriptorium Markdown Renderer
 *
 * Deterministic (no LLM) renderer that converts chat messages into
 * numbered, structured Markdown organized by interchanges.
 *
 * @module scriptorium/markdown-renderer
 */

import { stripToolArtifacts } from '@/lib/memory/cheap-llm-tasks/chat-tasks'
import { createServiceLogger } from '@/lib/logging/create-logger'
import type { ChatEvent, ChatParticipantBase } from '@/lib/schemas/types'
import type { InterchangeInfo, RenderedConversation, ConversationMetadata } from '@/lib/schemas/scriptorium.types'

const logger = createServiceLogger('ScriptoriumRenderer')

/**
 * Per-chunk character budget for conversation interchanges (Bug 17).
 *
 * The embedding models we target (`text-embedding-3-large` and comparable)
 * accept ~8,192 tokens of context. At the ~4 chars/token typical of rendered
 * chat prose that is ~32k chars, and an interchange over it fails to embed
 * *deterministically* — the render never sub-chunked, so a single long
 * interchange (34k–117k chars observed in the wild) produced one chunk the
 * embedder could never accept, and it stayed unsearchable forever.
 *
 * We hold each emitted chunk to this many characters — a deliberately
 * conservative proxy for ~6k tokens, leaving headroom for denser text so the
 * embed never trips the model's context limit. This is NOT a token count; we
 * do not tokenise per model. An interchange whose rendered text exceeds the
 * budget is split into several sequential chunks (see {@link enforceChunkBudget}).
 */
export const CHUNK_CHAR_BUDGET = 24_000

/** Rendered every sub-chunk reserves for its `## Interchange N` header line. */
const CHUNK_HEADER_RESERVE = 80

/**
 * Cut `window` at the last occurrence of `sep`, keeping `sep` with the text
 * before the cut. Returns the end index of that occurrence, or null when the
 * separator is absent (or sits at the very start, which would make no progress).
 */
function lastBoundaryCut(window: string, sep: string): number | null {
  const idx = window.lastIndexOf(sep)
  if (idx <= 0) return null
  return idx + sep.length
}

/**
 * Split a single string longer than `budget` into pieces each `<= budget`,
 * preferring natural boundaries (paragraph break → sentence end → any
 * whitespace) and falling back to a hard character cut only when a single
 * token itself exceeds the budget. Concatenating the pieces reproduces the
 * input exactly. Used for the rare single message that alone blows the budget.
 */
function splitOversizeText(text: string, budget: number): string[] {
  if (text.length <= budget) return [text]
  const pieces: string[] = []
  let remaining = text
  while (remaining.length > budget) {
    const window = remaining.slice(0, budget)
    const cut =
      lastBoundaryCut(window, '\n\n') ??
      lastBoundaryCut(window, '. ') ??
      lastBoundaryCut(window, '\n') ??
      lastBoundaryCut(window, ' ') ??
      budget // no boundary in the whole window → hard cut, never over budget
    pieces.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut)
  }
  if (remaining.length > 0) pieces.push(remaining)
  return pieces
}

/** One interchange as accumulated during the build, before budget enforcement. */
interface RawInterchange {
  ordinal: number
  content: string
  /** The metadata header, present only on interchange 0 (else ''). */
  metadataPrefix: string
  entries: Array<{ id: string; displayName: string; block: string }>
  participantNames: string[]
  messageIds: string[]
}

/** A packed run of message blocks bound for one sub-chunk. */
interface PackedRun {
  text: string
  ids: string[]
  names: string[]
}

/**
 * Split one oversize interchange into sub-chunks at message boundaries first,
 * then within a single oversize message. Every returned run's text fits inside
 * `budget - CHUNK_HEADER_RESERVE`, leaving room for the header the caller
 * prepends. Order is preserved; a message split across runs repeats its id.
 */
function splitInterchange(ic: RawInterchange, budget: number, extraReserve = 0): PackedRun[] {
  const effective = Math.max(1, budget - CHUNK_HEADER_RESERVE - extraReserve)
  const runs: PackedRun[] = []

  let curText: string[] = []
  let curIds: string[] = []
  let curNames = new Set<string>()
  let curLen = 0

  const flush = () => {
    if (curText.length === 0) return
    runs.push({ text: curText.join('\n'), ids: [...curIds], names: [...curNames] })
    curText = []
    curIds = []
    curNames = new Set()
    curLen = 0
  }

  for (const entry of ic.entries) {
    const blockLen = entry.block.length + 1 // +1 for the '\n' join
    if (blockLen > effective) {
      // A single message overflows the budget on its own — flush what we have,
      // then split the message body at natural boundaries.
      flush()
      for (const piece of splitOversizeText(entry.block, effective)) {
        runs.push({ text: piece, ids: [entry.id], names: [entry.displayName] })
      }
      continue
    }
    if (curLen + blockLen > effective && curText.length > 0) {
      flush()
    }
    curText.push(entry.block)
    curIds.push(entry.id)
    curNames.add(entry.displayName)
    curLen += blockLen
  }
  flush()
  return runs
}

/**
 * Turn the raw interchange list into the final chunk list, splitting any
 * interchange whose rendered text exceeds {@link CHUNK_CHAR_BUDGET}. Each chunk
 * gets its own sequential `index` (a chunk ordinal, not the interchange
 * ordinal) so ordering and the `(chatId, interchangeIndex)` chunk identity stay
 * intact. In the common case — no interchange over budget — every interchange
 * is one chunk and the chunk ordinal equals the interchange ordinal, so the
 * output is byte-identical to the pre-sub-chunking renderer.
 */
function enforceChunkBudget(interchanges: RawInterchange[], budget: number): InterchangeInfo[] {
  const chunks: InterchangeInfo[] = []
  let chunkIndex = 0

  for (const ic of interchanges) {
    const fullContent = ic.metadataPrefix + ic.content
    if (fullContent.length <= budget) {
      chunks.push({
        index: chunkIndex++,
        messageIds: ic.messageIds,
        participantNames: ic.participantNames,
        content: fullContent,
      })
      continue
    }

    // Reserve room for the metadata header (interchange 0 only) so the first
    // sub-chunk, which carries it, still fits the budget.
    const runs = splitInterchange(ic, budget, ic.metadataPrefix.length)
    runs.forEach((run, i) => {
      const header =
        i === 0 ? `## Interchange ${ic.ordinal}` : `## Interchange ${ic.ordinal} (continued ${i})`
      // The metadata header (interchange 0 only) rides on the first sub-chunk.
      const prefix = i === 0 ? ic.metadataPrefix : ''
      chunks.push({
        index: chunkIndex++,
        messageIds: run.ids,
        participantNames: run.names.length > 0 ? run.names : ic.participantNames,
        content: `${prefix}${header}\n\n${run.text}`,
      })
    })
  }

  return chunks
}

/**
 * Format an ISO 8601 timestamp as a human-readable date and time.
 * Example: "April 11, 2026 at 3:45 PM"
 */
function formatDateTime(iso: string): string {
  try {
    const date = new Date(iso)
    const datePart = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const timePart = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
    return `${datePart} at ${timePart}`
  } catch {
    return iso
  }
}

/**
 * Renders a chat conversation into numbered, structured Markdown.
 *
 * Messages are filtered to visible content (type='message', role USER or ASSISTANT),
 * tool artifacts are stripped from assistant messages, and the result is organized
 * into interchanges (a new interchange starts at each USER message).
 *
 * @param messages - Raw chat events from the conversation
 * @param participants - Chat participant metadata
 * @param characterNames - Map of participantId to display name
 * @param metadata - Optional conversation metadata for header
 * @returns Rendered conversation with full markdown and structured interchange data
 */
export function renderConversationMarkdown(
  messages: ChatEvent[],
  participants: ChatParticipantBase[],
  characterNames: Map<string, string>,
  metadata?: ConversationMetadata,
): RenderedConversation {

  // Filter to visible messages and prepare for rendering
  const visibleMessages: Array<{
    id: string
    role: string
    content: string
    participantId: string | null | undefined
    createdAt: string
  }> = []

  for (const m of messages) {
    if (m.type !== 'message') continue
    const role = (m.role || '').toUpperCase()
    if (role !== 'USER' && role !== 'ASSISTANT') continue
    if (!m.content) continue

    if (role === 'ASSISTANT') {
      const cleaned = stripToolArtifacts(m.content)
      if (!cleaned) continue
      visibleMessages.push({
        id: m.id,
        role,
        content: cleaned,
        participantId: m.participantId,
        createdAt: m.createdAt,
      })
    } else {
      visibleMessages.push({
        id: m.id,
        role,
        content: m.content,
        participantId: m.participantId,
        createdAt: m.createdAt,
      })
    }
  }

  // Resolve display name for a message
  function resolveDisplayName(role: string, participantId: string | null | undefined): string {
    if (participantId && characterNames.has(participantId)) {
      return characterNames.get(participantId)!
    }
    if (role === 'USER') return 'User'
    // For ASSISTANT without a mapped name, fall back to 'Assistant'
    return 'Assistant'
  }

  // Group into interchanges: a new interchange starts at each USER message.
  // We keep each interchange's per-message `entries` alongside the joined
  // `content` so an oversize interchange can be re-split at message boundaries
  // later (enforceChunkBudget) without re-deriving the message blocks.
  const rawInterchanges: RawInterchange[] = []
  let currentInterchange: {
    ordinal: number
    messageIds: string[]
    participantNames: Set<string>
    lines: string[]
    entries: Array<{ id: string; displayName: string; block: string }>
  } | null = null
  let interchangeIndex = 0
  let globalMessageIndex = 0

  const finalizeInterchange = (ic: NonNullable<typeof currentInterchange>) => {
    rawInterchanges.push({
      ordinal: ic.ordinal,
      content: ic.lines.join('\n'),
      metadataPrefix: '',
      entries: ic.entries,
      participantNames: Array.from(ic.participantNames),
      messageIds: ic.messageIds,
    })
  }

  for (const msg of visibleMessages) {
    const displayName = resolveDisplayName(msg.role, msg.participantId)

    // Start a new interchange at each USER message, or for the very first message
    if (msg.role === 'USER' || currentInterchange === null) {
      // Finalize previous interchange if any
      if (currentInterchange !== null) {
        finalizeInterchange(currentInterchange)
        interchangeIndex++
      }

      currentInterchange = {
        ordinal: interchangeIndex,
        messageIds: [],
        participantNames: new Set(),
        lines: [`## Interchange ${interchangeIndex}`, ''],
        entries: [],
      }
    }

    // Render this message with timestamp
    const messageTimestamp = formatDateTime(msg.createdAt)
    const messageHeader = `### Message ${globalMessageIndex} (${displayName})`
    const messageBlock = `Past conversation message timestamp: ${messageTimestamp}\n\n${messageHeader}\n\n${msg.content}\n`

    currentInterchange.messageIds.push(msg.id)
    currentInterchange.participantNames.add(displayName)
    currentInterchange.lines.push(messageBlock)
    currentInterchange.entries.push({ id: msg.id, displayName, block: messageBlock })

    globalMessageIndex++
  }

  // Finalize the last interchange
  if (currentInterchange !== null) {
    finalizeInterchange(currentInterchange)
  }

  // Build metadata header if metadata is provided
  let metadataHeader = ''
  if (metadata) {
    // Collect all unique participant display names
    const allParticipantNames = new Set<string>()
    for (const ic of rawInterchanges) {
      for (const name of ic.participantNames) {
        allParticipantNames.add(name)
      }
    }

    // Derive conversation time span from first/last visible message timestamps
    const firstMessageTime = visibleMessages.length > 0 ? visibleMessages[0].createdAt : metadata.createdAt
    const lastMessageTime = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].createdAt : metadata.lastUpdatedAt

    const firstDate = new Date(firstMessageTime)
    const lastDate = new Date(lastMessageTime)
    const sameDay = firstDate.toLocaleDateString('en-US') === lastDate.toLocaleDateString('en-US')

    const spanDatePart = firstDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const spanFromTime = firstDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const spanToTime = lastDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

    const spanText = sameDay
      ? `${spanDatePart} from ${spanFromTime} to ${spanToTime}`
      : `${formatDateTime(firstMessageTime)} to ${formatDateTime(lastMessageTime)}`

    const nowText = formatDateTime(new Date().toISOString())

    metadataHeader = [
      `# Conversation: ${metadata.title}`,
      '',
      '**Metadata:**',
      `- Conversation ID: ${metadata.conversationId}`,
      `- Created: ${formatDateTime(metadata.createdAt)}`,
      `- Last Updated: ${formatDateTime(metadata.lastUpdatedAt)}`,
      `- Participants: ${Array.from(allParticipantNames).join(', ') || 'None'}`,
      `- Message Count: ${globalMessageIndex}`,
      `- Interchange Count: ${rawInterchanges.length}`,
      '',
      '---',
      '',
      `\u26A0\uFE0F ARCHIVE VIEW \u2014 This conversation occurred on ${spanText}.`,
      `Current time: ${nowText}. You are reading history, not in active conversation.`,
      '',
      '---',
      '',
    ].join('\n')

    // The metadata header rides with chunk 0. Tracked separately (not folded
    // into interchange 0's `content`) so budget enforcement can keep it on the
    // first sub-chunk when interchange 0 is itself split.
    if (rawInterchanges.length > 0) {
      rawInterchanges[0] = { ...rawInterchanges[0], metadataPrefix: metadataHeader }
    }
  }

  // Split any over-budget interchange into sequential in-context chunks. In the
  // common case (nothing over budget) each interchange is one chunk and the
  // output is byte-identical to the pre-sub-chunking renderer.
  const interchanges = enforceChunkBudget(rawInterchanges, CHUNK_CHAR_BUDGET)

  // Build the full markdown. The metadata header lives on chunk 0's content,
  // so the join naturally includes it at the top.
  const markdown = interchanges.map(ic => ic.content).join('\n')

  return { markdown, interchanges }
}
