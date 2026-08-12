# Bug 1 — restore rejects every mount point and file link

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-26) |
| **Found** | 2026-07-26 |
| **Fixed** | 2026-07-26 |
| **Severity** | **Critical** |
| **Who it bites** | **every** restore of a modern backup |
| **Fix size (as estimated)** | ~10 lines |
| **Fix site** | `lib/backup/restore/mount-index-coercion.ts`, applied at `restore.ts` 22a / 22d |
| **v5 status** | Converged — v4 now restores them too |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Critical.** Every character vault, project store and group store
comes back unreachable.

### Symptom

Restore a modern backup. The folders, file rows, documents and chunks all
arrive — but no `doc_mount_points` and no `doc_mount_file_links`. The result is
a graph that holds all of the content and none of the stores or links that
reach it. Warnings are logged per row; the restore reports success.

### Root cause

`dumpMountIndexTable` (`lib/backup/backup-service.ts:72`) is a raw passthrough:

```ts
return db.prepare(`SELECT * FROM "${table}"`).all() as T[];
```

SQLite hands back storage types, so the archive carries:

- `includePatterns` / `excludePatterns` as **JSON text**, not `string[]`
- `enabled` / `allowEmbed` as **INTEGER 0/1**, not `boolean`

`restore.ts` then feeds those rows to the repository `create`s at steps 22a and
22d, whose Zod schemas demand `string[]` and `boolean`. Every row is rejected.

The `as T[]` cast is what hides it: the function is *typed* as returning
`DocMountPoint[]`, so nothing downstream questions the shape.

### Why it survived

The backup path is exercised far more often than the restore path, and the
failure is per-row and warning-shaped — the restore still reports success. The
damage only shows up later, when a vault turns out to be unreachable.

### The fix

Two viable sites; **pick one, do not do both**:

- **Backup side (preferred)** — parse the JSON columns and coerce the booleans
  in `dumpMountIndexTable`, so the archive is correct at the source. Newly
  written archives are then readable by an *unfixed* v4, which is worth having.
  Needs a per-table column map, since the function is generic.
- **Restore side** — coerce immediately before the `create` calls at 22a/22d.
  Fixes old archives too, which the backup-side fix does not.

**Recommendation: do the restore side, and consider the backup side as well.**
The restore-side fix is the one that repairs archives users already have;
without it, every backup taken before the fix stays unrestorable. If both are
done, the restore-side coercion must tolerate already-correct input (parse only
when the value is a string, coerce only when it is a number).

### Verification

- Round-trip an instance that has at least one character vault and one project
  store: back up, wipe, restore, then confirm `doc_mount_points` and
  `doc_mount_file_links` are non-empty and the vault opens.
- v5's `system_restore_state` differential diffs 43 tables across all three
  partitions over four archives and will confirm the fix — expect it to fail
  first with the "FIXED upstream" message recorded in
  [bugs.md](../../bugs.md#the-constraint-that-shapes-the-sequencing).
