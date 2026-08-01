import type { Message } from './types'

type SystemSender = NonNullable<Message['systemSender']>

/**
 * Staff whose whispers render for the human operator even when "All Whispers"
 * is off.
 *
 * The distinction is scene content vs. operator machinery. Pascal's private
 * rolls and Prospero's private tool runs are the table's mechanics: they are
 * whispered so the *characters* can't see them, and the person running the
 * table is the audience they exist for. Everything else a Staff member
 * whispers — the Commonplace Book's recall, Carina's answers to a character,
 * the Librarian, the Host — is addressed to a character as part of the scene,
 * and stays behind the toggle like any other whisper the human isn't party to.
 *
 * Keep this narrow. A blanket `systemSender` exemption is what leaked the
 * Commonplace Book's recall whispers into the flow.
 */
export const OPERATOR_FACING_WHISPER_SENDERS: ReadonlySet<SystemSender> = new Set<SystemSender>([
  'pascal',
  'prospero',
])

/**
 * Whether a message is an ad-hoc announcement the operator wrote themselves
 * (Insert Announcement composer). `systemKind: 'announcement'` is set by
 * exactly one writer — `lib/services/announcer/writer.ts` — so it is the
 * marker for "the human at the keyboard authored this", whichever Staff member
 * or invented name it wears.
 *
 * These are never hidden and never dimmed. A whispered announcement has no
 * `participantId` to match the author against, so without this it would vanish
 * the instant the operator posted it: they'd type a private aside, send it, and
 * watch nothing appear.
 */
export function isOperatorAuthoredAnnouncement(
  msg: Pick<Message, 'systemKind'>,
): boolean {
  return msg.systemKind === 'announcement'
}

interface WhisperAudience {
  /** The "All Whispers" toggle: when on, nothing is filtered. */
  showAllWhispers: boolean
  /** Participant ids the human controls — they see their own whispers either way. */
  userParticipantIds: ReadonlySet<string>
}

/**
 * Whether a message belongs in the human's rendered flow.
 *
 * This governs display only. What each character can see is decided
 * server-side from `targetParticipantIds` when their context is built — a
 * message shown here was never added to anyone's context by being shown.
 */
export function isMessageVisibleToOperator(
  msg: Pick<Message, 'systemSender' | 'systemKind' | 'participantId' | 'targetParticipantIds'>,
  { showAllWhispers, userParticipantIds }: WhisperAudience,
): boolean {
  // Not a whisper at all — public scene content.
  if (!msg.targetParticipantIds || msg.targetParticipantIds.length === 0) return true

  if (showAllWhispers) return true

  // The operator's own aside, whoever it is signed by.
  if (isOperatorAuthoredAnnouncement(msg)) return true

  if (msg.systemSender && OPERATOR_FACING_WHISPER_SENDERS.has(msg.systemSender)) return true

  // The human is the whisper's author or one of its targets.
  if (msg.participantId && userParticipantIds.has(msg.participantId)) return true
  if (msg.targetParticipantIds.some(id => userParticipantIds.has(id))) return true

  return false
}
