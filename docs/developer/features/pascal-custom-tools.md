# Feature: Custom Tools — Pascal's Table (`run_custom`)

**Status:** Implemented (shipped). Kept current in place: "Correction" notes record where implementation amended the design, and the sections below include two post-ship additions — the **`metadata` test subject** (outcome tables branching on the invoking character's `metadata.json` fact sheet, added by the [character `metadata.json` feature](complete/character-metadata-json.md)) and the **`llm` consult block** (a per-run question posed to the cheap utility model, whose answer outcomes may test — see [The `llm` consult](#the-llm-consult)).
**Owner subsystem:** Pascal the Croupier (RNG / game-state — `lib/foundry/subsystem-defaults.ts:134`, settings under `/settings?tab=chat`).
**Implementation note:** This spec is written to be executed by Claude Code (Opus) with minimal further design input. Where a choice existed, it has been made — see [Design Decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, logging, migration pretty-labels, tool chokepoints).

## Motivation

Writers and roleplayers want lightweight, user-defined chance mechanics: "try to pick the lock," "measure the Hawking radiation," "draw from the deck of many things." Today the closest facility is the generic RNG tool (dice, coin, spin-the-bottle), which produces raw numbers with no narrative interpretation. Custom Tools let the user author a **pseudo-tool** as a small JSON document in any document store: a named action with parameters, a random roll (numeric range or dice notation), and an ordered table of outcomes that map the roll to a message and a semantic state. Both the LLM (via a single `run_custom` tool) and the human user (via a composer popup) can invoke them, and the outcome posts as a tamper-evident synthetic message authored by **Pascal the Croupier** — his debut as a `systemSender`.

Because the roll executes server-side and the outcome is persisted as a message the model did not author, the model cannot fudge a failure into a success, and regenerating a reply does not re-roll.

## Definition format

### File location and discovery

A custom tool is a single JSON file matching `Tools/*.tool.json` at the **root** of any document store — the `Tools/` folder name is a well-known convention like Suparṇā's `Mail/` (`lib/post-office/mailbox.ts:38`), but it is **not** added to the character-vault scaffold (`lib/mount-index/character-scaffold.ts` `TOP_LEVEL_FOLDERS`); it is recognized lazily if present.

- Add `export const TOOLS_FOLDER = 'Tools'` and the filename suffix constant in a new module `lib/pascal/custom-tools.ts` (new `lib/pascal/` directory; see [Modules](#new-modules)).
- Discovery layers on the existing tier resolver: `resolveTieredMountPool()` + `flattenTierPool()` (`lib/mount-index/tiered-mount-pool.ts`), then a per-mount file listing filtered to `Tools/*.tool.json` (same primitive `listMailbox` uses: `listDatabaseFiles(vaultId, { folder })`).
- The file's basename is **not** significant; the tool's identity is its `name` field. One tool per file.

### Schema

Zod schema `QtapCustomToolSchema` in `lib/pascal/custom-tool.types.ts`, plus a published JSON Schema at `public/schemas/qtap-custom-tool.schema.json` (draft-07, generated from the Zod schema the same way other published schemas are maintained) so users get editor completion via the `$schema` key.

```jsonc
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "unlock",                      // required. ^[a-z][a-z0-9_-]{0,63}$
  "title": "Force the Lock",             // optional, max 80 chars. Display only — Pascal's announcement, the composer
                                         // popup, the roster listing. Defaults to a title-cased `name`
                                         // ("scan_hawking_radiation" → "Scan Hawking Radiation") via displayTitle().
                                         // NEVER sent to the model: it calls tools by `name`, and a second string
                                         // for one tool only invites it to pass the wrong one.
  "description": "Attempt to pick the lock.",  // required. What the tool does *in the fiction* — this is how
                                               // the model decides when to reach for it and how the UI labels it.
                                               // Roleplay-facing, not mechanical ("Attempt to pick the lock,"
                                               // not "rolls 0–1 against thresholds"). Max 500 chars.
  "disabled": false,                     // optional. true = suppress this name at this tier and below.
  "availableWhen": {                     // optional (4.8). Availability gate — see "Availability gates" below.
    "metadata": { "toolAbilities": { "contains": "programmable" } }
  },
  "withheldWhen": { … },                 // optional (4.8). The mirror. At most one of the two per file.
  "revealOdds": true,                    // optional, default true. false = model sees name/description/parameters only, never the roll spec or outcome table.
  "defaultVisibility": "public",         // optional: "public" | "whisper". Default "public".
  "parameters": {                        // optional. Keyed by param name (same identifier rules as `name`). Max 8 params.
    "bonus": {
      "type": "number",                  // "number" | "integer" | "string" | "boolean"
      "default": 0,                      // required — every parameter must have a default so zero-argument runs always work
      "description": "Skill bonus added to the roll.",
      "min": 0,                          // optional, numeric types only; run-time values are clamped into [min, max]
      "max": 10
    }
  },
  "roll": { "min": 0, "max": 1, "multiplier": 1, "offset": { "$param": "bonus" }, "round": false },
  // — OR dice notation, handled by the existing dice system rather than pure math:
  // "roll": "3d6+2",
  "outcomes": [                          // required, ordered, first match wins. Max 32 entries.
    { "when": { "gt": 0.60 },               "message": "The lock clicks open.",  "state": "success" },
    { "when": { "lt": 0.30 },               "message": "Still locked.",          "state": "failure" },
    { "when": true,                          "message": "The lock is giving way…","state": "partial" }
  ]
}
```

The Hawking-radiation example, with parameter references, rounding, and templating:

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "measure_hawking_radiation",
  "description": "Take a Hawking-radiation reading from the detector.",
  "parameters": {
    "baseline": { "type": "number", "default": 0, "description": "Lowest plausible reading." },
    "ceiling":  { "type": "number", "default": 1000000, "description": "Highest plausible reading." }
  },
  "roll": { "min": { "$param": "baseline" }, "max": { "$param": "ceiling" }, "round": true },
  "outcomes": [
    { "when": true, "message": "The detector reads {{value}} µK.", "state": "info" }
  ]
}
```

A dice-driven example:

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "saving_throw",
  "description": "Roll a d20 saving throw against DC 12.",
  "roll": "1d20",
  "outcomes": [
    { "when": { "gte": 12 }, "message": "Saved! ({{dice}})",  "state": "success" },
    { "when": true,          "message": "Failed. ({{dice}})", "state": "failure" }
  ]
}
```

### `roll` — the two forms

**Form A — numeric range object.** Fields (all optional): `min` (default 0), `max` (default 1), `multiplier` (default 1), `offset` (default 0), `round` (default false). Each numeric field accepts a JSON number, a `{ "$param": "<name>" }` reference to a declared numeric parameter, or a `{ "$state": "<path>", "fallback": <number> }` reference into merged persistent state — **`$param` and `$state` are the two forms of indirection; no expression strings anywhere.** A `$state` roll field requires a **numeric** fallback (load-checked in `validateRollRefs`). Raw value = uniform float in `[min, max)` from **crypto-strength randomness** (`crypto.randomInt`/`randomBytes`-derived, not `Math.random`).

**Form B — dice notation string.** A string like `"3d6+2"`, `"1d20"`, `"2d10-1"`. Parsed and rolled by the **existing dice system** in `lib/tools/rng-tool.ts` — extract its dice parser/roller into a shared module (`lib/pascal/dice.ts`) and have both `rng-tool` and `run_custom` consume it, rather than duplicating (single source of truth). Raw value = the dice total. Dice form does not accept `$param` references inside the notation string (v1); if parameterized dice are needed later, that is a v2 extension.

**Transform pipeline (both forms), in this exact order:**

```
value = raw
value = value * multiplier      (Form A only; Form B has no multiplier/offset/round modifiers)
value = value + offset
if round: value = Math.round(value)
```

Outcome tests evaluate against the **final** `value`. Both `raw` and `value` are persisted (see `pascalMeta`).

If `$param` substitution yields `min > max`, or any substituted value is non-finite, the run **fails as an error** (see [Error handling](#error-handling)) — never a fabricated outcome.

### `when` — comparators, not expressions

`when` is either the literal `true` (catch-all) or an object naming one or more **subjects**, all of which must hold. There is no OR, no nesting, and no string expression grammar — ordered first-match-wins outcomes make OR unnecessary and this keeps the evaluator eval-free and trivially testable.

| Subject | Written as | Tests |
|---|---|---|
| the value | bare comparator keys | the final post-transform value |
| the raw roll | `roll: { … }` | the raw pre-transform draw |
| a parameter | `params: { <name>: { … } }` | the resolved (post-default, post-clamp) parameter |
| the invoker's metadata | `metadata: { <key>: { … } }` | one key of the invoking character's `metadata.json` fact sheet |
| the LLM consult | `llm: { … }` | the consult's answer (comparator keys) and/or its success (`ok`) — see [The `llm` consult](#the-llm-consult) |

Comparator keys are drawn from `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `contains`, `ncontains`, and AND together, so `>= 0.30 && <= 0.60` is `{ "gte": 0.30, "lte": 0.60 }`. Bare keys mean the value, which is what makes the extension **backward compatible** — every definition written before `roll`/`params` existed still means exactly what it meant. (`contains`/`ncontains` are string comparators, so the bare-value and `roll` subjects — always numbers — do not take them.) `"value > 1 && params.scale > 12"` is:

```json
{ "when": { "gt": 1, "params": { "scale": { "gt": 12 } } }, "message": "…", "state": "success" }
```

`roll` exists because a transform moves the value away from what was drawn: a raw draw in the bottom 2% is a fumble however the multiplier has since scaled it, and only `roll` can express that. It is degenerate for the dice form (raw == total) but harmless there.

**Operands** are a literal, a `{ "$param": "<name>" }` reference, or a `{ "$state": "<path>", "fallback": <literal> }` reference — the same indirection the roll fields take, reused rather than reinvented. `{ "gte": { "$param": "difficulty" } }` is the opposed check: a test against a number the caller supplied rather than one fixed at authoring time; `{ "gte": { "$state": "encounter.difficulty", "fallback": 10 } }` tests against a number the running scene carries. A `$state` operand is typed by its fallback (`resolveOperandType`), so the same load-time type rules that catch a mistyped `$param` catch a mistyped `$state`.

**Types.** Ordering comparators (`gt`/`gte`/`lt`/`lte`) demand a number on both sides. `eq`/`neq` on a `params` subject widen to strings and booleans, since a parameter need not be a number — `{ "params": { "material": { "eq": "brass" } } }`. A mismatch is a load-time rejection, not a test that quietly never fires (see [Validation rules](#validation-rules-load-time)).

**Containment.** `contains`/`ncontains` (added post-ship) test whether a string subject holds — or lacks — a substring: `{ "params": { "cargo": { "contains": "opium" } } }`. The substring operand is a non-empty literal string (non-empty because every string contains `""`) or a `$param` reference to a **string** parameter, so one input can be sought inside another — "does the consult's answer mention `params.searchTerm`". Valid on `params` (string parameters only — both sides load-checked), `metadata`, and `llm` subjects; never on the bare value or `roll`. Matching is case-sensitive and exact on `params`/`metadata` (the `eq` precedent there), and trimmed/case-insensitive on `llm` (that context's `eq` precedent — the subject is a model's prose). On `metadata` it is fail-soft like everything else there: a key that is absent or holds a non-string declines the row, including under `ncontains` — as with `neq`, absence is not a miss.

**Metadata.** The `metadata` subject (added by [character `metadata.json`](complete/character-metadata-json.md)) is shape-identical to `params` — the same comparator keys, the same `eq`/`neq` widening to strings and booleans, the same `contains`/`ncontains`, the same `$param` operands (`{ "metadata": { "clearanceLevel": { "gte": { "$param": "required" } } } }`). What differs is what can be known at load time. A `params` test names something the file itself declares, so a misspelling is a rejection; a `metadata` test names a key on a character the file has never met — keys are the *user's* vocabulary (`hasAnsibleAccess`), any non-empty string, not identifiers — so the loader can check only the comparator's shape and its `$param` references. The gap closes at run time, **fail-soft**: a key that is absent, holds a non-primitive (array/object/null), or type-mismatches its comparator (an ordering comparator against a string) makes that comparator **false**. The row declines, evaluation falls through — ultimately to the mandatory trailing `when: true` — and a debug log records the tool, key, and reason. Never a throw, never an error bubble: a lockpicking table that branches on `hasSkeletonKey` must still deal sensibly to the character who has never heard of one, and the catch-all row is the author's "otherwise."

Evaluation lives in `matchesWhen(when, subjects, toolName)` (`lib/pascal/custom-tools.ts`), which takes `{ value, roll, params, metadata }` and throws rather than returning false when a comparison is impossible at run time — for `value`/`roll`/`params`, that state is a regression past load-time validation, and returning false would look like the table skipping a row. `metadata` is the deliberate exception: there an impossible comparison is an expected state, handled fail-soft as above.

### The `llm` consult

*(Added post-ship.)* A definition may carry a top-level `llm` block beside `roll`:

```json
"llm": {
  "prompt": "The roll gave {{value}} for {{metadata.faction}}. Answer YES or NO: does the mechanism yield?",
  "errorMessage": "The wire crackles, and no answer comes."
}
```

- **When it runs:** after the roll/transform (so the prompt can quote `{{value}}`/`{{roll}}`/`{{dice}}`), before outcome evaluation (so the table can test the answer). The prompt takes every placeholder a message does except `{{llm}}` itself. Caps: prompt ≤ 4,000 chars (`MAX_LLM_PROMPT_LENGTH`), errorMessage ≤ 1,000; the answer is trimmed and truncated to the block's optional `maxOutput` (integer, 1–100,000 = `MAX_LLM_OUTPUT_CEILING`), defaulting to 8,000 (`MAX_LLM_OUTPUT_LENGTH`). The effective cap is passed to the invoker as `LlmInvokeOptions.maxOutputChars`, and the real invoker scales the call's token budget from it (`consultMaxTokens`: ~chars/3, floored at the pipeline's 2,048, ceilinged at 32,768) so a long-form consult is not starved at the provider. `errorMessage` is never subject to `maxOutput` — those are the author's words, kept whole.
- **What it produces:** a pair `{ ok, output }`. Success → the model's trimmed answer. Failure — provider error, 60 s timeout (`CONSULT_TIMEOUT_MS`), empty answer, no cheap model configured, no invoker wired — → `ok: false` with `output` set to the author's `errorMessage`. **A failed consult never fails the run**: no Prospero bubble, no throw; the table deals with silence the way its author wrote it to. The technical `reason` goes to `pascalMeta.llm` and the logs only.
- **The `llm` when-subject:** the comparator keys against the answer plus a non-comparator `ok: boolean`. Type reconciliation is fail-soft (the metadata precedent — the answer's type is the model's business): ordering comparators apply when the trimmed answer parses as a finite number, else the row declines with a debug log; `eq`/`neq` compare numerically when both sides are numbers, otherwise as trimmed case-insensitive strings with a trailing `.`/`!` forgiven; `contains`/`ncontains` search the answer under that same trimmed case-insensitive reconciliation. `$param` operands work as everywhere. Load-time validation rejects an `llm` test on a definition with no `llm` block (a dead branch), and checks `$param` operand resolution; everything else waits for run time.
- **`{{llm}}` template family:** renders the output (answer or errorMessage). Verbatim-with-debug-log when no consult ran, per the unknown-placeholder convention.
- **Who answers:** `lib/pascal/llm-consult.ts` builds the invoker — standard cheap-LLM selection (`getCheapLLMProvider` over `chatSettings.cheapLLMSettings`), Concierge uncensored rerouting when the chat is active-dangerous, `executeCheapLLMTask` with the rendered prompt as a single user message and **no framing of ours**, logged as `CUSTOM_TOOL_CONSULT`. The execution core takes it as an injected `llmInvoke` seam on `executeCustomTool` (now async), so tests and the proving bench substitute scripted oracles. Job-child safe.
- **Record:** `pascalMeta.llm = { ok, output, prompt, reason?, provider?, model? }` — the rendered prompt is the record of what was asked. Mirrored in the row schema, export schema, and DDL.md.
- **Simulation:** `simulateOutcomes` takes an optional fixed `llm` subject; the Workbench audit never spends real calls (scripted answer or silence), while single preview rolls may go live via `{ llm: { live: true } }`.
- **Roster:** the `run_custom` preamble notes that some tools consult a separate model server-side; with odds revealed, `llm` clauses render and the tool gets a "consults a separate model" line — the prompt itself is never quoted to scene models (it is instructions for a different model, and quoting it would invite this one to answer it).

### `outcomes` entries

- `when` — as above. Required.
- `message` — required string, max 1000 chars, with templating (below).
- `state` — required enum: `"success" | "partial" | "failure" | "info"`. Maps to qt classes at render; authors never write CSS.

### Templating

`message` supports exactly these placeholder families, replaced server-side with plain string substitution (no template engine):

- `{{value}}` — the final post-transform value (integers rendered without decimals; floats to 4 significant digits).
- `{{roll}}` — the raw pre-transform value. For dice form, the total.
- `{{dice}}` — dice form only: the breakdown, e.g. `3d6+2: [4, 2, 6] + 2 = 14`. Empty string for Form A.
- `{{params.<name>}}` — the resolved (post-clamp, post-default) value of a declared parameter.
- `{{metadata.<key>}}` — the invoking character's metadata value for that key. Primitives render like `{{params.<name>}}`; an absent key or non-primitive value leaves the placeholder verbatim (with a debug log), the same convention as unknown placeholders.
- `{{state.<path>}}` — a path into merged persistent state (see below). Primitives render like `{{params.<name>}}`; an absent path or non-primitive value leaves the placeholder verbatim (with a debug log) — the `{{metadata.*}}` doctrine, applied to state.
- `{{llm}}` — the consult's output: the model's trimmed answer, or the `llm` block's `errorMessage` after a failed consult. Verbatim when the tool declares no `llm` block.

Unknown placeholders are left verbatim (and logged at debug level).

### `$state` — drawing on persistent state

A definition may reach into the chat's persistent **state** — the four-tier cascade (chat → project → group → general) shared with the `state` tool. The reference is a closed object, `{ "$state": "<path>", "fallback": <number|string|boolean> }`, usable in every position a `{ "$param": … }` is: roll fields, comparator operands, and a parameter's `default`. Messages (and the `llm` prompt) render `{{state.<path>}}`.

- **The fallback is required, and load-bearing.** It types the reference at load time (a numeric fallback makes it a number, a string a string — so `resolveOperandType` / `validateRollRefs` / the parameter-default `superRefine` type-check `$state` exactly as they do `$param`) and it guarantees run-time resolution never fails: `resolveStateValue(ref, state)` returns the value at the path **only when its `typeof` matches the fallback**, and the fallback otherwise. A run is therefore always dealable, whatever state holds. `resolveStateValue` is pure and never throws.
- **Path syntax** is the shared `parsePath` from `@/lib/state/state-paths` (dot + bracket). Its `\w+` segments mean keys containing spaces or literal dots are unreachable by a path — a pre-existing limitation, documented here beside `$state`.
- **Per-entrance cascade resolution.** The merged state is resolved once per run and passed as `overrides.state` into `executeCustomTool`, threaded through `resolveParams`/`coerceParam`, `resolveRollField`/`rollRange`, the `matchesWhen` → `matchesComparator`/`matchesLlmComparator`/`matchesMetadataComparator` chain, and `renderTemplate`. Each entrance scopes the group tier differently:
  - **LLM path** (`run_custom`, `lib/tools/handlers/run-custom-handler.ts`): `resolveStateCascade` with `{ kind: 'character', characterId }` — the responding character's own groups (Knowledge's rule). Fail-soft to `{}`.
  - **Manual popup** (`app/api/v1/chats/[id]/custom-tools/route.ts` `handleRun`): character scope when `asCharacterId` names a character, else `{ kind: 'none' }` — the same asymmetry the metadata rule uses (a run nobody made borrows no one's groups). Fail-soft to `{}`.
  - **Workbench** (`app/api/v1/custom-tools/route.ts` preview/audit): an optional mock `state` object on the request body, exactly like the mock `metadata`; `simulateOutcomes` takes it as a trailing `state` argument (default `{}`). The proving bench exposes a **Mock state** JSON field.
- **`persist` stays deferred.** Writing state back from a roll (the reserved v2 `persist` key) remains out of scope; `$state` is read-only. The top-level schema still tolerates unknown keys so a future `persist` file won't break older builds.

### Validation rules (load-time)

Files are validated with `QtapCustomToolSchema.safeParse` at roster-resolution time. A file is **rejected** (skipped from the roster, surfaced as an error badge in the UI popup and a debug log) if any of:

1. JSON parse failure or schema mismatch.
2. `outcomes` is empty, or the **final** outcome's `when` is not the literal `true`. Requiring a trailing catch-all makes coverage gaps structurally impossible; earlier `when: true` entries are also invalid (unreachable outcomes below them).
3. Any `$param` — in a roll field or in a comparator operand — references an undeclared parameter, or a non-numeric one where a number is required, or a non-string one as a `contains`/`ncontains` substring on a `params` subject.
4. An outcome's `params` names an undeclared parameter, orders a non-numeric one, or compares one against a literal of the wrong type. All of these are tests that could never hold; left to run time they read as dead branches rather than the typos they are.
5. Dice notation fails to parse via the shared dice module.
6. Duplicate `name` **within the same file set of a single mount** (across mounts/tiers, shadowing rules apply instead).

`metadata` comparators get a deliberately shallower version of rules 3–4: shape and `$param` operand references are checked, but key existence and stored-value types are unknowable at load time (the sheet belongs to whichever character eventually rolls) and are handled fail-soft at run time instead — see [`when`](#when--comparators-not-expressions).

Unknown **top-level** keys are **ignored with a debug warning**, not rejected — this reserves room for v2 keys (notably `persist`, see [Deferred](#deferred-to-v2)) without breaking older builds. That tolerance stops at the top level: every nested object (`when`, comparators, outcome entries, the roll range, `$param` refs) is a `z.strictObject`. The forward-compatibility argument doesn't reach them, an unrecognised key inside a `when` is overwhelmingly a misspelled comparator (`gt3`) that would otherwise silently drop the test, and `additionalProperties: false` is what the published JSON Schema has always claimed — so the loader and the author's editor now agree.

**Rejection messages** are rendered by `formatDefinitionIssues()` (`lib/pascal/custom-tool.types.ts`), the single chokepoint for the sentence an author reads on the badge. It exists because `when` (`true | object`) and `roll` (`string | object`) are unions: when both branches fail, Zod reports a bare `Invalid input` at the union and buries the real complaint one level down in `issue.errors`. The helper surfaces every branch, joined by `— or —`. A rejection nobody can read is barely better than no rejection.

**The published JSON Schema is a deliberate superset.** JSON Schema can describe what an outcome looks like but not what the *last* one must be, so the cross-item rules — the trailing catch-all, and every `$param` resolving — are the loader's alone. What the mirror rejects, Zod rejects; what the mirror accepts, Zod may still refuse. `__tests__/unit/lib/pascal/custom-tool-definition.test.ts` checks both schemas against one corpus and asserts they agree, so the hand-synced mirror cannot drift unnoticed; the one accepted divergence is asserted explicitly there.

## Scope resolution — tiers and shadowing

The roster for a chat is resolved through the existing five-tier pool (`character → participant → group → project → global`, `lib/mount-index/tiered-mount-pool.ts`):

- **Nearest tier wins** on a `name` collision — a character-tier `unlock` shadows the project-tier `unlock`.
- `"disabled": true` at a nearer tier suppresses the inherited tool of that name entirely.
- A collision **within the same tier** (two mounts at the same tier both defining `unlock`) resolves deterministically by mount-point id (lexicographic), with a warning logged and an info badge in the UI popup.
- **Perspective:** resolution is computed per invoker. When character X calls `run_custom`, X's character-tier mounts are the "character" tier. For the human user's composer popup, the roster is the union across all participants' perspectives: tools identical for everyone appear once; a tool whose definition differs per character (character-tier shadowing) appears once per variant, labeled with the character's name, and running it executes that character's variant.
### Availability gates — `availableWhen` / `withheldWhen` (4.8)

A tier decides *which* definition of a name an invoker gets. A gate decides whether they are offered one at all. Both clauses are optional, at most one may appear in a file (enforced at load, since they are not complements and the Workbench's single control cannot represent both), and a definition declaring neither is offered to everyone — which is every file written before 4.8.

- **Subject: `metadata`, and only `metadata`.** The gate is answered *before* the deal, so there is no roll, no resolved parameters, and no consult to test. Operands are therefore literals: `$param` and `$state` are load-time rejections here, because neither has anything to refer to yet.
- **Semantics are the outcome table's, verbatim.** `lib/pascal/metadata-match.ts` holds the one fail-soft comparison table; `matchesMetadataComparator` (roll time) and `evaluateToolGate` (roster time) are both thin wrappers over it, differing only in operand resolution and logging. A second copy of those rules would drift the moment either side gained a comparator.
- **Fail-soft cuts opposite ways, which is why both clauses exist.** A key the character lacks never matches, so an empty sheet fails every `availableWhen` (fail-closed) and satisfies no `withheldWhen` (fail-open). `withheldWhen: {x: {eq: true}}` is therefore *not* `availableWhen: {x: {neq: true}}` — they differ precisely on the character with no `x`.
- **A gated-out definition makes no claim on its name** — not even a tombstone — so a farther tier may still deal one. That is the useful arrangement: a character's vault holds the variant written for characters like them, the General store holds the plain fallback. Contrast `disabled`, which stays absolute. The gate is evaluated *before* `disabled` for this reason: a gated tombstone only tombstones for the characters it names.
- **Enforcement is at roster resolution**, so a withheld tool is absent from the `run_custom` description, absent from `GET /api/v1/chats/[id]/custom-tools`, and unrunnable by name through either entrance (both re-resolve the roster before executing).
- **The invoker's sheet** rides on `RosterContext.metadata`; every caller already holds it (the popup hydrates perspectives, the turn resolves a responding character). Absent, the roster fetches it — but lazily, and only if a gated definition actually turns up, so an ungated roster pays nothing. A vault that cannot be read degrades to `{}`, which is the same fail-closed/fail-open reading as an empty sheet.
- **Vocabulary, not odds:** `collectToolVocabulary` reports a gate's metadata keys alongside the table's, so the run dialog says a tool reads `toolAbilities` — never what value opens the door. A gated-out tool never reaches a listing at all.

### Roster freshness — resolved per call, never cached across turns

The roster is **re-resolved at every assembly point**, so it can never go stale:

- **Every LLM call:** `buildToolsForProvider` (and the system-prompt builder, if the roster is ever surfaced there too) resolves the roster fresh as part of building that call's tools. A brand-new chat therefore gets its full roster on the first turn with no separate "initialize tools" step, and a `.tool.json` added, edited, or deleted mid-chat takes effect on the **next** LLM call automatically — including when the user regenerates a message, since regeneration rebuilds the prompt and tools from scratch.
- **Every UI fetch:** `GET /api/v1/chats/[id]/custom-tools` resolves fresh on each request (the composer popup re-fetches on open).
- The only permitted memoization is **within a single request/turn** (resolve once, share between the tool builder and the handler for that call). No chat-lifetime or process-lifetime cache: document edits inside a mount don't reliably touch the mount index, so index-based invalidation would miss mid-chat additions.

This is affordable because resolution is one folder listing (`Tools/`) per mount in the tier pool — mounts per chat number in the single digits and the listings hit the local mount index/filesystem, not the network. If profiling ever shows otherwise, add a short TTL, never an event-invalidated cache.

**Prompt-cache note:** since the roster rides in the `run_custom` tool description, a roster change alters the tool block and busts the provider prompt cache for that chat. That is the correct behavior (the model must see the new tool) and roster changes are rare; no mitigation needed.

**Odds secrecy caveat (documented, not new machinery):** `revealOdds: false` hides the roll spec and outcome table from the roster injection, but the `.tool.json` file itself remains an ordinary document — a character with `character_read` on that store can still read it with `doc_*` tools. Users who want genuinely secret odds should place the file in a store the character cannot read; the existing per-document policy machinery covers this. State this plainly in the help doc.

## The `run_custom` tool

New file `lib/tools/run-custom-tool.ts`, following the five-part chokepoint pattern exactly (see `lib/tools/wardrobe-wear-tool.ts` as the template):

1. `export const runCustomToolInputSchema = z.object({ tool: z.string().describe(...), parameters: z.record(z.unknown()).nullable().optional().describe(...), private: z.boolean().optional().describe(...) })`
2. `export type RunCustomToolInput = z.infer<...>`
3. `export const runCustomToolDefinition = { type: 'function', function: { name: 'run_custom', description: RUN_CUSTOM_DESCRIPTION, parameters: zodToOpenAISchema(runCustomToolInputSchema) } }`
4. `export function validateRunCustomInput(input): input is RunCustomToolInput` — one-line `safeParse(...).success` delegate.
5. Handler in `lib/tools/handlers/run-custom-handler.ts`.

**Registration:** exported from `lib/tools/index.ts`; wired into `buildToolsForProvider` (`lib/tools/plugin-tool-builder.ts`) behind a new `BuildToolsOptions` boolean `customTools`, which the caller sets **only when the resolved roster is non-empty** and the settings toggle (below) is on. Added to `ALL_TOOLS` in `lib/tools/__tests__/tool-definitions-snapshot.test.ts` and the snapshot updated with `npx jest -u` on that file.

**Roster injection:** the tool's `description` is composed dynamically on **every** tool build (see [Roster freshness](#roster-freshness--resolved-per-call-never-cached-across-turns)): a fixed preamble plus, per available tool, its `name`, its roleplay-facing `description`, parameter list (name, type, default, min/max, description), and — unless `revealOdds: false` — a compact rendering of the roll spec and outcome table. This is how the model learns what its custom tools are and what parameters they take, on the first turn of a new chat and after any mid-chat definition change alike. Prompt-cache trade-off: the description changes only when definitions change, which is rare. `canonicalizeUniversalTools()` handles ordering stability as usual.

**Metadata stays out of the roster.** The fixed preamble notes that outcome tables *may* consult the invoking character's metadata sheet — and that is all the model learns. The roster never enumerates metadata keys or values: they are per-character and potentially secret, and enumeration would leak them into every participant's tool block. A table with `revealOdds: true` renders its `when` clauses as always, `metadata` clauses included; authors who want those conditions hidden set `revealOdds: false`, the existing machinery.

**Handler behavior** (`run-custom-handler.ts`):

1. Resolve the invoker's roster; look up `tool`. Unknown name → error result listing available names.
2. Validate/coerce `parameters` against the definition's declarations: unknown keys rejected, missing keys defaulted, numeric values clamped to declared `[min, max]`.
3. Load the invoking character **hydrated** (`repos.characters.findById`), so `character.metadata` is populated, and pass `metadata: character.metadata ?? {}` into the execution core. A manual run with no character association passes `{}` — every `metadata` test then fails soft and the catch-all answers, the honest reading of "nobody in particular rolled this." A `CharacterVaultUnavailableError` from a broken vault lands on the standard error path (Prospero bubble), not a fabricated outcome.
4. Substitute `$param` refs, roll (crypto RNG or shared dice module), run the transform pipeline, evaluate outcomes in order, take the first match (the trailing `when: true` guarantees one).
5. Render the `message` template.
6. Post the **Pascal outcome message** (next section) — honoring visibility: `private` param if present, else the definition's `defaultVisibility`.
7. Return a compact JSON tool result to the model: `{ tool, value, state, message, whispered }`. The TOOL-role message persists as usual for tool-call threading (`tool-call-threading.ts` — do not break linkage), but its content JSON includes `"delegatedDisplay": true` so `ToolMessage.tsx` renders nothing for it (the Pascal bubble is the single visible artifact; no double display).
8. Debug logs at every step per the standing logging rule.

**Job-child compatibility:** the handler runs in autonomous rooms too. All writes go through the buffered `getRepositories()` proxy — never assume read-your-writes. The roll and outcome evaluation are pure computation; only the message post is a write.

## Result delivery — Pascal speaks

### New `systemSender: 'pascal'`

- Add `'pascal'` to the `systemSender` Zod enum in `lib/schemas/chat.types.ts:222` (the column is plain nullable TEXT with no CHECK constraint, so no ALTER is needed for the enum itself).
- Add the value to `public/schemas/qtap-export.schema.json`.
- Add a `getMessageAvatar` branch in `app/salon/[id]/SalonView.tsx` (~line 1083 block) returning `{ name: 'Pascal', title: 'the Croupier', avatarUrl: '/images/avatars/pascal-avatar.webp' }` — the avatar already ships.
- Update the CLAUDE.md personified-avatars sender list (replace the "Pascal authors no synthetic messages yet" note) and the DDL.md doc-comment for the column.

### The outcome message

Constructed like Suparṇā's writer (`lib/services/suparna-notifications/writer.ts:90` is the template): `role: 'ASSISTANT'`, `participantId: null`, `systemSender: 'pascal'`, `systemKind: 'custom-tool-result'`, persisted via `repos.chats.addMessage`. New writer module: `lib/services/pascal/writer.ts`.

`content` is the human/LLM-readable text, and it is the tool's title plus the author's own message — nothing else:

> 🎲 **Force the Lock** — The lock clicks open.

The tool is named by `displayTitle(definition)` — the author's `title`, or a title-cased `name` — never by the raw declaration name. `buildPascalResultContent` takes it as `toolTitle` for exactly that reason. The identity is not lost: `pascalMeta.tool` records `name`, which is what audit and shadowing resolve on. Because the title is interpolated at post time, no stored message changes when a `title` is later edited — the transcript keeps what was announced, which is correct for a record of what happened.

**Correction (implementation) — the croupier does not narrate.** This spec designed a voiced announcement, and it was built and then cut back to the line above. Three things went, by request:

- **Pascal's own voice.** The manual form once read "At {patron}'s behest, Pascal spins the wheel: …". Gone — so a manual run's announcement is now **byte-identical** to the one a character's roll produces. Two consequences worth understanding: the transcript no longer records that the operator was the one who reached for the tool (`pascalMeta.invokedBy` still does), and the `patronName` plumbing — resolving the human's persona via `findUserParticipantName` rather than their account name — is gone with the clause that used it.
- **The `*(rolled 14)*` suffix.** What a roll says is the author's to decide: a table that wants its number read out puts `{{value}}` or `{{dice}}` in the `message`. Nothing is lost — the whole roll record still lives in `pascalMeta`, and the rolling model still gets `value`/`state` back from `run_custom`.
- **The separate opaque body.** The spec first said `opaqueContent = content` (copying Suparṇā), then a correction made it a distinct neutral `System: …` body, because Pascal's framing would have leaked his name to an opaque character. With the framing gone the original answer is right again for the original reason: no persona in the body, nothing to strip. `opaqueContent === content`, both still populated in lockstep per the contract in `lib/schemas/chat.types.ts`.

The remaining `🎲 **Title** —` prefix is a label, not a voice: it carries no Staff name and every part of it comes from the author's own JSON.

**A manual run posts ONE message, not two.** The spec paired Pascal's outcome with a USER invocation line (`*I ran unlock (scale: 1)*`) so the model would attribute the roll to the operator. Its only unique contribution was to publish the operator's chosen parameters — precisely what a model must not see, since it is the human's hand on the scale and a character reading it can infer the roll was arranged. The line is gone; `?action=run` returns `messages: [pascalMessage]`.

### `pascalMeta` column

New nullable TEXT (JSON) column on `chat_messages`, following the `carinaMeta` precedent:

```jsonc
{
  "tool": "unlock",
  "toolTitle": "Force the Lock",        // optional; displayTitle() at roll time. The Salon labels the
                                        // outcome's header chip with this — "● PASCAL · FORCE THE LOCK"
                                        // rather than a generic "roll outcome". Absent on rows written
                                        // before the field existed, where readers fall back to `tool`.
  "definitionTier": "project",          // MountTier
  "definitionMountId": "…",
  "params": { "bonus": 2 },              // resolved, post-clamp
  "rollForm": "range" | "dice",
  "notation": "3d6+2",                   // dice form only
  "raw": 0.7134,                         // pre-transform (dice: total)
  "diceRolls": [4, 2, 6],                // dice form only
  "value": 0.7134,                       // post-transform; what outcomes tested
  "state": "success",
  "outcomeIndex": 0,
  "metadataTested": { "hasSkeletonKey": true },  // optional; the metadata keys the WINNING row consulted
                                                 // and what they held at roll time, primitives only —
                                                 // the transcript records what the table saw. Absent
                                                 // when the winning row tested no metadata.
  "llm": {                                       // optional; present iff the definition declares an `llm` block.
    "ok": true,                                  // whether the consult produced an answer
    "output": "YES",                             // the trimmed answer — or the author's errorMessage on failure
    "prompt": "The roll gave 42. YES or NO?",    // the rendered prompt actually posed
    "reason": "…",                               // failure only: the technical cause, never spoken in the fiction
    "provider": "ANTHROPIC", "model": "…"        // success only, when known
  },
  "invokedBy": "llm" | "user",
  "callerParticipantId": "…"             // LLM path only
}
```

Chores this column triggers (per standing rules): migration in `migrations/scripts/` with an `index.ts` entry and a `PRETTY_LABELS` line in `lib/startup/prettify.ts` (steampunk voice; it's a single ALTER with no loop, so no `reportProgress` needed); DDL.md updated; `qtap-export.schema.json` gains the field; **export and import code both include it** (fields must round-trip); backups pick it up automatically as part of the main DB.

### Live surfacing (SSE)

Follow the `carinaAnswer` / `hostAnnouncement` pattern exactly:

- Server: `encodePascalResultEvent` in `lib/services/chat-message/streaming.service.ts` emitting `{ pascalResult: message }`.
- Client: `pascalResult?: Message` on the SSE payload type in `app/salon/[id]/hooks/useSSEStreaming.ts`, dispatched to an `onPascalResult` callback that inserts into the message list, deduped by id.

Manual runs happen outside a streaming turn; the API response returns the created messages and the client inserts them directly (plus TanStack invalidation via `queryKeys`).

## Whispered (hidden) runs

Both paths support GM-style hidden rolls, riding the existing `targetParticipantIds` machinery (`lib/schemas/chat.types.ts:218`, filtered for LLM context by `filterWhisperMessages` in `lib/chat/context/message-attribution.ts:168`):

- **LLM path:** `run_custom`'s optional `private: boolean` (definition `defaultVisibility` supplies the default). A private run sets the Pascal message's `targetParticipantIds: [callerParticipantId]` — only the rolling character (and the human, below) sees the outcome; other participants' LLM contexts exclude it. The tool result returned to the calling model always contains the outcome (it made the call).
- **Manual path:** a "Roll privately" toggle in the popup. A private manual run follows the existing operator-private convention (operator userId in `targetParticipantIds`, as user-initiated Prospero runs do) so **no character** sees it.
- **UI rule:** Pascal whispers must **always render for the human user** regardless of the "show all whispers" toggle — this instance is single-user and the operator is never the one being surprised. Implement this as: messages with a non-null `systemSender` bypass the whisper-hiding branch in `SalonView.tsx` (~line 290) and render with the whisper styling (`qt-chat-message-whisper`, "whispered" label). This intentionally implements the standing fix noted for systemSender whispers generally (Commonplace Book recall whispers benefit too); keep the change scoped to `systemSender !== null` messages.

## Manual runs — composer UI and API

### UI

- New gutter button in `components/chat/ComposerGutterTools.tsx` (the 3×2 grid gains a slot or reflows to 4×2 — implementer's call, keep `qt-composer-gutter-button` styling), visible **only when the resolved roster is non-empty**.
- The popup follows the `RngDropdown` pattern (`components/chat/RngDropdown.tsx`: outside-click ref, `variant="gutter"`). New component `components/chat/CustomToolsDropdown.tsx`: a list of available tools (name + description; character-labeled variants where shadowed; error badges for invalid files), each expanding to a small parameter form generated from the `parameters` block (defaults pre-filled; number/integer/string/boolean inputs), a "Roll privately" checkbox (pre-checked when `defaultVisibility: "whisper"`), and a Run button.
- Running posts **one message** — the Pascal outcome, carrying the run's visibility. (This spec originally called for a USER invocation line alongside it; see the correction under [The outcome message](#the-outcome-message) for why it was dropped.) The popup lists tools by `title`, not `name`, and sorts on it.
- Icons go through the central `<Icon name>` system (themeable-icons).

### API

Chat-scoped route `app/api/v1/chats/[id]/custom-tools/route.ts` using `createContextHandler` + `withActionDispatch`, responses via `@/lib/api/responses`:

- `GET /api/v1/chats/[id]/custom-tools` — the resolved roster for the composer popup: `[{ name, description, parameters, defaultVisibility, sourceTier, characterLabel?, error? }]` (roll spec and outcomes are **not** included in the payload unless needed; the UI never shows odds — parity with what a tabletop screen hides — except that this is the user's own file, so include a `definitionPath` so the UI can link to the document).
- `POST /api/v1/chats/[id]/custom-tools?action=run` — body `{ tool, parameters?, private?, asCharacterId? }` (the last disambiguates character-labeled variants). Executes server-side exactly as the tool handler does (share the execution core in `lib/pascal/custom-tools.ts` — one roll/evaluate/post code path for both entrances), returns the created messages.
- TanStack Query: add a `customTools` block to `lib/query/keys.ts`; fetch via `apiFetch` with signal forwarding; mutation invalidates the chat's messages and the roster key.

## qt-\* styling

The Pascal bubble renders the outcome with a state accent. Add semantic utilities (names indicative — match existing `qt-` naming conventions in the stylebook):

- `qt-pascal-result` (container), `qt-pascal-result--success`, `qt-pascal-result--partial` (warning treatment), `qt-pascal-result--failure` (danger treatment), `qt-pascal-result--info`.

Per the standing rule, propagate additions to the stylebook and `packages/theme-storybook` (which triggers the packages hard-stop: bump version, then **stop and ask the human to `npm publish`**), and check the six bundled themes render the four states legibly. Keep the additions minimal — accent border/badge, not a new layout system.

## Settings

One toggle in the Chat tab (`components/settings/tabs/ChatTabContent.tsx`), grouped under Pascal's existing area: **"Custom tools"** (default on). Off = `run_custom` never offered to models and the gutter button hidden. No further settings in v1 (per-tool configuration lives in the JSON files themselves).

## Error handling

Runtime failures (unknown tool name from UI race, `min > max` after substitution, non-finite values, dice parse regression, store read failure) post a **Prospero-authored error bubble** following the `carina-error` precedent: `systemSender: 'prospero'`, `systemKind: 'custom-tool-error'`, message naming the tool and the reason in one sentence. The LLM path additionally returns `{ success: false, error }` in the tool result. Never post a Pascal message for a failed run — Pascal only announces genuine outcomes.

Load-time validation failures do not error at run time; they simply keep the tool out of the roster (UI error badge + debug log).

## Security constraints

- **No expression evaluation anywhere.** Comparator objects and `$param` refs only. Reject on schema, don't sanitize.
- Roster caps: max 64 tools per resolved roster (excess dropped with a logged warning and UI notice — no silent truncation), max 8 parameters and 32 outcomes per tool, message ≤ 1000 chars, description ≤ 500 chars.
- Parameter values from the model/UI are validated against declared types and clamped to declared ranges before any use.
- Crypto-strength RNG (`node:crypto`), never `Math.random`.
- Template substitution is plain string replacement of the three known placeholder families; user text is never interpreted.

## Deferred to v2 (schema room reserved)

- **`persist` block** — `"persist": { "baseline": "{{value}}" }`: after each run, store the value as this chat's default for a parameter, backed by Pascal's existing state system (`lib/tools/state-tool.ts`). Enables self-ratcheting tools (each Hawking reading becomes the next floor) and counters ("third failed lockpick breaks the pick"). v1 ignores the key with a warning.
- Parameterized dice notation (`"{{params.n}}d6"`).
- ~~Group-tier authoring UI (definitions are hand-authored JSON in v1; a form-based editor could come later).~~ Shipped as [Pascal's Workbench](complete/custom-tool-builder.md) — a full visual editor, library, and proving bench at `/custom-tools`.
- Per-run seeds / deterministic replay.

## New modules

- `lib/pascal/custom-tool.types.ts` — Zod schema + TS types.
- `lib/pascal/custom-tools.ts` — discovery (tier resolution + `Tools/*.tool.json` listing), roster cache, and the shared execution core (validate params → roll → transform → evaluate → render → post).
- `lib/pascal/dice.ts` — dice parser/roller extracted from `lib/tools/rng-tool.ts`; both consumers import it.
- `lib/services/pascal/writer.ts` — Pascal synthetic-message writer.
- `lib/tools/run-custom-tool.ts` + `lib/tools/handlers/run-custom-handler.ts`.
- `components/chat/CustomToolsDropdown.tsx`.
- `app/api/v1/chats/[id]/custom-tools/route.ts`.

## Engineering tasks

### Backend

- [ ] `QtapCustomToolSchema` + types; publish `public/schemas/qtap-custom-tool.schema.json`.
- [ ] Extract shared dice module from `rng-tool.ts`; keep `rng-tool` behavior byte-identical (its snapshot must not change).
- [ ] Discovery + tier shadowing + roster cache in `lib/pascal/custom-tools.ts`.
- [ ] Execution core: param validation/clamping, `$param` substitution, crypto roll, transform pipeline, ordered outcome evaluation, templating.
- [ ] `run_custom` tool (five-part pattern), `BuildToolsOptions.customTools` wiring with dynamic roster description, snapshot-test registration (`npx jest -u`).
- [ ] Handler + `delegatedDisplay` TOOL-content flag; verify tool-call threading intact in the Brahma Console and autonomous rooms.
- [ ] `systemSender: 'pascal'` enum + export schema + DDL.md + CLAUDE.md sender list.
- [ ] `pascalMeta` column migration + `PRETTY_LABELS` entry; export/import round-trip.
- [ ] Pascal writer; Prospero `custom-tool-error` path.
- [ ] SSE `pascalResult` encode/dispatch.
- [ ] `/api/v1/chats/[id]/custom-tools` route (GET roster, POST run) on the shared execution core.
- [ ] Whisper targeting for both paths; `systemSender` whispers always visible to the human user.
- [ ] Debug logging on every new path.

### Frontend

- [ ] `getMessageAvatar` Pascal branch.
- [ ] Pascal bubble rendering with `qt-pascal-result--*` state classes; whisper styling for private rolls.
- [ ] `ToolMessage.tsx` honors `delegatedDisplay`.
- [ ] Gutter button + `CustomToolsDropdown` (roster list, param forms, private toggle, error badges, character-labeled variants).
- [ ] `queryKeys.customTools` block; fetch/mutation wiring.
- [ ] Settings toggle in Chat tab.
- [ ] Stylebook + theme-storybook propagation; check bundled themes (packages hard-stop applies to theme-storybook publish).

### Documentation

- [ ] `help/custom-tools.md` — user-facing, steampunk voice, with `url` frontmatter and matching In-Chat Navigation `help_navigate` call; must cover the JSON format (with copy-paste examples), the `Tools/` folder convention, tier shadowing, `revealOdds` and its store-readability caveat, whispered rolls, and the composer popup.
- [ ] `docs/CHANGELOG.md` entry (plain American English).
- [ ] DDL.md, API.md (new route), CLAUDE.md glossary/sender updates as above.

### Testing

- [ ] Unit: schema validation matrix (all rejection rules incl. trailing-catch-all and unreachable-outcome checks), comparator evaluator, transform-pipeline order, templating (incl. unknown placeholders), param clamping/defaults, `$param` substitution errors, dice-module extraction parity with `rng-tool` fixtures.
- [ ] Unit: tier shadowing, `disabled` suppression, same-tier collision determinism, per-invoker perspective.
- [ ] Integration: roster freshness — a `.tool.json` added (or edited/deleted) after a chat has begun appears in (or vanishes from) the very next call's `run_custom` description and the next roster GET; a new chat's first turn includes the full roster.
- [ ] Unit: whisper filtering — private LLM roll invisible to other characters' contexts (`filterWhisperMessages`), visible to caller; private manual roll invisible to all characters.
- [ ] Snapshot: `run_custom` in `tool-definitions-snapshot.test.ts`.
- [ ] Integration: manual run posts USER + Pascal messages; LLM run posts TOOL (delegated) + Pascal message; error path posts Prospero bubble; export/import round-trips `pascalMeta` and the new sender.
- [ ] Follow Jest conventions (global `jest`, bare mock factories); any suite touching the real SQLCipher binding gets the `@jest-environment node` docblock.

## Design Decisions (Resolved)

1. **Structured comparators over expression strings.** The originally sketched `"test": "> 0.60"` form implies a parser and an injection/typo surface; AND-composed comparator objects plus ordered first-match outcomes express everything the examples need with zero evaluation.
2. **Trailing `when: true` is mandatory.** Coverage gaps become a load-time validation error instead of a runtime surprise.
3. **Dice notation is first-class** (user decision) and must reuse the existing dice system via extraction, not a second parser.
4. **Whispered rolls are first-class** (user decision), on `targetParticipantIds`, with the rule that `systemSender` whispers always render for the human operator.
5. **One `run_custom` tool, not per-definition dynamic tools.** Keeps the tool list stable for prompt caching, avoids snapshot churn, and matches the Zod-chokepoint rule; the roster rides in the description.
6. **Pascal synthetic message is the canonical display; the TOOL message is protocol-only** (`delegatedDisplay`), avoiding double bubbles while preserving tool-call threading.
7. **Rolls are persisted facts.** Raw roll, transform, and outcome live in `pascalMeta`; regeneration never re-rolls.
8. **Manual runs post the Pascal outcome alone**, which attributes the act to the operator's persona in its own framing. The USER invocation line this spec originally called for is not written: its only unique contribution was to publish the parameters the operator chose, which is the one thing a model must not see.
9. **Per-invoker perspective for character-tier shadowing**; the composer popup surfaces character-labeled variants with `asCharacterId` disambiguation.
10. **`revealOdds` hides odds from the roster only**; file readability is governed by existing document-store policy, documented as a caveat rather than new machinery.
11. **`persist`/ratcheting deferred to v2**, with the schema tolerating the key today.
12. **Roster is resolved per call, never cached across turns.** New chats get the full roster on turn one with no initialization step; mid-chat definition changes take effect on the next LLM call and the next popup open. Mount-index invalidation was rejected because document edits inside a mount don't reliably touch the index; per-call listing is cheap enough.
13. **Character metadata is a fourth test subject** (added post-ship; full design in [character `metadata.json`](complete/character-metadata-json.md)): same comparators and `$param` operands as `params`, shape-only load-time validation, fail-soft run-time misses (absent/non-primitive/mistyped keys decline the row, never throw), a `{{metadata.<key>}}` template family, `pascalMeta.metadataTested` in the roll record, and a roster that says only that the sheet *may* be consulted — never which keys or values exist.
14. **The LLM consult is a fifth test subject, and its failure is an outcome, not an error** (added post-ship; see [The `llm` consult](#the-llm-consult)). The author supplies the failure's words (`errorMessage`, required), the run never fails because the oracle went quiet, and the technical reason stays out of the fiction. The provider call arrives through an injected `llmInvoke` seam so the core stays testable and the audit stays free; answer comparisons are deliberately forgiving (trim, case-insensitive eq, numeric coercion for ordering) because the subject is a model's prose, not a declared value.
15. **`contains`/`ncontains` are substring comparators, not a grammar** (added post-ship; see [Containment](#when--comparators-not-expressions)). Two more AND-composed keys rather than any pattern language: no regex, no globs, nothing to parse or inject. Per-context strictness follows each subject's `eq` precedent — exact and case-sensitive on `params`/`metadata`, trimmed case-insensitive on `llm` — and the operand is a non-empty string literal or a `$param` to a string parameter, so an outcome can ask whether one input appears inside another (or inside the consult's answer).
