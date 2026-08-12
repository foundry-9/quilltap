# Character archive, rehydration, and export fidelity

> **Status:** Largely implemented; design revised. The operative document is the
> [implementation spec](character-archive-spec.md) — Deliverable A and the archive core
> (schema, guards, prune, encryption) have shipped; surfaces (B3) and rehydration (B4) remain.
> **Revision (2026-08-10, spec §4.2a): archiving prunes the vault in place rather than
> deleting it.** The managed-field documents, the avatar and its link row, and the wardrobe
> stay live, so a tombstone is a fully readable character page and every id old chats
> reference keeps resolving. Passages below describing a deleted vault, a hollow tombstone,
> an overlay short-circuit, or the `archivedAvatarFileId` thumbnail are **superseded** and
> marked where they occur; where this document and spec §4.2a disagree, §4.2a wins.
> **Author of plan:** Ariadne (research/scoping pass), for Charlie.
> **Scope:** Two deliverables sharing one bundle format. **(A)** Make the `characters`
> `.qtap` export *faithful* — carry the character's vault documents and blobs (including
> the avatar) instead of only the materialized managed fields. **(B)** Add an **archive**
> lifecycle: pack a character into that bundle, retire it to a read-only tombstone that
> every existing read path already understands, and **rehydrate** it later at its original
> id so its old conversations still resolve.
>
> Deliverable A is independently shippable and is a prerequisite for B.

---

## 1. The feature in one paragraph

A character today is a slim DB row plus a document-store vault (`characters.characterDocumentMountPointId`), and the `characters` export only carries the row *after* the vault overlay has flattened the managed fields onto it. Everything else in the vault — `Mail/`, `photos/`, free notes, image history, the avatar bytes themselves — is silently left behind, and `defaultImageId` exports as a dangling link id. **Deliverable A** teaches `streamCharacters` to emit the character's own store (folders, files, links, documents) and its blobs using the chunking protocol that already exists for the `document-stores` and `files` export types, so a character round-trips with its face and its papers intact. **Deliverable B** builds on that: *archiving* a character writes the same bundle to the library (encrypted under the instance passphrase), **prunes** the live vault down to the managed-field documents, the avatar, and the wardrobe (spec §4.2a — the original design deleted the vault outright), deletes the derived data and the character's own memories, and leaves the `characters` row behind as a read-only **tombstone** that still renders a full character page; *rehydrating* restores the pruned material back into the surviving mount at its original ids. Because the tombstone is a real row with a real vault, every one of the ~265 existing `repos.characters.*` call sites keeps working without a virtual-overlay layer.

---

## 2. What's wrong today (evidence, not assertion)

Measured against a real export (`quilltap-characters-2026-08-09.qtap`, one character, app 4.8.0-dev.186): 18 KB, six NDJSON lines — envelope, one `character`, four `wardrobe_item`, footer.

1. **The vault does not travel.** `streamCharacters` (`lib/export/ndjson-writer.ts:143–226`) emits `character`, `wardrobe_item`, `character_plugin_data`, and optionally `memory`. It emits no `doc_mount_*` records at all. The vault's non-managed contents are lost.
2. **The avatar does not travel, and the reference breaks.** `characters.defaultImageId` is a `doc_mount_file_links.id` pointing at the vault (see the layout comment in `lib/file-storage/character-vault-bridge.ts`). It is exported verbatim; `reconcileRelationships` (`lib/import/quilltap-import/reconcile.ts`) never remaps or nulls it; the bytes never travel. **Every cross-instance character import today produces a faceless character with a dangling id.** Same for each `avatarOverrides[].imageId`. This is a defect independent of this feature and should be filed in the bug catalogue (`docs/developer/bugs.md`) regardless of whether this plan is scheduled.
3. **Ids are always re-minted.** `importCharacters` destructures `{ id, userId, createdAt, updatedAt }` away and calls `repos.characters.create(...)`, which mints a fresh UUID *and* provisions a fresh vault. Correct for import; fatal for rehydration, because chat participants reference `characterId` in a JSON array with no foreign key, as do `memories.characterId`/`aboutCharacterId`, `chats.characterAvatars`, `group_character_members`, and `projects.characterRoster`.
4. **There is no archive concept.** `archivedAt` exists only on wardrobe items (vault frontmatter `archived: true` / `archivedAt`, per `lib/mount-index/character-vault.ts` `buildWardrobeItemFile`). No other table carries `archivedAt`, `deletedAt`, or any soft-delete column; characters hard-delete through `executeCascadeDelete`.

---

## 3. Design decisions already settled (do not re-litigate)

1. **One bundle format, two id policies.** The archive artifact **is** a `characters` `.qtap` bundle. It is not a second format. Archive sets a manifest flag requesting id preservation; ordinary import never does.
2. **Id preservation is a refusable request, not a mode of the writer.** `preserveIds` is honoured **only** when every id it would claim is absent from the target instance. On collision the import refuses with a named error — it never silently falls back to remapping, because a half-preserved graph is worse than either outcome.
3. **The archived character keeps its `characters` row.** The row is the overlay. A virtual read layer that manufactures characters from a file is explicitly rejected (§9.1).
4. **Embeddings never travel.** `stripEmbedding()` stays, on both the export and archive paths, at the writer and again in the stream reader. The 791 MB → 2.5 MB measurement in `docs/developer/features/complete/import_export_update.md` settled this, and a foreign vector silently corrupts semantic search. Rehydration re-embeds through `enqueueImportedMemoryEmbeddings` and the boot reconcile.
5. **Chats never travel in a character bundle.** Archiving a character does not archive its conversations. The conversations keep their messages and keep rendering against the tombstone.
6. **Secrets stay redacted** on both paths (`sanitizeProfile`, `resolveSecretConfigKeys`). An archive is a library file the operator may hand to anyone.
7. **Archiving is destructive to derived data and to the vault's heavy contents, and to nothing else.** *(Revised by spec §4.2a: the vault itself survives — the managed-field documents, avatar, and wardrobe are kept; mail, photographs, summaries, memories, and embeddings move into the bundle and are deleted.)* It never deletes chats, chat messages, or annotations.
8. **Archiving and rehydration are both operator-only.** No tool, no character, no background job, no maintenance sweep may archive or rehydrate. (Mirrors the wardrobe-archive precedent: "restoring is a human-only UI action.") See §11.4.
9. **Forward compatibility is free and must be preserved.** The NDJSON reader warns-and-skips unknown record *kinds* but throws on an unknown `manifest.exportType`. Adding record kinds to the existing `characters` type therefore degrades gracefully on older builds — no format version bump, no migration of existing `.qtap` files. Do not introduce a new `exportType` for this.

---

## 4. Architecture map (where things live today)

Paths are repo-relative to `/Users/csebold/source/quilltap-server`.

**Export (writer side):**
- `lib/export/ndjson-writer.ts` — `streamExportRecords`, `createNdjsonStream`, `resolveExportIds`, `buildManifest`, per-type generators (`streamCharacters:143`, `streamDocumentStores`, `streamFiles`), `stripEmbedding`, `sanitizeProfile`, `BLOB_CHUNK_BYTES = 3 * 1024 * 1024` (`:46`).
- `lib/export/types.ts` — `ExportEntityType`, `QtapRecord` union, `QuilltapExportManifest`. **Its header comment (≈ lines 31–52) is the authoritative "adding an export record kind touches these layers" checklist. Follow it.**
- `lib/export/quilltap-export-service.ts` — `previewExport` (wizard only).
- `app/api/v1/system/tools/route.ts` — `handleExport`, `handleExportEntities`, `handleExportPreview`, `handleImportPreview`, `handleImportExecute`, `loadQtapFromUpload`, `validateExportFile`.

**Import (reader side):**
- `lib/import/ndjson-reader.ts` — line reader, per-line size cap.
- `lib/import/quilltap-import-stream.ts` — `assembleExportFromStream`, `buildExportDataForType`, `blobAccumulators` / `fileBlobAccumulators` (arrival **counting**, not `Array.every` — see the in-file comment about the sparse-array truncation bug), truncation throw.
- `lib/import/quilltap-import/` — `execute.ts` (orchestrator + dependency order), `import-characters.ts`, `import-document-stores.ts`, `import-files.ts`, `reconcile.ts`, `validation.ts`, `preview.ts`, `types.ts`.

**Characters + vault:**
- `lib/database/repositories/characters.repository.ts` — the read chokepoint. `findById`/`findAll`/`findByUserId`/`findByIds`/`findByTag` overlay; `findByIdRaw`/`findAllRaw` deliberately do not.
- `lib/database/repositories/vault-overlay/` — `read-overlay.ts` (`loadVaultFileMaps`, `hydrateOne`, `applyDocumentStoreOverlay[One]`), `vault-readers.ts`, `managed-fields.ts`, `wardrobe-sync.ts`, `parsers.ts`, `schema.ts` (the canonical vault path constants).
- `lib/mount-index/character-vault.ts` — `ensureCharacterVault`, `linkCharacterToVault`, `buildWardrobeItemFile`; `lib/mount-index/character-scaffold.ts` — `scaffoldCharacterMount`.
- `lib/file-storage/character-vault-bridge.ts` — vault layout comment, `mount-blob:<mountPointId>:<blobId>` storage-key shim.
- `lib/photos/resolve-character-avatar.ts` — `resolveCharacterAvatar`, `buildMountFileUrl`, `buildLegacyFileUrl`, `readCharacterAvatarBuffer` (dual-shape link-id vs legacy `files.id`).
- `lib/cascade-delete.ts` — `executeCascadeDelete` + preview; uses `findByIdRaw` on purpose so deletion survives a broken vault.

**Backup/restore (the id-preserving precedent):**
- `lib/backup/restore/restore.ts`, `uuid-remap.ts`, `carried-store-rows.ts`; ids preserved via `CreateOptions.id`.
- `app/api/v1/characters/handlers/post.ts` → the reset-built-ins flow (`replaceMappedIdsRecursively` + `executeImport(..., 'skip')` over `first-startup/imports/lorian-and-riya.qtap`) is the closest existing precedent for *placing a character at a chosen id*.

---

## 5. Deliverable A — export fidelity

### 5.1 New record kinds on the `characters` export

`streamCharacters` gains, per selected character, after the `character` line and before `memory`:

| Kind | Source | Notes |
|---|---|---|
| `doc_mount_point` | the character's own mount point | `storeType: 'character'`; carries the id so B can restore it |
| `doc_mount_folder` | folders under that mount | ordered parents-before-children |
| `doc_mount_document` | `doc_mount_documents` rows for that mount | includes `content`, `contentSha256` |
| `doc_mount_file` + `doc_mount_file_link` | the path/hard-link layer | link-group ids carried per `linkGroupId` semantics |
| `doc_mount_blob` + `doc_mount_blob_chunk` | blobs for that mount | **reuse the existing protocol verbatim** |

**Reuse, do not re-invent.** `streamDocumentStores` already emits every one of these kinds and `assembleExportFromStream` already reassembles them. The work is (a) scoping the queries to a single mount point, (b) emitting them inside `streamCharacters`, (c) teaching `buildExportDataForType` that an `exportType: 'characters'` payload may now carry a `documentStores`-shaped section. Prefer extracting the store-emitting body of `streamDocumentStores` into a shared `streamOneStore(mountPointId)` generator over duplicating it.

**Chunking invariants to preserve:** `BLOB_CHUNK_BYTES` must remain a multiple of 3 (each chunk is base64-encoded *separately*, so only the final chunk may carry `=` padding); the reader detects completion by counting arrived chunks, never by `Array.every` over a sparse array; leftover accumulators at end-of-stream throw "NDJSON export truncated".

### 5.2 The avatar fix

On import, after the character's store is restored, `defaultImageId` and every `avatarOverrides[].imageId` must be remapped through the mount-point/link-id map — or explicitly nulled with a warning if the referenced link did not travel. **Never leave them dangling.** Add this to `reconcileRelationships` alongside the existing character FK rewrites.

Note the dual shape: an avatar id may be a `doc_mount_file_links.id` (current) or a legacy `files.id`. `resolveCharacterAvatar` already distinguishes them; the remap must too, and must leave legacy ids alone rather than mis-mapping them.

### 5.3 Import-side behavior

- `importCharacters` continues to re-mint by default. When a bundle carries store records, the fresh vault that `create()` provisions is **replaced by** the bundle's store rather than merged into it — decide and document the collision rule for scaffolded files that also exist in the bundle (recommended: bundle wins, whole-store).
- `skip` / `overwrite` / `duplicate` semantics are unchanged. Under `skip` the store records are not applied at all.
- **Old build, new file:** unknown kinds warn-and-skip → today's lossy-but-working behavior. **New build, old file:** no store records → managed fields still materialize on the row, exactly as now. Both directions must be covered by a test.

### 5.4 Size

A faithful character bundle is no longer 18 KB — a character with a populated `photos/` folder is megabytes. The preview wizard should show an estimated size, and `previewExport` should report store/blob counts.

---

## 6. Deliverable B — the archive lifecycle

### 6.1 States

A character is **live** (`archivedAt IS NULL`) or **archived** (`archivedAt` set, `archiveFileId` set). There is no third state. A failed archive rolls back to live; a failed rehydration leaves the character archived with the bundle intact.

### 6.2 The tombstone row *(rewritten 2026-08-10 per spec §4.2a)*

Archiving **keeps** the `characters` row — and, under the revision, keeps it **readable**:

- **Kept:** `id`, `userId`, `name`, `createdAt`, `archivedAt`, `archiveFileId`, tags, **`characterDocumentMountPointId`** (the vault survives, pruned), **`defaultImageId` and `avatarOverrides`** (the avatar blobs and their link rows are in the prune's keep-set, so old messages keep their faces with no pointer patching).
- **Cleared:** the `default*` FKs (`defaultPartnerId`, `defaultConnectionProfileId`, `defaultImageProfileId`, `defaultRoleplayTemplateId`).
- **Vault-managed fields** hydrate normally from the kept managed documents — an archived character renders a full character page, not a hollow row.

The original design's "single most important change in Deliverable B" — an `archivedAt` short-circuit in the vault overlay so a tombstone with no vault neither throws nor disappears — is **struck**. Nothing deletes the vault any more, so the overlay must run for archived characters exactly as for live ones; the short-circuit would hollow a character the prune deliberately preserved. A genuinely broken archived vault throws/drops like a live one's: a real fault, surfaced as one.

There is **no avatar thumbnail copy**. `archivedAvatarFileId` existed because deleting the vault killed the avatar blob; prune-in-place keeps the blob and its link row, so `defaultImageId` keeps resolving. The column has shipped and stays, unwritten — a non-null value marks a tombstone from before the revision.

### 6.3 What archiving deletes *(revised 2026-08-10 per spec §4.2a — prune, not teardown)*

In a documented order (the main DB and the mount index cannot share a transaction; see spec §4.2d for the operative sequence):

1. Write the bundle (§5) to the general library as a `files` row, category `ARCHIVE` (excluded from exports the way `BACKUP` is), **encrypted under the instance passphrase** (spec §4.2c).
2. Verify the bundle by decrypting and reading it back — the hard gate before anything is deleted.
3. Commit the tombstone (set `archivedAt`/`archiveFileId`, null the `default*` FKs, flip chat seats to absent).
4. **Prune** the vault — do **not** tear it down. Delete every link outside the keep-set (the ten managed-field documents, the avatar links, `wardrobe.json` and `Wardrobe/`) through the per-link GC delete path so link-group orphan GC runs; the mount point, its keep-set contents, and the pointer survive. Delete the vector store, the `embedding_status` rows of what was deleted, and emptied folders.
5. Delete the character's own `memories` — verified present in the bundle first — through `deleteMemoriesWithUnlinkBatch` (`lib/memory/memory-gate.ts`), never `repos.memories.delete*` directly (§11.1). Memories *about* this character, held by others, are left untouched (§11.2).

It does **not** touch chats, chat messages, annotations, `group_character_members`, `projects.characterRoster`, or any other character's memories. Membership rows survive so that rehydration restores the character to the groups and rosters it belonged to; the pickers filter archived characters out by state, not by deleting the edges — and the membership *counts* continue to include them (§11.5).

### 6.4 Read-only enforcement

The tombstone must be inert everywhere without a per-call-site audit of all ~265 read sites. Enforce at four narrow places:

1. **Write guard in the repository.** `CharactersRepository.update` / `_update` / the sub-array mutators refuse when `archivedAt != null` with a named error. Today a write against a missing row is a silent no-op `UPDATE`, which is the worst available outcome.
2. **Vault writes.** `applyDocumentStoreWriteOverlay` and the `doc_edit` path resolver refuse an archived character's scope — there is no mount to write to, and the failure should be a sentence, not a path-resolution crash.
3. **Turn participation.** The participant resolver, the turn orchestrator, and the LLM-candidate filter must treat an archived participant as unavailable. Note the resolver's current `throw new Error('Character not found')` — an archived responder needs a *specific* refusal ("this character is archived; rehydrate it to continue"), surfaced to the operator, not a 500.
4. **Pickers and rosters.** Add-character, New-Chat, group membership, project roster, wardrobe archetype tiers, the Aurora roster default view, memory-target pickers — filter `archivedAt IS NULL` unless explicitly showing archives.

**Audit required:** the ~31 `findByIdRaw` / `findAllRaw` call sites bypass the overlay and will see a hollow row. Several are load-bearing — `lib/cascade-delete.ts` (3), `lib/services/carina/carina.service.ts` (2), `lib/post-office/surface-operator-mail.ts`, `lib/doc-edit/{uri-producers,path-resolver}.ts`, `lib/tools/handlers/{send-mail,list-email}-handler.ts`, `lib/tools/handlers/self-inventory/builders.ts`, `lib/services/chat-message/orchestrator.service.ts`. Each needs an explicit ruling recorded in this document before implementation.

**Ownership note:** `UserScopedMemoriesRepository` gates every memory operation on `charactersRepo.findById(characterId)`. Because the tombstone still resolves, that gate keeps working — one more reason not to delete the row.

### 6.5 Inspection (read-only viewing) *(simplified by spec §4.2a)*

Archived characters are inspectable, never editable — and under prune-in-place they read like any other character, so no bundle-streaming inspector is needed:

- The roster shows them under an "Archived" filter with their **normal** avatar and an `archived` badge — no thumbnail special case.
- The detail view is the **ordinary character page** with every field disabled and a banner; the kept vault supplies all managed fields. (The only content it cannot show is the pruned material — mail, photographs, summaries — which is what the CLI export escape hatch is for.)
- Conversations containing an archived participant render normally — `defaultImageId` and `avatarOverrides` still resolve — with the badge on the participant chip.

### 6.6 Rehydration *(reframed by spec §4.2a and §6 — restore into an existing mount)*

Rehydration is no longer "import a bundle into an empty space": the mount point, its folders, the managed documents, the avatar and the wardrobe all still exist and must be left exactly as they are. `rehydrate(characterId)`:

1. Load the bundle from `archiveFileId` and **decrypt** it; validate the manifest and that its character id equals this character's id.
2. Collision pre-scan in **skip-if-present** mode: an id that already exists inside this character's own vault is skipped (the surviving row wins); an id existing anywhere else refuses the whole operation atomically, exactly as the ordinary `preserveIds` rule demands.
3. Import with `preserveIds`: the pruned documents, blobs, `Mail/`, summaries and memories land at their original ids inside the existing mount. Nothing repoints — the pointer, `defaultImageId` and `avatarOverrides` never changed.
4. Clear `archivedAt` / `archiveFileId`; flip participant rows back to present. A non-null `archivedAvatarFileId` (pre-revision tombstone) has its thumbnail row deleted and the column nulled.
5. Enqueue re-embedding: memories via the existing `EMBEDDING_GENERATE` fan-out, vault chunks via `enqueueEmbeddingJobsForMountPoint`. The keep-set documents keep the chunks they never lost.
6. Leave the bundle file in the library by default (cheap insurance); offer deletion.

Because ids are preserved — and most of them never stopped resolving — every chat participant, memory, group membership, and roster entry resolves with no reconcile pass.

---

## 7. Schema and DDL impact

- `characters`: `archivedAt TEXT NULL`, `archiveFileId TEXT NULL`, `archivedAvatarFileId TEXT NULL`. First `archivedAt` on any table other than wardrobe frontmatter.
- `files.category`: new `ARCHIVE` member; excluded from `files` exports the way `BACKUP` is.
- **`docs/developer/DDL.md` must be updated** — it is required to stay current.
- The migration needs a `PRETTY_LABELS` entry in `lib/startup/prettify.ts` in the steampunk-Wodehouse voice, and `reportProgress(...)` in any loop, per the migration rules.
- Backup/restore must carry the three new columns and the `ARCHIVE` files (a backup of an instance with archived characters must restore them still archived).
- Delete All Data and restore-in-`replace`-mode each gain a **"keep archived characters"** option, default keep (§11.3) — `lib/backup/delete-service.ts`, `lib/backup/restore/restore.ts`, and both Data & System wizard dialogs. The flag rides the request bag, so the API contract and the v5 dispatch verb both move.
- `public/schemas/qtap-export.schema.json` and `qtap-export-ndjson.schema.json` both need the new character-scoped store records and the `preserveIds` manifest flag.

## 8. Surfaces to update

- **Help:** all user-visible behavior must be documented in `help/*.md` with a `url` frontmatter field and a matching `help_navigate(url: ...)` "In-Chat Navigation" section. Candidates: the characters help doc (archive/rehydrate), the import/export help doc (what now travels).
- **CHANGELOG:** `docs/CHANGELOG.md`, plain voice.
- **CLI:** `npx quilltap` should be able to list and rehydrate archives; archiving from the CLI is a write and needs `--write`.
- **UI voice:** steampunk / Roaring-20s register for every new string.

## 9. Rejected alternatives

### 9.1 The archive as a virtual overlay source

The original question was whether an archive could overlay the *normal* character read path everywhere. Mechanically the seam looks inviting — `CharactersRepository` really is a chokepoint, no SQL joins read the `characters` table outside migrations and the Brahma console, and chat→character is a JSON-path filter rather than a join. It was rejected on cost:

- **List queries.** `findAll` / `findByUserId` / `findByIds` / `findByTag` / `count` / `exists` each hit SQL and *then* overlay. A character with no row simply is not there; every list method would need to merge a file-backed source, and the ordering/pagination semantics would have to be reproduced across two sources.
- **The raw bypasses.** 31 sites deliberately skip the overlay and would see nothing.
- **The vault shadow.** The vault lives in a different database with folders, files, links, blobs, and chunks. `read-overlay.ts` reaches `getRepositories().docMountDocuments` at module scope — an archive source would have to satisfy `findManyByMountPointsAndPath`, `findManyByMountPointsInFolder`, and `findByMountPointAndPath`, and doc-edit, the photo gallery, avatar resolution, and chunk search would all need the same treatment. Overlaying the character without the mount yields a character whose face and papers 404.
- **Cost of ownership.** Every future read path would have to be written twice, and the v5 port would have to reproduce the whole shadow differentially.

The tombstone gets ~95% of the benefit because the tombstone *is* a real row, in the place all 265 call sites already look.

### 9.2 The current `.qtap` as the archive artifact

Rejected: it is lossy (§2) and it re-mints ids, which orphans every conversation the character appeared in. Deliverable A removes the first objection; §3.1–3.2 removes the second.

### 9.3 A separate archive format

Rejected: two formats means two writers, two readers, two schemas, and two differential families in v5, for one flag's worth of difference.

## 10. Sequencing and cost

1. **A1** — file the dangling-avatar defect in the bug catalogue. (Independent; do it regardless.)
2. **A2** — extract `streamOneStore`, emit store + blob records from `streamCharacters`, extend the reader and both JSON schemas, remap avatar ids in `reconcile.ts`. Round-trip tests both directions plus the forward/backward-compat pair. *Ships alone and is worth shipping alone.*
3. **B1** — `preserveIds` manifest flag + refusal-on-collision in the import path.
4. **B2** — schema/migration, the archive service, the overlay's archived-character branch, the write guards.
5. **B3** — pickers, roster, chat participant chip, the read-only detail view, CLI, help.
6. **B4** — rehydration + re-embedding.

**v5 note.** v4 is the oracle for the quilltap-v5 port, and this lands on already-ported surfaces — `lib/export/**`, `lib/import/quilltap-import/**`, the characters repository, the vault overlay, backup/restore, and the SPA. Expect a multi-lane drift catch-up round on the v5 side, with new fixtures for a store-bearing character bundle and for an archived-character read. Deliverable A alone is a much smaller catch-up than A+B; that is another argument for shipping it first.

## 11. Rulings (settled 2026-08-09 — do not re-litigate)

1. **The character's own memories are DELETED from the database on archive.** They travel in the bundle and rehydration restores them at their original ids. Consequence: an archived character's memories disappear from every search, every recall path, and every cross-character retrieval until rehydration — that is the intent. The archive must therefore be verified to contain them *before* the delete step, and the delete goes through `deleteMemoriesWithUnlinkBatch` (`lib/memory/memory-gate.ts`), never `repos.memories.delete*` directly, so neighbours' `relatedMemoryIds` are scrubbed. Their embeddings (`vector_entries` / `vector_indices`, `embedding_status`) go with them.
2. **Memories held by *other* characters *about* an archived character are KEPT.** No sweep. Rows carrying `aboutCharacterId = <archived id>` survive untouched and stay retrievable — the other characters' recollections are their own, and the tombstone keeps `aboutCharacterId` resolvable (`about-character-resolution.ts` resolves the name from the row, which still exists). Note the asymmetry this creates and document it in help: archiving silences the character, not everyone's memory of them.
3. **`ARCHIVE` files are governed by an explicit operator choice, not a fixed policy.** Both Delete All Data and restore-in-`replace`-mode gain a "keep archived characters" option (default **keep** — the destructive default should not be the silent one). Touch points: `lib/backup/delete-service.ts`, `lib/backup/restore/restore.ts` (replace path), and both wizard dialogs in the Data & System settings tab. When kept, the `ARCHIVE` `files` rows and their bytes survive the wipe; the tombstone `characters` rows do **not** (they are ordinary character rows and go with everything else), so a kept archive after a wipe is a **loose bundle** — importable, not rehydratable. Make that consequence explicit in the dialog copy.
4. **Archiving is operator-only, like rehydration.** No tool, no character, no background job, no maintenance sweep may archive. There is no auto-archive-after-N-months in v1. (If it is ever wanted, it should arrive as a *suggestion* surfaced to the operator, never an action.)
5. **Archived members count in group and roster UI.** An archived character stays a member of its groups and stays on project rosters, and counts toward membership counts and any limits. It is filtered out of *turn participation* and *pickers* (§6.4.3–6.4.4) but not out of the count. Consequence to design for deliberately: a group may display "6 members" while only 4 can speak. The membership list must therefore show the `archived` badge inline — a count the operator cannot reconcile against the visible roster is the failure mode to avoid.

## 12. Test plan sketch

- **Round-trip A:** export a character with a populated vault (`photos/`, `Mail/`, a multi-chunk blob) → import into a clean instance → assert every vault path, blob sha256, and a resolvable avatar.
- **Compat pair:** new-writer/old-reader (warn-and-skip, no throw) and old-writer/new-reader (managed fields still materialize).
- **Chunk boundaries:** blobs at exactly `BLOB_CHUNK_BYTES`, one byte under, one byte over; truncated stream must throw.
- **Archive/rehydrate identity:** archive → assert the vault, chunks, and vector rows are gone and the chat still renders → rehydrate → assert the character is byte-identical where it should be and that every chat participant, memory, group membership, and roster entry resolves without a reconcile pass.
- **Read-only:** every write entry point (repository update, sub-array mutators, `doc_edit`, wardrobe tools, turn participation) refuses an archived character with a named error, not a crash and not a silent no-op.
- **Overlay:** an archived character neither throws from `applyDocumentStoreOverlayOne` nor disappears from `applyDocumentStoreOverlay`.
- **Collision:** rehydrating into an instance that already holds the id refuses and changes nothing.
- **Memory asymmetry (§11.1–11.2):** after archiving, the character's own memories are absent from search, recall, and the memories tab, while another character's memory *about* them is still retrievable and still resolves the archived name; rehydration restores the first set at their original ids with `relatedMemoryIds` intact on both sides.
- **Wipe options (§11.3):** Delete All Data and restore-`replace`, each run twice — keep (`ARCHIVE` files survive, tombstones do not, the bundle is importable but not rehydratable) and wipe (nothing survives).
- **Group counts (§11.5):** a group with an archived member reports the full count, shows the badge in the membership list, and offers only the live members for a turn.
