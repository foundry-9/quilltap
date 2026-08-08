# Session 2 — Store delete & restore/import integrity (Bugs 9, 10, 11, 12)

The successor family to Bugs 1–4: everything here is backup/restore/import
integrity, and the bugs interlock — Bug 9's orphans are what make Bug 10's and
Bug 12's restores fail. Fix in the order given. Run before Session 3.

Read the standing rules in [README.md](README.md). Full root causes:
`../bugs.md` → Bugs 9–12, plus the "Known residue from Bug 3's
placement" section (it is Bug 12's design note).

**All four are Pinned** — v5 has already taken each fix and asserts v4's defect
in both directions. Expect the named tripwires to go red; that is convergence.

---

## Bug 9 — deleting a document store leaves orphaned rows

**Severity: High.**

### What happens

`DELETE` on `app/api/v1/mount-points/[id]/route.ts` (`:185`–`:205`) runs seven
independent awaited repo calls with no transaction. Measured orphans on the
Friday copy: 43 `doc_mount_file_links` + 118 `doc_mount_folders` across 21
vanished mount points. Read connections have foreign keys off, so nothing
errors — until a backup carries the orphans (raw `SELECT *`) and a restore
inserts them where `PRAGMA foreign_keys = ON`, failing with
`FOREIGN KEY constraint failed`.

Specific defects inside the cascade:

- `docMountDocuments.deleteByMountPointId` (`:191`) runs **after**
  `docMountFiles.deleteByMountPointId` (`:188`) emptied the link table it
  reads — a dead step; native-text documents leak.
- `docMountBlobs.deleteByMountPointId` (`:192`) is a copy-paste that never
  names `doc_mount_blobs` — does nothing (blobs survive only via the `fileId`
  `ON DELETE CASCADE` FK).
- `group_doc_mount_links` is **never deleted** — the route deletes
  `projectDocMountLinks` only.

### The fix

1. Wrap the whole cascade in a single transaction.
2. Reorder so each step still has the rows it reads (documents before files),
   and make the blobs step real or delete it with a comment explaining the FK
   cascade covers it.
3. Delete `group_doc_mount_links` rows for the store (today's only group-link
   delete is `deleteByGroupId`; add a `deleteByMountPointId` sibling).
4. Add an **orphan reaper** for rows already stranded on existing instances:
   a sweep that removes `doc_mount_file_links` / `doc_mount_folders` /
   `doc_mount_documents` rows whose mount point no longer exists, joined to
   the existing daily maintenance sweep (and run once at boot). Model it on
   v5's `sweep_orphaned_store_children`. Fire debug logs with counts.

### Verification

- Unit: delete a store with files, folders, native-text documents, project
  links and group links → all child tables empty for that mount point; a
  mid-cascade failure rolls the whole thing back.
- Reaper unit test: seed orphans, run sweep, orphans gone, healthy rows kept.
- v5 tripwire: `store_delete_equivalence` (7 arms) — each carries a "v4 has
  CONVERGED — retire this divergence" message.

---

## Bug 10 — `conversation_annotations` is wiped by no delete path

**Severity: High** (privacy leak on delete-all; `UNIQUE constraint failed` on
restore into a migrated instance).

### The fix

Add `conversation_annotations` to every delete path it is missing from:

- `clearFormat3Entities`'s `mainTables`
  (`lib/backup/restore/delete-service.ts:34`),
- `deleteUserData`'s collection,
- `chats.repository.delete()` (per-chat sweep — today it sweeps only message
  rows).

Background: the `UNIQUE("chatId","messageIndex","characterName")` constraint
exists only on migrated instances (declared by
`migrations/scripts/sqlite-initial-schema.ts` / `create-conversation-tables.ts`
but not by `generateDDL`), which is why only migrated instances hard-fail on
restore. The fix here is the delete paths; reconciling the DDL drift is out of
scope — but note it in `bugs.md` if you confirm it, and check DDL.md
stays accurate for whatever you touch.

### Verification

- Unit: create annotations, run delete-all → table empty; delete one chat →
  its annotations gone, others kept.
- v5 tripwire: `system_delete_data_equivalence` → `ANNOTATION_DIVERGENCE_KEY`
  (v5 must be 0, oracle asserted non-zero — convergence fails it).

---

## Bug 11 — `.qtap` import overwrite mishandles store identity three ways

**Severity: High.** All in
`lib/import/quilltap-import/import-document-stores.ts`.

### The three defects → three fixes

1. **Overwrite-clear leaves `doc_mount_folders` standing** (`:63`–`:67`) →
   clear folders too, so an identical re-import is clean (no stale husks, no
   `UNIQUE` warnings).
2. **Overwrite matches the target store by NAME** (`:55`–`:57`) → match by
   **id**; a renamed store must not be silently redirected onto an unrelated
   store that inherited the old name.
3. **Import CREATE mints a fresh store id** (`:89`–`:105`) → preserve the
   archive's id on create, so an archive can be re-recognised on later import.

Watch interactions: preserving ids on create means a re-import of the same
archive now takes the overwrite path — make sure defects 1 and 2 are fixed
first so that path is actually correct. Check whether
`public/schemas/qtap-export.schema.json` documents store identity anywhere
that needs wording updates.

### Verification

- Unit/integration: export a store, rename it in-app, re-import with overwrite
  → the *renamed* store (same id) is updated, folders replaced not duplicated;
  import into a fresh instance → store keeps the archive id; import twice →
  second run is recognised as overwrite of the first.
- v5 tripwires: `system_import_state` → `FOLDER_CLEAR_DIVERGENCE`,
  `STORE_ID_PRESERVED_ON_CREATE`, the `execute_folder_overwrite` arm, and the
  four `store_identity_*` arms.

---

## Bug 12 — a second-generation restore loses archived link ids

**Severity: Medium.** The residue Bug 3's fix explicitly deferred (see
"Known residue from Bug 3's placement" in `bugs.md` — read it; it
explains why the phase order must NOT be reshuffled again).

### What happens

Restoring a backup of an instance that was itself restored: the file replay
(22a-bis) unconditionally re-ingests every user file into
`restored/<name>` — exactly where the **archived** link rows for those files
already live. The replay wins, the archived rows collide (`UNIQUE constraint
failed`), link ids are lost, and store rows duplicate again each generation.

### The fix

Teach the replay to recognise that the archive already carries the store rows
(file/link/blob) for a file and **skip re-ingesting it** — the archived rows
then restore intact at 22b/22d. This is v5's `carried_store_rows` check in its
restore orchestrator; port that idea, not a phase reorder. First-generation
archives (paths `chat/`, `images/`, …) must be unaffected.

### Verification

- Integration: restore an archive, back the result up, restore *that* into a
  fresh instance → no `UNIQUE` warnings for `restored/…`, link ids preserved,
  store-row count stable across generations.
- v5 tripwire: `system_restore_state` dedupe arms (ruled `REPLAY_DEDUPE`).

---

## Definition of done

- [ ] Fixes landed in order 9 → 10 → 11 → 12, each with regression tests that
      fail pre-fix
- [ ] Full backup→wipe→restore round-trip on a scratch instance with a vault,
      a project store, a group store, and annotations: clean logs, no FK/UNIQUE
      errors, second-generation restore stable
- [ ] Debug logging on all touched backend paths
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] `docs/CHANGELOG.md` entries; DDL.md checked; `bugs.md` Status rows
      flipped with dates + fix sites
- [ ] Final report lists all four tripwire families for the v5 side to retire
