# Episodic Recall Overhaul — Remember the Visit, the Place, and the Week

**Status:** Implemented 2026-07-21 (all five workstreams + §3 harness). Awaiting
§3 step 2 — Charlie replaying real "forgot / confabulated" turns via
`quilltap recall-replay` — before the constants are considered tuned and the
spec moves to `complete/`.
**Owner:** Charlie
**Drafted:** 2026-07-21

**Implementation notes / deviations (2026-07-21):**

1. **Fold Timeline vs. episode pass — two cheap calls, not one.** The Timeline
   section is model-maintained inside `FOLD_SUMMARY_PROMPT` (append-only,
   carry-forward), because the fold output is stored verbatim as
   `contextSummary` — deriving the Timeline programmatically from the episode
   records would fight the fold's own rewrite. The consolidated episode
   records come from a separate `extractEpisodesFromFold` call on the same
   fold cadence (`lib/memory/fold-episode-pass.ts`). Cost: one extra cheap
   call per fold (every ~5 turns).
2. **`timelineMode` has no UI toggle yet** — schema + backend honor it
   (`chats.timelineMode`, settable via API/CLI); a chat-settings switch is a
   follow-up.
3. **The `search` collision was already half-resolved** — only the Scriptorium
   `search` was registered by `buildUniversalToolDefinitions`;
   `memory-search-tool.ts` was dead code and has been deleted.
4. **Optional batched re-embed of legacy rows was not built** (spec marked it
   optional/do-not-block); mixed old/new embedded-text rows are the accepted
   state.
5. **The §3 harness** is `POST /api/v1/chats/[id]?action=recall-replay`
   (`lib/memory/recall-replay.ts`) wrapped by `quilltap recall-replay`,
   following the `memory-diff` CLI pattern. The replay anchors the
   distillation clock to the replayed turn's own timestamp.
**Builds on:** [commonplace-whisper-overhaul.md](./complete/commonplace-whisper-overhaul.md), [commonplace-relevance-fix.md](./commonplace-relevance-fix.md)

A handoff spec for Claude Code. The 4.7 whisper overhaul fixed where recall
material comes *from*; the relevance fix (F1–F5) made per-turn recall *topical*.
Both left a deeper gap untouched: the system has **no concept of an episode** —
no event time, no place, no entities — and the pipeline actively strips what
little episodic detail survives extraction. The user-visible symptom: a user
says "remember, we visited that place last week?" and the character either
draws a blank or confabulates, because nothing in retrieval can honor "that
place" or "last week," and the turn that needs rich recall is exactly the turn
that gets the smallest, dateless whisper.

Read §1 before touching code. Line references are from a 2026-07-21 read of the
working tree — verify before editing.

**Decisions already made (2026-07-21, Charlie):**

1. **Dual time basis.** `occurredAt` is wall-clock event time (stamped from
   message timestamps, always available). A separate optional `narrativeTime`
   free-text field captures in-story time for fiction/scenario chats.
   Retrospective queries resolve against wall-clock by default, narrative time
   when the chat is flagged as running on a fictional timeline.
2. **Full mini-recap on trigger.** When a turn is detected as retrospective,
   fire a scoped mini-recap (dated conversation list + `read_conversation`
   UUIDs + enlarged dynamic head) — not merely a ranking boost, and not an
   always-on per-turn block.

---

## 1. Diagnosis — why characters are amnesiac about episodes

### 1.1 Event time does not exist anywhere in the system

A memory row has `createdAt` / `lastReinforcedAt` (write/reinforce time) and
nothing else temporal (`lib/database/repositories/memories.repository.ts`;
create paths `memory-service.ts:400-419`). The extraction OUTPUT spec asks for
content / summary / keywords / importance only
(`lib/memory/cheap-llm-tasks/memory-tasks.ts:213-218,385-395`) — never when or
where. Time decay is keyed to `max(createdAt, lastReinforcedAt)`
(`memory-weighting.ts:47-53`), i.e. the *write* clock, so a memory written
after the fact, or reinforced later, carries a misleading age. There is no
date-range parameter on any retrieval path — the only date-bounded query in the
memories repo is a rate-limiter counter (`memories.repository.ts:646`). "Last
week" structurally cannot become a filter.

### 1.2 The ranking penalizes the past precisely when the user invokes it

A memory tagged `temporal: past` is multiplied by **0.85** on every recall
(`recall-tags.ts:264`); `moment` gets **0.70**. Meanwhile `turnTemporal` — the
field that could say "this turn is retrospective" — is an explicit no-op
(`recall-tags.ts:100-104`). So the exact class of memory a "remember last
week?" turn needs is systematically demoted, always. And if the character
fumbles and the user re-asks, the `recentlyWhispered` ×0.60 anti-repetition
penalty (`recall-tags.ts:149`, `recall-history.ts:18`) actively buries the
memory they are trying to pin down.

### 1.3 Dates are stripped at every downstream stage

* The per-turn dynamic head renders memories with **no date at all**
  (`formatDynamicMemoryHead`, `memory-injector.ts:566-577`). The
  `[last week]`-style age labels exist only in `formatMemoriesForContext`
  (`memory-injector.ts:284`) — a formatter the per-turn head does not use.
  Even on a retrieval hit, the model cannot confirm "last week."
* The fold summary schema is Active threads / Resolved decisions / Emotional
  state / Open questions (`FOLD_SUMMARY_PROMPT`, `chat-tasks.ts:646-655`).
  There is no slot for "what happened, where, when" — a specific visit is none
  of those four things, so every fold silently discards it.
* The memory compression prompt **instructs** the model to drop "Exact
  dates/times when relative timing is sufficient" and concluded events
  (`compression-tasks.ts` `MEMORY_COMPRESSION_PROMPT`, ~line 92).
* The vault conversation-summary files *do* carry `firstMessageAt` /
  `lastMessageAt` ISO timestamps in frontmatter
  (`conversation-summary-vault-bridge.ts:136-153`) — the richest episodic
  metadata in the system — but nothing reads them: not retrieval, not
  rendering. The rendered conversation lists show title + UUID only, no dates
  (`conversation-summary-search.ts:172-177`; `memory-recap.ts:190-199`).

### 1.4 Rich recall never fires at the moment of reference

The recap — narrative + recent/relevant conversation lists + the
`READ_CONVERSATION_CALL_NOTE` telling the character it can drill in — fires
only at chat start / character join (`context-builder.service.ts:577-589`) and
the relevant-conversations refresh only on fold
(`relevant-conversations-refresh.ts`). On the ordinary mid-chat turn where the
user says "last week," the character gets: a 200-token, 5-entry, dateless
dynamic head (`DYNAMIC_HEAD_TOKEN_BUDGET=200`,
`DYNAMIC_HEAD_DEFAULT_SIZE=5`, `memory-injector.ts:42-44`), and no pointer to
the source conversation.

### 1.5 The deep-dive path exists but is untaught and slightly broken

* **Tool name collision:** `memory-search-tool.ts:84` and
  `search-scriptorium-tool.ts:115` both register `name: 'search'`. The
  registry keys a Map by name (`registry.ts:36,42`), so one shadows the other.
* The tools accept **no time filters** and no about-character filter; memory
  results return `createdAt` (write time — not event time) and no
  `conversationId`, so a recalled memory cannot be traced to its source
  conversation via the memory tool.
* No orchestration guidance anywhere teaches the chain *search →
  `conversationId` → `read_conversation`* or the norm "if you can't find it,
  say so — never invent specifics." The only hint is the parenthetical
  "(e.g., from search results)" in `read-conversation-tool.ts:56`.

### 1.6 The write path erodes episodes by design

* `HARD_CANDIDATE_CAP = 2` per extraction call (`memory-tasks.ts:36`) — a rich
  multi-event turn yields at most two one-sentence self-memories.
* The memory gate skips writes at cosine ≥ 0.90 and reinforces at ≥ 0.85
  (`memory-gate.ts:171-195`). "Same activity, different occasion" — visited
  the harbor in spring vs. winter — can collapse into one record when the only
  differentiator is a date the embedding text underweights. This *causes* the
  "confabulates which time it was" symptom.
* The gate's date-capture regexes (`extractNovelDetails`,
  `memory-gate.ts:546-623`) run only on REINFORCE — the *first* observation of
  an event loses its date; only a later restatement preserves it. Backwards.
* Housekeeping deletes low-importance, low-reinforcement, low-graph-degree
  memories after 6 months (`housekeeping.ts:115-126`) — the exact statistical
  profile of a one-off episodic memory.

### 1.7 What is *not* broken (don't "fix" these)

* The relevance-fix machinery: `computeRankingBlend` 0.75/0.25, the
  provider-aware cosine floor, paraphrase queries, anti-repetition ring buffer
  — all working as designed. This spec *modulates* them (§B), it does not
  replace them. (Note: stale comments in `memory-service.ts:262,823-829` still
  describe the old 0.4/0.6 blend — clean up while in there.)
* The fold-triggered relevant-conversations refresh — still the healthiest
  retrieval in the system. §C reuses its machinery rather than duplicating it.
* The vault summary bridge — already stamps the frontmatter we need.

---

## 2. The plan — five workstreams

Land A first (everything else consumes its fields). B and C are the payoff.
D and E can proceed in parallel with B/C. Each workstream is an independent
commit series.

### A. Episodic spine — event time, place, entities as first-class data

**Schema (migration; all nullable, no backfill blocking):**

* `occurredAt: string | null` — ISO wall-clock event time.
* `narrativeTime: string | null` — free-text in-story time ("the third night
  at sea"), extractor-filled only when the chat runs a fictional timeline.
* `entities: string[]` — proper nouns of the episode: places, people,
  named things. Distinct from `keywords` (which carry the targeting tags).
* `kind: 'semantic' | 'episodic'` — default `'semantic'`. An episodic memory
  records a specific occurrence ("we visited Lighthouse Point on the 14th");
  a semantic one records a standing fact ("Charlie likes lighthouses").
  Retrieval, the gate, and housekeeping all treat them differently (below) —
  keying behavior off a declared kind beats inferring it from whether
  `occurredAt` happens to be set.

**Stamping rules:**

* For memories about the current turn: `occurredAt` = the source turn's
  message timestamp (`sourceMessageId` → message `createdAt`). Do **not** ask
  the model for it — it's authoritative from the transcript.
* For retold events ("last month we…"): extraction may emit a relative time
  phrase; resolve it against the turn timestamp server-side into `occurredAt`,
  keep the phrase in `narrativeTime` if the chat is fictional-timeline.
* Chat-level flag (chat settings or scenario metadata): `timelineMode:
  'realtime' | 'narrative'`. Defaults to `realtime`. Governs which clock B's
  time-range resolution uses.

**Extraction prompt changes (`memory-tasks.ts`):**

* **Give the extractor a clock.** The prompt currently sees only the turn
  transcript. Add a header line: today's wall-clock date/time, the chat's
  `timelineMode`, and (for narrative chats) the current in-story time if the
  scene state knows it. Without this, the model cannot resolve "yesterday" or
  "last spring" while extracting — with it, `when` phrases come back already
  anchorable.
* Add an EVENT category to both SELF and OTHER pick-lists ("a specific thing
  that happened at a specific time/place"), and ask OUTPUT for `kind`,
  optional `when` (relative or absolute phrase), and `entities`. Instruct
  that an EVENT's `content` sentence should itself name the place and time
  ("On July 14th we visited Lighthouse Point and…") so the prose — and its
  embedding — carries the anchors even before the anchor line is appended.
* Allow a third candidate slot **only** when a dated/placed EVENT is present
  (soft-raise of `HARD_CANDIDATE_CAP` from 2 → 3 for event turns), so events
  don't crowd out hinge/state candidates.
* Run the `extractNovelDetails` date/proper-noun regexes on **first write**,
  not just reinforce, as a safety net populating `entities`/`occurredAt` when
  the model omits them.
* On REINFORCE of an episodic memory, let novel details update
  `occurredAt`/`narrativeTime`/`entities` when the retelling supplies better
  anchors than the original capture — today reinforcement only appends
  footnote prose.

**Fold-time episode pass — the creation-side keystone.** Per-turn extraction,
even at cap 3, sees one turn at a time and produces fragments; a real outing
spans many turns and deserves one coherent record. Add a second, cheap
extraction that runs on the existing fold cadence (piggybacking
`generateContextSummary`, no new trigger): over the just-folded message
window, ask the cheap LLM for **0–2 consolidated episode records** — a 2–3
sentence narrative of what happened, `occurredAt` (from the window's message
timestamps), `narrativeTime`, `entities`, participants. Write them as
`kind: 'episodic'` memories through the normal gate (the date guard in §E
keeps them from being swallowed by near-dup skips), and link the per-turn
fragment memories from the same window via `relatedMemoryIds` so one-hop
expansion can pull the fragments when the episode surfaces. This single
change is what makes "the visit" exist as a first-class, dated, retrievable
thing rather than two disconnected one-liners — and it emits the same
material as §E's Timeline line, so generate both from one LLM call.

**Make dates visible wherever the LLM sees a memory:**

* Append an anchor line to the embedded text:
  `${summary}\n\n${content}\n(when: 2026-07-14 · place: Lighthouse Point)` —
  so the vector itself carries temporal/place signal. New writes only; a
  batched re-embed of existing rows can ride the existing embedding job
  scheduler later (optional, do not block).
* `formatDynamicMemoryHead` (`memory-injector.ts:566-577`): prepend the same
  `[3 days ago]`-style label used by `formatMemoriesForContext`, computed from
  `occurredAt ?? createdAt`, plus `narrativeTime` verbatim when present.
* Memory search tool results: include `occurredAt`, `narrativeTime`, and the
  source `conversationId` (resolvable via `sourceMessageId` → chat).

**Backfill migration:** `occurredAt` := source message `createdAt` where
`sourceMessageId` resolves, else memory `createdAt`. `entities`/`narrativeTime`
stay null. Pure SQL + one pass, no LLM.

### B. Time- and entity-aware retrieval

**Extend the existing per-turn cheap-LLM task — no new call.**
`extractMemorySearchKeywords` / `MemorySearchExtraction`
(`memory-tasks.ts:594,894-906`) additionally emits:

* `retrospective: boolean` — the turn references past shared events.
* `timeRange: { from, to } | null` — absolute ISO, resolved by the model given
  "today is {date}" in the prompt (wall-clock), or a narrative-time phrase
  when the chat is `timelineMode: narrative`.
* `entities: string[]` — places/people/things named or implied by the turn.

All three default to inert values on parse failure — recall must degrade to
exactly today's behavior, never block.

**Consume them in `searchMemoriesSemantic` (`memory-service.ts`):**

* New option `occurredWithin: { from, to }`. Two-stage: filter candidates to
  the window first; if fewer than `limit` survive, fall back to the unfiltered
  pool and mark window hits with a bounded boost (×1.3, clamped in the
  existing multiplier loop) instead. Never return fewer results than today.
* Entity anchoring: when `entities` is non-empty, run the existing
  literal-boost/`searchByContent` union path (currently tool-only,
  `memory-service.ts:648,737-799`) against the entity strings on the injector
  path, so a verbatim place name cannot be sliced off by the cosine floor.
* Multi-probe: on retrospective turns only, embed up to 3 probes (paraphrase;
  entity string; paraphrase + resolved date phrase), union candidate pools,
  keep each memory's max cosine, then blend as today. Bounded cost, gated to
  the turns that need it.

**Make `turnTemporal` real (`recall-tags.ts`):**

* When `retrospective`: `temporalPast` 0.85 → **1.15**, `temporalMoment`
  0.70 → **1.0**, and **suspend** `recentlyWhispered` (the user is deliberately
  re-asking). All still inside the one auditable multiplier loop, still
  clamped [0, 4].

**Vault conversation-summary search learns dates
(`conversation-summary-search.ts`):**

* Read `firstMessageAt`/`lastMessageAt` from frontmatter (already re-read for
  `conversationId`, `:117-152`) and (a) filter/boost by `timeRange` with the
  same two-stage fallback, (b) return them in `VaultConversationMatch` so
  renderers can finally print dates.

### C. Recall-on-reference — the fourth cadence

Today's cadences: once at chat-start/join (recap), every turn (head/state),
on fold (relevant-conversations refresh). Add: **on retrospective turn**.

When B reports `retrospective: true`:

* **Enlarged head for this turn:** `DYNAMIC_HEAD_TOKEN_BUDGET` 200 → 600 and
  entries 5 → 10 (constants, tune via §3), still bounded by `memoryBudget`.
* **Scoped mini-recap block** appended to the consolidated whisper (and the
  LLM recall text): a Relevant Past Conversations list from the vault-summary
  search, scoped by `timeRange`/`entities`, rendered **with dates** —
  `#### {title} ({firstMessageAt:date}) (\`conversationId\`)` — capped at 5
  entries, closed by the existing `READ_CONVERSATION_CALL_NOTE`. Reuse the
  render/search machinery from `relevant-conversations-refresh.ts` and
  `conversation-summary-search.ts`; do not duplicate it.
* **Spam guard:** skip the mini-recap when a block with the same
  timeRange/entity signature was emitted within the last 3 turns (piggyback
  the recall-history ring buffer), and dedup conversation IDs against the
  current on-fold relevant-conversations whisper.
* Whisper plumbing: new `systemKind` (e.g. `'retrospective-recall'`) posted by
  the commonplace writer, swept by the same sweep as consolidated whispers
  (it is turn-specific, unlike `relevant-conversations`).

Cost envelope (accepted): one extra vault-summary embedding search + a larger
whisper, only on turns that reference the past. The whisper already rides in
the cache-busting tail position, so this adds no *new* cache churn.

### D. Teach the deep-dive

* **Fix the `search` collision.** Keep the Scriptorium `search` (superset:
  memories/conversations/documents/knowledge) as the one canonical `search`;
  retire `memory-search-tool.ts` or rename it `memory_search` and exclude it
  from the default character toolset. Audit `buildToolsForProvider` to confirm
  which currently wins.
* **Time/subject filters on `search`:** optional `since`/`until` (ISO) applied
  to memories via `occurredAt ?? createdAt` and to conversation results via
  frontmatter timestamps; optional `aboutCharacter` filter. Results carry
  `occurredAt`, `narrativeTime`, `conversationId`.
* **`read_conversation` range param:** optional `interchangeRange` so a
  character can pull the relevant slice of a very long chat instead of the
  whole transcript.
* **Orchestration prose** (system-prompt tool-instructions builder, one short
  paragraph): *when asked about a past event or specific detail that is not in
  your current recall, use `search` (with `since`/`until` when a time period
  is mentioned), then `read_conversation` on the source conversation, and
  answer from what you find; if you find nothing, say you don't recall —
  never invent specifics.* This is the anti-confabulation norm, stated once,
  where every character sees it.

### E. Stop destroying episodes

* **Fold schema gains a Timeline** (`FOLD_SUMMARY_PROMPT`,
  `chat-tasks.ts:646-655`): fifth section, dated one-liners
  (`- 2026-07-14 (narrative: “third night at sea”): visited Lighthouse Point,
  bought the brass sextant`), append-only across folds, capped ~30 lines with
  oldest lines coarsened first. This turns the vault conversation summaries
  into a genuine dated episodic archive — which B and C then search.
* **Compression prompt** (`compression-tasks.ts` ~92): delete "Exact
  dates/times when relative timing is sufficient" from What-to-DROP; add
  "dates attached to events" to What-to-KEEP.
* **Gate date guard** (`memory-gate.ts`): include the `(when: … · place: …)`
  anchor line in the gate's embedding text, and when candidate and best-match
  `occurredAt` differ by more than 7 days, downgrade SKIP_NEAR_DUPLICATE /
  REINFORCE to INSERT_RELATED — distinct occasions must both persist. (Also
  fix the stale 0.80/0.70 threshold comments at `memory-gate.ts:6-9`.)
* **Housekeeping protection bump** (`memory-weighting.ts:216-299`): a modest
  additive term (e.g. +0.10, capped) for `kind: 'episodic'` rows — episodic
  memories are currently the *first* thing deleted, and they're the hardest
  to regenerate. Prefer demoting a consolidated episode to the vault Timeline
  (durable backstop) over silent deletion; the memory row is what per-turn
  retrieval actually hits, so it should be the last to go.
* Apply the same >7-day date guard to housekeeping's optional `mergeSimilar`.

---

## 3. Validation — build the replay harness first, not last

The relevance fix deferred its CLI replay/tuning harness and shipped untuned
constants. This spec adds a boolean trigger, new multipliers, a window boost,
and budget changes — tuning blind again would be malpractice. Build the
harness as **step 0 of workstream B**:

1. CLI subcommand: given `chatId` + turn index from the Friday instance,
   reconstruct the per-turn extraction (retrospective / timeRange / entities /
   paraphrase) and print the full candidate table — cosine per probe,
   rawWeight, blendedBefore, each multiplier, window filter/boost effect,
   blendedAfter, selected — old path vs. new path side by side.
2. Charlie replays 8–10 real "the character forgot / confabulated" turns and
   confirms: the visit memory surfaces, dated; the mini-recap lists the right
   conversation; the re-ask case survives the suspended anti-repetition.
3. Acceptance scenarios to pin in tests:
   * "we visited X last week" → visit memory in head **with date**, source
     conversation in mini-recap with UUID.
   * Immediate re-ask → same memory still surfaced (no ×0.60 burial).
   * Two visits to the same place, months apart → both rows exist (gate date
     guard) and the correct one wins under a `timeRange`.
   * Non-retrospective turns → byte-identical behavior to today (regression
     guard on the inert path).

---

## 4. Cross-cutting / don't-break list

* **Degrade to today, never block.** Every new signal (retrospective,
  timeRange, entities, occurredAt) is optional; parse failure or null must
  reproduce current behavior exactly. The inert-path regression test in §3 is
  the guard.
* **One multiplier loop.** All new boosts/suspensions live in the existing
  auditable `recall-tags.ts` loop with the existing [0, 4] clamp — no
  side-channel score math.
* **Two embedding scales coexist.** The `(when: … · place: …)` anchor line
  changes embedded text; TF-IDF vocab and the neural profiles react
  differently. The cosine floor stays profile-aware; re-embed backfill is
  optional and batched, and mixed old/new embedded-text rows must be
  acceptable indefinitely.
* **Export/import:** new columns ride `.qtap` export (see the recent
  strip-ephemeral-state fix — decide explicitly: `occurredAt` /
  `narrativeTime` / `entities` are durable data, they **do** export).
* **Prompt-cache:** the whisper is already in the recomputed tail; C adds
  tokens only on retrospective turns. Do not move recall material into the
  cached prefix.
* **SQLite:** index `occurredAt`; migration is additive/nullable; sqleet
  (ChaCha20) unaffected.
* **v5 port:** additive schema + prompt changes only; note them in the v5
  manifest/port docs so the Rust side tracks the new columns.
* **User-facing copy** (any Memory-settings toggle for C's cadence) is
  steampunk voice; CHANGELOG plain; help docs per CLAUDE.md conventions;
  structured logging on every touched backend path.

---

## 5. One-paragraph summary for the commit body

Characters forget or confabulate shared episodes because the memory system has
no concept of one: no event time, place, or entity fields exist; ranking
multiplies `temporal: past` memories by 0.85 even on retrospective turns
(where `turnTemporal` is a no-op); the per-turn dynamic head renders memories
without dates in a 200-token window; fold summaries and the compression prompt
actively strip dates and events; the rich recap with `read_conversation`
pointers fires only at chat start and on fold; and the write path caps
extraction at two one-sentence candidates, near-dup-skips distinct occasions,
and garbage-collects exactly the low-importance one-off memories that episodes
produce. This overhaul adds an episodic spine (`occurredAt` + `narrativeTime` +
`entities`, stamped from message timestamps), time- and entity-aware retrieval
piggybacked on the existing per-turn cheap-LLM extraction, a fourth recall
cadence that fires a dated, drillable mini-recap on retrospective turns,
deep-dive tooling with time filters plus an explicit never-invent-specifics
norm, and creation-side changes — a clocked extraction prompt, an episodic
memory kind, a fold-time episode consolidation pass, fold Timeline section,
gate date guard, and an episodic protection bump — that make episodes exist
as coherent dated records instead of being fragmented, merged away, or
garbage-collected at the source.
