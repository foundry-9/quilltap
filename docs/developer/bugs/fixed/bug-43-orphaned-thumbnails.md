# Bug 43 — orphaned thumbnails are never collected

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low (disk leak) |
| **Who it bites** | long-lived instances |
| **Provenance** | Faithful/shared |
| **Fix site** | `lib/background-jobs/maintenance/sweep-orphaned-thumbnails.ts` wired into `scheduled-maintenance.ts`; `parseThumbnailStorageKey` in `lib/files/thumbnail-utils.ts` |
| **v5 status** | **Owed** (Faithful) — mirror the sweep **and** call `cleanupThumbnails` at v5's two skipped delete/overwrite sites (`api/files.rs:537`, `:1123`) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — the daily maintenance pass now runs an
orphan-thumbnail sweep (`lib/background-jobs/maintenance/sweep-orphaned-thumbnails.ts`,
wired into `lib/background-jobs/scheduled-maintenance.ts` as step 7): it lists
`_thumbnails/`, parses the leading `fileId` (`parseThumbnailStorageKey` in
`lib/files/thumbnail-utils.ts`, the inverse of the key builder), and deletes
entries whose `files` row is gone; unparseable names are skipped and logged, not
deleted. **v5's half is still open**: v5 additionally skips v4's
`cleanupThumbnails` on its four delete/overwrite paths (`api/files.rs:537`,
`:1123`), so a v5-driven instance still leaves per-delete thumbnails behind —
v5 must call `cleanupThumbnails` at those two sites *and* mirror this sweep.

**Severity: Low (disk leak).** Partly a shared gap.

### Root cause

`files/_thumbnails/` only ever grows. **Neither app** has a sweep for a
thumbnail whose source file left by some route other than an in-app delete
(a restore, a delete-all, an out-of-app edit) — which is the residue actually
observed on the real copy. (Separately, v5 skips v4's `cleanupThumbnails`
— `lib/files/thumbnail-utils.ts:138` — on all four of its delete/overwrite paths,
`api/files.rs:537` and `:1123`, so a v5-driven instance also leaves per-delete
thumbnails behind; that half is v5's to close.) The cache is otherwise
self-healing — `_thumbnails/{fileId}_{size}.webp` is derived and regenerated on
demand.

### The fix

Add the orphan-thumbnail sweep neither app has; on the v5 side, also call
`cleanupThumbnails` at the two skipped sites for v4 parity.
