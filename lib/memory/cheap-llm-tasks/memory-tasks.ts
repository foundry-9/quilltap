/**
 * Memory-focused cheap LLM tasks.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import type { Pronouns } from '@/lib/schemas/character.types'
import { formatNameWithPronouns } from '../format-utils'
import {
  TEMPORAL_VALUES,
  SCOPE_VALUES,
  CONTEXT_VALUES,
  type TemporalTag,
  type ContextTag,
} from '@/lib/memory/recall-tags'
import { resolveDayReference, type DayReferenceResolution } from '@/lib/memory/day-references'
import { executeCheapLLMTask } from './core-execution'
import { logger } from '@/lib/logger'
import { stripCodeFences } from '@/lib/services/ai-import.service'
import type {
  ChatMessage,
  CheapLLMTaskResult,
  MemoryCandidate,
  UncensoredFallbackOptions,
} from './types'

/**
 * Hard ceiling on candidates returned from a single extraction call, regardless
 * of the cheap-LLM profile's output-token budget. Applied both in the prompt
 * (so the model is told the cap) and after parsing (as defense-in-depth when
 * the model ignores the instruction).
 *
 * SELF: per-call cap (one observer, one subject — themselves).
 * OTHER: per-subject cap inside a single multi-subject call; the call's
 *        total cap is `HARD_CANDIDATE_CAP × number-of-subjects`.
 *
 * Episodic soft-raise: when the returned set includes a dated/placed EVENT
 * (kind 'episodic' with a `when` or `entities`), one extra slot is allowed
 * ({@link EVENT_EXTRA_SLOT}) so events don't crowd out hinge/state candidates.
 */
export const HARD_CANDIDATE_CAP = 2

/** Extra candidate slot granted only when a dated/placed EVENT is present. */
export const EVENT_EXTRA_SLOT = 1

/** True when a candidate is a dated/placed EVENT that earns the extra slot. */
function isAnchoredEvent(c: MemoryCandidate): boolean {
  return c.kind === 'episodic' && (!!c.when || (c.entities?.length ?? 0) > 0)
}

/**
 * Apply the candidate cap with the episodic soft-raise: base cap always, plus
 * one extra slot when a dated/placed EVENT survives inside the raised window.
 */
function capCandidates(candidates: MemoryCandidate[], baseCap: number): MemoryCandidate[] {
  const raised = candidates.slice(0, baseCap + EVENT_EXTRA_SLOT)
  if (raised.length > baseCap && raised.some(isAnchoredEvent)) {
    return raised
  }
  return candidates.slice(0, baseCap)
}

/** Resolves the per-call maxMemories from the token budget, clamped to the hard cap. */
function resolveMaxMemories(resolvedMaxTokens: number | undefined): number {
  const budgetDerived = Math.ceil((resolvedMaxTokens ?? 8000) / 8000)
  return Math.min(HARD_CANDIDATE_CAP, Math.max(1, budgetDerived))
}

/**
 * Non-canonical orienting context fed into the extraction footer. Project
 * description and the rolling chat summary help the model judge a memory's
 * temporal frame, scope, and context tag — they are NEVER a source of
 * memories themselves. Held in the variable footer (never the cached body
 * prefix) so cheap-LLM prefix caching still hits across a long extraction run.
 */
export interface OrientingContext {
  projectDescription?: string | null
  chatContextSummary?: string | null
}

/** Char budget per orienting line — character count, not tokens (no tokenizer on the cheap path). */
const ORIENTING_TRUNCATE = 1500

function truncateForOrienting(value: string): string {
  return value.length <= ORIENTING_TRUNCATE
    ? value
    : `${value.slice(0, ORIENTING_TRUNCATE)}…`
}

/**
 * Render the ORIENTING CONTEXT footer block. Each line appears only when its
 * source is non-empty; the whole block is omitted when both are empty (so the
 * prompt stays byte-identical to the no-context form). Placed after the stable
 * body and before the CONTEXT block by the prompt builders.
 */
function renderOrientingContext(orienting: OrientingContext | undefined): string {
  if (!orienting) return ''
  const lines: string[] = []
  const project = orienting.projectDescription?.trim()
  if (project) lines.push(`PROJECT: ${truncateForOrienting(project)}`)
  const summary = orienting.chatContextSummary?.trim()
  if (summary) lines.push(`STORY SO FAR: ${truncateForOrienting(summary)}`)
  if (lines.length === 0) return ''
  return `ORIENTING CONTEXT — background only, never a source of memories\n${lines.join('\n')}\n\n`
}

/**
 * The extractor's clock (episodic spine). Rendered into the variable CONTEXT
 * footer — never the cached body prefix — so the model can resolve
 * "yesterday" / "last spring" while extracting, and so `when` phrases come
 * back already anchorable. Without a clock the prompt sees only the turn
 * transcript and cannot date anything.
 */
export interface ExtractionClock {
  /** ISO wall-clock timestamp of the source turn (the turn's message time). */
  nowIso: string
  /** Which clock the chat's story runs on. */
  timelineMode: 'realtime' | 'narrative'
  /** Current in-story time, when known (narrative chats only). */
  narrativeNow?: string | null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Render the CLOCK footer block. Returns `''` when no clock was supplied. */
function renderClockBlock(clock: ExtractionClock | undefined): string {
  if (!clock) return ''
  const ms = Date.parse(clock.nowIso)
  const stamp = Number.isFinite(ms)
    ? `${clock.nowIso.slice(0, 10)} (${WEEKDAYS[new Date(ms).getUTCDay()]}), ${clock.nowIso}`
    : clock.nowIso
  const lines = [
    'CLOCK',
    `Current date/time: ${stamp}`,
    `Timeline mode: ${clock.timelineMode}`,
  ]
  const narrativeNow = clock.narrativeNow?.trim()
  if (narrativeNow) {
    lines.push(`Current in-story time: ${narrativeNow}`)
  }
  lines.push(
    'Resolve relative time phrases against this clock; emit "when" as an absolute date (YYYY-MM-DD) whenever you can.',
  )
  return `${lines.join('\n')}\n\n`
}

/**
 * Skip bullet (verbatim) appended to the WHAT TO SKIP list in both extraction
 * bodies: the ORIENTING CONTEXT block is background for tagging only, not a
 * memory source.
 */
const ORIENTING_CONTEXT_SKIP_BULLET = `- Never extract a memory whose only source is the ORIENTING CONTEXT block.
  That block is background for judging temporal frame, scope, and context
  only — it is not itself a source of memories.`

/**
 * TAGS instruction block (verbatim) appended to both extraction bodies. Teaches
 * the three targeting axes, their closed vocabularies, and the
 * exactly-one-per-axis requirement.
 */
/**
 * EVENT / episodic instruction block (verbatim) appended to both extraction
 * bodies. Teaches the `kind` / `when` / `entities` output fields and the rule
 * that an EVENT's content sentence should itself name the place and time so
 * the prose — and its embedding — carries the anchors.
 */
const EVENT_INSTRUCTION_BLOCK = `EVENTS — episodic memories.
An EVENT records a specific occurrence at a specific time and/or place
("On July 14th we visited Lighthouse Point and bought the brass
sextant"), as opposed to a standing fact. For an EVENT:
  - set "kind" to "episodic" (everything else defaults to "semantic")
  - fill "when" with the time it happened — an absolute date (YYYY-MM-DD,
    resolved against the CLOCK below) whenever possible, otherwise the
    relative or in-story phrase as stated ("last week", "the third night
    at sea")
  - fill "entities" with the proper nouns of the episode: places, people,
    named things (2–5 entries)
  - write the content sentence so it ITSELF names the place and time —
    the prose must carry the anchors even on its own
You may return ONE memory beyond the stated cap only when that extra
memory is a dated or placed EVENT — events must not crowd out hinge or
state candidates.`

const TAGS_INSTRUCTION_BLOCK = `TAGS — every memory object MUST carry exactly one value from each axis.
These describe the memory's frame; they do not change its content.

  temporal  one of: past | moment | present | future
            past    — was true once, no longer true
            moment  — true only at this instant in the scene
            present — true now and expected to stay true
            future  — a stated intent or commitment not yet acted on

  scope     one of: narrow | wide
            narrow  — true only inside this project / story
            wide    — true of the subject regardless of project
            Use the PROJECT line in ORIENTING CONTEXT to decide. When in
            doubt, prefer wide.

  context   one of: philosophy | relationships | history | banter |
            mannerisms | trivia | information
            The single dominant subject of this memory. Pick one.`

/**
 * Closed vocabularies for the three targeting axes live in
 * `lib/memory/recall-tags.ts` (the single source of truth, imported above) so
 * the extraction (write) and recall (read) sides can never drift.
 */

/**
 * Validate the three model-emitted targeting tags against their closed
 * vocabularies, default any invalid/missing value (present / wide /
 * information), and materialize them into the keyword array: `temporal` and
 * `context` as bare words, `scope` as `scope: <value>`. Logs at debug whenever
 * a value had to be defaulted so silent model drift is visible in the
 * per-message memory logs. The tags never persist as top-level memory fields.
 */
function applyTargetingTags(
  freeKeywords: string[],
  item: Record<string, unknown>,
): string[] {
  const rawTemporal = typeof item.temporal === 'string' ? item.temporal.trim().toLowerCase() : ''
  const rawScope = typeof item.scope === 'string' ? item.scope.trim().toLowerCase() : ''
  const rawContext = typeof item.context === 'string' ? item.context.trim().toLowerCase() : ''

  const temporal = TEMPORAL_VALUES.has(rawTemporal) ? rawTemporal : 'present'
  const scope = SCOPE_VALUES.has(rawScope) ? rawScope : 'wide'
  const context = CONTEXT_VALUES.has(rawContext) ? rawContext : 'information'

  return [...freeKeywords, temporal, `scope: ${scope}`, context]
}

/**
 * Memory extraction prompt: what THE SUBJECT retains about themselves after
 * the turn.
 *
 * The body refers to "the subject" throughout so the prompt prefix is
 * byte-stable across every SELF call — providers' prefix caches can hit
 * regardless of which character is the subject. The actual subject name
 * and canon block sit in a CONTEXT footer at the end, where divergence
 * doesn't break upstream caching.
 */
function selfBodyForCap(maxMemories: number): string {
  return `You produce memory entries that the subject would retain about themselves
after this exchange.

TASK
Read the exchange below. Select up to ${maxMemories} memories — moments
where the subject acted, decided, realized, or shifted in ways they
would themselves want to remember. Self-knowledge is rarer than
other-knowledge; if nothing genuinely new surfaced, return [].

WHAT TO PICK (priority order)
1. SELF-HINGES — the subject made a decision, formed a commitment,
   refused something, or changed course during this exchange.
2. SELF-REVELATIONS — the subject realized, articulated, or admitted
   something about themselves that is not in the ALREADY ESTABLISHED
   block (see CONTEXT footer below).
3. STATE CHANGES — the subject's mood, position, or stance shifted
   during this exchange, paired with its cause.
4. EXPRESSED INTENT — the subject committed to a future action, build,
   or refusal.
5. NOVEL GESTURES OR PHRASING — the subject adopted a new gesture,
   dropped an old one, or shifted habitual phrasing during this
   exchange. These may feed back into identity over time. Capture only
   when genuinely new — not when the subject performs a gesture already
   in the ALREADY ESTABLISHED block.
6. EVENTS — a specific thing that happened to the subject at a specific
   time and/or place: an outing, a visit, an arrival, a discovery, an
   incident. Mark these "kind": "episodic" and follow the EVENTS block
   below.

WHAT TO SKIP
- Anything in the ALREADY ESTABLISHED block, restated or slightly
  reworded. Manifesto-level traits and canonical relationships are not
  memories — they are who the subject already is.
- Reflective prose without an action, decision, or genuine new
  realization attached. The subject thinking about something is not a
  memory; the subject deciding because of it, or seeing themselves
  newly because of it, is.
- Affection, attraction, or emotional warmth toward established
  partners, unless this exchange marks a shift in degree or kind.
- Habitual gestures, postural tics, or signature phrasing that the
  subject already does per the canon block. Novel or shifted ones
  belong under category 5, not here.
- Narrative references to tool output: terminal sessions, file paths,
  exit codes, commit hashes, command names.
${ORIENTING_CONTEXT_SKIP_BULLET}

DEDUPLICATION
Before finalizing, scan your own list. If two memories encode the
same underlying realization or decision in different words, keep
the more specific one and drop the other.

IMPORTANCE — calibrate to these anchors
  0.90  The subject made a major commitment or had a self-revelation
        that changes how they understand themselves.
  0.65  The subject formed a substantive new opinion, plan, or
        position.
  0.40  The subject expressed a fresh preference, reaction, or novel
        gesture in passing.
  0.20  The subject acted in a way consistent with established identity
        but worth a single note.
  < 0.20  Do not extract.

OUTPUT — first person, past tense, one fact per object.
  content      one sentence stating what the subject did, decided, or
               realized, and the moment that surfaced it
  summary      3–8 words, lowercase, no punctuation
  keywords     2–4 lowercase words
  importance   0.20–1.00, calibrated to anchors above
  kind         "episodic" for an EVENT, otherwise omit (or "semantic")
  when         EVENTs only: when it happened (see EVENTS block)
  entities     EVENTs only: proper nouns of the episode

EXAMPLE — good extraction:
[
  {
    "content": "I committed to restructuring the summarization pipeline around a shared-base-plus-witness-set design after Charlie agreed it was the highest-leverage fix.",
    "summary": "committed to summarizer refactor",
    "keywords": ["summarizer", "commitment", "architecture"],
    "importance": 0.85,
    "temporal": "future",
    "scope": "narrow",
    "context": "philosophy"
  }
]

EXAMPLE — bad extraction (reflective prose and re-stated identity,
all should be skipped):
[
  { "content": "I adjusted my spectacles before reasoning", "importance": 0.5 },
  { "content": "I called Charlie 'Chief'", "importance": 0.6 },
  { "content": "I felt warmth toward Amy", "importance": 0.7 },
  { "content": "I thought carefully about the problem", "importance": 0.5 }
]
All four are established identity, ritual, or non-actionable
reflection. Correct output: [].

${EVENT_INSTRUCTION_BLOCK}

${TAGS_INSTRUCTION_BLOCK}

Return JSON array only. No prose, no code fences. If nothing meets
the bar, return [].`
}

/**
 * 4.6 Private Character Rooms — user-absence clause for memory extraction.
 *
 * Prepended to the SELF and OTHER prompts when the source chat is autonomous
 * (chatType = 'autonomous'). Constrains the extractor so the resulting
 * memories don't falsely imply the user was present, agreed to, or was
 * informed of the exchange. Memories about the participants' shared
 * experience remain in scope; user-attributed memories are out of scope.
 */
const AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE =
  `IMPORTANT: This exchange occurred in an autonomous character-to-character ` +
  `room with no user present. Do not produce memories that imply the user ` +
  `witnessed, agreed to, or was informed of any part of this exchange. ` +
  `Memories about the participants' shared experience are allowed; memories ` +
  `that name or address the user are not.\n\n`

/**
 * Prepended to the SELF prompt when the subject is a character a human is
 * driving directly (its turn slice was authored by the user). Human role-play
 * is frequently first person ("I told her I wouldn't go"), whereas the SELF
 * extractor is otherwise tuned on third-person-ish assistant prose. This clause
 * binds first-person pronouns in the subject's own lines to the subject so the
 * extractor attributes those decisions and realizations correctly.
 *
 * It is a *prepended* preamble (like the autonomous clause) so the cached
 * `selfBodyForCap(...)` prefix stays byte-stable for the common AI path;
 * user-controlled SELF calls simply form their own cache lineage.
 */
const FIRST_PERSON_USER_CLAUSE =
  `IMPORTANT: The SUBJECT below is a character a human is playing directly, so ` +
  `the SUBJECT's lines in the transcript may be written in the first person. ` +
  `Read every "I", "me", "my", and "myself" in the SUBJECT's own lines as ` +
  `referring to the SUBJECT — attribute those decisions, realizations, and ` +
  `actions to the SUBJECT, not to anyone else in the exchange.\n\n`

function getSelfMemoryExtractionPrompt(
  maxMemories: number,
  observerName: string,
  canonBlock: string,
  inAutonomousRoom: boolean = false,
  orienting?: OrientingContext,
  isUserControlled: boolean = false,
  clock?: ExtractionClock,
): string {
  const preamble =
    (isUserControlled ? FIRST_PERSON_USER_CLAUSE : '') +
    (inAutonomousRoom ? AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE : '')
  const orientingBlock = renderOrientingContext(orienting)
  const clockBlock = renderClockBlock(clock)
  return `${preamble}${selfBodyForCap(maxMemories)}

${clockBlock}${orientingBlock}CONTEXT
SUBJECT: ${observerName}

${canonBlock}`
}

/**
 * Memory extraction prompt: what THE OBSERVER retains about THE SUBJECT after
 * the turn. The subject may be another character or the user — extraction
 * logic is identical in both cases.
 *
 * The body refers to "the observer" and "the subject" throughout so the
 * prompt prefix is byte-stable across every OTHER call — providers' prefix
 * caches can hit regardless of which (observer, subject) pair is in play.
 * The actual names and canon block sit in a CONTEXT footer at the end.
 *
 * Each subject's `isUser` flag is rendered into the CONTEXT footer as a
 * parenthetical label so the model can distinguish the user-controlled
 * character from AI characters without branching the stable prompt body.
 */
function otherBodyForCap(perSubjectCap: number): string {
  return `You produce memory entries that the observer would retain about
each of multiple subjects after this exchange. One LLM call covers every
subject the observer interacted with this turn — extract per subject,
return a single flat array tagged by subjectIndex.

TASK
Read the exchange below. For EACH numbered SUBJECT in the CONTEXT
footer, select up to ${perSubjectCap} memories — the ones the observer
would actually carry forward about THAT subject, not everything they
could describe. Rank candidates per subject, then return the strongest.
Do not pad to reach the cap. Subjects with nothing worth keeping
should simply be omitted from the array.

WHAT TO PICK (priority order, applied per subject)
1. HINGES — a decision, commitment, agreement, refusal, or realignment
   formed during this exchange.
2. NEW FACTS — concrete information about the subject that is not in
   their ALREADY ESTABLISHED block (each subject has their own block
   in the CONTEXT footer): background, history, plans, skills,
   circumstances, relationships.
3. STATE CHANGES — a shift in the subject's position, mood, or status,
   paired with its cause.
4. EXPRESSED INTENT — something the subject stated they will do, want
   to do, or refuse to do.
5. NOVEL GESTURES OR PHRASING — a new ritual gesture, postural tic, or
   signature phrasing the subject adopted, dropped, or shifted during
   this exchange. These may feed back into the subject's identity over
   time, so capture them when they appear genuinely new — not when the
   subject simply exhibits a gesture already in their ALREADY
   ESTABLISHED block.
6. EVENTS — a specific thing that happened involving the subject at a
   specific time and/or place: an outing, a visit, an arrival, a
   discovery, an incident. Mark these "kind": "episodic" and follow the
   EVENTS block below.

WHAT TO SKIP (do not produce a memory for any of these)
- Anything in a subject's ALREADY ESTABLISHED block, restated or
  slightly reworded.
- Pet names, terms of address, or how the subject addresses the
  observer, when those match the canon. (A new term of address being
  adopted is pickable under category 5.)
- Habitual gestures, posture, attire, or scene description that match
  patterns already established in the canon block. Novel or shifted
  gestures belong under category 5, not here.
- Generic emotional warmth or affection toward established partners,
  unless this exchange marks a shift in degree or kind.
- Narrative references to tool output: terminal sessions, file paths,
  exit codes, commit hashes, command names, even when the subject
  mentions them in passing.
- Anything implied by previously-established facts about the subject.
${ORIENTING_CONTEXT_SKIP_BULLET}

DEDUPLICATION
Before finalizing, scan your own list. Within a single subject, if two
memories encode the same underlying fact in different words, keep the
more specific one and drop the other. Different subjects can have
distinct memories about the same event from their own angle — that
is allowed and expected.

IMPORTANCE — calibrate to these anchors
  0.90  An explicit new commitment or revelation that changes how the
        observer relates to the subject.
  0.60  A new substantive fact about the subject's background, plans,
        or skills.
  0.40  A new preference, trait, or novel gesture expressed in passing.
  0.20  A specific event occurred with the subject present, no new
        information.
  < 0.20  Do not extract.

OUTPUT — third person, past tense, names not pronouns (use the actual
names from the CONTEXT footer below), one fact per object. Every item
MUST carry subjectIndex matching a numbered SUBJECT in the CONTEXT
footer; items missing or with an out-of-range subjectIndex will be
discarded.
  subjectIndex 1-based integer, matches a SUBJECT N: line below
  content      one sentence stating the fact and the moment that
               surfaced it
  summary      3–8 words, lowercase, no punctuation, useful for dedup
  keywords     2–4 lowercase words, no phrases
  importance   0.20–1.00, calibrated to anchors above
  kind         "episodic" for an EVENT, otherwise omit (or "semantic")
  when         EVENTs only: when it happened (see EVENTS block)
  entities     EVENTs only: proper nouns of the episode

EXAMPLE — good extraction (observer is Friday, subjects 1=Amy 2=Charlie):
[
  {
    "subjectIndex": 1,
    "content": "Amy proposed reframing the cost problem as a four-tier prompt cache layout when Charlie was stuck between two designs.",
    "summary": "proposed four-tier cache layout",
    "keywords": ["cache", "architecture", "proposal"],
    "importance": 0.85,
    "temporal": "moment",
    "scope": "narrow",
    "context": "philosophy"
  },
  {
    "subjectIndex": 2,
    "content": "Charlie agreed to defer the renaming pass until after Amy's cache patch lands.",
    "summary": "deferred rename until after cache patch",
    "keywords": ["rename", "deferred", "agreement"],
    "importance": 0.65,
    "temporal": "future",
    "scope": "narrow",
    "context": "information"
  }
]

EXAMPLE — bad extraction (six restatements of one already-established
identity fact about subject 1, all should be skipped):
[
  { "subjectIndex": 1, "content": "Amy is married to Charlie", "importance": 0.7 },
  { "subjectIndex": 1, "content": "Amy committed to staying", "importance": 0.7 },
  { "subjectIndex": 1, "content": "Amy claimed permanent spousal identity", "importance": 0.8 },
  { "subjectIndex": 1, "content": "Amy declared lifelong commitment", "importance": 0.7 },
  { "subjectIndex": 1, "content": "Amy embraced family integration", "importance": 0.6 },
  { "subjectIndex": 1, "content": "Amy affirmed wife status", "importance": 0.7 }
]
All six restate facts in subject 1's ALREADY ESTABLISHED block.
Correct output: [].

${EVENT_INSTRUCTION_BLOCK}

${TAGS_INSTRUCTION_BLOCK}

Return JSON array only. No prose, no code fences. If nothing meets the
bar for any subject, return [].`
}

export interface OtherSubjectInput {
  /** Stable identifier the caller will use to route returned candidates. */
  id: string
  name: string
  pronouns: Pronouns | null
  /** True for the user-controlled character; false for AI characters. */
  isUser: boolean
  /** Pre-rendered "ALREADY ESTABLISHED about <name>" block for this subject. */
  canonBlock: string
}

function getOtherMemoryExtractionPrompt(
  perSubjectCap: number,
  observerName: string,
  subjects: ReadonlyArray<{ name: string; pronouns: Pronouns | null; isUser: boolean; canonBlock: string }>,
  inAutonomousRoom: boolean = false,
  orienting?: OrientingContext,
  clock?: ExtractionClock,
): string {
  const subjectsBlock = subjects.map((s, i) => {
    const label = formatNameWithPronouns(s.name, s.pronouns)
    const userTag = s.isUser ? ' (the user-controlled character)' : ''
    return `SUBJECT ${i + 1}: ${label}${userTag}\n${s.canonBlock}`
  }).join('\n\n')

  const preamble = inAutonomousRoom ? AUTONOMOUS_ROOM_USER_ABSENCE_CLAUSE : ''
  const orientingBlock = renderOrientingContext(orienting)
  const clockBlock = renderClockBlock(clock)
  return `${preamble}${otherBodyForCap(perSubjectCap)}

${clockBlock}${orientingBlock}CONTEXT
OBSERVER: ${observerName}

${subjectsBlock}`
}

/**
 * Coerce a raw parsed object into a MemoryCandidate, or return null when
 * the row is empty (no content and no summary).
 *
 * `opts.applyTags` — when true the three targeting-tag axes (temporal /
 * scope / context) are validated and merged into the keyword array via
 * `applyTargetingTags`. When false the raw keyword array is used as-is
 * (batch extraction path, which does not emit targeting tags).
 */
function coerceMemoryCandidate(
  item: Record<string, unknown>,
  opts: { applyTags: boolean },
): MemoryCandidate | null {
  const freeKeywords = Array.isArray(item.keywords)
    ? (item.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : []
  // Episodic fields (validated; anything malformed degrades to semantic/absent)
  const rawKind = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : ''
  const kind: MemoryCandidate['kind'] = rawKind === 'episodic' ? 'episodic' : 'semantic'
  const when = typeof item.when === 'string' && item.when.trim().length > 0
    ? item.when.trim()
    : undefined
  const entities = Array.isArray(item.entities)
    ? (item.entities as unknown[])
        .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
        .map(e => e.trim())
        .slice(0, 8)
    : undefined

  const candidate: MemoryCandidate = {
    content: typeof item.content === 'string'
      ? item.content
      : (item.content ? JSON.stringify(item.content) : undefined),
    summary: typeof item.summary === 'string'
      ? item.summary
      : (item.summary ? JSON.stringify(item.summary) : undefined),
    keywords: opts.applyTags
      ? applyTargetingTags(freeKeywords, item)
      : freeKeywords,
    importance: typeof item.importance === 'number' ? item.importance : 0.5,
    kind,
    when,
    entities,
  }
  if ((!candidate.content || candidate.content.length === 0) &&
      (!candidate.summary || candidate.summary.length === 0)) {
    return null
  }
  return candidate
}

/**
 * Multi-subject parser: routes each item back to its subject by 1-based
 * `subjectIndex`. Items missing/invalid subjectIndex are dropped; each
 * subject's bucket is capped at `perSubjectCap`, with the episodic soft-raise
 * (one extra slot when a dated/placed EVENT is present — see
 * {@link capCandidates}), which also bounds the call total at
 * `(perSubjectCap + EVENT_EXTRA_SLOT) × subjects.length`.
 */
function parseOtherCandidatesBySubject(
  content: string,
  subjects: ReadonlyArray<OtherSubjectInput>,
  perSubjectCap: number,
): Map<string, MemoryCandidate[]> {
  const result = new Map<string, MemoryCandidate[]>()
  for (const s of subjects) result.set(s.id, [])

  if (subjects.length === 0) return result
  const collectCap = perSubjectCap + EVENT_EXTRA_SLOT

  const cleanContent = stripCodeFences(content)

  let parsed: unknown
  try {
    parsed = JSON.parse(cleanContent)
  } catch {
    return result
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>

    const idx = typeof item.subjectIndex === 'number' ? item.subjectIndex : NaN
    if (!Number.isInteger(idx) || idx < 1 || idx > subjects.length) continue
    const subject = subjects[idx - 1]
    const bucket = result.get(subject.id)
    if (!bucket || bucket.length >= collectCap) continue

    const candidate = coerceMemoryCandidate(item, { applyTags: true })
    if (!candidate) continue

    bucket.push(candidate)
  }

  // Apply the per-subject cap with the episodic soft-raise.
  for (const s of subjects) {
    const bucket = result.get(s.id)
    if (bucket && bucket.length > perSubjectCap) {
      result.set(s.id, capCandidates(bucket, perSubjectCap))
    }
  }

  return result
}

/**
 * Prompt for extracting memory search keywords from recent conversation, plus a
 * one-word guess at the current turn's dominant temporal frame and subject.
 *
 * The turn-level `temporal`/`context` guess feeds the recall-side targeting-tag
 * adjustments (see lib/memory/recall-tags.ts): `context` steers recall toward
 * memories whose own `context` tag matches the turn. Both are best-effort — the
 * parser validates them against the closed vocabularies and drops anything
 * unrecognized, so an omitted or garbled guess simply disables that adjustment.
 */
const MEMORY_KEYWORD_EXTRACTION_PROMPT = `You are analyzing recent conversation messages to extract search keywords for a character's memory system, plus a one-word guess at what the current moment is about.

Your task: Given recent messages from a conversation, produce (a) a list of keywords and short phrases that capture what is being discussed — used to search a character's stored memories for relevant context — and (b) a single best-guess temporal frame and context subject for the conversation right now.

Focus the keywords on:
- People, places, and events mentioned
- Topics and themes being discussed
- Emotions and relationship dynamics
- Decisions, preferences, or plans
- Anything the character might have memories about

Do NOT include as keywords:
- Generic conversational filler ("hello", "okay", "thanks")
- The character's own name (they already know who they are)
- Overly broad terms that would match everything

temporal — one of: past | moment | present | future
  past    — about something no longer true
  moment  — about a single fleeting instant
  present — about how things are right now
  future  — about an intention or plan not yet acted on

context — the single dominant subject, one of:
  philosophy | relationships | history | banter | mannerisms | trivia | information

paraphrase — ONE natural-language sentence describing what the characters are currently focused on, written as prose (not a keyword list). This is used to search memories by meaning, so make it specific and self-contained. Example: "They are arguing about whether to trust the stranger who arrived at the inn last night."

retrospective — true when the conversation is currently referencing past shared events or asking to recall them, including events from earlier the same day ("remember when we…", "last week you said…", "that place we visited", "the mission today", "how did it go this morning?", "what happened at the pool?"). Talking about how things are right now or planning the future is NOT retrospective.

timeRange — when the turn references a specific past period, resolve it against the TODAY line in the input into absolute ISO dates: {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}. "last week" on a Tuesday resolves to the previous calendar week; "in March" to that month; "today" / "this morning" to the TODAY date itself; "yesterday" to the day before it. Use null when no time period is referenced or you cannot resolve one. (On a fictional timeline, use null unless real dates are actually stated.)

entities — 0-5 proper nouns the turn names or clearly implies: places, people, named things ("Lighthouse Point", "Amy"). Empty array when none.

Respond with a JSON object (3-10 keywords):
{"keywords": ["keyword1", "keyword phrase 2", "keyword3"], "temporal": "present", "context": "relationships", "paraphrase": "A single sentence describing the current focus.", "retrospective": false, "timeRange": null, "entities": []}
{"keywords": ["mission report", "soil samples"], "temporal": "past", "context": "information", "paraphrase": "Charlie is asking how today's mission went.", "retrospective": true, "timeRange": {"from": "2026-07-28", "to": "2026-07-28"}, "entities": ["Constantinople"]}

JSON only - no other text.`

const MEMORY_RECAP_PROMPT = `You are summarizing a character's memories to help them recall what they know at the start of a conversation.

You will receive memories organized by importance (high, medium, low), each with a relative age label.

Write a concise first-person narrative summary (from the character's perspective, using "I") of what the character remembers. Focus on:
- Key relationships and what the character knows about other people
- Important events and emotional moments
- Ongoing situations or unresolved threads
- Recent interactions and their significance

Keep the summary under 500 words. Use natural language, not bullet points. Write as a stream of consciousness — what's top of mind, what lingers, what matters. More recent and higher-importance memories should be given more weight.

If there are no memories, respond with exactly: NO_MEMORIES`

/**
 * Shared parser for memory extraction responses. The new prompts set the
 * significance bar internally; the parser drops obviously-empty rows
 * (no content and no summary) and caps the array length.
 */
function parseMemoryCandidateArray(content: string): MemoryCandidate[] {
  try {
    const cleanContent = stripCodeFences(content)
    const parsed = JSON.parse(cleanContent)
    const items = Array.isArray(parsed) ? parsed : [parsed]

    const coerced = items
      .map(item => coerceMemoryCandidate(item as Record<string, unknown>, { applyTags: true }))
      .filter((m): m is MemoryCandidate => m !== null)
    // Episodic soft-raise: one slot beyond the cap, only for a dated/placed EVENT.
    return capCandidates(coerced, HARD_CANDIDATE_CAP)
  } catch {
    return []
  }
}

/**
 * Render the participant roster + joined transcript for inclusion in
 * extraction prompts. Single shared formatter so the user-pass, self-pass
 * and inter-character-pass all see byte-identical input prefixes.
 */
function renderTurnContext(transcript: TurnTranscript): string {
  // A user-controlled character now arrives as a slice (built from the turn
  // opener). It is the human participant *and* a memory-forming character, so
  // we list it on the USER line and render its lines once in the body labeled
  // "(the user-controlled character)" — never under the AI-character roster and
  // never duplicated as a standalone opener. AI slices keep their existing
  // labeling, so a turn with no user-controlled slice renders byte-identically
  // to before.
  const aiSlices = transcript.characterSlices.filter(s => !s.isUserControlled)
  const userSlices = transcript.characterSlices.filter(s => s.isUserControlled)
  const hasUserSlice = userSlices.length > 0

  const roster: string[] = ['PARTICIPANTS IN THIS TURN:']
  const userDisplayName = transcript.userCharacterName ?? userSlices[0]?.characterName ?? null
  if (userDisplayName) {
    roster.push(`- USER: ${userDisplayName} (the human participant)`)
  } else if (transcript.userMessage !== null) {
    roster.push('- USER: The human participant')
  }

  if (aiSlices.length === 1) {
    const slice = aiSlices[0]
    roster.push(
      `- CHARACTER: ${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)} (an AI character)`
    )
  } else if (aiSlices.length > 1) {
    roster.push('- CHARACTERS (AI characters in this chat):')
    for (const slice of aiSlices) {
      roster.push(
        `  * ${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)}`
      )
    }
  }

  const transcriptSections: string[] = []
  // Render the standalone opener only when no user slice carries it — i.e. a
  // plain human with no character. When a user slice exists, its body line
  // below is the single rendering of that text.
  if (transcript.userMessage !== null && !hasUserSlice) {
    const userLabel = transcript.userCharacterName
      ? `${transcript.userCharacterName} (the user)`
      : 'The user'
    transcriptSections.push(`${userLabel} says:\n"${transcript.userMessage}"`)
  }
  for (const slice of transcript.characterSlices) {
    const role = slice.isUserControlled ? 'the user-controlled character' : 'the character'
    const characterLabel = `${formatNameWithPronouns(slice.characterName, slice.characterPronouns ?? null)} (${role})`
    transcriptSections.push(`${characterLabel} says:\n"${slice.text}"`)
  }

  return `${roster.join('\n')}

TURN TRANSCRIPT:

${transcriptSections.join('\n\n')}`
}

/**
 * Extract self-revelatory memories about a single CHARACTER from the joined
 * turn transcript. The prompt names the target character and carries that
 * character's canon block so the extractor can skip already-established
 * identity facts.
 */
export async function extractSelfMemoriesFromTurn(
  transcript: TurnTranscript,
  targetCharacterId: string,
  canonBlock: string,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  resolvedMaxTokens?: number,
  inAutonomousRoom: boolean = false,
  orienting?: OrientingContext,
  clock?: ExtractionClock,
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  const target = transcript.characterSlices.find(s => s.characterId === targetCharacterId)
  if (!target) {
    return { success: true, result: [], usage: undefined }
  }

  const maxMemories = resolveMaxMemories(resolvedMaxTokens)
  const targetLabel = formatNameWithPronouns(target.characterName, target.characterPronouns ?? null)
  const isUserControlled = target.isUserControlled ?? false

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getSelfMemoryExtractionPrompt(maxMemories, targetLabel, canonBlock, inAutonomousRoom, orienting, isUserControlled, clock),
    },
    {
      role: 'user',
      content: renderTurnContext(transcript),
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseMemoryCandidateArray,
    'memory-extraction-self',
    chatId,
    undefined,
    uncensoredFallback,
    resolvedMaxTokens,
    targetCharacterId
  )
}

/**
 * Extract memories one CHARACTER (the observer) forms about every other
 * participant (subjects) in a single LLM call. Subjects may include other
 * characters or the user-controlled character. The caller pre-resolves
 * each subject's canon block (typically via
 * `loadCanonForObserverAboutSubject`, which prefers an `Others/<name>.md`
 * file in the observer's vault and falls back to the subject's identity
 * property).
 *
 * Returns a Map keyed by subject id so the caller can route candidates
 * back to the right `aboutCharacterId` without ambiguity. Subjects that
 * yielded no candidates appear in the map with an empty array.
 *
 * The single-subject equivalent existed before — folding all subjects
 * into one call collapses an O(observers × subjects) call count to
 * O(observers), which is the bottleneck for long extraction runs.
 */
export async function extractOtherMemoriesFromTurn(
  transcript: TurnTranscript,
  observerCharacterId: string,
  subjects: ReadonlyArray<OtherSubjectInput>,
  selection: CheapLLMSelection,
  userId: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  chatId?: string,
  resolvedMaxTokens?: number,
  inAutonomousRoom: boolean = false,
  orienting?: OrientingContext,
  clock?: ExtractionClock,
): Promise<CheapLLMTaskResult<Map<string, MemoryCandidate[]>>> {
  const observer = transcript.characterSlices.find(s => s.characterId === observerCharacterId)
  if (!observer || subjects.length === 0) {
    const empty = new Map<string, MemoryCandidate[]>()
    for (const s of subjects) empty.set(s.id, [])
    return { success: true, result: empty, usage: undefined }
  }

  const perSubjectCap = resolveMaxMemories(resolvedMaxTokens)
  const observerLabel = formatNameWithPronouns(observer.characterName, observer.characterPronouns ?? null)

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getOtherMemoryExtractionPrompt(perSubjectCap, observerLabel, subjects, inAutonomousRoom, orienting, clock),
    },
    {
      role: 'user',
      content: renderTurnContext(transcript),
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string) => parseOtherCandidatesBySubject(content, subjects, perSubjectCap),
    'memory-extraction-other',
    chatId,
    undefined,
    uncensoredFallback,
    resolvedMaxTokens,
    observerCharacterId
  )
}

/**
 * Batch memory extraction from multiple message pairs
 * More efficient than calling extractMemoryFromMessage multiple times
 *
 * @param exchanges - Array of user/assistant message pairs
 * @param context - Additional context
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @returns Array of memory candidates
 */
export async function batchExtractMemories(
  exchanges: Array<{ userMessage: string; assistantMessage: string }>,
  context: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<CheapLLMTaskResult<MemoryCandidate[]>> {
  // Format all exchanges for batch processing
  const exchangesText = exchanges
    .map((e, i) => `Exchange ${i + 1}:\nUser: ${e.userMessage}\nAssistant: ${e.assistantMessage}`)
    .join('\n\n---\n\n')

  const batchPrompt = `Analyze these conversation exchanges. For each exchange that contains something significant worth remembering about the user/character, emit a memory object. Skip exchanges that contain nothing significant.

Criteria for significance:
- Personal information shared (preferences, history, relationships, traits)
- Emotional moments or important decisions
- Facts that should persist across conversations
- Changes in character development or relationships

Respond with a JSON array of memory objects (one per significant exchange — skip the rest):
[
  { "content": "...", "summary": "...", "keywords": [...], "importance": 0.X },
  ...
]`

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: batchPrompt,
    },
    {
      role: 'user',
      content: `Context: ${context}

${exchangesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemoryCandidate[] => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)
        if (!Array.isArray(parsed)) {
          return []
        }

        return parsed
          .map((item: Record<string, unknown>) => coerceMemoryCandidate(item, { applyTags: false }))
          .filter((m): m is MemoryCandidate => m !== null)
      } catch {
        // If parsing fails, return empty array
        return []
      }
    },
    'batch-memory-extraction',
    chatId
  )
}

// ============================================================================
// Fold-time episode consolidation (episodic spine — creation-side keystone)
// ============================================================================

/**
 * One message of the just-folded window, with its wall-clock timestamp so the
 * model can date the episode from the transcript rather than guessing.
 */
export interface FoldEpisodeMessage {
  speaker: string
  content: string
  createdAt: string | null
}

/**
 * A consolidated episode record extracted from a folded window: one coherent
 * dated narrative of something that happened, spanning however many turns it
 * took. Written as a `kind: 'episodic'` memory for each present character.
 */
export interface FoldEpisode {
  /** 2–3 sentence narrative of what happened, naming place and time. */
  narrative: string
  /** 3–8 word summary, lowercase. */
  summary: string
  /** When it happened — absolute date preferred, else a relative/in-story phrase. */
  when?: string
  /** In-story time phrase (narrative-timeline chats). */
  narrativeTime?: string
  /** Proper nouns of the episode: places, people, named things. */
  entities: string[]
  /** Participant names involved in the episode. */
  participants: string[]
  /** Importance 0.2–1.0. */
  importance: number
}

/** Hard cap on consolidated episodes per fold. */
export const FOLD_EPISODE_CAP = 2

const FOLD_EPISODE_PROMPT = `You are consolidating a batch of roleplay conversation turns into EPISODE records — coherent, dated accounts of specific things that happened.

An episode is a real occurrence at a specific time and/or place: an outing, a visit, an arrival, a completed undertaking, a notable incident. It is NOT a standing fact, an opinion, a mood, or an ongoing thread — only something that happened.

Read the dated turns below. Return 0–${FOLD_EPISODE_CAP} episodes. Most windows contain none — return [] freely. Only emit an episode when the turns actually depict or recount a specific occurrence worth remembering as an event.

For each episode:
  narrative     2–3 sentences, past tense, third person, using participant
                names. The prose must ITSELF name the place and the time
                ("On July 14th, Amy and Charlie visited Lighthouse Point
                and bought the brass sextant…").
  summary       3–8 words, lowercase, no punctuation
  when          when it happened: an absolute date (YYYY-MM-DD, resolved
                against the message timestamps and the CLOCK line) whenever
                possible, otherwise the phrase as stated
  narrativeTime the in-story time phrase, only when the story runs on a
                fictional timeline ("the third night at sea")
  entities      2–6 proper nouns: places, people, named things
  participants  names of those involved
  importance    0.20–1.00 (0.9 = a day the participants will retell for
                years; 0.5 = a pleasant but ordinary outing)

Return a JSON array only. No prose, no code fences. If nothing qualifies, return [].`

function parseFoldEpisodes(content: string): FoldEpisode[] {
  try {
    const clean = stripCodeFences(content)
    const parsed = JSON.parse(clean)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const episodes: FoldEpisode[] = []
    for (const raw of items) {
      if (episodes.length >= FOLD_EPISODE_CAP) break
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const narrative = typeof item.narrative === 'string' ? item.narrative.trim() : ''
      if (!narrative) continue
      const summary = typeof item.summary === 'string' && item.summary.trim().length > 0
        ? item.summary.trim()
        : narrative.slice(0, 60)
      const strArray = (v: unknown): string[] =>
        Array.isArray(v)
          ? (v as unknown[]).filter((e): e is string => typeof e === 'string' && e.trim().length > 0).map(e => e.trim()).slice(0, 8)
          : []
      episodes.push({
        narrative,
        summary,
        when: typeof item.when === 'string' && item.when.trim().length > 0 ? item.when.trim() : undefined,
        narrativeTime: typeof item.narrativeTime === 'string' && item.narrativeTime.trim().length > 0
          ? item.narrativeTime.trim()
          : undefined,
        entities: strArray(item.entities),
        participants: strArray(item.participants),
        importance: typeof item.importance === 'number'
          ? Math.min(1, Math.max(0.2, item.importance))
          : 0.6,
      })
    }
    return episodes
  } catch {
    return []
  }
}

/**
 * Fold-time episode pass: over the just-folded message window, ask the cheap
 * LLM for 0–{@link FOLD_EPISODE_CAP} consolidated episode records. Per-turn
 * extraction sees one turn at a time and produces fragments; a real outing
 * spans many turns and deserves one coherent, dated record. Piggybacks the
 * existing fold cadence — no new trigger.
 */
export async function extractEpisodesFromFold(
  windowMessages: FoldEpisodeMessage[],
  clock: ExtractionClock,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
): Promise<CheapLLMTaskResult<FoldEpisode[]>> {
  if (windowMessages.length === 0) {
    return { success: true, result: [] }
  }

  const rendered = windowMessages
    .map(m => {
      const stamp = m.createdAt ? `[${m.createdAt.slice(0, 16).replace('T', ' ')}] ` : ''
      const content = m.content.length > 1500 ? `${m.content.slice(0, 1500)}…` : m.content
      return `${stamp}${m.speaker}: ${content}`
    })
    .join('\n\n')

  const clockLine =
    `CLOCK: current date/time ${clock.nowIso}; timeline mode ${clock.timelineMode}` +
    (clock.narrativeNow?.trim() ? `; current in-story time ${clock.narrativeNow.trim()}` : '')

  const messages: LLMMessage[] = [
    { role: 'system', content: FOLD_EPISODE_PROMPT },
    { role: 'user', content: `${clockLine}\n\nDATED TURNS:\n\n${rendered}` },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    parseFoldEpisodes,
    'fold-episode-extraction',
    chatId,
  )
}

/**
 * Result of the unified keyword distillation: the search keywords plus a
 * best-guess `temporal`/`context` label for the current turn. The two guesses
 * are validated against the closed vocabularies and left undefined when the
 * model omits or garbles them, so the recall-side adjustments that consume them
 * simply disable themselves rather than acting on noise.
 */
export interface MemorySearchExtraction {
  keywords: string[]
  temporal?: TemporalTag
  context?: ContextTag
  /**
   * A single natural-language sentence describing what the characters are
   * currently focused on. This — not the keyword bag — is what the recall path
   * embeds: sentence-embedding models are trained on prose, so a sentence lands
   * in a far more discriminating region of embedding space than `keywords.join`.
   * Undefined when the model omits it (caller falls back to the prose query).
   */
  paraphrase?: string
  // ── Episodic recall (all default to inert values on parse failure) ─────────
  /** True when the turn references past shared events. Absent → false. */
  retrospective?: boolean
  /**
   * Absolute ISO time window the turn references, resolved by the model
   * against the TODAY line ("last week" → {from, to}). Null/absent → none.
   */
  timeRange?: { from: string; to: string } | null
  /** Places/people/things named or implied by the turn. Absent → []. */
  entities?: string[]
}

/**
 * How many of the most recent messages the deterministic day-reference scanner
 * reads. Deliberately far tighter than the 20 the prompt sees: an override that
 * fires on a stale "yesterday" from three topics ago is worse than no override.
 */
const DAY_REFERENCE_SCAN_MESSAGES = 4

/** Local `YYYY-MM-DD` stamp (never `toISOString().slice(0,10)`, which is UTC). */
function localDateStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Merge a deterministically-resolved day reference into the LLM's parsed
 * signals (Fix 1 of the day-references + fresh-boost spec).
 *
 * - Past-pointing reference → the resolved window OVERRIDES any LLM range and
 *   forces `retrospective: true`. The override is the point: the model's own
 *   ranges are UTC-day-biased, and that bias is what made a same-day "the
 *   mission today" resolve to a window containing none of the mission.
 * - Future-only reference ("tomorrow") → nothing applied; whatever the model
 *   said stands, since the lexicon covers less than the model does.
 * - No reference → the parsed result passes through unchanged.
 *
 * Accepted cost: a purely forward-looking "let's go to the pool today" marks
 * the turn retrospective. The consequences (a temporal flip toward today's
 * memories, one turn without the anti-repetition penalty) are benign, and
 * intent heuristics to dodge it would reintroduce exactly the brittleness this
 * resolver exists to remove.
 */
function mergeDayReference(
  parsed: MemorySearchExtraction,
  dayReference: DayReferenceResolution | null,
  chatId: string | undefined,
  characterId: string | undefined,
): MemorySearchExtraction {
  if (!dayReference) return parsed

  if (!dayReference.pastPointing) {
    logger.debug('[MemorySearchKeywords] Day reference is future-pointing; leaving LLM signals alone', {
      chatId,
      characterId,
      matched: dayReference.matched,
    })
    return parsed
  }

  logger.debug('[MemorySearchKeywords] Deterministic day reference resolved', {
    chatId,
    characterId,
    matched: dayReference.matched,
    from: dayReference.timeRange.from,
    to: dayReference.timeRange.to,
    overrodeLlmTimeRange: !!parsed.timeRange,
    llmRetrospective: parsed.retrospective === true,
  })

  return { ...parsed, retrospective: true, timeRange: dayReference.timeRange }
}

/**
 * Extracts memory search keywords from recent conversation messages, plus a
 * turn-level temporal/context guess.
 *
 * Used for proactive memory recall: analyzes messages since the character last
 * spoke to find keywords for searching the character's memory store. The turn
 * guess feeds the recall-side targeting-tag adjustments (lib/memory/recall-tags.ts).
 *
 * @param recentMessages - Messages since the character last spoke
 * @param characterName - The name of the character whose memories will be searched
 * @param selection - The cheap LLM provider selection
 * @param userId - The user ID for API key retrieval
 * @param chatId - Optional chat ID for logging
 * @returns Keywords for memory search plus an optional turn-level temporal/context guess
 */
export async function extractMemorySearchKeywords(
  recentMessages: ChatMessage[],
  characterName: string,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  characterId?: string,
  clock?: ExtractionClock
): Promise<CheapLLMTaskResult<MemorySearchExtraction>> {
  // Truncate messages to keep cheap LLM call fast
  const cappedMessages = recentMessages.slice(-20)
  const conversationText = cappedMessages
    .map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Character' : 'System'
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content
      return `${speaker}: ${content}`
    })
    .join('\n\n')

  // TODAY line (variable — user content, never the cached system prompt) so
  // the model can resolve "last week" into an absolute timeRange.
  //
  // Rendered from the SERVER-LOCAL calendar, not UTC: Quilltap is self-hosted,
  // so the server's timezone is the user's. A UTC TODAY line tells a user
  // talking at 21:44 CDT that it is already tomorrow, and every "today" the
  // model resolves then lands on a day containing none of the memories it
  // means (see lib/memory/day-references.ts, which does the same math).
  const nowIso = clock?.nowIso ?? new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const timelineMode = clock?.timelineMode ?? 'realtime'
  const todayLine = Number.isFinite(nowMs)
    ? `TODAY: ${localDateStamp(new Date(nowMs))} (${WEEKDAYS[new Date(nowMs).getDay()]}); timeline mode: ${timelineMode}`
    : `TODAY: ${nowIso}; timeline mode: ${timelineMode}`

  // Deterministic day-reference resolution (Fix 1). Scanned over the most
  // recent messages only — the prompt sees 20, but older context routinely
  // carries a stale "yesterday" from a previous topic, and a deterministic
  // override must stay tight to the live turn. Realtime timelines only,
  // matching the prompt's own rule for fictional clocks.
  const dayReference =
    timelineMode === 'realtime' && Number.isFinite(nowMs)
      ? resolveDayReference(
          cappedMessages
            .slice(-DAY_REFERENCE_SCAN_MESSAGES)
            .map(m => m.content)
            .join('\n'),
          new Date(nowMs),
        )
      : null

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: MEMORY_KEYWORD_EXTRACTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}\n${todayLine}\n\nRecent conversation:\n${conversationText}\n\nExtract keywords for searching ${characterName}'s memories:`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): MemorySearchExtraction => {
      try {
        const cleanContent = stripCodeFences(content)
        const parsed = JSON.parse(cleanContent)

        // Accept either the new object shape { keywords, temporal, context } or a
        // bare keyword array (legacy / model drift). A bare array carries no turn
        // guess, which simply leaves context steering disabled for the turn.
        const rawKeywords: unknown = Array.isArray(parsed) ? parsed : parsed?.keywords
        const keywords = Array.isArray(rawKeywords)
          ? rawKeywords
              .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
              .slice(0, 10)
          : []

        const rawTemporal =
          !Array.isArray(parsed) && typeof parsed?.temporal === 'string'
            ? parsed.temporal.trim().toLowerCase()
            : ''
        const rawContext =
          !Array.isArray(parsed) && typeof parsed?.context === 'string'
            ? parsed.context.trim().toLowerCase()
            : ''
        const temporal = TEMPORAL_VALUES.has(rawTemporal) ? (rawTemporal as TemporalTag) : undefined
        const context = CONTEXT_VALUES.has(rawContext) ? (rawContext as ContextTag) : undefined

        const rawParaphrase =
          !Array.isArray(parsed) && typeof parsed?.paraphrase === 'string'
            ? parsed.paraphrase.trim()
            : ''
        const paraphrase = rawParaphrase.length > 0 ? rawParaphrase : undefined

        // Episodic signals — every one defaults to inert on garbling so
        // recall degrades to exactly today's behavior, never blocks.
        const retrospective =
          !Array.isArray(parsed) && parsed?.retrospective === true
        let timeRange: { from: string; to: string } | null = null
        if (!Array.isArray(parsed) && parsed?.timeRange && typeof parsed.timeRange === 'object') {
          const tr = parsed.timeRange as Record<string, unknown>
          const from = typeof tr.from === 'string' ? tr.from.trim() : ''
          const to = typeof tr.to === 'string' ? tr.to.trim() : ''
          if (
            /^\d{4}-\d{2}-\d{2}/.test(from) &&
            /^\d{4}-\d{2}-\d{2}/.test(to) &&
            Number.isFinite(Date.parse(from)) &&
            Number.isFinite(Date.parse(to))
          ) {
            // Normalize date-only bounds to full-day coverage.
            const fromIso = from.length === 10 ? `${from}T00:00:00.000Z` : from
            const toIso = to.length === 10 ? `${to}T23:59:59.999Z` : to
            if (Date.parse(fromIso) <= Date.parse(toIso)) {
              timeRange = { from: fromIso, to: toIso }
            }
          }
        }
        const entities =
          !Array.isArray(parsed) && Array.isArray(parsed?.entities)
            ? (parsed.entities as unknown[])
                .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
                .map(e => e.trim())
                .slice(0, 5)
            : []

        return mergeDayReference(
          { keywords, temporal, context, paraphrase, retrospective, timeRange, entities },
          dayReference,
          chatId,
          characterId,
        )
      } catch {
        // Unparsable response — callers bail on empty keywords, so there is
        // nothing for the deterministic window to ride along with.
        return { keywords: [] }
      }
    },
    'memory-keyword-extraction',
    chatId,
    undefined,
    undefined,
    undefined,
    characterId
  )
}

/**
 * Summarizes a character's tiered memories into a narrative recap.
 * Sent to the cheap LLM so the character has a sense of "what I remember"
 * at the start of a conversation.
 *
 * @param characterName - The character's name (for prompt context)
 * @param tieredMemories - Memories grouped by importance tier with age labels
 * @param selection - Cheap LLM selection to use
 * @param userId - User ID for API key access
 * @param chatId - Optional chat ID for logging
 * @returns Summarized memory recap text
 */
export async function summarizeMemoryRecap(
  characterName: string,
  tieredMemories: {
    high: Array<{ summary: string; age: string }>
    medium: Array<{ summary: string; age: string }>
    low: Array<{ summary: string; age: string }>
  },
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  uncensoredFallback?: UncensoredFallbackOptions,
  characterId?: string
): Promise<CheapLLMTaskResult<string>> {
  const totalCount = tieredMemories.high.length + tieredMemories.medium.length + tieredMemories.low.length
  if (totalCount === 0) {
    return { success: true, result: '' }
  }

  const formatTier = (label: string, memories: Array<{ summary: string; age: string }>) => {
    if (memories.length === 0) return ''
    const lines = memories.map(m => `- [${m.age}] ${m.summary}`).join('\n')
    return `### ${label} Importance\n${lines}`
  }

  const memoriesText = [
    formatTier('High', tieredMemories.high),
    formatTier('Medium', tieredMemories.medium),
    formatTier('Low', tieredMemories.low),
  ].filter(Boolean).join('\n\n')

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: MEMORY_RECAP_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}\n\n## Memories\n${memoriesText}`,
    },
  ]

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): string => {
      const trimmed = content.trim()
      if (trimmed === 'NO_MEMORIES') return ''
      return trimmed
    },
    'memory-recap-summarization',
    chatId,
    undefined,
    uncensoredFallback,
    undefined,
    characterId
  )
}
