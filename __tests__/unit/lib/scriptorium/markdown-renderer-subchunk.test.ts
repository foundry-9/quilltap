/**
 * Unit tests for renderer-side interchange sub-chunking (Bug 17).
 *
 * A long interchange used to render as a single conversation chunk of
 * 34k–117k chars — under the transport cap but over the embedding model's
 * ~8,192-token context, so it failed to embed and stayed unsearchable forever.
 * The renderer now splits any over-budget interchange into sequential chunks
 * each inside {@link CHUNK_CHAR_BUDGET}. These tests pin that behaviour AND the
 * oracle surface: a conversation with no over-budget interchange must render
 * byte-identically to the pre-sub-chunking output.
 */

import { describe, it, expect, jest } from '@jest/globals'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

import {
  renderConversationMarkdown,
  CHUNK_CHAR_BUDGET,
} from '@/lib/scriptorium/markdown-renderer'
import type { ChatEvent, ChatParticipantBase } from '@/lib/schemas/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_PID = 'p-user'
const CHAR_PID = 'p-char'

const participants = [
  { id: USER_PID, controlledBy: 'user', characterId: null },
  { id: CHAR_PID, controlledBy: 'ai', characterId: 'char-1' },
] as unknown as ChatParticipantBase[]

const names = new Map<string, string>([
  [USER_PID, 'User'],
  [CHAR_PID, 'Rosalind'],
])

let seq = 0
function msg(role: 'USER' | 'ASSISTANT', content: string): ChatEvent {
  seq++
  return {
    id: `m-${seq}`,
    type: 'message',
    role,
    content,
    participantId: role === 'USER' ? USER_PID : CHAR_PID,
    createdAt: `2026-01-0${((seq % 9) + 1)}T12:00:00.000Z`,
  } as unknown as ChatEvent
}

// ---------------------------------------------------------------------------
// Oracle surface — normal history is untouched
// ---------------------------------------------------------------------------

describe('renderConversationMarkdown — under-budget interchanges are unchanged', () => {
  it('emits one chunk per interchange with sequential indices', () => {
    seq = 0
    const messages = [
      msg('USER', 'Good morning.'),
      msg('ASSISTANT', 'And a fine one to you.'),
      msg('USER', 'Shall we walk?'),
      msg('ASSISTANT', 'Delighted.'),
    ]

    const { interchanges } = renderConversationMarkdown(messages, participants, names)

    expect(interchanges).toHaveLength(2)
    expect(interchanges.map(c => c.index)).toEqual([0, 1])
    // Each interchange keeps all its message ids, in order.
    expect(interchanges[0].messageIds).toEqual(['m-1', 'm-2'])
    expect(interchanges[1].messageIds).toEqual(['m-3', 'm-4'])
    // Nothing is over budget.
    for (const c of interchanges) {
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET)
    }
    // Content still carries the original interchange headers verbatim.
    expect(interchanges[0].content).toContain('## Interchange 0')
    expect(interchanges[1].content).toContain('## Interchange 1')
    expect(interchanges[0].content).not.toContain('(continued')
  })

  it('is byte-identical to a hand-built reference for a small conversation', () => {
    seq = 0
    const messages = [msg('USER', 'Hello there.'), msg('ASSISTANT', 'Hi!')]
    const { interchanges, markdown } = renderConversationMarkdown(messages, participants, names)

    // Reconstruct exactly what the pre-sub-chunking renderer produced.
    const block0 =
      'Past conversation message timestamp: January 2, 2026 at 12:00 PM\n\n' +
      '### Message 0 (User)\n\nHello there.\n'
    const block1 =
      'Past conversation message timestamp: January 3, 2026 at 12:00 PM\n\n' +
      '### Message 1 (Rosalind)\n\nHi!\n'
    const expected = ['## Interchange 0', '', block0, block1].join('\n')

    expect(interchanges).toHaveLength(1)
    expect(interchanges[0].content).toBe(expected)
    expect(markdown).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Sub-chunking — over-budget interchange splits
// ---------------------------------------------------------------------------

describe('renderConversationMarkdown — over-budget interchange sub-chunking', () => {
  it('splits a many-message interchange into several in-budget chunks, order preserved', () => {
    seq = 0
    // One USER opener, then many assistant messages ~3k chars each → well over
    // the 24k budget in a single interchange.
    const messages: ChatEvent[] = [msg('USER', 'Tell me a long tale.')]
    const paras = 20
    for (let i = 0; i < paras; i++) {
      messages.push(msg('ASSISTANT', `Chapter ${i}. ` + 'word '.repeat(600)))
    }

    const { interchanges } = renderConversationMarkdown(messages, participants, names)

    // More than one chunk, all under budget.
    expect(interchanges.length).toBeGreaterThan(1)
    for (const c of interchanges) {
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET)
      expect(c.content.length).toBeGreaterThan(0)
    }

    // Sequential indices with no gaps.
    expect(interchanges.map(c => c.index)).toEqual(
      Array.from({ length: interchanges.length }, (_, i) => i),
    )

    // Every original message id appears, in order, across the chunks.
    const seen = interchanges.flatMap(c => c.messageIds)
    const expectedIds = messages.map(m => m.id)
    expect(seen).toEqual(expectedIds)

    // Continuation chunks are labelled.
    expect(interchanges[0].content).toContain('## Interchange 0')
    expect(interchanges.slice(1).some(c => c.content.includes('(continued'))).toBe(true)
  })

  it('splits a single giant message at natural boundaries, tagging each piece with its id', () => {
    seq = 0
    // A single assistant message far over budget, made of many paragraphs so it
    // can split on the paragraph boundary rather than a hard cut.
    const bigBody = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} ` + 'lorem '.repeat(30)).join('\n\n')
    const messages = [msg('USER', 'Go on.'), msg('ASSISTANT', bigBody)]

    const { interchanges } = renderConversationMarkdown(messages, participants, names)

    expect(interchanges.length).toBeGreaterThan(1)
    for (const c of interchanges) {
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET)
    }
    // The giant message's id (m-2) rides on every piece that carries its text.
    const piecesWithGiant = interchanges.filter(c => c.messageIds.includes('m-2'))
    expect(piecesWithGiant.length).toBeGreaterThan(1)
  })

  it('keeps the metadata header on chunk 0 even when interchange 0 is split', () => {
    seq = 0
    const messages: ChatEvent[] = [msg('USER', 'Begin.')]
    for (let i = 0; i < 20; i++) {
      messages.push(msg('ASSISTANT', `Reply ${i}. ` + 'word '.repeat(600)))
    }

    const { interchanges, markdown } = renderConversationMarkdown(messages, participants, names, {
      conversationId: 'chat-xyz',
      title: 'A Very Long Morning',
      createdAt: '2026-01-01T12:00:00.000Z',
      lastUpdatedAt: '2026-01-02T12:00:00.000Z',
    })

    expect(interchanges.length).toBeGreaterThan(1)
    // Metadata header appears exactly once, on the first chunk.
    expect(interchanges[0].content).toContain('# Conversation: A Very Long Morning')
    expect(interchanges[0].content).toContain('- Conversation ID: chat-xyz')
    for (const c of interchanges.slice(1)) {
      expect(c.content).not.toContain('# Conversation: A Very Long Morning')
    }
    // The full markdown still leads with the metadata header.
    expect(markdown.startsWith('# Conversation: A Very Long Morning')).toBe(true)
    // And still no chunk exceeds the budget.
    for (const c of interchanges) {
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET)
    }
  })
})
