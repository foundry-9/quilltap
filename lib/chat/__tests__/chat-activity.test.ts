import type { ChatEvent } from '@/lib/schemas/types'
import {
  isCharacterAuthoredMessage,
  chatActivityAt,
  chatActivityTime,
  byChatActivityDesc,
} from '../chat-activity'

/** A minimal character-authored message; overrides carve out each edge case. */
function msg(overrides: Record<string, unknown> = {}): ChatEvent {
  return {
    type: 'message',
    id: '00000000-0000-4000-8000-000000000001',
    role: 'ASSISTANT',
    content: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as ChatEvent
}

describe('isCharacterAuthoredMessage', () => {
  describe('counts as activity', () => {
    it('an LLM character speaking', () => {
      expect(isCharacterAuthoredMessage(msg({ role: 'ASSISTANT' }))).toBe(true)
    })

    it('the human user speaking', () => {
      expect(isCharacterAuthoredMessage(msg({ role: 'USER' }))).toBe(true)
    })

    it('a whisper — a character murmuring to one other character is still speaking', () => {
      expect(
        isCharacterAuthoredMessage(msg({ targetParticipantIds: ['participant-1'] })),
      ).toBe(true)
    })

    it('a silent message, which is still content a character posted', () => {
      expect(isCharacterAuthoredMessage(msg({ isSilentMessage: true }))).toBe(true)
    })
  })

  describe('does not count as activity', () => {
    // The bug this module exists to stop: every Staff member persists its
    // announcements as `type: 'message'` rows, so "any message row" wrongly
    // read as the conversation moving forward.
    it.each([
      ['lantern', 'a story background finishing its render'],
      ['aurora', 'an avatar or wardrobe change'],
      ['librarian', 'a Document-Mode event'],
      ['concierge', 'a dangerous-content notice'],
      ['prospero', 'a tool-use bubble'],
      ['host', 'a presence announcement'],
      ['commonplaceBook', 'a memory-recall whisper'],
      ['ariel', 'a terminal open/close'],
      ['carina', 'an inline query answer'],
      ['suparna', 'a mail-delivery announcement'],
      ['pascal', 'a dice-roll outcome'],
    ])('a %s announcement (%s)', (systemSender) => {
      expect(isCharacterAuthoredMessage(msg({ systemSender }))).toBe(false)
    })

    it('an announcement bubble — an announcement wearing a name is still an announcement', () => {
      expect(isCharacterAuthoredMessage(msg({ role: 'USER', customAnnouncer: { kind: 'custom', displayName: 'The Narrator' } }))).toBe(false)
    })

    it('a raw tool-result row, which is machinery rather than posted content', () => {
      expect(isCharacterAuthoredMessage(msg({ role: 'TOOL' }))).toBe(false)
    })

    it('a SYSTEM-role message', () => {
      expect(isCharacterAuthoredMessage(msg({ role: 'SYSTEM' }))).toBe(false)
    })

    it('a context-summary event', () => {
      expect(isCharacterAuthoredMessage(msg({ type: 'context-summary' }))).toBe(false)
    })

    it('a system event', () => {
      expect(isCharacterAuthoredMessage(msg({ type: 'system' }))).toBe(false)
    })
  })
})

describe('chatActivityAt', () => {
  it('reports when a character last posted', () => {
    expect(
      chatActivityAt({ lastMessageAt: '2026-05-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }),
    ).toBe('2026-05-01T00:00:00.000Z')
  })

  it('falls back to createdAt when nobody has posted', () => {
    expect(chatActivityAt({ lastMessageAt: null, createdAt: '2026-01-01T00:00:00.000Z' })).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })

  it('falls back to createdAt when lastMessageAt is absent entirely', () => {
    expect(chatActivityAt({ createdAt: '2026-01-01T00:00:00.000Z' })).toBe('2026-01-01T00:00:00.000Z')
  })

  it('reports 0 rather than NaN for an unparseable timestamp, so comparators stay total', () => {
    expect(chatActivityTime({ lastMessageAt: 'not a date', createdAt: 'also not a date' })).toBe(0)
  })
})

describe('byChatActivityDesc', () => {
  it('puts the most recently spoken-in chat first', () => {
    const quiet = { id: 'quiet', lastMessageAt: '2024-01-01T00:00:00.000Z', createdAt: '2023-01-01T00:00:00.000Z' }
    const loud = { id: 'loud', lastMessageAt: '2026-01-01T00:00:00.000Z', createdAt: '2023-01-01T00:00:00.000Z' }
    expect([quiet, loud].sort(byChatActivityDesc).map((c) => c.id)).toEqual(['loud', 'quiet'])
  })

  it('orders never-spoken-in chats by creation', () => {
    const older = { id: 'older', lastMessageAt: null, createdAt: '2024-01-01T00:00:00.000Z' }
    const newer = { id: 'newer', lastMessageAt: null, createdAt: '2025-01-01T00:00:00.000Z' }
    expect([older, newer].sort(byChatActivityDesc).map((c) => c.id)).toEqual(['newer', 'older'])
  })
})
