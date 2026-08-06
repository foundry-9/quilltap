# Session 3 — Mount-index & file hygiene (Bugs 13, 15, 16, 38, 43)

Doc-store / mount-index repository defects plus two file-side hygiene items.
Two of the five live in the same file
(`lib/database/repositories/doc-mount-file-links.repository.ts`). Run after
Session 2 — Bug 43's sweep should reuse the orphan-reaper pattern Session 2
adds, and Bug 13 matters most on exactly the restored indexes Session 2 makes
healthy.

Read the standing rules in [README.md](README.md). Full root causes:
`../found-bugs.md` → Bugs 13, 15, 16, 38, 43.

---

## Bug 13 — `gcOrphanedFileRow` throws on a mount index without the blobs table

**Severity: High (hard throw on the second write). Provenance: Faithful.**

`gcOrphanedFileRow`
(`doc-mount-file-links.repository.ts:144`) issues
`DELETE FROM doc_mount_blobs` unconditionally, but `doc_mount_blobs` is
created **lazily** by the blobs repository on first access (it has no Zod
schema, so `generateDDL` never makes it). On any index that has never held a
blob — a restore from an old backup, a hand-built index — the second write to
a path reaches the GC and dies with `no such table: doc_mount_blobs`.

**Fix:** either guard the `DELETE` behind a table-existence check, or ensure
the blobs table eagerly wherever the mount-index handle is opened. Prefer the
eager-ensure if it is one call at an existing chokepoint (it also retires the
whole "lazily created" class); otherwise the guard is fine. Note provisioned
instances are safe (`fresh_schema.json` lists the table) — the test must build
an index *without* it.

**Verification:** unit test on a mount index lacking `doc_mount_blobs`: write
the same path twice; second write succeeds. Fails pre-fix.
**v5:** faithful — v5's `gc_orphaned_file_row` throws identically and owes the
same-round mirror.

---

## Bug 15 — `reindexLinkGroupSiblings` is dead code; hard-linked siblings serve stale chunks

**Severity: Medium. Provenance: Pinned.**

`queryJoined` (same repository) never selects `l.linkGroupId`, so
`reindexLinkGroupSiblings`'s early-out on a missing `linkGroupId` always
fires and the chunk reindex for hard-link siblings never runs. Content fan-out
works (raw SQL inside the write transaction); only search/context chunks go
stale.

**Fix:** add `l.linkGroupId` to `queryJoined`'s `SELECT` list and its row
mapper. One line each — then confirm the reindex actually fans out by test.

**Verification:** unit/integration: hard-link a file into two locations, edit
one, assert the sibling's chunks are re-rendered (fresh content in search).
Fails pre-fix.
**v5 tripwire:** `doc_mount_file_links_tier2_equivalence` →
`CHUNK_DIVERGENCES` (fresh on v5 / stale on v4) — goes red on landing.

---

## Bug 16 — the dimension reconcile counts mount chunks from the wrong database

**Severity: Low. Provenance: Pinned.**

`countNonconformingMountChunks`
(`lib/startup/reconcile-embedding-dimensions.ts:354`) opens with
`tableExists(mainDb, 'doc_mount_points')` — but `doc_mount_points` is a
**mount-index** table, so the guard is always false on a real instance and the
function returns 0. The existing unit test misses it because it creates the
table in the main test DB.

**Fix:** read `doc_mount_points` (and the chunk scan that follows) from the
mount-index handle; correct the wrong comment at `:351`. **Fix the unit test's
DB placement too** — it must reproduce the real two-database layout, or it
will keep passing for the wrong reason.

**Verification:** corrected test with the table in the mount-index DB and a
non-conforming chunk → count > 0. Fails pre-fix.
**v5 tripwire:** `embedding_dimension_reconcile` asserts `mountChunks == 0`
across every case — it fires when v4 starts counting; the v5 side retires it.

---

## Bug 38 — the library picker lists markdown documents that 404 on attach

**Severity: Low. Provenance: Faithful (both apps).**

Native-text files (`.md`/`.txt`/`.json`) PUT into a database store become
**documents** (`lib/mount-index/store-file.ts:202`, `writeDatabaseDocument` —
no `doc_mount_blobs` row), but `handleAttachMountFile`
(`app/api/v1/files/route.ts:271`–`:279`) requires a blob and returns
`notFound('Mount-point file blob')`. The picker shows the document; attaching
it fails.

**Fix (preferred):** teach `handleAttachMountFile` to serve a native-text
document when no blob exists — the document row already carries
`extractedText`, which is what the Librarian needs. **Fallback (if that
balloons):** filter native-text documents out of the picker's store browse and
record the decision in `found-bugs.md`. Either way the user must stop seeing
"Mount-point file blob not found".

**Verification:** attach a `.md` document from a database store via the
picker → succeeds (or is no longer offered, per the fallback). Fails pre-fix.
**v5:** faithful — same-round mirror owed either way.

---

## Bug 43 — orphaned thumbnails are never collected

**Severity: Low (disk leak). Provenance: Faithful/shared.**

`files/_thumbnails/{fileId}_{size}.webp` only ever grows: nothing sweeps a
thumbnail whose source file left by any route other than in-app delete
(restore, delete-all, out-of-app edit). The cache is derived and regenerated
on demand, so deletion is always safe.

**Fix:** add an orphan-thumbnail sweep to the daily maintenance job (same
pattern as Session 2's orphan reaper): list `_thumbnails/`, parse the leading
`fileId`, delete entries whose file row no longer exists. Log counts at debug.
Unparseable names: skip and log, don't delete blind.

**Verification:** unit test with a live thumbnail, an orphaned one, and a
garbage-named file → only the orphan is removed.
**v5 note for the report:** v5 additionally skips v4's `cleanupThumbnails` on
its four delete/overwrite paths (`api/files.rs:537`, `:1123`) — that half is
v5's to close; name it so it isn't forgotten.

---

## Definition of done

- [ ] All five fixes with regression tests that fail pre-fix (13's on an index
      without the blobs table; 16's with the corrected DB layout)
- [ ] Debug logging on touched backend paths
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] `docs/CHANGELOG.md` entries; `found-bugs.md` Status rows flipped
- [ ] Final report: tripwires to retire (15, 16), same-round mirrors owed
      (13, 38), and v5's own `cleanupThumbnails` half of 43
