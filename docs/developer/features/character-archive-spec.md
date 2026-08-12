# Character archive & export fidelity — implementation spec

> **Status: COMPLETE (2026-08-10).** Every work package has landed under the revised
> (2026-08-10, §4.2a) model: WP A1, A2, B1, **all of B2** (schema/migration, prune-in-place
> archive service, archive encryption, write guards, participant flip, every §4.6 call-site
> ruling, §4.7 wipe/restore options), **all of B3** (the `archived=` GET chokepoint +
> picker defaults, roster toggle/badges, read-only detail view with archive/rehydrate actions,
> the API actions, the CLI `archives`/`archive`/`rehydrate`/`export` subcommands, help/docs),
> and **all of B4** (full rehydration: decrypt + digest-verify the bundle, import it with
> `preserveIds` in skip-if-present mode, clear the tombstone, flip seats back, re-chunk via
> `reindexLinks` and re-embed via the mount scheduler — restored memories re-embed through the
> import's own fan-out).
> **Recorded deviations from the letter of the spec:** the CLI archive/rehydrate verbs proxy
> through the running server's API (the export pipeline and passphrase cache live only there) —
> `--write` is still required but the server, not the CLI, holds the lock; the "6 members / 4
> can speak" figure renders in the group members card as "N members / M can speak (K archived)";
> and §6 step 6's "offer deletion in the UI" is a post-rehydrate dialog (keep/discard), backed
> by a files-API guard that refuses (without `force=true`) to delete a bundle an archived
> character still points at.
>
> **The revision in one line:** archiving does not *delete* the character's vault — it
> **prunes it in place**, keeping the managed-field documents, the avatar, and the wardrobe so a
> tombstone is still a readable character page, and moving everything heavy (photos, `Mail/`,
> conversation summaries, chunks, the character's own memories) into an encrypted `.qtap` on
> disk. The parent design doc has been updated to match (its §6.2 was rewritten and its
> "single most important change in Deliverable B" struck).
>
> Fixup work was specified in §11 — **all steps (F1–F7, F5 last) have landed**; §11 is now a
> historical record, and new sessions should work from the WP list above.
> Where any older passage in this file contradicts §4.2a, §4.2a wins.
> **Parent:** [character-archive-and-export-fidelity.md](character-archive-and-export-fidelity.md) — the
> design document. Its §3 design decisions and §11 rulings are settled and this spec does not
> re-open them. This spec turns the design into concrete, ordered work packages with file-level
> tasks, records the raw-call-site rulings the parent's §6.4 required before implementation,
> and corrects a handful of factual details found during code verification (§10 below).
> **Verified against:** the codebase as of 2026-08-09 (main, post-46cc002a). Every file:line
> reference below was checked, not copied from the parent doc.

---

## 0. Work-package overview

| WP | Deliverable | Ships alone? | Depends on |
|---|---|---|---|
| **A1** | File the dangling-avatar import bug | yes — done | — |
| **A2** | Export fidelity: character bundles carry the vault + avatar remap on import | yes — implemented | — |
| **B1** | `preserveIds` manifest flag + refuse-on-collision import path | no (implementation landed; no UI consumer yet) | A2 |
| **B2** | Schema/migration, archive service (prune-in-place, §4.2a), write guards | **done** — schema/guards, prune-in-place service (F6), encryption (F7), all §4.6 call sites, §4.7 wipe options | A2, B1 |
| **B3** | Surfaces: pickers, roster, badges, read-only viewer, CLI, help | **done** (2026-08-10) | B2 |
| **B4** | Rehydration + re-embedding | **done** (2026-08-10) | B1, B2 |

A2 is worth shipping on its own (it fixes real cross-instance import breakage) and shrinks the
v5 drift catch-up if B slips.

---

## 1. WP A1 — file the avatar bug

**Done (2026-08-09):** filed as
[Bug 52](../bugs/fixed/bug-52-avatar-import-dangling.md) with its index row in
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

> **Reading order for §4.2:** the ruling (§4.2a) establishes what archiving now does; §4.2b and
> §4.2c define the artifact it produces and how it is protected; §4.2d is the ordered procedure
> that follows from all three.

### 4.1 Migration and schema

- `migrations/scripts/add-character-archive-fields.ts` (model:
  `add-character-manifesto-field.ts`): `ALTER TABLE "characters"` add `archivedAt TEXT`,
  `archiveFileId TEXT`, `archivedAvatarFileId TEXT`; `shouldRun` via
  `getSQLiteTableColumns('characters')`; register in `migrations/scripts/index.ts`.
  `PRETTY_LABELS` entry in `lib/startup/prettify.ts` (steampunk voice). Pure ALTER — no loop, no
  `reportProgress` needed.
- `FileCategoryEnum` (`lib/schemas/file.types.ts:23`) gains `'ARCHIVE'`. The column is untyped
  TEXT (`docs/developer/DDL.md:930`) — no SQL migration for it. **Landed.**
- **ARCHIVE export exclusion — landed**, as one predicate rather than a fourth copy of the rule:
  `isFileExcludedFromExport` (`lib/export/excluded-files.ts`) covers `BACKUP`/`/backups` and
  `ARCHIVE`/`/archives`, and is used by the writer's file streamer, the export-type id resolver,
  and the wizard's entity picker. The schema prose says so too. **If the archive folder path
  changes (§4.2a puts bundles under `/archive/characters`), change it there — one place.**
- **`archivedAvatarFileId` is vestigial under §4.2a.** It existed because deleting the vault
  killed the avatar blob. Prune-in-place keeps the avatar *and its link row*, so
  `defaultImageId` keeps resolving and no thumbnail copy is needed. Keep the column — it has
  shipped and a dropped column is a migration for nothing — but stop populating it, and treat a
  non-null value as a pre-revision tombstone.
- Character Zod schema + `qtap-export.schema.json` character def gain the three nullable fields
  (tombstones must survive backup/export of the *row*); update `docs/developer/DDL.md`.
- Backup/restore: `uuid-remap.ts` character block (:92–145) additionally remaps `archiveFileId`
  / `archivedAvatarFileId` through the files map; restore must land archived characters still
  archived. `.qtap` export/import of a tombstone row carries the fields (per the
  export/import-all-fields rule) — but exporting an *archived* character via the normal wizard
  should either export the tombstone as-is or be blocked with a "rehydrate first" message;
  **decision: block it** (a tombstone export is useless and the bundle already exists as a file).

### 4.2a Ruling: prune in place, don't delete (2026-08-10)

The original model deleted the character's vault outright, so the overlay had nothing to read
and every managed field came back empty (parent §6.2). A tombstone was a name and a thumbnail.
That was accepted as the price of reclaiming space — and then measurement showed the price
bought less than assumed, because the bytes are in photos and memories, not in the ten
managed-field documents, which together are kilobytes.

**Archiving now prunes the vault instead of deleting it.**

| | Kept in the live vault | Moved to the bundle, then deleted |
|---|---|---|
| Managed fields | all ten documents (`properties.json`, `metadata.json`, `identity.md`, `description.md`, `manifesto.md`, `personality.md`, `example-dialogues.md`, `physical-description.md`, `physical-prompts.json`, `wardrobe.json`) | — |
| Avatar | the blob `defaultImageId` resolves to, and its link row | every other image |
| Wardrobe | `wardrobe.json` and the `Wardrobe/` folder | — |
| Correspondence | — | `Mail/` in full |
| Summaries | — | `Conversation Summaries/` in full |
| Memories | — | all of the character's own |
| Embeddings | chunks for the surviving documents | chunks for everything deleted; the vector store |

Consequences, each of which changes a section below:

1. **The mount point survives, so `characterDocumentMountPointId` is never nulled.** The whole
   crash-window/pointer-ordering apparatus F3 built is unnecessary (§11 F6).
2. **§4.3 reverses.** The archived-row short-circuit at the top of `hydrateOne` would now skip a
   vault we deliberately kept, hollowing a character we went to trouble to preserve. It must be
   **removed**, not added. The parent doc's "single most important change in Deliverable B" is
   moot: with a live vault there is no `CharacterVaultUnavailableError` to dodge.
3. **`archivedAvatarFileId` retires** (§4.1) — the avatar never leaves.
4. **Chat referents keep resolving with zero work.** `defaultImageId`,
   `avatarOverrides[].imageId`, and the wardrobe item ids in chats' `EquippedOutfitState` are
   all ids in rows we no longer touch. This is the main reason to prune rather than rebuild a
   stub vault: a fresh stub re-mints every one of those ids.
5. **The write guards get *more* load-bearing** (§4.4). There is now a live, writable vault
   behind an archived character.
6. **Rehydration becomes a restore *into* an existing mount** (§6), which collides with every
   surviving document — hence the F4 amendment.
7. **Re-embedding of the surviving documents is accepted.** Ten small documents' worth of chunks
   per archived character is immaterial next to a live character's vault. No scheduler exclusion.

What did *not* change: chats, messages, annotations, group membership, project rosters, and
other characters' memories about this one are still untouched (parent §6.3, §11.2, §11.5); the
character is still read-only until rehydrated; memories are still deleted only after they are
verified present in the bundle.

### 4.2b The archive bundle

**One file, not two.** Since WP A2 a `characters` `.qtap` carries the character *and* its whole
vault, so the bundle is a single ordinary characters export (`includeMemories: true`,
`preserveIds: true`) taken **before** the prune.

- **Location:** `files/archive/characters/{sanitized-name}.qtap`, as a `files` row of category
  `ARCHIVE` with `folderPath: '/archive/characters'`. Names collide (character names are not
  unique, and archive → rehydrate → archive repeats one), so suffix ` (2)` the way
  `nextUniqueMountPointName` does, and sanitize with the existing `sanitizeFileName`
  (`lib/mount-index/character-vault.ts:211`).
- **Not gzipped.** The payload is dominated by base64'd WebP that is already compressed; gzip
  would buy single-digit percent on the NDJSON text and cost a streaming pass.
- **Not base64'd into a column**, and not stored in the database. On disk the databases actually
  get smaller; in the database the same bytes simply move from the mount index to the main DB.
- **Encrypted at rest** — see §4.2c. This is what makes an on-disk bundle acceptable: `files/`
  is not covered by SQLCipher.
- **Embeddings never travel** — memories go through `stripEmbedding` and `doc_mount_chunks` is
  never exported at all. Already true; nothing to build.

### 4.2c Archive encryption

`files/` sits outside every encrypted database, so a bundle written there in the clear would be
the one place a character's mail, photographs and personality live unprotected. Encrypt it with
**the same mechanism `.dbkey` uses** — not with `ENCRYPTION_MASTER_PEPPER`.

**Why not the pepper.** The pepper is the SQLCipher key, generated per instance and kept in
`.dbkey`. Backups are *logical* — JSON tables plus file bytes copied verbatim to
`stagingDir/files/<storageKey>` (`lib/backup/backup-service.ts:702`) — and the pepper does not
travel with them. A pepper-encrypted bundle would restore onto a new instance byte-perfect and
permanently undecryptable: a trap under the one artifact meant to outlive the instance.

**What to use instead.** The user passphrase when one is set, and `INTERNAL_PASSPHRASE`
(`lib/startup/dbkey.ts:111`, the source constant `'__quilltap_no_passphrase__'`) when one is
not — exactly the `.dbkey` rule. Both are portable: the constant is in every build, and a user
passphrase is knowledge the operator carries, so either way a restored bundle opens on the new
instance. Parameters match `.dbkey`: PBKDF2-SHA256 at 600k iterations → AES-256-GCM.

This deliberately gives **parity with the database, not more**. On a no-passphrase instance the
database itself is protected by a constant in open-source code; an archive encrypted the same
way is protected against casual filesystem access — a sync client indexing `files/`, a stray
copy on a shared disk — and not against someone holding the disk and a copy of Quilltap. Making
the archive stronger than the database it came from would be theatre.

**Implementation note — do not reuse the string helpers.** `encryptWithPassphrase`
(`lib/encryption.ts:74`) and `encryptPepperWithParams` (`lib/startup/pepper-crypto.ts:57`) both
`JSON.stringify` their input and hex-encode the ciphertext: correct for a 32-byte pepper,
catastrophic for a 400 MB bundle (hex doubles it, and `update(data, 'utf8', …)` mangles binary).
Add a **streaming binary** sibling: a small plaintext header (version, salt, IV, and a
passphrase-verification hash), then the ciphertext piped through `createCipheriv`, GCM tag
appended. Same algorithm, same parameters, different plumbing.

**Passphrase changes must re-encrypt every archive.** `changePassphrase`
(`lib/startup/dbkey.ts:501`) re-encrypts `.dbkey` and nothing else; archives in `files/` would
silently still want the old passphrase. `changePassphrase` therefore grows a second phase:
enumerate every `ARCHIVE` file, decrypt with the old passphrase, re-encrypt with the new one.
The header's verification hash is the safety net — a mismatch must report *"this archive
predates your passphrase change"* rather than a bare GCM authentication failure. The
change-passphrase UI states up front that archives will be rewritten, and how many; the
operation is not interruptible without leaving a mixed-passphrase library, so it reports
progress and, on partial failure, names exactly which archives still hold the old passphrase.

### 4.2d Archive service — order of operations

`lib/characters/archive-service.ts` (operator-only; no tool, no job, no sweep — parent §11.4).
Order chosen for crash-safety, since the main DB and the mount index cannot share a transaction
(the parent's §6.3 allows "a documented order"). References elsewhere in this file to "§4.2"
mean this subsection.

1. **Write the bundle** (§4.2b): the characters export with `includeMemories: true` and
   `preserveIds: true`, taken **before** any pruning, encrypted per §4.2c, to a `files` row of
   category `ARCHIVE` at `files/archive/characters/{name}.qtap`. Real sha256 of the plaintext
   bytes — a placeholder digest defeats every later integrity check, rehydration included.
2. **Verify the bundle** by reading it back through the reader — the hard gate before anything
   is deleted (parent §11.1). Decrypt, then check: exactly the expected character; memory count
   equals the live count; mount point, text-document and blob counts equal what the live vault
   holds; footer counts equal the records actually parsed. Compare documents with the writer's
   own text-file-type filter or the totals will never agree.
3. **Commit the tombstone — one main-DB write:** set `archivedAt` and `archiveFileId`; null the
   `default*` FKs (`defaultPartnerId`, `defaultConnectionProfileId`, `defaultImageProfileId`,
   `defaultRoleplayTemplateId`); flip the character's chat-participant rows to a non-present
   status (§4.5).

   **Not nulled, deliberately:** `characterDocumentMountPointId` (the vault survives — §4.2a),
   `defaultImageId` and `avatarOverrides` (they point at blobs the prune keeps, and nulling them
   is what took the face off old messages).

   A crash before this leaves a fully live character plus an orphan bundle file; after it, an
   archived character whose vault is not yet pruned — which reads correctly and prunes on retry.
4. **Prune (idempotent, re-runnable):**
   - delete every vault document and blob *except* the keep-set in §4.2a's table — through the
     document-store delete paths, never a bare repository delete, so link-group orphan GC runs;
   - delete the vector store (`getVectorStoreManager().deleteStore(characterId)`, cf.
     `lib/cascade-delete.ts:388`), the character's `embedding_status` rows, and the chunks of
     every document just deleted;
   - delete the character's own memories through `deleteMemoriesWithUnlinkBatch`
     (`lib/memory/memory-gate.ts:535`) — **never** `repos.memories.delete*` (parent §11.1);
     leave `aboutCharacterId` rows held by others untouched (parent §11.2).

   The mount point, its folders, the keep-set documents, the avatar blob and its link row all
   remain. `deleteStoreCascade` is **not** used here — it tears down the whole store, which is
   exactly what this revision stopped doing.

Untouched, by design: chats, chat_messages, annotations, `group_character_members`,
`projects.characterRoster`, other characters' memories (parent §6.3, §11.5).

**Failure semantics:** a failure before step 3 deletes the bundle file it wrote and reports the
character still live — an orphan `ARCHIVE` file per failed attempt would accumulate unseen. A
failure in step 4 reports "archived, prune incomplete" (an honest conjunction of the steps, not
a fixed `true`) and is safely re-runnable: `archiveCharacter` on an already-archived row skips
the bundle write and the commit and re-runs the prune only. Because the prune is a delete-set
rather than a teardown, re-running it is naturally idempotent — anything already gone stays
gone, and the keep-set is never a candidate.

### 4.3 Tombstone read path — **reversed by §4.2a**

> **This section previously required adding an `archivedAt` short-circuit to the overlay. Remove
> it instead.** Two branches were added and must come out:
> `hydrateOne` (`read-overlay.ts:136`) and `applyDocumentStoreOverlayOne` (`:377`), each
> `if (character.archivedAt) return character;`.

Under prune-in-place an archived character **keeps a real, readable vault**, so the overlay must
run exactly as it does for a live character — that is the entire point of keeping the managed
documents. The short-circuit would skip a vault we deliberately preserved and hand back a hollow
row with empty `identity`, `description`, `personality` and the rest: the very outcome the
revision exists to avoid.

The parent doc's "single most important change in Deliverable B" is therefore **moot**. It
existed to stop `CharacterVaultUnavailableError` firing on a character whose vault had been
deleted; nothing deletes the vault any more. The throw (`hydrateOne` keystone check at
`read-overlay.ts:154–157`) and the list-drop (`applyDocumentStoreOverlay:341–351`) keep their
normal meaning for archived characters too — a *broken* archived vault is a real fault and
should surface as one, not be silently hollowed.

`findAll`/`findByUserId` continue to **include** archived characters (list consumers filter by
state, not the repo — see §5.1); `UserScopedMemoriesRepository`'s ownership gate keeps working
because `findById` resolves them (parent §6.4).

### 4.4 Write guards

**§4.2a raises the stakes here.** Under the old model a tombstone had no vault, so most write
paths degraded to nothing on their own. Now there is a live, writable vault behind an archived
character, and *only* these guards stand between it and an edit. Read-only has to be enforced,
not inherited.

- **Repository:** top of `CharactersRepository.update()`, i.e. **before**
  `applyDocumentStoreWriteOverlay`. Read `findByIdRaw`; if `archivedAt` is set, allow only the
  sanctioned patches and otherwise throw the named `CharacterArchivedError`. Every sub-array
  mutator, partner-link helper, favorite/controlledBy/canBeCarina setter, and system-prompt /
  scenario helper funnels through `update()`, so one guard covers them all. **Landed** as
  `validateCharacterArchivePatch` (`characters.repository.ts`).

  Sanctioned patches: the single-key unarchive (`{ archivedAt: null }`), and — from F3 — the
  single-key `{ characterDocumentMountPointId: null }` finalization patch. **§4.2a retires the
  second one**: nothing nulls the pointer any more, so F6 should remove it and keep the guard to
  the unarchive shape alone. Rehydration's own writes are covered by §6.

  `delete()` stays unguarded — cascade-deleting an archived character is the escape hatch, and
  it now operates on a character with a real (pruned) vault, which is the ordinary case its code
  already handles.
- **Vault writes are the new exposure.** The repository guard covers writes that arrive *through
  the character repository*, because it precedes the write overlay. It does **not** cover paths
  that reach the mount directly. Each of these must refuse for an archived character:
  - `doc_edit` — `resolveSelfVaultMountPointId` (`lib/doc-edit/path-resolver.ts:58`) previously
    returned null for a tombstone and the tools degraded with a sentence. It now resolves a real
    mount, so **the archived check has to be explicit** or a character can edit their own vault
    while archived.
  - wardrobe writes (`vault-overlay/wardrobe-writes.ts:75`) — same reasoning; the null-mount skip
    no longer fires.
  - the mail paths below, which write into `Mail/` — a folder the prune deletes.
- **`ensureCharacterVault` resurrection hazards mostly evaporate.** The pointer is never null, so
  nothing re-provisions. `lib/startup/backfill-character-vaults.ts:51` should still skip archived
  rows (cheap, and correct if a vault is ever lost), but it is no longer the boot-time
  catastrophe the old model made it. The mail call sites still need their refusals — not to
  prevent resurrection now, but because delivering mail to an archived character would write
  into a pruned folder and silently resurrect correspondence the archive just packed away:
  - `lib/tools/handlers/list-email-handler.ts:49–54` and
    `lib/tools/handlers/send-mail-handler.ts:52` (sender *and* recipient resolution).
  - `app/api/v1/chats/[id]/actions/mailbox.ts:39–44` and
    `app/api/v1/chats/[id]/actions/send-mail.ts:44,48`.

### 4.5 Turn participation

Cheapest systemic fix: at archive time (§4.2d step 3, the tombstone commit), flip the
character's participant rows in every chat to a non-present status — then `isParticipantPresent` filters archived seats out of
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

> **Landed (2026-08-10):** all seven change-required rulings, the two promoted guards (with
> F6), the resolver-level name-match skip in `resolveCharacterByNameOrId` /
> `findCharactersByName` (`lib/services/character-resolver.ts` — archived characters never
> match by name; an exact id still resolves so callers give the named refusal), and the
> conversation-summary-bridge skip flagged in the fine-as-is notes
> (`writeConversationSummaryToVaults` skips archived participants; the removal path stays
> unguarded — deleting from a pruned vault is a natural no-op).

Full sweep of characters-repo `findByIdRaw`/`findAllRaw` sites. **Change required (7):**

> **§4.2a re-reads three of these.** The rulings stand, but two of the *reasons* change and two
> "fine as-is" entries stop being fine, because an archived character now has a live vault
> instead of a null pointer. Amendments are marked inline.

| Site | Ruling |
|---|---|
| `lib/startup/backfill-character-vaults.ts:51` | **Skip archived** — still correct, but no longer urgent: the pointer is never null, so nothing resurrects (§4.4) |
| `lib/tools/handlers/list-email-handler.ts:49` | **Refuse archived** (named error) — now because `Mail/` is pruned, not because of `ensureCharacterVault` |
| `lib/tools/handlers/send-mail-handler.ts:52` | **Refuse archived sender; skip archived recipients** in `resolveCharacterByNameOrId` |
| `app/api/v1/chats/[id]/actions/mailbox.ts:39` | **Refuse archived** — calls `ensureCharacterVault` |
| `app/api/v1/chats/[id]/actions/send-mail.ts:44,48` | **Refuse when sender or recipient archived** |
| `lib/services/chat-message/orchestrator.service.ts:891` | **Filter archived** from the Carina-answerer probe |
| `lib/tools/handlers/self-inventory/builders.ts:675` | **Filter archived** from reachable Carina answerers |

**Promoted to "change required" by §4.2a (2):** these were fine only because the pointer was
null and they skipped on their own. With a live vault they must check `archivedAt` explicitly,
or an archived character can be written to:

| Site | Ruling |
|---|---|
| `lib/doc-edit/path-resolver.ts:58` (`resolveSelfVaultMountPointId`) | **Refuse archived.** Was "null pointer → clean degradation"; now resolves a real mount, so an archived character could edit their own vault |
| `lib/database/repositories/vault-overlay/wardrobe-writes.ts:75` | **Refuse archived.** Was an "existing null-mount skip"; that skip no longer fires |

**Fine as-is (no change):** `lib/cascade-delete.ts:125,263,308` (delete stays possible, and now
runs against an ordinary pruned vault rather than a hollow row); `uri-producers.ts:28`;
`lib/services/prospero-notifications/writer.ts:551`,
`lib/services/aurora-notifications/core-whisper.ts:147`,
`lib/post-office/surface-operator-mail.ts:69` (skip on their own);
`lib/memory/recall-replay.ts:122` (diagnostic), `lib/memory/fold-episode-pass.ts:94` and
`lib/file-storage/conversation-summary-vault-bridge.ts:122` (need only `name` — old chats keep
correct names; note the summary bridge writes into a folder the prune deletes, so it must not
run for an archived participant); `lib/pascal/workbench.ts:125`,
`lib/startup/migrate-vault-physical-files.ts:68`, `lib/startup/refresh-vault-wardrobe.ts:53`;
`lib/services/carina/carina.service.ts:277,319` (asker flags — archived askers can't take
turns); `app/api/v1/characters/[id]/handlers/delete.ts:26` (existence check before cascade
delete); overlay/vault internals (`vault-overlay/managed-fields.ts:367,396` — guarded upstream
by §4.4; `lib/mount-index/character-vault.ts:85`; `characters.repository.ts:352`).

**Cosmetic fix now unnecessary:** `vault-overlay/wardrobe-sync.ts:58` — the no-vault branch that
`logger.error`s never fires for an archived character now, because the vault and `wardrobe.json`
are both in the keep-set. No change needed.

**One split ruling:** `app/api/v1/characters/[id]/handlers/put.ts:111` — the rehydrate action
routes through here, so no blanket refusal; the repo-level guard (§4.4) blocks everything except
the sanctioned unarchive patch. Depiction-guidelines on a tombstone already 400s (null mount).

### 4.7 Delete All Data / restore-replace (parent §11.3)

> **Landed (2026-08-10).** `DeleteUserDataOptions.keepArchivedCharacterBundles` (default
> true) on `deleteUserData` / `deleteAllUserData`; `DeleteSummary` gained
> `archiveBundles`/`archiveBundlesKept` and `previewDeleteAllUserData` counts bundles on
> hand; `RestoreOptions` threads the flag into the replace-mode wipe; both dialogs carry the
> checkbox with the loose-bundle copy; the flag rides the request bodies of
> `?action=delete-data` and `POST /api/v1/system/restore`. Tests: `delete-service.test.ts`.

- `lib/backup/restore/delete-service.ts` (note the path — the parent doc says
  `lib/backup/delete-service.ts`): `deleteUserData` (:96) / `deleteAllUserData` (:221) /
  `previewDeleteAllUserData` (:305) have **no options bag today**; add
  `options?: { keepArchivedCharacterBundles?: boolean }` (default **true** — the destructive
  choice must be the explicit one). When keeping: spare `files` rows with category `ARCHIVE`
  (and their on-disk bytes) from the files loop (:150–157). Per the settled ruling, tombstone
  `characters` rows do **not** survive (they are ordinary rows) — the survivor is a **loose
  bundle**: importable, not rehydratable.

  **§4.2c makes this stronger than it was.** The bundle is encrypted under the passphrase, not
  under anything stored in a database, so a kept bundle stays openable after the wipe that
  destroyed every database. Had the key lived in the DB — or had the bundle been a BLOB inside
  it — "keep archived characters" would have preserved an undecryptable file, which is worse
  than not keeping it. This property is the deciding argument for on-disk storage.
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

**§4.2a simplifies all of this**, because an archived character reads like any other character:
name, avatar, and every managed field come from the vault that is still there.

- **Aurora roster** (`app/aurora/AuroraView.tsx:112`): an "Archived" filter view using the
  opt-in param; archived characters render with their **normal** avatar and name plus an
  `archived` badge — no thumbnail special case. Group membership lists show the badge inline so
  "6 members / 4 can speak" is reconcilable (parent §11.5).
- **Chat rendering: nothing to do.** `resolveCharacterAvatar` needs **no** archived branch —
  `defaultImageId` still resolves, because the prune keeps the avatar blob and its link row.
  (`getMessageAvatar` lives in `app/salon/[id]/SalonView.tsx:1152`, not `page.tsx` as the parent
  doc says.) Participant chips get the badge.
- **Read-only detail view: the ordinary detail view, disabled.** The old design needed a
  bundle-streaming inspector (`?action=archive-inspect`, parsed per request, never cached)
  because the tombstone had no readable content. It now has content, so the existing character
  page renders it directly with every field disabled and a banner. **Drop the inspector action**
  — the only thing it could still show that the pruned vault cannot is the deleted material
  (mail, photographs, summaries), and that is what the CLI export in §5.3 is for.
- **Archive/rehydrate UI:** actions on the character detail/menu, with a confirm dialog spelling
  out precisely what archiving removes — memories, correspondence, photographs beyond the
  avatar, conversation summaries — and what it keeps. All new strings in the steampunk register.

### 5.3 CLI

`packages/quilltap` — extend `cmdCharacters` (`lib/db-commands.js:925`, currently only
`status`):

- `characters archives` — list ARCHIVE bundles and archived characters.
- `characters archive <name|id>` / `characters rehydrate <name|id>` — writes, gated on `--write`
  + instance lock via `lib/lock-helpers.js` (`acquireInstanceLock`); never `--lock-override`.
- `characters export <name|id> [--out <path>]` — **the interchange escape hatch (§4.2c).**
  Writes a *plaintext* `.qtap`, and works for live characters (export the vault as it stands)
  and archived ones alike (decrypt the bundle and write it out). Read-only; no `--write`.

  This is the only way to get an archived character's deleted material — mail, photographs,
  summaries — back out without rehydrating, and the only portable form of an encrypted bundle.
  It is **pre-emptive, not recovery**: it needs an instance that can still decrypt, so it does
  not help someone holding only a restored backup and a forgotten passphrase. Say so in
  `CLI.md`, next to the passphrase-change warning.

Bump the CLI version (auto-published; no manual `npm publish` ask). Update
`docs/developer/CLI.md`.

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

> **Landed (2026-08-10):** `rehydrateCharacter` in `lib/characters/archive-service.ts`
> implements the steps below, with two notes. Step 5's memory re-embedding needed no export
> of `enqueueImportedMemoryEmbeddings` after all — the rehydrate path runs `executeImport`
> whole, which already fans imported memories out to the embedder; only the vault side
> (`reindexLinks` to re-chunk, then `enqueueEmbeddingJobsForMountPoint`) is called
> explicitly. Step 6's "offer deletion in the UI" is a post-rehydrate keep/discard dialog,
> and `DELETE /api/v1/files/[id]` refuses (without `force=true`) to remove a bundle that a
> still-archived character references. An extra verification joined step 1: the decrypted
> plaintext must match the file row's recorded sha256 (the §4.2d plaintext digest).

**§4.2a changes what this operation *is*.** It was "import a bundle into an empty space." It is
now "**restore the pruned material back into a mount that still exists**" — the mount point, its
folders, the managed documents, the avatar and the wardrobe are all present and must be left
exactly as they are. Everything the prune deleted comes back at its original ids.

`rehydrate(characterId)` in the archive service:

1. Load the bundle from `archiveFileId` and **decrypt** it (§4.2c). A wrong/absent passphrase
   must report the "predates your passphrase change" diagnosis, not a GCM failure. Validate the
   manifest (`format`, `preserveIds` set) and that the bundle's character id equals this
   character's id.
2. **Collision pre-scan in skip-if-present mode — the F4 amendment.** WP B1's rule is *refuse the
   whole import if any claimed id exists*, which is right for importing a stranger's bundle and
   catastrophically wrong here: rehydration collides, by construction, on the mount point, every
   folder, all ten managed documents, the avatar blob and its link, and `wardrobe.json`. Under
   the B1 rule rehydrate would refuse 100% of the time.

   The rehydrate path therefore uses a second mode: an id that already exists inside **this
   character's own vault** is skipped, not refused. An id that exists **anywhere else** — a
   different mount, a live character, another character's memory — is still a hard refusal, and
   still atomic. The distinction is what keeps B1's "no partial application" promise meaningful
   rather than discarded.
3. Import with `preserveIds`: the deleted documents, blobs, `Mail/`, `Conversation Summaries/`
   and the memories all land at their original ids inside the existing mount. Nothing repoints:
   `characterDocumentMountPointId` never changed, and neither did `defaultImageId` or
   `avatarOverrides`, so there is no character-record patch to apply beyond step 4.
4. Clear `archivedAt` and `archiveFileId` (the single-key unarchive patch the §4.4 guard
   sanctions); flip participant rows back to present (§4.5). If `archivedAvatarFileId` is set —
   a pre-revision tombstone — delete that thumbnail `files` row and null the column.
5. Re-embed: memories via the `enqueueImportedMemoryEmbeddings` fan-out — **currently
   module-private** in `lib/import/quilltap-import/execute.ts:62`, export it; restored vault
   chunks via `enqueueEmbeddingJobsForMountPoint` (`lib/mount-index/embedding-scheduler.ts:25`).
   The keep-set documents keep the chunks they never lost.
6. Leave the bundle file in the library (cheap insurance); offer deletion in the UI.

No reconcile pass needed: chat participants, memories, group memberships, roster entries, avatar
pointers and wardrobe references all still resolve — most of them never stopped.

**Failure semantics:** any failure before step 4's clear leaves the character archived with the
bundle intact (parent §6.1). Because step 3 is additive and id-preserving, a partial restore
followed by a re-run is safe: the second pass skips what the first already put back. The
cross-vault collision refusal changes nothing.

---

## 7. Test plan (concrete suites)

Beyond the WP A2 tests (§2.6) and WP B1 tests (§3), per the parent §12:

- **Archive/rehydrate identity:** archive → assert the *pruned* set is gone (`Mail/`,
  `Conversation Summaries/`, non-avatar photographs, their chunks, the vector store,
  `embedding_status`, own memories) **and the keep-set survives** (mount point, all ten managed
  documents, avatar blob + link row, `wardrobe.json` and `Wardrobe/`); the character page still
  renders every managed field; rehydrate → every deleted path/blob/memory back at original ids
  with the keep-set untouched and undulplicated, participants/groups/rosters resolve with no
  reconcile; `relatedMemoryIds` intact on both sides of the archive boundary.
- **Avatar continuity (the bug-52 sibling):** after archiving, `defaultImageId` and every
  `avatarOverrides[].imageId` still resolve through `resolveCharacterAvatar`, and old chat
  messages render the same face as before. No `archivedAvatarFileId` involved.
- **Overlay must NOT short-circuit:** an archived character read through `findById` and through
  a list returns fully populated managed fields, not a hollow row (the §4.3 reversal). An
  archived character whose vault is genuinely broken still throws/drops as a live one would.
- **Encryption (§4.2c):** a bundle round-trips through encrypt → decrypt byte-for-byte at a size
  above one blob chunk; the header's verification hash rejects a wrong passphrase with the named
  error; a bundle written on a no-passphrase instance opens on a *different* no-passphrase
  instance (the portability property the pepper would have broken); `changePassphrase`
  re-encrypts every ARCHIVE file and, on a mid-run failure, names the ones left behind.
- **Rehydrate collision modes:** rehydrating collides on the whole keep-set and succeeds anyway
  (skip-if-present); a claimed id living in a *different* mount, or a live character at the
  bundle's character id, still refuses atomically and changes nothing.
- **Read-only:** repository `update`, each sub-array mutator, `doc_edit`, wardrobe writes, mail
  send/list (tool + API), and turn participation each refuse an archived character with the
  named error — not a crash, not a silent no-op (today's missing-row `UPDATE` is a silent no-op;
  the guard must be observable).
- **Resurrection guards:** boot with archived characters present — `backfill-character-vaults`
  provisions nothing; mail delivery to an archived recipient refuses and does not recreate the
  pruned `Mail/` folder.
- **Memory asymmetry:** after archive, own memories absent from search/recall/memories tab;
  another character's `aboutCharacterId` memory still retrievable and still resolves the name.
- **Wipe options:** Delete All Data and restore-replace, each × {keep, wipe}: keep → ARCHIVE
  files survive, archived `characters` rows don't, and the surviving bundle **still decrypts**
  (§4.7) and imports but doesn't rehydrate; wipe → nothing survives.
- **Group counts:** group with an archived member reports full count, badge in the list, only
  live members offered for a turn.
- Jest suites touching the real SQLCipher binding need the `@jest-environment node` docblock and
  root-path `require` of `better-sqlite3` (established conventions).

---

## 8. Sequencing summary

1. **A1** — file the bug (independent, immediate). **Done.**
2. **A2** — `streamOneStore` extraction → characters emission → reader/`buildExportDataForType`
   → importer scaffold-replacement + avatar remap → schemas/preview → tests. **Done (F2).**
3. **B1** — `preserveIds` threading + collision pre-scan + tests. **Done** — F4 finished
   the vault internals and added the skip-if-present mode §6 requires.
4. **B2** — migration + ARCHIVE category/exclusions → archive service reworked to
   prune-in-place (**F6**) → archive encryption (**F7**) → write guards incl. the two promoted
   call sites (§4.6) → participant flip → the remaining call-site fixes →
   delete-service/restore options → tests. **Done in full (2026-08-10).**
5. **B3** — GET filter + pickers → roster/badges/read-only page → CLI (incl. `characters
   export`) → help/CHANGELOG/DDL/API docs. **Done in full (2026-08-10);** see the header
   Status block for the two recorded deviations (CLI verbs proxy the server; member-count
   phrasing).
6. **B4** — rehydrate + re-embed + tests. **Done (2026-08-10):** `rehydrateCharacter`
   restores per §6 (decrypt → plaintext-digest verify → manifest/character checks →
   `executeImport` with skip-if-present → `{ archivedAt: null }` then the pointer-cleanup
   patch → seats back to active → `reindexLinks` + mount embedding scheduler). Restored
   memories re-embed through the import's own `enqueueImportedMemoryEmbeddings` fan-out —
   the export it called for was unnecessary since the rehydrate path runs `executeImport`
   whole. The bundle stays shelved; the UI offers keep/discard, and the files DELETE route
   refuses (sans `force=true`) to delete a bundle a still-archived character holds.

Each of B2–B4 lands with its tests. The old sequencing rule ("the write guard and the backfill
skip must land with the migration, or a boot would resurrect a tombstone") is **retired by
§4.2a** — nothing resurrects a vault that was never deleted. The replacement rule is sharper:
**the write guards (§4.4, including the two call sites §4.6 promotes) must land in the same
change as the prune**, because after the prune an archived character has a live, writable vault
and nothing else stops an edit.

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
   vault is unreadable. **Superseded by §4.2a:** the archived branch is not merely a small
   change, it is now *wrong* — an archived character keeps a readable vault and must be
   hydrated from it like any other. The parent's "single most important change in Deliverable B"
   should be struck from the design doc entirely.
5. Import step order already accommodates character-owned stores (characters at step 6, doc
   stores at 7c) — no reordering needed; the scaffold-vault replacement happens in reconcile.
6. The parent's §5.1 `doc_mount_file` / `doc_mount_file_link` record kinds are replaced by
   optional id fields on the existing `doc_mount_document` / `doc_mount_blob` shapes (§2.3) —
   strictly better back-compat; revisit only if hard-link topology demands it.
7. `components/files/FileBrowser.tsx` has no `FileCategory` filter to extend — ARCHIVE files
   need no file-library UI work beyond the export exclusions.
8. The biggest unlisted hazard class is **vault resurrection** via `ensureCharacterVault` — the
   startup backfill and the four mail paths (§4.4) — which the parent's audit list only
   partially covered. **Largely defused by §4.2a:** nothing can resurrect a vault that is never
   deleted. The hazard class it is replaced by is **writes to a live archived vault** (§4.4).
9. **§9.1 of the parent doc (the rejected "archive as a virtual overlay") stands, and §4.2a is
   not a partial re-opening of it.** Prune-in-place keeps the real row *and* a real mount — it
   moves less out of the databases, not more. Nothing here asks a list query, a raw bypass, or
   the vault shadow to merge a file-backed source.

---

## 11. Fixup work packages (review of 2026-08-10, `character-archive` branch)

A review of the branch (commits 52cbebee..3b032589) found the work below incomplete or
defective. Each step is self-contained and labeled so a session can be told "work on
character-archive-spec.md, step F*n*".

**Status and order after the 2026-08-10 design revision (§4.2a):**

| Step | What | State |
|---|---|---|
| **F1** | Make the branch compile | **Landed** |
| **F2** | Real A2 — bundles carry the vault | **Landed** |
| **F3** | Archive-service correctness | **Landed, then partly superseded by §4.2a — see F6** |
| **F4** | `preserveIds` reaches vault internals **+ skip-if-present mode** | **Landed** |
| **F6** | Prune-in-place rework of the archive service | **Landed** |
| **F7** | Archive encryption + passphrase-change re-encryption | **Landed** |
| **F5** | Truth in documentation | **Landed** |

F4 comes before F6 because the prune's counterpart — rehydration — cannot exist without it, and
because F6's tests assert the round trip. F7 is separable from F6 but should not ship after B3
surfaces the archive to operators in plaintext.

Every step finishes by running `npx tsc` (must be clean), `npm run lint`, and the touched Jest
suites. The suites now passing (`archive-service`, `characters-repository-archive`,
`reconcile-avatar-remap`, `character-vault-export`, `import-characters-vault`,
`quilltap-import-service`, `turn-manager`, `participant-resolver.service`,
`character-properties-overlay`, `import-files`, `import-groups`, `ndjson-roundtrip`) must stay
green — F6 will legitimately rewrite much of `archive-service`, but nothing else.

### F1 — make the branch compile — **LANDED**

`npx tsc` fails with three errors, all in `lib/characters/archive-service.ts`. The
archive-service Jest suite passes only because it mocks a repository method that does not
exist — fix the code, then make the test mock the *real* surface.

1. **`setParticipantStatus` is not reachable** (errors at archive-service.ts:213,224). The
   method exists on `ChatParticipantsOps` (`lib/database/repositories/chats-participants.ops.ts:152`)
   but `ChatsRepository` never delegates it (the delegation block at
   `chats.repository.ts:398–435` exposes only add/update/remove/get*), and
   `UserScopedChatsRepository` (`lib/repositories/user-scoped.ts:176`) only exposes what it
   explicitly defines. Fix: add a `setParticipantStatus(chatId, participantId, status)`
   delegation on `ChatsRepository` in the participant-ops section, then an override on
   `UserScopedChatsRepository` that ownership-checks via `this.findById(chatId)` first (match
   the `addMessage` pattern at user-scoped.ts:198–202). Then delete the runtime
   `if (!repos.chats?.findByCharacterId || !repos.chats?.setParticipantStatus)` defensive
   branch in `flipCharacterParticipantsToAbsent` — with real types it is dead code that hides
   regressions.
2. **`exportData.data.characters` union error** (archive-service.ts:130).
   `assembleExportFromStream` returns the `QuilltapExportData` union; narrow it with an
   `'characters' in data` guard (or assert `manifest.exportType === 'characters'` and cast to
   the characters shape) before reading `.characters`.
3. **Tests:** update `__tests__/unit/lib/characters/archive-service.test.ts` so the chats mock
   mirrors the now-real repo surface (the current mock at :96–98 invents the method — it would
   keep passing if the method were renamed away again). Add a test that the participant flip
   actually calls through with `'absent'`.

### F2 — real A2: character bundles must carry the vault — **LANDED**

The reader half of A2 landed (`buildExportDataForType` characters branch, the optional
`fileId`/`linkId`/`blobId` fields on `ExportedDocumentStoreDocument`/`Blob`, the
`idMaps.docMountFileLinks` remap in reconcile). **The writer half did not**: `streamCharacters`
(`lib/export/ndjson-writer.ts:144`) still emits only the row, wardrobe, plugin data, and
memories — no vault. Consequences until fixed: bug 52 is *not* fixed (avatars are now cleared
with a warning instead of dangling — better, still lossy), and the archive bundle written by
`archiveCharacter` omits the vault entirely, so completing the archive lifecycle (F3) would
destroy photos/mail/vault files permanently. Do not merge F3's cleanup fix before this step.

Implement §2.1–§2.6 as specced. Concretely:

1. Extract `streamOneStore` from the per-store body of `streamDocumentStores`
   (§2.1; chunking invariants there are non-negotiable).
2. Emit it from `streamCharacters` when `char.characterDocumentMountPointId` is set — after
   `character_plugin_data`, before `memory`, with `skipProjectLinks: true` (§2.2). Bump the
   manifest doc-store `counts` from this path.
3. Scaffold-vault replacement in `reconcileRelationships` (§2.4): bundle wins whole-store —
   repoint `characterDocumentMountPointId` to the imported mount, then
   `deleteStoreCascade(scaffoldMountId)`. Never merge.
4. Schema updates (§2.5): both `public/schemas/qtap-export*.schema.json` gain the optional
   `fileId`/`linkId`/`blobId` fields, the `preserveIds` manifest flag, the three character
   archive fields (`archivedAt`/`archiveFileId`/`archivedAvatarFileId`), and prose noting
   doc-store kinds may appear in a `characters` stream. `previewExport` reports store/blob
   counts + estimated size for the characters type.
5. Two defects in the landed reconcile remap (`lib/import/quilltap-import/reconcile.ts:112+`):
   an unmappable `avatarOverrides[].imageId` is written as `{ imageId: null as unknown as
   string }` — **drop the override entry instead** (a null imageId violates the schema on the
   next validated read); and `hasUpdates` is set unconditionally when overrides exist — set it
   only when something actually changed.
6. Tests: the §2.6 list (round-trip with photos/Mail/multi-chunk blob, legacy avatar, compat
   pair, chunk boundaries, scaffold replacement).

### F3 — archive service correctness (ordering, honesty, re-runnability) — **LANDED, PARTLY SUPERSEDED**

> **Read F6 before acting on this section.** F3 landed in full and fixed five real defects, but
> §4.2a removed the problem three of them solved. Specifically:
>
> - **Superseded:** the deferred pointer-null (F3.1), the sanctioned finalization patch (F3.2),
>   and the crash-window recoverability it bought. Nothing nulls
>   `characterDocumentMountPointId` any more, so F6 removes that machinery and narrows the §4.4
>   guard back to the unarchive shape alone.
> - **Still correct and kept:** honest `cleanupComplete` (F3.4) — now "prune incomplete";
>   real verification before the commit (F3.5); real sha256 (F3.6); the pre-commit rollback that
>   deletes an orphan bundle file; re-runnability (F3.3), which stays but becomes trivially
>   idempotent because the prune is a delete-set rather than a teardown.
> - **Still correct, now urgent:** the rehydrate refusal (F3.7) stays in force until B4 ships.
>
> The historical account below is retained because F6 is a diff against it.

Defects in `lib/characters/archive-service.ts` as landed:

- **The vault is never deleted.** The tombstone commit nulls
  `characterDocumentMountPointId`; `cleanupArchivedCharacterState` then re-reads the character
  and only calls `deleteStoreCascade` if the pointer is set — always null by then. (This bug is
  currently the only thing preventing the F2 data-loss scenario; fix them in this order.)
- **Archive is not re-runnable.** A second `archiveCharacter` call throws
  `CharacterArchivedError` from the write guard, contradicting §4.2's "re-running cleanup …
  finishes the job".
- **`cleanupComplete` lies** — every step catch-warns and the function returns `true`
  regardless.
- **Verification is vacuous** — only memory count and character count are checked; no store
  record counts, no footer check (§4.2 step 2).
- **Fake checksums** — ARCHIVE and AVATAR `files` rows get `sha256: '0'.repeat(64)`.

Fixes (this step amends §4.2's step 4/5 ordering; note the amendment inline there when done):

1. **Defer the pointer-null to cleanup.** The commit transaction sets
   `archivedAt`/`archiveFileId`/`archivedAvatarFileId` and nulls the avatar/default-FK fields,
   but **keeps `characterDocumentMountPointId`**. Cleanup deletes the vault via
   `deleteStoreCascade(pointer)` and nulls the pointer as its final act. A
   tombstone-with-pointer is safe in the interim: `hydrateOne` and
   `applyDocumentStoreOverlayOne` check `archivedAt` before `hasLinkedVault` (the §4.3
   branches), so the row passes through unhollowed. This is what makes a crash between commit
   and cleanup recoverable — the pointer survives, so the re-run can still find the vault.
2. **Sanction the finalization patch.** Extend `validateCharacterArchivePatch`
   (`characters.repository.ts`) to allow, on an archived row, a patch whose keys are a subset
   of the archive-finalization set (`characterDocumentMountPointId: null` and nothing else is
   sufficient) alongside the existing single-key unarchive shape. Keep everything else
   refused.
3. **Re-runnability:** `archiveCharacter` on an already-archived row skips bundle-write and
   commit and runs cleanup only (memories, vector store, vault-if-pointer-remains).
4. **Honest `cleanupComplete`:** each cleanup step reports success; return the conjunction.
   Callers must be able to distinguish "archived, cleanup incomplete" (§4.2 failure
   semantics).
5. **Real verification** (needs F2): stream the bundle back and check store-record counts
   against the live vault (mount points, documents, blobs), memory count, and the NDJSON
   footer counts, before the commit.
6. **Real sha256** via `crypto.createHash('sha256')` on the ARCHIVE and AVATAR buffers.
7. **Rehydrate stub hazard** *(resolved by B4, 2026-08-10 — the full restore path now
   exists; the refusal below served in the interim)*: `rehydrateCharacter` currently just clears `archivedAt`. That is
   worse than nothing once cleanup works: it produces a live character with no vault whose
   pointer is gone, and the next boot's backfill provisions a fresh *empty* vault — completing
   the data loss while the bundle sits unreferenced. Until WP B4 implements the full restore
   path, make `rehydrateCharacter` **refuse** (named error, "rehydration is not yet
   implemented") when `archiveFileId` is set and cleanup has run; do not ship a
   clears-the-flag-only rehydrate. Update its tests accordingly.
8. Tests: vault actually deleted (pointer captured, cascade called); crash-window re-run
   finishes the vault; `cleanupComplete: false` when a step fails; second archive call is a
   cleanup-only no-op, not a throw.

### F4 — `preserveIds` must reach vault internals — **LANDED**

> **Landed 2026-08-10.** Folder records now carry `id` (writer, type, JSON schema);
> `LinkDocumentInput`/`LinkBlobInput`/`CreateBlobInput` accept explicit `fileId` /
> `documentId` / `blobId` / `linkId`, honored only on actual row creation;
> `importDocumentStores` threads them under `preserveIds`, remaps folder parents and
> document `folderId`s by path when ids aren't preserved (item 7), and
> `preflightPreserveIds` checks folder/file/link/blob ids. The skip-if-present mode is
> `ImportOptions.preserveIdsMode` (`lib/import/quilltap-import/types.ts`), with the
> sanctioned skip set carried in `idMaps.preserveIdsSkips`. Tests:
> `import-document-stores.test.ts`, `quilltap-import-service.test.ts`, and the
> real-binding `doc-mount-preserve-ids.integration.test.ts`.

`preserveIds` is threaded for characters, tags, templates, projects, groups, chats, memories,
profiles, and mount points — but **folders, documents, blobs, and file links still mint fresh
ids** in `importDocumentStores`, and the collision preflight in
`lib/import/quilltap-import/execute.ts` doesn't scan them. Without this, WP B4's "every id is
original, no reconcile needed" rehydration cannot work.

1. **Folders:** `docMountFolders.create` already accepts `CreateOptions`
   (`doc-mount-folders.repository.ts:142–144`) — pass `{ id: folder.id }` under `preserveIds`.
   Bonus: this fixes the currently-broken `parentId` handling for preserved imports (the loop
   at `import-document-stores.ts:155+` imports `parentId` verbatim with a comment punting to
   backfill; with original folder ids the verbatim value is simply correct — say so in the
   code comment).
2. **Documents/links:** `linkDocumentContent` (`doc-mount-file-links.repository.ts:980`) mints
   file + document + link ids internally. Extend `LinkDocumentInput` with optional explicit
   ids (`fileId`, `linkId`, `documentId`), honored only when present; populate them from the
   bundle's carried ids under `preserveIds`. Keep this single chokepoint — do **not** copy the
   backup-restore raw-SQL path (`lib/backup/restore/restore.ts:589`) into the importer.
3. **Blobs:** same treatment for `docMountBlobs.create` (`doc-mount-blobs.repository.ts:289`,
   `CreateBlobInput`): optional `fileId`, `linkId`, `blobId`.
4. **Preflight:** extend `preflightPreserveIds` with folder / document / blob / link id
   checks via the `globalRepos.docMount*` repositories. The ids to check are the bundle's
   carried `fileId`/`linkId`/`blobId` fields and folder ids.
5. **Export side:** `streamOneStore` (F2) carries the ids the import side needs on documents and
   blobs (`fileId`/`linkId`/`blobId`) — but **folder records do not carry `id`**; they emit
   `mountPointId`, `parentId`, `name`, `path` only. The earlier claim that "folder records
   already carry `id`" was wrong. Add it as another optional field, same back-compat rationale
   as §2.3, and add it to `ExportedDocumentStoreFolder` in `qtap-export.schema.json`.
6. **Skip-if-present mode — required by §6 (the §4.2a amendment).** B1's rule is *refuse the
   entire import on any id collision*. Rehydration restores into a mount that still exists, so
   it collides by construction on the mount point, every folder, all ten managed documents, the
   avatar blob and its link, and `wardrobe.json` — under the B1 rule it would refuse every time.

   Add a second preflight mode, used only by the rehydrate path:
   - an id that already exists **inside the target character's own vault** → skip that record,
     import the rest;
   - an id that exists **anywhere else** (a different mount, a live character, another
     character's memory) → refuse the whole operation, atomically, exactly as B1 says.

   Keep the modes explicit and named at the call site. The ordinary import wizard must never
   reach skip-if-present: silently skipping a colliding id there is the "partial application"
   B1 exists to prevent.
7. **Non-preserveIds folder remap (pre-existing bug, surfaced by F2).** Documents import with
   `folderId: doc.folderId ?? null` — the *source* folder id — while folders are created with
   fresh ids, so without `preserveIds` every imported document carries a dangling `folderId`.
   Harmless today because store listing filters by `relativePath` prefix, not `folderId`, but it
   is wrong and F2 made character vaults (which are all folders) hit it routinely. Build a
   source-folder-id → new-folder-id map in `importDocumentStores` and remap through it.
8. Tests: preserveIds round-trip preserves folder/file/link/document/blob ids end-to-end; a
   single colliding link id refuses the whole import and changes nothing; skip-if-present
   tolerates a full keep-set collision inside the same vault while still refusing a collision in
   a different mount; a non-preserveIds import lands documents with resolvable `folderId`s.

### F6 — prune in place (the §4.2a rework) — **LANDED**

> **Landed 2026-08-10.** All eight items below shipped: the prune replaces the teardown
> (delete-set via `deleteWithGC`, folder sweep sparing `Wardrobe/` and anything sheltering kept
> content, embedding_status sweep for deleted chunks and memories); the pointer, avatar fields
> and thumbnail copy are no longer touched (`pruneComplete` replaces `cleanupComplete` in the
> result); the finalization patch is refused again; both overlay short-circuits are removed
> (archived characters hydrate, broken archived vaults still throw/drop); the two promoted
> guards landed (`resolveSelfVaultMountPointId` returns null for archived,
> `resolveWardrobeMount` throws — a null there would fall back to the legacy DB write path).
> Tests: `archive-service` (rewritten for prune semantics, including the honesty re-listing and
> pre-revision-tombstone cases), `characters-repository-archive` (finalization now asserted
> refused), `character-properties-overlay` (overlay-must-not-hollow + broken-vault-still-throws),
> `path-resolver`, and the new `wardrobe-writes-archived`.

Rewrite `lib/characters/archive-service.ts` from "export, then delete the vault" to "export,
then prune the vault", per §4.2 as revised. This is the largest remaining piece.

1. **Remove the delete.** No `deleteStoreCascade` on the character's own mount, ever. Replace
   `deleteVaultAndClearPointer` with a prune that deletes everything outside §4.2a's keep-set,
   through the document-store delete paths so link-group orphan GC still runs.
2. **Stop nulling the pointer, and stop sanctioning the patch that did.** Remove the F3
   finalization branch from `validateCharacterArchivePatch`, leaving only the unarchive shape.
   Remove the F3 tests that assert the finalization patch is allowed; add one asserting it is
   now refused.
3. **Stop nulling the avatar fields.** `defaultImageId` and `avatarOverrides` stay — the blobs
   they point at are in the keep-set. This is what keeps old messages' faces.
4. **Remove the §4.3 short-circuits** — both `hydrateOne` and `applyDocumentStoreOverlayOne`.
   An archived character must hydrate from its vault (§4.3 as revised).
5. **Retire `archivedAvatarFileId`** — stop writing it and stop copying the thumbnail. Leave the
   column and treat non-null as a pre-revision tombstone.
6. **Extend the write guards** to the two call sites §4.6 promotes (`doc-edit/path-resolver.ts`,
   `vault-overlay/wardrobe-writes.ts`), which no longer self-skip. **These land in the same
   change as the prune** — see §8's replacement sequencing rule.
7. **Keep** F3's honest completion reporting, verification, real sha256, pre-commit rollback and
   re-runnability, adapted to the new step numbering.
8. Tests: the §7 archive/rehydrate identity, avatar continuity, and overlay-must-not-hollow
   cases.

### F7 — archive encryption — **LANDED**

> **Landed 2026-08-10.** The primitive is `lib/characters/archive-crypto.ts` (magic + JSON
> header carrying KDF params/salt/IV/key-verification hash, raw chunked-cipher ciphertext, GCM
> tag; `.dbkey` parameters exactly). Key availability is solved by an in-memory runtime
> passphrase cache (`lib/startup/passphrase-cache.ts`) that every `.dbkey` chokepoint (setup,
> unlock, change, store) deposits into and `lockDbKey` clears; `resolveArchivePassphrase()`
> reads it, falls back to `INTERNAL_PASSPHRASE` on no-passphrase instances, and refuses with a
> named `ArchiveKeyUnavailableError` otherwise. `archiveCharacter` encrypts before the file row
> is written and verifies by decrypting/parsing the ciphertext it persists; the row keeps the
> plaintext sha256, `size` is the encrypted length. `changePassphrase`'s second phase is
> `lib/characters/archive-reencrypt.ts`, wired into the unlock route — it also encrypts
> pre-encryption plaintext bundles, and names partial-failure leftovers in the response and
> the ChangePassphraseCard (which now warns up front with the archive count via a new
> `category` filter on the files GET). Item 3's CLI `characters export` wiring ships with the
> B3 CLI work (§8), which is where that command is built. Tests: `archive-crypto`,
> `archive-reencrypt`, `archive-service` (encryption wiring), `dbkey` (cache chokepoints).

Implement §4.2c.

1. **New streaming primitive** — do not reuse `encryptWithPassphrase` or
   `encryptPepperWithParams`; both JSON-stringify and hex-encode. Header (version, salt, IV,
   passphrase-verification hash) + `createCipheriv` over the stream + GCM tag. Same parameters
   as `.dbkey`: PBKDF2-SHA256 600k → AES-256-GCM.
2. **Key selection:** the user passphrase when set, `INTERNAL_PASSPHRASE`
   (`lib/startup/dbkey.ts:111`) when not. Never `ENCRYPTION_MASTER_PEPPER` — see §4.2c for why
   that would make every restored archive undecryptable.
3. **Wire it into archive and rehydrate**, and into the CLI `characters export` (§5.3), which is
   the only decrypt-to-plaintext path.
4. **`changePassphrase` re-encrypts every ARCHIVE bundle** (`lib/startup/dbkey.ts:501`), with UI
   copy warning that this will happen and how many files are involved, progress reporting, and a
   partial-failure report naming the archives left on the old passphrase.
5. Tests: the §7 encryption cases, including cross-instance portability on no-passphrase
   instances and the named error for a passphrase-change mismatch.

### F5 — truth in documentation (run last) — **LANDED**

> **Landed 2026-08-10.** The CHANGELOG's four false/stale 4.8-dev entries were rewritten (the
> rehydrate overclaim, the finalization entry, the two-stage avatar fix, the F3 teardown entry
> whose pointer-ordering and AVATAR-row claims F6 falsified, and the preserveIds entry's
> implied wizard option). `help/system-import-export.md`: duplicate step 7 fixed, wizard-facing
> "Preserve IDs" copy replaced with a file-format note (archive tooling only), and a
> vault-now-travels paragraph added; `help/character-import-export.md` gained "The Vault
> Travels Too" and the wizard's vault-counts line. The parent design doc was updated per the
> punch list: header supersession notice, §1/§3.7 amendments, §6.2 rewritten (the "single most
> important change in Deliverable B" is struck), §6.3 rewritten as prune, §6.5/§6.6 reframed.
> **Deliberately deferred to B3, where the surfaces ship:** help coverage for the
> archive/rehydrate lifecycle, archive encryption's operator-visible behaviour, and the CLI
> `characters export` escape hatch (plus its `CLI.md` entry) — none of these is reachable by an
> operator today (no UI action, no API route, no CLI command invokes the archive service), and
> documenting unreachable features would recreate exactly the overclaim this step exists to
> remove.

The branch's docs overclaim. After F1–F4, F6 and F7 land, reconcile every claim with reality.

**Added to the punch list since this section was written:**

- **F2's user-visible changes need help coverage** — `help/character-import-export.md` (a
  character bundle now carries the vault: photographs, correspondence, avatar) and the new vault
  line in the export wizard's options step. Neither is mentioned below.
- **§4.2c's operator-visible behaviour** — encrypted bundles, the passphrase-change rewrite
  warning, and the CLI `characters export` escape hatch (and its pre-emptive-not-recovery
  caveat) — needs `help/character-management.md` and `docs/developer/CLI.md`.
- **The design doc needs the §4.2a revision folded back in**, including striking its "single
  most important change in Deliverable B" (§10 correction 4) and its §6.2 tombstone description,
  which describes a hollow row that no longer exists.

The original list:

1. **`docs/CHANGELOG.md` (4.8-dev):** three entries are false as shipped — "character avatars
   now survive cross-instance .qtap imports" (they were cleared-with-warning until F2),
   "archive finalization now flips chat seats and cleans up safely" (didn't compile; vault
   cleanup never ran until F1/F3), and the rehydrate entry (stub). Rewrite them to describe
   what is true post-fixups; plain voice, no duplicate section headers.
2. **`help/system-import-export.md`:** fix the duplicated step "7"; the "Preserve IDs" option
   is documented but has **no UI consumer** — remove the wizard-facing copy (or move it to a
   note that the option exists for archive tooling only) until WP B3 ships a control for it.
   Keep the `url` frontmatter / In-Chat Navigation contract intact.
3. **This file:** the contradictory "Implemented pieces so far" / "Still pending" lists in §4.2
   are gone (replaced by §4.2a–d in the 2026-08-10 revision). What remains for F5 is to refresh
   the §0 table, the header Status block, and the F-step status table in §11 against whatever
   actually shipped — and to strike any passage the revision left stranded.
4. Verify against the code, not the commit messages — the review that produced this section
   exists because the two diverged.
