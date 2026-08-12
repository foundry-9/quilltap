# Bug 11 — `.qtap` import overwrite mishandles store identity three ways

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | **High** |
| **Who it bites** | anyone re-importing or overwriting a document store |
| **Provenance** | Pinned |
| **Fix site** | `lib/import/quilltap-import/import-document-stores.ts` — clear folders on overwrite, match target by **id**, preserve archive id on create |
| **v5 status** | **Owed** — retire `system_import_state` → `FOLDER_CLEAR_DIVERGENCE`, `STORE_ID_PRESERVED_ON_CREATE`, `execute_folder_overwrite`, four `store_identity_*` |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: High.** Three distinct defects on one path, all in
`lib/import/quilltap-import/import-document-stores.ts` (dogfood-driven, ruled
2026-08-04; v5 landed the fixes as `p4.33`).

### The three defects

1. **Overwrite-clear leaves `doc_mount_folders` standing** (`:63`–`:67`). An
   overwrite clears documents but not folders, so an identical re-import leaves
   stale folder husks and logs `UNIQUE` warnings.
2. **Overwrite matches the target store by NAME** (`:55`–`:57`). Rename a store
   and an overwrite silently redirects onto an unrelated store that now happens
   to share the old name.
3. **Import CREATE mints a fresh store id** (`:89`–`:105`), discarding the
   archive's id. Because identity is the id, no archive can ever be
   re-recognised on a later import — every import is a stranger.

### The fix

Clear folders on overwrite; match the target store by **id**; preserve the
archive's id on create. v5 does all three, pinned by `system_import_state`'s
`FOLDER_CLEAR_DIVERGENCE`, `STORE_ID_PRESERVED_ON_CREATE`, the
`execute_folder_overwrite` arm, and the four `store_identity_*` arms — each
fails the day v4 converges.

**Fixed 2026-08-06** in `lib/import/quilltap-import/import-document-stores.ts`:
the overwrite path now also `docMountFolders.deleteByMountPointId(existing.id)`;
the target store is matched via a `byId` map; create passes `{ id: mp.id }` when
the id is free (a `duplicate` import onto an id clash still mints a fresh id).
Preserving ids means a re-import of the same archive now takes the (now-correct)
overwrite path.
