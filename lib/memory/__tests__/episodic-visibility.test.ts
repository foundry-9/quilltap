/**
 * §3 acceptance — dates visible wherever the LLM sees a memory:
 *  - dynamic head entries carry the [age] label (from occurredAt) and
 *    narrativeTime verbatim,
 *  - the relevant-conversations renderer prints frontmatter dates.
 */

import { formatDynamicMemoryHead } from '@/lib/chat/context/memory-injector'
import { renderRelevantConversationsBlock } from '../conversation-summary-search'
import type { SemanticSearchResult } from '../memory-service'
import type { Memory } from '@/lib/schemas/types'

function makeMemory(overrides: Partial<Memory>): Memory {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    characterId: '22222222-2222-4222-8222-222222222222',
    content: 'On July 14th we visited Lighthouse Point and bought the brass sextant.',
    summary: 'visited lighthouse point bought sextant',
    keywords: ['lighthouse', 'past', 'scope: wide', 'history'],
    tags: [],
    importance: 0.7,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.7,
    entities: ['Lighthouse Point'],
    kind: 'episodic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Memory
}

describe('formatDynamicMemoryHead dates', () => {
  it('prepends an age label computed from occurredAt (event clock, not write clock)', () => {
    const occurredAt = new Date(Date.now() - 8 * 86_400_000).toISOString() // ~ last week
    const results: SemanticSearchResult[] = [
      {
        memory: makeMemory({ occurredAt }),
        score: 0.8,
        usedEmbedding: true,
        effectiveWeight: 0.7,
        rawWeight: 0.7,
      },
    ]
    const formatted = formatDynamicMemoryHead(results, 'ANTHROPIC' as never)
    expect(formatted.content).toContain('[last week]')
  })

  it('carries narrativeTime verbatim alongside the age label', () => {
    const results: SemanticSearchResult[] = [
      {
        memory: makeMemory({
          occurredAt: new Date().toISOString(),
          narrativeTime: 'the third night at sea',
        }),
        score: 0.8,
        usedEmbedding: true,
        effectiveWeight: 0.7,
        rawWeight: 0.7,
      },
    ]
    const formatted = formatDynamicMemoryHead(results, 'ANTHROPIC' as never)
    expect(formatted.content).toContain('[today · the third night at sea]')
  })
})

describe('renderRelevantConversationsBlock dates', () => {
  it('prints the conversation date from frontmatter', () => {
    const block = renderRelevantConversationsBlock([
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        conversationTitle: 'The Harbor Visit',
        relativePath: 'Conversation Summaries/the-harbor-visit.md',
        score: 0.9,
        firstMessageAt: '2026-07-14T10:00:00.000Z',
        lastMessageAt: '2026-07-14T12:00:00.000Z',
      },
    ])
    expect(block).toContain('#### The Harbor Visit (2026-07-14) (`33333333-3333-4333-8333-333333333333`)')
  })

  it('omits the date parenthetical when frontmatter carries none', () => {
    const block = renderRelevantConversationsBlock([
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        conversationTitle: 'Undated',
        relativePath: 'Conversation Summaries/undated.md',
        score: 0.5,
        firstMessageAt: null,
        lastMessageAt: null,
      },
    ])
    expect(block).toContain('#### Undated (`33333333-3333-4333-8333-333333333333`)')
  })
})
