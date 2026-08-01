import type { Message } from './types'

type SystemSender = NonNullable<Message['systemSender']>

/**
 * Staff whispers that render for the human operator even when "All Whispers"
 * is off, keyed by sender *and* `systemKind`.
 *
 * The distinction is scene content vs. operator machinery. A private roll, a
 * private Run Tool result, and the errors belonging to each are the table's
 * mechanics: they are whispered so the *characters* can't see them, and the
 * person running the table is the audience they exist for. Everything else a
 * Staff member whispers — the Commonplace Book's recall, Carina's answers to a
 * character, the Librarian, the Host — is addressed to a character as part of
 * the scene, and stays behind the toggle like any other whisper the human isn't
 * party to.
 *
 * Keep this narrow, and keep it keyed on the kind. A blanket `systemSender`
 * exemption once leaked the Commonplace Book's recall whispers into the flow;
 * narrowing it to a *sender* still leaked Prospero's `group-context` whispers,
 * which are him telling one character which group shelves they may read —
 * scene machinery addressed to a character, and the highest-volume whisper in
 * the app. Sender alone has now been the wrong granularity twice.
 */
export const OPERATOR_FACING_WHISPER_KINDS: ReadonlyMap<SystemSender, ReadonlySet<string>> =
  new Map<SystemSender, ReadonlySet<string>>([
    // The roll itself.
    ['pascal', new Set(['custom-tool-result'])],
    // A private Run Tool result, and the two failure notices Prospero authors
    // on behalf of other subsystems — an error the operator cannot see is an
    // error they cannot act on.
    ['prospero', new Set(['tool-run', 'custom-tool-error', 'carina-error'])],
  ])

/** Whether this Staff whisper is operator machinery rather than scene content. */
function isOperatorFacingStaffWhisper(
  msg: Pick<Message, 'systemSender' | 'systemKind'>,
): boolean {
  if (!msg.systemSender) return false
  const kinds = OPERATOR_FACING_WHISPER_KINDS.get(msg.systemSender)
  if (!kinds) return false
  // A legacy row with no stored kind keeps the old sender-level behaviour
  // rather than vanishing from a view the operator is used to.
  if (!msg.systemKind) return true
  return kinds.has(msg.systemKind)
}

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

  if (isOperatorFacingStaffWhisper(msg)) return true

  // The human is the whisper's author or one of its targets.
  if (msg.participantId && userParticipantIds.has(msg.participantId)) return true
  if (msg.targetParticipantIds.some(id => userParticipantIds.has(id))) return true

  return false
}
