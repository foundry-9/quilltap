/**
 * Unit tests for context-builder.service.ts
 * Tests message building and conversation assembly
 */

import {
  buildConversationMessages,
  collectLanternImageFileIdsForCharacter,
  collectUnseenUserAttachmentsForCharacter,
  normalizeWhisperRoles,
} from '@/lib/services/chat-message/context-builder.service'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

describe('context-builder.service', () => {
  describe('buildConversationMessages', () => {
    it('should build conversation from USER and ASSISTANT messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hello',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Hi there!',
          id: 'msg-2',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0]).toEqual({
        role: 'USER',
        content: 'Hello',
        id: 'msg-1',
      })
      expect(result.conversationMessages[1]).toEqual({
        role: 'ASSISTANT',
        content: 'Hi there!',
        id: 'msg-2',
      })
    })

    it('should filter out SYSTEM messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'SYSTEM',
          content: 'System message',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'USER',
          content: 'User message',
          id: 'msg-2',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].role).toBe('USER')
    })

    it('should convert TOOL messages to USER messages with formatted content', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search_web',
            result: 'Search results here',
          }),
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].role).toBe('USER')
      expect(result.conversationMessages[0].content).toContain('[Tool Result: search_web]')
      expect(result.conversationMessages[0].content).toContain('Search results here')
    })

    it('should preserve thought signatures on ASSISTANT messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Response',
          id: 'msg-1',
          thoughtSignature: 'thought-123',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages[0].thoughtSignature).toBe('thought-123')
    })

    it('should not include thought signatures on USER messages', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Question',
          id: 'msg-1',
          thoughtSignature: 'should-not-appear',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages[0].thoughtSignature).toBeUndefined()
    })

    it('should handle malformed TOOL message content', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: 'not valid json',
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      // Malformed TOOL messages should be filtered out
      expect(result.conversationMessages).toHaveLength(0)
    })

    it('should handle TOOL message with missing result field', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search_web',
          }),
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toContain('No result')
    })

    it('should filter out non-message type events', () => {
      const existingMessages = [
        {
          type: 'event',
          content: 'Some event',
        },
        {
          type: 'message',
          role: 'USER',
          content: 'User message',
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toBe('User message')
    })

    it('should build messages with participant info for multi-character chats', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hello',
          id: 'msg-1',
          participantId: 'user-participant',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Hi!',
          id: 'msg-2',
          participantId: 'char-participant-1',
          createdAt: '2024-01-01T00:00:01Z',
        },
      ]

      const result = buildConversationMessages(existingMessages, true)

      expect(result.messagesWithParticipants).toBeDefined()
      expect(result.messagesWithParticipants).toHaveLength(2)
      expect(result.messagesWithParticipants![0]).toMatchObject({
        role: 'USER',
        content: 'Hello',
        participantId: 'user-participant',
        createdAt: '2024-01-01T00:00:00Z',
      })
    })

    it('should not build participant messages for single-character chats', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Hello',
          id: 'msg-1',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.messagesWithParticipants).toBeUndefined()
    })

    it('should handle empty message array', () => {
      const result = buildConversationMessages([], false)

      expect(result.conversationMessages).toEqual([])
      expect(result.messagesWithParticipants).toBeUndefined()
    })

    it('should preserve message order', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'First',
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Second',
          id: 'msg-2',
        },
        {
          type: 'message',
          role: 'USER',
          content: 'Third',
          id: 'msg-3',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages[0].content).toBe('First')
      expect(result.conversationMessages[1].content).toBe('Second')
      expect(result.conversationMessages[2].content).toBe('Third')
    })

    it('should handle mixed message types and roles', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'USER',
          content: 'Question',
          id: 'msg-1',
        },
        {
          type: 'event',
          content: 'Event happened',
        },
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Answer',
          id: 'msg-2',
        },
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'test',
            result: 'Result',
          }),
          id: 'msg-3',
        },
        {
          type: 'message',
          role: 'SYSTEM',
          content: 'System',
          id: 'msg-4',
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      expect(result.conversationMessages).toHaveLength(3) // USER, ASSISTANT, TOOL
      expect(result.conversationMessages[0].role).toBe('USER')
      expect(result.conversationMessages[1].role).toBe('ASSISTANT')
      expect(result.conversationMessages[2].role).toBe('USER') // Converted TOOL
    })

    it('should handle TOOL messages in multi-character mode', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search_web',
            result: 'Found data',
          }),
          id: 'msg-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]

      const result = buildConversationMessages(existingMessages, true)

      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0]).toMatchObject({
        role: 'USER',
        content: expect.stringContaining('[Tool Result: search_web]'),
        participantId: null,
      })
    })

    it('should handle malformed TOOL messages in multi-character mode', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: 'invalid json',
          id: 'msg-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]

      const result = buildConversationMessages(existingMessages, true)

      expect(result.messagesWithParticipants).toHaveLength(0)
    })

    it('should handle messages with null thought signatures', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Response',
          id: 'msg-1',
          thoughtSignature: null,
        },
      ]

      const result = buildConversationMessages(existingMessages, false)

      // thoughtSignature is preserved as null, not converted to undefined
      expect(result.conversationMessages[0].thoughtSignature).toBeNull()
    })

    it('should include targetParticipantIds in multi-character mode', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Secret whisper',
          id: 'msg-1',
          participantId: 'char-1',
          targetParticipantIds: ['char-2'],
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0].targetParticipantIds).toEqual(['char-2'])
    })

    it('should handle multiple consecutive USER messages', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'First', id: 'msg-1' },
        { type: 'message', role: 'USER', content: 'Second', id: 'msg-2' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toBe('First')
      expect(result.conversationMessages[1].content).toBe('Second')
    })

    it('should handle multiple consecutive ASSISTANT messages', () => {
      const existingMessages = [
        { type: 'message', role: 'ASSISTANT', content: 'Reply 1', id: 'msg-1' },
        { type: 'message', role: 'ASSISTANT', content: 'Reply 2', id: 'msg-2' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toBe('Reply 1')
      expect(result.conversationMessages[1].content).toBe('Reply 2')
    })

    it('should filter out system_event type entries', () => {
      const existingMessages = [
        { type: 'system_event', content: 'System event' },
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toBe('Hello')
    })

    it('should handle TOOL message with nested JSON result', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'search',
            result: JSON.stringify({ items: [{ name: 'test' }] }),
          }),
          id: 'msg-1',
        },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toContain('[Tool Result: search]')
    })

    it('should handle large message arrays without errors', () => {
      const existingMessages = Array.from({ length: 100 }, (_, i) => ({
        type: 'message',
        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
        content: `Message ${i}`,
        id: `msg-${i}`,
      }))
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(100)
    })

    it('should handle messages with empty content', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: '', id: 'msg-1' },
        { type: 'message', role: 'ASSISTANT', content: '', id: 'msg-2' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toBe('')
      expect(result.conversationMessages[1].content).toBe('')
    })

    it('should track participant IDs across multiple characters in multi-character mode', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1', participantId: 'user-p', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Hi from char1', id: 'msg-2', participantId: 'char-1-p', createdAt: '2024-01-01T00:00:01Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Hello from char2', id: 'msg-3', participantId: 'char-2-p', createdAt: '2024-01-01T00:00:02Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(3)
      expect(result.messagesWithParticipants![0].participantId).toBe('user-p')
      expect(result.messagesWithParticipants![1].participantId).toBe('char-1-p')
      expect(result.messagesWithParticipants![2].participantId).toBe('char-2-p')
    })

    it('should preserve message ordering in multi-character mode with different participant IDs', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Q1', id: 'msg-1', participantId: 'user', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'A1', id: 'msg-2', participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
        { type: 'message', role: 'ASSISTANT', content: 'A2', id: 'msg-3', participantId: 'char-2', createdAt: '2024-01-01T00:00:02Z' },
        { type: 'message', role: 'USER', content: 'Q2', id: 'msg-4', participantId: 'user', createdAt: '2024-01-01T00:00:03Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(4)
      expect(result.messagesWithParticipants![0].content).toBe('Q1')
      expect(result.messagesWithParticipants![1].content).toBe('A1')
      expect(result.messagesWithParticipants![2].content).toBe('A2')
      expect(result.messagesWithParticipants![3].content).toBe('Q2')
    })

    it('should handle TOOL messages in multi-character mode with null participantId', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'test_tool',
            result: 'Tool output',
          }),
          id: 'msg-1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0].participantId).toBeNull()
      expect(result.messagesWithParticipants![0].role).toBe('USER')
      expect(result.messagesWithParticipants![0].content).toContain('[Tool Result: test_tool]')
    })

    it('should preserve null targetParticipantIds when present', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'ASSISTANT',
          content: 'Public message',
          id: 'msg-1',
          participantId: 'char-1',
          targetParticipantIds: null,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(1)
      expect(result.messagesWithParticipants![0].targetParticipantIds).toBeNull()
    })

    it('should handle messages with very long content', () => {
      const longContent = 'x'.repeat(10000)
      const existingMessages = [
        { type: 'message', role: 'USER', content: longContent, id: 'msg-1' },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content.length).toBe(10000)
    })

    it('should handle mixed TOOL messages with valid and empty results', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'tool1',
            result: 'Valid result',
          }),
          id: 'msg-1',
        },
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'tool2',
            result: '',
          }),
          id: 'msg-2',
        },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.conversationMessages[0].content).toContain('[Tool Result: tool1]')
      expect(result.conversationMessages[1].content).toContain('[Tool Result: tool2]')
    })

    it('should preserve participant timestamps in multi-character mode', () => {
      const time1 = '2024-01-01T10:00:00Z'
      const time2 = '2024-01-01T10:01:00Z'
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1', participantId: 'user', createdAt: time1 },
        { type: 'message', role: 'ASSISTANT', content: 'Hi', id: 'msg-2', participantId: 'char-1', createdAt: time2 },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants![0].createdAt).toBe(time1)
      expect(result.messagesWithParticipants![1].createdAt).toBe(time2)
    })

    it('should handle TOOL message with array result', () => {
      const existingMessages = [
        {
          type: 'message',
          role: 'TOOL',
          content: JSON.stringify({
            toolName: 'list_search',
            result: JSON.stringify([
              { id: 1, name: 'item1' },
              { id: 2, name: 'item2' },
            ]),
          }),
          id: 'msg-1',
        },
      ]
      const result = buildConversationMessages(existingMessages, false)
      expect(result.conversationMessages).toHaveLength(1)
      expect(result.conversationMessages[0].content).toContain('[Tool Result: list_search]')
    })

    it('should handle alternating multi-character and single messages', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Q1', id: 'msg-1', participantId: 'user', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'A1', id: 'msg-2', participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(2)
      expect(result.conversationMessages).toHaveLength(2)
      expect(result.messagesWithParticipants![0].participantId).toBe('user')
      expect(result.messagesWithParticipants![1].participantId).toBe('char-1')
    })

    it('should handle messageIds with special characters', () => {
      const existingMessages = [
        { type: 'message', role: 'USER', content: 'Hello', id: 'msg-1:special_id-123', participantId: 'user', createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Hi', id: 'msg-2/alternative.id', participantId: 'char-1', createdAt: '2024-01-01T00:00:01Z' },
      ]
      const result = buildConversationMessages(existingMessages, true)
      expect(result.messagesWithParticipants).toHaveLength(2)
      expect(result.messagesWithParticipants![0].id).toBe('msg-1:special_id-123')
      expect(result.messagesWithParticipants![1].id).toBe('msg-2/alternative.id')
    })
  })

  describe('collectLanternImageFileIdsForCharacter', () => {
    const LOOKBACK = 6

    it('returns an empty array when no ASSISTANT messages carry attachments', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'hi' },
        { type: 'message', role: 'ASSISTANT', content: 'hello' },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual([])
    })

    it('collects a single Lantern image posted after the character last responded (multi-char)', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'hi', participantId: 'user' },
        { type: 'message', role: 'ASSISTANT', content: 'A1', participantId: 'char-1' },
        { type: 'message', role: 'USER', content: 'look at this' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern bg', participantId: null, attachments: ['file-new'] },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual(['file-new'])
    })

    it('does not re-deliver an image the character has already seen (multi-char)', () => {
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'Lantern bg', participantId: null, attachments: ['file-old'] },
        { type: 'message', role: 'ASSISTANT', content: 'A1', participantId: 'char-1' },
        { type: 'message', role: 'USER', content: 'again?' },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual([])
    })

    it('collects images from other characters turns but stops at own turn (multi-char)', () => {
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-1', participantId: null, attachments: ['file-1'] },
        { type: 'message', role: 'ASSISTANT', content: 'A1', participantId: 'char-1' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-2', participantId: null, attachments: ['file-2'] },
        { type: 'message', role: 'ASSISTANT', content: 'B1', participantId: 'char-2' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-3', participantId: null, attachments: ['file-3'] },
      ]
      // For char-1: stop at their own prior turn → only file-2 and file-3.
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual(['file-2', 'file-3'])
    })

    it('collects multiple Lantern images in chronological order', () => {
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'A1', participantId: 'char-1' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-a', participantId: null, attachments: ['file-a'] },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-b', participantId: null, attachments: ['file-b'] },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual(['file-a', 'file-b'])
    })

    it('dedupes a file ID that appears on more than one ASSISTANT message', () => {
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'A1', participantId: 'char-1' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-a', participantId: null, attachments: ['file-x'] },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-b', participantId: null, attachments: ['file-x'] },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual(['file-x'])
    })

    it('caps the walk at the lookback value', () => {
      const msgs: Array<{ type: string; role: string; content: string; participantId: string | null; attachments?: string[] }> = []
      for (let i = 0; i < 10; i++) {
        msgs.push({
          type: 'message',
          role: 'ASSISTANT',
          content: `Lantern-${i}`,
          participantId: null,
          attachments: [`file-${i}`],
        })
      }
      const result = collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)
      // With lookback=6 we see the 6 most recent; char-1 has no prior turn so walk runs the cap.
      expect(result).toHaveLength(6)
      expect(result).toEqual(['file-4', 'file-5', 'file-6', 'file-7', 'file-8', 'file-9'])
    })

    it('applies the historyCutoff to a joining character without history access', () => {
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-old', participantId: null, attachments: ['file-pre-join'], createdAt: '2024-01-01T00:00:00Z' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-new', participantId: null, attachments: ['file-post-join'], createdAt: '2024-01-01T01:00:00Z' },
      ]
      const cutoff = '2024-01-01T00:30:00Z'
      // char-1 just joined at cutoff, no prior turn; only post-join image should be included.
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, cutoff, LOOKBACK)).toEqual(['file-post-join'])
    })

    it('single-character chat: stops at an ASSISTANT message with no attachments', () => {
      // In single-char chats, character responses don't set participantId, so
      // the collector relies on the attachments signal to find the character's
      // own prior turn.
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-before', attachments: ['file-before'] },
        { type: 'message', role: 'ASSISTANT', content: 'character response (no atts)' },
        { type: 'message', role: 'USER', content: 'then what?' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-after', attachments: ['file-after'] },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', false, null, LOOKBACK)).toEqual(['file-after'])
    })

    it('single-character chat: includes all Lantern images if the character has never responded', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'first message' },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-1', attachments: ['file-1'] },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern-2', attachments: ['file-2'] },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', false, null, LOOKBACK)).toEqual(['file-1', 'file-2'])
    })

    it('ignores non-message entries and non-ASSISTANT messages', () => {
      const msgs = [
        { type: 'event', role: 'ASSISTANT', attachments: ['should-skip'] },
        { type: 'message', role: 'USER', content: 'q', attachments: ['should-also-skip'] },
        { type: 'message', role: 'ASSISTANT', content: 'Lantern', participantId: null, attachments: ['file-kept'] },
      ]
      expect(collectLanternImageFileIdsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual(['file-kept'])
    })
  })

  describe('collectUnseenUserAttachmentsForCharacter (bug 121)', () => {
    const LOOKBACK = 20

    it('returns an empty array when no USER message carries attachments', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'hi', id: 'm1' },
        { type: 'message', role: 'ASSISTANT', content: 'hello', id: 'm2', participantId: 'char-2' },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'char-1', true, null, LOOKBACK)).toEqual([])
    })

    it('the reported shape: the second character in the turn still gets the upload', () => {
      // Friday, chat df82edc2. Charlie attaches a transcript; Abigail answers
      // first (her request carried the file inline, from this request's
      // fileIds); Friday is the next participant to speak, on a fresh request
      // with no fileIds, and used to receive the typed words alone.
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'earlier Friday turn', id: 'm1', participantId: 'friday' },
        { type: 'message', role: 'USER', content: 'Oh, and read this transcript.', id: 'm2', attachments: ['transcript'] },
        { type: 'message', role: 'ASSISTANT', content: 'Abigail quotes it', id: 'm3', participantId: 'abigail' },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, LOOKBACK)).toEqual([
        { messageId: 'm2', fileIds: ['transcript'] },
      ])
    })

    it('does not re-deliver an upload the character has already answered', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'read this', id: 'm1', attachments: ['transcript'] },
        { type: 'message', role: 'ASSISTANT', content: 'Friday answers', id: 'm2', participantId: 'friday' },
        { type: 'message', role: 'USER', content: 'and now?', id: 'm3' },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, LOOKBACK)).toEqual([])
    })

    it('collects several uploads in chronological order, oldest first', () => {
      const msgs = [
        { type: 'message', role: 'ASSISTANT', content: 'own prior', id: 'm0', participantId: 'friday' },
        { type: 'message', role: 'USER', content: 'one', id: 'm1', attachments: ['file-a'] },
        { type: 'message', role: 'ASSISTANT', content: 'other char', id: 'm2', participantId: 'abigail' },
        { type: 'message', role: 'USER', content: 'two', id: 'm3', attachments: ['file-b', 'file-c'] },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, LOOKBACK)).toEqual([
        { messageId: 'm1', fileIds: ['file-a'] },
        { messageId: 'm3', fileIds: ['file-b', 'file-c'] },
      ])
    })

    it('dedupes a file id re-attached to a later message', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'one', id: 'm1', attachments: ['file-a'] },
        { type: 'message', role: 'USER', content: 'again', id: 'm2', attachments: ['file-a'] },
      ]
      // Walking newest-first, the later message wins the id; the earlier one
      // is left with nothing to add and drops out.
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, LOOKBACK)).toEqual([
        { messageId: 'm2', fileIds: ['file-a'] },
      ])
    })

    it('honours the history cutoff for a joining character', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'before you joined', id: 'm1', attachments: ['old'], createdAt: '2026-09-04T10:00:00.000Z' },
        { type: 'message', role: 'USER', content: 'after you joined', id: 'm2', attachments: ['new'], createdAt: '2026-09-04T12:00:00.000Z' },
      ]
      expect(
        collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, '2026-09-04T11:00:00.000Z', LOOKBACK)
      ).toEqual([{ messageId: 'm2', fileIds: ['new'] }])
    })

    it('skips a message with no row id — there would be nowhere to splice it', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'orphan', attachments: ['file-a'] },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, LOOKBACK)).toEqual([])
    })

    it('stops at the own prior turn in single-character mode, where participantId is absent', () => {
      // Single-char chats leave participantId null on character responses, so
      // the structural signal is used: an ASSISTANT message without
      // attachments is the character's own turn.
      const msgs = [
        { type: 'message', role: 'USER', content: 'old upload', id: 'm1', attachments: ['old'] },
        { type: 'message', role: 'ASSISTANT', content: 'own reply', id: 'm2' },
        { type: 'message', role: 'USER', content: 'new upload', id: 'm3', attachments: ['new'] },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', false, null, LOOKBACK)).toEqual([
        { messageId: 'm3', fileIds: ['new'] },
      ])
    })

    it('respects the lookback cap for a character that has never spoken', () => {
      const msgs = [
        { type: 'message', role: 'USER', content: 'ancient', id: 'm0', attachments: ['ancient'] },
        ...Array.from({ length: 5 }, (_, i) => ({
          type: 'message', role: 'USER', content: `filler ${i}`, id: `f${i}`,
        })),
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, 3)).toEqual([])
    })

    it('ignores non-message rows', () => {
      const msgs = [
        { type: 'system', role: 'USER', content: '', id: 's1', attachments: ['file-a'] },
        { type: 'message', role: 'USER', content: 'real', id: 'm1', attachments: ['file-b'] },
      ]
      expect(collectUnseenUserAttachmentsForCharacter(msgs, 'friday', true, null, LOOKBACK)).toEqual([
        { messageId: 'm1', fileIds: ['file-b'] },
      ])
    })
  })

  describe('normalizeWhisperRoles', () => {
    // Minimal message shape the helper actually reads. Mirrors the slice of
    // the buildMessageContext message type that touches the re-role map.
    type Msg = {
      type: string
      role?: string
      content?: string
      opaqueContent?: string | null
      attachments?: string[] | null
      systemSender?: string | null
      id?: string
    }

    it('flips an attachment-less Staff whisper from ASSISTANT to USER', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'USER', content: 'Hello', systemSender: null },
        { type: 'message', role: 'ASSISTANT', content: 'The Host notes the hour', systemSender: 'host' },
      ]
      const out = normalizeWhisperRoles(msgs, false)
      expect(out[1].role).toBe('USER')
      expect(out[1].systemSender).toBeNull()
      expect(out[1].content).toBe('The Host notes the hour')
    })

    it('leaves non-whisper messages untouched (same reference)', () => {
      const user: Msg = { type: 'message', role: 'USER', content: 'Hi', systemSender: null }
      const assistant: Msg = { type: 'message', role: 'ASSISTANT', content: 'A real reply', systemSender: undefined }
      const out = normalizeWhisperRoles([user, assistant], false)
      // Non-whispers pass through by identity — no needless cloning.
      expect(out[0]).toBe(user)
      expect(out[1]).toBe(assistant)
    })

    it('re-roles a tail of consecutive whispers so the last message is USER (no assistant prefill)', () => {
      // This is the exact shape that 400s on Sonnet 4.6: a failed character
      // turn followed by accumulated synthetic whispers at the tail.
      const msgs: Msg[] = [
        { type: 'message', role: 'USER', content: 'Question', systemSender: null },
        { type: 'message', role: 'ASSISTANT', content: 'memory recap', systemSender: 'commonplaceBook' },
        { type: 'message', role: 'ASSISTANT', content: 'host event', systemSender: 'host' },
        { type: 'message', role: 'ASSISTANT', content: 'prospero summary', systemSender: 'prospero' },
      ]
      const out = normalizeWhisperRoles(msgs, false)
      expect(out.every(m => (m.systemSender ? false : true))).toBe(true)
      expect(out.slice(1).every(m => m.role === 'USER')).toBe(true)
      // The tail — the thing Anthropic rejects when it is ASSISTANT — is USER.
      expect(out[out.length - 1].role).toBe('USER')
    })

    it('keeps an attachment-bearing Lantern whisper as ASSISTANT so the image walker still finds it', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'ASSISTANT', content: 'Lantern background', systemSender: 'lantern', attachments: ['file-img'] },
      ]
      const out = normalizeWhisperRoles(msgs, false)
      expect(out[0].role).toBe('ASSISTANT')
      // systemSender is still cleared even though the role is preserved.
      expect(out[0].systemSender).toBeNull()
      expect(out[0].attachments).toEqual(['file-img'])
      // The re-roled message is still discoverable as an assistant+attachments
      // Lantern image by the collector.
      expect(collectLanternImageFileIdsForCharacter(out, 'char-1', true, null, 6)).toEqual(['file-img'])
    })

    it('treats an empty attachments array as no attachments and flips to USER', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'ASSISTANT', content: 'librarian filed a doc', systemSender: 'librarian', attachments: [] },
      ]
      const out = normalizeWhisperRoles(msgs, false)
      expect(out[0].role).toBe('USER')
    })

    it('swaps in opaqueContent when isOpaqueAnywhere is true', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'ASSISTANT', content: 'The Host (named) speaks', opaqueContent: 'A voice notes the hour', systemSender: 'host' },
      ]
      const out = normalizeWhisperRoles(msgs, true)
      expect(out[0].content).toBe('A voice notes the hour')
      expect(out[0].role).toBe('USER')
    })

    it('falls back to content when opaque mode is on but opaqueContent is missing', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'ASSISTANT', content: 'fallback body', opaqueContent: null, systemSender: 'host' },
      ]
      const out = normalizeWhisperRoles(msgs, true)
      expect(out[0].content).toBe('fallback body')
    })

    it('keeps the persona-voiced content when opaque mode is off', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'ASSISTANT', content: 'The Host (named) speaks', opaqueContent: 'A voice notes the hour', systemSender: 'host' },
      ]
      const out = normalizeWhisperRoles(msgs, false)
      expect(out[0].content).toBe('The Host (named) speaks')
    })

    it('preserves attachment role even in opaque mode (carve-out is independent of body swap)', () => {
      const msgs: Msg[] = [
        { type: 'message', role: 'ASSISTANT', content: 'named Lantern', opaqueContent: 'opaque Lantern', systemSender: 'lantern', attachments: ['file-img'] },
      ]
      const out = normalizeWhisperRoles(msgs, true)
      expect(out[0].role).toBe('ASSISTANT')
      expect(out[0].content).toBe('opaque Lantern')
    })
  })
})
