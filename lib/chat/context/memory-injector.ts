/**
 * Memory Injector
 *
 * Formats memories for injection into LLM context.
 * Handles both character memories and inter-character memories.
 */

import { createHash } from 'node:crypto'
import type { Provider, Memory } from '@/lib/schemas/types'
import type { SceneState } from '@/lib/schemas/chat.types'
import { estimateTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { calculateEffectiveWeight, formatRelativeAge } from '@/lib/memory/memory-weighting'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'

/**
 * Per-target emission record for a single character's slice of the
 * Commonplace Book scene-state whisper. Persisted on
 * `chats.commonplaceSceneCache` so the next emission to the same target
 * can collapse the character's section to "_unchanged_" when both hashes
 * match.
 */
export interface SceneStateEmissionEntry {
  /** Short hash of the character's `action` text, after trim. */
  actionHash: string
  /** Short hash of the character's clothing text (live override or cached). */
  clothingHash: string
  /** ISO timestamp of the most recent FULL emission of this character's
   *  section to this target. Carried forward unchanged across compact
   *  emissions so the timestamp tracks the last time the content actually
   *  changed — useful for diagnostics and for the LLM to know how stale
   *  the cached scene is. */
  emittedAt: string
}

const SCENE_HASH_LENGTH = 16

function sceneHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, SCENE_HASH_LENGTH)
}

/** Phase 3b: hard cap on the dynamic-head rank instruction. */
export const DYNAMIC_HEAD_TOKEN_BUDGET = 200
/** Phase 3b: how many rank-instruction entries to attempt. */
export const DYNAMIC_HEAD_DEFAULT_SIZE = 5

/**
 * Recall-on-reference (episodic overhaul): a retrospective turn — the user is
 * invoking past shared events — gets an enlarged head, because that is
 * exactly the turn that needs rich recall. Tuning knobs; validate against
 * real chats via the recall-replay harness before tightening.
 */
export const RETRO_HEAD_TOKEN_BUDGET = 600
/** Enlarged entry count for retrospective turns. */
export const RETRO_HEAD_SIZE = 10

/**
 * Build the trailing metadata tag appended to a delivered memory line so the
 * receiving model (and the human reading the Commonplace Book whisper in the
 * salon) can see *why* a particular entry surfaced — what the LLM judged at
 * extraction time (`importance`), how well it matched this turn's recall query
 * (`relevance`, when available), how the ranker weighed it (`weight`, when
 * computed), and what the keywords are.
 *
 * Returns `''` when no fields are provided so callers can append unconditionally.
 *
 * Format: ` _(importance 0.98 · relevance 0.87 · weight 0.92 · keywords: a, b)_`
 * — leading space, italicised parenthetical, middle-dot separators, trailing
 * keywords list when non-empty. Numbers are rounded to 2 decimals to match the
 * `db memories show` style.
 */
export function formatMemoryMetadataTag(opts: {
  importance?: number | null
  relevance?: number | null
  weight?: number | null
  keywords?: readonly string[] | null
  /**
   * Short labels for the recall-context adjustments that fired for this memory
   * (e.g. `narrow✓`, `past↓`), so the salon whisper shows *why* it ranked where
   * it did. Omitted when no recallContext drove the search.
   */
  adjustments?: readonly string[] | null
}): string {
  const parts: string[] = []
  if (typeof opts.importance === 'number' && Number.isFinite(opts.importance)) {
    parts.push(`importance ${opts.importance.toFixed(2)}`)
  }
  if (typeof opts.relevance === 'number' && Number.isFinite(opts.relevance)) {
    parts.push(`relevance ${opts.relevance.toFixed(2)}`)
  }
  if (typeof opts.weight === 'number' && Number.isFinite(opts.weight)) {
    parts.push(`weight ${opts.weight.toFixed(2)}`)
  }
  if (opts.adjustments && opts.adjustments.length > 0) {
    const trimmed = opts.adjustments.map(a => a.trim()).filter(a => a.length > 0)
    if (trimmed.length > 0) {
      parts.push(`recall: ${trimmed.join(' ')}`)
    }
  }
  if (opts.keywords && opts.keywords.length > 0) {
    const trimmed = opts.keywords.map(k => k.trim()).filter(k => k.length > 0)
    if (trimmed.length > 0) {
      parts.push(`keywords: ${trimmed.join(', ')}`)
    }
  }
  if (parts.length === 0) return ''
  return ` _(${parts.join(' · ')})_`
}

/**
 * Debug info for included memories
 */
export interface DebugMemoryInfo {
  /** The memory's id — lets callers track which entries were whispered (anti-repetition). */
  memoryId?: string
  summary: string
  importance: number
  score: number
  effectiveWeight: number
  /** No-floor ranking weight (importance × time decay) — the term the blend uses. */
  rawWeight?: number
  /** Combined recall-context multiplier, when a recallContext drove the ranking. */
  recallMultiplier?: number
  /** Labels for the adjustments that fired (e.g. `narrow✓`, `past↓`). */
  recallFired?: string[]
  /** Ranking blend (RELEVANCE·cosine + PRIORITY·rawWeight) before the recall multiplier. */
  blendedBefore?: number
  /** Blended score after the recall multiplier (what the head ranks on). */
  blendedAfter?: number
}

/**
 * Debug info for inter-character memories
 */
export interface DebugInterCharacterMemoryInfo {
  aboutCharacterName: string
  summary: string
  importance: number
}

/**
 * Result of formatting memories for context
 */
export interface FormattedMemoriesResult {
  content: string
  tokenCount: number
  memoriesUsed: number
  debugMemories: DebugMemoryInfo[]
}

/**
 * Result of formatting inter-character memories for context
 */
export interface FormattedInterCharacterMemoriesResult {
  content: string
  tokenCount: number
  memoriesUsed: number
  debugMemories: DebugInterCharacterMemoryInfo[]
}

/**
 * Render the latest scene-state snapshot as the `## Current State` section
 * for the Commonplace Book whisper. Returns `''` when no scene state is
 * available so callers can treat the section as absent.
 *
 * `time` is the chat's announced timestamp (the same string the Host
 * announces); pass `null`/`undefined` when the chat is not announcing time
 * and the Time line is dropped entirely.
 *
 * `liveClothingByCharacterId` lets the caller override each character's
 * clothing line with a freshly-rendered description of their currently
 * equipped wardrobe slots. The cached `c.clothing` from scene state is only
 * refreshed at turn boundaries, so passing live values here keeps the
 * responding character's prompt in sync with mid-turn wardrobe edits and
 * `wardrobe_*` tool calls.
 *
 * `priorEmissionByCharacter` is the per-target emission cache from the most
 * recent Commonplace Book whisper for the same recipient. When a
 * character's current (action, clothing) hashes match the cached pair,
 * their section collapses to a single `### Name — _unchanged_` line; the
 * cached `emittedAt` is preserved on the returned `emittedByCharacter` so
 * subsequent compact emissions don't reset the timestamp. The caller
 * persists the returned map back to `chat.commonplaceSceneCache[target]`.
 */
export function formatCurrentSceneState(
  sceneState: SceneState | null | undefined,
  time: string | null | undefined,
  provider?: Provider,
  liveClothingByCharacterId?: ReadonlyMap<string, string>,
  priorEmissionByCharacter?: ReadonlyMap<string, SceneStateEmissionEntry>,
): {
  content: string
  tokenCount: number
  emittedByCharacter: Map<string, SceneStateEmissionEntry>
} {
  if (!sceneState) {
    return { content: '', tokenCount: 0, emittedByCharacter: new Map() }
  }

  const characters = Array.isArray(sceneState.characters) ? sceneState.characters : []
  const names = characters.map(c => c.characterName).filter(n => typeof n === 'string' && n.length > 0)

  const lines: string[] = ['## Current State', '']
  lines.push(`- **Location**: ${sceneState.location || 'Unknown'}`)
  lines.push(`- **Characters Present**: ${names.join(', ')}`)
  if (time && time.trim().length > 0) {
    lines.push(`- **Time**: ${time.trim()}`)
  }
  lines.push('- **Active Now**: true')

  const nowIso = new Date().toISOString()
  const emittedByCharacter = new Map<string, SceneStateEmissionEntry>()

  for (const c of characters) {
    if (!c.characterName) continue

    const actionText = (c.action ?? '').trim() || '_unspecified_'
    const liveClothing = liveClothingByCharacterId?.get(c.characterId)?.trim()
    const clothingText = liveClothing || (c.clothing ?? '').trim() || '_unspecified_'
    const actionHash = sceneHash(actionText)
    const clothingHash = sceneHash(clothingText)

    const prior = c.characterId ? priorEmissionByCharacter?.get(c.characterId) : undefined
    const unchanged = !!prior && prior.actionHash === actionHash && prior.clothingHash === clothingHash

    lines.push('')
    if (unchanged) {
      // Compact: skip the full Action + Clothing prose. The prior whisper
      // already conveyed it; the recipient's LLM client (or the Courier
      // delta consumer) still remembers.
      lines.push(`### ${c.characterName} — _unchanged_`)
    } else {
      lines.push(`### ${c.characterName}`)
      lines.push('')
      lines.push('#### Action')
      lines.push('')
      lines.push(actionText)
      lines.push('')
      lines.push('#### Clothing')
      lines.push('')
      lines.push(clothingText)
    }

    if (c.characterId) {
      emittedByCharacter.set(c.characterId, {
        actionHash,
        clothingHash,
        // Preserve the prior timestamp when nothing changed — it tracks
        // the last time the section was *actually* re-emitted in full.
        emittedAt: unchanged && prior ? prior.emittedAt : nowIso,
      })
    }
  }

  const content = lines.join('\n')
  const tokenCount = estimateTokens(content + '\n', provider)
  return { content, tokenCount, emittedByCharacter }
}

/**
 * Format memories for injection into context
 */
export function formatMemoriesForContext(
  memories: SemanticSearchResult[],
  maxTokens: number,
  provider: Provider
): FormattedMemoriesResult {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const memoryParts: string[] = ['## Relevant Memories']
  let currentTokens = estimateTokens('## Relevant Memories\n', provider)
  let memoriesUsed = 0
  const debugMemories: DebugMemoryInfo[] = []

  // Calculate effective weights and sort by weight (primary), score (tiebreaker)
  const memoriesWithWeight = memories.map(r => ({
    ...r,
    weight: r.effectiveWeight ?? calculateEffectiveWeight(r.memory).effectiveWeight,
  }))

  const sortedMemories = memoriesWithWeight.sort((a, b) => {
    const weightDiff = b.weight - a.weight
    if (Math.abs(weightDiff) > 0.05) return weightDiff
    return b.score - a.score
  })

  const now = new Date()

  for (const { memory, score, weight } of sortedMemories) {
    // Use full content (not summary) so the whisper carries the same nuance the
    // model formed at extraction time. Summary is the cache-friendly form for
    // recap LLM inputs, but the per-line whisper has the budget for the body.
    const age = formatRelativeAge(memory, now)
    const narrative = memory.narrativeTime?.trim()
    const body = memory.content?.trim() || memory.summary
    const meta = formatMemoryMetadataTag({
      importance: memory.importance,
      relevance: score,
      weight,
      keywords: memory.keywords,
    })
    const memoryLine = `- [${narrative ? `${age} · ${narrative}` : age}] ${body}${meta}`
    const lineTokens = estimateTokens(memoryLine + '\n', provider)

    if (currentTokens + lineTokens > maxTokens) {
      break
    }

    memoryParts.push(memoryLine)
    currentTokens += lineTokens
    memoriesUsed++
    debugMemories.push({
      summary: memory.summary,
      importance: memory.importance,
      score,
      effectiveWeight: weight,
    })
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Format inter-character memories for injection into context.
 *
 * These are memories the responding character holds about other characters in
 * the chat, drawn from two sources and merged per other-character:
 *
 * - **Importance/recency half** — `importanceMemories`, from the direct DB query
 *   (`findByCharacterAboutCharacters`), which has no per-turn relevance score.
 * - **Relevance half** — `relevanceResults`, from a semantic search filtered by
 *   `aboutCharacterId`, which carries a per-turn cosine relevance score.
 *
 * Within each character the two halves are deduped by memory id (a memory pulled
 * by both stays once, kept in the relevance half so it renders with its score)
 * and interleaved relevance-first, so the block stays roughly half "most
 * important about them" + half "most relevant to right now about them" until one
 * source for that character is exhausted. The combined output is then trimmed to
 * `maxTokens`.
 */
export function formatInterCharacterMemoriesForContext(
  importanceMemories: Memory[],
  characterNames: Map<string, string>, // aboutCharacterId -> character name
  maxTokens: number,
  provider: Provider,
  relevanceResults: SemanticSearchResult[] = []
): FormattedInterCharacterMemoriesResult {
  if (importanceMemories.length === 0 && relevanceResults.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const memoryParts: string[] = ['## Memories About Other Characters']
  let currentTokens = estimateTokens('## Memories About Other Characters\n', provider)
  let memoriesUsed = 0
  const debugMemories: DebugInterCharacterMemoryInfo[] = []

  // Group both sources by the about-character.
  const relevanceByCharacter = new Map<string, SemanticSearchResult[]>()
  for (const result of relevanceResults) {
    const aboutId = result.memory.aboutCharacterId
    if (!aboutId) continue
    const existing = relevanceByCharacter.get(aboutId) || []
    existing.push(result)
    relevanceByCharacter.set(aboutId, existing)
  }
  const importanceByCharacter = new Map<string, Memory[]>()
  for (const memory of importanceMemories) {
    if (!memory.aboutCharacterId) continue
    const existing = importanceByCharacter.get(memory.aboutCharacterId) || []
    existing.push(memory)
    importanceByCharacter.set(memory.aboutCharacterId, existing)
  }

  // Iterate relevance-keyed characters first, then any importance-only ones.
  const characterIds = new Set<string>([
    ...relevanceByCharacter.keys(),
    ...importanceByCharacter.keys(),
  ])

  const now = new Date()
  for (const characterId of characterIds) {
    const characterName = characterNames.get(characterId) || 'Unknown'

    // Relevance half — sorted by cosine score, carries its relevance.
    const relevanceEntries = (relevanceByCharacter.get(characterId) ?? [])
      .map(r => ({
        memory: r.memory,
        weight: r.effectiveWeight ?? calculateEffectiveWeight(r.memory).effectiveWeight,
        relevance: r.score as number | null,
      }))
      .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))

    // Importance half — sorted by effective weight, excluding ids already in the
    // relevance half (dedup leans toward keeping the relevance copy).
    const relevanceIds = new Set(relevanceEntries.map(e => e.memory.id))
    const importanceEntries = (importanceByCharacter.get(characterId) ?? [])
      .filter(m => !relevanceIds.has(m.id))
      .map(m => ({
        memory: m,
        weight: calculateEffectiveWeight(m).effectiveWeight,
        relevance: null as number | null,
      }))
      .sort((a, b) => b.weight - a.weight)

    // Interleave relevance-first so the per-character block stays ~half/half.
    const ordered: Array<{ memory: Memory; weight: number; relevance: number | null }> = []
    let ri = 0
    let ii = 0
    while (ri < relevanceEntries.length || ii < importanceEntries.length) {
      if (ri < relevanceEntries.length) ordered.push(relevanceEntries[ri++])
      if (ii < importanceEntries.length) ordered.push(importanceEntries[ii++])
    }

    for (const { memory, weight, relevance } of ordered) {
      const age = formatRelativeAge(memory, now)
      const body = memory.content?.trim() || memory.summary
      const meta = formatMemoryMetadataTag({
        importance: memory.importance,
        relevance,
        weight,
        keywords: memory.keywords,
      })
      const memoryLine = `- About ${characterName}: [${age}] ${body}${meta}`
      const lineTokens = estimateTokens(memoryLine + '\n', provider)

      if (currentTokens + lineTokens > maxTokens) {
        break
      }

      memoryParts.push(memoryLine)
      currentTokens += lineTokens
      memoriesUsed++
      debugMemories.push({
        aboutCharacterName: characterName,
        summary: memory.summary,
        importance: memory.importance,
      })
    }
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Phase 3a: Format the frozen-archive memory pool for context.
 *
 * The archive is a stable per-generation slice (already sorted by `memory.id`
 * by the caller — see `frozen-archive-cache.ts`). The output uses
 * `memory.summary` rather than `memory.content` so the bytes stay compact and
 * the cache prefix doesn't bloat. No per-turn re-ranking is performed: order
 * follows the input array verbatim so prefix-cache bytes are byte-stable
 * across turns within a generation.
 */
export function formatFrozenMemoryArchive(
  memories: Memory[],
  maxTokens: number,
  provider: Provider,
): FormattedMemoriesResult {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const header = '## Memory Anchors'
  const memoryParts: string[] = [header]
  let currentTokens = estimateTokens(`${header}\n`, provider)
  let memoriesUsed = 0
  const debugMemories: DebugMemoryInfo[] = []

  for (const memory of memories) {
    const summary = memory.summary?.trim() || memory.content?.trim() || ''
    if (!summary) continue

    // The frozen archive is byte-stable across turns within a generation, so
    // only static per-memory fields belong here. `weight` (decayed by now()) and
    // `relevance` (per-turn query similarity) would both break the prefix-cache
    // invariant — keep them off these lines.
    const meta = formatMemoryMetadataTag({
      importance: memory.importance,
      keywords: memory.keywords,
    })
    const memoryLine = `- ${summary}${meta}`
    const lineTokens = estimateTokens(`${memoryLine}\n`, provider)
    if (currentTokens + lineTokens > maxTokens) {
      break
    }

    memoryParts.push(memoryLine)
    currentTokens += lineTokens
    memoriesUsed++
    debugMemories.push({
      summary: memory.summary,
      importance: memory.importance,
      score: 0,
      effectiveWeight: 0,
    })
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Phase 3b: Format a compact "dynamic head" rank instruction for the user-
 * message tail. Hard-capped at `DYNAMIC_HEAD_TOKEN_BUDGET` tokens. Uses
 * `memory.summary` (not full content) and a short id prefix so the LLM can
 * cite the relevant entry without the prompt bloating per turn. Caller is
 * expected to pre-filter out memories already present in the frozen archive.
 */
export function formatDynamicMemoryHead(
  memories: SemanticSearchResult[],
  provider: Provider,
  options: { maxTokens?: number; maxEntries?: number } = {},
): FormattedMemoriesResult {
  const maxTokens = options.maxTokens ?? DYNAMIC_HEAD_TOKEN_BUDGET
  const maxEntries = options.maxEntries ?? DYNAMIC_HEAD_DEFAULT_SIZE

  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const ranked = memories
    .map(r => ({
      ...r,
      weight: r.effectiveWeight ?? calculateEffectiveWeight(r.memory).effectiveWeight,
    }))
    .sort((a, b) => {
      // When recall adjustments are present (a recallContext was supplied to
      // searchMemoriesSemantic), rank by the post-adjustment blended score so the
      // scope/temporal multipliers actually drive head ordering — otherwise this
      // re-sort would undo them. Falls back to the historical weight-then-score
      // heuristic when absent, so behavior is byte-identical with no recallContext.
      const aAdj = a.recallAdjustment?.blendedAfter
      const bAdj = b.recallAdjustment?.blendedAfter
      if (aAdj !== undefined && bAdj !== undefined) {
        return bAdj - aAdj
      }
      const weightDiff = b.weight - a.weight
      if (Math.abs(weightDiff) > 0.05) return weightDiff
      return b.score - a.score
    })
    .slice(0, maxEntries)

  const header = 'Most relevant memories for this turn:'
  const entries: string[] = []
  const debugMemories: DebugMemoryInfo[] = []
  // Reserve token budget for the header + final newline.
  let currentTokens = estimateTokens(`${header}\n`, provider)
  let memoriesUsed = 0

  const now = new Date()
  for (const { memory, score, weight, rawWeight, recallAdjustment } of ranked) {
    const summary = memory.summary?.trim() || memory.content?.trim() || ''
    if (!summary) continue
    const idTag = `[m_${memory.id.slice(0, 4)}]`
    // Episodic spine: date every head entry. The age label reads off the
    // event clock (occurredAt ?? write clock — see formatRelativeAge), and
    // narrativeTime rides along verbatim so fictional-timeline anchors reach
    // the model too. Without this, even a retrieval hit couldn't confirm
    // "last week".
    const age = formatRelativeAge(memory, now)
    const narrative = memory.narrativeTime?.trim()
    const whenTag = narrative ? `[${age} · ${narrative}]` : `[${age}]`
    const meta = formatMemoryMetadataTag({
      importance: memory.importance,
      relevance: score,
      weight,
      keywords: memory.keywords,
      adjustments: recallAdjustment?.fired,
    })
    const entry = `${idTag} ${whenTag} ${summary}${meta}`
    const candidateTokens = estimateTokens(`${entry}\n`, provider)
    if (currentTokens + candidateTokens > maxTokens) {
      break
    }
    entries.push(entry)
    currentTokens += candidateTokens
    memoriesUsed++
    debugMemories.push({
      memoryId: memory.id,
      summary: memory.summary,
      importance: memory.importance,
      score,
      effectiveWeight: weight,
      rawWeight,
      recallMultiplier: recallAdjustment?.multiplier,
      recallFired: recallAdjustment?.fired,
      blendedBefore: recallAdjustment?.blendedBefore,
      blendedAfter: recallAdjustment?.blendedAfter,
    })
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: `${header}\n${entries.join('\n')}`,
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Format conversation summary for context
 */
export function formatSummaryForContext(
  summary: string,
  maxTokens: number,
  provider: Provider
): { content: string; tokenCount: number } {
  if (!summary || summary.trim().length === 0) {
    return { content: '', tokenCount: 0 }
  }

  const header = '## Previous Conversation Summary'
  const fullContent = `${header}\n${summary}`
  const fullTokens = estimateTokens(fullContent, provider)

  if (fullTokens <= maxTokens) {
    return { content: fullContent, tokenCount: fullTokens }
  }

  // Truncate summary to fit
  const headerTokens = estimateTokens(header + '\n', provider)
  const availableForSummary = maxTokens - headerTokens
  const truncatedSummary = truncateToTokenLimit(summary, availableForSummary, provider)

  return {
    content: `${header}\n${truncatedSummary}`,
    tokenCount: estimateTokens(`${header}\n${truncatedSummary}`, provider),
  }
}
