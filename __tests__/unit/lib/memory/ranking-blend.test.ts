/**
 * Regression guard for the Commonplace Book recall ranking math
 * (docs/developer/features/commonplace-relevance-fix.md).
 *
 * These tests pin the behaviors that the 4.8 relevance fix established, so the
 * coefficients can't silently drift back to importance-dominates-relevance:
 *  - F1: relevance (cosine) leads the blend; the priority term is a no-floor,
 *        decaying tie-breaker. On-topic-ordinary beats off-topic-important.
 *  - F2: the cosine floor is provider-aware (neural vs local TF-IDF).
 *  - F2: an empty candidate pool yields an empty head (whisper nothing).
 *  - F4: a recently-whispered memory takes a bounded anti-repetition penalty.
 *  - F4: the recall-history ring buffer parses, unions, appends, and caps.
 */

import { describe, it, expect } from '@jest/globals'
import {
  computeRankingBlend,
  RANKING_RELEVANCE_WEIGHT,
  RANKING_PRIORITY_WEIGHT,
  defaultMinCosineForProvider,
  DEFAULT_MIN_COSINE_NEURAL,
  DEFAULT_MIN_COSINE_TFIDF,
} from '@/lib/memory/memory-weighting'
import {
  combineRecallMultipliers,
  recentlyWhisperedMultiplier,
  RECALL_MULTIPLIERS,
  type RecallContext,
} from '@/lib/memory/recall-tags'
import {
  parseRecallHistory,
  recentlyWhisperedIdSet,
  appendRecallTurn,
  RECALL_HISTORY_TURNS,
} from '@/lib/memory/recall-history'
import { formatDynamicMemoryHead } from '@/lib/chat/context/memory-injector'

const baseRecallContext: RecallContext = {
  currentProjectId: null,
  scopePolicy: 'down-weight',
}

describe('F1 — ranking blend (relevance leads, priority decays)', () => {
  it('weights sum to 1 with relevance dominant', () => {
    expect(RANKING_RELEVANCE_WEIGHT + RANKING_PRIORITY_WEIGHT).toBeCloseTo(1)
    expect(RANKING_RELEVANCE_WEIGHT).toBeGreaterThan(RANKING_PRIORITY_WEIGHT)
  })

  it('on-topic-ordinary beats off-topic-important (the §1.1 failure mode)', () => {
    // On-topic ordinary: strong cosine, middling importance.
    const onTopicOrdinary = computeRankingBlend(0.8, 0.5)
    // Off-topic important: weak cosine, high (even un-decayed) importance.
    const offTopicImportant = computeRankingBlend(0.3, 0.9)
    expect(onTopicOrdinary).toBeGreaterThan(offTopicImportant)
  })

  it('on-topic-important still ranks highest', () => {
    const onTopicImportant = computeRankingBlend(0.8, 0.9)
    const onTopicOrdinary = computeRankingBlend(0.8, 0.5)
    const offTopicImportant = computeRankingBlend(0.3, 0.9)
    expect(onTopicImportant).toBeGreaterThan(onTopicOrdinary)
    expect(onTopicImportant).toBeGreaterThan(offTopicImportant)
  })

  it('cosine ≥ 0.7 outranks cosine ≤ 0.35 regardless of importance (acceptance)', () => {
    // Worst case: the relevant memory has fully-decayed priority (0), the
    // off-topic one has maxed priority (1). Relevance must still win.
    const relevantDecayed = computeRankingBlend(0.7, 0)
    const irrelevantMaxImportance = computeRankingBlend(0.35, 1)
    expect(relevantDecayed).toBeGreaterThan(irrelevantMaxImportance)
  })
})

describe('F2 — provider-aware cosine floor', () => {
  it('local TF-IDF floor is lower than the neural floor', () => {
    expect(DEFAULT_MIN_COSINE_TFIDF).toBeLessThan(DEFAULT_MIN_COSINE_NEURAL)
  })

  it('resolves BUILTIN to the TF-IDF floor and everything else to neural', () => {
    expect(defaultMinCosineForProvider('BUILTIN')).toBe(DEFAULT_MIN_COSINE_TFIDF)
    expect(defaultMinCosineForProvider('OPENAI')).toBe(DEFAULT_MIN_COSINE_NEURAL)
    expect(defaultMinCosineForProvider('OLLAMA')).toBe(DEFAULT_MIN_COSINE_NEURAL)
    expect(defaultMinCosineForProvider(undefined)).toBe(DEFAULT_MIN_COSINE_NEURAL)
  })
})

describe('F2 — empty pool yields an empty head', () => {
  it('formatDynamicMemoryHead([]) emits nothing', () => {
    const result = formatDynamicMemoryHead([], 'anthropic')
    expect(result.content).toBe('')
    expect(result.memoriesUsed).toBe(0)
  })
})

describe('F4 — anti-repetition penalty', () => {
  it('penalizes a memory in the recently-whispered set, passes others through', () => {
    const whispered = recentlyWhisperedMultiplier({ id: 'm1' }, new Set(['m1', 'm2']))
    expect(whispered.multiplier).toBe(RECALL_MULTIPLIERS.recentlyWhispered)
    expect(whispered.fired).toContain('repeat↓')

    const fresh = recentlyWhisperedMultiplier({ id: 'm9' }, new Set(['m1', 'm2']))
    expect(fresh.multiplier).toBe(1)
    expect(fresh.fired).toHaveLength(0)
  })

  it('combineRecallMultipliers folds the penalty into the combined multiplier', () => {
    const withoutPenalty = combineRecallMultipliers(
      { id: 'm1', keywords: [] },
      baseRecallContext,
    )
    const withPenalty = combineRecallMultipliers(
      { id: 'm1', keywords: [] },
      { ...baseRecallContext, recentlyWhisperedIds: new Set(['m1']) },
    )
    expect(withPenalty.multiplier).toBeLessThan(withoutPenalty.multiplier)
    expect(withPenalty.fired).toContain('repeat↓')
  })
})

describe('F4 — recall-history ring buffer', () => {
  it('parses malformed input safely', () => {
    expect(parseRecallHistory(null)).toEqual([])
    expect(parseRecallHistory({})).toEqual([])
    expect(parseRecallHistory({ turns: 'nope' })).toEqual([])
    expect(parseRecallHistory({ turns: [['a', 1, 'b'], 'x'] })).toEqual([['a', 'b']])
  })

  it('unions IDs across retained turns', () => {
    const history = { turns: [['a', 'b'], ['b', 'c']] }
    const set = recentlyWhisperedIdSet(history)
    expect([...set].sort()).toEqual(['a', 'b', 'c'])
  })

  it('appends and caps to the last RECALL_HISTORY_TURNS turns', () => {
    let h: ReturnType<typeof appendRecallTurn> = { turns: [] }
    for (let i = 0; i < RECALL_HISTORY_TURNS + 2; i++) {
      h = appendRecallTurn(h, [`turn-${i}`])
    }
    expect(h.turns).toHaveLength(RECALL_HISTORY_TURNS)
    // Oldest turns dropped; most recent retained.
    expect(h.turns[h.turns.length - 1]).toEqual([`turn-${RECALL_HISTORY_TURNS + 1}`])
  })

  it('does not record an empty turn', () => {
    const h = appendRecallTurn({ turns: [['a']] }, [])
    expect(h.turns).toEqual([['a']])
  })
})
