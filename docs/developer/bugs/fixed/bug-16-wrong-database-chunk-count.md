# Bug 16 — the dimension reconcile counts mount chunks from the wrong database

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | embedding-dimension changes on document stores |
| **Provenance** | Pinned |
| **Fix site** | `lib/startup/reconcile-embedding-dimensions.ts` — `doc_mount_points` + chunk scan read from the mount-index handle; comment + unit-test DB placement corrected |
| **v5 status** | **Owed** — retire `embedding_dimension_reconcile` `mountChunks == 0` tripwire |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `countNonconformingMountChunks` now reads
`doc_mount_points` (the ENABLED filter) and the chunk scan from the mount-index
handle, not the main DB; only the FAILED-status exclusion still comes from the
main DB. The wrong `:351` comment is corrected, and the unit test now places
`doc_mount_points` in the mount-index test DB (the real two-database layout), so
it no longer passes for the wrong reason. Retire the v5 `mountChunks == 0`
tripwire in `embedding_dimension_reconcile`. Fix site:
`lib/startup/reconcile-embedding-dimensions.ts`.

**Severity: Low** — the chunks are not permanently stranded (the reindex
handler's phase 4 heals them whenever a reindex runs for any other reason), but
the reconcile will never enqueue a reindex *for them alone*.

### Root cause

`countNonconformingMountChunks`
(`lib/startup/reconcile-embedding-dimensions.ts:354`) opens with
`tableExists(mainDb, 'doc_mount_points')`, and its comment (`:351`) asserts
"mount point config lives in the main DB". It does not — `doc_mount_points` is a
**mount-index** table (`fresh_schema.json` lists it under `mountIndex`). So on
every real instance the guard is false and the function returns 0 before it ever
opens the mount-index handle. v4's own unit test misses it because it creates
`doc_mount_points` in its *main* test database.

### The fix

Read `doc_mount_points` from the mount-index handle. v5 reproduces the dead count
behind a tripwire (`embedding_dimension_reconcile` asserts `mountChunks == 0`
across every case) — do not "fix" v5 unilaterally; that turns the family red.
