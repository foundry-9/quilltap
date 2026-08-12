# Bug 13 — `gcOrphanedFileRow` throws on a mount index without the blobs table

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | **High** (crash on 2nd write) |
| **Who it bites** | any store write against an old/hand-built/restored mount index |
| **Provenance** | Faithful |
| **Fix site** | `lib/database/repositories/doc-mount-file-links.repository.ts` — payload deletes guarded behind a `sqlite_master` existence check (`tableExistsSync`) |
| **v5 status** | **Owed** (Faithful) — mirror the guard in `gc_orphaned_file_row` |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `gcOrphanedFileRow` now guards each payload
delete (`doc_mount_documents`, `doc_mount_blobs`) behind a `sqlite_master`
table-existence check, so a document-only / restored / hand-built index that
never held a blob no longer throws on the second write. v5 obligation
(**Faithful**): mirror the guard in `gc_orphaned_file_row` in the same round.
Fix site: `lib/database/repositories/doc-mount-file-links.repository.ts`
(`tableExistsSync` + guarded deletes).

**Severity: High** — a hard throw on the **second** write to any path, on any
mount index that predates the lazily-created blobs table (a restore from an old
backup, a hand-built index). It broke twenty of the port's own fixture families
before v5 was even consulted.

### Root cause

`gcOrphanedFileRow`
(`lib/database/repositories/doc-mount-file-links.repository.ts:144`) runs inside
every content-addressed rewrite and issues `DELETE FROM doc_mount_blobs`
**unconditionally**. But `doc_mount_blobs` has no Zod schema — v4's blobs
repository creates it lazily from hand-written DDL on first access — so on an
index that has never held a blob, the GC hits a table that does not exist:

```
no such table: doc_mount_blobs
  at gcOrphanedFileRow (…/doc-mount-file-links.repository.ts:144:6)
  at DocMountFileLinksRepository.linkDocumentContent (…:1097:71)
  at writeDatabaseDocument (…/database-store.ts:121:3)
```

The first write to a path creates a link; the second orphans a content row and
reaches the GC. Provisioned instances are safe because `doc_mount_blobs` is in
`fresh_schema.json`'s mountIndex — but restored or hand-built indexes are not.

### The fix

Guard the `DELETE` behind existence of the table (or ensure the blobs table
eagerly). v5's `gc_orphaned_file_row` is a faithful port and throws identically —
recorded here rather than diverged, since it is v4's bug to fix.
