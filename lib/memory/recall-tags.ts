/**
 * Recall-side targeting-tag reading.
 *
 * The memory extractor (`lib/memory/cheap-llm-tasks/memory-tasks.ts`) materializes
 * three controlled targeting tags into every memory's `keywords` array:
 *   - temporal : bare word  — past | moment | present | future
 *   - scope    : `scope: narrow` | `scope: wide`
 *   - context  : bare word  — philosophy | relationships | history | banter |
 *                              mannerisms | trivia | information
 *
 * This module reads them back at recall time and turns them into bounded,
 * clamped multipliers on the already-computed blended recall score: scope+project
 * gating and temporal down-weighting (items 1–2) read the memory's own tags;
 * context steering and participant boost (items 3–4) compare against turn-level
 * signals carried on the RecallContext. It is the single source of truth for the
 * closed vocabularies — the extraction path imports the Sets from here, so the
 * two sides can never drift.
 *
 * Pure + I/O-free — no logging, no DB, no LLM — so it is trivially unit-testable
 * and safe to import from the forked job child.
 */

export type TemporalTag = 'past' | 'moment' | 'present' | 'future'
export type ScopeTag = 'narrow' | 'wide'
export type ContextTag =
  | 'philosophy'
  | 'relationships'
  | 'history'
  | 'banter'
  | 'mannerisms'
  | 'trivia'
  | 'information'

/** Closed vocabularies for the three targeting axes (single source of truth). */
export const TEMPORAL_VALUES: ReadonlySet<string> = new Set<TemporalTag>([
  'past',
  'moment',
  'present',
  'future',
])
export const SCOPE_VALUES: ReadonlySet<string> = new Set<ScopeTag>(['narrow', 'wide'])
export const CONTEXT_VALUES: ReadonlySet<string> = new Set<ContextTag>([
  'philosophy',
  'relationships',
  'history',
  'banter',
  'mannerisms',
  'trivia',
  'information',
])

/**
 * Defaults MUST match the extraction-side defaults in `applyTargetingTags`
 * (memory-tasks.ts). A legacy/untagged memory therefore reads as
 * present / wide / information and is never penalized for missing data.
 */
export const DEFAULT_TEMPORAL: TemporalTag = 'present'
export const DEFAULT_SCOPE: ScopeTag = 'wide'
export const DEFAULT_CONTEXT: ContextTag = 'information'

export interface TargetingTags {
  temporal: TemporalTag
  scope: ScopeTag
  context: ContextTag
}

/** Policy for what to do with a cross-project `scope: narrow` memory at recall. */
export type ScopePolicy = 'down-weight' | 'exclude'

/**
 * Per-turn recall context threaded from the chat/turn into
 * `searchMemoriesSemantic`. Absent → recall behaves byte-identically to its
 * historical (pre-targeting) form.
 *
 * Phase 1 wires `currentProjectId` + `scopePolicy` (items 1–2). Phase 2 adds the
 * remaining fields: `turnContext` (item 3 context steering), `presentAboutCharacterIds`
 * (item 4 participant boost), and `expandRelated` (item 5 one-hop expansion).
 * The episodic recall overhaul adds `turnRetrospective` (flips the temporal
 * multipliers and suspends anti-repetition) and `occurredWithin` (time-window
 * boost) — temporal weighting still reads each memory's own `temporal` tag,
 * but the retrospective flag decides which direction it cuts.
 */
export interface RecallContext {
  /** The current chat's project (`chat.projectId`), or null when project-less. */
  currentProjectId: string | null
  /** What to do with a cross-project `scope: narrow` memory. */
  scopePolicy: ScopePolicy
  /**
   * IDs of the characters present in the room this turn — the responding
   * character plus every other character participant. A memory whose
   * `aboutCharacterId` is in this set is boosted (item 4). Empty/undefined →
   * no participant boost.
   */
  presentAboutCharacterIds?: readonly string[]
  /**
   * The turn's dominant `context` axis, guessed by the unified keyword
   * distillation. A memory whose own `context` tag matches is boosted (item 3).
   * Null/undefined → no context steering.
   */
  turnContext?: ContextTag | null
  /**
   * The turn's dominant `temporal` axis (same cheap-LLM guess). Carried for
   * debug logging; the retrospective flag below (not this guess) is what
   * flips the temporal multipliers.
   */
  turnTemporal?: TemporalTag | null
  /**
   * True when the per-turn extraction judged this turn RETROSPECTIVE — the
   * user (or a character) is referencing past shared events ("remember last
   * week?"). Flips the temporal multipliers (past 0.85 → 1.15, moment
   * 0.70 → 1.0) and suspends the anti-repetition penalty (the user is
   * deliberately re-asking). Absent/false → historical behavior.
   */
  turnRetrospective?: boolean
  /**
   * Resolved absolute time window the turn references ("last week" →
   * {from, to} ISO). Memories whose event time (occurredAt ?? createdAt)
   * falls inside get a bounded boost ({@link RECALL_MULTIPLIERS}
   * `occurredWithinWindow`). The hard-filter stage lives in
   * `searchMemoriesSemantic`; this multiplier is the soft fallback when the
   * filtered pool was too small. Null/absent → no window adjustment.
   */
  occurredWithin?: { from: string; to: string } | null
  /**
   * When true, one-hop related-memory expansion runs inside
   * `searchMemoriesSemantic` after the top hits are ranked (item 5). Capped by
   * {@link RELATED_EXPANSION}.
   */
  expandRelated?: boolean
  /**
   * Memory IDs whispered in the last few turns of this chat. A memory in this
   * set takes a bounded anti-repetition penalty ({@link RECALL_MULTIPLIERS}
   * `recentlyWhispered`) so the same entry doesn't read as a stuck record.
   * Empty/undefined → no penalty.
   */
  recentlyWhisperedIds?: ReadonlySet<string>
  /** The current chat's id — the fresh-event boost skips memories extracted from this same chat (echo guard). */
  currentChatId?: string | null
  /** Reference clock for the fresh-event boost, ms since epoch. Absent → boost disabled. */
  nowMs?: number
}

/**
 * Tunable multiplier constants. Starting values — verify against real chats via
 * the per-turn debug output before tightening.
 */
export const RECALL_MULTIPLIERS = {
  /** `scope: narrow` memory whose project matches the current chat. */
  scopeNarrowSameProject: 1.15,
  /** Cross-project `scope: narrow` under the `down-weight` policy. */
  scopeNarrowCrossProjectDownWeight: 0.15,
  /** `temporal: past` — history still matters, but rarely should outrank a live fact. */
  temporalPast: 0.85,
  /** `temporal: moment` — true only at one instant (see note in temporalMultiplier). */
  temporalMoment: 0.7,
  /**
   * Item 3 — the memory's `context` tag matches the turn's guessed dominant
   * context. Lowest-confidence adjustment (the turn guess is itself cheap-LLM
   * output), so the smallest boost.
   */
  contextMatch: 1.1,
  /**
   * Item 4 — the memory is *about* a character present in the room this turn.
   * Boost, never a filter: absent people still get discussed.
   */
  participantPresent: 1.2,
  /**
   * Anti-repetition — the memory was whispered in one of the last few turns of
   * this chat. A bounded penalty (never a hard exclude): a memory that is still
   * the best match keeps winning, just not trivially turn after turn.
   * SUSPENDED on retrospective turns — a fumbled recall the user re-asks about
   * must not bury the very memory they are trying to pin down.
   */
  recentlyWhispered: 0.6,
  /**
   * Retrospective turn — `temporal: past` flips from a penalty to a boost:
   * the exact class of memory a "remember last week?" turn needs.
   */
  temporalPastRetrospective: 1.15,
  /** Retrospective turn — `moment` memories stop being penalized. */
  temporalMomentRetrospective: 1.0,
  /**
   * Event time falls inside the turn's resolved time window (soft fallback
   * when the window-filtered pool was too small — see `searchMemoriesSemantic`).
   */
  occurredWithinWindow: 1.3,
  /**
   * Fresh-event boost — the memory's event time (occurredAt ?? createdAt) is
   * within the last 24h / 48h. The blend's recency term (0.25 weight, 30-day
   * half-life) distinguishes yesterday from twelve days ago by ~0.05 — far less
   * than one targeting-tag multiplier — so without this, "what just happened"
   * holds no ground against evergreen present-tagged memories. Unconditional
   * (not gated on the retrospective flag) by design: it is the safety net for
   * every turn the retrospective classifier misses.
   */
  freshEvent24h: 1.6,
  freshEvent48h: 1.35,
} as const

/** Milliseconds in the two fresh-event bands. */
const HOUR_MS = 60 * 60 * 1000
const FRESH_24H_MS = 24 * HOUR_MS
const FRESH_48H_MS = 48 * HOUR_MS

/** Clamp on the *combined* multiplier so no single memory can explode the ranking. */
export const MULTIPLIER_CLAMP = { min: 0, max: 4 } as const

/**
 * Item 5 — caps on one-hop related-memory expansion so a corpus-heavy character
 * can't balloon the candidate set. `maxPerHit` bounds neighbors pulled from any
 * single top hit; `maxTotal` bounds the whole expansion across all hits.
 */
export const RELATED_EXPANSION = { maxPerHit: 3, maxTotal: 10 } as const

/** Result of a single adjustment: its multiplier plus a short debug label list. */
export interface RecallMultiplier {
  multiplier: number
  /** Short labels (e.g. `narrow✓`, `past↓`) for the per-turn debug log/whisper. */
  fired: string[]
  /** True only for the cross-project narrow + `exclude` policy case. */
  exclude?: boolean
}

/** Combined recall adjustment for one memory, clamped and ready to apply. */
export interface CombinedRecallAdjustment {
  multiplier: number
  fired: string[]
  exclude: boolean
}

/** Minimal structural view of a memory this module needs (keeps it Memory-import-free). */
interface MemoryTagView {
  id?: string
  projectId?: string | null
  keywords?: readonly string[] | null
  aboutCharacterId?: string | null
  /** ISO event time (episodic spine); write clock stands in when absent. */
  occurredAt?: string | null
  createdAt?: string
  /** The chat the memory was extracted from — the fresh-event echo guard reads it. */
  chatId?: string | null
}

/**
 * Parse the three targeting tags back out of a memory's keywords array.
 *
 * Mirrors the extraction-side materialization: `temporal`/`context` are bare
 * words, `scope` is `scope: <value>`. The extractor appends the real tags at the
 * END of the keywords array, so we iterate with last-match-wins — a free keyword
 * that happens to collide with a vocabulary word (e.g. a literal "history") is
 * overridden by the appended tag. Unknown/missing values fall back to the same
 * defaults the extractor uses.
 */
export function parseTargetingTags(
  keywords: readonly string[] | null | undefined,
): TargetingTags {
  let temporal: TemporalTag = DEFAULT_TEMPORAL
  let scope: ScopeTag = DEFAULT_SCOPE
  let context: ContextTag = DEFAULT_CONTEXT

  if (keywords) {
    for (const raw of keywords) {
      if (typeof raw !== 'string') continue
      const kw = raw.trim().toLowerCase()
      if (kw.startsWith('scope:')) {
        const value = kw.slice('scope:'.length).trim()
        if (SCOPE_VALUES.has(value)) scope = value as ScopeTag
      } else if (TEMPORAL_VALUES.has(kw)) {
        temporal = kw as TemporalTag
      } else if (CONTEXT_VALUES.has(kw)) {
        context = kw as ContextTag
      }
    }
  }

  return { temporal, scope, context }
}

/**
 * Item 1 — scope + project gating.
 *
 * - `scope: wide` → pass through (true regardless of project).
 * - `scope: narrow`, memory has no projectId → pass through (nothing to compare;
 *   never penalize on missing data).
 * - `scope: narrow`, memory's project === current chat's project → boost
 *   (this is exactly the story the memory belongs to).
 * - `scope: narrow`, memory's project differs from (or exists where the chat has
 *   none) → cross-project: exclude or strong down-weight per policy. A
 *   narrow-to-X memory should not surface in a different (or project-less) chat.
 */
export function scopeProjectMultiplier(
  tags: TargetingTags,
  memoryProjectId: string | null | undefined,
  currentProjectId: string | null | undefined,
  policy: ScopePolicy,
): RecallMultiplier {
  if (tags.scope !== 'narrow' || !memoryProjectId) {
    return { multiplier: 1, fired: [] }
  }
  if (currentProjectId && memoryProjectId === currentProjectId) {
    return { multiplier: RECALL_MULTIPLIERS.scopeNarrowSameProject, fired: ['narrow✓'] }
  }
  if (policy === 'exclude') {
    return { multiplier: 0, fired: ['narrow✗-exclude'], exclude: true }
  }
  return {
    multiplier: RECALL_MULTIPLIERS.scopeNarrowCrossProjectDownWeight,
    fired: ['narrow✗'],
  }
}

/**
 * Item 2 — temporal weighting, now turn-aware (`turnTemporal` made real).
 *
 * Default turns: `past` facts rarely should outrank live ones; `moment` facts
 * are true only at a single instant. Recall always runs BEFORE the current
 * turn's extraction, so any recalled `moment` memory was produced on a prior
 * turn — the penalty applies unconditionally. `present`/`future` pass through.
 *
 * Retrospective turns invert the frame: the user is deliberately invoking the
 * past, so `past` becomes a boost and `moment` stops being penalized —
 * without this, the exact class of memory a "remember last week?" turn needs
 * is systematically demoted at the moment it is asked for.
 */
export function temporalMultiplier(
  tags: TargetingTags,
  retrospective: boolean = false,
): RecallMultiplier {
  if (tags.temporal === 'past') {
    return retrospective
      ? { multiplier: RECALL_MULTIPLIERS.temporalPastRetrospective, fired: ['past↑retro'] }
      : { multiplier: RECALL_MULTIPLIERS.temporalPast, fired: ['past↓'] }
  }
  if (tags.temporal === 'moment') {
    return retrospective
      ? { multiplier: RECALL_MULTIPLIERS.temporalMomentRetrospective, fired: ['moment·retro'] }
      : { multiplier: RECALL_MULTIPLIERS.temporalMoment, fired: ['moment↓'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * A memory's event time in ms — `occurredAt` when the episodic spine recorded
 * one, else the write clock. NaN when neither is present or parsable, which
 * both boosts below read as "no ground to stand on" and pass through.
 */
function eventTimeMs(memory: MemoryTagView): number {
  const eventIso = memory.occurredAt ?? memory.createdAt
  return eventIso ? Date.parse(eventIso) : NaN
}

/**
 * Time-window boost — the memory's event time (occurredAt ?? createdAt) falls
 * inside the turn's resolved retrospective window. Soft fallback companion to
 * the hard filter in `searchMemoriesSemantic`. No window, or no parsable
 * event time → pass through.
 */
export function occurredWithinMultiplier(
  memory: MemoryTagView,
  window: { from: string; to: string } | null | undefined,
): RecallMultiplier {
  if (!window) return { multiplier: 1, fired: [] }
  const t = eventTimeMs(memory)
  const from = Date.parse(window.from)
  const to = Date.parse(window.to)
  if (!Number.isFinite(t) || !Number.isFinite(from) || !Number.isFinite(to)) {
    return { multiplier: 1, fired: [] }
  }
  if (t >= from && t <= to) {
    return { multiplier: RECALL_MULTIPLIERS.occurredWithinWindow, fired: ['window↑'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * Fresh-event boost — the memory's event time is within the last 24h/48h.
 *
 * Unconditional, unlike {@link occurredWithinMultiplier}: it fires whether or
 * not the turn was judged retrospective, because it exists precisely for the
 * turns where that judgement fails. The ranking blend's recency term is too
 * weak to keep yesterday's events in front of well-tagged evergreen memories,
 * so a coarse freshness band does the work the blend cannot.
 *
 * Echo guard: memories extracted from the CURRENT chat are skipped. They are
 * already in the transcript the model is reading, and boosting them floods the
 * handful of whisper slots with restatements of the last few turns.
 *
 * No clock, no parsable event time, or an event time in the future → pass
 * through (never penalize on missing data — house rule).
 */
export function freshEventMultiplier(
  memory: MemoryTagView,
  nowMs: number | null | undefined,
  currentChatId: string | null | undefined,
): RecallMultiplier {
  if (nowMs === null || nowMs === undefined || !Number.isFinite(nowMs)) {
    return { multiplier: 1, fired: [] }
  }
  if (memory.chatId && currentChatId && memory.chatId === currentChatId) {
    return { multiplier: 1, fired: [] }
  }
  const t = eventTimeMs(memory)
  if (!Number.isFinite(t)) return { multiplier: 1, fired: [] }

  const age = nowMs - t
  if (age < 0) return { multiplier: 1, fired: [] }
  if (age <= FRESH_24H_MS) {
    return { multiplier: RECALL_MULTIPLIERS.freshEvent24h, fired: ['fresh24↑'] }
  }
  if (age <= FRESH_48H_MS) {
    return { multiplier: RECALL_MULTIPLIERS.freshEvent48h, fired: ['fresh48↑'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * Item 3 — context-axis steering.
 *
 * Boost a memory whose own `context` tag matches the turn's guessed dominant
 * context. The turn guess is itself cheap-LLM output, so this is the
 * lowest-confidence adjustment and carries the smallest boost. No turn guess
 * (null/undefined) → pass through.
 */
export function contextMultiplier(
  tags: TargetingTags,
  turnContext: ContextTag | null | undefined,
): RecallMultiplier {
  if (turnContext && tags.context === turnContext) {
    return { multiplier: RECALL_MULTIPLIERS.contextMatch, fired: ['ctx✓'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * Item 4 — participant-aware boost (dynamic head).
 *
 * Boost a memory that is *about* a character present in the room this turn. The
 * present set includes the responding character itself, so its self-memories are
 * boosted alongside present-other memories rather than losing ground to them —
 * in a single-character chat every candidate is boosted uniformly, leaving the
 * relative ranking unchanged. A boost, never a filter: absent characters still
 * get discussed.
 */
export function participantMultiplier(
  memory: MemoryTagView,
  presentAboutCharacterIds: readonly string[] | null | undefined,
): RecallMultiplier {
  if (
    memory.aboutCharacterId &&
    presentAboutCharacterIds &&
    presentAboutCharacterIds.includes(memory.aboutCharacterId)
  ) {
    return { multiplier: RECALL_MULTIPLIERS.participantPresent, fired: ['present↑'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * Anti-repetition — penalize a memory whispered in the last few turns of this
 * chat so the same entry doesn't get whispered turn after turn. A bounded
 * multiplier, never a hard exclude: a still-best match keeps winning, just not
 * trivially. No recent-whisper set, or memory not in it → pass through.
 */
export function recentlyWhisperedMultiplier(
  memory: MemoryTagView,
  recentlyWhisperedIds: ReadonlySet<string> | null | undefined,
  suspended: boolean = false,
): RecallMultiplier {
  if (suspended) {
    // Retrospective turn: the user is deliberately re-asking. Penalizing the
    // just-whispered memory here would bury the very entry they want.
    return { multiplier: 1, fired: [] }
  }
  if (memory.id && recentlyWhisperedIds && recentlyWhisperedIds.has(memory.id)) {
    return { multiplier: RECALL_MULTIPLIERS.recentlyWhispered, fired: ['repeat↓'] }
  }
  return { multiplier: 1, fired: [] }
}

/**
 * Combine every applicable recall multiplier for one memory into a single
 * clamped adjustment. Items 1 (scope+project) and 2 (temporal) read the memory's
 * own tags; items 3 (context steering) and 4 (participant boost) compare against
 * the turn-level signals on the {@link RecallContext}, and the anti-repetition
 * penalty reads the recently-whispered set. The time-window boost and the
 * unconditional fresh-event boost read the memory's event time against the
 * turn's window and clock. The product is clamped to
 * {@link MULTIPLIER_CLAMP} so no single memory can dominate the ranking. A
 * cross-project narrow memory under the `exclude` policy short-circuits to
 * `{ exclude: true }`.
 */
export function combineRecallMultipliers(
  memory: MemoryTagView,
  ctx: RecallContext,
): CombinedRecallAdjustment {
  const tags = parseTargetingTags(memory.keywords)

  const scope = scopeProjectMultiplier(
    tags,
    memory.projectId,
    ctx.currentProjectId,
    ctx.scopePolicy,
  )
  if (scope.exclude) {
    return { multiplier: 0, fired: scope.fired, exclude: true }
  }

  const retrospective = ctx.turnRetrospective === true
  const temporal = temporalMultiplier(tags, retrospective)
  const context = contextMultiplier(tags, ctx.turnContext)
  const participant = participantMultiplier(memory, ctx.presentAboutCharacterIds)
  const recent = recentlyWhisperedMultiplier(memory, ctx.recentlyWhisperedIds, retrospective)
  const window = occurredWithinMultiplier(memory, ctx.occurredWithin)
  const fresh = freshEventMultiplier(memory, ctx.nowMs, ctx.currentChatId)

  const product =
    scope.multiplier *
    temporal.multiplier *
    context.multiplier *
    participant.multiplier *
    recent.multiplier *
    window.multiplier *
    fresh.multiplier
  const clamped = Math.max(
    MULTIPLIER_CLAMP.min,
    Math.min(MULTIPLIER_CLAMP.max, product),
  )

  return {
    multiplier: clamped,
    fired: [...scope.fired, ...temporal.fired, ...context.fired, ...participant.fired, ...recent.fired, ...window.fired, ...fresh.fired],
    exclude: false,
  }
}
