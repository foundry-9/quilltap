# Bug 9 — deleting a document store leaves orphaned rows

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | **High** |
| **Who it bites** | every store delete; every restore of a backup taken after one |
| **Provenance** | Pinned |
| **Fix site** | `lib/mount-index/delete-store-cascade.ts` (single-transaction cascade, group-links included) wired at `app/api/v1/mount-points/[id]/route.ts` DELETE; `lib/mount-index/orphan-store-reaper.ts` + `DocMountFileLinksRepository.sweepOrphanedStoreChildren` joined to the daily sweep (`lib/background-jobs/scheduled-maintenance.ts`) and run at boot (`instrumentation.ts` Phase 3.3b); `GroupDocMountLinksRepository.deleteByMountPointId` added |
| **v5 status** | **Owed** — retire the 7 `store_delete_equivalence` arms; v4 now leaks 0 |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: High.** Non-atomic, with two dead delete steps and a whole table
never touched. The orphans it mints are what make later restores fail with
`FOREIGN KEY constraint failed` (dogfood #58).

### Symptom

Delete a document store (a character vault, a project/group store). Measured on
the Friday copy: **43 orphaned `doc_mount_file_links` rows** across 21 vanished
mount points, plus **118 orphaned `doc_mount_folders`**. Nothing errors — read
connections don't enable foreign keys, and a `generateDDL` link table declares
none — so the orphans sit quietly until a backup carries them (raw `SELECT *`)
and a restore inserts them where constraints **are** live
(`PRAGMA foreign_keys = ON`), at which point restore fails.

### Root cause

`app/api/v1/mount-points/[id]/route.ts` `DELETE` (`:185`–`:205`) runs seven
independent awaited repo calls with no surrounding transaction — a partial
failure is exactly how a permanent orphan is minted. Within them:

- **`docMountDocuments.deleteByMountPointId` (`:191`) runs *after*
  `docMountFiles.deleteByMountPointId` (`:188`)** has already emptied the link
  table it reads — a dead step, so native-text documents leak.
- **`docMountBlobs.deleteByMountPointId` (`:192`)** is a copy-paste of the files
  step that never actually names `doc_mount_blobs`. (Blobs happen to survive this
  because they die via the `fileId … ON DELETE CASCADE` FK — so no *blob* leak,
  but the step itself does nothing.)
- **`group_doc_mount_links` is never deleted.** The route deletes
  `projectDocMountLinks` (`:199`–`:201`) only; v4's sole group-link delete is
  `deleteByGroupId`, which no store delete calls.

### Why it survived

Foreign keys are off on the connections that do the deleting, so the orphans are
invisible until a restore turns constraints on — and the restore path is
exercised far less than the delete path.

### The fix

Wrap the cascade in a single transaction; route content through the orphan GC;
delete `group_doc_mount_links`; and add a boot/daily orphan reaper for the rows
already stranded on existing instances. This is what v5 does
(`db::doc_mount_file_links::sweep_orphaned_store_children`, joined to the daily
sweep).

### Verification

v5's `store_delete_equivalence` (7 arms) pins this both ways — v5 → 0 orphans,
v4 → the measured 2/4/3. Each arm carries a "v4 has CONVERGED — retire this
divergence" message that fires when v4 stops leaking.

**Fixed 2026-08-06.** New `lib/mount-index/delete-store-cascade.ts` runs the whole
teardown in one mount-index transaction (chunks → links → GC'd file/document/blob
content → folders → project *and* group links → the store row), skipping tables a
lean instance never created; wired at the DELETE route. Group links get a
`GroupDocMountLinksRepository.deleteByMountPointId`. The reaper lives in
`lib/mount-index/orphan-store-reaper.ts`, is exposed as
`DocMountFileLinksRepository.sweepOrphanedStoreChildren`, and runs at boot
(`instrumentation.ts` Phase 3.3b) and in the daily maintenance sweep.
