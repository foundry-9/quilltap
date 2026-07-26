# Found Bugs — defects surfaced by the v5 port

**Last Updated**: 2026-07-26
**Codebase**: Quilltap v4.8.0-dev (HEAD `20430561`)
**Provenance**: the quilltap-v5 native port's differential harness
**Status**: **all four fixed in v4** — see [Status](#status) for the sites and
the v5 follow-up owed.

---

## What this file is

The v5 port runs every ported unit against v4's **real** `lib/` code and diffs
the results field by field. That process occasionally finds a defect in v4
itself — a case where v5 and v4 disagree and **v4 is the one that is wrong**.

Those are recorded here with a fix plan. Each entry states the symptom, the
root cause with file and line, why it survived this long, the fix, and how to
verify it.

**These are bugs, not preferences.** They are distinct from the port's much
longer list of *v4-faithful papercuts*, where v5 reproduces a v4 annoyance
exactly and any change is a product decision to be made in v4 first. That list
lives in the v5 repo (`docs/developer/porting/dogfood-findings.md`, "post-5.0
product improvements"). Nothing here is a matter of taste.

**Scope note:** this file was opened to plan the fix for **Bug 4** (the 3 MB
import bug). Bugs 1–3 come from the same audit, are listed first because they
are more urgent, and are included so the backup/restore family can be fixed in
one pass rather than three.

---

## Summary

| # | Bug | Who it bites | Severity | Fix size |
|---|---|---|---|---|
| 1 | Restore rejects every `doc_mount_points` and `doc_mount_file_links` row — character vaults, project stores and group stores all come back **unreachable** | **every** restore of a modern backup | **Critical** | ~10 lines |
| 2 | Restore looks for user files under `backupFormat === 2`, but modern manifests declare `4` — **no user file is restored** | **every** restore of a modern backup | **Critical** | 1 line |
| 3 | Restore runs the files phase (5) before the stores that must receive the bytes exist (13 / 22a) — so **even with Bug 2 fixed, no file lands** | every restore into a fresh or wiped target | **Critical** | move one block |
| 4 | Import cannot read v4's own export of a document-store blob larger than **3 MB** — silent truncation, then a hard failure | any instance with a store blob > 3 MB | High | 1 line |

Bugs 1–3 are one repair: **all three must land together** or restore is still
broken. Bug 2 alone changes nothing, because Bug 3 means there is nowhere to
put the bytes.

---

## The constraint that shapes the sequencing

**v4 is the oracle for the v5 port.** The port pins an oracle baseline commit
and regenerates its fixtures from it; changing v4's `lib/` moves that baseline
mid-flight and obliges a v5 drift-catch-up round.

Consequences:

- **Do not land these quietly.** Coordinate with the v5 side: a `lib/` change
  here is drift debt there. (A docs-only commit — including this file — is not:
  the port dispositions docs-only v4 commits as no-debt.)
- **Fixing v4 will turn parts of the v5 harness RED, by design.** v5 already
  diverges from v4 on all four bugs, and those divergences are asserted in
  **both** directions so that an upstream fix cannot pass unnoticed. When these
  land, the v5 side must retire the corresponding tripwires:

  | v4 fix | v5 tripwire that fires | Expected message |
  |---|---|---|
  | Bugs 1–3 | `crates/quilltap-harness/tests/system_restore_state.rs` → `assert_divergences` | *"v4 restored N rows from an archive that carries them — the v4 bug this differential pins has been FIXED upstream; re-rule the divergence"* |
  | Bug 4 | `crates/quilltap-harness/tests/system_import_equivalence.rs` → `EXPECTED_DIVERGENCES` | the `throw_ndjson_truncated_blob` case stops diverging; remove it from the list |

  A red differential after these land is **the tripwire working**, not a
  regression. The v5 work is to delete the divergence entries and let the cases
  become plain equalities.

**Suggested order:** one branch, bugs 1–3 in a single commit (they are one
repair), bug 4 in a second. Land both at a point where the v5 side is between
rounds, so the baseline moves once.

---

## Bug 1 — restore rejects every mount point and file link

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
  first with the "FIXED upstream" message above.

---

## Bug 2 — restore looks for files under the wrong format number

**Severity: Critical.** No user file is restored.

### Symptom

Every file row restores; not one byte of file content does. The log fills with
`File not found in extracted backup`.

### Root cause

`getFileFromExtractedBackup` (`lib/backup/restore/archive.ts:334`):

```ts
// New format (backupFormat: 2): files stored by storageKey path
if (backupFormat === 2 && file.storageKey) {
```

The format number has since moved on; a modern manifest declares
`backupFormat: 4`. The equality test excludes every archive newer than the one
it was written for, so the lookup falls through to the pre-format-2 layout
(`files/{CATEGORY}/{fileId}_{originalFilename}`), which modern archives do not
use. Nothing is found.

### Why it survived

An equality test against a format number is only correct until the next format
bump, and nothing failed loudly when that happened — the fallback path exists
precisely to be quiet.

### The fix

One line:

```ts
if (backupFormat >= 2 && file.storageKey) {
```

Apply the same change to the `triedPaths` diagnostic at `:352`, so the log
reports the paths actually attempted.

**Also audit for siblings.** Grep for other `backupFormat ===` comparisons
before closing this out; the same pattern anywhere else has the same latent
bug.

### Verification

Covered by the same round-trip as Bug 1 — but only once **Bug 3** is fixed too.
On its own this change is unobservable.

---

## Bug 3 — the files phase runs before anything can receive the bytes

**Severity: Critical.** This is the broadest of the three, and the reason
fixing Bug 2 alone would appear to do nothing.

### Symptom

Restoring into a fresh or wiped target restores no user file, in **either**
mode (`replace` and `new-account`).

### Root cause

`restore.ts` restores in a numbered list its own comment calls *"dependency
order"* (`:65`). Files are **step 5** (`:128`). At that moment neither bridge to
a store can resolve:

- a **project-less** file needs the Quilltap Uploads mount — which
  `deleteUserData` has just `DELETE`d (`lib/backup/delete-service.ts:72`
  truncates `doc_mount_points`). `instance_settings` is deliberately *not*
  cleared, so the pointer survives and dangles.
- a **project-bound** file needs a project store, which does not restore until
  **step 13** (`:292`) — eight phases later.

The document-store mount points themselves do not arrive until **22a**
(`:430`).

### Why it survived

The order is correct for an in-place restore over a populated instance, where
the stores happen to already exist. It only fails when the target is fresh or
wiped — which is exactly the disaster-recovery case restore exists for.

### The fix

Move the step-5 files block to run **after 22a** (document store mount points),
which also puts it after projects (13) and groups (13a). **No write changes —
only when it happens.** Renumber the comment so the list stays readable, and
keep the block's internal order intact.

This is what the v5 port does, and its restore differential passes against v4's
own archives with it.

### Verification

Restore into a **fresh** instance (not an in-place restore — that is the case
that already works) and confirm file bytes land in the right store. Do this for
a project-less file and a project-bound file, in both `replace` and
`new-account` modes.

---

## Bug 4 — import cannot read its own export of a blob over 3 MB

**Severity: High.** Bites any instance with a document-store blob larger than
the 3 MB chunk size.

### Symptom

Importing a `.qtap` export fails outright with:

```
doc_mount_blob_chunk received without preceding doc_mount_blob
```

The export that produced it was written by v4 itself, and reports no error.
Worse than the visible failure: the blob has already been **silently truncated**
before the throw.

### Root cause

`lib/import/quilltap-import-stream.ts:257` allocates the chunk accumulator as a
**sparse** array:

```ts
received: new Array(blobRec.data.chunkCount),
```

and `:284` decides the blob is complete with:

```ts
const allReceived = accum.received.every((v) => typeof v === 'string');
```

`Array.prototype.every` **skips holes**. On a sparse array it returns `true`
immediately — the moment the *first* chunk lands, whatever `chunkCount` says.
v4 then joins what it has (holes render as `''`), pushes the truncated blob, and
**deletes the accumulator**. Chunk 2 arrives with no accumulator and throws.

The writer chunks at `BLOB_CHUNK_BYTES = 3 MB`, so a blob at or under 3 MB is a
single chunk and behaves correctly. Over 3 MB, v4 cannot re-read its own output.

The sharpest detail: v4 **already has** an end-of-stream truncation check with
its own error message (`:318`). The sparse `every` is precisely what made that
code unreachable.

### Why it survived

Sparse-array hole-skipping is a genuine JavaScript trap — `every` on
`new Array(3)` returning `true` surprises most readers. And the guard that
should have caught it was rendered dead by the same bug.

### The fix

One line at `:284`:

```ts
const allReceived =
  accum.received.filter((v) => typeof v === 'string').length === accum.chunkCount;
```

`filter` also skips holes, but counting the survivors against `chunkCount` is
the test that was intended. `accum.chunkCount` must be the value carried on the
accumulator, not `received.length`.

With this in place, a genuinely short stream now reaches the truncation error at
`:318` — v4's own message, finally reachable.

### Verification

- Export an instance holding a document-store blob **larger than 3 MB**
  (a modest PDF or image will do), then import it into a fresh instance and
  confirm the blob arrives byte-identical. Check the sha256, not just the size.
- Truncate an NDJSON export mid-blob and confirm the import fails with the
  truncation message at `:318` rather than the "without preceding" throw.
- Note for anyone touching the chunk size: chunks are base64-encoded
  **separately** and the reader rejoins the *encoded* strings, so only the last
  chunk may carry padding. `BLOB_CHUNK_BYTES` must stay a multiple of 3.

### Note on the format

This is a **reader** fix. The writer is untouched and its bytes do not change,
so archives stay compatible in both directions. v5 already reads a strict
superset of what v4 reads, having taken this fix on its own side.

---

## Status

| # | Bug | Fixed in v4? | Fix site | v5 status |
|---|---|---|---|---|
| 1 | Mount points / file links rejected | **Yes** (2026-07-26) | `lib/backup/restore/mount-index-coercion.ts`, applied at `restore.ts` 22a / 22d | Converged — v4 now restores them too |
| 2 | `backupFormat === 2` gate | **Yes** (2026-07-26) | `lib/backup/restore/archive.ts:333` | Converged — gate is `>= 2` on both sides |
| 3 | Files phase ordering | **Yes** (2026-07-26) | `lib/backup/restore/restore.ts` — step 5 moved to 22a-bis | Converged — files run after 22a on both sides |
| 4 | Sparse-array blob finalization | **Yes** (2026-07-26) | `lib/import/quilltap-import-stream.ts:284` | Converged — both readers wait for every chunk |

All four had been ruled deliberate divergences on the v5 side (2026-07-24 and
2026-07-25) rather than being reproduced bug-for-bug, on the grounds that they
sit on the data-loss path. The v5 rulings are recorded in that repo's
`docs/developer/porting/status-log.md` under "Ruling — the sparse-array blob
divergence" and "Ruling — the two v4 restore bugs".

### Decisions taken while fixing

- **Bug 1 was fixed on the restore side only**, per the recommendation above.
  The backup side is untouched, so archive bytes do not change and the v5
  oracle's *backup* fixtures do not move. The coercion tolerates already-correct
  input (parse only when the value is a string, coerce only when it is a
  number), so a later backup-side normalisation can land without a second
  change here.
- **Bug 3 renumbers by insertion, not renumbering.** The moved block is
  labelled `22a-bis` and step 5 keeps a placeholder comment explaining the
  deferral — the same idiom step 19 already uses for wardrobe items deferred to
  22f-bis. Renumbering twenty-odd comments would have buried an ordering-only
  change in noise.
- **No sibling `backupFormat ===` comparisons exist**; the audit Bug 2 asks for
  turned up only the two lines it names.
- **Regression tests added**:
  `__tests__/unit/lib/backup/mount-index-coercion.test.ts`,
  `__tests__/unit/lib/backup/restore-archive-file-lookup.test.ts`,
  `__tests__/unit/lib/import/quilltap-import-stream-blobs.test.ts`. The last
  was checked against the pre-fix code: five of its seven cases fail there.

### Known residue from Bug 3's placement (not a regression; follow-up)

Immediately after 22a is the right slot, and it is worth writing down *why*,
because two nearby slots are worse:

- **After 22c** (doc-store file rows) the replay's `findOrCreateByContent`
  would match the archived content row by sha and hard-link to it, so 22f's
  `INSERT INTO doc_mount_blobs` would then violate `UNIQUE(fileId)` and the
  archived blob row would be refused.
- **After 22d** the same, plus the replay would have to unique-suffix around
  every archived link.

At 22a the doc-store has mount points and nothing else, so the replay builds an
independent set of file/link/blob rows that cannot collide with the archived
ones. What remains is narrow and warning-shaped:

- Restoring a **second-generation archive** — one taken from an instance that
  was itself restored — replays project-less files into the Quilltap Uploads
  mount at `restored/<name>`, which is exactly where the archived link rows for
  those files already live. The replay gets there first (22a-bis), so 22b's
  archived `restored` folder row and 22d's archived link rows collide with it
  and are logged as warnings. Content is present either way; the archived link
  *ids* are what get lost.
- First-generation archives are unaffected: the archived paths are `chat/`,
  `images/`, etc., and `restored/` is free.
- Project-bound files never collide at all — `projects.create` provisions a
  *fresh* official store and discards the archived `officialMountPointId`, so
  the replay and the archived rows land in different mount points. (That
  duplication predates this fix and is orthogonal to it.)

Fixing this properly means teaching the replay to recognise that the archive
already carries the store rows for a file and skip re-ingesting it, rather than
reshuffling phase order. Out of scope here.

### Owed to the v5 side

The two tripwires named above will now fire. Both are the tripwire working:
retire the divergence entries and let the cases become plain equalities.

| v4 fix | v5 tripwire | Action |
|---|---|---|
| Bugs 1–3 | `crates/quilltap-harness/tests/system_restore_state.rs` → `assert_divergences` | Re-rule the divergence as converged |
| Bug 4 | `crates/quilltap-harness/tests/system_import_equivalence.rs` → `EXPECTED_DIVERGENCES` | Remove the `throw_ndjson_truncated_blob` case |

The oracle baseline moves once, at the commit that carries these fixes.
