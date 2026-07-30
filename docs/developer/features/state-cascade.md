# Cascading State: chat → project → group → general

## Context

Quilltap's persistent "state" system (Pascal the Croupier's subsystem — JSON state for games, inventory, session tracking) currently has two tiers: chat state (`chats.state` column) and project state (`state.json` in the project's official document store), merged shallowly with chat winning. This change extends it into a four-tier cascade — **chat → project → group → general** — and lets Pascal custom tools read state in their inputs.

- **Group state** already persists end-to-end (`state.json` via the group store overlay; `repos.groups.update({state})` works — `lib/groups/group-store/overlay.ts:28-46`) but is wired into nothing: no API route, no tool access, no UI.
- **General (instance-wide) state** doesn't exist yet. It becomes a `state.json` document at the root of the existing "Quilltap General" mount (`instance_settings.generalMountPointId`), auto-created idempotently at startup — the same pattern as character `metadata.json` (`ensureCharacterMetadataFile`, `lib/mount-index/character-scaffold.ts:90`) and `ensureGeneralScenariosFolder`. No migration needed.

## Decisions (locked in with the user)

1. **Compatibility:** existing `context: 'chat' | 'project'` tool behavior and API shapes stay valid; merged fetch gains the group and general layers beneath.
2. **Merge (shallow, top-level keys):** `{ ...general, ...group, ...project, ...chat }` — chat wins.
3. **Group tier merges only when exactly one group applies.** With 2+ groups, the tier is skipped in merged fetches; group state is then reachable only by declaring the group by ID or name.
4. **Set/delete default to chat** unless context is declared. Group-context ops accept a `group` ref (ID or name; names aren't unique → ambiguity policy below).
5. **Group resolution:** LLM tool + Pascal LLM path use the **responding character's** memberships (Knowledge's rule: a character only sees its own groups). API/UI merged view uses the **union across the chat's active character participants** (all `type === 'CHARACTER' && status !== 'removed'` — deliberately NOT copying the `controlledBy` filter from `group-stores.ts:31`).
6. **Pascal:** full `$param` parity — `$state` refs in parameter defaults, roll fields, and when-comparator operands, plus `{{state.path}}` in outcome templates.

## Work items (in dependency order)

### 1. Extract pure path helpers → `lib/state/state-paths.ts` (new)

Move `parsePath`/`getAtPath`/`setAtPath`/`deleteAtPath` verbatim from `lib/tools/handlers/state-handler.ts:50-178` (root-set throw becomes a plain error; handler wraps it). The handler re-exports them so `lib/tools/index.ts` and tests keep working. Add a small direct unit test.

### 2. General state accessor + startup ensure

**New `lib/mount-index/general-state.ts`** (sibling doctrine to `general-scenarios.ts`):
- `GENERAL_STATE_JSON_PATH = 'state.json'`
- `ensureGeneralStateFile()` — `getGeneralMountPointId()` null → graceful no-op; existence check via `docMountDocuments.findByMountPointAndPath`; seed `'{}'` via `writeDatabaseDocument` (`lib/mount-index/database-store.ts:102`); **never heal existing content**.
- `readGeneralState()` — `{}` on unprovisioned / NOT_FOUND / corrupt JSON (warn), matching the overlay's corrupt-`state.json` behavior.
- `writeGeneralState(state)` — throws when unprovisioned (matches `setGeneralScenarioDefault`).

**Modify `instrumentation.ts`** PHASE 3.4b (~:748-758): sibling try/catch calling `ensureGeneralStateFile()` right after `ensureGeneralScenariosFolder()`, warn-and-continue.

### 3. Shared cascade resolver → `lib/state/state-cascade.ts` (new)

The single merge implementation, replacing today's duplicated `mergeState` (`state-handler.ts:184`, `chats/[id]/actions/state.ts:26`). Consumed by the tool handler, chat get-state API, and both Pascal entrances.

- `resolveStateCascade({ chat, groupScope })` → `{ chatState, projectState, groupState, generalState, merged, groupTier, projectId }`.
  - `groupScope`: `{kind:'character', characterId}` | `{kind:'participants-union'}` | `{kind:'none'}`.
  - Group candidates via `groupCharacterMembers.findByCharacterId` (`lib/database/repositories/group-character-members.repository.ts:131`), hydrated via `repos.groups.findById` (fail-soft per group).
  - `groupTier: { status: 'none'|'single'|'ambiguous', candidates: [{id,name}], appliedGroupId? }` — exactly-one rule applied here.
  - Project tier keeps the graceful degradation from `chats/[id]/actions/state.ts:51-65`; general tier via `readGeneralState()`.
- `resolveGroupForContext({ groupRef?, candidates })` → hydrated Group, or `StateGroupResolutionError` with `code` (`GROUP_NOT_FOUND | GROUP_AMBIGUOUS | NO_GROUPS | GROUP_REF_REQUIRED`) + `candidates`. Policy: omitted ref + exactly one candidate → that group; ref matches candidate id → it; else case-insensitive exact name match **among candidates only**; ambiguous/missing → error listing candidates as `"Name (id)"`.
- Unit tests: precedence on colliding keys, exactly-one/skip rules, both scopes, all resolution branches, degradation paths.

### 4. State tool

**`lib/tools/state-tool.ts`** (Zod is source of truth; keep `zodToOpenAISchema`): `context` enum gains `'group' | 'general'`; new optional `group: z.string()` ("Group name or ID; required with context 'group' when the character belongs to more than one group"); descriptions updated for the four-tier merge and defaults.

**`lib/tools/handlers/state-handler.ts`**: `StateToolContext` gains `characterId?`. Fetch: no context → cascade (character scope) + `getAtPath(merged, path)`; `'chat'`/`'project'` branches byte-for-byte compatible (same `'Chat is not part of a project'` error); `'group'` → `resolveGroupForContext` then read; `'general'` → `readGeneralState()`. Set/delete: default `'chat'`; underscore user-only guard uniform across all tiers; `'group'` → `repos.groups.update(id, {state})`; `'general'` → `writeGeneralState`. Logs gain `characterId`/`groupId`/tier.

**`lib/chat/tool-executor.ts:692-700`**: add `characterId` (already in scope) to the state tool context.

**Snapshot**: `npx jest lib/tools/__tests__/tool-definitions-snapshot.test.ts -u`, review diff. Handler tests: 0/1/2-group merges, group by id/name/ambiguous/omitted, general round-trip, underscore refusal on new tiers.

### 5. API routes

- **`app/api/v1/chats/[id]/actions/state.ts`**: rebuild `handleGetState` on the cascade (participants-union scope); delete local `mergeState`. Response stays compatible and gains `groupState?`, `generalState?`, `groupTier` (keep the "undefined when empty" convention). Set/reset untouched.
- **New `app/api/v1/groups/[id]/actions/state.ts`**: reuse `createSetStateHandler`/`createResetStateHandler` (`lib/api/state-handlers.ts`) with `{ entityName:'Group', idLogKey:'groupId', selectRepo: r => r.groups }` — every entity gets the same existence-only check. Bespoke `handleGetState` (no parent tier: `{ state: group.state ?? {} }`). Wire into the actions barrel + `handlers/{get,put,delete}.ts` dispatchers (`?action=get-state|set-state|reset-state`).
- **New `app/api/v1/settings/general-state/route.ts`** (bespoke — no entity row/repo): GET → `readGeneralState()`; PUT → `stateBodySchema` validation + `writeGeneralState`; DELETE → reset to `{}` returning `previousState`. Middleware/responses per house pattern; siblings `app/api/v1/settings/{chat,data-retention,text-replacements}`.
- Update `__tests__/unit/app/api/v1/chats/[id]/actions/state-get.test.ts`; add group + general route tests. Update `docs/developer/API.md`.

### 6. UI

- **`lib/query/keys.ts`**: new `groups` block (`all`, `state(id)`) + `settings.generalState`.
- **`components/state/StateEditorModal.tsx`**: `entityType: 'chat' | 'project' | 'group' | 'general'` with a per-type config map (query key, get/set/reset URLs, title). Chat mode: show group/general inherited layers and an "N groups — not merged, edit per group" notice when `groupTier.status === 'ambiguous'`.
- **Surfaces**: "Group State" button in `app/aurora/groups/[id]/GroupDetailView.tsx`; "General State" `CollapsibleCard` in `components/settings/tabs/ChatTabContent.tsx` next to Pascal's custom-tools card (state is Pascal's subsystem, `lib/foundry/subsystem-defaults.ts:134`).

### 7. Pascal `$state` (depends only on items 1–3)

Ref shape: `{ "$state": "<path>", "fallback": <number|string|boolean> }` — **fallback required** (types the ref at load time; guarantees pure run-time resolution never fails).

- **`lib/pascal/custom-tool.types.ts`**: `StateRefSchema` (strict) + `isStateRef` beside `isParamRef` (:90); widen `NumberOrParamRefSchema` (:85), operand schemas (:200-214), and `CustomToolParameterSchema.default` (:108). Load-time: `resolveOperandType` (:763) types a state ref by its fallback; `validateRollRefs` (:672) requires numeric fallback in roll fields; param-default fallback must satisfy the declared param type (superRefine :118). Retire the "$param is the only indirection" comment.
- **`lib/pascal/custom-tools.ts`**: copy the `overrides.metadata` threading exactly — `overrides.state` into `executeCustomTool` (:1153), added to `OutcomeSubjects` (:649), `matchesWhen` chain, `renderTemplate` (`{{state.path}}` branch; absent/non-primitive → leave placeholder + debug log, the `{{metadata.*}}` doctrine). New pure `resolveStateValue(ref, state)`: `getAtPath` + typeof-matches-fallback check, else fallback, never throws. Wire into `coerceParam`/`resolveParams` (signature change — audit all callers in one pass), `resolveRollField` (:576), `resolveOperand` (:680). `simulateOutcomes` (:1258) gains optional `state` (default `{}`).
- **Entrances**: `lib/tools/handlers/run-custom-handler.ts` — load chat, `resolveStateCascade` with `{kind:'character', characterId}`, fail-soft to `{}` (fallbacks make runs always dealable), pass `state: cascade.merged`. Manual path `app/api/v1/chats/[id]/custom-tools/route.ts` `handleRun` — character scope when `asCharacterId` names a character, else `{kind:'none'}` (mirrors the metadata rule at :358; comment the asymmetry). Workbench route `app/api/v1/custom-tools/route.ts` — run/simulate bodies gain optional mock `state` (like the metadata mock); add the field to the Workbench UI panel.
- **`public/schemas/qtap-custom-tool.schema.json`**: mirror the `$state` object in every widened position; the agreement test `__tests__/unit/lib/pascal/custom-tool-definition.test.ts` keeps them honest.
- Tests under `__tests__/unit/lib/pascal/`: schema accept/reject (missing fallback, type mismatches), execution with present/absent/wrong-typed state, template rendering, simulate threading, workbench body field.

### 8. Docs / help / changelog / DDL / export

- `docs/developer/DDL.md`: document the general mount's root `state.json` + startup ensure (group store section already documents its `state.json`).
- `public/schemas/qtap-export.schema.json`: chat/project/group state already exported. **Verify at implementation** whether the Quilltap General mount rides in the `documentStores` dump; record the outcome in the schema description either way.
- `help/chat-state.md`: rewrite for four tiers (steampunk voice; keep `url` frontmatter + In-Chat Navigation matching). `help/custom-tools.md`: document `$state` + Workbench mock. Cross-check `help/groups.md`.
- `docs/developer/features/pascal-custom-tools.md`: retire "only indirection", document `$state` and per-entrance cascade; note `persist` stays deferred.
- `docs/CHANGELOG.md`: terse plain-English entries.

## Known risks (accepted)

- Whole-object replace on set → concurrent-write races now shared across chats via group/general tiers (pre-existing pattern; doc note only).
- `parsePath`'s `\w+` segments: keys with spaces/dots unreachable (pre-existing; document beside `$state`).
- Merged fetch now costs membership lookups + hydrated group read + one general-doc read per call — acceptable; `findByIdRaw` + targeted state read is the escape hatch if ever needed.

## Verification

1. `npx tsc` and lint.
2. `npx jest __tests__/unit/lib/state __tests__/unit/lib/mount-index/general-state.test.ts __tests__/unit/app/api/v1/chats __tests__/unit/lib/pascal lib/tools/__tests__` (snapshot `-u` once; diff should show only the new `context` values + `group` param).
3. Boot dev server twice: first boot seeds `state.json` in the general mount (PHASE 3.4b log), second skips; hand-corrupt it → reads degrade to `{}` with a warn, no healing.
4. Endpoints: chat `get-state` (new fields, precedence on a colliding key, `ambiguous` status with a 2-group character); group `set-state`/`reset-state`; `settings/general-state` GET/PUT/DELETE.
5. LLM tool in a live chat: merged fetch; group context by name, by id, ambiguous-name error listing candidates; set defaulting to chat; set with `context:'general'`; underscore refusal.
6. Pascal: a `.tool.json` using `$state` in a default, a roll bound, a `when` operand, and `{{state.path}}` — run via LLM path (character in one group), manual popup, and Workbench simulate with mock state; confirm fallback engages on absent path.
7. UI: Salon state modal tier notes; Aurora group editor's Group State; Settings → Chat General State card.
