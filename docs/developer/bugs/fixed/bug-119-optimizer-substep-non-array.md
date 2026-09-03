# Bug 119 — a sub-step answering with an object instead of an array aborts the entire refinement run

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-02) |
| **Found** | 2026-09-02 |
| **Fixed** | 2026-09-02 |
| **Severity** | **Medium** (no data loss and nothing is written wrongly — but a run that has already spent three or four minutes of paid model time and produced good suggestions dies on its next sub-step, surfacing `q.filter is not a function` in the modal and discarding every sub-step that had not yet run) |
| **Who it bites** | anyone running Aurora's **Refine from Memories** against a character with several system prompts, scenarios, or wardrobe items — the more sub-steps a character has, the more chances one of them answers in the wrong shape |
| **Provenance** | Live (Friday, 2026-09-02T02:48:04Z), character `d9d0d998…`, Anthropic `claude-sonnet-5`, reported with the modal's error banner still on screen |
| **Fix site** | `lib/services/character-optimizer.service.ts` (`coerceSuggestionArray`, the sub-step parse block, and the `runSubStep` wrapper) |
| **v5 status** | **Applies.** Any port that asks a model for a JSON *array* must normalise the parse result before touching it as one — `JSON.parse` succeeding says nothing about the shape — and a fan-out of independent passes must contain a failure to the pass that caused it. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-02).** Two changes, one for the cause and one for the
blast radius.

`coerceSuggestionArray` normalises whatever a sub-step parsed into an array:
an array passes through, a wrapper object yields the first array found under
`suggestions` / `items` / `results` / `data` / `amendments`, a lone object
carrying a `field` key becomes a one-element array, and anything else becomes
`[]` with a warning naming the sub-step. The parse block now asks
`parseLLMJson<unknown>` — the old `parseLLMJson<OptimizerSuggestion[]>` was a
cast, not a check, and it is the cast that made the crash look impossible.

`runSubStep` is now a wrapper around `runSubStepCore` that logs and continues
on any throw, emitting an empty `substep_complete` so the client's counter
still advances. Each sub-step is a self-contained pass whose only output is
appended to `allSuggestions`, so there was never a reason for one to be able
to take the run with it — the two failure modes already handled inside the
body (`LLM call failed; continuing`, `unparseable JSON; skipping`) say plainly
that continuing was the intent.

Verified by six cases in
`__tests__/unit/lib/services/character-optimizer-helpers.test.ts`, including
the wrapper shape observed in the wild and an explicit assertion that no input
produces a value `.filter()` would throw on.

### Symptom

The user ran **Refine from Memories** on Friday. The run reached the review
step with one accepted amendment (a revision to the "Friday as Executive
Assistant" system prompt), and the Confirm-for-commission screen carried an
error banner reading, in full:

```
q.filter is not a function
```

Server-side, `logs/embedded-server.log`:

```json
{"level":"error","message":"[CharacterOptimizer] Optimization failed",
 "context":{"characterId":"d9d0d998-281e-4598-8345-d81d47be5e97",
            "error":"q.filter is not a function"}}
```

`q` is the minified name of `parsed` — the instance is an Electron shell
running the standalone build, so the identifier that reached the user is the
one esbuild chose.

### Root cause

`lib/services/character-optimizer.service.ts`, inside `runSubStep`:

```ts
let parsed: OptimizerSuggestion[] = [];
try {
  parsed = parseLLMJson<OptimizerSuggestion[]>(raw);   // a cast, not a check
} catch (parseError) {
  …
  parsed = [];
}

const filtered = parsed
  .filter((s) => s && typeof s.significance === 'number' && …)   // ← TypeError
```

Every sub-step prompt ends *"Respond with a JSON array of suggestion objects
(may be empty)"*, and the system message forbids fences and prose. A model
that instead answers `{"suggestions": [...]}` — or, holding exactly one
amendment, a single bare suggestion object — produces text that
**`JSON.parse` accepts**. The `catch` therefore never fires; the type parameter
on `parseLLMJson<T>` is an unchecked assertion (`return JSON.parse(cleaned) as T`,
`lib/llm/llm-json.ts:146`), so TypeScript is satisfied and the object walks
straight into `.filter`.

The throw escapes `runSubStep`, escapes the awaited chain of sub-steps, and is
caught only by the outer handler that reports the whole optimization as failed.

The run that produced the report shows the cost. From the log and `llm_logs`:

| time (UTC) | sub-step | outcome |
|---|---|---|
| 02:44:32 | analysis | ok |
| 02:45:40 | General fields | LLM call failed — *continued*, as designed |
| 02:46:19 | System prompt: Friday as Executive Assistant | ok, 1 suggestion |
| 02:47:11 | System prompt: Friday as Intimate Partner (Literary) | ok |
| 02:48:04 | *next sub-step* | **TypeError — whole run aborted** |

Physical description, wardrobe, aliases and proposed new system prompts never
ran. The crashing sub-step's response was not recorded either: `logLLMCall` sits
*after* the `.filter` chain, so the one artefact that would have named the shape
was lost to the same throw.

### Why it survived

- **The cast reads as a parse.** `parseLLMJson<OptimizerSuggestion[]>(raw)`
  looks like it validates, and it is wrapped in a `try`/`catch` that handles
  "the model produced junk". Both signals point at a path that is already
  defended. The defended failure is *unparseable* JSON; the undefended one is
  *parseable JSON of the wrong shape*, and nothing in the call distinguishes them.
- **The neighbours are guarded, so the pattern looks safe.** Every other
  array-shaped `parseLLMJson` call site in the codebase lands in a function that
  re-checks: `sanitizeGeneratedWardrobeItems` opens with
  `Array.isArray(items) ? items : []` (`lib/wardrobe/generated-items.ts:79`), and
  the properties parsers gate on `Array.isArray(parsed?.aliases)`. The optimizer
  is the one site that filters inline.
- **It is provider- and prompt-dependent.** Well-behaved models return the bare
  array, so the run succeeds for months at a time; it takes one sub-step, on one
  character, on one model, to lose the whole pass.
- **The message was minified.** `q.filter is not a function` names nothing a
  user or a grep can act on, and the standalone build is where most real runs
  happen.
- **The surviving suggestion made the failure look partial.** The modal still
  offered its one amendment for commission with the error underneath, which
  reads as "one thing went wrong" rather than "four sub-steps never ran".

### The fix

`lib/services/character-optimizer.service.ts`:

```ts
export function coerceSuggestionArray(value: unknown): OptimizerSuggestion[] {
  if (Array.isArray(value)) return value as OptimizerSuggestion[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['suggestions', 'items', 'results', 'data', 'amendments']) {
    if (Array.isArray(record[key])) return record[key] as OptimizerSuggestion[];
  }
  if (typeof record.field === 'string') return [record as unknown as OptimizerSuggestion];
  return [];
}
```

The parse block calls `parseLLMJson<unknown>` and passes the result through it,
warning (with the sub-step label and how many suggestions were recovered)
whenever the answer was not already an array — so the shape that caused this is
visible in the logs the next time it happens, instead of being lost with the throw.

`runSubStep` becomes a thin wrapper:

```ts
const runSubStep = async (kind, label, instruction) => {
  try {
    await runSubStepCore(kind, label, instruction);
  } catch (subStepError) {
    logger.error('[CharacterOptimizer] Sub-step failed unexpectedly; continuing', …);
    onProgress({ type: 'substep_complete', step: 'generating', partialSuggestions: [] });
  }
};
```

Not done: validating suggestions against a Zod schema at the sub-step boundary.
The field-by-field coercion already in the `.map` (`coerceSuggestionText`, the
wardrobe sanitizer, the significance filter) covers the shapes seen so far, and
a schema here would silently drop partially-good suggestions rather than repair
them. Also not done: moving `logLLMCall` ahead of the filter chain so a
crashing sub-step still records its response — the wrapper now keeps the run
alive, which is the outcome that mattered, and the new warning names the shape.

### How to verify

`npx jest __tests__/unit/lib/services/character-optimizer-helpers.test.ts`

The `coerceSuggestionArray` block covers the wrapper object, the four other
wrapper keys, the lone bare object, and the unusable inputs, plus a case
asserting no input yields something `.filter()` throws on. Reverting
`coerceSuggestionArray` to the identity function fails them.

End to end: run **Refine from Memories** on a character with two or more system
prompts against a model that wraps its arrays, and confirm the run reaches
"Proposed new system prompts" instead of dying partway, with a
`Sub-step answered with a non-array; coerced` warning in `combined.log`.
