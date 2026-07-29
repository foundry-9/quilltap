# Episodic recall: deterministic day-references + fresh-event boost

**Status:** Spec — ready for implementation
**Origin:** Diagnosed 2026-07-29 on the Friday instance, chat `43ee47a0-1a47-4c4e-8c20-38da2925c29b` ("The Day the House Forgot"). Amy and Abigail could not recall a mission that happened the previous day, despite every memory existing with correct embeddings and `occurredAt` values. Full diagnosis summary in the Background section below.

---

## Background: the confirmed failure chain

The per-turn proactive recall (the Commonplace Book whisper) never surfaced the previous day's memories. Verified with `quilltap recall-replay 43ee47a0-1a47-4c4e-8c20-38da2925c29b --turn 2 --char 3b476cd1-670c-4812-9e3f-58dc48b0368c` against the live server:

1. The cheap-LLM turn distillation (`extractMemorySearchKeywords`, `lib/memory/cheap-llm-tasks/memory-tasks.ts`) returned `retrospective: false, timeRange: null` for a turn where the user literally said *"No, no. I mean the mission **today** … I want to hear about it."* The prompt's retrospective examples are all "remember when we… / last week you said…" phrasings; a reference to *today* pattern-matches "present" for gpt-5-nano-class models.
2. With `retrospective` false, the entire episodic overhaul is inert: no `past↑retro`/`moment·retro` temporal flip, no `occurredWithin` window (hard filter + `window↑` ×1.3 soft boost), no entity/date multi-probe. The replay's OLD and NEW paths were byte-identical.
3. ~75% of event memories from the mission chats are tagged `temporal: moment` (798 of 1,058 across the four July-28 chats). Un-flipped, `moment` takes ×0.7 (`RECALL_MULTIPLIERS.temporalMoment`), while stale evergreen memories tagged `present`, about in-room characters, with a matching context tag stack `narrow✓ · ctx✓ · present↑` = 1.15 × 1.1 × 1.2 ≈ ×1.52.
4. The ranking blend (`computeRankingBlend`, `lib/memory/memory-weighting.ts`) is `0.75·cosine + 0.25·(importance × 0.5^(days/30))` — a yesterday-memory outscores a 12-day-old memory by only ~0.05, far less than the multiplier swings. **Recency is effectively weightless.** Yesterday's mission lost every whisper slot to 11-day-old evergreens.

The explicit `search` tool worked correctly throughout (its `since:` hard filter returned the July-28 memories in full); only the automatic recall path failed, and the response models role-played the silence as in-fiction amnesia.

This spec implements the two highest-impact fixes:

- **Fix 1 — deterministic day-reference resolution:** references like "today", "yesterday", "this morning" resolve to an absolute local-day `timeRange` without depending on the cheap LLM, and drive the episodic window.
- **Fix 2 — fresh-event boost:** memories whose event time is within the last ~48 hours get an unconditional recall-multiplier boost, so "what just happened" stays warm even when Fix 1's detection misses (non-English chats, oblique references, classifier failures).

They are deliberately redundant: Fix 1 is precise but detection-dependent; Fix 2 is coarse but unconditional.

## Non-goals

- Age-scaling the `moment` demotion (candidate follow-up, out of scope here).
- Making extraction emit `kind: 'episodic'` (separate problem; 4 of 27,543 memories today).
- Changing the explicit `search` tool path (`lib/tools/handlers/search-scriptorium-handler.ts`) — it already works; it takes no `recallContext` and must stay a plain hard filter.
- Non-English day-reference lexicons (the LLM path still covers those; the resolver is additive).
- The Host's clock display rendering UTC as if local (observed in the same chat; separate issue).

---

## Fix 1 — deterministic day-reference resolution

### 1.1 New pure module: `lib/memory/day-references.ts`

Pure, I/O-free, no LLM, no DB (same design contract as `lib/memory/recall-tags.ts` — trivially unit-testable, safe to import from the forked job child).

```ts
export interface DayReferenceResolution {
  /** Absolute UTC window covering the referenced local calendar period. */
  timeRange: { from: string; to: string }
  /** True when the reference points at the past (today/yesterday/…), false for future ("tomorrow"). */
  pastPointing: boolean
  /** Which phrase matched — for debug logging and the replay output. */
  matched: string
}

/**
 * Scan conversation text for an explicit day reference and resolve it against
 * `now` using the SERVER-LOCAL timezone. Returns null when no reference found.
 * Later (more recent) matches in the text win over earlier ones.
 */
export function resolveDayReference(text: string, now: Date): DayReferenceResolution | null
```

**Phrase lexicon (English, case-insensitive, word-boundary matched).** Required set:

| Phrase(s) | Window (server-local calendar) | pastPointing |
|---|---|---|
| `today`, `earlier today` | [local midnight of today, now] | true |
| `this morning`, `this afternoon`, `this evening` | [local midnight of today, now] | true |
| `tonight` | [local midnight of today, now] — treat as today; do not special-case | true |
| `last night` | [yesterday 18:00 local, today 06:00 local] | true |
| `yesterday` | [local midnight of yesterday, local midnight of today] | true |
| `day before yesterday` | that full local day | true |
| `N days ago` (N = 1–14, digits or words one…fourteen) | that full local day | true |
| `this week` | [local midnight of most recent Monday, now] | true |
| `last week` | previous Monday–Sunday local week | true |
| `tomorrow`, `next week` | — (no window) | **false** — return `pastPointing: false` with no timeRange applied by callers |

Notes:

- **Timezone is the crux — this is why the bug bit.** In the diagnosed chat the user said "today" at 21:44 CDT July 28, which is 02:44 UTC **July 29**. The mission's memories carry `occurredAt` ≈ `2026-07-28T17:00Z`. A UTC-day resolution of "today" → July 29 **misses everything**; the local-CDT day (05:00Z Jul 28 → 05:00Z Jul 29) contains both the mission and the conversation. Quilltap is self-hosted — the server's local timezone is the user's timezone — so plain `Date` local-time methods (`setHours(0,0,0,0)` etc.) are correct. Do **not** use `getUTC*` methods for calendar math here.
- "Day before yesterday" must be checked before "yesterday" (longest-match-first ordering in the scanner).
- Precedence when multiple phrases appear: the match **latest in the scanned text** wins (most recent utterance reflects current focus).
- A matched *future* reference (`tomorrow`, `next week`) suppresses any earlier past match in the same scan only if it appears later in the text; it never produces a window.
- Emit ISO strings via `toISOString()` (UTC) — consumers compare with `Date.parse`, so UTC ISO of local boundaries is exactly right.

### 1.2 Merge into `extractMemorySearchKeywords` (all three consumers inherit)

`extractMemorySearchKeywords` (`lib/memory/cheap-llm-tasks/memory-tasks.ts`, ~line 1221) is called by all three signal consumers — `lib/services/chat-message/pre-compute.service.ts` (proactive whisper), `lib/chat/context-manager.ts` (dynamic head + retrospective cadence block), and `lib/memory/recall-replay.ts` (diagnostic). Put the deterministic merge **inside this function**, after the LLM parser produces `MemorySearchExtraction`, so every consumer gets it with no per-caller wiring:

1. Build the scan text from the same `cappedMessages` used for the prompt (`recentMessages.slice(-20)`), **most recent messages only** — scan the last 4 messages' content, concatenated in order. (Older context routinely contains stale phrases like "yesterday" from previous topics; the prompt itself sees 20, but the deterministic scanner must stay tight to the live turn.)
2. Gate on timeline mode: run the resolver only when `clock?.timelineMode ?? 'realtime'` is `'realtime'`. Fictional timelines keep the existing LLM-only behavior (consistent with the prompt's own rule).
3. Resolve against `clock?.nowIso ?? new Date().toISOString()` (i.e. `new Date(nowMs)`), the same clock the TODAY line uses.
4. Merge policy, applied to the parsed result before returning:
   - Resolver found a **past-pointing** reference → set `timeRange` to the resolved window (deterministic **overrides** any LLM-provided range — the LLM's ranges are UTC-day-biased and this exact bias caused the bug) and set `retrospective = true`.
   - Resolver found only a future reference → leave `retrospective` as the LLM said; do not set `timeRange` from the resolver (and if the LLM emitted a `timeRange`, keep it — trust the LLM for anything the lexicon doesn't cover).
   - Resolver found nothing → parsed result passes through unchanged.
5. Log the merge at debug level (standing rule: touched backend paths fire debug logs): matched phrase, resolved window, whether it overrode an LLM range, chatId/characterId.

Accepted minor cost, documented here deliberately: a purely forward-looking sentence that contains "today" ("let's go to the pool today") will set `retrospective: true` for that turn. The consequences are a temporal-flip toward past/moment memories of *today* and a one-turn suspension of the anti-repetition penalty — both benign. Do not add intent heuristics (interrogatives, verb detection) to avoid this; they reintroduce exactly the brittleness this fix removes.

### 1.3 Ungate `occurredWithin` from the retrospective flag

Both live consumers currently gate the window on `retrospective`:

- `lib/services/chat-message/pre-compute.service.ts` line ~323: `occurredWithin: retrospective ? (signals.timeRange ?? null) : null`
- `lib/chat/context-manager.ts` line ~1260: `occurredWithin: fallbackRetro ? (turnRecallSignals?.timeRange ?? null) : null`

Change both to pass the window **whenever `signals.timeRange` is non-null**:

```ts
occurredWithin: signals.timeRange ?? null,
```

Rationale: a resolved time window is useful whether or not the turn is "retrospective" — and the injector path's two-stage semantics in `searchMemoriesSemantic` (`lib/memory/memory-service.ts` ~line 995: hard-filter only when ≥ `limit` hits survive, else fall back to the full pool with the bounded ×1.3 `window↑` boost) make it starvation-safe by construction. The retrospective flag continues to gate what it should: the temporal-multiplier flip, anti-repetition suspension, and the multi-probe/extra-probes block.

Keep the multi-probe (`extraProbes`) blocks gated on `retrospective` exactly as they are today.

### 1.4 Prompt updates (belt to the resolver's braces)

In `MEMORY_KEYWORD_EXTRACTION_PROMPT` (`memory-tasks.ts` ~line 701):

1. Extend the `retrospective` definition (line ~728) to make same-day references explicitly retrospective:

   > retrospective — true when the conversation is currently referencing past shared events or asking to recall them — **including events from earlier the same day** ("remember when we…", "last week you said…", "that place we visited", **"the mission today", "how did it go this morning?", "what happened at the pool?"**). Talking about how things are right now or planning the future is NOT retrospective.

2. Extend the `timeRange` instruction (line ~730) with same-day examples:

   > … "last week" on a Tuesday resolves to the previous calendar week; "in March" to that month; **"today" / "this morning" to the TODAY date itself; "yesterday" to the day before it.** Use null when no time period is referenced…

3. Add a second example response line after the existing one (line ~735) showing the retrospective shape, e.g.:

   ```
   {"keywords": ["mission report", "soil samples"], "temporal": "past", "context": "information", "paraphrase": "Charlie is asking how today's mission went.", "retrospective": true, "timeRange": {"from": "2026-07-28", "to": "2026-07-28"}, "entities": ["Constantinople"]}
   ```

4. **Fix the TODAY line's UTC bias** (`memory-tasks.ts` ~line 1244): it currently derives the date and weekday with `nowIso.slice(0, 10)` and `getUTCDay()`. Render both from the server-local clock instead (`new Date(nowMs)` with local `getFullYear/getMonth/getDate/getDay`), so the LLM's own resolutions align with the resolver's local-day math. Keep the ISO-format output contract unchanged.

Cheap-LLM prompt changes need no schema/tool updates; the parser already tolerates every field being absent.

---

## Fix 2 — fresh-event boost

### 2.1 New multiplier in `lib/memory/recall-tags.ts`

Add to `RECALL_MULTIPLIERS`:

```ts
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
```

New function, same shape as the neighbors:

```ts
export function freshEventMultiplier(
  memory: MemoryTagView,
  nowMs: number | null | undefined,
  currentChatId: string | null | undefined,
): RecallMultiplier
```

Behavior:

- No `nowMs`, no parsable event time → pass through `{ multiplier: 1, fired: [] }` (never penalize on missing data — house rule).
- **Echo guard:** if `memory.chatId` is set and equals `currentChatId` → pass through. Memories extracted from the *current* conversation are already in the transcript context; boosting them floods the ~5 whisper slots with echoes of the last few turns. (Verified in the diagnosis replay: current-chat memories already dominate candidates without any boost.)
- `age = nowMs − Date.parse(occurredAt ?? createdAt)`; negative age (future event time) → pass through.
- `age ≤ 24h` → `{ multiplier: RECALL_MULTIPLIERS.freshEvent24h, fired: ['fresh24↑'] }`
- `age ≤ 48h` → `{ multiplier: RECALL_MULTIPLIERS.freshEvent48h, fired: ['fresh48↑'] }`
- else pass through.

Supporting type changes in the same file:

- `MemoryTagView`: add `chatId?: string | null` (the objects passed in are full `Memory` rows, which carry it).
- `RecallContext`: add
  ```ts
  /** The current chat's id — the fresh-event boost skips memories extracted from this same chat (echo guard). */
  currentChatId?: string | null
  /** Reference clock for the fresh-event boost, ms since epoch. Absent → boost disabled. */
  nowMs?: number
  ```
- `combineRecallMultipliers`: compute `const fresh = freshEventMultiplier(memory, ctx.nowMs, ctx.currentChatId)`, include it in the product and in `fired`. The existing `MULTIPLIER_CLAMP` (max 4) already bounds stacking with `window↑` etc.

### 2.2 Wire the two new context fields at each `RecallContext` build site

- `lib/services/chat-message/pre-compute.service.ts` (~line 285): add `currentChatId: chatId, nowMs: Date.now()`.
- `lib/chat/context-manager.ts` (~line 1226): add the same, from the chat id in scope.
- `lib/memory/recall-replay.ts` (~line 179): add `currentChatId: chatId, nowMs: Date.parse(turnClockIso)` — the replay must use the **turn's** clock, not wall-clock now, so replaying an old turn reproduces what recall would have done at that time. (The replay output's `fired` column will then show `fresh24↑`/`fresh48↑`, which is also how the acceptance test reads.)
- The tool path (`search-scriptorium-handler.ts`) passes no `recallContext` and is intentionally untouched.

### 2.3 Why these magnitudes (worked example from the diagnosed chat)

Amy's yesterday-memory "accepted covenant inscription duty" (importance 0.85, tagged `moment`, about Amy who is present, same project):
`narrow✓ 1.15 × moment↓ 0.7 × present↑ 1.2 × fresh24↑ 1.6 ≈ ×1.55` — now at parity with the stale evergreen stack (×1.52) instead of losing to it at ×0.97, with the blend's cosine + small recency term breaking the tie in favor of whichever is actually topical. With Fix 1 also firing (`retrospective` flips `moment↓ 0.7 → moment·retro 1.0`, window adds ×1.3): `1.15 × 1.0 × 1.2 × 1.6 × 1.3 ≈ ×2.87` — decisive, still under the ×4 clamp.

These are starting constants in the tuning-expected tradition of `RECALL_MULTIPLIERS` — verify with `recall-replay` (see Acceptance) before tightening.

---

## Tests

Follow the repo's Jest conventions (global `jest`, subject-imports-first, bare `jest.mock` factories). All-new code here is pure TS — no native SQLCipher binding needed, no `@jest-environment node` docblock required except where noted for TZ control.

1. **`lib/memory/__tests__/day-references.test.ts`** — table-driven over the lexicon. Must include, at minimum:
   - The regression case: `TZ=America/Chicago`, now = `2026-07-29T02:44:00Z` (21:44 CDT Jul 28), text "the mission today" → window from `2026-07-28T05:00:00.000Z` to now; `pastPointing: true`. **Set `process.env.TZ` before any `Date` use — TZ must be fixed in the test environment (docblock `@jest-environment node` plus setting TZ in a `beforeAll` is not sufficient on all platforms; prefer setting TZ at the top of the file before imports, and assert the resolved offset).** If per-file TZ pinning proves flaky, compute expected values *from* the same local-time API rather than hard-coded ISO strings.
   - "yesterday", "day before yesterday", "3 days ago" / "three days ago", "last night" span, "last week" Monday–Sunday.
   - Latest-match-wins: "yesterday … but today" resolves to today.
   - "tomorrow" → `pastPointing: false`, no window applied.
   - No match → null. Word-boundary safety ("Yesterdayville" must not match).
2. **`lib/memory/cheap-llm-tasks/__tests__/`** — merge behavior of `extractMemorySearchKeywords` with the LLM call mocked (follow the existing cheap-llm-task test pattern in that folder):
   - LLM says `retrospective:false, timeRange:null`, text contains "today" → merged result is `retrospective:true` with the resolver's window (the diagnosed failure, now passing).
   - Resolver window **overrides** an LLM-provided range when past-pointing.
   - `timelineMode:'fictional'` → resolver skipped, LLM result untouched.
   - No day reference → LLM result passes through byte-identical.
3. **`lib/memory/__tests__/recall-tags.test.ts`** (extend the existing suite):
   - `freshEventMultiplier`: 24h boundary, 48h boundary, >48h, missing `nowMs`, missing event time, negative age, echo guard (`chatId === currentChatId` → 1.0).
   - `combineRecallMultipliers`: fresh boost composes with `moment↓` and clamps.
   - Existing tests must pass unchanged with the new optional context fields absent (backward compatibility of the pure functions).
4. **Ungating check:** a test (unit level, mocking `searchMemoriesSemantic`) that the pre-compute path forwards `occurredWithin` when `timeRange` is set and `retrospective` is false. If pre-compute is impractical to unit-test directly, assert the equivalent on `context-manager`'s call — one of the two call sites must be covered.

Run with the full `npm run test:unit` (per project note, `jest --findRelatedTests` is broken in this repo). Type-check with `npx tsc`.

## Acceptance criteria (live verification on Friday)

Using the repo CLI (`node packages/quilltap/bin/quilltap.js`) against the running server:

```
recall-replay 43ee47a0-1a47-4c4e-8c20-38da2925c29b --turn 2 --char 3b476cd1-670c-4812-9e3f-58dc48b0368c
```

1. Signals line shows retrospective **true** with a timeRange covering local July 28 (i.e. `from ≈ 2026-07-28T05:00Z`), instead of today's `not retrospective · timeRange —`.
2. The NEW path's top-5 (`sel ✓`) includes at least one memory sourced from the July-28 mission chats (`5bd44c27…`, `6f9716f5…`, `7281cfc7…`, `9c3d0444…`), which today it does not.
3. `fresh24↑`/`fresh48↑` appears in the `fired` column for memories whose `occurredAt` is within 48h of the turn clock, and never for memories whose `chatId` equals the replayed chat.
4. OLD and NEW paths now differ (the overhaul is no longer inert on this chat).

Note: the replay recomputes signals live and searches the *current* memory store, which now also contains memories about the amnesia incident itself — criterion 2 is "at least one mission-chat memory selected", not a full top-5 takeover.

## Process checklist (repo standing rules)

- `docs/CHANGELOG.md` entry — plain American English, no steampunk voice; find the existing section for the current version, don't duplicate headers.
- Check `help/*.md` for any page describing the Commonplace Book / memory recall timing behavior; update only if one documents the affected behavior (this is an internal ranking change — likely no help edits, but check).
- No DB schema changes → no `DDL.md`, no migration, no `.qtap` export-schema changes.
- No tool-definition changes → tool snapshot test untouched.
- Debug logging on every touched backend path (the merge log in §1.2; a debug line where the fresh boost context fields are populated is optional but welcome).
- Constants live in `RECALL_MULTIPLIERS` with doc comments in the file's existing style — they are the tuning surface; do not inline numbers at call sites.

## File touch list

| File | Change |
|---|---|
| `lib/memory/day-references.ts` | **new** — pure resolver |
| `lib/memory/cheap-llm-tasks/memory-tasks.ts` | prompt text (§1.4), local-time TODAY line, deterministic merge in `extractMemorySearchKeywords` (§1.2) |
| `lib/memory/recall-tags.ts` | `freshEvent24h/48h` constants, `freshEventMultiplier`, `MemoryTagView.chatId`, `RecallContext.currentChatId/nowMs`, `combineRecallMultipliers` wiring |
| `lib/services/chat-message/pre-compute.service.ts` | ungate `occurredWithin` (§1.3), add `currentChatId`/`nowMs` to context |
| `lib/chat/context-manager.ts` | same two changes at its build site |
| `lib/memory/recall-replay.ts` | `currentChatId` + turn-clock `nowMs` |
| `lib/memory/__tests__/day-references.test.ts` | **new** |
| `lib/memory/__tests__/recall-tags.test.ts` | extend |
| `lib/memory/cheap-llm-tasks/__tests__/…` | extend (merge tests) |
| `docs/CHANGELOG.md` | entry |
