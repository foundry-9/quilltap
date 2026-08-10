# Character archive & export fidelity — implementation spec

> **Status:** Implementation plan. Not yet scheduled.
> **Parent:** [character-archive-and-export-fidelity.md](character-archive-and-export-fidelity.md) — the
> design document. Its §3 design decisions and §11 rulings are settled and this spec does not
> re-open them. This spec turns the design into concrete, ordered work packages with file-level
> tasks, records the raw-call-site rulings the parent's §6.4 required before implementation,
> and corrects a handful of factual details found during code verification (§10 below).
> **Verified against:** the codebase as of 2026-08-09 (main, post-915f3875). Every file:line
> reference below was checked, not copied from the parent doc.

---

## 0. Work-package overview

| WP | Deliverable | Ships alone? | Depends on |
|---|---|---|---|
| **A1** | File the dangling-avatar import bug | yes — do regardless | — |
| **A2** | Export fidelity: character bundles carry the vault + avatar remap on import | yes | — |
| **B1** | `preserveIds` manifest flag + refuse-on-collision import path | no (no consumer until B2/B4) | A2 |
| **B2** | Schema/migration, archive service, tombstone read path, write guards | no | A2, B1 |
| **B3** | Surfaces: pickers, roster, badges, read-only viewer, CLI, help | no | B2 |
| **B4** | Rehydration + re-embedding | no | B1, B2 |

A2 is worth shipping on its own (it fixes real cross-instance import breakage) and shrinks the
v5 drift catch-up if B slips.

---

## 1. WP A1 — file the avatar bug

**Done (2026-08-09):** filed as
[Bug 52](../bugs/bug-52-avatar-import-dangling.md) with its index row in
`docs/developer/bugs.md`. For the record:

- **Symptom:** importing a `characters` .qtap into another instance yields a faceless character.
- **Root cause:** `characters.defaultImageId` is a `doc_mount_file_links.id` into the source
  instance's vault; `streamCharacters` (`lib/export/ndjson-writer.ts:143`) never exports the vault
  or the bytes, and `reconcileRelationships` (`lib/import/quilltap-import/reconcile.ts:46–129`)
  remaps `tags`, `defaultPartnerId`, `defaultConnectionProfileId`, `defaultImageProfileId`,
  `defaultRoleplayTemplateId`, and `characterDocumentMountPointId` — but **not** `defaultImageId`
  or `avatarOverrides[].imageId`. They import verbatim and dangle.
- **Fix site:** WP A2 (this spec). The bug file should point here.

---

## 2. WP A2 — export fidelity

### 2.1 Extract `streamOneStore`

The per-store body of `streamDocumentStores` (`lib/export/ndjson-writer.ts:521–638`) closes over
only `repos` (from `getRepositories()`) and the shared `counts` object — no cross-store state.
Lift it into:

```ts
async function* streamOneStore(repos, mountPointId: string, counts, opts?: { skipProjectLinks?: boolean })
```

`streamDocumentStores` becomes a `for … yield*` loop over it. It already emits, per store:
`doc_mount_point` (with `id`), parent-first `doc_mount_folder`s, `doc_mount_document`s
(text fileTypes only), `doc_mount_blob` + ordered `doc_mount_blob_chunk`s, and
`project_doc_mount_link`s. Character vaults have no project links; pass `skipProjectLinks: true`
from the characters path (harmless either way, but keeps bundles clean).

**Chunking invariants (do not disturb):** `BLOB_CHUNK_BYTES = 3 * 1024 * 1024`
(`ndjson-writer.ts:46`) must stay a multiple of 3 — each chunk is base64-encoded separately and
the reader concatenates the *encoded* strings; completion is detected by **counting** received
chunks (`quilltap-import-stream.ts:296–333`), never `Array.every`; leftover accumulators at EOF
throw "NDJSON export truncated" (`quilltap-import-stream.ts:421–441`).

### 2.2 Emit the store from `streamCharacters`

In `streamCharacters` (`ndjson-writer.ts:143–226`), after `character_plugin_data` and before
`memory`, when `char.characterDocumentMountPointId` is set:

```ts
yield* streamOneStore(getRepositories(), char.characterDocumentMountPointId, counts, { skipProjectLinks: true });
```

Doc-store record kinds are parented by `mountPointId`, not `characterId`, so ordering relative
to the `character` line is free — but keep them after it for readability, and `doc_mount_blob`
must precede its chunks (the generator already guarantees this).

### 2.3 Carry row ids for links and files (the id question)

Today `ExportedDocumentStoreDocument`/`Blob` (`lib/export/types.ts:318–362`) carry **no row ids**
— identity is path/sha256, and `importDocumentStores` mints fresh file/link ids via
`linkDocumentContent` (`import-document-stores.ts:173–183`). That is fine for content, fatal for
the avatar fix (defaultImageId is a *link* id) and for B's id preservation.

**Decision: extend the existing record shapes with optional id fields rather than adding new
`doc_mount_file` / `doc_mount_file_link` record kinds.** (The parent doc's §5.1 table sketched
new kinds; additive optional fields on known kinds are strictly more backward-compatible — an
old build ignores unknown fields inside a known kind with no warning noise, and neither JSON
schema needs new kind entries, only new optional properties.)

- `ExportedDocumentStoreDocument` gains optional `fileId`, `linkId` (and already carries
  `linkGroupId` semantics via the existing linkGroup re-bind pass,
  `import-document-stores.ts:198–209` — keep that).
- `ExportedDocumentStoreBlob` gains optional `fileId`, `linkId`, `blobId`.
- `streamOneStore` populates them; `importDocumentStores` records `old linkId → new linkId` into
  a new `idMaps.docMountFileLinks` when present (fresh ids by default; `{ id: old }` only under
  `preserveIds`, WP B1).

If implementation reveals a hard-link topology the extended fields can't express (multiple links
sharing one file where per-document records would duplicate the file), fall back to the parent
doc's new-kinds design — but the linkGroup pass suggests the current protocol already models it.

### 2.4 Reader and import side

- `buildExportDataForType` (`lib/import/quilltap-import-stream.ts:534–590`): the `'characters'`
  branch (539–543) additionally returns the already-collected `mountPoints`, `folders`,
  `documents`, `blobs` arrays (they are accumulated regardless of exportType today and merely
  discarded by the switch). Update `lib/import/quilltap-import/types.ts` (`AnyExportData` /
  the characters export-data shape) to match.
- `executeImport` (`lib/import/quilltap-import/execute.ts:140–573`) runs characters at step 6 and
  document stores at step 7c — the order already works: `repos.characters.create()` provisions a
  scaffold vault (`characters.repository.ts:248` always calls `ensureCharacterVault`), then the
  bundle's store imports at 7c as its own mount point.
- **Collision rule for the scaffolded vault: bundle wins, whole-store.** After 7c, for each
  imported character whose bundle carried a mount point: repoint
  `characterDocumentMountPointId` to the imported mount (in `reconcileRelationships`, replacing
  the current only-remap-if-resolvable logic at `reconcile.ts:99–113` for this case) and delete
  the scaffold vault through `deleteStoreCascade(scaffoldMountId)`
  (`lib/mount-index/delete-store-cascade.ts:57`) — the chokepoint that runs link-group orphan GC.
  No merging of scaffold files into the bundle store, ever.
- **Avatar remap** in the `reconcileRelationships` character loop, alongside the existing FK
  remaps (~`reconcile.ts:88`): remap `defaultImageId` and every `avatarOverrides[].imageId`
  through `idMaps.docMountFileLinks`; if an id is present but not in the map, check
  `repos.files.findById` — a hit means a **legacy `files.id`** avatar (the dual shape
  `resolveCharacterAvatar` handles, `lib/photos/resolve-character-avatar.ts:77–110`) and must be
  left alone; a miss means null-it-with-a-warning. **Never leave a dangling id.** Field-set
  precedent: `lib/backup/restore/uuid-remap.ts:95` (defaultImageId) and `:117–122`
  (avatarOverrides).
- `skip` / `overwrite` / `duplicate` semantics unchanged; under `skip`, store records for the
  skipped character are not applied.

### 2.5 Everything-else checklist (from `lib/export/types.ts:31–53`)

The header comment there is the authoritative list. For this change (no new exportType, possibly
no new kinds):

- `lib/export/quilltap-export-service.ts` `previewExport` — report store/blob counts and an
  estimated bundle size for the characters type (parent §5.4).
- `components/tools/import-export/` — preview step shows the new counts/size.
- `public/schemas/qtap-export.schema.json` — extend `ExportedDocumentStoreDocument`/`Blob` defs
  with the optional id fields; note that doc-store sections may appear under exportType
  `characters`. `public/schemas/qtap-export-ndjson.schema.json` — same field additions; prose
  note that doc-store kinds may appear in a `characters` stream.
- Manifest `counts` already has all the doc-store keys (`types.ts:90–115`) — bump them from the
  characters path too.

### 2.6 A2 tests

- **Round-trip:** export a character with populated `photos/`, `Mail/`, and a multi-chunk blob →
  import into a clean instance → assert every vault path present, blob sha256s match, and
  `defaultImageId` + each `avatarOverrides[].imageId` resolve via `resolveCharacterAvatar`.
- **Legacy avatar:** a character whose avatar is a legacy `files.id` imports with the id intact.
- **Compat pair:** new-writer stream against the old reader behavior (unknown-field tolerance —
  simulate by stripping the new fields) imports a working lossy character; old-writer file (no
  store records) still materializes managed fields on the row.
- **Chunk boundaries:** blob at exactly `BLOB_CHUNK_BYTES`, one under, one over; truncated
  stream throws.
- **Scaffold replacement:** the scaffold vault is gone after import (no orphan mount points),
  and `skip` mode leaves the existing character's vault untouched.

---

## 3. WP B1 — `preserveIds`

- Add `preserveIds?: boolean` to `QuilltapExportSettings` (`lib/export/types.ts:78–85`) so it
  rides the manifest envelope; the archive writer sets it, ordinary export UI never does. Update
  both JSON schemas.
- **Mechanism already exists:** `CreateOptions.id`
  (`lib/database/repositories/base.repository.ts:23–30`) is honored by `_create`
  (`characters.repository.ts:308` uses `options?.id || randomUUID()`), and
  `lib/backup/restore/restore.ts` already passes `{ id: row.id }` for characters (:149) and for
  every `doc_mount_*` repo (:395, :524–608). The import path just needs to thread the option:
  `importCharacters` stops destructuring the id away (`import-characters.ts:138–141`) and passes
  `{ id }`; `importDocumentStores` passes `{ id }` for mount points (it already can —
  `import-document-stores.ts:102–121`), folders, files, links, documents, blobs; memories
  likewise.
- **Refusal, not fallback:** before any write, a pre-scan collects every id the bundle would
  claim (characters, mount points, folders, files, links, documents, blobs, memories) and checks
  existence; any hit throws a named `PreserveIdsCollisionError` listing the colliding ids. No
  partial application, no silent remint (parent §3.2).
- `preserveIds` composes with conflict mode: the archive/rehydrate flow always uses it with an
  effectively-`duplicate`-into-empty semantics; the ordinary import wizard never surfaces it.
- **Tests:** preserveIds round-trip restores every row at its original id; a single colliding
  memory id refuses the whole import and changes nothing.

---

## 4. WP B2 — schema, archive service, tombstone semantics

### 4.1 Migration and schema

- `migrations/scripts/add-character-archive-fields.ts` (model:
  `add-character-manifesto-field.ts`): `ALTER TABLE "characters"` add `archivedAt TEXT`,
  `archiveFileId TEXT`, `archivedAvatarFileId TEXT`; `shouldRun` via
  `getSQLiteTableColumns('characters')`; register in `migrations/scripts/index.ts`.
  `PRETTY_LABELS` entry in `lib/startup/prettify.ts` (steampunk voice). Pure ALTER — no loop, no
  `reportProgress` needed.
- `FileCategoryEnum` (`lib/schemas/file.types.ts:23`) gains `'ARCHIVE'`. The column is untyped
  TEXT (`docs/developer/DDL.md:930`) — no SQL migration for it.
- **ARCHIVE export exclusion — all four BACKUP-rule sites:** `ndjson-writer.ts:691` and `:894`,
  `app/api/v1/system/tools/route.ts:568`, and the documented rule in
  `public/schemas/qtap-export.schema.json:1466,1476`.
- Character Zod schema + `qtap-export.schema.json` character def gain the three nullable fields
  (tombstones must survive backup/export of the *row*); update `docs/developer/DDL.md`.
- Backup/restore: `uuid-remap.ts` character block (:92–145) additionally remaps `archiveFileId`
  / `archivedAvatarFileId` through the files map; restore must land archived characters still
  archived. `.qtap` export/import of a tombstone row carries the fields (per the
  export/import-all-fields rule) — but exporting an *archived* character via the normal wizard
  should either export the tombstone as-is or be blocked with a "rehydrate first" message;
  **decision: block it** (a tombstone export is useless and the bundle already exists as a file).

### 4.2 Archive service

New `lib/characters/archive-service.ts` (operator-only; no tool, no job, no sweep — parent
§11.4). Order of operations, chosen for crash-safety since main-DB and mounts-DB can't share a
transaction (deviates from the parent's §6.3 numbering; §6.3 allows "a documented order"):

1. **Write the bundle:** run the characters export (WP A2 writer, `includeMemories: true`,
   `preserveIds: true` in the manifest) to a `files` row, category `ARCHIVE`, under `/archives`.
2. **Verify the bundle** by streaming it back through the reader: memory count matches the
   character's live memory count, store record counts match, footer counts match (parent §11.1
   makes this a hard gate before any delete).
3. **Copy the avatar thumbnail:** `readCharacterAvatarBuffer`
   (`lib/photos/resolve-character-avatar.ts:127`) → new `files` row (category `AVATAR`) →
   `archivedAvatarFileId`.
4. **Commit point — one main-DB transaction:** set `archivedAt`, `archiveFileId`,
   `archivedAvatarFileId`; null `characterDocumentMountPointId`, `defaultImageId`,
   `avatarOverrides`, and the `default*` FKs; flip the character's chat-participant rows to a
   non-present status (see §4.5). A crash before this leaves a fully live character plus a
   harmless orphan bundle file; after it, an archived tombstone with stray derived data.
5. **Cleanup (idempotent, re-runnable):** delete the vault via
   `deleteStoreCascade(mountId)` (`lib/mount-index/delete-store-cascade.ts:57` — the chokepoint,
   runs `deleteWithGC` link-group orphan GC); delete vector store
   (`getVectorStoreManager().deleteStore(characterId)`, cf. `lib/cascade-delete.ts:388`),
   `embedding_status` rows, and character-owned conversation-summary chunks; delete the
   character's own memories through `deleteMemoriesWithUnlinkBatch`
   (`lib/memory/memory-gate.ts:535`) — **never** `repos.memories.delete*` (parent §11.1); leave
   `aboutCharacterId` rows held by others untouched (parent §11.2). A failed step here leaves
   the character archived; re-running cleanup (exposed as part of retrying archive on an
   already-archived row) finishes the job.

Untouched, by design: chats, chat_messages, annotations, `group_character_members`,
`projects.characterRoster`, other characters' memories (parent §6.3, §11.5).

**Failure semantics:** a failure before step 4 deletes the bundle file and reports the character
still live. A failure in step 5 reports "archived, cleanup incomplete" and the operation is
safely re-runnable.

### 4.3 Tombstone read path

Verified nuance: because archiving nulls `characterDocumentMountPointId`, the overlay *already*
passes the hollow row through — `applyDocumentStoreOverlayOne` short-circuits when there is no
linked vault (`read-overlay.ts:371–376`), and the throw
(`CharacterVaultUnavailableError`, `hydrateOne` keystone check at `read-overlay.ts:154–157`) /
drop (`applyDocumentStoreOverlay:341–351`) only fire when a pointer exists but `properties.json`
is unreadable. The parent doc's "single most important change" is therefore smaller than feared
— but still add the explicit branch for robustness against a pointer that somehow survives:

- Top of `hydrateOne` (`read-overlay.ts:136`): `if (character.archivedAt) return character;` —
  one line covers both the single and batched paths.
- Optionally beside `hasLinkedVault` in `applyDocumentStoreOverlayOne` (:374) to skip the map
  load.

`findAll`/`findByUserId` continue to **include** tombstones (list consumers filter by state, not
the repo — see §5.1); `UserScopedMemoriesRepository`'s ownership gate keeps working because
`findById` resolves the tombstone (parent §6.4).

### 4.4 Write guards

- **Repository:** top of `CharactersRepository.update()` (`characters.repository.ts:284`), i.e.
  **before** `applyDocumentStoreWriteOverlay` — critical, because the write overlay
  auto-provisions a fresh vault for a row with no mount when the patch carries managed fields
  (`vault-overlay/managed-fields.ts:~394`), which would resurrect the tombstone's vault. Read
  `findByIdRaw`; if `archivedAt` is set and the patch is not the sanctioned rehydrate shape
  (patch that clears `archivedAt`), throw a named `CharacterArchivedError`. Every sub-array
  mutator, partner-link helper, favorite/controlledBy/canBeCarina setter, and system-prompt /
  scenario helper funnels through `update()` (`characters.repository.ts:425–843`), so one guard
  covers them all. `delete()` (:394) stays unguarded — cascade-deleting an archived character is
  the escape hatch and works on a tombstone (verified: `lib/cascade-delete.ts:125/263/308` all
  behave correctly on a hollow row).
- **Vault writes:** covered by the same guard (it precedes the write overlay). The `doc_edit`
  path resolver needs no change — `resolveSelfVaultMountPointId`
  (`lib/doc-edit/path-resolver.ts:58`) returns null for a null pointer and tools degrade with a
  sentence, not a crash.
- **`ensureCharacterVault` resurrection hazards** (each would silently re-provision a vault for
  a tombstone):
  - `lib/startup/backfill-character-vaults.ts:51` — **must skip `archivedAt` rows.** The worst
    one: every boot would resurrect every tombstone.
  - `lib/tools/handlers/list-email-handler.ts:49–54` and
    `lib/tools/handlers/send-mail-handler.ts:52` (sender *and* recipient resolution) — named
    refusal for an archived character.
  - `app/api/v1/chats/[id]/actions/mailbox.ts:39–44` and
    `app/api/v1/chats/[id]/actions/send-mail.ts:44,48` — refuse when the character is archived.

### 4.5 Turn participation

Cheapest systemic fix: at archive time (step 4 above), flip the character's participant rows in
every chat to a non-present status — then `isParticipantPresent` filters archived seats out of
the LLM-candidate filter (`participant-resolver.service.ts:127–132`), `selectNextSpeaker`, and
the turn orchestrator's active-participant scan (`turn-orchestrator.service.ts:166–178`) for
free, and rehydration flips them back. Backstops regardless:

- `resolveRespondingParticipant` character load (`participant-resolver.service.ts:192–196`):
  after the load, `if (character.archivedAt) throw new CharacterArchivedError(...)` with the
  operator-facing message "this character is archived; rehydrate it to continue" — replacing a
  500 with a sentence (parent §6.4.3).
- Carina probes must exclude archived: the per-turn `ask_carina` availability probe
  (`lib/services/chat-message/orchestrator.service.ts:891`) and the self-inventory Carina
  section (`lib/tools/handlers/self-inventory/builders.ts:675`) both `findAllRaw` and must
  filter `!c.archivedAt`.

### 4.6 Raw-call-site rulings (the parent §6.4 audit — recorded, settled)

Full sweep of characters-repo `findByIdRaw`/`findAllRaw` sites. **Change required (7):**

| Site | Ruling |
|---|---|
| `lib/startup/backfill-character-vaults.ts:51` | **Skip archived** — vault-resurrection hazard (§4.4) |
| `lib/tools/handlers/list-email-handler.ts:49` | **Refuse archived** (named error) — calls `ensureCharacterVault` |
| `lib/tools/handlers/send-mail-handler.ts:52` | **Refuse archived sender; skip archived recipients** in `resolveCharacterByNameOrId` |
| `app/api/v1/chats/[id]/actions/mailbox.ts:39` | **Refuse archived** — calls `ensureCharacterVault` |
| `app/api/v1/chats/[id]/actions/send-mail.ts:44,48` | **Refuse when sender or recipient archived** |
| `lib/services/chat-message/orchestrator.service.ts:891` | **Filter archived** from the Carina-answerer probe |
| `lib/tools/handlers/self-inventory/builders.ts:675` | **Filter archived** from reachable Carina answerers |

**Fine as-is (no change):** `lib/cascade-delete.ts:125,263,308` (delete stays possible on a
tombstone); `lib/doc-edit/path-resolver.ts:58` and `uri-producers.ts:28` (null pointer → clean
degradation); `lib/services/prospero-notifications/writer.ts:551`,
`lib/services/aurora-notifications/core-whisper.ts:147`,
`lib/post-office/surface-operator-mail.ts:69` (null pointer → skip);
`lib/memory/recall-replay.ts:122` (diagnostic), `lib/memory/fold-episode-pass.ts:94` and
`lib/file-storage/conversation-summary-vault-bridge.ts:122` (need only `name`, which the
tombstone keeps — desirable, old chats keep correct names);
`lib/database/repositories/vault-overlay/wardrobe-writes.ts:75`, `lib/pascal/workbench.ts:125`,
`lib/startup/migrate-vault-physical-files.ts:68`, `lib/startup/refresh-vault-wardrobe.ts:53`
(existing null-mount skips); `lib/services/carina/carina.service.ts:277,319` (asker flags —
archived askers can't take turns); `app/api/v1/characters/[id]/handlers/delete.ts:26`
(existence check before cascade delete); overlay/vault internals
(`vault-overlay/managed-fields.ts:367,396` — guarded upstream by §4.4;
`lib/mount-index/character-vault.ts:85`; `characters.repository.ts:352`).

**One cosmetic fix:** `vault-overlay/wardrobe-sync.ts:58` — the no-vault branch (~:66)
`logger.error`s; add an `archivedAt` early-return above it returning `[]` at debug level so
tombstones don't scream into the log on every wardrobe read.

**One split ruling:** `app/api/v1/characters/[id]/handlers/put.ts:111` — the rehydrate action
routes through here, so no blanket refusal; the repo-level guard (§4.4) blocks everything except
the sanctioned unarchive patch. Depiction-guidelines on a tombstone already 400s (null mount).

### 4.7 Delete All Data / restore-replace (parent §11.3)

- `lib/backup/restore/delete-service.ts` (note the path — the parent doc says
  `lib/backup/delete-service.ts`): `deleteUserData` (:96) / `deleteAllUserData` (:221) /
  `previewDeleteAllUserData` (:305) have **no options bag today**; add
  `options?: { keepArchivedCharacterBundles?: boolean }` (default **true** — the destructive
  choice must be the explicit one). When keeping: spare `files` rows with category `ARCHIVE`
  (and their on-disk bytes) from the files loop (:150–157). Per the settled ruling, tombstone
  `characters` rows do **not** survive (they are ordinary rows), and `archivedAvatarFileId`
  thumbnails die with them — the survivor is a **loose bundle**: importable, not rehydratable.
- Restore replace-mode: `lib/backup/restore/restore.ts:40` calls the delete service (~:58);
  thread the same flag through `RestoreOptions` (`lib/backup/types.ts:428`).
- Both wizard dialogs gain the checkbox with copy that states the loose-bundle consequence
  explicitly: `components/tools/delete-data-card.tsx` (steps at :36, POST at :95 — the flag
  rides the request body, so the API contract moves) and
  `components/tools/restore/RestoreDialog.tsx`.

---

## 5. WP B3 — surfaces

### 5.1 API and pickers

The single chokepoint is `GET /api/v1/characters`
(`app/api/v1/characters/handlers/get.ts:20`): default to filtering `archivedAt IS NULL`, add an
`?archived=true` opt-in that returns *only* (or additionally — pick one; recommend
`archived=include|only|exclude(default)`) tombstones. That covers every verified consumer:
`components/chat/AddCharacterDialog.tsx:87`, `components/new-chat/hooks/useNewChat.ts:203`,
`app/aurora/groups/hooks/useGroupMembers.ts:38`,
`components/wardrobe/wardrobe-control-dialog.tsx:253`,
`components/tools/search-replace/steps/ScopeSelectionStep.tsx:51`,
`components/chat/ComposeMailDialog.tsx:93`, `GenerateImageDialog.tsx:53`,
`InsertAnnouncementDialog.tsx:122`, `components/images/image-detail/ImageDetailModal.tsx:44`,
`components/help-chat/HelpEntityPicker.tsx:38`, `components/chat/MergeConversationModal.tsx`.
Server-side, the project-roster action validates per-id (`app/api/v1/projects/[id]/actions/roster.ts:32,70`)
— refuse *adding* an archived character there, but never delete existing roster edges (parent
§11.5). Extend `queryKeys.characters.list(filters)` (`lib/query/keys.ts:26–31`) with the
archived filter so caches don't cross-contaminate.

### 5.2 Roster, badges, viewer

- **Aurora roster** (`app/aurora/AuroraView.tsx:112`): an "Archived" filter view using the
  opt-in param; tombstones render name + `archivedAvatarFileId` thumbnail + `archived` badge.
  Group membership lists show the badge inline so "6 members / 4 can speak" is reconcilable
  (parent §11.5).
- **Chat rendering:** old messages keep rendering from the tombstone.
  `resolveCharacterAvatar` needs a third branch (after the legacy-file fallback at
  `resolve-character-avatar.ts:97`): when the character is archived, resolve
  `archivedAvatarFileId` via the existing legacy-file path. `getMessageAvatar` lives in
  `app/salon/[id]/SalonView.tsx:1152` (not `page.tsx` as the parent doc says); participant
  chips get the badge.
- **Read-only detail view:** streams the bundle from `archiveFileId` through the WP A2 reader
  on demand — parsed per request, never hydrated into the DB, never cached beyond the request;
  every field disabled (parent §6.5). New item action on the characters API
  (`?action=archive-inspect` or similar) under the v1 action-dispatch pattern.
- **Archive/rehydrate UI:** actions on the character detail/menu, with a confirm dialog spelling
  out what archiving deletes (memories included). All new strings in the steampunk register.

### 5.3 CLI

`packages/quilltap` — extend `cmdCharacters` (`lib/db-commands.js:925`, currently only
`status`): `characters archives` (list ARCHIVE files + tombstones), `characters archive <name|id>`
and `characters rehydrate <name|id>` — both writes, gated on `--write` + instance lock via
`lib/lock-helpers.js` (`acquireInstanceLock`); never `--lock-override`. Bump the CLI version
(auto-published; no manual `npm publish` ask). Update `docs/developer/CLI.md`.

### 5.4 Docs

- Help (steampunk voice, each with `url` frontmatter + matching `help_navigate` nav section):
  `help/character-management.md` (archive/rehydrate lifecycle, the memory asymmetry — "archiving
  silences the character, not everyone's memory of them"), `help/character-import-export.md`
  (what now travels: vault, photos, mail, avatar), `help/system-import-export.md` and
  `help/system-backup-restore.md` (ARCHIVE files, the keep-bundles wipe option and its
  loose-bundle consequence).
- `docs/CHANGELOG.md` (plain voice), `docs/developer/DDL.md`, `docs/developer/API.md`.

---

## 6. WP B4 — rehydration

`rehydrate(characterId)` in the archive service:

1. Load the bundle from `archiveFileId`; validate manifest (`format`, `preserveIds` set) and
   that the bundle's character id equals the tombstone's id.
2. Pre-scan for collisions (WP B1): refuse if any claimed id exists — including a live character
   at that id (possible after a restore or hand-edited library, parent §6.6.2). The tombstone
   itself is expected and excluded from the character-id check (it will be updated, not created).
3. Run the WP B1 import path with `preserveIds`: store restored at original
   mount/folder/file/link/blob ids, memories at theirs. Because the tombstone row exists, the
   character step *updates* the row rather than `create()` (avoiding the scaffold-vault provision
   entirely): restore the managed/vault fields is unnecessary (they live in the vault), restore
   `defaultImageId`, `avatarOverrides`, the `default*` FKs, and `characterDocumentMountPointId`
   from the bundle's character record via the sanctioned-unarchive patch shape.
4. Clear `archivedAt` / `archiveFileId` / `archivedAvatarFileId`; delete the thumbnail `files`
   row; flip participant rows back to present (§4.5).
5. Re-embed: memories via the `enqueueImportedMemoryEmbeddings` fan-out — **currently
   module-private** in `lib/import/quilltap-import/execute.ts:62`, export it; vault chunks via
   `enqueueEmbeddingJobsForMountPoint` (`lib/mount-index/embedding-scheduler.ts:25`).
6. Leave the bundle file in the library (cheap insurance); offer deletion in the UI.

No reconcile pass needed: chat participants, memories, group memberships, and roster entries
re-resolve because every id is original.

**Failure semantics:** any failure before step 4's clear leaves the character archived with the
bundle intact (parent §6.1); the collision refusal changes nothing.

---

## 7. Test plan (concrete suites)

Beyond the WP A2 tests (§2.6) and WP B1 tests (§3), per the parent §12:

- **Archive/rehydrate identity:** archive → assert vault rows, chunks, vector store,
  `embedding_status`, and own memories gone; chat still renders (name + thumbnail); rehydrate →
  every vault path/blob/memory back at original ids, participants/groups/rosters resolve with no
  reconcile; `relatedMemoryIds` intact on both sides of the archive boundary.
- **Read-only:** repository `update`, each sub-array mutator, `doc_edit`, wardrobe writes, mail
  send/list (tool + API), and turn participation each refuse an archived character with the
  named error — not a crash, not a silent no-op (today's missing-row `UPDATE` is a silent no-op;
  the guard must be observable).
- **Overlay:** archived row passes through `hydrateOne`/`applyDocumentStoreOverlay` unhollowed
  and undropped; an archived row with a stray surviving mount pointer still returns the
  tombstone (the §4.3 branch).
- **Resurrection guards:** boot with tombstones present — `backfill-character-vaults` provisions
  nothing; mail delivery to an archived recipient refuses and provisions nothing.
- **Memory asymmetry:** after archive, own memories absent from search/recall/memories tab;
  another character's `aboutCharacterId` memory still retrievable and still resolves the name.
- **Collision:** rehydrate into an instance already holding any claimed id refuses atomically.
- **Wipe options:** Delete All Data and restore-replace, each × {keep, wipe}: keep → ARCHIVE
  files survive, tombstones don't, bundle imports but doesn't rehydrate; wipe → nothing survives.
- **Group counts:** group with an archived member reports full count, badge in the list, only
  live members offered for a turn.
- Jest suites touching the real SQLCipher binding need the `@jest-environment node` docblock and
  root-path `require` of `better-sqlite3` (established conventions).

---

## 8. Sequencing summary

1. **A1** — file the bug (independent, immediate).
2. **A2** — `streamOneStore` extraction → characters emission → reader/`buildExportDataForType`
   → importer scaffold-replacement + avatar remap → schemas/preview → tests. **Ship.**
3. **B1** — `preserveIds` threading + collision pre-scan + tests.
4. **B2** — migration → ARCHIVE category + exclusions → archive service → overlay branch +
   write guard + participant flip + the 7 call-site fixes → delete-service/restore options →
   tests.
5. **B3** — GET filter + pickers → roster/badges/viewer → CLI → help/CHANGELOG/DDL/API docs.
6. **B4** — rehydrate + re-embed + tests.

Each of B2–B4 lands with its tests; the write guard (§4.4) and the backfill skip must land in
the same change as the migration — a tombstone must never exist on an instance whose boot path
would resurrect it.

---

## 9. v5 note

Everything here lands on already-ported v4 surfaces (`lib/export/**`,
`lib/import/quilltap-import/**`, the characters repository, the vault overlay, backup/restore,
the SPA), so expect a multi-lane v5 drift catch-up with new fixtures: a store-bearing character
bundle, an archived-character read, and a preserveIds import. Shipping A2 first keeps the first
catch-up small.

---

## 10. Corrections to the parent doc (verified against code)

Recorded so the parent doc's next revision can absorb them; none change the design.

1. The Delete All Data service is `lib/backup/restore/delete-service.ts`, not
   `lib/backup/delete-service.ts`, and it has no options bag yet.
2. `getMessageAvatar` lives in `app/salon/[id]/SalonView.tsx:1152`, not `page.tsx`.
3. `enqueueImportedMemoryEmbeddings` is module-private in
   `lib/import/quilltap-import/execute.ts:62` and must be exported for rehydration.
4. The overlay does **not** throw for a hollow row whose mount pointer is null — it passes it
   through (`read-overlay.ts:371–376`). The throw/drop only fires when a pointer exists but the
   vault is unreadable. The archived branch is still added, as a robustness guard, but it is a
   one-liner, not a load-bearing rework.
5. Import step order already accommodates character-owned stores (characters at step 6, doc
   stores at 7c) — no reordering needed; the scaffold-vault replacement happens in reconcile.
6. The parent's §5.1 `doc_mount_file` / `doc_mount_file_link` record kinds are replaced by
   optional id fields on the existing `doc_mount_document` / `doc_mount_blob` shapes (§2.3) —
   strictly better back-compat; revisit only if hard-link topology demands it.
7. `components/files/FileBrowser.tsx` has no `FileCategory` filter to extend — ARCHIVE files
   need no file-library UI work beyond the export exclusions.
8. The biggest unlisted hazard class is **vault resurrection** via `ensureCharacterVault` — the
   startup backfill and the four mail paths (§4.4) — which the parent's audit list only
   partially covered.
