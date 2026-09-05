# Bug 70 — the context budget ignores the profile's Max Context, so an unrecognised model is budgeted as 8192 tokens

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-15 (a Friday chat against a local 27B raised "Context exceeds model safe input limit" on every turn; the instance's own logs showed the same turn resolving two different context windows seconds apart) |
| **Fixed** | 2026-08-15 |
| **Severity** | **High** (silent, permanent truncation of conversation history on every turn against any model the lookup tables don't recognise — Ollama and OpenAI-compatible profiles, i.e. exactly the self-hosted case Quilltap is for) |
| **Who it bites** | anyone whose connection profile names a model that isn't in `MODEL_CONTEXT_OVERRIDES`, the plugin's `getModelInfo()`, or `FALLBACK_PRICING` — any `hf.co/...` Ollama tag, any custom OpenAI-compatible endpoint — regardless of the Max Context they set on the profile |
| **Provenance** | user report (v4 live use) |
| **Fix site** | new `resolveContextWindow` chokepoint in `lib/llm/model-context-data.ts`, threaded through `getRecommendedContextAllocation` / `getSafeInputLimit` / `calculateMaxAvailable` and into `calculateContextBudget` (`lib/chat/context-manager.ts`), which now takes the profile; plus `computeSafeInputLimit` as the one ceiling both the builder and the pre-send check use, and new `lib/services/chat-message/turn-extras.ts` reserving the tool schemas and post-build injections |
| **v5 status** | Not yet assessed — any v5 budget that resolves the window from the model name inherits it; port the single-resolver shape from this file |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-15).** The context window is now resolved in exactly one
place — `resolveContextWindow(provider, modelName, profile)` — which prefers the
profile's user-set `maxContext` and falls back to the model-name lookup only
when there is no profile or its value is absent/degenerate. Every budget-side
consumer routes through it: `getRecommendedContextAllocation` and
`getSafeInputLimit` take an optional profile, `calculateMaxAvailable`'s own copy
of the rule is gone, and `calculateContextBudget` takes the profile and is
handed `options.connectionProfile` at the one `buildContext` call site.

## Symptom

Every turn against a local 27B logged the same warning, and the conversation
behaved as though the character had a very short memory:

```
"message":"Context exceeds model safe input limit, payload may be rejected",
"model":"hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL",
"estimatedInputTokens":7317,"safeInputLimit":5324,
"modelContextLimit":8192,"responseReserve":2048,
"compressionApplied":false,"overage":1993
```

The profile declares `maxContext` **65536**. Nothing in the chat was near any
real limit.

## Root cause

Two resolutions of "how big is this model's window", in the same function, on
the same turn:

- `lib/chat/context-manager.ts:582` — `calculateContextBudget(provider, modelName)`
  → `getRecommendedContextAllocation` → **`getModelContextLimit(provider, modelName)`**.
  A name-keyed lookup: overrides table, then the plugin's `getModelInfo()`, then
  `FALLBACK_PRICING`, then `DEFAULT_CONTEXT_BY_PROVIDER`. An `hf.co/...` tag
  matches none of them, so it lands on the OLLAMA default of **8192**
  (`model-context-data.ts:28`). The profile is in `options` and was never passed.
- `lib/chat/context-manager.ts:850` — `calculateMaxAvailable(provider, modelName, connectionProfile)`,
  which reads `profile.maxContext` first and so saw the true **65536**.

The instance's log has both, seconds apart:

```
"[ContextManager] Budget analysis" ... "maxContext":65536,"maxAvailable":39322,"compressionNeeded":false
"Context exceeds model safe input limit" ... "modelContextLimit":8192,"safeInputLimit":5324
```

The smaller number won everywhere it does damage. With `totalLimit` 8192:
`responseReserve` 2048, `systemPromptBudget` `max(4000, 1638)` = 4000 (the
prompt measured 3716 — it cleared the bar by 284 tokens, and a slightly richer
character would have been truncated outright), and

```
remainingBudget = 8192 − usedTokens − 2048
```

left roughly **1–1.5k tokens for conversation history against 4897 tokens of
it**. `selectRecentMessages` dropped the remainder every turn.

Meanwhile compression, working from the correct 39322, rightly concluded there
was nothing to compress — hence `compressionApplied: false` next to an apparent
overage, which reads like a compression failure and is not one.

## Why it survived

- **The failure is silent by construction.** Trimming history is normal
  behaviour, not an error. The only signal is
  `'Conversation is getting long. Consider generating a summary…'`, which is
  emitted *only* inside `if (truncated)` (`context-manager.ts:1812`) — it was the
  receipt for dropped history, and it reads like ordinary advice about a long chat.
- **The two resolutions never met.** `budget` and `budgetInfo` are computed 270
  lines apart for different purposes; nothing compared them, and the
  Budget-analysis log line prints only `budgetInfo`'s numbers.
- **The warning validated the wrong number.** The orchestrator's pre-send check
  derives `safeInputLimit` from `builtContext.budget.totalLimit` — the corrupt
  one — so the alarm confirmed the bad figure instead of catching it.
- **It cannot happen on the providers that get exercised most.** Anthropic,
  OpenAI and Google model names all hit the tables, and their defaults are
  large; the fallback is only reachable where the model name is unknowable in
  advance, which is precisely the local/self-hosted case.
- **Two other call sites already had it right** — `app/api/v1/chats/route.ts:669`
  and `lib/tools/handlers/self-inventory/builders.ts:636` both wrote
  `profile.maxContext ?? getModelContextLimit(...)` — so the correct rule existed
  in the codebase three times over, spelled differently each time, with the
  budget being the one place it was missing.

## The fix

- `resolveContextWindow(provider, modelName, profile?)` in
  `lib/llm/model-context-data.ts` is now the single source of truth, with
  `ContextWindowSource` as its structural profile shape. It guards
  `maxContext > 0`, so a zero or negative column falls through to the lookup
  rather than producing a zero-token budget.
- `getRecommendedContextAllocation` and `getSafeInputLimit` take an optional
  profile and use it. `calculateMaxAvailable`'s inline copy of the rule is
  replaced by a call to it.
- `calculateContextBudget(provider, modelName, profile?)` takes the profile;
  `buildContext` passes `options.connectionProfile` (the sole call site,
  `lib/services/chat-message/context-builder.service.ts:685`, already supplies it).
- `willExceedContextLimit` and the self-inventory profile fallback route through
  the resolver too, so no caller holding a profile reaches
  `getModelContextLimit` directly. `lib/services/external-prompt-generator.service.ts:132`
  now passes its profile to `getSafeInputLimit` — the same blind spot, on the
  character-prompt-generation path.

For the reported profile the budget becomes `totalLimit` 65536,
`responseReserve` 4096, `recentMessagesBudget` 32768 — history is no longer
trimmed, and `safeInputLimit` rises to 54886, so the warning stops firing on a
7k payload.

## How to verify

- `npx jest __tests__/unit/context-management.test.ts` — `calculateContextBudget`
  budgets a `hf.co/...` Ollama tag at 65536 when the profile says so and at 8192
  when it doesn't; `resolveContextWindow` covers the absent/null/zero fallbacks;
  `computeSafeInputLimit` pins the shared ceiling (8192/2048 → 5324) and its
  1000-token floor, and the budget's `safeInputLimit` is asserted to sit strictly
  below the old builder-side ceiling.
- `npx jest __tests__/unit/lib/services/chat-message/turn-extras.test.ts` — the
  reservation covers the tool schemas alone, grows for each injection, is zero
  when there is nothing to add, and `countToolSchemaTokens` survives an
  unserializable definition.
- Live: a turn on a profile whose model name is not in the tables logs
  `"[ContextManager] Budget analysis"` and the pre-send validation with the
  **same** window, and neither "Context exceeds model safe input limit" nor the
  truncation-only "Conversation is getting long" appears on a payload well
  inside the real window.

## Two adjacent gaps, fixed alongside

Both were found while tracing the above, and both are of a piece with it: three
places disagreeing about how much room there is.

### The builder aimed past the line the validator drew

The builder filled to `totalLimit − responseReserve`; the pre-send check warned
above `totalLimit − responseReserve − 10%`. The 10% is a real allowance —
estimates here are character-based, not tokenized — but only one side knew about
it, so a context packed exactly as instructed could be reported as an overage it
had been told to produce. Anyone reading the warning had no way to tell that
kind of alarm from a genuine one.

`computeSafeInputLimit(totalLimit, responseReserve)` now owns the formula.
`ContextBudget` carries `safeInputLimit` (and `safetyMargin`, broken out for
logging), `remainingBudget` derives from it, and the orchestrator's check reads
`builtContext.budget.safeInputLimit` rather than recomputing its own. One
number, both sides. `getSafeInputLimit` delegates to it too, so the
character-prompt path can't drift either.

### The payload included things the budget never counted

`estimatedInputTokens` counted `formattedMessages` only. Three things escaped:

- **Tool schemas** — never in the message array at all, but serialized into the
  same payload by every provider. A full roster with fleshed-out parameter
  descriptions is thousands of tokens, and on a small window it can outweigh the
  conversation.
- **Agent-mode instructions** and **the tool-change notice** — spliced in by the
  orchestrator *after* the builder has spent its budget.

All three are knowable before the build (`actualTools` is resolved at
`orchestrator.service.ts:993`, `agentMode` at `:422`, `toolSettingsChanged` at
`:834` — all upstream of the context build at `:1086`), so the fix is to declare
them rather than discover them too late.

New `lib/services/chat-message/turn-extras.ts` builds and measures them in one
call, `collectTurnExtras`, before the context is built:

- `reservedTokens` is passed to the builder as `reservedOutgoingTokens` and
  subtracted from the message budget, so history is not packed into space these
  will occupy.
- `toolSchemaTokens` is added to `estimatedInputTokens`, so the pre-send check
  measures the whole payload.
- The **same strings** it built are handed back and spliced in — the notice is
  not reconstructed at the splice site. A reservation computed from
  separately-built text drifts the first time either copy is edited; this is the
  same single-construction discipline the codebase applies elsewhere, and the
  reason `buildToolChangeNotice` and `extractToolNames` moved out of the
  orchestrator.

`countToolSchemaTokens` (`lib/tokens/token-counter.ts`) measures the serialized
form rather than reaching into either provider's tool layout, and returns 0
rather than throwing on a definition that won't serialize — an estimate should
never be what takes down a turn.

One further consequence worth naming: with the reservation subtracted, a
sufficiently large character on a small window can now leave the message budget
at zero. That state is no longer silent — it warns by name ("No room left for
conversation history"), because the symptom otherwise is a character who appears
to have no memory of the exchange, and the trimming that produces it looks
exactly like routine housekeeping.
