/**
 * Answer Confirmation Service
 *
 * Before a character's tool-using Salon reply "lands", a cheap-LLM consistency
 * check compares the reply against what the character was told this turn (the
 * Commonplace Book whisper) and what it looked up (in-scope read-tool results).
 * If the reply looks inconsistent, the character's OWN model is invited to
 * affirm or rewrite it.
 *
 *   consistent            → confirmed:true
 *   inconsistent, stood by → confirmed:false (notes = discrepancies)
 *   inconsistent, rewrote  → confirmed:true, revised:true (original kept for logs)
 *   check errored/timeout  → confirmed:null (could-not-verify)
 *
 * The whole block is a no-op when the feature is inactive or there is nothing
 * to check (no whisper AND no in-scope read tool this turn).
 *
 * See docs/developer/features/salon-answer-confirmation.md.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { withTimeout } from '@/lib/promise-timeout'
import { parseLLMJsonObject } from '@/lib/llm/llm-json'
import { resolveUncensoredCheapLLMSelection, selectionFromProfile, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import type { UncensoredFallbackOptions, CheapLLMTaskResult } from '@/lib/memory/cheap-llm-tasks/types'
import type { LLMMessage } from '@/lib/llm/base'
import type { ConnectionProfile, MessageEvent, ChatMetadataBase, Character, ChatParticipantBase } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import type { getRepositories } from '@/lib/repositories/factory'
import { getParticipantName } from '@/lib/chat/context/message-attribution'
import { isUserDrivenSeat } from '@/lib/chat/turn-manager/utils'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import type { ToolMessage } from './types'

const logger = createServiceLogger('AnswerConfirmation')

export type AnswerConfirmationOverride = 'ON' | 'OFF' | null | undefined

/**
 * Read tools whose results are worth checking a reply against. Content reads
 * only — web search, prior-conversation reads, and the Scriptorium `doc_*`
 * content-read family. Listing / binary-blob reads are intentionally excluded.
 * Names verified against the ALWAYS_PRIVATE_TOOLS / VAULT_READ_TOOLS sets in
 * tool-execution.service.ts.
 */
export const CONFIRMATION_READ_TOOLS: ReadonlySet<string> = new Set<string>([
  'search',
  'read_conversation',
  'doc_read_file',
  'doc_grep',
  'doc_read_heading',
  'doc_read_frontmatter',
  'doc_open_document',
])

/** Char budget for the assembled reference block handed to the cheap LLM. */
const REFERENCE_CHAR_BUDGET = 24_000

/**
 * Char budget / message cap for the recent-conversation transcript handed to
 * the re-affirmation pass. This is what keeps a correction anchored to the
 * CURRENT scene: without it the model only sees its draft plus the reference
 * material (which can itself contain an OLD conversation the character read via
 * `read_conversation`), and rewrites its reply as if it were back in that old
 * scene. Kept small — the model only needs the immediate moment it was replying
 * to, not the whole history.
 */
const RECENT_CONTEXT_CHAR_BUDGET = 8_000
const RECENT_CONTEXT_MAX_MESSAGES = 20

/** Default timeouts (ms). The check is cheap; the re-affirmation is a full model. */
const CONSISTENCY_CHECK_TIMEOUT_MS = 25_000
const REAFFIRMATION_TIMEOUT_MS = 60_000

/**
 * Resolve whether the answer-confirmation check is active for a chat, given the
 * three-level gate: per-chat override wins, then the per-project override, then
 * the global default. `'OFF'` always beats an inherited `'ON'` at its own level
 * because it is checked first.
 */
export function isAnswerConfirmationActive(
  chatOverride: AnswerConfirmationOverride,
  projectOverride: AnswerConfirmationOverride,
  globalEnabled: boolean | undefined,
): boolean {
  if (chatOverride === 'ON') return true
  if (chatOverride === 'OFF') return false
  if (projectOverride === 'ON') return true
  if (projectOverride === 'OFF') return false
  return globalEnabled === true
}

/**
 * True when there is something to check this turn: a Commonplace Book whisper
 * was found for this character AND/OR at least one in-scope read-tool result
 * ran. Plain turns with neither are skipped entirely.
 */
export function hasCheckableInputs(
  whisper: string | null | undefined,
  toolMessages: ToolMessage[],
): boolean {
  if (whisper && whisper.trim().length > 0) return true
  return toolMessages.some((tm) => CONFIRMATION_READ_TOOLS.has(tm.toolName))
}

/**
 * The most-recent Commonplace Book whisper targeted at this character this
 * turn. Whispers are written (targeted, private) just before generation, so the
 * last `commonplaceBook` message addressed to this participant is the one the
 * character saw. Returns its raw `content`, or null if none.
 */
export function findLatestCommonplaceWhisper(
  messages: MessageEvent[],
  participantId: string,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m.type === 'message' &&
      m.systemSender === 'commonplaceBook' &&
      Array.isArray(m.targetParticipantIds) &&
      m.targetParticipantIds.includes(participantId) &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0
    ) {
      return m.content
    }
  }
  return null
}

/**
 * True when this turn was authored by a user-controlled participant
 * (impersonation). Such replies are never checked — the human may have sourced
 * facts out of band — and are persisted with an explicit `confirmed:null`.
 */
export function isUserDrivenTurn(
  chat: Pick<ChatMetadataBase, 'participants' | 'impersonatingParticipantIds'>,
  participantId: string,
): boolean {
  const participant = chat.participants?.find((p) => p.id === participantId)
  if (!participant) {
    // No participant record: fall back to the raw overlay membership check.
    return Array.isArray(chat.impersonatingParticipantIds)
      && chat.impersonatingParticipantIds.includes(participantId)
  }
  return isUserDrivenSeat(participant, chat.impersonatingParticipantIds)
}

/** Compactly serialize an in-scope tool result for the reference block. */
function serializeToolResult(tm: ToolMessage): string {
  const args = tm.arguments && Object.keys(tm.arguments).length > 0
    ? `\nArguments: ${JSON.stringify(tm.arguments)}`
    : ''
  return `[Tool: ${tm.toolName}${tm.success ? '' : ' (failed)'}]${args}\nResult: ${tm.content}`
}

/**
 * Assemble the reference block (whisper + in-scope tool results) the cheap LLM
 * checks the reply against. Returns `null` when there is nothing to check.
 * Truncates oldest-first to keep within the char budget.
 */
export function gatherConfirmationInputs(
  whisper: string | null | undefined,
  toolMessages: ToolMessage[],
): string | null {
  const inScopeTools = toolMessages.filter((tm) => CONFIRMATION_READ_TOOLS.has(tm.toolName))
  if (!hasCheckableInputs(whisper, toolMessages)) return null

  const sections: string[] = []
  if (whisper && whisper.trim().length > 0) {
    sections.push(`=== What the character recalled this turn (Commonplace Book) ===\n${whisper.trim()}`)
  }
  for (const tm of inScopeTools) {
    sections.push(`=== Lookup result ===\n${serializeToolResult(tm)}`)
  }

  let reference = sections.join('\n\n')
  if (reference.length > REFERENCE_CHAR_BUDGET) {
    // Truncate oldest-first: drop from the front until within budget, keeping
    // the most-recent lookups (which are usually the ones the reply leans on).
    reference = reference.slice(reference.length - REFERENCE_CHAR_BUDGET)
    reference = `[…earlier reference material truncated…]\n${reference}`
  }
  return reference
}

/**
 * Build a compact transcript of the recent live conversation for the
 * re-affirmation pass, so the character corrects its draft *in place* rather
 * than drifting to whatever old scene the reference material happens to quote.
 *
 * Only real participant dialogue is kept — Staff/system-sender whispers, tool
 * bubbles, and silent messages are dropped (the recalled/looked-up material is
 * supplied separately as the "reference"; this block is strictly the scene the
 * character is speaking into). `messages` is the conversation up to but not
 * including the draft reply. Returns null when there is no prior dialogue.
 */
export function buildRecentConversationContext(
  messages: MessageEvent[],
  participants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
): string | null {
  const dialogue = messages.filter(
    (m) =>
      m.type === 'message' &&
      !m.systemSender &&
      !m.isSilentMessage &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  )
  if (dialogue.length === 0) return null

  const recent = dialogue.slice(-RECENT_CONTEXT_MAX_MESSAGES)
  const lines = recent.map((m) => {
    const name =
      getParticipantName(m.participantId, participantCharacters, participants) ||
      (String(m.role).toUpperCase() === 'USER' ? 'User' : 'Character')
    return `${name}: ${m.content.trim()}`
  })

  let transcript = lines.join('\n\n')
  if (transcript.length > RECENT_CONTEXT_CHAR_BUDGET) {
    // Keep the most-recent turns (the moment being replied to) — drop oldest.
    transcript = transcript.slice(transcript.length - RECENT_CONTEXT_CHAR_BUDGET)
    transcript = `[…earlier conversation truncated…]\n${transcript}`
  }
  return transcript
}

const CONSISTENCY_SYSTEM_PROMPT = `You are a consistency checker. You are given (A) reference information a character was working from this turn — their recalled memories and the results of any lookups/searches/document reads they performed — and (B) the reply they are about to send. Decide whether the reply is consistent with the reference information: it must not contradict it, invent facts that conflict with it, or misstate what the lookups returned. The reply may add in-character color, tone, or opinion not present in the reference — that is fine and not an inconsistency. Only flag genuine factual contradictions or misrepresentations of the reference. Respond with strict JSON: {"consistent": boolean, "discrepancies": string}. When consistent, discrepancies is "". When not, discrepancies briefly lists each contradiction in plain language.`

function buildReaffirmationSystemPrompt(characterName?: string): string {
  const you = characterName ? `You are ${characterName}. ` : ''
  return `${you}You are reconsidering a reply you just drafted, in your own voice, at this exact point in the conversation shown below, before it is sent. Some of what you wrote appears to conflict with what you recalled or looked up this turn.

Stay in the current scene. If you correct the reply, it must still answer the same person about the same thing at this same moment — same addressee, tone, and flow — changing ONLY the specific details that conflict with the facts. Do NOT rewrite it from scratch, do NOT restart the exchange, and do NOT respond to some earlier or different conversation. The recalled/looked-up material is your own background knowledge for this turn, not the conversation you are in — it may even quote a different, older exchange, which you must not slip into.

Respond ONLY with strict JSON.`
}

interface ConsistencyVerdict {
  consistent: boolean
  discrepancies: string
}

interface ReaffirmationVerdict {
  revise: boolean
  reply?: string
}

function parseConsistencyVerdict(content: string): ConsistencyVerdict {
  const obj = parseLLMJsonObject<Record<string, unknown>>(content)
  if (typeof obj.consistent !== 'boolean') {
    throw new Error('consistency verdict missing boolean "consistent"')
  }
  return {
    consistent: obj.consistent,
    discrepancies: typeof obj.discrepancies === 'string' ? obj.discrepancies : '',
  }
}

function parseReaffirmationVerdict(content: string): ReaffirmationVerdict {
  const obj = parseLLMJsonObject<Record<string, unknown>>(content)
  if (typeof obj.revise !== 'boolean') {
    throw new Error('re-affirmation verdict missing boolean "revise"')
  }
  return {
    revise: obj.revise,
    reply: typeof obj.reply === 'string' ? obj.reply : undefined,
  }
}

/**
 * The resolved outcome the finalizer applies to the persisted message.
 * `confirmed === undefined` never occurs here — the finalizer only calls this
 * when the feature is active and there are checkable inputs.
 */
export interface AnswerConfirmationOutcome {
  confirmed: boolean | null
  revised: boolean
  notes: string | null
  /** Present only when `revised` — the replacement reply text. */
  revisedContent: string | null
}

export interface RunAnswerConfirmationOptions {
  reply: string
  reference: string
  userId: string
  chatId: string
  messageId?: string
  characterId?: string
  /** Display name of the replying character, used to anchor the re-affirmation. */
  characterName?: string
  /**
   * Compact transcript of the recent live conversation (from
   * `buildRecentConversationContext`). Anchors the re-affirmation rewrite to the
   * current scene; only used on the re-affirmation pass. Optional/null when
   * there is no prior dialogue.
   */
  conversationContext?: string | null
  /** Already-resolved cheap-LLM selection (compression.cheapLLMSelection). */
  cheapLLMSelection: CheapLLMSelection | null
  /** The character's own model, used verbatim for the re-affirmation pass. */
  connectionProfile: ConnectionProfile
  isDangerousChat: boolean
  uncensoredFallback?: UncensoredFallbackOptions
  /** Emitted just before the re-affirmation pass (only when a rewrite is invited). */
  onAffirming?: () => void
}

/**
 * Run the consistency check and, if needed, the re-affirmation pass. Never
 * throws — any failure resolves to `confirmed:null`.
 */
export async function runAnswerConfirmation(
  opts: RunAnswerConfirmationOptions,
): Promise<AnswerConfirmationOutcome> {
  const {
    reply, reference, userId, chatId, messageId, characterId, characterName, conversationContext,
    cheapLLMSelection, connectionProfile, isDangerousChat, uncensoredFallback, onAffirming,
  } = opts

  if (!cheapLLMSelection) {
    logger.debug('Answer confirmation skipped: no cheap-LLM selection available', { chatId })
    return { confirmed: null, revised: false, notes: null, revisedContent: null }
  }

  // Upgrade to the uncensored cheap profile iff the Concierge flagged this chat.
  const selection = resolveUncensoredCheapLLMSelection(
    cheapLLMSelection,
    isDangerousChat,
    uncensoredFallback?.dangerSettings,
    uncensoredFallback?.availableProfiles ?? [],
  )

  const checkMessages: LLMMessage[] = [
    { role: 'system', content: CONSISTENCY_SYSTEM_PROMPT },
    { role: 'user', content: `--- REFERENCE INFORMATION ---\n${reference}\n\n--- REPLY TO CHECK ---\n${reply}` },
  ]

  let check: CheapLLMTaskResult<ConsistencyVerdict>
  try {
    check = await withTimeout(
      executeCheapLLMTask<ConsistencyVerdict>(
        selection,
        checkMessages,
        userId,
        parseConsistencyVerdict,
        'answer-confirmation',
        chatId,
        messageId,
        uncensoredFallback,
        512,
        characterId,
      ),
      CONSISTENCY_CHECK_TIMEOUT_MS,
      `answer-confirmation check timed out after ${CONSISTENCY_CHECK_TIMEOUT_MS}ms`,
    )
  } catch (error) {
    logger.warn('Answer confirmation check failed/timed out; marking unverified', {
      chatId, error: error instanceof Error ? error.message : String(error),
    })
    return { confirmed: null, revised: false, notes: null, revisedContent: null }
  }

  if (!check.success || !check.result) {
    logger.warn('Answer confirmation check errored; marking unverified', { chatId, error: check.error })
    return { confirmed: null, revised: false, notes: null, revisedContent: null }
  }

  if (check.result.consistent) {
    return { confirmed: true, revised: false, notes: null, revisedContent: null }
  }

  const discrepancies = check.result.discrepancies || 'The reply appears inconsistent with the reference information.'
  logger.info('Answer confirmation: inconsistency flagged, requesting affirmation', { chatId })
  onAffirming?.()

  // Re-affirmation: the character's OWN model, given the discrepancies, chooses
  // to stand by the reply or rewrite it. Reuse the cheap-task harness with a
  // selection built from the character's connection profile (handles provider
  // creation, API-key resolution, and LLM logging).
  const reaffSelection = selectionFromProfile(connectionProfile)

  const reaffParts: string[] = []
  if (conversationContext && conversationContext.trim().length > 0) {
    reaffParts.push(
      '=== The conversation so far (this is the scene you are in) ===',
      conversationContext,
      '',
    )
  }
  reaffParts.push(
    '=== Your draft reply — the next thing you were about to say ===',
    '"""',
    reply,
    '"""',
    '',
    'A consistency check flagged these apparent conflicts with what you recalled or looked up this turn:',
    discrepancies,
    '',
    '=== What you actually recalled and looked up this turn (your background knowledge — NOT the conversation) ===',
    reference,
    '',
    'If, on reflection, you stand by your draft exactly as written, respond with strict JSON {"revise": false}. If you want to correct it, respond with {"revise": true, "reply": "<your corrected reply>"}. The corrected reply replaces your draft, so write it in full and in your own voice — but it must fit this exact point in the conversation above: reply to the same person about the same thing, in the same moment, and change only what conflicts with the facts. Do not start over or answer a different or earlier conversation.',
  )
  const reaffUser = reaffParts.join('\n')

  const reaffMessages: LLMMessage[] = [
    { role: 'system', content: buildReaffirmationSystemPrompt(characterName) },
    { role: 'user', content: reaffUser },
  ]

  let reaff: CheapLLMTaskResult<ReaffirmationVerdict>
  try {
    reaff = await withTimeout(
      executeCheapLLMTask<ReaffirmationVerdict>(
        reaffSelection,
        reaffMessages,
        userId,
        parseReaffirmationVerdict,
        'answer-reaffirmation',
        chatId,
        messageId,
        undefined,
        4096,
        characterId,
      ),
      REAFFIRMATION_TIMEOUT_MS,
      `answer-reaffirmation timed out after ${REAFFIRMATION_TIMEOUT_MS}ms`,
    )
  } catch (error) {
    logger.warn('Answer re-affirmation failed/timed out; marking unverified', {
      chatId, error: error instanceof Error ? error.message : String(error),
    })
    return { confirmed: null, revised: false, notes: discrepancies, revisedContent: null }
  }

  if (!reaff.success || !reaff.result) {
    logger.warn('Answer re-affirmation errored; marking unverified', { chatId, error: reaff.error })
    return { confirmed: null, revised: false, notes: discrepancies, revisedContent: null }
  }

  if (reaff.result.revise && reaff.result.reply && reaff.result.reply.trim().length > 0) {
    logger.info('Answer confirmation: character revised the reply', { chatId })
    return { confirmed: true, revised: true, notes: discrepancies, revisedContent: reaff.result.reply }
  }

  if (reaff.result.revise) {
    // Wanted to revise but gave no usable text — don't gamble on a broken rewrite.
    logger.warn('Answer re-affirmation requested revision without text; marking unverified', { chatId })
    return { confirmed: null, revised: false, notes: discrepancies, revisedContent: null }
  }

  logger.info('Answer confirmation: character stood by the flagged reply', { chatId })
  return { confirmed: false, revised: false, notes: discrepancies, revisedContent: null }
}

// ---------------------------------------------------------------------------
// Per-turn gate: everything between "the reply is clean" and "persist it"
// ---------------------------------------------------------------------------

export interface MaybeConfirmAnswerOptions {
  repos: Pick<ReturnType<typeof getRepositories>, 'projects' | 'chats'>
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string; status?: string }
  /** The cleaned reply about to be persisted. */
  reply: string
  /** The id the reply will be stored under (for LLM-log correlation). */
  messageId: string
  toolMessages: ToolMessage[]
  participantCharacters: Map<string, Character>
  /** `chatSettings.answerConfirmationSettings.enabled` — the global default. */
  globalEnabled: boolean
  cheapLLMSelection: CheapLLMSelection | null
  connectionProfile: ConnectionProfile
  dangerSettings: DangerousContentSettings
  allProfiles: ConnectionProfile[]
  /** Emitted once the check is actually going to run. */
  onConfirming?: () => void
  /** Emitted just before the re-affirmation pass (only when a rewrite is invited). */
  onAffirming?: () => void
}

/**
 * What the finalizer records on the message:
 * - `null` — the feature is off / nothing to check; every column stays unset.
 * - `{ confirmed: null }` alone — a user-driven turn: the system can neither
 *   confirm nor deny, and only the `confirmed` column is set.
 * - a full {@link AnswerConfirmationOutcome} — the check ran.
 */
export type MaybeConfirmAnswerResult =
  | AnswerConfirmationOutcome
  | Pick<AnswerConfirmationOutcome, 'confirmed'>
  | null

/**
 * Decide whether this turn's reply needs vetting and, if so, vet it. Wraps the
 * gates (user-driven turn, silent turn, chat/project/global override, checkable
 * inputs) around {@link runAnswerConfirmation}. Never throws on the check
 * itself; the finalizer applies whatever comes back.
 */
export async function maybeConfirmAnswer(opts: MaybeConfirmAnswerOptions): Promise<MaybeConfirmAnswerResult> {
  const {
    repos, chatId, userId, chat, character, characterParticipant, reply, messageId, toolMessages,
    participantCharacters, globalEnabled, cheapLLMSelection, connectionProfile, dangerSettings,
    allProfiles, onConfirming, onAffirming,
  } = opts

  if (isUserDrivenTurn(chat, characterParticipant.id)) {
    // A user-controlled/impersonated turn: the human may have sourced facts out
    // of band, so the system can neither confirm nor deny. Explicit null (≠ the
    // undefined "feature off" state).
    logger.debug('Answer confirmation: user-driven turn, marking unverifiable', { chatId })
    return { confirmed: null }
  }
  if (characterParticipant.status === 'silent') return null

  const chatOverride = chat.answerConfirmationOverride as AnswerConfirmationOverride
  let projectOverride: AnswerConfirmationOverride
  if (!chatOverride && chat.projectId) {
    const project = await repos.projects.findById(chat.projectId).catch(() => null)
    projectOverride = (project?.answerConfirmationOverride as AnswerConfirmationOverride) ?? undefined
  }
  if (!isAnswerConfirmationActive(chatOverride, projectOverride, globalEnabled)) return null

  const priorMessages = await repos.chats.getMessages(chatId)
  const priorEvents = priorMessages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[]
  const whisper = findLatestCommonplaceWhisper(priorEvents, characterParticipant.id)
  if (!hasCheckableInputs(whisper, toolMessages)) return null
  const reference = gatherConfirmationInputs(whisper, toolMessages)
  if (!reference) return null

  // Recent live conversation, so any re-affirmation rewrite stays anchored to
  // THIS scene instead of drifting into an old conversation the reference
  // material may quote.
  const conversationContext = buildRecentConversationContext(
    priorEvents,
    chat.participants ?? [],
    participantCharacters,
  )
  onConfirming?.()
  const isDangerousChat = shouldUseUncensoredRoute(chat)
  return runAnswerConfirmation({
    reply,
    reference,
    userId,
    chatId,
    messageId,
    characterId: character.id,
    characterName: character.name,
    conversationContext,
    cheapLLMSelection,
    connectionProfile,
    isDangerousChat,
    uncensoredFallback: {
      dangerSettings,
      availableProfiles: allProfiles,
      isDangerousChat,
    },
    onAffirming,
  })
}
