import type { Message } from './types'

/**
 * Parse the JSON content of a TOOL message and read its `initiatedBy` field.
 * Returns `undefined` when the content can't be parsed or the field is absent.
 * User-initiated runs (Run Tool modal, composer-attached results) carry
 * `initiatedBy: 'user'`; character-initiated tool results omit it.
 */
export function readInitiatedBy(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { initiatedBy?: unknown }
    return typeof parsed.initiatedBy === 'string' ? parsed.initiatedBy : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether an assistant row is a real character turn that can host nested tool
 * calls. Excludes Staff-authored announcements (systemSender), ad-hoc
 * announcer bubbles (customAnnouncer), and Courier placeholders awaiting a
 * pasted reply (pendingExternalPrompt) — none of those "call" tools.
 */
function isCharacterAssistant(message: Message): boolean {
  return (
    message.role === 'ASSISTANT' &&
    !message.systemSender &&
    !message.customAnnouncer &&
    !message.pendingExternalPrompt
  )
}

/**
 * Whether a TOOL row is a character-initiated tool call that should nest into
 * the character's message. User-initiated runs (Prospero / Run Tool modal /
 * composer-attached results) stay standalone, so they are excluded here.
 */
function isCharacterToolMessage(message: Message): boolean {
  if (message.role !== 'TOOL') return false
  if (message.systemSender) return false
  if (readInitiatedBy(message.content) === 'user') return false
  return true
}

/**
 * Resolve the message whose avatar and name should head a standalone TOOL row.
 *
 * A TOOL row that already knows its author (a Staff `systemSender`, or its own
 * `participantId`) heads itself. Otherwise:
 *  - A **user-initiated** run (composer / Run Tool modal, `initiatedBy: 'user'`)
 *    is the operator's action, so it is resolved as a USER row and wears the
 *    operator's face. The pending TOOL result is persisted *before* the user's
 *    own message, so the positional borrow below would otherwise hand it
 *    whoever spoke last — an unrelated character (Bug 29).
 *  - A **character-initiated** run borrows the nearest preceding assistant's
 *    participant, stopping at a USER boundary — that assistant is the character
 *    that called the tool. Historical rows persisted before attribution existed
 *    are identifiable by position only, and this heuristic is correct for them.
 *
 * Purely a rendering transform — the returned object is a shallow copy or the
 * original by reference; the underlying message is never mutated.
 */
export function resolveToolRowAttributionMessage(
  message: Message,
  messageIndex: number,
  messages: Message[],
): Message {
  if (message.systemSender || message.participantId) return message

  if (readInitiatedBy(message.content) === 'user') {
    return { ...message, role: 'USER', participantId: null }
  }

  for (let k = messageIndex - 1; k >= 0; k--) {
    const prev = messages[k]
    if (prev.role === 'ASSISTANT' && prev.participantId) {
      return { ...message, participantId: prev.participantId }
    }
    if (prev.role === 'USER') break
  }
  return message
}

/**
 * Fold character-initiated TOOL rows into the nearest preceding character
 * assistant message for rendering. The persistence model writes one assistant
 * message per turn (the accumulated prose) immediately followed by its tool
 * result rows, so the nearest preceding assistant is always the bubble that
 * holds that character's words.
 *
 * Behavior:
 * - Character tool results are attached to `attachedToolMessages` on a
 *   shallow-cloned copy of the host assistant message and removed from the
 *   flat list.
 * - User/Prospero/orphan tool rows (and tool rows with no preceding character
 *   assistant in the current turn) pass through as standalone entries.
 * - Non-tool rows and assistant rows without attached tools pass through by
 *   reference, so `MessageRow`'s memo stays stable for untouched messages.
 *
 * Purely a rendering transform — the underlying messages are untouched.
 */
export function groupToolMessagesIntoAssistants(visible: Message[]): Message[] {
  const result: Message[] = []
  // Index into `result` of the current turn's host character-assistant entry,
  // or -1 when the current turn has no host (e.g. right after a USER message).
  let hostIndex = -1

  for (const message of visible) {
    if (message.role === 'USER') {
      // A user message ends the previous turn; tool rows after it belong to a
      // new turn and must not attach backwards across the boundary.
      hostIndex = -1
      result.push(message)
      continue
    }

    if (hostIndex >= 0 && isCharacterToolMessage(message)) {
      const host = result[hostIndex]
      // Clone the host on first attach so the source message is never mutated.
      if (!host.attachedToolMessages) {
        result[hostIndex] = { ...host, attachedToolMessages: [message] }
      } else {
        host.attachedToolMessages.push(message)
      }
      continue
    }

    if (isCharacterAssistant(message)) {
      hostIndex = result.length
    }
    result.push(message)
  }

  return result
}
