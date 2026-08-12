/**
 * Memory Weighting Module
 *
 * Provides a unified effective weight calculation for memories that combines
 * base importance with exponential time decay and a configurable importance floor.
 * Used across retrieval ranking, context injection, and housekeeping.
 */

import type { Memory } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'
import { eventReferenceTimeMs } from './episodic'

/**
 * Configuration for memory weight calculations.
 */
export interface MemoryWeightingConfig {
  /** Number of days for the decay factor to reach 0.5. Default: 30 */
  halfLifeDays: number
  /** Minimum fraction of importance that weight can decay to. Default: 0.70 */
  importanceFloor: number
  /** Memories with effective weight below this are candidates for filtering. Default: 0.05 */
  minWeightThreshold: number
}

export const DEFAULT_WEIGHTING_CONFIG: MemoryWeightingConfig = {
  halfLifeDays: 30,
  importanceFloor: 0.70,
  minWeightThreshold: 0.05,
}

export interface EffectiveWeightResult {
  effectiveWeight: number
  rawWeight: number
  minWeight: number
  timeDecayFactor: number
  daysOld: number
  baseImportance: number
}

/**
 * Decay reference point for a memory: `max(createdAt, lastReinforcedAt)`.
 *
 * Single source of truth for the invariant that passive retrieval
 * (`lastAccessedAt`) does NOT reset the decay clock — only creation or actual
 * reinforcement with new information does. Every decay/age calculation in this
 * module derives its reference time from here.
 */
export function referenceTimeMs(memory: Memory): number {
  const createdTime = new Date(memory.createdAt).getTime()
  const reinforcedTime = memory.lastReinforcedAt
    ? new Date(memory.lastReinforcedAt).getTime()
    : 0
  return Math.max(createdTime, reinforcedTime)
}

/**
 * Calculate the effective weight of a memory combining importance with time decay.
 *
 * Formula:
 *   daysOld = (now - max(createdAt, lastReinforcedAt)) / 86400000
 *   timeDecayFactor = 0.5 ^ (daysOld / halfLifeDays)
 *   rawWeight = reinforcedImportance × timeDecayFactor
 *   minWeight = reinforcedImportance × importanceFloor
 *   effectiveWeight = max(rawWeight, minWeight)
 *
 * Time decay is based on when the memory was created or last reinforced with
 * new information — NOT when it was last passively retrieved. This prevents
 * a feedback loop where popular old memories never decay because retrieval
 * keeps resetting their timer.
 *
 * Uses reinforcedImportance (falling back to importance) as the base value,
 * consistent with the rest of the memory system.
 */
export function calculateEffectiveWeight(
  memory: Memory,
  config: MemoryWeightingConfig = DEFAULT_WEIGHTING_CONFIG,
  now: Date = new Date()
): EffectiveWeightResult {
  const baseImportance = memory.reinforcedImportance ?? memory.importance

  // Use max(createdAt, lastReinforcedAt) as the reference time for decay.
  // Passive retrieval (lastAccessedAt) does NOT reset the decay timer —
  // only actual reinforcement with new information does.
  const referenceTime = referenceTimeMs(memory)

  const daysOld = Math.max(0, (now.getTime() - referenceTime) / 86400000)
  const timeDecayFactor = Math.pow(0.5, daysOld / config.halfLifeDays)
  const rawWeight = baseImportance * timeDecayFactor
  const minWeight = baseImportance * config.importanceFloor
  const effectiveWeight = Math.max(rawWeight, minWeight)

  return {
    effectiveWeight,
    rawWeight,
    minWeight,
    timeDecayFactor,
    daysOld,
    baseImportance,
  }
}

/**
 * Retrieval ranking blend.
 *
 * Every semantic/text retrieval path ranks candidates by a single blended key.
 * Relevance (cosine) is the *primary* sort key; importance/recency is a decaying
 * tie-breaker, NOT a floor. This is deliberately the no-floor `rawWeight`
 * (importance × time decay) rather than `effectiveWeight` — the 0.70 importance
 * floor in {@link DEFAULT_WEIGHTING_CONFIG} exists to protect important memories
 * from *housekeeping deletion* and must not leak into retrieval ranking, where it
 * gives high-importance memories a permanent score floor with zero topical match
 * (they then get whispered every turn regardless of topic).
 *
 * Centralized here because these coefficients were previously inlined at four
 * call sites in memory-service.ts and drifted out of view. All four call
 * {@link computeRankingBlend}.
 */
export const RANKING_RELEVANCE_WEIGHT = 0.75
export const RANKING_PRIORITY_WEIGHT = 0.25

/**
 * Blend a candidate's relevance (cosine, 0–1) with its decaying priority
 * (`rawWeight` from {@link calculateEffectiveWeight}, no floor). Returns the
 * ranking key; recall-tag and anti-repetition multipliers are applied to this
 * value *afterward* (see lib/memory/recall-tags.ts).
 */
export function computeRankingBlend(cosine: number, rawWeight: number): number {
  return RANKING_RELEVANCE_WEIGHT * cosine + RANKING_PRIORITY_WEIGHT * rawWeight
}

/**
 * Default minimum *cosine* (raw relevance) for a memory to be eligible for
 * recall, below which it is dropped before the blend. Two embedding scales
 * coexist and distribute very differently, so the floor is provider-aware:
 * neural API embeddings live in a compressed band (~0.25 unrelated, ~0.45–0.75
 * related), while the built-in TF-IDF profile produces much sparser cosines.
 * A single global floor would silently break one of them.
 *
 * Starting points — tune against real chats via the per-turn debug output
 * before tightening.
 */
export const DEFAULT_MIN_COSINE_NEURAL = 0.30
export const DEFAULT_MIN_COSINE_TFIDF = 0.10

/**
 * Resolve the default relevance floor for an embedding profile's provider.
 * `BUILTIN` is the local TF-IDF provider; everything else is a neural API
 * provider (OPENAI / OLLAMA / OPENROUTER).
 */
export function defaultMinCosineForProvider(provider: string | undefined | null): number {
  return provider === 'BUILTIN' ? DEFAULT_MIN_COSINE_TFIDF : DEFAULT_MIN_COSINE_NEURAL
}

/**
 * Format a memory's age as a human-readable relative time label.
 * Used for temporal context in LLM memory injection.
 *
 * Episodic spine: the label reads off the EVENT clock — `occurredAt` when
 * present, else the write/reinforce clock — so "last week" means when it
 * happened, not when it was written down. Decay (above) deliberately stays on
 * the write clock; only the human-facing age label follows the event.
 */
export function formatRelativeAge(memory: Memory, now: Date = new Date()): string {
  const referenceTime = eventReferenceTimeMs(memory.occurredAt, referenceTimeMs(memory))
  const daysOld = Math.max(0, (now.getTime() - referenceTime) / 86400000)

  if (daysOld < 1) return 'today'
  if (daysOld < 2) return 'yesterday'
  if (daysOld < 7) return `${Math.floor(daysOld)} days ago`
  if (daysOld < 14) return 'last week'
  if (daysOld < 30) return `${Math.floor(daysOld / 7)} weeks ago`
  if (daysOld < 60) return 'last month'
  if (daysOld < 365) return `${Math.floor(daysOld / 30)} months ago`
  return `${Math.floor(daysOld / 365)} year${Math.floor(daysOld / 365) > 1 ? 's' : ''} ago`
}

/**
 * Configuration for the housekeeping protection score.
 *
 * Distinct from retrieval ranking: protection decay runs on a longer half-life
 * with a lower floor, and the score blends the LLM-derived content signal with
 * usage evidence (reinforcement, graph degree, recency of access) so a memory's
 * fate doesn't hinge on the LLM's one-shot importance guess.
 */
export interface ProtectionScoreConfig {
  /** Content-score half-life in days. Default: 30. The original 365-day
   * default protected fresh LLM-scored memories indefinitely on heavy
   * characters (a 1-day-old memory at importance 0.7 scored ~0.70, well
   * above the 0.5 threshold), so the cap-enforcement pass deleted zero
   * rows on a 19.5k-memory character and pinned the main thread for
   * 15 minutes per run. 30 days gives young memories ~40% content score
   * after a month, letting the usage bonuses (reinforcement / graph / recent
   * access) — not just the LLM's one-shot importance guess — decide what
   * stays. */
  contentHalfLifeDays: number
  /** Minimum fraction of the content score that decay cannot erode past. Default: 0.10 */
  contentFloor: number
  /** Maximum bonus from reinforcement count (saturates via log2). Default: 0.25 */
  maxReinforcementBonus: number
  /** Per-reinforcement coefficient (applied to log2(count+1)). Default: 0.08 */
  reinforcementCoeff: number
  /** Maximum bonus from graph degree (related-memory links). Default: 0.10 */
  maxGraphDegreeBonus: number
  /** Per-link coefficient. Default: 0.025 */
  graphDegreeCoeff: number
  /** Bonus when lastAccessedAt is within the recency window. Default: 0.10 */
  recentAccessBonus: number
  /** Recent-access window in days. Default: 90 */
  recentAccessWindowDays: number
  /** Maximum contribution the content component alone can make to the
   * protection score. Default: 0.40. Without this cap, an LLM-rated 0.7+
   * memory scores above the 0.5 protection threshold on content alone —
   * which, on a heavy character where 97% of memories are under a month
   * old, means the cap-enforcement pass protects essentially everything.
   * Capping content forces a memory to earn the remaining headroom from
   * usage evidence (reinforcement count, graph degree, or recent access)
   * to cross the threshold. Honors the blended-score design goal of
   * "LLM opinion is one input among several, not a final verdict." */
  maxContentContribution: number
  /** Additive bonus for `kind: 'episodic'` rows. Default: 0.10. Episodic
   * memories carry the exact statistical profile housekeeping deletes first
   * (low importance, low reinforcement, low graph degree) yet are the hardest
   * to regenerate — a one-off visit never recurs to be re-extracted. The
   * vault Timeline is the durable backstop, but the memory ROW is what
   * per-turn retrieval actually hits, so it should be the last to go. */
  episodicBonus: number
}

export const DEFAULT_PROTECTION_CONFIG: ProtectionScoreConfig = {
  contentHalfLifeDays: 30,
  contentFloor: 0.10,
  maxReinforcementBonus: 0.25,
  reinforcementCoeff: 0.08,
  maxGraphDegreeBonus: 0.10,
  graphDegreeCoeff: 0.025,
  recentAccessBonus: 0.10,
  recentAccessWindowDays: 90,
  maxContentContribution: 0.40,
  episodicBonus: 0.10,
}

export interface ProtectionScoreResult {
  /** Final blended score in [0, 1]. Compare against a protection threshold. */
  score: number
  contentComponent: number
  reinforcementBonus: number
  graphDegreeBonus: number
  recentAccessBonus: number
  episodicBonus: number
  daysSinceRefTime: number
}

/**
 * Calculate a blended protection score for the housekeeping gate.
 *
 * Combines four evidence streams:
 *   1. Content score (LLM-derived importance), time-decayed with a low floor
 *   2. Reinforcement count (log2-saturated — first few reinforcements matter most)
 *   3. Graph degree (count of relatedMemoryIds — links imply centrality)
 *   4. Recent access (binary bonus if accessed within the recency window)
 *
 * Time-decay reference point is max(createdAt, lastReinforcedAt): passive
 * retrieval does NOT reset the clock, consistent with calculateEffectiveWeight.
 */
export function calculateProtectionScore(
  memory: Memory,
  config: ProtectionScoreConfig = DEFAULT_PROTECTION_CONFIG,
  now: Date = new Date()
): ProtectionScoreResult {
  const baseImportance = memory.reinforcedImportance ?? memory.importance

  const referenceTime = referenceTimeMs(memory)
  const daysSinceRefTime = Math.max(0, (now.getTime() - referenceTime) / 86400000)

  const decay = Math.pow(0.5, daysSinceRefTime / config.contentHalfLifeDays)
  const contentComponent = Math.min(
    config.maxContentContribution,
    baseImportance * Math.max(decay, config.contentFloor)
  )

  const reinforcementCount = memory.reinforcementCount ?? 1
  const reinforcementBonus = Math.min(
    config.maxReinforcementBonus,
    Math.log2(reinforcementCount + 1) * config.reinforcementCoeff
  )

  const graphDegree = memory.relatedMemoryIds?.length ?? 0
  const graphDegreeBonus = Math.min(
    config.maxGraphDegreeBonus,
    graphDegree * config.graphDegreeCoeff
  )

  let recentAccessBonus = 0
  if (memory.lastAccessedAt) {
    const daysSinceAccess = (now.getTime() - new Date(memory.lastAccessedAt).getTime()) / 86400000
    if (daysSinceAccess < config.recentAccessWindowDays) {
      recentAccessBonus = config.recentAccessBonus
    }
  }

  // Episodic protection bump: one-off dated occurrences are the first thing
  // the retention rules would otherwise delete and the hardest to regenerate.
  const episodicBonus = memory.kind === 'episodic' ? config.episodicBonus : 0

  const score = Math.min(
    1,
    contentComponent + reinforcementBonus + graphDegreeBonus + recentAccessBonus + episodicBonus
  )

  return {
    score,
    contentComponent,
    reinforcementBonus,
    graphDegreeBonus,
    recentAccessBonus,
    episodicBonus,
    daysSinceRefTime,
  }
}

/**
 * Rank memories by effective weight in descending order.
 * Optionally filters out memories below the minimum weight threshold.
 */
export function rankMemoriesByWeight(
  memories: Memory[],
  config: MemoryWeightingConfig = DEFAULT_WEIGHTING_CONFIG,
  now: Date = new Date()
): Array<{ memory: Memory; weightResult: EffectiveWeightResult }> {
  const weighted = memories.map(memory => ({
    memory,
    weightResult: calculateEffectiveWeight(memory, config, now),
  }))

  const filtered = weighted.filter(
    ({ weightResult }) => weightResult.effectiveWeight >= config.minWeightThreshold
  )

  filtered.sort((a, b) => b.weightResult.effectiveWeight - a.weightResult.effectiveWeight)

  return filtered
}
