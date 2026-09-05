/**
 * Title-verdict parsing for the two title-consideration cheap-LLM tasks.
 *
 * Both `considerTitleUpdate` and `considerHelpChatTitleUpdate` ask a cheap
 * model the same question and get back the same JSON object. Parsing it is one
 * job, so it lives in one place.
 *
 * The tolerance here is load-bearing, not decorative. Bug 96: a cheap model
 * answered `needsNewTitle: true` with the title under `suggestTitle` — two
 * letters short of the key the prompt asked for. Reading the canonical key
 * alone yielded `undefined`, the caller read that as "no rename wanted", and
 * the chat kept its generic title while the story background that hangs off a
 * successful rename never queued. A one-key typo should not be a silent no.
 *
 * @module memory/cheap-llm-tasks/title-verdict
 */

import { stripCodeFences } from '@/lib/llm/llm-json'
import { logger } from '@/lib/logger'

/** The verdict shape both title tasks resolve to. */
export interface TitleVerdict {
  needsNewTitle: boolean
  reason: string
  suggestedTitle: string | null
}

/** Longest title we will store; longer ones are truncated with an ellipsis. */
export const MAX_TITLE_LENGTH = 60

/**
 * Keys a model might put the title under, canonical first.
 *
 * Kept to near-misses of the asked-for key plus the obvious plain synonyms —
 * every entry has to be unambiguously "the new title" in a response object
 * whose only subject is the new title. Matching is also tried case- and
 * separator-insensitively (see `readTitleKey`), which is what catches
 * `suggested_title` and friends without listing each casing by hand.
 */
const TITLE_KEYS = [
  'suggestedTitle',
  'suggestTitle',
  'newTitle',
  'proposedTitle',
  'title',
] as const

/** `Suggested_Title` / `suggested-title` / `SUGGESTEDTITLE` all fold to `suggestedtitle`. */
function foldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Pull the title out of a parsed response object, tolerating near-miss keys.
 *
 * Returns the raw value plus the key it came from, so the caller can report a
 * non-canonical read rather than absorbing it silently.
 */
function readTitleKey(parsed: Record<string, unknown>): { value: unknown; key: string } | null {
  for (const key of TITLE_KEYS) {
    if (parsed[key] !== undefined && parsed[key] !== null) {
      return { value: parsed[key], key }
    }
  }

  // Second pass: fold both sides, so casing and separators stop mattering.
  const folded = new Map<string, string>()
  for (const actualKey of Object.keys(parsed)) {
    const f = foldKey(actualKey)
    if (!folded.has(f)) folded.set(f, actualKey)
  }
  for (const key of TITLE_KEYS) {
    const actualKey = folded.get(foldKey(key))
    if (actualKey !== undefined && parsed[actualKey] !== undefined && parsed[actualKey] !== null) {
      return { value: parsed[actualKey], key: actualKey }
    }
  }

  return null
}

/**
 * Trim, strip a wrapping quote pair, and cap the length.
 *
 * Shared by the title-generation tasks in `chat-tasks.ts` and by
 * `normalizeTitle` below. Returns `''` when nothing survives the cleanup.
 */
export function cleanTitle(raw: string, maxLength: number = MAX_TITLE_LENGTH): string {
  const cleaned = raw.trim().replace(/^["']/, '').replace(/["']$/, '').trim()
  if (!cleaned) {
    return ''
  }
  return cleaned.length > maxLength
    ? cleaned.substring(0, maxLength - 3) + '...'
    : cleaned
}

/** Trim, strip a wrapping quote pair, and cap the length. */
function normalizeTitle(raw: string): string | null {
  return cleanTitle(raw) || null
}

/**
 * Parse a title-consideration response into a verdict.
 *
 * Never throws: an unparseable response resolves to "no new title", which is
 * the safe direction — the chat keeps the title it has.
 *
 * @param content - Raw model output, code fences and all
 * @param taskLabel - Which task is asking, for log lines
 * @param chatId - Chat under consideration, for log lines
 */
export function parseTitleVerdict(
  content: string,
  taskLabel: string,
  chatId?: string,
): TitleVerdict {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFences(content))
  } catch {
    logger.warn('[Title Verdict] Response was not JSON — keeping the current title', {
      context: 'cheap-llm-tasks.title-verdict',
      taskLabel,
      chatId,
      contentPreview: content.slice(0, 200),
    })
    return { needsNewTitle: false, reason: 'Failed to parse response', suggestedTitle: null }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.warn('[Title Verdict] Response JSON was not an object — keeping the current title', {
      context: 'cheap-llm-tasks.title-verdict',
      taskLabel,
      chatId,
    })
    return { needsNewTitle: false, reason: 'Failed to parse response', suggestedTitle: null }
  }

  const record = parsed as Record<string, unknown>
  const needsNewTitle = record.needsNewTitle === true
  const reason = typeof record.reason === 'string' && record.reason.trim()
    ? record.reason
    : 'No reason provided'

  const found = readTitleKey(record)
  let suggestedTitle: string | null = null

  if (found && typeof found.value === 'string') {
    suggestedTitle = normalizeTitle(found.value)
    if (suggestedTitle && found.key !== 'suggestedTitle') {
      logger.warn('[Title Verdict] Title arrived under a non-canonical key', {
        context: 'cheap-llm-tasks.title-verdict',
        taskLabel,
        chatId,
        actualKey: found.key,
        expectedKey: 'suggestedTitle',
      })
    }
  }

  // The case bug 96 turned on: the model asked for a rename and we cannot find
  // the title it meant. Say so — this used to pass for a quiet "no".
  if (needsNewTitle && !suggestedTitle) {
    logger.warn('[Title Verdict] Model asked for a rename but supplied no usable title', {
      context: 'cheap-llm-tasks.title-verdict',
      taskLabel,
      chatId,
      responseKeys: Object.keys(record),
    })
  }

  return { needsNewTitle, reason, suggestedTitle }
}
