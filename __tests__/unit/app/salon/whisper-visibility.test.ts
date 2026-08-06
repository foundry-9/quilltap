import {
  isMessageVisibleToOperator,
  isOperatorAuthoredAnnouncement,
  resolveWhisperTargetLabel,
} from '@/app/salon/[id]/whisper-visibility'
import type { Message } from '@/app/salon/[id]/types'

const USER_PARTICIPANT = 'user-participant-id'
const CHARACTER_A = 'character-a-id'
const CHARACTER_B = 'character-b-id'

const audience = (showAllWhispers: boolean) => ({
  showAllWhispers,
  userParticipantIds: new Set([USER_PARTICIPANT]),
})

type FilterInput = Pick<
  Message,
  'systemSender' | 'systemKind' | 'participantId' | 'targetParticipantIds'
>

const message = (overrides: Partial<FilterInput> = {}): FilterInput => ({
  systemSender: null,
  systemKind: null,
  participantId: CHARACTER_A,
  targetParticipantIds: null,
  ...overrides,
})

describe('isMessageVisibleToOperator', () => {
  it('shows public messages whatever the toggle says', () => {
    expect(isMessageVisibleToOperator(message(), audience(false))).toBe(true)
    expect(
      isMessageVisibleToOperator(message({ targetParticipantIds: [] }), audience(false)),
    ).toBe(true)
  })

  it('shows every whisper when "All Whispers" is on', () => {
    const whisper = message({
      systemSender: 'commonplaceBook',
      targetParticipantIds: [CHARACTER_A],
    })
    expect(isMessageVisibleToOperator(whisper, audience(true))).toBe(true)
  })

  it('hides Commonplace Book recall whispers to a character when the toggle is off', () => {
    const recall = message({
      systemSender: 'commonplaceBook',
      participantId: null,
      targetParticipantIds: [CHARACTER_A],
    })
    expect(isMessageVisibleToOperator(recall, audience(false))).toBe(false)
  })

  it.each(['carina', 'librarian', 'host'] as const)(
    'hides %s whispers to a character when the toggle is off',
    sender => {
      const whisper = message({
        systemSender: sender,
        participantId: null,
        targetParticipantIds: [CHARACTER_A],
      })
      expect(isMessageVisibleToOperator(whisper, audience(false))).toBe(false)
    },
  )

  it.each([
    ['pascal', 'custom-tool-result'],
    ['prospero', 'tool-run'],
    ['prospero', 'custom-tool-error'],
    ['prospero', 'carina-error'],
  ] as const)(
    'shows %s/%s even when the toggle is off — that is operator machinery',
    (sender, kind) => {
      const run = message({
        systemSender: sender,
        systemKind: kind,
        participantId: null,
        targetParticipantIds: [CHARACTER_A],
      })
      expect(isMessageVisibleToOperator(run, audience(false))).toBe(true)
    },
  )

  it('hides Prospero group-context whispers — scene machinery addressed to a character', () => {
    // Prospero telling ONE character which group shelves they may read. Exempting
    // Prospero by sender leaked these, and they are the highest-volume whisper
    // in the app, so the leak was not subtle.
    const groupContext = message({
      systemSender: 'prospero',
      systemKind: 'group-context',
      participantId: null,
      targetParticipantIds: [CHARACTER_A],
    })
    expect(isMessageVisibleToOperator(groupContext, audience(false))).toBe(false)
    expect(isMessageVisibleToOperator(groupContext, audience(true))).toBe(true)
  })

  it('still shows a group-context whisper addressed to the human', () => {
    const toUser = message({
      systemSender: 'prospero',
      systemKind: 'group-context',
      participantId: null,
      targetParticipantIds: [USER_PARTICIPANT],
    })
    expect(isMessageVisibleToOperator(toUser, audience(false))).toBe(true)
  })

  it('keeps sender-level behaviour for legacy rows with no stored kind', () => {
    const legacy = message({
      systemSender: 'pascal',
      systemKind: null,
      participantId: null,
      targetParticipantIds: [CHARACTER_A],
    })
    expect(isMessageVisibleToOperator(legacy, audience(false))).toBe(true)
  })

  it('shows Staff whispers addressed to the human regardless of sender', () => {
    const toUser = message({
      systemSender: 'commonplaceBook',
      participantId: null,
      targetParticipantIds: [USER_PARTICIPANT],
    })
    expect(isMessageVisibleToOperator(toUser, audience(false))).toBe(true)
  })

  it('shows whispers the human authored, and hides character-to-character ones', () => {
    const fromUser = message({
      participantId: USER_PARTICIPANT,
      targetParticipantIds: [CHARACTER_A],
    })
    const betweenCharacters = message({
      participantId: CHARACTER_A,
      targetParticipantIds: [CHARACTER_B],
    })
    expect(isMessageVisibleToOperator(fromUser, audience(false))).toBe(true)
    expect(isMessageVisibleToOperator(betweenCharacters, audience(false))).toBe(false)
  })

  it.each(['host', 'librarian', 'commonplaceBook'] as const)(
    'shows a whispered ad-hoc announcement signed by %s — the operator wrote it',
    sender => {
      const ownAside = message({
        systemSender: sender,
        systemKind: 'announcement',
        participantId: null,
        targetParticipantIds: [CHARACTER_A],
      })
      expect(isMessageVisibleToOperator(ownAside, audience(false))).toBe(true)
    },
  )

  it('shows a whispered announcement posted under a custom name (no systemSender)', () => {
    const narrator = message({
      systemSender: null,
      systemKind: 'announcement',
      participantId: null,
      targetParticipantIds: [CHARACTER_B],
    })
    expect(isMessageVisibleToOperator(narrator, audience(false))).toBe(true)
  })
})

describe('isOperatorAuthoredAnnouncement', () => {
  it('recognizes only the ad-hoc announcer kind', () => {
    expect(isOperatorAuthoredAnnouncement({ systemKind: 'announcement' })).toBe(true)
    expect(isOperatorAuthoredAnnouncement({ systemKind: 'memory-recap' })).toBe(false)
    expect(isOperatorAuthoredAnnouncement({ systemKind: null })).toBe(false)
  })
})

describe('resolveWhisperTargetLabel', () => {
  const OPERATOR = 'operator-user-id'
  const NAMES = { [CHARACTER_A]: 'Ariel', [CHARACTER_B]: 'Prospero' }

  it('resolves the operator\'s own userId to "you" (Bug 30)', () => {
    // A private user-initiated run whispers to the operator's userId, which is
    // never a participant id — without this it read "whispered to unknown".
    expect(resolveWhisperTargetLabel(OPERATOR, NAMES, OPERATOR)).toBe('you')
    expect(resolveWhisperTargetLabel(OPERATOR, {}, OPERATOR)).toBe('you')
  })

  it('resolves a participant id to its display name', () => {
    expect(resolveWhisperTargetLabel(CHARACTER_A, NAMES, OPERATOR)).toBe('Ariel')
  })

  it('keeps the "unknown" fallback for an id that is neither operator nor participant', () => {
    expect(resolveWhisperTargetLabel('stranger', NAMES, OPERATOR)).toBe('unknown')
    // No operator id known: a self-targeted whisper still falls back, unchanged.
    expect(resolveWhisperTargetLabel(OPERATOR, NAMES, null)).toBe('unknown')
  })
})
