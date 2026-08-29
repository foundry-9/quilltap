# Bug 107 — the cheap-LLM provider budgets are walls the healthy distribution is already stacked against

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-29) |
| **Found** | 2026-08-29 |
| **Fixed** | 2026-08-29 |
| **Severity** | **Medium** (nothing errors and no job fails: a timed-out pass silently produces no memories, no scene state, or an uncompressed context, and is not retried) |
| **Who it bites** | any instance whose cheap-LLM profile is a remote provider, worst on long chats and on router providers whose upstream queueing fattens the tail — 81 losses in the first 60 hours the counter existed |
| **Provenance** | Live (Friday), noticed while diagnosing [bug 106](bug-106-uncensored-fallback-modality.md) in chat `f77a332e-1abc-4180-8bc9-97d031d93005` — five `[ContextCompression] Failed to compress conversation history` lines in one 40-minute sitting |
| **Defect site** | `lib/memory/cheap-llm-tasks/core-execution.ts:41` (`CHEAP_LLM_TASK_TIMEOUT_MS = 45_000`) and `:78` (the 75s compression override), via `providerBudgetFor` at `:94` |
| **Fix site** | `lib/memory/cheap-llm-tasks/core-execution.ts` (budgets, the latency class, the same-route retry, `isTimeoutFailure` / `throwIfLostToTimeout`) × `lib/memory/cheap-llm-tasks/types.ts` (`timedOut`) × `lib/memory/memory-processor.ts` (`passesLostToTimeout`) × `lib/chat/context/compression.ts` + `lib/chat/context-manager.ts` + `lib/services/chat-message/compression-cache.service.ts` (which path is which) × six job handlers |
| **v5 status** | Not investigated — the numbers are v4's, but the shape transfers: a port that keeps a fixed per-task ceiling inherits the need to set it from the observed distribution rather than from a round number. |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-29).** All four items were taken. The sizing decision the
write-up deferred was made from the numbers already in it rather than from a
second measurement round, because the two figures that mattered were already
known: compression's p99 (61.1s), and the fact that the 45s tier's maximum
(39,936 ms against a 40,000 ms provider budget) is a *censored* maximum and so a
lower bound on its true tail, not an estimate of it.

**(1) Both ceilings now sit clear of the measured distribution.** The shared
tier goes 45s → **90s**, well past a tail known only to be at least 40s — the
point being to stop cutting the curve so the histogram can be re-read honestly,
which is what the write-up asked for and could not do while the wall was inside
the data. Compression's background budget goes 75s → **120s**, clearing its p99
by roughly double the gap between p99 and the old ceiling.

**(2) The asymmetry the 08-26 commit reasoned toward, made explicit — and
generalised.** A `CheapLLMLatencyClass` — `background` (the default) or
`interactive` — threads from the call site to `deadlineFor`. Compression
pre-computed after the turn has already been delivered gets the 120s; the
synchronous inline call on a cache miss keeps **75s**, because there the budget
is not protecting the work, it is protecting the person watching an empty
composer, and an uncompressed history still produces a turn.

The generalisation matters more than the compression case that prompted it.
Raising the shared tier to 90s would otherwise have been a straight regression
for the handful of cheap tasks awaited *inline* while a turn assembles — the
memory recap and the two `compressMemories` calls in `context-manager.ts` —
which would have gone from a 45s wait to a 90s one, doubled again by the new
retry, in the one place the operator is actually watching. So the shared tier
takes the same split: `CHEAP_LLM_TASK_TIMEOUT_INTERACTIVE_MS` keeps the old 45s,
and those three sites declare themselves. The rule the code now follows is that
**the ceiling follows who is waiting, not only which task it is** — and all of
these produce optional context, so losing one costs the character some
remembered flavour rather than the turn.

Worth noting the near-miss: `MEMORY_RECAP_PHASE_TIMEOUT_MS` (60s) is a
phase-level backstop documented as sitting *above* the per-leg cheap budget. A
90s leg would have silently inverted that relationship and made the phase timer
the binding constraint on a call it was written to backstop. The recap's
`interactive` declaration is what keeps the comment true, and the comment now
names which constant it is comparing against.

**(3) One more attempt at a fresh socket, for a timeout only.**
`runCheapLLMTask` now retries the *same* route once when the first attempt times
out, before the stand-in chain is even considered. Only for a timeout: a 401, a
refusal or an unparseable answer would fail identically the second time, and
re-spending the budget on them buys nothing. Not on the interactive path either
— doubling a wait the operator is already sitting through, to rescue an
optimisation they would never have noticed missing, is the wrong trade.

**(4) A lost pass stops looking like a finished one.** `CheapLLMTaskResult`
gains `timedOut`, set when every attempt the task had ended in a timeout — which
is the distinction the whole reporting problem turned on: "the model gave a
disappointing answer" and "this pass never happened" were arriving at callers as
the same value. `throwIfLostToTimeout(result, taskType)` turns the second into a
thrown `CheapLLMTaskLostError`, and six handlers now call it —
scene-state-tracking, title-update, context-summary, story-background, and both
memory extractors (via `passesLostToTimeout` on `TurnMemoryProcessingResult`,
since a per-character pass fails soft and a turn could lose half its extraction
and still return `success: true`).

Throwing was the right lever because the job system already does the rest:
`markFailed` schedules an exponential-backoff retry and marks the job DEAD with
the reason attached once `maxAttempts` runs out. That is a third attempt at the
pass, on top of (3), at no new machinery — and a DEAD job carrying
`Cheap LLM task "scene-state-tracking" timed out` is exactly the archaeology the
write-up said the next tuning round would otherwise need.

**Two consequences worth naming.**

*The extraction retry is all-or-nothing.* A handler that throws in the job child
has its buffered writes discarded rather than applied, so the retry re-runs the
whole turn from the state this attempt started in — atomic, and no duplicate
memories. The cost is that a turn which lost one character's pass and completed
the others now discards the others too. That is the correct trade when the
retry succeeds, and a real regression in the case where a provider times out on
the same pass three times running: today that ended with partial memories and a
COMPLETED job, and now it ends with none and a DEAD one. The second is worse
data and better information, and a provider timing out three times against a 90s
ceiling with a same-route retry in front of it is a configuration the operator
needs to see rather than absorb.

*Title-update no longer burns its checkpoint on a timeout.* Burning the cursor
is right for a quota error — it will still be exhausted at the next checkpoint —
and wrong for a pass that never ran, where it converts a deferred rename into a
skipped one. The throw happens before the cursor write.

**Regression guard.** `cheap-llm-deadlines.test.ts` now pins both ceilings
against the measured p99s as named constants, asserts the two compression paths
are budgeted differently, and covers `isTimeoutFailure` and
`throwIfLostToTimeout` — including the case the fix depends on being narrow: an
ordinary provider failure must *not* be treated as a lost pass. A new
`cheap-llm-timeout-retry.test.ts` pins the retry itself, both its recovery and
its refusal to fire for a non-timeout or on the interactive path.
`task-deadline.test.ts` was updated to advance two budgets, since a stalled
provider is now abandoned twice. The two handler suites gain a lost-pass case
each.

---

## Symptom

Repeated, non-fatal cheap-task losses. In one chat over 40 minutes:

```
16:14:07  NanoGPT API error in sendMessage        Error: Request timed out.
16:14:07  [CheapLLM] Task failed                  compress-conversation-history / NANOGPT
16:14:07  [ContextCompression] Failed to compress conversation history
```

…repeated at 16:32, 16:46, 16:48 and 16:54. The turns themselves succeeded; they
simply went out carrying an uncompressed history.

## Root cause

Not a stall, and not a provider fault. The ceilings are set inside the working
distribution, so the top of the healthy curve is being cut off and counted as
failure.

`deadlineFor` (`core-execution.ts:88`) gives every non-local cheap task 45s and
compression 75s; `providerBudgetFor` (`:94`) hands the provider 5s less, and
`buildSdkRequestOptions` (`packages/plugin-utils/src/providers/request-budget.ts:62`)
turns that into `{ timeout, maxRetries: 0 }`. So the real ceilings are **40s**
for most tasks and **70s** for compression, one attempt each.

The successful calls say plainly where those ceilings sit. Across 1,971
completed non-compression cheap calls since 2026-08-26:

| Type | n | 35–40s | **> 40s** | max |
|---|---|---|---|---|
| `MEMORY_EXTRACTION` | 1200 | 18 | **0** | 39,936 |
| `ANSWER_CONFIRMATION` | 357 | 3 | **0** | 39,789 |
| `SCENE_STATE_TRACKING` | 152 | 4 | **0** | 39,461 |
| `SUMMARIZATION` | 108 | 1 | **0** | 36,973 |

Not one call in 1,971 has ever taken more than 40,000 ms, and three separate
task types peak within 600 ms of the wall. That is not a distribution, it is a
censored distribution — the maxima are the budget, not the work. `CONTEXT_COMPRESSION`
shows the same against its higher ceiling: n=256, p50 24.3s, p95 49.6s, **p99
61.1s, max 67,733 ms** against 70,000.

The losses land where the tail was cut:

| Task | failures |
|---|---|
| `compress-conversation-history` | 20 |
| `memory-extraction-other` | 19 |
| `memory-extraction-self` | 14 |
| `scene-state-tracking` | 12 |
| `memory-keyword-extraction` | 4 |
| `resolve-character-appearances` / `consider-title-update` | 3 each |
| `fold-chat-summary` / `craft-story-background-prompt` | 2 each |
| `memory-recap-summarization` / `answer-confirmation` | 1 each |

**81 total, every one of them `Request timed out.`** — roughly 7% of compression
attempts and 7% of scene-state passes. Note that 61 of the 81 are *not*
compression: they run under the 45s tier that `8872d7efc` left alone.

The mechanism is working exactly as designed, which is worth stating: the
CheapLLM deadline never fired once in the whole log (`Abandoned a stalled
provider call`: 0 occurrences). The provider gives up first, at the socket, as
the headroom comment intends. Nothing here is a stall being papered over — the
numbers are simply short.

## Why it survived

**The counter is 60 hours old.** `8872d7efc` (2026-08-26) added the
`[CheapLLM] Task failed` line, and its own commit message says why it had to:

> a provider giving up on its own budget arrived here as an ordinary provider
> error, and the plugin's log line names the provider without naming the task —
> so a timed-out extraction pass was legible only in the per-message memory
> debug logs, and invisible to a server-log grep.

So the 81 are not a regression. They are the first two days of a rate that was
always there and could not be seen. **The same commit's diagnosis was right and
its remedy was applied to one task tier only:** it raised compression 40s→70s
on the reasoning that *"a ceiling that most of a task's healthy distribution can
reach is a ceiling set for the wrong task"* — and the newly-visible data says
70s is still inside compression's distribution, and that the untouched 40s tier
is where most of the loss is.

**Nothing downstream reports it.** Every background job in the window came back
`COMPLETED` — 83 `MEMORY_EXTRACTION`, 99 `SCENE_STATE_TRACKING`, zero `FAILED` —
because a cheap task that times out returns an unsuccessful result the job
treats as a finished pass. Compression pushes a string onto `warnings` and lets
the turn proceed uncompressed (`lib/chat/context/compression.ts:259`). There is
no retry: `maxRetries: 0` at the SDK, and `runCheapLLMTask` re-attempts only for
an unsupported-`temperature` error (`core-execution.ts:281`). One timeout is one
permanently lost pass.

This is bug 96's shape again — a job that reports COMPLETED over work that did
not happen — and the reason it is worth filing separately is that the loss is
silent in both directions: the operator sees no error, and the catalogue's
existing instrumentation sees a healthy success rate because the failures never
enter `llm_logs` at all.

## The fix

Not yet written, and the sizing needs a decision rather than a guess.

1. **Set both ceilings from the measured distribution, not from round numbers.**
   The p99s are 61s (compression) and — since the 40s tier is censored — unknown
   but at least 40s for the rest. A budget below its task's p99 will keep
   converting slow-but-healthy calls into losses. Compression's tail argues for
   something like 110–120s; the 45s tier needs its true tail measured first,
   which means raising it once and re-reading the histogram.
2. **Weigh it against the one place the operator waits.** The 08-26 commit
   deliberately stopped short of doubling because compression falls back to a
   synchronous inline call on a cache miss, and there the whole budget is
   user-visible latency. That constraint is real and argues for *asymmetry*:
   a generous budget on the pre-computed path, a tighter one inline. Today both
   share a number.
3. **Retry once on timeout,** at least for the passes that are cheap to redo and
   permanently lost otherwise (memory extraction, scene state). A second attempt
   at a fresh socket costs one call and recovers most of a fat-tail miss.
4. **Stop reporting COMPLETED over a lost pass.** Whatever the budgets end up
   being, a job whose cheap task timed out should say so — this is the half that
   makes the next tuning round measurable instead of archaeological.

(1) alone will move the wall without removing it. (4) is what makes (1)
checkable.

## How to verify

1. `ggrep -c '\[CheapLLM\] Task failed' <dataDir>/logs/embedded-server.log` for
   the baseline rate, and note the task-type breakdown.
2. Query `llm_logs` for the per-type maxima:
   ```sql
   SELECT type, COUNT(*), MAX(durationMs) FROM llm_logs
   WHERE createdAt > '<date>' GROUP BY type;
   ```
   A maximum pinned just under a budget is the wall. After a fix, the maxima
   should sit clear of the ceiling with the ceiling unreached.
3. Drive a long chat (80+ messages) through several turns and confirm
   `[ContextCompression] Conversation history compressed successfully` rather
   than the failure line.
4. Regression guard: `cheap-llm-deadlines.test.ts` already pins the per-task
   budgets, so a change has to be made deliberately in both places. Add a case
   asserting a timed-out task does not leave its job `COMPLETED`.

Instance note: Friday's cheap-LLM profile is NanoGPT, a router — an extra hop
plus upstream queueing gives it a fatter tail than a first-party API would have.
The budgets should still clear a router's p99, since routing to one is a
supported configuration, but a first-party provider will show a smaller effect.
