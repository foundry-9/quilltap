# Bug 47 — the Brahma Console gives up silently when the turn budget is exhausted

| | |
|---|---|
| **Status** | **OPEN** |
| **Found** | 2026-08-08 |
| **Severity** | Low (rare at the default budget of 50, but it burns real API spend and returns nothing) |
| **Who it bites** | any Brahma Console run that exhausts its turn budget |
| **Provenance** | Faithful — v5 dogfood walk (finding #73) |
| **Defect site** | `lib/services/brahma-console/orchestrator.service.ts:539` (+ `one-shot.service.ts`) — the `if (fullResponse)` finalizer has no `else`, so an empty forced-turn response saves nothing and enqueues no completion |
| **v5 status** | Faithful in v5 (`brahma_console/orchestrator.rs:651`/`:661`); recorded as `dogfood-findings.md` #73, absorb when v4 fixes it |
| **Index** | [bugs.md](../bugs.md) |

---

**OPEN.** Surfaced 2026-08-08 on a v5 dogfood walk of the new Brahma Console
turn-budget setting (`6452e2c3`), with the budget set to its floor (5). v4 shares
the code and the behaviour. **Severity: Low (rare at the default budget of 50, but
it burns real API spend and returns nothing).**

### Symptom

The Console runs a full investigation — several agent turns, a run of SQL/tool
calls, real model cost — and then produces **no answer at all**: no assistant
message, no "I ran out of turns" note, not even a stream completion. The tool
cards are visible in the transcript, but the reply that was supposed to summarise
them never arrives, and there is no on-screen indication of what happened. It
looks exactly like a hang.

### Root cause

The agent loop (`lib/services/brahma-console/orchestrator.service.ts:328`) runs
until `agentTurnCount` reaches `maxAgentTurns`. On the final turn it pushes a
`buildForceFinalMessage()` (`:331`) telling the model to stop and call
`submit_final_response`, and — because `agentTurnCount < maxAgentTurns` is now
false — it will **not** execute any tools that turn. If the model ignores the
instruction and emits another tool call instead of answering (common under time
pressure, and the whole point of a *forced* final turn is that the model was
already misbehaving), the turn's assistant text is empty (native tool calls carry
no prose), so the loop falls through to:

```ts
// No tool calls or final response — done
fullResponse = currentResponse   // '' — the forced turn only called a tool
break
```

(`:530-532`). The finalizer then guards **the entire tail** behind the truthiness
of that string:

```ts
if (fullResponse) {
  // save the assistant message …
  safeEnqueue(controller, encodeDoneEvent(…))
}
```

(`:539`). With `fullResponse === ''`, no message is persisted **and no `done`
event is enqueued** — the stream simply ends. There is no `else` arm. The
identical structure exists in the one-shot path
(`lib/services/brahma-console/one-shot.service.ts`, same `buildForceFinalMessage`
+ empty-`fullResponse` fall-through).

### Why it survived

The default budget was 25 and is now 50 (`6452e2c3`) — generous enough that the
model almost always submits a final answer well before the cap, so the
empty-response path is rarely reached. It only surfaces when the budget is set
low (the new setting's floor is 5) or a genuine investigation legitimately can't
converge in the allotted turns. At that point the run cost real money and the
operator is left with silence.

### The fix

When the loop exits with an empty `fullResponse`, do not return nothing. Two
non-exclusive options, a product call for v4:

1. **Always finalise with something.** In the `if (fullResponse)` tail, add an
   `else` that emits a short explanatory message — e.g. *"I reached the
   {maxAgentTurns}-turn budget before I could finish. Here is what I gathered so
   far:"* followed by `lastToolResultText` (or a brief digest of the tool
   results already in the transcript) — and **always** enqueue the `done` event
   so the client gets a clean completion signal rather than a hang.
2. **Salvage the forced turn.** If the forced-final turn returns a tool call
   instead of `submit_final_response`, synthesise the final answer from the
   accumulated tool data rather than discarding the turn.

Whichever v4 picks, the invariant to restore is: a Console run that did work
never ends with no output and no completion event.

### Verification

Set Settings → Chat → Brahma Console to its minimum (5) and ask a question that
needs several tool calls against a large instance. Confirm the Console returns a
partial-or-explanatory answer and a clean stream completion, not silence.

### v5 coordination

v5 reproduces this faithfully:
`crates/quilltap-core/src/services/brahma_console/orchestrator.rs` — the
"No tool calls or a final response — done" break (`:651`) and the
`if !full_response.is_empty()` finalizer (`:661`) mirror v4 line for line.
Recorded on the v5 side as `dogfood-findings.md` finding **#73** (NOT fixed —
changing it moves the oracle). When v4 fixes this, v5 absorbs it in a drift
catch-up and retires the #73 note.
