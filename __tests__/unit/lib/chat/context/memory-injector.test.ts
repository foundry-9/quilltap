/**
 * Phase 3a/3b unit tests — frozen archive + dynamic head formatters.
 *
 * Covers the byte-stability invariants the prompt cache architecture
 * depends on:
 *
 * - The frozen archive emits memories in the exact order it received them
 *   (caller is expected to pre-sort by id), so the formatted text is
 *   byte-stable across turns.
 * - The dynamic head respects its token budget and uses summary not body.
 * - The rank-instruction format includes the short id tag the LLM can
 *   echo back when citing memory recall.
 */

import {
  formatFrozenMemoryArchive,
  formatDynamicMemoryHead,
  formatCurrentSceneState,
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatMemoryMetadataTag,
  formatMemorySubjectPrefix,
  DYNAMIC_HEAD_TOKEN_BUDGET,
  DYNAMIC_HEAD_DEFAULT_SIZE,
} from '@/lib/chat/context/memory-injector'
import type { Memory, Provider } from '@/lib/schemas/types'
import type { SceneState } from '@/lib/schemas/chat.types'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'

const provider: Provider = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'test',
  type: 'OPENAI',
  baseUrl: 'http://localhost',
  apiKeyId: '00000000-0000-0000-0000-0000000000bb',
  models: ['test-model'],
  defaultModel: 'test-model',
  isEnabled: true,
  isCustom: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
} as unknown as Provider

function memory(
  id: string,
  summary: string,
  content: string = summary,
  overrides: Partial<Memory> = {},
): Memory {
  return {
    id,
    characterId: '00000000-0000-0000-0000-0000000000c1',
    content,
    summary,
    keywords: [],
    tags: [],
    importance: 0.7,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.7,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Memory
}

function searchResult(m: Memory, score: number = 0.8, weight: number = 0.7): SemanticSearchResult {
  return { memory: m, score, usedEmbedding: true, effectiveWeight: weight }
}

/** The owning character in these fixtures — `memory()` stamps this as `characterId`. */
const SELF_ID = '00000000-0000-0000-0000-0000000000c1'

/**
 * Default subject context: the memories under test are the character's own, so
 * every self-facing line renders unprefixed.
 */
const SELF_SUBJECT = { selfCharacterId: SELF_ID, characterNames: new Map<string, string>() }

describe('memory-injector: formatFrozenMemoryArchive (Phase 3a)', () => {
  it('emits memories in input order (caller sorts by id)', () => {
    const archive = [
      memory('a-id', 'first archive entry'),
      memory('b-id', 'second archive entry'),
      memory('c-id', 'third archive entry'),
    ]

    const result = formatFrozenMemoryArchive(archive, 1000, provider, SELF_SUBJECT)

    expect(result.memoriesUsed).toBe(3)
    expect(result.content).toContain('## Memory Anchors')
    const positions = ['first archive entry', 'second archive entry', 'third archive entry']
      .map(s => result.content.indexOf(s))
    expect(positions[0]).toBeGreaterThan(0)
    expect(positions[1]).toBeGreaterThan(positions[0])
    expect(positions[2]).toBeGreaterThan(positions[1])
  })

  it('is byte-identical across consecutive calls', () => {
    const archive = [
      memory('a', 'alpha'),
      memory('b', 'bravo'),
      memory('c', 'charlie'),
    ]
    const a = formatFrozenMemoryArchive(archive, 1000, provider, SELF_SUBJECT)
    const b = formatFrozenMemoryArchive(archive, 1000, provider, SELF_SUBJECT)
    expect(b.content).toBe(a.content)
  })

  it('returns empty content when memories array is empty', () => {
    const result = formatFrozenMemoryArchive([], 1000, provider, SELF_SUBJECT)
    expect(result).toEqual({ content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] })
  })

  it('truncates at the token budget', () => {
    const archive = Array.from({ length: 30 }, (_, i) =>
      memory(`m-${i.toString().padStart(2, '0')}`, `summary item number ${i}`),
    )
    const result = formatFrozenMemoryArchive(archive, 50, provider, SELF_SUBJECT)
    expect(result.memoriesUsed).toBeLessThan(30)
    expect(result.tokenCount).toBeLessThanOrEqual(50)
  })

  it('uses summary, not full content', () => {
    const archive = [memory('a', 'short summary', 'a much longer body that should not appear')]
    const result = formatFrozenMemoryArchive(archive, 1000, provider, SELF_SUBJECT)
    expect(result.content).toContain('short summary')
    expect(result.content).not.toContain('a much longer body')
  })
})

describe('memory-injector: formatDynamicMemoryHead (Phase 3b)', () => {
  it('emits a rank instruction with [m_xxxx] id tags', () => {
    const results = [
      searchResult(memory('11111111-aaaa-bbbb-cccc-000000000001', 'first relevant'), 0.95, 0.85),
      searchResult(memory('22222222-aaaa-bbbb-cccc-000000000002', 'second relevant'), 0.9, 0.8),
    ]
    const r = formatDynamicMemoryHead(results, provider, SELF_SUBJECT)
    expect(r.content).toContain('Most relevant memories for this turn:')
    expect(r.content).toMatch(/\[m_1111\]/)
    expect(r.content).toMatch(/\[m_2222\]/)
    expect(r.memoriesUsed).toBe(2)
  })

  it('respects DYNAMIC_HEAD_TOKEN_BUDGET by default', () => {
    const longSummary = 'a long summary that uses many tokens '.repeat(20)
    const results = Array.from({ length: 10 }, (_, i) =>
      searchResult(memory(`abcdef${i}-0000-0000-0000-000000000000`, longSummary)),
    )
    const r = formatDynamicMemoryHead(results, provider, SELF_SUBJECT)
    expect(r.tokenCount).toBeLessThanOrEqual(DYNAMIC_HEAD_TOKEN_BUDGET)
  })

  it('caps entries at DYNAMIC_HEAD_DEFAULT_SIZE by default', () => {
    expect(DYNAMIC_HEAD_DEFAULT_SIZE).toBeGreaterThan(0)
    const results = Array.from({ length: DYNAMIC_HEAD_DEFAULT_SIZE + 5 }, (_, i) =>
      searchResult(memory(`a${i}-0000-0000-0000-000000000000`, `entry ${i}`)),
    )
    const r = formatDynamicMemoryHead(results, provider, SELF_SUBJECT)
    expect(r.memoriesUsed).toBeLessThanOrEqual(DYNAMIC_HEAD_DEFAULT_SIZE)
  })

  it('returns empty content when results is empty', () => {
    const r = formatDynamicMemoryHead([], provider, SELF_SUBJECT)
    expect(r).toEqual({ content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] })
  })

  it('orders by effective weight then score', () => {
    const lowWeight = searchResult(memory('a-aaaa-1111-1111-111111111111', 'low'), 0.99, 0.3)
    const highWeight = searchResult(memory('b-bbbb-2222-2222-222222222222', 'high'), 0.5, 0.9)
    const r = formatDynamicMemoryHead([lowWeight, highWeight], provider, SELF_SUBJECT, { maxEntries: 2 })
    const highIdx = r.content.indexOf('high')
    const lowIdx = r.content.indexOf('low')
    expect(highIdx).toBeGreaterThan(0)
    expect(lowIdx).toBeGreaterThan(0)
    expect(highIdx).toBeLessThan(lowIdx)
  })

  it('uses summary, not full content', () => {
    const m = memory('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'short summary', 'long body content')
    const r = formatDynamicMemoryHead([searchResult(m)], provider, SELF_SUBJECT)
    expect(r.content).toContain('short summary')
    expect(r.content).not.toContain('long body content')
  })
})

describe('memory-injector: formatCurrentSceneState', () => {
  function scene(overrides: Partial<SceneState> = {}): SceneState {
    return {
      location: 'Kitchen breakfast nook',
      characters: [
        {
          characterId: '00000000-0000-0000-0000-000000000001',
          characterName: 'Friday',
          action: 'Sipping coffee while planning the day.',
          appearance: 'Strawberry-blonde shoulder-length hair.',
          clothing: 'Charcoal Sweater, Charcoal Cigarette Trousers, barefoot',
        },
        {
          characterId: '00000000-0000-0000-0000-000000000002',
          characterName: 'Amy',
          action: 'Reading at the table.',
          appearance: 'Glossy jet-black wavy hair.',
          clothing: 'Forest Green Long Writing Cardigan',
        },
      ],
      updatedAt: '2026-05-04T10:00:00.000Z',
      updatedAtMessageCount: 42,
      ...overrides,
    }
  }

  it('returns empty content when scene state is null', () => {
    const r = formatCurrentSceneState(null, null, provider)
    expect(r.content).toBe('')
    expect(r.tokenCount).toBe(0)
    expect(r.emittedByCharacter.size).toBe(0)
  })

  it('returns empty content when scene state is undefined', () => {
    const r = formatCurrentSceneState(undefined, null, provider)
    expect(r.content).toBe('')
    expect(r.tokenCount).toBe(0)
    expect(r.emittedByCharacter.size).toBe(0)
  })

  it('renders the canonical Current State block with all fields', () => {
    const r = formatCurrentSceneState(scene(), '10:42 PM', provider)
    expect(r.content).toContain('## Current State')
    expect(r.content).toContain('- **Location**: Kitchen breakfast nook')
    expect(r.content).toContain('- **Characters Present**: Friday, Amy')
    expect(r.content).toContain('- **Time**: 10:42 PM')
    expect(r.content).toContain('- **Active Now**: true')
    expect(r.content).toContain('### Friday')
    expect(r.content).toContain('#### Action')
    expect(r.content).toContain('Sipping coffee while planning the day.')
    expect(r.content).toContain('#### Clothing')
    expect(r.content).toContain('Charcoal Sweater, Charcoal Cigarette Trousers, barefoot')
    expect(r.content).toContain('### Amy')
    expect(r.tokenCount).toBeGreaterThan(0)
  })

  it('omits the Time line entirely when no time is provided', () => {
    const r = formatCurrentSceneState(scene(), null, provider)
    expect(r.content).not.toContain('Time')
    expect(r.content).toContain('- **Active Now**: true')
  })

  it('omits the Time line when time is empty/whitespace', () => {
    const r = formatCurrentSceneState(scene(), '   ', provider)
    expect(r.content).not.toContain('- **Time**')
  })

  it('renders a single character correctly', () => {
    const oneChar = scene({
      characters: [
        {
          characterId: '00000000-0000-0000-0000-000000000001',
          characterName: 'Friday',
          action: 'Alone in the study.',
          appearance: null,
          clothing: 'Wool overcoat',
        },
      ],
    })
    const r = formatCurrentSceneState(oneChar, null, provider)
    expect(r.content).toContain('- **Characters Present**: Friday')
    expect(r.content).toContain('### Friday')
    expect(r.content).not.toContain('### Amy')
  })

  it('shows _unspecified_ placeholders when action or clothing is null/blank', () => {
    const blank = scene({
      characters: [
        {
          characterId: '00000000-0000-0000-0000-000000000001',
          characterName: 'Friday',
          action: '',
          appearance: null,
          clothing: null,
        },
      ],
    })
    const r = formatCurrentSceneState(blank, null, provider)
    expect(r.content).toContain('_unspecified_')
    // Both Action and Clothing should fall back
    const matches = r.content.match(/_unspecified_/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('preserves character order from the scene state', () => {
    const r = formatCurrentSceneState(scene(), null, provider)
    const fridayIdx = r.content.indexOf('### Friday')
    const amyIdx = r.content.indexOf('### Amy')
    expect(fridayIdx).toBeGreaterThan(0)
    expect(amyIdx).toBeGreaterThan(fridayIdx)
  })

  it('does not surface character appearance (appearance stays in the JSON)', () => {
    const r = formatCurrentSceneState(scene(), null, provider)
    expect(r.content).not.toContain('Strawberry-blonde')
    expect(r.content).not.toContain('jet-black wavy hair')
  })

  it('overrides cached clothing with live wardrobe values when provided', () => {
    const live = new Map<string, string>([
      ['00000000-0000-0000-0000-000000000001', '- **top:** Linen Shirt\n- **bottom:** Denim Jeans'],
    ])
    const r = formatCurrentSceneState(scene(), null, provider, live)
    expect(r.content).toContain('- **top:** Linen Shirt')
    expect(r.content).toContain('- **bottom:** Denim Jeans')
    expect(r.content).not.toContain('Charcoal Sweater')
    // Amy has no live override so her cached clothing still shows
    expect(r.content).toContain('Forest Green Long Writing Cardigan')
  })

  it('falls back to cached clothing when live override is empty/whitespace', () => {
    const live = new Map<string, string>([
      ['00000000-0000-0000-0000-000000000001', '   '],
    ])
    const r = formatCurrentSceneState(scene(), null, provider, live)
    expect(r.content).toContain('Charcoal Sweater, Charcoal Cigarette Trousers, barefoot')
  })

  it('collapses a character section to "_unchanged_" when prior emission hashes match', () => {
    // First emission — full content, populates emittedByCharacter.
    const first = formatCurrentSceneState(scene(), null, provider)
    expect(first.content).toContain('### Friday\n')
    expect(first.content).toContain('#### Action')
    expect(first.emittedByCharacter.size).toBe(2)

    // Second emission with the same scene state and the prior emission map
    // as the cache — both characters' sections should collapse.
    const second = formatCurrentSceneState(scene(), null, provider, undefined, first.emittedByCharacter)
    expect(second.content).toContain('### Friday — _unchanged_')
    expect(second.content).toContain('### Amy — _unchanged_')
    expect(second.content).not.toContain('Charcoal Sweater')
    expect(second.content).not.toContain('Forest Green Long Writing Cardigan')
    expect(second.tokenCount).toBeLessThan(first.tokenCount)

    // emittedAt is carried forward unchanged when nothing changes.
    const fridayFirst = first.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    const fridaySecond = second.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    expect(fridaySecond.emittedAt).toBe(fridayFirst.emittedAt)
    expect(fridaySecond.actionHash).toBe(fridayFirst.actionHash)
    expect(fridaySecond.clothingHash).toBe(fridayFirst.clothingHash)
  })

  it('emits full content for a character whose clothing changed since the prior emission', () => {
    const first = formatCurrentSceneState(scene(), null, provider)
    // Friday changes clothes; Amy is unchanged.
    const liveClothing = new Map<string, string>([
      ['00000000-0000-0000-0000-000000000001', 'Velvet Smoking Jacket and silk pajamas'],
    ])
    const second = formatCurrentSceneState(scene(), null, provider, liveClothing, first.emittedByCharacter)

    expect(second.content).toContain('### Friday\n')
    expect(second.content).toContain('Velvet Smoking Jacket and silk pajamas')
    expect(second.content).toContain('### Amy — _unchanged_')

    // Friday's stamp advances; Amy's is preserved.
    const fridayFirst = first.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    const fridaySecond = second.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!
    expect(fridaySecond.actionHash).toBe(fridayFirst.actionHash)
    expect(fridaySecond.clothingHash).not.toBe(fridayFirst.clothingHash)

    const amyFirst = first.emittedByCharacter.get('00000000-0000-0000-0000-000000000002')!
    const amySecond = second.emittedByCharacter.get('00000000-0000-0000-0000-000000000002')!
    expect(amySecond.emittedAt).toBe(amyFirst.emittedAt)
  })

  it('emits full content for a character with no prior emission in the cache', () => {
    // Prior cache only knows about Friday; Amy must render full this turn.
    const priorFridayOnly = new Map<string, { actionHash: string; clothingHash: string; emittedAt: string }>()
    const seed = formatCurrentSceneState(scene(), null, provider)
    priorFridayOnly.set('00000000-0000-0000-0000-000000000001', seed.emittedByCharacter.get('00000000-0000-0000-0000-000000000001')!)

    const next = formatCurrentSceneState(scene(), null, provider, undefined, priorFridayOnly)
    expect(next.content).toContain('### Friday — _unchanged_')
    expect(next.content).toContain('### Amy\n')
    expect(next.content).toContain('Forest Green Long Writing Cardigan')
  })
})

describe('memory-injector: formatMemoryMetadataTag', () => {
  it('returns empty string when no fields are provided', () => {
    expect(formatMemoryMetadataTag({})).toBe('')
  })

  it('emits an italicised parenthetical with leading space when any field is set', () => {
    const tag = formatMemoryMetadataTag({ importance: 0.98 })
    expect(tag.startsWith(' _(')).toBe(true)
    expect(tag.endsWith(')_')).toBe(true)
  })

  it('rounds numeric fields to two decimals', () => {
    const tag = formatMemoryMetadataTag({ importance: 0.987654, relevance: 0.123456, weight: 0.555555 })
    expect(tag).toContain('importance 0.99')
    expect(tag).toContain('relevance 0.12')
    expect(tag).toContain('weight 0.56')
  })

  it('separates fields with the middle-dot separator', () => {
    const tag = formatMemoryMetadataTag({ importance: 0.5, weight: 0.5 })
    expect(tag).toContain(' · ')
  })

  it('renders keywords as a comma-joined list after a "keywords:" label', () => {
    const tag = formatMemoryMetadataTag({ keywords: ['titles', 'load-bearing', 'naming'] })
    expect(tag).toContain('keywords: titles, load-bearing, naming')
  })

  it('omits the keywords segment when the array is empty', () => {
    const tag = formatMemoryMetadataTag({ importance: 0.5, keywords: [] })
    expect(tag).not.toContain('keywords')
  })

  it('omits blank/whitespace keywords from the list', () => {
    const tag = formatMemoryMetadataTag({ keywords: ['real', '  ', '', 'also-real'] })
    expect(tag).toContain('keywords: real, also-real')
  })

  it('skips non-finite numbers', () => {
    const tag = formatMemoryMetadataTag({ importance: Number.NaN, relevance: 0.5, weight: Number.POSITIVE_INFINITY })
    expect(tag).not.toContain('importance')
    expect(tag).not.toContain('weight')
    expect(tag).toContain('relevance 0.50')
  })

  it('tolerates null/undefined per field', () => {
    const tag = formatMemoryMetadataTag({ importance: null, relevance: undefined, weight: 0.42, keywords: null })
    expect(tag).toContain('weight 0.42')
    expect(tag).not.toContain('importance')
    expect(tag).not.toContain('relevance')
    expect(tag).not.toContain('keywords')
  })
})

describe('memory-injector: metadata tag on delivered memories', () => {
  it('formatMemoriesForContext appends importance, relevance, weight, and keywords', () => {
    const m = memory('1', 'short summary', 'body text', {
      importance: 0.98,
      keywords: ['titles', 'load-bearing'],
    })
    const r = formatMemoriesForContext(
      [{ memory: m, score: 0.87, usedEmbedding: true, effectiveWeight: 0.92 }],
      1000,
      provider,
      SELF_SUBJECT,
    )
    expect(r.content).toContain('body text')
    expect(r.content).toContain('importance 0.98')
    expect(r.content).toContain('relevance 0.87')
    expect(r.content).toContain('weight 0.92')
    expect(r.content).toContain('keywords: titles, load-bearing')
  })

  it('formatInterCharacterMemoriesForContext appends importance, weight, and keywords (no relevance)', () => {
    const m = memory('1', 'lyra trusts iris', 'Lyra trusts Iris with the ledger', {
      importance: 0.9,
      keywords: ['trust', 'ledger'],
      aboutCharacterId: '00000000-0000-0000-0000-000000000c02',
    })
    const r = formatInterCharacterMemoriesForContext(
      [m],
      new Map([['00000000-0000-0000-0000-000000000c02', 'Iris']]),
      1000,
      provider,
    )
    expect(r.content).toContain('About Iris')
    expect(r.content).toContain('importance 0.90')
    expect(r.content).toContain('weight ') // effective weight is computed from importance + decay
    expect(r.content).toContain('keywords: trust, ledger')
    expect(r.content).not.toContain('relevance')
  })

  it('formatInterCharacterMemoriesForContext merges the relevance half with a relevance tag', () => {
    const iris = '00000000-0000-0000-0000-000000000c02'
    const importanceMem = memory('imp-1', 'iris likes tea', 'Iris always takes tea at four', {
      importance: 0.9,
      aboutCharacterId: iris,
    })
    const relevanceMem = memory('rel-1', 'iris fears storms', 'Iris flinches at thunder', {
      importance: 0.6,
      aboutCharacterId: iris,
    })
    const r = formatInterCharacterMemoriesForContext(
      [importanceMem],
      new Map([[iris, 'Iris']]),
      2000,
      provider,
      [searchResult(relevanceMem, 0.91)],
    )
    // Both halves present, relevance entry carries its score.
    expect(r.content).toContain('Iris always takes tea at four')
    expect(r.content).toContain('Iris flinches at thunder')
    expect(r.content).toContain('relevance 0.91')
    expect(r.memoriesUsed).toBe(2)
  })

  it('formatInterCharacterMemoriesForContext dedups a memory in both halves, keeping the relevance copy', () => {
    const iris = '00000000-0000-0000-0000-000000000c02'
    const shared = memory('dup-1', 'iris keeps the ledger', 'Iris guards the ledger closely', {
      importance: 0.8,
      aboutCharacterId: iris,
    })
    const r = formatInterCharacterMemoriesForContext(
      [shared],
      new Map([[iris, 'Iris']]),
      2000,
      provider,
      [searchResult(shared, 0.88)],
    )
    // Rendered exactly once, and with its relevance score (relevance copy wins).
    expect(r.memoriesUsed).toBe(1)
    expect(r.content).toContain('relevance 0.88')
    const occurrences = (r.content.match(/Iris guards the ledger closely/g) || []).length
    expect(occurrences).toBe(1)
  })

  it('formatFrozenMemoryArchive appends importance and keywords only (no weight, no relevance, byte-stable)', () => {
    const m = memory('a-id', 'frozen anchor entry', undefined, {
      importance: 0.81,
      keywords: ['anchor', 'stable'],
    })
    const r = formatFrozenMemoryArchive([m], 1000, provider, SELF_SUBJECT)
    expect(r.content).toContain('frozen anchor entry')
    expect(r.content).toContain('importance 0.81')
    expect(r.content).toContain('keywords: anchor, stable')
    expect(r.content).not.toContain('weight')
    expect(r.content).not.toContain('relevance')
  })

  it('formatFrozenMemoryArchive byte-stability is preserved after adding metadata', () => {
    const archive = [
      memory('a', 'alpha', undefined, { importance: 0.7, keywords: ['x'] }),
      memory('b', 'bravo', undefined, { importance: 0.8, keywords: ['y', 'z'] }),
    ]
    const first = formatFrozenMemoryArchive(archive, 1000, provider, SELF_SUBJECT)
    const second = formatFrozenMemoryArchive(archive, 1000, provider, SELF_SUBJECT)
    expect(second.content).toBe(first.content)
  })

  it('formatDynamicMemoryHead appends importance, relevance, weight, and keywords', () => {
    const m = memory('11111111-aaaa-bbbb-cccc-000000000001', 'first relevant', undefined, {
      importance: 0.95,
      keywords: ['recall', 'turn'],
    })
    const r = formatDynamicMemoryHead(
      [{ memory: m, score: 0.88, usedEmbedding: true, effectiveWeight: 0.83 }],
      provider,
      SELF_SUBJECT,
    )
    expect(r.content).toMatch(/\[m_1111\]/)
    expect(r.content).toContain('first relevant')
    expect(r.content).toContain('importance 0.95')
    expect(r.content).toContain('relevance 0.88')
    expect(r.content).toContain('weight 0.83')
    expect(r.content).toContain('keywords: recall, turn')
  })
})

/**
 * Bug 122 — a character's memory store holds what they remember about OTHER
 * people alongside their own, separated only by `aboutCharacterId`. All three
 * self-facing blocks are delivered under "You remember the following entries
 * that bear on this moment", so an unattributed line about someone else reads
 * as autobiography — and a weak model will answer the turn in that person's
 * voice, fluently and wrongly.
 *
 * Live failure: Kumar's archive carried "struggles to become offered mother"
 * (Marion's) and his head carried "reassured Marie about her wish" (Marion's),
 * both bare. He replied as Marion.
 */
describe('memory-injector: self-facing blocks attribute other characters (bug 122)', () => {
  const MARION_ID = '00000000-0000-0000-0000-0000000000c2'
  const subject = {
    selfCharacterId: SELF_ID,
    characterNames: new Map([[MARION_ID, 'Marion']]),
  }

  const marionMemory = (id: string, summary: string) =>
    memory(id, summary, summary, { aboutCharacterId: MARION_ID })

  it('formatMemorySubjectPrefix returns nothing for the character\'s own memories', () => {
    expect(formatMemorySubjectPrefix(SELF_ID, subject)).toBe('')
  })

  it('formatMemorySubjectPrefix returns nothing for an untargeted memory', () => {
    expect(formatMemorySubjectPrefix(null, subject)).toBe('')
    expect(formatMemorySubjectPrefix(undefined, subject)).toBe('')
  })

  it('formatMemorySubjectPrefix names another character', () => {
    expect(formatMemorySubjectPrefix(MARION_ID, subject)).toBe('About Marion: ')
  })

  it('formatMemorySubjectPrefix still prefixes an unresolvable subject', () => {
    // The name is a nicety; breaking the first-person reading is the job.
    expect(formatMemorySubjectPrefix('00000000-0000-0000-0000-00000000dead', subject)).toBe(
      'About another character: ',
    )
  })

  it('the frozen archive names the subject of a memory about someone else', () => {
    const r = formatFrozenMemoryArchive(
      [marionMemory('a-id', 'struggles to become offered mother')],
      1000,
      provider,
      subject,
    )
    expect(r.content).toContain('- About Marion: struggles to become offered mother')
  })

  it('the dynamic head names the subject of a memory about someone else', () => {
    const r = formatDynamicMemoryHead(
      [searchResult(marionMemory('11111111-aaaa-bbbb-cccc-000000000001', 'reassured Marie about her wish'))],
      provider,
      subject,
    )
    expect(r.content).toContain('About Marion: reassured Marie about her wish')
  })

  it('formatMemoriesForContext names the subject of a memory about someone else', () => {
    const r = formatMemoriesForContext(
      [searchResult(marionMemory('1', 'breastfed Camille in the pool'))],
      1000,
      provider,
      subject,
    )
    expect(r.content).toContain('About Marion: breastfed Camille in the pool')
  })

  it('leaves the character\'s own memories unprefixed in every self-facing block', () => {
    const own = memory('own-id', 'ran the trial sheet twice', 'ran the trial sheet twice', {
      aboutCharacterId: SELF_ID,
    })
    const archive = formatFrozenMemoryArchive([own], 1000, provider, subject)
    const head = formatDynamicMemoryHead([searchResult(own)], provider, subject)
    const relevant = formatMemoriesForContext([searchResult(own)], 1000, provider, subject)
    for (const content of [archive.content, head.content, relevant.content]) {
      expect(content).toContain('ran the trial sheet twice')
      expect(content).not.toContain('About ')
    }
  })

  it('keeps the frozen archive byte-stable once subjects are attributed', () => {
    const archive = [
      marionMemory('a-id', 'struggles to become offered mother'),
      memory('b-id', 'ran the trial sheet twice'),
    ]
    const first = formatFrozenMemoryArchive(archive, 1000, provider, subject)
    const second = formatFrozenMemoryArchive(archive, 1000, provider, subject)
    expect(first.content).toBe(second.content)
  })

  it('counts the prefix against the token budget rather than smuggling it past', () => {
    // The prefix is prose the model pays for, so it must be inside the
    // estimate: the same budget that fits N own-memory lines must fit fewer
    // attributed ones, and must still not overrun.
    const own = Array.from({ length: 12 }, (_, i) =>
      memory(`own-${i}`, `entry number ${i} in the archive`),
    )
    const others = Array.from({ length: 12 }, (_, i) =>
      marionMemory(`m-${i}`, `entry number ${i} in the archive`),
    )
    const bare = formatFrozenMemoryArchive(own, 120, provider, subject)
    const attributed = formatFrozenMemoryArchive(others, 120, provider, subject)
    expect(attributed.tokenCount).toBeLessThanOrEqual(120)
    expect(attributed.memoriesUsed).toBeLessThan(bare.memoriesUsed)
  })
})
