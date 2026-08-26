# Archived Scenarios and Wardrobe items (`archived` frontmatter)

> **Status:** IMPLEMENTED (4.9-dev). Kept as the design record — the decisions in §3 are the
> contract the code holds to, and §7's checklist is still the way to verify a change here by hand.
> Deviations from the plan as written are noted inline with **[as built]**.
> **Scope:** An `archived: true/false` frontmatter property on Scenario files and Wardrobe-item files (absence = `false`). Archived entries disappear from every normal list and dropdown; every listing interface gains a "Show archived" checkbox that reveals them and lets the human select them anyway. The Green Room's outfit-selection LLM must *never* see or choose an archived wardrobe item — no override.
> **Prerequisite:** land the in-flight `Wardrobe/instructions.md` working-tree change first — it touches the same four wardrobe routes, `vault-projection.ts`, and `wardrobe-control-dialog.tsx`, and this plan cites its patterns. *(Landed in `b86bb1a58` before this work began.)*

---

## 1. The feature in one paragraph

A wardrobe item or scenario markdown file may carry `archived: true` in its YAML frontmatter. Absent or `false` means active. Archived entries are filtered out of every list, dropdown, and picker by default — the Salon scenario picker, the New Chat dialog, the wardrobe control dialog, the outfit selector, the scenario managers, the project/group wardrobe managers. Each of those surfaces gains a **"Show archived"** checkbox; when ticked, archived entries appear (visibly badged) and the human may still select them — archiving hides, it does not forbid. The one exception is the LLM: the candidate list handed to the cheap-LLM outfit chooser at chat start (the pipeline the Green Room dialog narrates) excludes archived items unconditionally. Archiving is fully reversible from the same interfaces.

## 2. What already exists (read before designing anything)

**Wardrobe archiving is already half-built.** This plan *exposes* it; it does not invent it.

- **Schema:** `WardrobeItemSchema` already has `archivedAt: TimestampSchema.nullable().optional()` ([lib/schemas/wardrobe.types.ts:180](../../../lib/schemas/wardrobe.types.ts)).
- **Frontmatter round-trip is symmetric and already accepts a bare `archived: true`:**
  - Serialize: `buildWardrobeItemFile` writes `archived: true` + `archivedAt: <iso>` when set, omits both when active ([lib/mount-index/character-vault.ts:311-314](../../../lib/mount-index/character-vault.ts)). Omission-means-false is already the contract the user asked for.
  - Parse: `parseWardrobeItemFile` prefers `archivedAt`, and falls back `archived: true` → `archivedAt = doc.updatedAt` ([lib/database/repositories/vault-overlay/parsers.ts:315-320](../../../lib/database/repositories/vault-overlay/parsers.ts)) — a hand-edited `archived: true` with no timestamp works today.
- **Filtering already happens at every load-bearing layer, across all four tiers** (character > group > project > general):
  - `getOverlaidWardrobeItems` drops archived unless `options.includeArchived` ([vault-overlay/wardrobe-sync.ts:89](../../../lib/database/repositories/vault-overlay/wardrobe-sync.ts))
  - `mergeWearablePool` drops archived *after* the tier merge ([lib/wardrobe/wearable-pool.ts:37](../../../lib/wardrobe/wearable-pool.ts)) — deliberately, so an archived personal override lets a shared item resurface
  - `findArchetypes` / `findArchetypesInMounts` thread `includeArchived` ([lib/database/repositories/wardrobe.repository.ts:181,223](../../../lib/database/repositories/wardrobe.repository.ts))
  - Defaults skip archived ([lib/wardrobe/default-outfit.ts:34](../../../lib/wardrobe/default-outfit.ts), [lib/wardrobe/apply-outfit-selections.ts:173](../../../lib/wardrobe/apply-outfit-selections.ts))
  - `wardrobe_wear` refuses archived items ([lib/tools/handlers/wardrobe-wear-handler.ts:106](../../../lib/tools/handlers/wardrobe-wear-handler.ts)); the `wardrobe_archive` tool exists and works for character-owned items
  - `resolve-equipped.ts:105` deliberately **includes** archived — an item archived mid-chat stays worn until removed. Keep this.
- **The Green Room requirement is already satisfied for the LLM path.** "The Green Room" is the chat-creation status dialog ([components/new-chat/ChatCreationProgressModal.tsx:52](../../../components/new-chat/ChatCreationProgressModal.tsx), bus in [lib/chat/creation-progress.ts](../../../lib/chat/creation-progress.ts)); the pipeline it narrates builds its per-character candidate pool in `getPool()` ([lib/wardrobe/apply-outfit-selections.ts:269-306](../../../lib/wardrobe/apply-outfit-selections.ts)) via `mergeWearablePool`, which filters archived, before `outfit-selection.ts` renders the `- ID: … | "title"` lines for the LLM ([lib/memory/cheap-llm-tasks/outfit-selection.ts:102-111](../../../lib/memory/cheap-llm-tasks/outfit-selection.ts)). The work here is **regression tests that pin this**, not new filtering.

**What's missing on the wardrobe side** — the controls:

- No API route can archive/unarchive: the item PUT schema (`updateWardrobeItemSchema`, [app/api/v1/characters/[id]/wardrobe/[itemId]/route.ts:15-27](../../../app/api/v1/characters/%5Bid%5D/wardrobe/%5BitemId%5D/route.ts) and siblings) does not accept an archived field, and the project/group POST routes hardcode `archivedAt: null`.
- No collection route accepts `?includeArchived=true`, so no UI can show archived entries.
- `repos.wardrobe.unarchive` ([wardrobe.repository.ts:287](../../../lib/database/repositories/wardrobe.repository.ts)) has **zero callers** outside tests.
- The UI only filters client-side (`wardrobe-control-dialog.tsx:456`, `outfit-selector.tsx:202`) and renders one read-only badge (`ProjectWardrobeManager.tsx:329`). No checkbox, no toggle.
- `archivedAt` is absent from the `WardrobeItem` def in [public/schemas/qtap-export.schema.json](../../../public/schemas/qtap-export.schema.json) (~line 1228) — it survives only via `additionalProperties: true`.

**Scenarios have nothing.** Zero hits for `archiv` in any scenario module. This is the greenfield half.

## 3. Design decisions (settled — do not re-litigate)

1. **Frontmatter key:** `archived`, boolean, **omitted when false**. Wardrobe keeps its existing `archived` + `archivedAt` pair (parser fallback already accepts bare `archived: true`). Scenarios get just `archived: true/false` — no `archivedAt`; scenarios have no timestamp field today and the user contract is the boolean.
2. **Filter server-side, default `false`.** List endpoints exclude archived unless `?includeArchived=true`. UI checkboxes flip the fetch, not a client-side filter — one source of truth, and pickers that never pass the param are safe by construction.
3. **Archiving hides, it does not forbid the human.** With "Show archived" ticked, an archived scenario or garment is selectable in that interface. This mirrors `resolveScenarioBody`/`resolve-equipped` semantics: existing chats pointing at a now-archived scenario keep working; an archived-but-worn garment stays worn.
4. **The LLM is the exception:** the outfit-selection candidate list never includes archived items, no parameter, no override. (Already true; pin with tests.)
5. **Archived entries can't be defaults.** An `archived: true` file with `isDefault: true` loses: exclude archived *before* default-conflict resolution in `listScenariosInFolder`, and guard the New Chat auto-select. (Wardrobe already does this in `default-outfit.ts`.)
6. **Archived items must survive vault projection.** `projectArrayIntoVaultFolder` ([vault-overlay/vault-projection.ts](../../../lib/database/repositories/vault-overlay/vault-projection.ts)) deletes any file in the folder not present in the incoming array. Every write path that projects wardrobe items or character scenarios must fetch with `includeArchived: true` so archived files ride along flagged, not get swept. **This is the landmine of the whole feature — an "archived" item silently deleted on the next save is data loss.** The in-flight `preserveFileNames` option added for `instructions.md` is the precedent for exempting things from the sweep.
7. **All four scenario scopes are in scope** — general, project, group (file-backed via `scenarios-common.ts`) *and* character scenarios (vault `Scenarios/` files). "Doesn't show up anywhere" includes the character optgroup of the picker. `parseScenarioFile` already parses frontmatter, so this is additive, but the character-scenario serializer emits no frontmatter today — see Phase C.
8. **Checkbox copy:** "Show archived" (steampunk voice belongs in help docs, not a checkbox label; existing wardrobe UI uses plain "Archived" badges).

**[as built] Two additions to decision 6 that the plan didn't anticipate:**

- The *character-scenario* projection has the same landmine as the wardrobe one, and the fix is the same shape but lives elsewhere: `readCharacterVaultScenarios` keeps archived entries in `character.scenarios`, and `GET /api/v1/characters/[id]/scenarios` filters the **response**. The array itself must stay complete, because `applyManagedFieldWrites` projects it back over the folder. Both directions are pinned in `__tests__/unit/lib/database/repositories/character-scenarios-archived.test.ts`.
- On the wardrobe side the projection was already safe — `readMountItems` reads the vault raw rather than through the archived-free `readSharedWardrobe` — but nothing said so. `__tests__/unit/lib/wardrobe/archived-survives-projection.test.ts` now pins it, including the failure case (filter the array first and the archived file *is* swept).

**[as built] Decision 5 extends to implicit defaults.** `character.scenarios[0]` is used as the scene when a chat names none (three call sites across the Salon and Help prompt builders). An archived scenario at index 0 must not become the scene by accident, so those now go through `firstActiveScenarioContent()` in `lib/characters/active-scenarios.ts`.

## 4. Architecture map — scenarios (the greenfield half)

**Single chokepoint for the three file-backed scopes:** [lib/mount-index/scenarios-common.ts](../../../lib/mount-index/scenarios-common.ts)

- `ParsedScenario` interface (:41) — add `archived: boolean`
- `parseScenarioDoc()` (:71-112) — the only frontmatter parse (reads `name`, `description`, `isDefault`); read `archived` here. Coerce truthy `true`/`"true"` like `isDefault` does; anything else (including absence) is `false`.
- `listScenariosInFolder()` (:123-172) — the only list builder; add an `includeArchived` option, filter in the parse loop (:137-141), and exclude archived from the `isDefault` conflict-resolution pass (:143-169) *even when* `includeArchived` is true.
- `buildScenarioFileContent()` (:286-306) — the only serializer; write `archived: true` when set, omit otherwise.
- `resolveScenarioBody()` (:195-222) — bypasses parsing by design; **leave it alone** so existing chats keep resolving archived scenarios (decision 3).

Thin wrappers to thread the option through: `general-scenarios.ts`, `project-scenarios.ts`, `group-scenarios.ts` (all in `lib/mount-index/`).

**Routes** (add `?includeArchived=true` to GET; add `archived: z.boolean().optional()` to the update schemas; PUT with `archived` rewrites frontmatter via the serializer):

| Route | Notes |
|---|---|
| [app/api/v1/scenarios/route.ts](../../../app/api/v1/scenarios/route.ts) | general list (:49-71); `createScenarioSchema` :38-44 |
| [app/api/v1/scenarios/[scenarioPath]/route.ts](../../../app/api/v1/scenarios/%5BscenarioPath%5D/route.ts) | `updateScenarioSchema` :43-48 |
| [app/api/v1/projects/[id]/scenarios/route.ts](../../../app/api/v1/projects/%5Bid%5D/scenarios/route.ts) + `[scenarioPath]` twin | |
| [app/api/v1/groups/[id]/scenarios/route.ts](../../../app/api/v1/groups/%5Bid%5D/scenarios/route.ts) + `[scenarioPath]` twin | |
| [app/api/v1/groups/scenarios/route.ts](../../../app/api/v1/groups/scenarios/route.ts) | participant-aggregate list; calls `listGroupScenarios` (:83) |
| [app/api/v1/characters/[id]/scenarios/route.ts](../../../app/api/v1/characters/%5Bid%5D/scenarios/route.ts) | character scenarios (:25-41) — Phase C |

**UI surfaces:**

- Picker component: [components/scenario/ScenarioSelect.tsx](../../../components/scenario/ScenarioSelect.tsx) (four optgroups :98-141) + option types in [components/scenario/types.ts](../../../components/scenario/types.ts). Server-side filtering means the *hiding* half needs no change here; the checkbox lives in its two hosts:
  - Salon in-chat picker: [components/chat/ChatScenarioControl.tsx:81-138](../../../components/chat/ChatScenarioControl.tsx) — four `useQuery` calls; the `includeArchived` flag must join the TanStack query keys ([lib/query/keys.ts:53-59](../../../lib/query/keys.ts), `queryKeys.scenarios.*` — extend the factory, never inline keys).
  - New Chat dialog: [components/new-chat/hooks/useNewChat.ts:203-223](../../../components/new-chat/hooks/useNewChat.ts) (raw parallel fetches; mappings :273-278, :329-334, :359). **Guard the default auto-select at :442-444** (`find(s => s.isDefault)`) against archived entries.
- Management CRUD (checkbox + archive/unarchive action + badge): [components/scenarios/ScenariosManager.tsx](../../../components/scenarios/ScenariosManager.tsx) (:155), `ScenarioRow.tsx`, `ScenarioEditorModal.tsx`, and the `Scenario`/`ScenarioMutator` contracts in [components/scenarios/types.ts](../../../components/scenarios/types.ts); fed by [app/prospero/[id]/hooks/useProjectScenarios.ts](../../../app/prospero/%5Bid%5D/hooks/useProjectScenarios.ts) and [app/scenarios/hooks/useGeneralScenarios.ts](../../../app/scenarios/hooks/useGeneralScenarios.ts).

**Character scenarios (Phase C):** parse in `parseScenarioFile` ([vault-overlay/parsers.ts:477-554](../../../lib/database/repositories/vault-overlay/parsers.ts) — frontmatter parsing already present; add `archived`); serialize in `buildScenarioFile` ([character-vault.ts:220-222](../../../lib/mount-index/character-vault.ts) — currently emits *no* frontmatter, only `# Title\n\nbody`; must emit a frontmatter block **only when archived**, so untouched files don't churn); `CharacterScenarioSchema` ([lib/schemas/character.types.ts:39-46](../../../lib/schemas/character.types.ts)) gains `archived: z.boolean().optional()`; round-trip through [vault-overlay/managed-fields.ts](../../../lib/database/repositories/vault-overlay/managed-fields.ts) (:167-170, :316-324, :521-536) — and mind decision 6: the projection array must include archived scenarios or they get swept. The scenario `id` is a stable UUID hashed from the path (parsers.ts:547): archiving must never rename the file.

**LLM-facing:** scenarios are never listed to an LLM — a chosen scenario is flattened to `chat.scenarioText` by `resolveScenarioSelection` ([lib/chat/scenario-selection.ts:65-164](../../../lib/chat/scenario-selection.ts)). Nothing to filter; nothing to change.

## 5. Architecture map — wardrobe (the expose-it half)

- **Mutation:** add `archived: z.boolean().optional()` to `updateWardrobeItemSchema` in all four item routes (`characters/[id]/wardrobe/[itemId]`, `groups/[id]/wardrobe/[itemId]`, `projects/[id]/wardrobe/[itemId]`, `wardrobe/[itemId]`), mapping `true` → `archivedAt: now` (via `repos.wardrobe.archive`) and `false` → `archivedAt: null` (finally wiring `repos.wardrobe.unarchive`). Idempotent: archiving an archived item keeps its original `archivedAt`.
- **Listing:** add `?includeArchived=true` to the four collection GETs ([characters/[id]/wardrobe/route.ts:106](../../../app/api/v1/characters/%5Bid%5D/wardrobe/route.ts), [groups/[id]/wardrobe/route.ts:104](../../../app/api/v1/groups/%5Bid%5D/wardrobe/route.ts), [projects/[id]/wardrobe/route.ts:102](../../../app/api/v1/projects/%5Bid%5D/wardrobe/route.ts), [wardrobe/route.ts:76](../../../app/api/v1/wardrobe/route.ts)), threading to `getOverlaidWardrobeItems` / `findArchetypes` / `findArchetypesInMounts`, whose flags already exist. Build the URLs in the single helper [lib/wardrobe/wardrobe-container.ts](../../../lib/wardrobe/wardrobe-container.ts) (`wardrobeCollectionUrl`) so the param can't drift — the `?action=instructions` addition on the same routes is the precedent.
- **Hooks:** [lib/hooks/use-character-wardrobe-items.ts:58](../../../lib/hooks/use-character-wardrobe-items.ts) (fans out to all four endpoints, :94-99) and [lib/hooks/use-wardrobe-container-items.ts:44](../../../lib/hooks/use-wardrobe-container-items.ts) take an `includeArchived` option and refetch when it flips. (These are plain fetch + state, no TanStack — keep it that way here.)
- **UI:** "Show archived" checkbox + archive/unarchive controls + badge in [components/wardrobe/wardrobe-control-dialog.tsx](../../../components/wardrobe/wardrobe-control-dialog.tsx) (drop the client-side `:456` filter in favor of the fetch flag), [components/wardrobe/outfit-selector.tsx:202](../../../components/wardrobe/outfit-selector.tsx), [components/wardrobe/ProjectWardrobeManager.tsx](../../../components/wardrobe/ProjectWardrobeManager.tsx) (badge at :329 already exists; add the toggle and actions).
- **Vault projection (decision 6):** audit every caller of `writeCharacterVaultManagedFields` / wardrobe projection to confirm the item arrays it projects were fetched with `includeArchived: true`. Add a regression test: archive an item, save the character/wardrobe through the normal UI path, assert the file still exists with `archived: true`.
- **Do not touch:** `mergeWearablePool`'s archived-shadowing semantics (an archived personal override resurfaces the shared item — documented behavior), `resolve-equipped`'s include-archived read, `wardrobe_wear`'s refusal, the `wardrobe_archive` tool's owned-items-only restriction ([lib/tools/legacy/text-block-prompt.ts:207](../../../lib/tools/legacy/text-block-prompt.ts) documents it to the model). If a `wardrobe_unarchive` tool is wanted later, that's a separate feature (deferred once already in the tools consolidation).

## 6. Implementation phases

**Phase A — Scenarios core (file-backed, three scopes).**
`scenarios-common.ts` (parse, serialize, list + `includeArchived`, default-resolution exclusion) → the three wrapper modules → the seven scenario routes (list param + update-schema `archived`). Unit tests beside the existing scenario tests: parse (`archived: true`/`"true"`/`false`/absent), serialize round-trip, list filtering, archived-default exclusion, `resolveScenarioBody` still resolving archived files.

**Phase B — Scenarios UI.**
`ScenariosManager`/`ScenarioRow`/`ScenarioEditorModal` + `ScenarioMutator` (archive/unarchive + checkbox + badge, both hosts); `ChatScenarioControl` checkbox (query-key factory extension in `lib/query/keys.ts`); `useNewChat` checkbox + the :442 default-auto-select guard.

**Phase C — Character scenarios.**
`CharacterScenarioSchema`, `parseScenarioFile`, `buildScenarioFile` (frontmatter-only-when-archived), `managed-fields.ts` round-trip with the projection-sweep guard, `characters/[id]/scenarios` route param, character optgroup behavior in both picker hosts. Regression test for decision 6 (archive → resave character → file survives).

**Phase D — Wardrobe controls.**
Update schemas ×4 (archive/unarchive), collection param ×4 via `wardrobeCollectionUrl`, both hooks, three UI components. Wire `repos.wardrobe.unarchive`. Projection-sweep audit + regression test.

**Phase E — Green Room pin + periphery.**
- Regression tests: an archived item (in each tier: character, group, project, general) never appears in the candidate list `outfit-selection.ts` renders, and `llm_choose` validation still drops an archived id if a model hallucinates one. Extend the existing suites (`__tests__/unit/lib/memory/cheap-llm-tasks/outfit-selection.test.ts`, `__tests__/unit/lib/wardrobe/apply-outfit-selections.*.test.ts`).
- Almanack: scenario counts in [lib/tools/almanack/phase4-scriptorium.ts:520-524](../../../lib/tools/almanack/phase4-scriptorium.ts) should split active/archived the way wardrobe already does at :444 (`'%archived: true%'` LIKE match); render in `render.ts:821-827`.
- Export schema: add `archivedAt` to the `WardrobeItem` def and `archived` to the character-scenarios entry in `public/schemas/qtap-export.schema.json` (file-backed scenarios export as raw document content and round-trip for free). Verify `.qtap` import preserves both (export/import completeness is a standing rule).

**Phase F — Docs.**
Help files (each already has `url` frontmatter + In-Chat Navigation; steampunk voice): `help/general-scenarios.md` (frontmatter block :25-41), `help/project-scenarios.md` (:23-39), `help/wardrobe.md` (archiving prose at :159-161 is the tone model), `help/project-wardrobe.md`, `help/groups.md`, `help/chats.md` (Green Room section :78-86 — one line that archived garments never audition). `docs/CHANGELOG.md` (plain voice). `docs/developer/API.md` for the new params/fields.

Phases A/B/C (scenarios) and D (wardrobe) are independent; E depends on both; a phase is a commit-sized unit.

## 7. Verification checklist

1. Hand-edit `archived: true` into a scenario file and a wardrobe file (no other keys): both vanish from every picker and manager; ticking "Show archived" reveals both, badged, selectable.
2. Untick → they vanish again; archived-with-`isDefault` is never auto-selected in New Chat and never wins default resolution.
3. Start a chat with `llm_choose` outfits while a tempting item is archived in each tier — it never appears in the LLM prompt (assert via the cheap-LLM task's rendered candidate list in logs/tests).
4. A chat whose scenario was archived mid-life keeps its scenario text; a character wearing an item archived mid-chat keeps wearing it.
5. Archive an item, then edit the character (or another garment) and save: the archived file still exists in the vault, still `archived: true`.
6. Export → import a `.qtap`: archived flags survive on both entity kinds.
7. `npx tsc`, `npm run lint`, full `npm run test:unit` (not `--findRelatedTests` — broken in this repo).
