# Shared wardrobe tiers at chat start

## Context

Quilltap's wardrobe is tri-tier: a character's own vault, the project's linked
document stores, and the singleton "Quilltap General" store. The UI
(`use-character-wardrobe-items.ts`) and every in-chat wardrobe tool already
merge all three. The two **server** paths that dress characters at chat start
do not — they read the character's own vault only.

Consequences today:

1. **`llm_choose` can't pick shared items.** The candidate list handed to the
   cheap LLM comes from `findByCharacterId` alone, and the validator drops any
   id outside that list. A character whose wardrobe is entirely shared also
   fails the `wardrobeItems.length > 0` guard and silently falls through to
   defaults without the LLM ever being called.
2. **`default` mode diverges between client and server.** The client decides
   "has a usable default" over the *merged* list and sends `mode: 'default'`;
   the server resolves it from the character vault only. A character whose
   defaults live in shared tiers shows "Use defaults" in the composer and then
   starts the chat wearing nothing.
3. **The creation-dialog preview misses the project tier**, so a project-tier
   garment renders with no title.

All three flow through `applyOutfitSelections`, so all three call sites are
affected: new chat, add-participant, and conversation merge.

**Agreed behavior:** shared items flagged `isDefault` auto-equip from **both**
shared tiers (a General default dresses every character everywhere; a project
default dresses everyone in that project), and personal + shared defaults
**layer** rather than one winning the slot. Character tier still shadows on
*id* collision, as everywhere else.

Design work surfaced a fourth defect that must be fixed for that behavior to
produce a visible outfit — see §4. No schema, migration, or export-format
change is involved.

---

## Decisions settled during design

- **Merge first, filter `isDefault` last.** `findDefaultsForCharacter`
  delegates to `getOverlaidWardrobeItems(characterId, { defaultsOnly: true })`,
  and that filter runs *inside* the overlay
  ([wardrobe-sync.ts:89](lib/database/repositories/vault-overlay/wardrobe-sync.ts:89)).
  So a personal item with `isDefault: false` shadowing a shared item with
  `isDefault: true` is invisible to any merge done on the *filtered* lists —
  the shared default would be equipped despite the character opting out. The
  merge must happen on full pools.
- **Callers resolve `projectMountPointIds`, callee receives it.** Matches
  [wardrobe-announcement.ts:70](lib/background-jobs/handlers/wardrobe-announcement.ts:70)
  and [avatar-prompt.ts:94](lib/wardrobe/avatar-prompt.ts:94), and avoids a
  redundant `chats.findById` per character inside the merge loop.
- **Fetch the shared pool once per call, not per selection.** `findArchetypes`
  re-reads and YAML-parses every file in the General folder each call; an
  8-character chat would otherwise multiply that across the selection loop.
- **Archived shadowing keeps current behavior**: archiving a personal override
  of a shared item lets the shared item resurface. This is what
  `wardrobe-list-handler` already does; documenting it rather than changing it.

---

## Changes

### 1. Repository: one merged-pool method, one merge rule

**New** `lib/wardrobe/wearable-pool.ts` — pure, no I/O:

```ts
mergeWearablePool(shared: WardrobeItem[], own: WardrobeItem[]): WardrobeItem[]
```

Shared first, own overwriting by id (character shadows shared), archived
filtered out. This is the rule currently hand-rolled at
[wardrobe-list-handler.ts:84-92](lib/tools/handlers/wardrobe-list-handler.ts:84).

**`lib/database/repositories/wardrobe.repository.ts`** — add:

```ts
async findWearablePoolForCharacter(
  characterId: string,
  opts?: { projectMountPointIds?: string[] },
): Promise<WardrobeItem[]>
```

`findArchetypes(false, opts)` + `findByCharacterId(characterId)` through
`mergeWearablePool`. Keep the object-`opts` shape — the group tier is the
tracked follow-up noted at
[wardrobe-list-handler.ts:82](lib/tools/handlers/wardrobe-list-handler.ts:82)
and will land as `opts.groupMountPointIds` with no call-site churn.

Add a comment on the method: it must **not** be "simplified" to call
`readCharacterVaultWardrobe` directly or to flip `seedArchetypes` — that is
what keeps the recursion guarded at
[general-wardrobe.ts:61](lib/mount-index/general-wardrobe.ts:61) intact. (As
designed, the archetype call is a *sibling* of the vault read, not nested
inside it, so no cycle is introduced.)

**Delete `findDefaultsForCharacter`** ([wardrobe.repository.ts:127](lib/database/repositories/wardrobe.repository.ts:127)).
Its only production consumer is `resolveDefaultOutfit`, which stops needing it
under change 2; leaving it would be dead code and a second, wrong way to ask
the same question.

**Refactor** [wardrobe-list-handler.ts:84-92](lib/tools/handlers/wardrobe-list-handler.ts:84)
onto the new method.

### 2. `resolveDefaultOutfit` — all three tiers, layered

[apply-outfit-selections.ts:93](lib/wardrobe/apply-outfit-selections.ts:93) takes
the pre-fetched pool (or an `opts` with `projectMountPointIds`), filters
`isDefault`, and fills slots as it does now.

Ordering is now observable, because personal and shared defaults can occupy the
same slot and the LLM prompt treats slot arrays as inner-to-outer. The server
sorts `createdAt` ascending; the client's `buildDefaultOutfit` uses tier-major
insertion order. Export a `sortForDefaultOutfit(items)` from
[lib/wardrobe/default-outfit.ts](lib/wardrobe/default-outfit.ts) (createdAt
ascending, undated last — the existing server rule), and apply it on **both**
sides: `resolveDefaultOutfit`, and
[outfit-selector.tsx:231](components/wardrobe/outfit-selector.tsx:231) and
[:257](components/wardrobe/outfit-selector.tsx:257). Otherwise the composer
preview and the chat that opens disagree about layer order.

### 3. Thread the tiers through `applyOutfitSelections`

- Add `projectMountPointIds: string[]` to `OutfitSelectionContext`
  ([apply-outfit-selections.ts:42](lib/wardrobe/apply-outfit-selections.ts:42)).
  Making it required means TypeScript flags any future call site that forgets.
- Fetch the shared pool **once** before the selection loop; merge per character
  via `mergeWearablePool`.
- `llm_choose` ([:222](lib/wardrobe/apply-outfit-selections.ts:222)) passes the
  merged pool to `chooseLLMOutfit`. The `length > 0` guard now clears for
  shared-only characters.
- Pass `projectMountPointIds` into both `resolveEquippedOutfitForCharacter`
  preview calls ([:262](lib/wardrobe/apply-outfit-selections.ts:262),
  [:310](lib/wardrobe/apply-outfit-selections.ts:310)) — this is defect 3.
- Treat an all-empty `llm_choose` result as a miss and fall back to defaults.
  `chooseLLMOutfit` never fails parsing — it drops invalid ids and returns
  `success: true` with empty slots, leaving the character undressed. Rare
  before; routine once this path becomes reachable for shared-only characters.
- Debug-log the resolved pool size per character (CLAUDE.md logging rule, and
  it makes the prompt-size question below measurable).

Call sites resolve the ids from the project id already in scope, via the
existing `resolveProjectMountPointIds` / `resolveProjectMountPointIdsForChat`
([tiered-mount-pool.ts:228](lib/mount-index/tiered-mount-pool.ts:228)):

- [app/api/v1/chats/route.ts:1174](app/api/v1/chats/route.ts:1174) — `validatedData.projectId`; the file already calls the resolver at line 456.
- [app/api/v1/chats/[id]/actions/participants.ts:191](app/api/v1/chats/[id]/actions/participants.ts:191) — `chat.projectId`.
- [lib/chat/apply-chat-merge.ts:243](lib/chat/apply-chat-merge.ts:243) — `targetChat.projectId`, hoisted **out** of the per-character loop.

### 4. Composite hydration in `resolve-equipped` (required for §2 to be visible)

A shared composite — a "House Livery" bundling coat + waistcoat + boots, all
General items — is the canonical project-wardrobe default, and today it
resolves to **nothing**:
[resolve-equipped.ts:122](lib/wardrobe/resolve-equipped.ts:122) fills `itemsById`
only from the character's vault plus the *equipped* ids, so the components are
absent; `expandComposites` emits each unknown component as a leaf
([expand-composites.ts:64](lib/wardrobe/expand-composites.ts:64)); and
[resolve-equipped.ts:172](lib/wardrobe/resolve-equipped.ts:172) drops leaves
missing from `itemsById`. Empty outfit → blank preview panel, `topIsBare` in
[avatar-prompt.ts:94](lib/wardrobe/avatar-prompt.ts:94), empty live-clothing
override, empty Aurora announcement.

Fix: after the existing `findByIdsForCharacter` fill, collect
`componentItemIds` of everything now in `itemsById` that isn't already present
and do **one** additional bulk `findByIdsForCharacter` (repeat to
`expandComposites`' `maxDepth`; bounded, one query per level). Keep it bulk —
this file is on child-process hot paths (avatar generation, story backgrounds,
scene state).

[outfit.ts:136](app/api/v1/chats/[id]/actions/outfit.ts:136) already gets this
right by seeding the whole archetype set before expanding; this brings the
shared resolver to parity.

---

## Out of scope (flag, don't fix)

- **Cross-tier component refs dropped at parse time.** A character-vault
  composite whose components live in a *project* store, or a project composite
  whose components live in General, loses those refs inside
  `resolveAndCheckComponentItems`
  ([parsers.ts:413](lib/database/repositories/vault-overlay/parsers.ts:413)) —
  the seeding at [vault-readers.ts:304](lib/database/repositories/vault-overlay/vault-readers.ts:304)
  passes no `projectMountPointIds`, and shared readers run `seedArchetypes: false`.
  Same-tier composites (the common case) are unaffected. **Do fix the comment**
  at [project-wardrobe.ts:53-55](lib/mount-index/project-wardrobe.ts:53), which
  claims components resolve against the merged tier set — they don't.
- **Prompt size.** The `llm_choose` pool grows from one vault (~5-30 items) to
  vault + project + General, each item contributing a full description. A large
  shared collection makes this a multi-thousand-token call per character per
  chat creation. The pool-size log lands with this change; capping or
  pre-filtering by `appropriateness` waits until the log shows it matters.
- **Character-scoped `.qtap` exports** carry no `doc_mount_document` records, so
  `equippedOutfit` ids pointing at shared items dangle on import. Pre-existing;
  this change makes it common rather than rare. Full-instance exports are fine.
- **Group tier** — the repository still doesn't accept group mounts.

---

## Docs and copy

- `docs/CHANGELOG.md` — new entry, plain American English.
- `help/wardrobe.md` — §"Outfit Selection When Starting a Chat" (~line 176).
  Its **Default** description (~line 180) is *already wrong*, describing
  `previous_chat` behavior; rewrite as "items marked default across all three
  tiers, layered, with the character's own copy shadowing a shared one." Add a
  line to §"Shared Items (Archetypes)" (~line 95) that a shared item marked
  default is worn by every character.
- `help/project-wardrobe.md` — say project defaults auto-equip at chat start for
  every character in that project's chats.
- `help/chat-multi-character.md:57` — widen "whatever the wardrobe marks as
  default" to all three tiers.
- `docs/developer/API.md:1896` — make `mode: "default"`'s tri-tier scope explicit.
- **UI labels that become untrue**:
  [wardrobe-item-editor.tsx:608](components/wardrobe/wardrobe-item-editor.tsx:608)
  reads "Part of this character's default outfit" even when the "Add to"
  selector above routed the item to General or a project — vary it by scope
  ("Worn by default by every character" / "…every character in this project").
  [ProjectWardrobeManager.tsx:268](components/wardrobe/ProjectWardrobeManager.tsx:268)
  says only "Default item"; same problem, milder.
- Re-check the list in `.claude/commands/update-documentation.md`.

---

## Tests

Coverage here is thin: the only existing test of this module is progress-emission
focused, `chooseLLMOutfit` has none, and the repository's archetype methods have
none. Follow each file's own mock style (globals `jest`, bare `jest.mock`
factories, subject imported after).

**Must extend or they break:**
- [lib/wardrobe/__tests__/apply-outfit-selections.progress.test.ts:56](lib/wardrobe/__tests__/apply-outfit-selections.progress.test.ts:56)
  — the hand-rolled `repos.wardrobe` fake stubs only `findByCharacterId` +
  `findDefaultsForCharacter`; add `findWearablePoolForCharacter` / `findArchetypes`.
  `resolveDefaultOutfit` is **not** inside a try/catch, so a missing method throws.
- [__tests__/unit/lib/tools/handlers/wardrobe-handlers.test.ts:94](__tests__/unit/lib/tools/handlers/wardrobe-handlers.test.ts:94)
  — add a `findWearablePoolForCharacter` fake that delegates to the existing
  `findArchetypes` / `findByCharacterId` stubs, so per-test setups keep working.
  Note it fails *silently* (caught → `success: false`), not loudly.

**New — `__tests__/unit/lib/wardrobe/apply-outfit-selections.tiers.test.ts`:**
- `default` with an empty personal vault + one General default → non-empty slots (the headline regression).
- `default` with personal + project + General defaults → all present, layered, ordered.
- **Shadowing:** shared `X{isDefault:true}` + personal `X{isDefault:false}` → **not** equipped. Catches any regression to filter-then-merge.
- Reverse shadow: shared `X{isDefault:false}` + personal `X{isDefault:true}` → equipped.
- Archived shared default excluded; ordering deterministic across the merge.
- `llm_choose` with an empty vault but a non-empty shared tier → `chooseLLMOutfit` is actually called, and its item argument contains the shared ids.
- All-empty LLM result → falls back to defaults.
- `projectMountPointIds` reaches both the pool fetch and `resolveEquippedOutfitForCharacter`.
- Two selections → shared pool fetched **once**.

**New — `__tests__/unit/lib/database/repositories/wardrobe.repository.pool.test.ts`:**
precedence character > project > general; multiple project mounts (last wins);
archived filtering; `projectMountPointIds: []` short-circuits before importing
the project reader ([:159](lib/database/repositories/wardrobe.repository.ts:159));
a throwing project read is swallowed and other tiers survive ([:171](lib/database/repositories/wardrobe.repository.ts:171)).

**New — `__tests__/unit/lib/memory/cheap-llm-tasks/outfit-selection.test.ts`:**
mock `./core-execution` to capture the parser callback and drive it directly —
shared id in pool accepted; id absent from pool dropped; id whose `types` miss
the slot dropped; legacy scalar shape; per-slot dedupe; fenced JSON; non-object → empty.

**Extend — [__tests__/unit/lib/wardrobe/resolve-equipped.test.ts](__tests__/unit/lib/wardrobe/resolve-equipped.test.ts):**
a composite whose components are neither equipped nor in the character's vault
now resolves to its leaves (asserts empty today).

---

## Verification

1. `npx tsc` (not `npm run build`) and `npm run lint`.
2. `npx jest` on the touched suites, then the full unit run — the repo's
   `--findRelatedTests` is unreliable here.
3. Live check against the running dev instance, tailing `logs/combined.log`:
   - Put a garment in a project store's `Wardrobe/` marked `isDefault`, start a
     chat in that project with a character who has no personal defaults →
     character opens wearing it; the creation dialog's preview panel shows its
     title (defect 3).
   - Same with a General item → equipped in a chat with no project.
   - Give that character a personal copy of the same item id with
     `isDefault: false` → **not** equipped (shadowing).
   - Flip a character to `canChooseOutfit`, leave their vault empty, start a
     chat in a project with a stocked shared wardrobe → the pool-size debug log
     shows a non-zero pool and the LLM equips shared items.
   - Mark a shared **composite** default → the outfit resolves to its component
     leaves, not blank (change 4).
   - Add that character mid-chat via Add Character, and merge a conversation in
     — both paths behave the same as chat creation.
4. `/commit` handles lint, tests, type-check, and the version bump. No
   `packages/` or `plugins/` changes, so no publish gate.
