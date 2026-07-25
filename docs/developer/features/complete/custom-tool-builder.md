# Custom Tool Builder — Pascal's Workbench

**Status:** Implemented (shipped).
**Parent feature:** [pascal-custom-tools.md](../pascal-custom-tools.md) (shipped). This spec fills the item that spec deferred: *"a form-based editor could come later."* It is now coming.
**Post-ship addition — the `llm` consult (not re-specced here; see the parent spec's "The `llm` consult"):** the Workbench gained a "consulted oracle" form section (`llmEnabled`/`llmPrompt`/`llmErrorMessage`/`llmMaxOutput` on `ToolDraft`, prompt-placeholder validation, prompt and error line required while enabled, the answer cap optional — blank means the 8,000-char default, bounded by `MAX_LLM_OUTPUT_CEILING`), two condition-chip subject kinds (`llm` — the answer, all six comparators, metadata-style fail-soft typing; `llm-ok` — success, eq/neq against a boolean, serialized to the comparator's single `ok` key), `{{llm}}` in the message insert menu, an oracle card on the proving bench (scripted answer / silence / live single-roll consult; the audit never calls live and holds one simulated answer fixed across all draws via `simulateOutcomes`' fifth argument), consult details on the mini-bubble debug line, and an "oracle" library badge.
**Intended implementer:** an agent with this document, the parent spec, and the codebase. Everything here was verified against the code as of commit `8e4b00d4`; the character-metadata subject (§4.4.1) was added after the `metadata.json` feature shipped (`8bc43333`, spec: [character-metadata-json.md](complete/character-metadata-json.md)) and verified against `WhenObjectSchema` / `MetadataComparatorSchema` / `MetadataKeySchema` in `lib/pascal/custom-tool.types.ts`.

---

## 1. Problem

Custom tools are hand-authored `Tools/*.tool.json` files. The format is deliberately strict (nested `strictObject`s, typed comparators, a mandatory trailing catch-all, `$param` reference rules), which makes hand-authoring unforgiving: one misspelled comparator and the tool silently drops out of the roster with only an error badge to explain. There is no UI to create one, no UI to see the full library across stores, and no way to test a definition without running it in a live chat.

The Builder is a visual editor that:

1. **Reads** any existing definition that matches (or fails) `QtapCustomToolSchema`, including gracefully degrading to a raw-JSON repair mode for files the form cannot represent.
2. **Writes** only schema-valid output — validity is guaranteed *by construction* in form mode and *by gate* in JSON mode, both against the same Zod schema that the roster loader uses (single source of truth, no drift possible).
3. **Saves anywhere a tool can live**: the General store, project-linked stores, group official/linked stores, and character vaults (database-backed), plus unattached stores.
4. Makes the **cascading outcome table** (ordered, first-match-wins, AND-composed comparators over value / raw roll / params / character metadata) editable without knowing the JSON grammar.
5. Makes **value insertion** trivial: `{{value}} / {{roll}} / {{dice}} / {{params.x}}` placeholders in messages via an insert menu, and literal-vs-`{ "$param": … }` toggles on every numeric field that accepts a reference (roll fields and comparator operands).
6. Provides a **test bench**: single dry-run rolls and a Monte Carlo table audit, executed server-side through the very same `executeCustomTool` core that live chats use.

### Non-goals (v1 of the Builder)

- No editing of v2 keys (`persist` etc.) — but they **must round-trip untouched** (§6.3).
- No dice-notation `$param` interpolation (not in the format).
- No multi-file operations (bulk move/copy between stores) beyond single-file save/rename/delete.
- No change to the definition format itself. The Builder consumes the format as-is. If implementation reveals a format gap, stop and ask — do not extend the schema unilaterally.
- No mobile-first layout heroics; the Builder targets the desktop workspace like the character editor does.

---

## 2. Naming, placement, entry points

### 2.1 Name and voice

Feature name: **Pascal's Workbench** (Pascal already owns custom tools; the settings copy calls them "contrivances" and says he "lays them upon the baize"). All user-facing copy is in the house voice (steampunk / Wodehouse / Gatsby). Suggested vocabulary the copywriter should riff on: *contrivance* (a tool), *the baize / the table* (the roster), *the workbench* (the editor), *the proving bench* (test panel), *the audit* (Monte Carlo). Technical identifiers stay plain English (`custom-tools`, `tool-builder`) — voice belongs in labels, not code.

### 2.2 Placement

A **new top-level workspace surface**, not a settings panel — it is an editor with unsaved state, like the character editor, and needs room.

- Route: **`/custom-tools`** (list) and deep-linkable builder state via query: `/custom-tools?mount=<mountPointId>&path=Tools/<file>` (edit) and `/custom-tools?new=1&mount=<id>` (create, destination preselected). App Router, `app/custom-tools/`. Remember Next 16: `searchParams` is a Promise.
- Workspace tab kind: add **`'custom-tools'`** to `TabKind` in `lib/workspace/types.ts`, with payload `{ mountPointId?: string; path?: string }` (absent = library view). Update every place the kind universe lives: `TAB_KINDS` in `lib/workspace/workspace-persistence.ts`, `defaultTabMeta` in `lib/workspace/tab-meta.ts` (title "Pascal's Workbench", pick an icon from the themeable icon set — a wrench/gear/card-suit mark; if none fits, follow the themeable-icons process to add one), `tabIdentity` handling in `workspace-reducer.ts` if payload-keyed identity is wanted (it is: one tab per open definition, like `character-edit`).
- Inside a workspace tab, drill-down from library → editor renders **in place** (keep-alive rule — never `router.push` from within a tab; see `ProsperoView`'s `useWorkspaceTabId()` pattern).

### 2.3 Entry points

1. **Settings → Chat → Custom tools** (`CustomToolsSettings.tsx`): under the existing enable toggle, add a link/button "Open Pascal's Workbench" that opens the `custom-tools` tab. Visible even when the toggle is off (authoring while disabled is legitimate).
2. **Composer popup** (`components/chat/CustomToolsDropdown.tsx`): a footer row "New contrivance…" opening the builder in create mode, and a small edit affordance per listed tool. The roster payload already carries `definitionPath` and the popup knows the mount — verify the GET response includes `mountPointId` (the parent spec says `definitionPath` + `mountName`; if `mountPointId` is absent from the payload, add it — it is not odds information). Error badges in the popup likewise link to the builder, which is exactly where you fix a broken file.
3. **Scriptorium file table** (`app/scriptorium/[id]/components/FileTable.tsx`): rows whose path matches root-level `Tools/*.tool.json` get an "Open in Pascal's Workbench" action.
4. **Left rail / navigation**: wherever top-level surfaces are registered (home dashboard tiles, rail), add the entry following how `scenarios`/`photos` surfaces are registered. Follow the existing pattern; do not invent a new nav mechanism.

---

## 3. The Library view (`/custom-tools`)

The landing surface: **every definition in every enabled store**, valid or not. This is deliberately different from the chat roster (which applies per-invoker shadowing and hides broken files behind badges) — the Workbench is the authoring surface, so it shows the whole table, face up.

Each row/card shows:

- **Title** (`displayTitle(definition)` — import from `lib/pascal/custom-tool.types.ts`, never re-derive) and `name` beneath in monospace.
- **Where it lives**: store name + an attachment badge showing what that store is (General / project *P* / group *G* / character *C*'s vault / unattached). One store can carry several badges.
- **State chips**: `disabled` (tombstone), `whisper` default, dice vs. range, parameter count, outcome count.
- **Invalid** rows render prominently with the loader's own reason string (`formatDefinitionIssues` output, verbatim — do not paraphrase it) and open straight into JSON repair mode (§6.4).
- **Shadowing advisory**: when the same `name` exists in more than one store, group or badge those rows ("this name is defined in 3 places") with a hover explaining tier precedence: character → participant → group → project → global, nearest wins, `disabled` tombstones suppress outward. Precedence order comes from `TIER_ORDER` in `lib/pascal/custom-tools.ts` — but note the library is chat-independent, so it cannot say which definition *wins* in general (that depends on invoker); it only flags the collision.

Actions: **New contrivance** (opens builder with destination picker), open/edit, duplicate (opens builder in create mode pre-filled, forcing a save-as), delete (confirm dialog; DELETE via the mount-points file route), and a plain "reveal in Scriptorium" link per row.

Sort: by title; secondary group-by-store toggle. Search filter over name/title/description. With ≤64 tools per roster and realistically dozens total, no pagination.

---

## 4. The Builder view

A single-definition editor. Layout: a main **form column** and a right-hand **proving bench** panel (test + audit + live JSON preview), collapsible. Header carries: title being edited, source store + path (or "unsaved"), dirty indicator, **Save / Save As…**, and the **Form ⇄ JSON** mode switch.

All form controls use existing `qt-*` semantic classes (`qt-input`, `qt-select`, `qt-checkbox`, `qt-btn-*`, `qt-card`, etc. — survey what the character editor uses and match). If a needed style has no `qt-*` class, add one rather than raw Tailwind (CLAUDE.md rule).

### 4.1 Identity section

- **Title** (optional, ≤80): free text. Placeholder shows the derived title (live `displayTitle` of the current `name`) so the user sees what omitting it yields.
- **Name** (required): identifier field enforcing `IDENTIFIER_PATTERN` (`/^[a-z][a-z0-9_-]{0,63}$/`) as-you-type (lowercase coercion, invalid chars rejected with a shake or inline hint, never silently). When creating and Title is filled first, auto-suggest a slug (`Force the Lock` → `force_the_lock`) that stops tracking once hand-edited.
- **Description** (required, ≤500): textarea with counter. Helper text: "What the tool does *in the fiction* — this is how a model decides to reach for it."
- **Options** row: `disabled` checkbox ("tombstone: suppresses this name at this tier and every farther one"), `revealOdds` checkbox (default on; off = "the house does not show the odds — models see only name, description, parameters"), `defaultVisibility` public/whisper toggle.

### 4.1a Availability section — "Who may reach for it" (added 4.8)

`components/custom-tools/GateSection.tsx`, rendered between identity and parameters — the gate is answered before any of the machinery below it, and reads that way.

- A three-way mode radio maps 1:1 onto the format's clauses: **Anyone** (emit neither key), **Only show if…** (`availableWhen`), **Do not show if…** (`withheldWhen`). The format permits at most one clause per file, which is what lets one control represent it; a hand-written file carrying both fails `QtapCustomToolSchema` and lands in repair mode rather than being silently halved.
- Conditions are a thinner chip than the outcome table's: the subject is always a metadata key and the operand is always a literal, because a gate has no parameters or state to reference. eq/neq get the same number/text/true-false type picker a metadata subject gets in the table, for the same reason (the stored type is unknowable at authoring time).
- `draft.gateConditions` survives a mode change, like the roll form's unused half — turning "only if" into "not if" is the commonest edit there is.
- Draft rules live in `validateGate` (`lib/pascal/tool-draft.ts`); the chip ⇄ JSON bijection is `gateConditionsFromGate` / `gateFromConditions`.

### 4.2 Parameters section

Up to `MAX_PARAMETERS` (8) rows, each a card:

- **name** (identifier field, unique within the tool), **type** select (number / integer / string / boolean), **default** (input widget follows type; required — helper: "every parameter needs a default so a bare invocation can still roll"), **description** (optional), **min/max** (numeric types only — the fields are hidden, not merely disabled, for string/boolean; min ≤ max enforced inline).
- Deleting a parameter that is **referenced anywhere** (roll fields, comparator operands, `params` tests, `{{params.x}}` placeholders) shows a blocking confirm listing every reference site; on confirm, the references are *not* silently rewritten — the affected fields flip to their error state so the user resolves each one. Renaming a parameter offers "rename everywhere" which *does* rewrite all references atomically (this is safe; deletion is not).

### 4.3 Roll section

Segmented control: **Range** | **Dice**. Switching forms preserves the other form's last state in memory until save (so an accidental toggle loses nothing), but only the active form is emitted.

**Dice form:** one notation input, validated live with `parseDiceNotation` (client-safe after the §7.1 split). On valid input show a parsed echo: "3 dice, 6 sides, +2 — totals 5–20". On invalid, the parser's constraint text (2–1000 sides, 1–100 dice — use the real constants). Note beneath: "Dice carry their own modifier; the range transform does not apply."

**Range form:** four **NumberOrParam fields** — min, max, multiplier, offset — plus a `round` checkbox. A NumberOrParam field is the reusable control at the heart of this spec:

```
┌──────────────────────────────┐
│ [#] 20            [↔ param]  │   literal mode: numeric input
└──────────────────────────────┘
┌──────────────────────────────┐
│ [⚙ bonus ▾]       [↔ 123]    │   param mode: select over *numeric* declared params
└──────────────────────────────┘
```

Toggle between a literal number and a `{ "$param": "…" }` reference. In param mode the select lists only number/integer parameters (the schema rejects references to string/boolean params in roll fields — the UI simply never offers them). If no numeric parameters exist, the toggle is disabled with a tooltip ("declare a numeric parameter first"). Each field shows its default when empty (min 0, max 1, ×1, +0) and omits defaulted fields from the emitted JSON (§6.2).

Below the fields, a **live range readout**: "Draws uniformly in [min, max), then ×multiplier, then +offset[, then rounds]" with the concrete numbers substituted where literal, and param names where referenced — e.g. *"Draws 0–1, ×20, + `bonus`, rounded."* Recompute on every change; when fully literal, also show the resulting value bounds.

### 4.4 Outcomes section — the cascading table

The core of the feature. An **ordered list** of outcome rows, rendered as a cascade with explicit semantics: a header line reads *"Checked top to bottom — the first row whose every condition holds wins."*

- **Drag-to-reorder** with handles (or up/down buttons — implementer's choice, but keyboard-accessible either way).
- The **final row is the pinned catch-all**: rendered with `when` shown as "otherwise", not draggable, not deletable, its condition not editable — only its state and message are. This makes `validateOutcomeOrdering` unviolatable by construction: the UI can neither move a catch-all up nor leave the tail uncovered.
- **Add outcome** inserts above the catch-all. Cap `MAX_OUTCOMES` (32); the button disables at cap with a count badge.
- Each row: condition builder (below) + **state** select (success / partial / failure / info, each rendered with its qt accent so the palette is visible while choosing) + **message** editor (below).

#### 4.4.1 The condition (`when`) builder

A `when` object is a flat AND of comparators over four subjects. The builder renders it as a list of **condition chips**, joined by an "AND" connective label:

```
value  ≥  15                          [×]
raw roll  ≤  { $param: fumble_under } [×]
bonus  =  true                        [×]
metadata hasAnsibleAccess  =  true    [×]
[+ add condition]
```

One condition = **subject** + **comparator** + **operand**:

- **Subject** select: `Value` (the final, post-transform number), `Raw roll` (pre-transform draw — only meaningfully different in the Range form with a transform; still always offered, with a hint when it currently equals value), one entry per declared parameter (`Parameter: scale`), and `Metadata…`. Choosing `Metadata…` reveals a **free-text key input** beside the select — metadata keys are the *user's* vocabulary, hand-authored in a character's `metadata.json` and declared nowhere the file can see, so there is no list to pick from. Any non-empty string is a valid key (`MetadataKeySchema` — spaces, dots, whatever the author called it); an empty key is the only inline error. A short hint under the input: "the invoking character's fact sheet — a key the character lacks simply doesn't match."
- **Comparator** select: > ≥ < ≤ = ≠. **Filtered by type**: for a string or boolean parameter subject, only = and ≠ are offered (ordering a string is a load-time rejection; the UI never constructs one). **Metadata subjects offer all six** — the stored value's type is unknowable at authoring time, so nothing can be filtered out. A note on the chip when an ordering comparator is chosen: "matches only when the stored value is a number — anything else declines the row at run time, fail-soft, never an error."
- **Operand**: a typed NumberOrParam-style field. For numeric subjects: literal number or numeric-param reference. For = / ≠ on a string param: literal text or any-param reference; boolean param: true/false toggle or reference. Type mismatches (e.g. `=` between a number subject and a string param reference) are prevented by filtering the reference select to type-compatible parameters — mirroring `validateComparator` exactly. **Metadata subjects** follow the parameter grammar (`MetadataComparatorSchema` *is* `ParamComparatorSchema`): ordering comparators take a literal number or a numeric-param reference; = / ≠ take a number, string, or boolean literal — a segmented literal-type picker, since no declared type steers the widget — or a `$param` reference to **any** declared parameter (with the stored value's type unknown, no reference can be ruled incompatible; the only load-time check on a metadata operand is that a referenced parameter exists, per `validateMetadataOperands`).
- Multiple conditions on the **same subject** are legal (`value ≥ 0.3 AND value ≤ 0.6` is a band) and serialize into one comparator object. Two conditions with the same subject *and* same comparator key is impossible JSON (object keys) — the builder blocks adding a duplicate subject+comparator pair with an inline explanation ("a row can test ≥ on the value only once"). For metadata subjects, identity is subject *plus key*: `metadata.strength ≥` and `metadata.cunning ≥` coexist happily; a second `metadata.strength ≥` is blocked.
- Zero conditions is invalid for a non-catch-all row (`must test something`); an empty row renders in error state and blocks save.
- Serialization: subject `Value` → bare comparator keys on the `when` object; `Raw roll` → the `roll` sub-object; parameters → `params.<name>` sub-objects; metadata → `metadata.<key>` sub-objects. Deserialization is the exact inverse. `when: true` never appears in the chip UI — it is exclusively the pinned tail.

#### 4.4.2 The message editor

A textarea (≤1000, counter) with an **Insert value ▾** menu that inserts a placeholder at the cursor:

- **Value** → `{{value}}`
- **Raw roll** → `{{roll}}`
- **Dice breakdown** → `{{dice}}` (offered only in Dice form; if the roll form is later switched to Range, existing `{{dice}}` occurrences get a warning underline — it renders as an empty string there, which is legal but probably unintended)
- **Parameter: x** → `{{params.x}}` per declared parameter
- **Metadata key…** → prompts for a key (free-text, any non-empty string — the same no-declared-list reality as §4.4.1; pre-fill the input with keys already tested in this tool's `when` objects as suggestions, since those are the keys the author demonstrably cares about) and inserts `{{metadata.<key>}}`

Placeholders already present in the text render with a subtle highlight (regex `\{\{[^}]+\}\}`, same as `renderTemplate`'s). An unknown placeholder (typo'd name, deleted param) gets a warning underline and a save-time *warning* (not a block — the runtime leaves unknown placeholders as written, so this is legal, merely suspicious). **The warning logic must never flag `{{metadata.*}}` as unknown**: metadata keys aren't declared in the file, so every `{{metadata.<key>}}` is presumptively legitimate — at run time an absent key (or a non-primitive value) renders the placeholder verbatim with a debug log, which is the runtime's convention, not an authoring error the Builder can detect.

### 4.5 The proving bench (right panel)

Four stacked cards:

1. **Test roll.** A parameter form generated from the current declarations, defaults pre-filled — reuse/extract the form logic already in `CustomToolsDropdown.tsx` (`initialValues` / `coerceParameters`) into a shared component rather than writing a third copy. A **Roll** button calls the preview endpoint (§5.3) and renders the result as a faithful mini Pascal bubble: state accent, rendered message, dice breakdown when present, plus a debug line the real bubble doesn't show — raw draw, final value, *which outcome row matched* (the matched row also flashes in the form column; this is the "aha" moment of the cascade), and the metadata keys the winning row consulted with the values they held (`metadataTested` from the run result). Repeated rolls append to a short scrollback (last ~10). Disabled with a hint while the draft is invalid.
2. **The fact sheet.** `executeCustomTool` is pure — the caller supplies `opts.metadata` — so the bench must supply one too, or every metadata-gated row is dealt to nobody in particular and audits as unreachable. Below the parameter form, a **metadata card** with two modes: **pick a character** (a character select; the server hydrates that character and uses `character.metadata` — the honest "what would happen if Imogen rolled this" answer) or **hand-typed sheet** (a small JSON-object editor, validated as a single JSON object, for testing keys no existing character carries yet). Default: empty `{}`, with a standing hint whenever the draft contains any `metadata` test: "no fact sheet supplied — metadata tests will all decline, exactly as for an unattributed manual roll." The supplied sheet feeds both the test roll and the audit.
3. **Table audit.** A **Deal a thousand hands** button (N = 10,000 server-side; label stays in voice) calling the audit endpoint (§5.4) with the *current bench parameter values and fact sheet*. Renders per-outcome hit percentages as a horizontal bar list in row order, and flags any **zero-hit row** with a warning: "this outcome never fired in 10,000 draws *with these parameters and this fact sheet* — it may be unreachable, or reachable only with other parameter values, or gated on metadata this sheet doesn't carry." That caveat is honest and required: reachability generally depends on params and on the supplied metadata, and the audit samples one point of that space. A metadata-gated row showing 0% under an empty sheet is working as designed, not a bug.
4. **JSON preview.** Read-only, live, pretty-printed — the exact bytes Save would write (§6.2), with `$schema` line included. This is the teaching surface: users learn the hand-format by watching the form write it.

### 4.6 JSON mode

The Form ⇄ JSON switch swaps the form column for a JSON text editor (plain `<textarea>`/CodeMirror-free is acceptable v1; monospace `qt-` styled, line numbers optional — do **not** add a new editor dependency without checking what's already in the bundle; Lexical is for rich text, not this).

- JSON → Form transition requires: parse OK **and** `QtapCustomToolSchema.safeParse` OK. Otherwise the switch is blocked with the issues listed (`formatDefinitionIssues` string, plus per-issue Zod paths).
- Form → JSON is always allowed.
- Validation in JSON mode runs debounced (~300 ms) as-you-type, with an issues panel below the editor. Save from JSON mode is gated identically (§6.1).
- Unknown top-level keys are shown with an info line ("carries keys this build doesn't know: `persist` — they'll be kept as-is") — mirroring `collectUnknownKeys`.

---

## 5. API surface

New collection resource: **`/api/v1/custom-tools`** (`app/api/v1/custom-tools/route.ts`), action-dispatch pattern, middleware from `@/lib/api/middleware`, responses from `@/lib/api/responses`. File content I/O reuses the existing mount-points file routes (`GET/PUT/DELETE /api/v1/mount-points/[id]/files/Tools/<file>`) — the Builder adds **no second write path** into stores. `PUT` there already supports `expected_mtime`/`force` (conflict detection) and creates parent folders (`fs.mkdir recursive` on disk; verify `storeMountFile` folder-row creation for database stores — the character-vault bridges write nested paths today, so this is expected to Just Work; if it doesn't, fix `storeMountFile`, not the Builder).

### 5.1 `GET /api/v1/custom-tools` — the library

Server-side: a new exported `listAllCustomTools()` in `lib/pascal/custom-tools.ts` that enumerates **all enabled mounts** (every `docMountPoints` row, not a tiered pool) and reuses the existing per-mount loader (`loadToolsFromMount` — export it or refactor its body into a shared helper; do not duplicate the read/parse/validate sequence). Response per entry: `{ name, title, description, disabled, defaultVisibility, rollForm, parameterCount, outcomeCount, mountPointId, mountName, definitionPath, attachments: [{ kind: 'general'|'project'|'group'|'character'|'unattached', id?, label }] , valid: true }` and for broken files `{ definitionPath, mountPointId, mountName, reason, valid: false }`. Attachments are resolved once per mount (general mount id via `getGeneralMountPointId`, `project_doc_mount_links`, `group_doc_mount_links` + group official stores, characters' vault mount ids). No caching (freshness doctrine from the parent spec).

### 5.2 `GET /api/v1/custom-tools?action=destinations`

The save-target list, grouped:

```jsonc
{
  "general":    { "mountPointId": "…", "mountName": "Quilltap General" },      // null if unprovisioned
  "projects":   [ { "projectId", "projectName", "stores": [ { "mountPointId", "mountName" } ] } ],
  "groups":     [ { "groupId", "groupName", "stores": [ { "mountPointId", "mountName", "official": true } ] } ],
  "characters": [ { "characterId", "characterName", "mountPointId" } ],       // only characters WITH a vault
  "other":      [ { "mountPointId", "mountName" } ]                            // enabled stores attached to nothing
}
```

Only **enabled** mounts. Characters lacking a vault are omitted (v1 does not provision vaults from here). Include per-store `existingToolNames: string[]` so the picker can warn about duplicate `name` in the target store *before* writing a file the loader would reject (same-store duplicate `name` is a load-time rejection).

### 5.3 `POST /api/v1/custom-tools?action=preview`

Body: `{ definition: <raw JSON object>, params?: Record<string, unknown>, private?: boolean, metadata?: Record<string, unknown> | { characterId: string } }`. Server validates with `QtapCustomToolSchema.safeParse` (400 with `formatDefinitionIssues` on failure), resolves `metadata` — a plain object passes through verbatim; the `{ characterId }` form hydrates that character (`repos.characters.findById`, the hydrating read) and uses `character.metadata ?? {}`, with a 404 for an unknown id and the vault-failure error surfaced honestly (`CharacterVaultUnavailableError` → 4xx with the reason) — then calls `executeCustomTool(definition, params, { private, metadata })` and returns the full `CustomToolRunResult` (which carries `metadataTested` for the bench's debug line). **Posts nothing, writes nothing** — pure computation, which `executeCustomTool` already is. This keeps the crypto-strength RNG and the one true execution core server-side; the bench can never drift from what a live chat would do.

### 5.4 `POST /api/v1/custom-tools?action=audit`

Body: `{ definition, params?, metadata? }` — `metadata` in the same two forms as §5.3, resolved the same way, threaded into the match subjects so metadata-gated rows can actually fire. Validate as above; then run the roll + `matchesWhen` loop N = 10,000 times (roll and match only — **skip `renderTemplate`**, it's the expensive part and irrelevant to hit rates). Return `{ runs: 10000, outcomes: [{ index, hits, share }], valueMin, valueMax, valueMean }`. Cheap (<50 ms). Cap: reject definitions the schema wouldn't accept anyway; no other rate limiting needed on a single-user instance. Debug-log both actions per the logging rule.

### 5.5 Query keys

`lib/query/keys.ts` already has a `customTools` block (chat-roster scoped). Extend it — same block, new entries: `library()`, `destinations()`. Mutations (save/delete via mount-points routes) must invalidate `queryKeys.customTools.all` **and** the relevant scriptorium/file listing keys if such exist for the touched mount. All fetching through `apiFetch` + TanStack Query per house rules; preview/audit are `useMutation`s (they're POSTs with bodies, not cacheable reads).

---

## 6. Reading and writing files

### 6.1 The validity gate

**Nothing invalid is ever written.** Save is enabled only when: form mode (valid by construction, plus the few cross-field checks that need a final pass — run `QtapCustomToolSchema.safeParse` on the serialized draft as a belt-and-braces gate before every save) or JSON mode with a passing parse. The one deliberate exception: **JSON repair mode may save an invalid file back only as itself** — see §6.4.

### 6.2 Canonical serialization

The emitted document is deterministic:

- `$schema: "/schemas/qtap-custom-tool.schema.json"` first (insert if absent; preserve an existing different value — the user may point at a remote copy).
- Known keys in the schema's declaration order: `name, title, description, disabled, revealOdds, defaultVisibility, parameters, roll, outcomes`.
- **Omit optionals that equal their defaults** (`title` empty, `disabled: false`, `revealOdds: true`, `defaultVisibility: "public"`, empty `parameters`, roll fields at their defaults, a wholly-default `roll` object) — the hand-written files in the wild are minimal, and the Builder should not bloat a file it merely re-saved. Exception: never strip anything the user explicitly typed in JSON mode; canonicalization applies to form-mode emission only.
- Unknown top-level keys (§6.3) appended after known keys, in their original order.
- 2-space indent, trailing newline.

**Round-trip invariant (test this):** load any valid definition into form mode, change nothing, save → the only permissible diffs are key order, whitespace, and default-elision. Semantics identical (deep-equal after `safeParse`).

### 6.3 Unknown-key passthrough

`collectUnknownKeys` exists precisely because v2 keys (`persist`) are tolerated at the top level. The Builder must hold unknown top-level keys in an opaque bag on the draft and re-emit them verbatim on save. A Builder that strips `persist` from a newer file is a data-loss bug. Show the info line (§4.6). Nested unknown keys can't occur in a schema-valid file (strict objects), so the bag is top-level only.

### 6.4 Repair mode

Opening a file that fails JSON.parse or `safeParse` lands in **JSON mode, locked** (form switch disabled until valid), with the loader's reason displayed and Zod issue paths listed. Save here is allowed once the content validates — *or*, for the "I just want to fix the quote mark" case, allowed while still invalid **with an explicit confirm** ("Save it broken? It will stay off the table until it validates."). Rationale: the file is already broken on disk; refusing to save a partial repair would force users back to the Scriptorium raw editor and out of the Workbench entirely.

### 6.5 Filenames, rename, save-as

- Default filename on create: `<name>.tool.json` under `Tools/` (the folder is a lazy convention — never pre-scaffolded; the PUT creates it).
- The filename is **not** the identity (`name` is); the Builder still keeps them aligned by default. When `name` changes on an existing file, offer (checkbox in the save flow, default on): "also rename the file to `<new>.tool.json`" → PUT new path, then DELETE old path, in that order (write-then-delete so a failure never loses the definition). If the target filename already exists, block with a message.
- **Save As… / destination change**: the destination picker (§6.6) reappears; writing to a new store leaves the original untouched (it's a copy, and the UI says so).
- Concurrency: track `mtime` from the GET; send `expected_mtime` on PUT; on conflict (the route's conflict response), offer reload-theirs / overwrite-mine (`force: true`).

### 6.6 The destination picker

A dialog (on first save, and behind Save As…) rendering §5.2's groups:

```
Where shall Pascal keep this contrivance?

◈ The General Store          — every chat, every character        [Quilltap General]
◈ Projects                   — chats in that project
    ▸ Ashfall Chronicle          [Ashfall Docs] [Research Notes]
◈ Groups                     — every member of the group
    ▸ The Night Shift            [Official Store ★]
◈ Character vaults           — that character only (shadows all other tiers)
    ▸ Imogen Hartwell
◈ Other stores               — not attached to anything (inert until linked)
```

Each option shows a one-line consequence in voice (the tier semantics above — this doubles as the user's education about shadowing). Selecting a store with a same-`name` tool already in it shows a blocking warning (same-store duplicate = loader rejection) with a one-click "open the existing one instead". Selecting a store where the name exists at a *different* store is a non-blocking advisory ("this name is also on the table at …; nearest tier wins").

---

## 7. Prerequisite refactors (do these first, as their own commits)

### 7.1 Make the schema client-safe: split `lib/pascal/dice.ts`

`custom-tool.types.ts` is pure Zod **except** that it imports `parseDiceNotation`, `MIN_DIE_SIDES`, `MAX_DIE_SIDES` from `dice.ts`, which imports `crypto.randomBytes` — so today the schema cannot enter a client bundle, and the whole by-construction validation story depends on it doing so. Split:

- `lib/pascal/dice-notation.ts` — **pure**: the notation grammar, `parseDiceNotation`, the size/count constants, `formatDiceBreakdown` if it's pure (it is — it formats a result). No `crypto`, no imports beyond types.
- `lib/pascal/dice.ts` — keeps `rollNotation` and the RNG; re-exports the notation module so **no existing import site changes** (or update the handful of import sites — either is fine, but a re-export is less churn).
- Verify with `npx tsc` and by actually importing `QtapCustomToolSchema` from a `'use client'` module in the Builder.

The Builder then imports `QtapCustomToolSchema`, `displayTitle`, `formatDefinitionIssues`, `collectUnknownKeys`, all constants, and `parseDiceNotation` directly — **client and server validate with the same code**. Do not hand-copy any constant or regex into a component.

### 7.2 Export the per-mount loader

Expose `loadToolsFromMount` (or extract its read→parse→validate core) from `lib/pascal/custom-tools.ts` for `listAllCustomTools()` (§5.1). Also export a small `simulateOutcomes(definition, params, runs, metadata?)` helper next to `executeCustomTool` for the audit endpoint, built from the existing internals (`rollRange`/`rollNotation` + `matchesWhen`, with `metadata` threaded into the match subjects exactly as `executeCustomTool` threads `opts.metadata`) rather than reimplementing the draw.

### 7.3 Shared parameter form

Extract the parameter-form generation from `CustomToolsDropdown.tsx` (`initialValues`, `coerceParameters`, the per-type input rendering) into `components/chat/CustomToolParamsForm.tsx` (or a better home under `components/custom-tools/`), consumed by both the dropdown and the proving bench. Behavior of the dropdown must not change (its tests, if any, and a manual pass guard this).

---

## 8. Edge cases and rules (checklist for the implementer)

- **Catch-all**: pinned last, always present, only state+message editable. A loaded file *always* has one (schema guarantees it); a new draft starts with one (`state: "info"`, message `"{{value}}"`? No — start with a friendly default message in voice, e.g. `"The wheel gives {{value}}."`, and one empty non-catch-all row in error state so the user is led to author a real outcome).
- **New-draft defaults**: range roll (all defaults, i.e. emit no `roll` key), no parameters, `revealOdds` on, visibility public.
- **Caps**: 8 params, 32 outcomes, 64-tool roster (library shows totals; the roster cap is per-chat and not the Builder's to enforce, but the library can note when a single store exceeds it).
- **`{{dice}}` in range form**: warning underline, non-blocking (§4.4.2).
- **Param deletion vs. rename**: §4.2 — rename rewrites, delete breaks-loudly.
- **`min > max`** on a parameter: inline error. On roll fields it can only be *known* when both are literal — flag it then; when either side is a `$param` it's a runtime concern (`CustomToolRunError`) and the bench will surface it honestly.
- **Integer params**: default input steps by 1 and rejects fractions (schema: `default must be a whole number`).
- **eq/neq type widening** exists only under `params` tests — bare value/roll comparators are numeric-only, and the UI's subject-driven operand typing already encodes that.
- **The `$schema` key** is display-exempt: never shown as an "unknown key", always managed per §6.2.
- **Disabled tools**: fully editable (a tombstone is a real file). The library renders them dimmed with the tombstone chip.
- **Deleting the file of a shadowing definition**: no special handling — the roster re-resolves fresh every call; just invalidate queries.
- **Whisper preview**: the bench's `private` flag simply passes through to preview; the mini-bubble renders whisper styling when `visibility === 'whisper'`.
- **Metadata fails soft, everywhere**: a `metadata` comparator whose key is absent, whose stored value is non-primitive (array/object/null), or whose type mismatches the comparator (an ordering test against a string, `eq: true` against a number) is simply **false** — the row declines and evaluation falls through, ultimately to the catch-all. Never an error, never a `CustomToolRunError`. The Builder must not invent a stricter authoring-time story: there is nothing to validate beyond comparator shape and `$param` declaredness (§4.4.1), and the bench surfaces the rest empirically.
- **Metadata-gated rows and the empty sheet**: with no fact sheet supplied (§4.5 card 2), every metadata test declines by design. Zero-hit audit warnings must say so (§4.5 card 3's wording — "gated on metadata this sheet doesn't carry"), and the standing hint on the metadata card fires whenever the draft tests metadata and the sheet is `{}`. Do not auto-mark such rows "unreachable" — they are reachable by the right character.
- **`{{metadata.*}}` placeholders are never "unknown"** (§4.4.2): keys are undeclared by nature; absent keys render verbatim at run time by convention.

---

## 9. Documentation, help, and housekeeping (required by the standing rules)

- **`help/custom-tools.md`**: extend with a "Pascal's Workbench" section — how to open it, the library, the builder, the proving bench, the destination picker and what each tier means. Keep the hand-authoring JSON material (it remains fully supported; the Workbench is sugar). Frontmatter `url` should deep-link to `/custom-tools`; keep the In-Chat Navigation `help_navigate` call in sync with it. Consider whether a *separate* `help/pascals-workbench.md` is cleaner — implementer's call; if separate, cross-link both ways.
- **`docs/CHANGELOG.md`**: entry in plain American English (no voice).
- **`docs/developer/API.md`**: document the new `/api/v1/custom-tools` resource and actions.
- **Parent spec** (`pascal-custom-tools.md`): tick the deferred "form-based editor" item with a pointer here; move this file to `features/complete/` when shipped.
- **Snapshot/tests**: no new LLM tools are added (the Builder is UI + API only), so `tool-definitions-snapshot.test.ts` is untouched. New unit tests: serialization round-trip (§6.2 invariant, including unknown-key passthrough), `when` chip ⇄ JSON bijection (every comparator, every subject **including `metadata` — string/boolean/number literals, `$param` operands, ordering comparators, and exotic keys the free-text input permits: spaces, dots, unicode**, bands), destination grouping, audit distribution sanity (a `{ "gte": 2 }` on 1d1+1 hits 100%; a metadata-gated row hits 0% with an empty sheet and its expected share with the key supplied), and the dice split (client-safe import compiles — a jest test importing `dice-notation` asserting no `crypto` in its module graph is overkill; the tsc + bundle build covers it).
- **Logging**: debug logs on library resolution, preview, audit, and save/rename flows (context `pascal.workbench` or similar).
- **Migrations**: none — the Builder stores nothing new; definitions remain plain documents in stores.
- **Export/import**: no new data model fields, so `.qtap` export is untouched (definitions already travel inside their stores).

## 10. Suggested commit sequence

1. `refactor: split dice notation parsing from the RNG so the tool schema is client-safe` (§7.1) — includes tsc + existing tests green.
2. `refactor: export the custom-tool mount loader and add an outcome simulator` (§7.2) + `refactor: shared custom-tool parameter form` (§7.3).
3. `feat: /api/v1/custom-tools — library, destinations, preview, audit` with unit tests.
4. `feat: Pascal's Workbench — library view and workspace tab`.
5. `feat: Pascal's Workbench — the builder form, condition cascade, and proving bench`.
6. `feat: Pascal's Workbench — save flow, destination picker, repair mode` + round-trip tests.
7. `docs/help: Pascal's Workbench` + changelog + entry points (settings link, composer popup links, Scriptorium action).

Each step leaves the app shippable. The `/commit` command handles lint/type/test/version mechanics.
