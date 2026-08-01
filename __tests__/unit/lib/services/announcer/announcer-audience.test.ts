/**
 * Whispered ad-hoc announcements (Insert Announcement composer).
 *
 * Two things are load-bearing here and both are about the same failure: a
 * whisper aimed at nobody. `resolveAnnouncementAudience` refuses ids that are
 * not live participants of the chat, and `postAdhocAnnouncement` collapses an
 * empty audience to NULL rather than storing `[]` — a stored empty array reads
 * as "whispered to no one", which every downstream visibility check would treat
 * as public anyway, but only by accident.
 */

import {
  postAdhocAnnouncement,
  type AnnouncerSender,
} from '@/lib/services/announcer/writer'
import { resolveAnnouncementAudience } from '@/lib/services/announcer/audience'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const ALICE_PARTICIPANT = '22222222-2222-4222-8222-222222222222'
const BOB_PARTICIPANT = '33333333-3333-4333-8333-333333333333'
const GONE_PARTICIPANT = '44444444-4444-4444-8444-444444444444'
const STRANGER_PARTICIPANT = '55555555-5555-4555-8555-555555555555'

const STAFF_SENDER: AnnouncerSender = { kind: 'staff', staffId: 'host' }

const addMessage = jest.fn()

/** A chat with Alice and Bob present and one participant already removed. */
function mockChat() {
  const characters: Record<string, string> = {
    'char-alice': 'Alice',
    'char-bob': 'Bob',
    'char-gone': 'Gone',
  }
  addMessage.mockReset()
  addMessage.mockResolvedValue(undefined)
  getRepositories.mockReturnValue({
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: CHAT_ID,
        participants: [
          { id: ALICE_PARTICIPANT, characterId: 'char-alice', status: 'active', removedAt: null },
          { id: BOB_PARTICIPANT, characterId: 'char-bob', status: 'silent', removedAt: null },
          {
            id: GONE_PARTICIPANT,
            characterId: 'char-gone',
            status: 'removed',
            removedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      addMessage,
    },
    characters: {
      findById: jest.fn().mockImplementation(async (id: string) =>
        characters[id] ? { id, name: characters[id] } : null,
      ),
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockChat()
})

describe('resolveAnnouncementAudience', () => {
  it('treats an omitted or empty audience as public', async () => {
    for (const requested of [undefined, null, []]) {
      const resolved = await resolveAnnouncementAudience(CHAT_ID, requested)
      expect(resolved.targetParticipantIds).toBeNull()
      expect(resolved.unknownIds).toEqual([])
    }
  })

  it('resolves live participants and names them', async () => {
    const resolved = await resolveAnnouncementAudience(CHAT_ID, [
      ALICE_PARTICIPANT,
      BOB_PARTICIPANT,
    ])
    expect(resolved.targetParticipantIds).toEqual([ALICE_PARTICIPANT, BOB_PARTICIPANT])
    expect(resolved.targetNames).toEqual(['Alice', 'Bob'])
    expect(resolved.unknownIds).toEqual([])
  })

  it('collapses duplicates', async () => {
    const resolved = await resolveAnnouncementAudience(CHAT_ID, [
      ALICE_PARTICIPANT,
      ALICE_PARTICIPANT,
    ])
    expect(resolved.targetParticipantIds).toEqual([ALICE_PARTICIPANT])
  })

  it('reports a participant who has left the scene as unknown', async () => {
    const resolved = await resolveAnnouncementAudience(CHAT_ID, [GONE_PARTICIPANT])
    expect(resolved.unknownIds).toEqual([GONE_PARTICIPANT])
    expect(resolved.targetParticipantIds).toBeNull()
  })

  it('reports an id belonging to no participant of this chat', async () => {
    const resolved = await resolveAnnouncementAudience(CHAT_ID, [
      ALICE_PARTICIPANT,
      STRANGER_PARTICIPANT,
    ])
    expect(resolved.targetParticipantIds).toEqual([ALICE_PARTICIPANT])
    expect(resolved.unknownIds).toEqual([STRANGER_PARTICIPANT])
  })

  it('names a character it cannot read rather than dropping the target', async () => {
    getRepositories.mockReturnValue({
      chats: {
        findById: jest.fn().mockResolvedValue({
          id: CHAT_ID,
          participants: [
            { id: ALICE_PARTICIPANT, characterId: 'char-alice', status: 'active', removedAt: null },
          ],
        }),
      },
      characters: {
        findById: jest.fn().mockRejectedValue(new Error('vault unavailable')),
      },
    })
    const resolved = await resolveAnnouncementAudience(CHAT_ID, [ALICE_PARTICIPANT])
    expect(resolved.targetParticipantIds).toEqual([ALICE_PARTICIPANT])
    expect(resolved.targetNames).toEqual(['Someone'])
  })
})

describe('postAdhocAnnouncement', () => {
  const postedMessage = () => addMessage.mock.calls[0][1] as Record<string, unknown>

  it('posts publicly when no audience is given', async () => {
    await postAdhocAnnouncement({
      chatId: CHAT_ID,
      contentMarkdown: 'A bell tolls.',
      sender: STAFF_SENDER,
    })
    expect(postedMessage().targetParticipantIds).toBeNull()
  })

  it('stores NULL rather than an empty array for an empty audience', async () => {
    await postAdhocAnnouncement({
      chatId: CHAT_ID,
      contentMarkdown: 'A bell tolls.',
      sender: STAFF_SENDER,
      targetParticipantIds: [],
    })
    expect(postedMessage().targetParticipantIds).toBeNull()
  })

  it('persists the named audience as whisper targets', async () => {
    await postAdhocAnnouncement({
      chatId: CHAT_ID,
      contentMarkdown: 'Only for you.',
      sender: STAFF_SENDER,
      targetParticipantIds: [ALICE_PARTICIPANT, BOB_PARTICIPANT],
    })
    expect(postedMessage().targetParticipantIds).toEqual([ALICE_PARTICIPANT, BOB_PARTICIPANT])
  })

  it('keeps the operator-authored marker on a whispered announcement', async () => {
    // `systemKind: 'announcement'` is what tells the Salon the human wrote this
    // and must always see it — a whisper must not shed that marker.
    await postAdhocAnnouncement({
      chatId: CHAT_ID,
      contentMarkdown: 'Only for you.',
      sender: STAFF_SENDER,
      targetParticipantIds: [ALICE_PARTICIPANT],
    })
    expect(postedMessage().systemKind).toBe('announcement')
  })

  it('whispers under a custom display name just as happily', async () => {
    await postAdhocAnnouncement({
      chatId: CHAT_ID,
      contentMarkdown: 'Psst.',
      sender: { kind: 'custom', displayName: 'A Distant Bell' },
      targetParticipantIds: [ALICE_PARTICIPANT],
    })
    const msg = postedMessage()
    expect(msg.targetParticipantIds).toEqual([ALICE_PARTICIPANT])
    expect(msg.systemSender).toBeNull()
    expect(msg.customAnnouncer).toEqual({ kind: 'custom', displayName: 'A Distant Bell' })
  })
})
