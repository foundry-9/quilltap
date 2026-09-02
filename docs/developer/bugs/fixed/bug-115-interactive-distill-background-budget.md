# Bug 115 — the one cheap call a turn waits on kept the budget written for the calls nobody waits on

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-02) |
| **Found** | 2026-09-02 |
| **Fixed** | 2026-09-02 |
| **Severity** | Medium (nothing errors and nothing is lost — the composer simply sits empty for up to three minutes per responding character, and the only visible evidence is that the turn eventually arrives) |
| **Who it bites** | Anyone whose cheap-LLM route is having a bad afternoon, in any chat where the proactive pre-compute pass did not run — the first turn, continue mode, or an empty proactive result. Multiplied by the number of characters the turn chains through, and a character that then **passes** its turn pays the whole cost for a message the user never sees |
| **Provenance** | Reported 2026-09-02 as "everything is taking a very long time in this conversation now" — Friday chat `88f8bf2d`, a four-character room. Median first reply had walked from ~6s that morning to ~44s over the last ten turns, and the turn at 20:17:38 took **7m16s**. The instance's cheap-LLM selection had moved between 18:00 and 19:00 from `DEEPSEEK / deepseek-v4-flash` to `NANOGPT / deepseek/deepseek-v4-flash-latest` — the same model behind a different gateway, 2–4× slower on its successes (`SCENE_STATE_TRACKING` 4.9s → 19.1s avg) and prone to accepting a request and never answering: 15 `Request timed out` today, 11 of them in the last 25 minutes, against zero on DeepSeek-direct all day |
| **Defect site** | `lib/chat/context-manager.ts:1390` — the dynamic-head fallback `await`s `extractMemorySearchKeywords` while the turn is blocked, and named no latency tier. `extractMemorySearchKeywords` had no tier parameter to name |
| **Fix site** | `extractMemorySearchKeywords` (`lib/memory/cheap-llm-tasks/memory-tasks.ts`) takes a `latency: CheapLLMLatencyClass = 'background'` and threads it to `executeCheapLLMTask`; the `context-manager` call site passes `'interactive'`. The proactive consumer in `pre-compute.service.ts` keeps the default, which is what it should have |
| **v5 status** | Not investigated. **The shape applies** to any port where one helper serves both a blocked caller and a deferred one: the deadline belongs to *who is waiting*, so it has to be a parameter, and a parameter with a safe-looking default is one a new call site will forget |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-09-02).** The distillation the turn blocks on now asks for
the interactive tier — 45s and no retry, instead of 90s and a retry — so a
stalled cheap route costs a turn 45 seconds rather than three minutes.

## Symptom

Turns in a busy multi-character room got slower over an afternoon, with no error
anywhere and every background job reporting a clean finish. Time from the user's
message to the first visible character reply, Friday chat `88f8bf2d`:

| Window | Median first reply |
|---|---|
| Through 18:09 | ~6s |
| 19:27–20:10 | ~31s |
| Last ten turns | ~44s |
| The turn at 20:17:38 | **435s** |

The last one, straight from `embedded-server.log`:

```
20:17:38  user posts; responder selected; universal tools built
20:19:03  [CheapLLM] Attempt timed out; retrying the same route once
20:20:28  [CheapLLM] Task failed  →  [ContextManager] Multi-character context built
20:20:42  [TurnSkip] Character passed the turn
20:20:42  Chain decision: continue → next character selected
20:22:07  [CheapLLM] Attempt timed out; retrying the same route once
20:23:32  [CheapLLM] Task failed  →  [ContextManager] Multi-character context built
20:24:54  first visible reply
```

Two things are legible there and both matter. Nearly three minutes separate the
responder being selected from its context being built, twice — and the first of
those three-minute waits bought a **turn pass**, a message the user never sees.

## Root cause

`extractMemorySearchKeywords` serves two consumers with opposite answers to the
only question that sets a deadline — *is anyone waiting?*

- `lib/services/chat-message/pre-compute.service.ts` runs it **after** delivery,
  to have a proactive whisper ready for next turn. Nobody is waiting. A generous
  budget and a retry are exactly right: the pass is free to be slow, and a lost
  pass is a real loss.
- `lib/chat/context-manager.ts:1390` runs it **inside** `buildContext`, in the
  fallback branch taken when no proactive result exists. The composer is empty
  and the operator is watching it. Here the budget is not protecting the work,
  it is protecting the person.

Only the first was ever expressed. The call site named no tier, so it took
`CHEAP_LLM_TASK_TIMEOUT_MS` — 90s — **and** the timeout retry that
`runCheapLLMTask` grants a background pass and deliberately withholds from an
interactive one. One stalled provider is therefore 180 seconds of nothing, per
responding character, in a room that chains through four of them.

The distillation is an *optimisation*: it replaces `memorySearchQuery` — the
recent-window prose, already in hand — with a better embedding query, and the
branch degrades gracefully to that raw query on failure. So the turn was waiting
three minutes on a call it is written to survive losing.

## Why it survived

Bug 107 is the reason this exists at all, and the reason it is only a third of a
bug. That fix introduced `CheapLLMLatencyClass` precisely to make this
distinction sayable, wrote it up as *"the ceiling follows who is waiting rather
than only which task it is"*, and applied it to the two inline calls it had in
front of it — the compression cache miss at `context-manager.ts:1142` and the
memory recap at `memory-tasks.ts:1506`. Both carry a comment explaining that the
operator is waiting on this one.

The third inline call was one branch away in the same file and was not visited,
because **the new tier was applied where the old audit had already looked**.
Bug 107's evidence was a histogram of completed calls by task type; the recap
and compression appear in it as themselves, while the distillation appears as
`MEMORY_EXTRACTION` — the same bucket as the per-turn extraction passes, which
genuinely are background. A task-type histogram cannot see the difference
between two callers of one function, which is the difference this fix exists to
express.

It then stayed invisible because the failure has no failure. `distill.success`
is false, the branch falls back to `memorySearchQuery`, recall quality drops a
little, and the turn arrives. Nothing throws, nothing is marked FAILED, and the
one artifact — a gap between two log lines — is only a gap. On a healthy cheap
route the whole thing is unobservable: DeepSeek-direct answered this call in
3.8–4.3s all morning and the ceiling never came near. It took a gateway that
accepts a request and never answers to turn a mis-set budget into six minutes.

## The fix

`extractMemorySearchKeywords` gains a trailing
`latency: CheapLLMLatencyClass = 'background'` and passes `{ latency }` to
`executeCheapLLMTask`. The default preserves today's behaviour for the proactive
pass and the `recall-replay` diagnostic; only `context-manager` opts in to
`'interactive'`, which buys 45s and, more to the point, **no retry** — the
sibling comment at `memory-tasks.ts:1506` already says why: the pass is optional
context, so losing it costs remembered flavour, not the turn.

Deliberately not done: raising the interactive ceiling, or making the
distillation non-blocking. The first re-fights bug 107 with one instance's bad
afternoon as evidence. The second is a real option — the branch has a working
fallback and could fire-and-forget — but it changes what recall does on the
first turn of every chat, which is not a change to make while diagnosing a
latency complaint.

## Verification

`lib/chat/__tests__/dynamic-head-distill-latency.test.ts` builds a turn through
`buildContext` with no pre-searched memories and asserts the tier argument
leaves the call site. It fails on the pre-fix source with
`Expected: "interactive" / Received: undefined` — which is the bug stated
exactly: not a wrong tier, an unnamed one.

Four cases in `lib/memory/cheap-llm-tasks/__tests__/task-deadline.test.ts` cover
the arithmetic underneath, which bug 107 shipped untested: an interactive
distillation abandons at the interactive budget, makes **one** provider call
rather than two, hands the provider a budget inside that ceiling, and — the
other direction, so the proactive pass is not quietly starved — still gets both
budgets and both attempts when no tier is named.

Live confirmation is the log shape: on a stalled cheap route, the gap between
`Selected responding character` and `Multi-character context built` should be
one budget, not two, and `[CheapLLM] Attempt timed out; retrying the same route
once` should no longer appear for `memory-keyword-extraction` between them.

## Not this bug

Three things were found alongside and are not fixed here.

- **The gateway.** NanoGPT hanging is the trigger, not the defect; the fix
  bounds the damage rather than removing it. Pointing the cheap-LLM selection at
  the DeepSeek-direct profile removes it.
- **Turn passes.** 12 today against 75 chain-continues. A pass costs a full
  context build and an LLM call and produces nothing the user sees, which
  multiplies whatever the per-character cost happens to be.
- **Whisper bulk.** `consolidated` whispers average 15.4k characters,
  `core-whisper` 14.2k, `summary` and `scenario` ~9.2k, against prompts already
  running 50–69k tokens. That is a cost per turn, not a stall, and belongs to
  the Commonplace Book rather than here.
