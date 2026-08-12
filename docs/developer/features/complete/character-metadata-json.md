# Feature: Character `metadata.json` — a generic per-character key/value store

**Status:** Implemented (shipped) — commit 8bc43333.
**Owner subsystems:** Character vault overlay (`lib/database/repositories/vault-overlay/`) and Pascal the Croupier (`lib/pascal/`).
**Implementation note:** This spec is written to be executed by Claude Code (Opus) with minimal further design input. Where a choice existed, it has been made — see [Design Decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout (changelog, help docs, logging, export/import round-tripping, tool chokepoints).

## Motivation

Roleplay state frequently wants a flat, user-defined fact sheet per character that no built-in field models: `"hasAnsibleAccess": true`, `"clearanceLevel": 3`, `"faction": "Ordo Aurum"`. Today the closest facilities are the vantage-point prose fields (wrong shape — prose, and semantically reserved) and `character_plugin_data` (wrong owner — DB-backed, keyed by plugin name, invisible in the vault).

This feature adds **`metadata.json`**, a sibling of `properties.json` at the root of every character vault, holding one JSON object of arbitrary user-authored keys. It hydrates onto the `Character` object as `character.metadata`, so any code path that holds a hydrated character can test `character.metadata["hasAnsibleAccess"]`. Its first consumer is Pascal's custom-tool runner: outcome tables gain a `when.metadata.<key>` test subject and a `{{metadata.<key>}}` template family, so a lockpicking table can branch on whether *this* character carries the right key.

Two things this feature is deliberately **not**:

- **Not an LLM-authored field.** The create-character and summon-from-lore flows, the character optimizer, and every other generation system must never invent or populate it. It is driven user-side.
- **Not a prompt field.** `metadata` is never injected into system prompts or character context. Characters with `systemTransparency: true` can read (and edit) the file through the ordinary `doc_*` tools, exactly like any other vault file; opaque characters cannot see it at all. No new access machinery.

## The file

### Location and shape

`metadata.json` at the **root** of a character vault (a `storeType: 'character'` mount), alongside `properties.json`. Content is a single JSON object; keys are arbitrary user-chosen strings; values are **any JSON value** (boolean, number, string, null, array, object).

```json
{
  "hasAnsibleAccess": true,
  "clearanceLevel": 3,
  "faction": "Ordo Aurum",
  "knownLanguages": ["Trade Cant", "High Gothic"]
}
```

New Zod schema in `lib/database/repositories/vault-overlay/schema.ts`, alongside `CharacterVaultPropertiesSchema` (line 25):

```ts
export const CharacterVaultMetadataSchema = z.record(z.string(), JsonSchema);
export type CharacterVaultMetadata = z.infer<typeof CharacterVaultMetadataSchema>;
```

(`JsonSchema` is the existing recursive JSON-value schema already used by `sillyTavernData` in `lib/schemas/character.types.ts:160`; import it rather than writing a second one.)

Nothing else about the file is constrained — no reserved keys, no size ceiling beyond the general document-store limits, no schema published to `public/schemas/` (there is nothing to complete; it's freeform).

### Defaults and missing-file semantics — NOT a second keystone

- **New characters:** the scaffold seeds `metadata.json` with `{}`.
- **Existing characters with no `metadata.json`:** hydration falls back to `{}` silently. **The file's absence must never throw** — only `properties.json` is the keystone (`read-overlay.ts:148–154` throws `CharacterVaultUnavailableError`; do not extend that check). No migration backfills the file: the `{}` fallback makes one unnecessary, and the first write creates it lazily.
- **Unparseable file** (invalid JSON, or top-level non-object): follow the per-file all-or-nothing convention documented at `vault-overlay/schema.ts:24–31` — hydrate as `{}`, log at `warn` with the character and mount ids. A broken metadata file must not hollow the character.

## `character.metadata` — schema, hydration, writes

### Character schema

Add to `CharacterSchema` in `lib/schemas/character.types.ts` (lines 110–247):

```ts
metadata: z.record(z.string(), JsonSchema).nullable().optional(),
```

Semantics: `undefined`/`null` and `{}` are equivalent for readers ("no metadata"); hydration always produces at least `{}` for a vault-linked character, so downstream code can rely on `character.metadata?.["key"]` without null gymnastics. There is **no** `characters` DB column and **no** DDL migration — like every managed content field post-cutover, the vault file is the sole source of truth.

### Read path (hydration)

Mirror `properties.json` exactly in `lib/database/repositories/vault-overlay/`:

1. `schema.ts`: add `export const CHARACTER_METADATA_JSON_PATH = 'metadata.json'` beside `CHARACTER_PROPERTIES_JSON_PATH` (line 77); append it to `SINGLE_FILE_OVERLAY_PATHS` (line 91) so `loadVaultFileMaps()` batch-fetches it; add a descriptor to `CHARACTER_VAULT_DESCRIPTORS` (line 155).
2. `read-overlay.ts` `hydrateOne()` (line 133): after the properties block (lines 158–170), parse `metadata.json` through `CharacterVaultMetadataSchema` and set `character.metadata`; absent → `{}`; parse failure → `{}` + `warn` log (see above).

### Write path — a writable managed field

`metadata` joins `MANAGED_FIELDS` (`schema.ts:173`), so repository/API writes route into the vault:

1. `managed-fields.ts` `writeCharacterVaultManagedFields()` (line 197): project `character.metadata ?? {}` into `metadata.json` alongside the `properties.json` write (lines 208–223). (The vault-adoption path in `ensureCharacterVault` returns before this projection — `character-vault.ts:122–130` — so an adopted vault's existing `metadata.json` is never clobbered; no special handling needed.)
2. `managed-fields.ts` `applyDocumentStoreWriteOverlay()` (line 322): route a `metadata` patch to `metadata.json`. **Whole-object replace**, not key-merge: a patch's `metadata` value becomes the entire file content (pretty-printed, 2-space, like the scaffold). Key-level read-modify-write is the caller's job. Note this differs from the `properties.json` handling (lines 376–405), which merges because *several Character fields share one file*; `metadata` is one field owning one file, so replace is the coherent PUT semantics.
3. `characters.repository.ts` `_create`/`_update` already strip `MANAGED_FIELDS` before SQL (lines 303–337), so membership in the set is the only DB-side change.
4. The character PUT route (`app/api/v1/characters/[id]/handlers/put.ts`) needs no new code — `metadata` flows through the generic managed-field routing — but **verify** the handler's input validation accepts the field (it validates against `CharacterSchema`/`CharacterInput` partials) and add it to any explicit field allowlist if one exists.
5. Direct file edits (file-manager UI, `doc_*` tools) hit `metadata.json` as an ordinary document write; the next hydration picks them up. No cache to invalidate — the overlay reads per-request.

### Scaffold

`lib/mount-index/character-scaffold.ts`: add `{ path: 'metadata.json', content: JSON.stringify({}, null, 2) }` to `fileSpecs` (line 96), with a `METADATA_JSON = {}` seed constant beside `PROPERTIES_JSON` (line 42). The scaffold is idempotent (existing files skipped), so re-scaffolds never wipe user data.

**Do NOT add `metadata.json` to `REQUIRED_VAULT_FILES`** (`character-vault.ts:50–57`): pre-feature vaults lack the file, and requiring it would wrongly disqualify them from same-name adoption.

## Pascal custom-tool integration

Custom tools gain a fourth test subject and a fourth template family. Everything stays eval-free and comparator-shaped; the runner remains pure — the **caller** loads metadata and passes it in.

### `when.metadata.<key>` comparators

Extend the `When` grammar (`lib/pascal/custom-tool.types.ts`, `WhenObjectSchema` at line 241) with a `metadata` subject symmetric to `params`:

```json
{ "when": { "gt": 0.60, "metadata": { "hasAnsibleAccess": { "eq": true } } },
  "message": "The ansible flickers to life.", "state": "success" }
```

- Same comparator keys (`gt`/`gte`/`lt`/`lte`/`eq`/`neq`), AND-composed, nested objects strict — an unknown key inside a comparator object stays a load-time rejection.
- Operand typing mirrors `params`: ordering comparators demand numbers; `eq`/`neq` widen to strings and booleans. `$param` references remain valid as operands (`{ "metadata": { "clearanceLevel": { "gte": { "$param": "required" } } } }`).
- **Load-time validation is shallower than for `params`, by necessity:** metadata keys are not declared anywhere the tool file can see, so `validateReferences` (`custom-tool.types.ts:414`) can check operand/comparator *shape* but not key existence or the stored value's type. That gap is closed by the run-time rule below.

### Run-time semantics — missing keys don't match, and never throw

`matchesWhen()` (`lib/pascal/custom-tools.ts:636`) currently throws on impossible comparisons, because for `value`/`roll`/`params` such a state is a regression past load-time validation. **Metadata is different**: the key may simply not exist on this character, or hold a non-primitive. The rule:

- A `metadata` comparator whose key is **absent**, or whose stored value is **not a primitive** (array/object/null where a comparison needs a scalar), or whose stored value's **type mismatches** the comparator (ordering comparator vs. a string) → that comparator is **false**. The outcome row doesn't match and evaluation falls through — ultimately to the mandatory trailing `when: true`. Log at `debug` with tool name, key, and reason.
- No throw, no error bubble. A table that branches on `hasAnsibleAccess` must behave sanely for the character who's never heard of an ansible; the catch-all row is the author's "otherwise."
- `eq`/`neq` against `null` stored values: `{ "eq": null }` is not expressible (operands are number/string/boolean/`$param`), and that is fine — absence and `null` both simply fail to match. Document this in the help doc.

### Threading metadata into the runner

`executeCustomTool()` (`custom-tools.ts:703`) is pure and stays pure. Add an optional `metadata` field to its options/subjects:

1. `OutcomeSubjects` (line 546) gains `metadata?: Record<string, unknown>`.
2. `matchesWhen()` gains the `metadata` branch beside the `params` loop (lines 647–654), reusing `matchesComparator` with the fail-soft rule above.
3. `executeCustomTool(definition, params, opts)` accepts `opts.metadata` and threads it into the subjects (line 741) and the template context (line 749).
4. `renderTemplate()` (line 673) gains the `{{metadata.<key>}}` family: primitives render like `{{params.<name>}}` (integers undecorated, floats to 4 significant digits, strings/booleans verbatim); absent keys and non-primitive values are left **verbatim as the placeholder** and logged at `debug` — same convention as unknown placeholders today.

### Callers load the metadata

Both entrances already resolve the invoker before executing; each additionally fetches the invoking character (hydrated, so `character.metadata` is populated) and passes `metadata: character.metadata ?? {}`:

- **LLM path** — `lib/tools/handlers/run-custom-handler.ts:152`: the handler context knows the calling participant's character; `repos.characters.findById` is already the hydrating read. Watch the vault-failure semantics: `findById` throws `CharacterVaultUnavailableError` on a broken vault, and the handler's existing error path (Prospero `custom-tool-error` bubble) is the right landing place for that.
- **Manual path** — `app/api/v1/chats/[id]/custom-tools/route.ts:344`: when the run carries `asCharacterId` (a character-labeled variant), load that character's metadata. A manual run with **no** character association passes `{}` — metadata tests won't match and the catch-all answers, which is the honest reading of "nobody in particular rolled this."
- **Job child** (autonomous rooms): the read flows through the buffered `getRepositories()` proxy; reads pass through, so hydration works. Never assume read-your-writes within a handler.

`pascalMeta` (the persisted roll record) gains an optional `"metadataTested": { "<key>": <valueAtRollTime> }` map — only the keys the winning evaluation actually consulted, primitives only — so the transcript records what the table saw. This is additive JSON inside an existing nullable TEXT column: **no migration**, but add the field to `qtap-export.schema.json`'s `pascalMeta` definition and confirm export/import round-trips it (they should already, as opaque JSON).

### Roster description — say nothing

The `run_custom` tool description (dynamic roster injection) must **not** enumerate metadata keys or values: it would leak per-character secrets into every participant's tool block, and `revealOdds: false` tables would leak their branch conditions. The fixed preamble gains one sentence noting that outcome tables *may* consult the invoking character's metadata sheet; that is all the model learns. Tables with `revealOdds: true` already render their `when` clauses in the roster — `metadata` clauses render there like any other comparator (authors who want secrecy set `revealOdds: false`, existing machinery).

## Access rules — nothing new

`metadata.json` is an ordinary vault file under existing policy:

- **Human user:** full read/write via the file-manager UI and the mount API, like any vault document.
- **Transparent characters** (`systemTransparency: true`): read/edit via `doc_*` tools, own vault and peers', per the existing gates (`lib/tools/handlers/doc-edit/shared.ts` — `actingCharacterIsOpaqueToVaults`, `assertCharacterMayRead/Write`).
- **Opaque characters:** no visibility, as with the rest of the vault.
- No per-file policy special-casing. (JSON files carry no frontmatter, so the `character_read`/`character_write` flags don't apply to them — they get the all-true default policy, same as `properties.json` today. Acceptable and consistent; do not build a JSON-aware policy source for this feature.)

## Export / import / backups

- **`.qtap` export:** the vault file already travels automatically as a document-store document (`ExportedDocumentStoreDocument`, keyed by `(mountPointId, relativePath)`). Additionally, per the house rule that new data-model fields round-trip explicitly: add `metadata` to `ExportedCharacter` (`lib/export/types.ts:433+`) and to `public/schemas/qtap-export.schema.json`'s character definition, mirroring exactly how the other managed fields (e.g. `firstMessage`) are materialized on export and applied on import (`lib/import/quilltap-import/import-characters.ts` — the create/update path routes managed fields into the fresh vault). Where both the materialized field and the imported vault document exist, the existing managed-field precedence applies unchanged — do not invent a new merge rule; whatever `firstMessage` does, `metadata` does.
- **SillyTavern export:** omitted in v1. `metadata` is Quilltap-native; if a mapping is ever wanted, it belongs under the card's `extensions` block as a v2 decision.
- **Backups:** automatic — mount-index table dumps capture the document rows; no changes.
- **DDL.md:** update the character-vault file table (lines 290–301 region) to list `metadata.json` with its semantics (optional, `{}` default, whole-object managed field).

## Out of scope / guarded against

- **Generation systems never touch it.** Audit that the create-character flow, summon-from-lore, and the character optimizer neither read nor write `metadata`; in particular confirm `collectTemplateFields` / `applyCharacterFieldUpdates` (the shared field-save dispatch) does not pick it up as an LLM-editable field. If any generic "all managed fields" enumeration would sweep it in, exclude it explicitly with a comment pointing here.
- **No prompt injection.** No context-builder or system-prompt path reads `character.metadata`.
- **No UI editor in v1.** The file-manager is the editing surface (it is "driven user-side" by design). A form-based editor in Aurora's edit page is a natural v2; the writable-managed-field plumbing exists for it.
- **No Pascal `persist`-into-metadata.** Tools *test* metadata in v1; tools *writing* metadata (e.g. an outcome flipping `hasAnsibleAccess` to true) is attractive but belongs with the deferred `persist` block in the custom-tools v2 design, where its race/authority questions (job-child buffered writes, whole-object replace vs. key patch) can be answered together.

## Engineering tasks

### Backend

- [ ] `CharacterVaultMetadataSchema`, `CHARACTER_METADATA_JSON_PATH`, `SINGLE_FILE_OVERLAY_PATHS` + descriptor entries (`vault-overlay/schema.ts`).
- [ ] `metadata` on `CharacterSchema` (`lib/schemas/character.types.ts`), reusing `JsonSchema`.
- [ ] Hydration in `read-overlay.ts` (`hydrateOne` + `loadVaultFileMaps`): absent → `{}`, unparseable → `{}` + `warn`. Never a keystone throw.
- [ ] `MANAGED_FIELDS` membership; full projection in `writeCharacterVaultManagedFields`; whole-object-replace patch routing in `applyDocumentStoreWriteOverlay`.
- [ ] Scaffold seed `{}` in `character-scaffold.ts`; confirm `REQUIRED_VAULT_FILES` untouched.
- [ ] Character PUT route accepts the field (verify validation/allowlists).
- [ ] Pascal: `metadata` subject in `WhenObjectSchema` + shape validation in `validateReferences`; `OutcomeSubjects.metadata`; fail-soft `matchesWhen` branch; `{{metadata.<key>}}` in `renderTemplate`; `opts.metadata` on `executeCustomTool`.
- [ ] Both invokers load the invoking character's hydrated metadata (`run-custom-handler.ts`, `custom-tools/route.ts`); `{}` for characterless manual runs; `CharacterVaultUnavailableError` lands on the existing Prospero error path.
- [ ] `pascalMeta.metadataTested`; `qtap-export.schema.json` update.
- [ ] Roster preamble sentence; verify no key/value leakage into the tool description.
- [ ] `ExportedCharacter.metadata` + export schema + import application, mirroring `firstMessage` handling.
- [ ] DDL.md vault-file table update.
- [ ] Debug logging on every new path (hydration fallback, fail-soft comparator misses, template misses, metadata loads).

### Testing

- [ ] Unit (overlay): hydration with file present / absent / unparseable / top-level array; whole-object-replace write; round-trip through repository update; scaffold seeds `{}`; adoption path leaves an existing `metadata.json` intact.
- [ ] Unit (Pascal): `when.metadata` matrix — present-and-matching, present-wrong-type, absent key, non-primitive value, `$param` operand, combined with bare/`roll`/`params` subjects; load-time rejection of malformed `metadata` comparator objects; `{{metadata.<key>}}` rendering incl. absent-key verbatim behavior. Update the custom-tool definition corpus test (`__tests__/unit/lib/pascal/custom-tool-definition.test.ts`) and the published `qtap-custom-tool.schema.json` mirror — the Zod/JSON-Schema agreement test must keep passing.
- [ ] Snapshot: if the `run_custom` description preamble changes, re-run `npx jest -u` on `lib/tools/__tests__/tool-definitions-snapshot.test.ts`.
- [ ] Integration: character with `"hasAnsibleAccess": true` matches the gated outcome; character without the key falls to the catch-all; manual characterless run falls to the catch-all; export → import preserves `metadata` both via `ExportedCharacter` and via the vault document.
- [ ] Jest conventions per repo standards (global `jest`, bare mock factories; `@jest-environment node` docblock on any suite touching the real SQLCipher binding).

### Documentation

- [ ] `help/` — update `shared-character-vaults.md` (or the most fitting vault doc) to introduce `metadata.json` (what it is, `{}` default, edited through the file manager, visible to transparent characters), and `custom-tools.md` for the `when.metadata` subject and `{{metadata.<key>}}` templates including the missing-key fall-through rule. Steampunk voice; `url` frontmatter + matching In-Chat Navigation `help_navigate` call.
- [ ] `docs/CHANGELOG.md` entry (plain American English).
- [ ] CLAUDE.md: no glossary change needed (no new personified feature, no new `systemSender`).

## Design Decisions (Resolved)

1. **Vault file, not a DB column or `character_plugin_data`.** The vault is the character's source of truth post-cutover; a fact sheet the user hand-edits belongs where the user's other hand-edited character files live, travels with `.qtap` document exports for free, and is visible to transparent characters through existing machinery. `character_plugin_data` stays what it is: plugin-keyed, DB-backed, invisible in the vault.
2. **Any JSON value, not primitives-only** (user decision). Roleplay data wants lists and nesting; Pascal comparators simply only match primitive-valued keys, enforced fail-soft at run time.
3. **Normal vault access rules** (user decision). Transparent characters read/edit it via `doc_*`; opaque characters can't see it; no per-file special-casing and no JSON frontmatter policy invention.
4. **Writable managed field** (user decision). `metadata` routes through the existing write overlay like `pronouns`/`title`, enabling API writes and a future UI editor with zero new plumbing.
5. **Whole-object replace on patch.** One field owns one file; PUT-the-object is the least surprising semantics, and the read-modify-write dance `properties.json` needs exists only because five fields share that file.
6. **Not a keystone, no migration.** Absent file hydrates as `{}`; unparseable file hydrates as `{}` with a warning. Old vaults keep working untouched; the file appears on first write or fresh scaffold.
7. **Pascal integration ships in this feature** (user decision), as a `metadata` subject symmetric to `params` plus a template family — same comparators, same strictness, same `$param` operands.
8. **Missing metadata keys fail soft, never throw.** Unlike `params` (declared, validated, impossible to miss at run time), metadata keys are undeclared by nature; a non-matching comparator that falls through to the mandatory catch-all is the correct behavior for "this character doesn't have that fact," and an error bubble would punish the author for a table that's working as designed.
9. **The roster never enumerates metadata.** Keys and values are per-character and potentially secret; the model learns only that tables may consult the sheet. `revealOdds` continues to govern whether a specific table's conditions (including metadata clauses) render.
10. **Generation systems are excluded by audit, not by accident.** The field is user-driven; the spec makes the exclusion an explicit checklist item because a generic managed-field enumeration could otherwise sweep it into LLM-editable surfaces.
11. **Tool-writes-metadata deferred.** Testing is v1; mutation belongs with custom-tools `persist` in v2 where write authority and job-child buffering get designed once, together.
