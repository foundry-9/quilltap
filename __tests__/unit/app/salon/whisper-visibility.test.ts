import {
  isMessageVisibleToOperator,
  isOperatorAuthoredAnnouncement,
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

  it.each(['pascal', 'prospero'] as const)(
    'shows %s private runs even when the toggle is off — they are operator machinery',
    sender => {
      const run = message({
        systemSender: sender,
        participantId: null,
        targetParticipantIds: [CHARACTER_A],
      })
      expect(isMessageVisibleToOperator(run, audience(false))).toBe(true)
    },
  )

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
