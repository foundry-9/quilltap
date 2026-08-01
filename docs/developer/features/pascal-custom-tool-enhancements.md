# Feature: Custom Tool Enhancements — chip labels, paragraph breaks, side effects

Status: **planned**. Extends [pascal-custom-tools.md](./pascal-custom-tools.md); read that first — this document only describes the deltas.

## Motivation

Three improvements to Pascal's table, prompted by real use:

1. **Renamable chips.** The Salon chip (and announcement header) labels every `custom-tool-result` with the tool's static title. A tool that does many different things per run — an agent dispatcher, a generator — wants a per-run label ("Agent lambda — Jackie", not just "Agent lambda"), and the natural author of that label is often the model itself, prompted by the tool.
2. **Markdown breakage in the bubble.** `buildPascalResultContent` ([lib/services/pascal/writer.ts:72](../../../lib/services/pascal/writer.ts)) emits `🎲 **Title** — message` as a single Markdown line. An outcome message that begins with a block token (`- `, `#`, `1.`, `>`, a fence) is no longer at the start of a line, so it renders as inline text glued to the bold title: `**Agent lambda** — - Jackie (3 nodes)`.
3. **Side effects.** Tools can *read* tiered state (`$state`, `{{state.path}}`) and character metadata, but nothing a roll concludes can be written back. Authors want a roll to record consequences — increment a counter, mark a flag, note a fact on the rolling character's sheet — without asking the model to make a separate, fudgeable `state` call. This ships the schema room reserved as `persist` in "Deferred to v2".

## Doctrine changes (read first)

### Expression evaluation arrives, narrowly

The definition-schema header ([lib/pascal/custom-tool.types.ts:12-16](../../../lib/pascal/custom-tool.types.ts)) and the Security constraints section of the parent spec both state the v1 doctrine: **no expression evaluation, anywhere** — comparator objects and two closed reference forms, "no string grammar to parse, so there is nothing to inject into."

This feature amends that doctrine deliberately and narrowly:

- Outcome tests **remain** comparator objects. Nothing changes about `when`.
- The **one** place a string grammar exists is an effect's `value`, evaluated by a closed, eval-free parser (`lib/pascal/expressions.ts`, new): arithmetic, string concatenation, parentheses, literals, and `{{ref}}` substitution. There are **no identifiers, no function calls, no member access** — the only names the grammar admits are the same `{{...}}` reference families `renderTemplate` already substitutes. The injection-surface argument survives: there is still nothing callable and nothing reachable beyond the run's own subjects.

Both doctrine texts (the module header and the parent spec's Security constraints) must be rewritten to this form when this feature lands — amended, not deleted.

### `persist` ships as `effects`

The parent spec's "Deferred to v2" section reserved `persist`; this feature implements it under the name `effects` (a better fit — the array describes consequences, not storage). Update that section, and the corresponding "persist stays deferred" notes in [state-cascade.md](./state-cascade.md).

### Reference syntax is `{{...}}`

Everywhere in this feature — chip labels and effect expressions — references use **double braces**, exactly the outcome-message template vocabulary (`{{value}}`, `{{roll}}`, `{{dice}}`, `{{params.x}}`, `{{metadata.x}}`, `{{state.path}}`, `{{llm}}`). One vocabulary, one scanner (`collectPlaceholders`), no single-brace variant.

---

## F1 — `chipLabel`: a templated per-run label

### Schema

New optional top-level field on `QtapCustomToolSchema` ([custom-tool.types.ts:551](../../../lib/pascal/custom-tool.types.ts), after `title`):

```ts
export const MAX_CHIP_LABEL_LENGTH = 160; // template text cap; UI truncates the rendered result via CSS

chipLabel: z.string().min(1).max(MAX_CHIP_LABEL_LENGTH).optional()
  .describe('Templated label for the outcome chip and the announcement header. Same placeholders as an outcome message. Rendered after the outcome is chosen. Blank/absent = the title labels the chip.'),
```

- Add `'chipLabel'` to `KNOWN_TOP_LEVEL_KEYS` (:965).
- Mirror in [public/schemas/qtap-custom-tool.schema.json](../../../public/schemas/qtap-custom-tool.schema.json); extend the agreement-test corpus (`__tests__/unit/lib/pascal/custom-tool-definition.test.ts`).
- No new load-time reference rule — unknown placeholders stay verbatim at run time (the `renderTemplate` doctrine); the Workbench adds a *warning* pass only.

### Rendering — once, in the core

`executeCustomTool` ([custom-tools.ts:1233](../../../lib/pascal/custom-tools.ts)) renders `chipLabel` via `renderTemplate` (:1105) **after** outcome selection, with the same subjects as the outcome message, and returns it on `CustomToolRunResult` as `chipLabel?: string`. Both entrances copy `result.chipLabel` — one render site, no drift. `simulateOutcomes` ignores it (labels contribute nothing to hit rates).

### Carriage — `pascalMeta.chipLabel`

`pascalMeta` is a JSON TEXT column, so **no migration**. Keep the two schemas in lockstep:

- [lib/schemas/chat.types.ts:365](../../../lib/schemas/chat.types.ts) — `chipLabel: z.string().optional()`, doc-comment: rendered at roll time; absent on older rows; readers fall back to `toolTitle`, then `tool`.
- [lib/database/repositories/chats-messages.ops.ts:120](../../../lib/database/repositories/chats-messages.ops.ts) — same field.

Both pascalMeta writer sites set it (spread only when present):

- LLM entrance: [lib/tools/handlers/run-custom-handler.ts](../../../lib/tools/handlers/run-custom-handler.ts) (~:232).
- Manual route: [app/api/v1/chats/[id]/custom-tools/route.ts](../../../app/api/v1/chats/[id]/custom-tools/route.ts) (~:516).

Also: `public/schemas/qtap-export.schema.json` (`pascalMeta.properties`) and the pascalMeta prose in [DDL.md](../DDL.md) (~:723).

### Display

`getSystemKindDisplayLabel` ([system-message-labels.ts:163](../../../app/salon/%5Bid%5D/components/system-message-labels.ts)) precedence becomes:

```ts
const named = message.pascalMeta?.chipLabel?.trim()
  || message.pascalMeta?.toolTitle?.trim()
  || message.pascalMeta?.tool?.trim()
```

falling through to the static `'roll outcome'` override as today. Update the co-located test. Existing `.qt-chat-system-bar-kind` ellipsis/`max-width` CSS handles long rendered labels — no CSS change.

### Workbench

- **BuilderForm** identity card ("The contrivance itself"): a "Chip label" text input between Title and Name, hint naming the placeholder families and the fallback.
- **tool-draft.ts**: `ToolDraft.chipLabel: string` (empty = omitted); round-trip in `draftFromDefinition`/`definitionFromDraft`; `'chipLabel'` in `KNOWN_KEY_ORDER` after `'title'`; `validateDraft` adds a length error plus the placeholder-warning walk (`{{llm}}` is legal here iff the tool has an `llm` block — warning only).
- **tool-vocabulary.ts**: `collectToolVocabulary` scans `definition.chipLabel` with `collectPlaceholders` (one line beside the `llm.prompt` scan).

### Not exposed to the model

`chipLabel` never reaches the `run_custom` input schema or roster description — same stance as `title` (custom-tool.types.ts:608). **To have the LLM name the chip**, the author declares a string parameter whose `description` prompts the model, then templates it:

```json
{
  "parameters": {
    "label": { "type": "string", "default": "", "description": "A short human label for this run — who or what it concerns." }
  },
  "chipLabel": "Agent lambda — {{params.label}}"
}
```

No snapshot-test change from F1 alone.

## F2 — Paragraph break between title and output

`buildPascalResultContent` ([writer.ts:69-75](../../../lib/services/pascal/writer.ts)) changes from a one-liner to a heading paragraph:

```ts
export interface BuildPascalResultContentParams {
  toolTitle: string;
  /** Rendered chipLabel, when the definition declares one — the header uses it, same string as the chip. */
  chipLabel?: string;
  message: string;
}

const heading = params.chipLabel?.trim() || params.toolTitle;
const body = `🎲 **${heading}**\n\n${params.message.trim()}`;
```

- The blank line makes the message its own Markdown block, so a leading `- `/`#`/`1.`/`>`/fence renders correctly.
- **The header line uses the rendered `chipLabel` when present** — one string labels both the chip and the bubble; transcript and chip never disagree.
- `content === opaqueContent` unchanged.

Touch points:

- Both callers pass `chipLabel: result.chipLabel` (run-custom-handler, manual route).
- `__tests__/unit/lib/services/pascal/writer.test.ts` — exact-string assertions become the two-line form; add cases for chipLabel-as-header and for messages beginning with `- ` / `#`.
- **ProvingBench** `MiniPascalBubble` ([ProvingBench.tsx:584-586](../../../components/custom-tools/ProvingBench.tsx)) carries an independent copy of the concatenation — replace with a header `<p>` plus a separate message block, using `roll.chipLabel ?? title`.
- Parent spec: the canonical bubble example (~:298) and the "`🎲 **Title** —` prefix is a label, not a voice" paragraph (~:308).
- **Persisted messages are frozen at post time** — old one-line bubbles remain one-liners, and that is correct (same doctrine as title edits).
- `packages/theme-storybook`'s Pascal chat story shows the old form; updating it triggers the package version-bump/publish hard-stop — **deferred to the next storybook release**, noted here so it isn't lost.

## F3 — Side effects (`effects`)

A tool may declare a tool-level list of writes that apply after a run: into **tiered persistent state** (at the tier where the key already lives) or into the **rolling character's metadata** (their fact sheet). Effects are computed in the pure core, applied by the entrances, and shown as a dry run in the Workbench.

### 3.1 Expression module — new `lib/pascal/expressions.ts`

Pure and client-safe (the Workbench imports it). No `eval`, no `Function`, no identifiers, no calls.

Grammar (EBNF-ish):

```
expression = term { ("+" | "-") term } ;
term       = factor { ("*" | "/") factor } ;
factor     = number | string | boolean | ref | "(" expression ")" | "-" factor ;
number     = digits [ "." digits ] ;
string     = "'" chars "'" | '"' chars '"' ;          (* \' and \" escapes *)
boolean    = "true" | "false" ;
ref        = "{{" refname "}}" ;
refname    = "value" | "roll" | "dice" | "llm"
           | "params." identifier | "metadata." key | "state." path ;
```

Bounds: source ≤ `MAX_EFFECT_EXPRESSION_LENGTH` (500), ≤ 64 tokens, parenthesis depth ≤ 8.

API:

```ts
export type ExprValue = number | string | boolean;
export function parseExpression(source: string):
  { ok: true; expr: ParsedExpression /* carries refs: string[] */ } | { ok: false; reason: string };
export function evaluateExpression(expr: ParsedExpression,
  resolveRef: (refname: string) => ExprValue | undefined):
  { ok: true; value: ExprValue } | { ok: false; reason: string };
```

Type rules (normative):

- `number op number` → arithmetic. Any non-finite result — including division by zero — is an eval failure.
- `+` with at least one string operand → concatenation. Numbers stringify via `formatValue` (integers plain, floats to 4 significant digits — the template convention); booleans via `String()`.
- `-`, `*`, `/` with any non-number operand → eval failure.
- Booleans participate only in concatenation (as `"true"`/`"false"`); no truthiness arithmetic.
- A `resolveRef` returning `undefined` (absent metadata key, non-primitive state value, no consult) → eval failure.
- `{{dice}}` and `{{llm}}` are **strings**: `'rolled ' + {{dice}}` works; `{{llm}} * 2` fails soft. LLM output is **never** numerically coerced — authors who want numbers route through outcomes/comparators.

Failure semantics: **eval failure at run time = that effect is skipped, fail-soft, with a debug log** (the `renderTemplate` doctrine — a broken effect never sinks a roll). **Parse failure = load-time rejection** (the dice-notation doctrine — syntax errors are typos, caught in the Workbench and at discovery).

### 3.2 Definition schema

```ts
export const MAX_EFFECTS = 16;
export const MAX_EFFECT_EXPRESSION_LENGTH = 500;
export const MAX_EFFECT_TARGET_LENGTH = 200;

export const CustomToolEffectSchema = z.strictObject({
  when: EffectWhenSchema.optional(),   // omitted = fires on every run
  target: z.string().min(1).max(MAX_EFFECT_TARGET_LENGTH),
  value: z.union([
    z.number().finite(),
    z.boolean(),
    z.string().min(1).max(MAX_EFFECT_EXPRESSION_LENGTH),
  ]),
});

// On QtapCustomToolSchema, after `llm`, before `outcomes`:
effects: z.array(CustomToolEffectSchema).max(MAX_EFFECTS).optional()
```

**`EffectWhenSchema`** is the outcome-row `when` comparator language **plus** one new subject — the winning outcome:

```ts
outcome: z.strictObject({
  eq: OutcomeStateSchema.optional(),    // 'success' | 'partial' | 'failure' | 'info'
  neq: OutcomeStateSchema.optional(),
}).optional()
```

It is a **separate schema**, not a widened `WhenObjectSchema` — an `outcome` subject inside an outcome row would be a self-referential dead branch, and `matchesWhen` stays untouched.

**`value` discrimination — the one ergonomic trap.** A JSON number or boolean is a literal, stored as-is. A JSON **string is always an expression** — so literal prose must be quoted *inside* the expression:

```json
{ "target": "metadata.lockpick", "value": "'broken pick'" }     ✓
{ "target": "metadata.lockpick", "value": "broken pick" }        ✗ load-time parse error (two bare words)
```

The help doc and the Workbench hint must show the quoted form prominently.

**Target syntax** — shared parser `parseEffectTarget` (in `custom-tool.types.ts`, used by validation, the applier, and the Workbench):

- `state.<path>` — remainder parsed by `parsePath` from [lib/state/state-paths.ts](../../../lib/state/state-paths.ts). Empty path, or a **first segment starting with `_`**, is rejected: the underscore guard from the `state` tool ([state-handler.ts:175](../../../lib/tools/handlers/state-handler.ts)) — those keys are user-only and no AI-adjacent path may write them. Enforced at load time *and* re-checked at apply time.
- `metadata.<key>` — remainder taken **whole** as the key (user vocabulary; dots inside the key are fine precisely because it is not path-parsed).
- Anything else → rejected ("target must start with `state.` or `metadata.`").

**Load-time validation** (extend the existing `superRefine` with `validateEffects`): target parses (incl. underscore guard); string `value` parses via `parseExpression`; every `params.x` ref names a declared parameter; a `{{llm}}` ref or an `llm` `when`-subject requires an `llm` block (same rule as outcomes); `when` comparators validated by the same walk `validateReferences` uses for outcome rows (factor that walk into a shared helper). `formatDefinitionIssues` renders the new issues with `effects.N.…` paths — no changes needed there beyond test coverage.

Bookkeeping: `'effects'` into `KNOWN_TOP_LEVEL_KEYS`; `$defs/Effect` + `$defs/EffectWhen` in the published JSON Schema (the expression grammar is a `description`, not schema-checkable — an accepted divergence to assert in the agreement test).

### 3.3 Execution core (pure — still writes nothing)

In `executeCustomTool`, after the outcome is chosen and its message rendered:

- Extend the subjects with `outcome: { state, index }` (for effect evaluation only).
- New `matchesEffectWhen(when, subjects, toolName)` — delegates the shared subjects to the existing comparator chain, adds the `outcome.eq/neq` test.
- For each effect: evaluate `when` (declined → skipped with reason), then resolve `value` (literal passthrough, or `evaluateExpression` with a `resolveRef` mirroring `renderTemplate`'s lookups).
- Return on `CustomToolRunResult`:

```ts
export type ResolvedEffect =
  | { index: number; target: EffectTarget; value: ExprValue }   // would apply
  | { index: number; skipped: string };                          // reason: condition/eval failure

effects?: ResolvedEffect[];
chipLabel?: string;   // F1
```

The module's "no writes, no message posting" header stays true. `simulateOutcomes` does **not** evaluate effects.

### 3.4 Applier — new `lib/pascal/side-effects.ts`

```ts
export interface AppliedEffect {
  target: string; previous?: unknown; next: unknown;
  tier?: 'chat' | 'project' | 'group' | 'general';   // state targets only
}
export async function applyCustomToolEffects(params: {
  chatId: string; toolName: string;
  effects: ResolvedEffect[];
  cascade: StateCascadeResult | null;    // read once at run start; null → state effects skip
  characterId: string | null;            // rolling character; null → metadata effects skip
  metadataSnapshot: Record<string, unknown>;   // hydrated at run start (RMW base)
}): Promise<AppliedEffect[]>
```

Behavior (normative):

1. **State tier resolution — "write where it lives."** For each state effect, find the tier whose *top-level* first path segment already exists, searching in cascade-precedence order **chat → project → group → general** — the project tier only when the cascade has a `projectId`, the group tier **only when `groupTier.status === 'single'`** (the exactly-one rule, [state-cascade.ts](../../../lib/state/state-cascade.ts)). Found nowhere → **default to the chat tier** (most local, least blast radius).
2. **Batched writes — one per touched store.** Accumulate all state effects into local copies of the cascade's per-tier objects using `setAtPath`, then issue at most one `repos.chats.update(chatId, {state})`, one `repos.projects.update(projectId, {state})`, one `repos.groups.update(appliedGroupId, {state})`, one `writeGeneralState(state)`. Sequential effects in one run see each other's values **via the local copies** — deterministic in-run ordering, never a store re-read.
3. **Job-child safe.** Every write goes through the buffered `getRepositories()` proxy; the cascade and metadata snapshot are read once at run start and never re-read — no read-your-writes anywhere ([BACKGROUND_JOBS_CHILD.md](../BACKGROUND_JOBS_CHILD.md) contract).
4. **Underscore guard re-checked** at apply time (defense in depth); violation → skip + warn.
5. **Metadata effects** apply only when `characterId` is non-null: shallow key-set on the snapshot, then one `repos.characters.update(characterId, { metadata: next })` — the vault overlay's whole-object replace ([managed-fields.ts:441](../../../lib/database/repositories/vault-overlay/managed-fields.ts)) is exactly this read-modify-write contract. No character → skip fail-soft.
6. **Never throws.** Each store write is individually try/caught (this covers `CharacterVaultUnavailableError` when a vault disappears mid-run); failures log `warn` and drop those effects from the applied list. The roll already happened; Pascal still announces.
7. Returns the applied list for `pascalMeta.effects`.

### 3.5 Entrances

Both entrances restructure their cascade block to retain the **whole** `StateCascadeResult` (today they keep only `.merged`), still passing `cascade?.merged ?? {}` into `executeCustomTool` as the read-side `state`.

- **LLM entrance** (`run-custom-handler.ts`, ~:172-191): after a successful `executeCustomTool` and **before** `postPascalResult`, call `applyCustomToolEffects({...})` with the rolling character's id and the metadata already hydrated at :124. Record `...(applied.length ? { effects: applied } : {})` (and F1's `chipLabel`) in `pascalMeta`.
- **Manual route** (`chats/[id]/custom-tools/route.ts`, ~:448-464): identical, with one deliberate asymmetry — `characterId` follows the existing metadata rule (:441): **only when `body.asCharacterId` was given.** A run nobody made writes to nobody's sheet; an unattributed operator roll must not edit an arbitrary character. Comment it beside the existing comment.

Ordering/failure semantics: **effects apply before the Pascal post; if the post then fails, the effects stand** (they happened — the existing "outcome could not be posted" failure path still tells the model). A throw inside `executeCustomTool` means **no** effects were applied.

**Workbench preview/audit never applies.** `handlePreview` in [app/api/v1/custom-tools/route.ts](../../../app/api/v1/custom-tools/route.ts) already spreads `...result`, so `effects` (resolved, dry) and `chipLabel` ride out with no route change; `handleAudit` ignores them.

### 3.6 pascalMeta, export, DDL

Both pascalMeta schemas (chat.types.ts + chats-messages.ops.ts) gain:

```ts
effects: z.array(z.object({
  target: z.string(),
  previous: z.unknown().optional(),
  next: z.unknown(),
  tier: z.enum(['chat', 'project', 'group', 'general']).optional(),
})).optional(),
```

Plus `qtap-export.schema.json` (pascalMeta properties) and the DDL.md prose. **The Salon body shows nothing new** — the bubble stays the author's message; `pascalMeta` carries the audit (a future inspector can surface it).

### 3.7 LLM roster description

[lib/tools/run-custom-tool.ts](../../../lib/tools/run-custom-tool.ts):

- One sentence in `RUN_CUSTOM_PREAMBLE`: some tools record side effects when they run — adjusting the scene's persistent state or the rolling character's own records, server-side, as part of the roll.
- Per tool in `buildRunCustomDescription`, when `revealOdds !== false` and `effects` is present: one line, **targets only** (vocabulary, not values or conditions): `    Side effects: writes state.encounter.count, metadata.ansibleTool`. Under `revealOdds: false`, nothing beyond the preamble sentence — the odds stay hidden, and so do the consequences; the *human* popup still sees the targets via the vocabulary (consistent with the definition being the user's own file).
- The preamble change alters `runCustomToolDefinition.description` → update the snapshot (`npx jest lib/tools/__tests__/tool-definitions-snapshot.test.ts -u`; the diff must be description text only) and accept the one-time provider prompt-cache bust (roster-change precedent).

### 3.8 Vocabulary

[lib/pascal/tool-vocabulary.ts](../../../lib/pascal/tool-vocabulary.ts):

- Scan effect `value` expression strings (and `chipLabel`) with `collectPlaceholders` — the `{{...}}` pattern matches expression refs verbatim.
- Walk effect `when.metadata` keys into `found.metadata` like the outcome loop.
- **New fields** `stateWrites: string[]` and `metadataWrites: string[]` on `ToolVocabulary` — writes are a different claim than reads. Update `isEmptyVocabulary`; the roster GET payload change is additive. The popup component rendering `references` (`components/chat/CustomToolsDropdown.tsx`) gains a "may write" line.

### 3.9 Workbench

- **tool-draft.ts** — `ToolDraft.effects: DraftEffect[]`:

  ```ts
  interface DraftEffect {
    id: string;
    when: { kind: 'always' }
        | { kind: 'outcome-state'; state: OutcomeState }        // → when.outcome.eq
        | { kind: 'verbatim'; when: EffectWhen };               // hand-written richer condition
    target: string;                                              // 'state.…' / 'metadata.…' verbatim
    valueKind: 'literal-number' | 'literal-boolean' | 'expression';
    value: string;
  }
  ```

  The form authors only the common `when` shapes (Always / on a given outcome state); a hand-written richer `when` is **carried verbatim with a read-only badge** — the established `$state`-default precedent in the builder. Round-trip in `draftFromDefinition`/`definitionFromDraft`; `'effects'` in `KNOWN_KEY_ORDER` after `'llm'`, before `'outcomes'`. `validateDraft`: target parses (+ underscore guard), expression parses, `params.x` declared, `{{llm}}`/llm-when needs the oracle enabled, ≤ `MAX_EFFECTS`; new `DraftIssue.where` variant `{ section: 'effect'; id }`.

- **New `components/custom-tools/SideEffectsSection.tsx`**, rendered in `WorkbenchEditor.tsx` **between `<BuilderForm>` and `<OutcomesSection>`** — the section sits just before the outcome table. Rows: When select, Target input (with a `state.` / `metadata.` prefix affordance), Value input (literal/expression toggle), add/remove/error affordances copied from the Parameters card.

- **ProvingBench** — test rolls show the dry run in `MiniPascalBubble`:

  ```
  → state.encounter.count = 3   (would write)
  · effect 2 skipped: condition did not hold
  ```

  Copy emphasizes: **the bench computes, never applies.**

## Documented behaviors and accepted risks

- **Ambiguous group scope.** With 2+ applicable groups the cascade's group tier contributes nothing (exactly-one rule), so a key living only in group state is invisible to the tier search and the effect **shadows it at the chat tier**. Consistent with the read-side rule; documented, not "fixed". Manual runs without `asCharacterId` resolve `{kind:'none'}` scope — group keys are never found there.
- **Read-modify-write races.** State tiers and character metadata are whole-object replaces; an effect applying concurrently with a same-turn `state` tool call can lose one side. Pre-existing accepted risk (state-cascade.md "Known risks"), now likelier within a single turn. Re-reading just before write is intentionally rejected — it would violate the job child's no-read-your-writes contract.
- **Old messages stay one-line.** `content` is frozen at post time; F2 does not retroactively reformat.
- **Strings are expressions.** The `"value": "broken pick"` trap fails loudly at load time; docs and hints show `"'broken pick'"`.

## New modules

| Module | Purpose |
|---|---|
| `lib/pascal/expressions.ts` | Closed expression tokenizer/parser/evaluator |
| `lib/pascal/side-effects.ts` | `applyCustomToolEffects` — tier resolution, batching, RMW |
| `components/custom-tools/SideEffectsSection.tsx` | Workbench "Side effects" card |

## Engineering tasks (phased; each phase compiles and tests green)

1. **Evaluator** — `lib/pascal/expressions.ts` + `__tests__/unit/lib/pascal/expressions.test.ts` (precedence, parens, coercions, ÷0, bounds, bad refs).
2. **Schema** — `custom-tool.types.ts` (`chipLabel`, `effects`, `EffectWhenSchema`, `parseEffectTarget`, `validateEffects`, caps, `KNOWN_TOP_LEVEL_KEYS`) + published JSON Schema + agreement-test corpus.
3. **Core** — `matchesEffectWhen`, resolved-effects computation, chipLabel render, `CustomToolRunResult` extension + execution tests.
4. **Applier** — `lib/pascal/side-effects.ts` + tests (tier matrix incl. ambiguous-group and default-chat, batching, underscore guard, per-store fail-soft incl. vault-gone, metadata RMW, no-character skip).
5. **Entrances + writer** — run-custom-handler, manual route, `writer.ts` (F2 + chipLabel header), both pascalMeta schemas, export schema, DDL.md; `writer.test.ts`.
6. **Salon** — `getSystemKindDisplayLabel` precedence + co-located test.
7. **Roster + vocabulary** — preamble/description lines + snapshot `-u`; `tool-vocabulary.ts` (+`stateWrites`/`metadataWrites`) + test; dropdown "may write" line.
8. **Workbench** — tool-draft round-trip + validation; BuilderForm chip-label field; `SideEffectsSection`; ProvingBench (two-line bubble + dry-run block); draft tests.
9. **Docs** — `pascal-custom-tools.md` (doctrine rewrite, bubble example, Deferred-to-v2), `state-cascade.md` persist notes, `help/custom-tools.md` (chipLabel, effects, the quoting trap, `{{...}}` standardization), `help/chat-state.md` (tools may now write state; `_` keys stay user-only), `docs/CHANGELOG.md`.

## Verification

- `npx tsc`; `npm run lint`.
- `npx jest __tests__/unit/lib/pascal __tests__/unit/lib/services/pascal lib/tools/__tests__` plus the co-located `system-message-labels.test.ts` (snapshot `-u` once; diff must be description text only).
- Live, against a dev instance: author a `.tool.json` with `chipLabel` (templated off an LLM-prompted param) and an `effects` array writing one existing project-tier state key (must land at project), one fresh key (must land at chat), and one `metadata.` key. Run it via `run_custom`, via the composer popup with and without `asCharacterId` (metadata write must skip without), and via the Proving Bench (dry-run only — verify nothing persisted). Confirm the two-line bubble renders a leading-list-item message correctly, the chip shows the rendered label, `pascalMeta.effects` survives a `.qtap` export, and an autonomous-room (job-child) run buffers its writes through the parent.
