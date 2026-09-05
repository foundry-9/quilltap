# Bug 114 — a folder read that failed soft looked like a folder that wasn't there, so the image pipelines re-created the same folder on every generation

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-02) |
| **Found** | 2026-09-02 |
| **Fixed** | 2026-09-02 |
| **Severity** | Low-Medium (nothing is lost or corrupted and the one consumer de-dupes, but the `folders` table grows without bound — 607 rows for 24 real folders in Friday — and any future consumer that counts or lists without de-duping inherits the repeats) |
| **Who it bites** | Anyone generating character avatars or story backgrounds into a **project** — the machine-written `/character-avatars/` and `/story-backgrounds/` paths. Hand-created folders are unaffected, for the reason that identifies the bug |
| **Provenance** | Noticed 2026-09-02 in the Friday instance while looking at the folder list behind bug 113: `GROUP BY project, path` over `folders` returned 207 rows for one project's `/story-backgrounds/`, 109 for another's, 53 for a `/character-avatars/`, and exactly **1** for every folder a human had created |
| **Defect site** | Two layers. The trigger: `lib/schemas/folder.types.ts` declared `parentFolderId: UUIDSchema.nullable()` without `.optional()`, while the SQLite hydrator (`hydrateRow`, `lib/database/backends/sqlite/backend.ts`) turns a NULL column into `undefined` — so every root-level folder row failed Zod validation on read. The structure that let the trigger do this much damage: `folders` had no uniqueness constraint on a folder's identity, and six call sites each hand-rolled `findByPath` → `create` against a `findByPath` that returns `null` on read *failure* as well as on absence |
| **Fix site** | `FoldersRepository.ensureByPath` (`lib/database/repositories/folders.repository.ts`) is now the sole way to bring a folder row into being for a path that may already have one, backed by `CREATE UNIQUE INDEX idx_folders_userId_projectId_path ON folders (userId, COALESCE(projectId, ''), path)`. Migration `collapse-duplicate-folders-v1` collapses existing duplicates and creates the index. The trigger itself was fixed separately on 2026-04-17 in c180246b1 |
| **v5 status** | Not investigated. **The shape applies** to any port whose repository reads collapse "query failed" and "no such row" into the same `null`, and whose callers then act on that `null` by writing. A soft-failing read is a *write* amplifier wherever the caller's response to absence is to create |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-09-02).** Folder creation goes through one find-or-create
chokepoint with a unique index behind it, so no call site can duplicate and the
loser of a race resolves to the winning row. A migration collapses the rows
already accumulated.

## Symptom

The `folders` table grows without bound. In the Friday instance:

```
sqlite> SELECT p.name, f.path, COUNT(*) FROM folders f
   ...> JOIN projects p ON p.id = f.projectId GROUP BY p.name, f.path;

Quilltap Plans  /story-backgrounds/   207
The Estate      /story-backgrounds/   109
The Estate      /character-avatars/    53
Church          /story-backgrounds/    51
…
The Estate      /Gary/                  1
Quilltap Plans  /Feature Requests/      1
Quilltap Plans  /Folio Drafts/          1
Quilltap Plans  /Scenarios/             1
```

607 rows describing 24 folders. Nothing visibly breaks: the sole consumer,
`components/files/FolderPicker.tsx`, folds the list into a `Map` keyed by path
before rendering, so the dropdown shows each folder once.

The split in that table is the whole diagnosis. Only the two
**machine-written** paths repeat, and the count tracks the number of images
generated into that project. Every folder a human created has exactly one row.

## Root cause

### The trigger: a read that failed soft

`FolderSchema` declared:

```ts
parentFolderId: UUIDSchema.nullable(),   // note: no .optional()
```

A root-level folder has `parentFolderId` NULL, and the SQLite hydrator converts
a NULL scalar column to `undefined` rather than `null`. `.nullable()` accepts
`null`; it rejects an absent key. So `findOneByFilter`'s `this.validate(result)`
threw `expected string, received undefined` on **every root-level folder read** —
which is every one of these folders.

That throw never surfaced. `findByPath` wraps its body in `safeQuery(…, null)`:

```ts
return this.safeQuery(
  async () => { … return this.findOneByFilter(query); },
  'Error finding folder by path',
  { userId, path, projectId },
  null,                            // ← fallback on error
);
```

so the caller received `null` — the same answer it gets when the folder
genuinely does not exist.

### What the callers did with that `null`

Six call sites each hand-rolled the same guard. The image handlers' version:

```ts
const existingFolder = await repos.folders.findByPath(job.userId, '/story-backgrounds/', folderProjectId);
if (!existingFolder) {
  await repos.folders.create({ … });
}
```

`create` writes without reading, so it worked every time. The guard read
"absent" every time. Every generated image therefore appended one more row for
a folder that had been there since February.

This is also why hand-created folders show one row each: the same broken read
sat in front of the same guard on the API route, but a person creates `/Gary/`
once. Only a caller invoked repeatedly per path could pile up, and the two
paths invoked repeatedly per path are exactly the two that did.

### Why it stopped, and why the bug did not

The trigger was fixed on 2026-04-17 in **c180246b1** ("folders parentFolderId
hydration"), as a one-line `.optional()` alongside an unrelated tool-dispatch
fix. The commit message names the Zod error precisely — it just never connected
it to the table it had been inflating. The evidence is unambiguous:

| | rows |
|---|---|
| created before c180246b1 | 600 |
| created after | 7 |

and all 7 later rows are distinct `(projectId, path)` pairs — no duplicates at
all. Three weeks after that, the 2026-05-10 vault cutover (33f470331) routed
most avatar and Lantern writes into document stores, so the legacy path stopped
being taken for most generations too.

What survived both is the structure that turned a bad read into 600 rows:

- **No uniqueness constraint.** A folder's identity is `(userId, projectId,
  path)` and nothing said so. The duplicate rows are all individually valid.
- **Six hand-rolled copies of the guard**, each able to drift and none able to
  be strengthened in one place.
- **A check and an insert that are not atomic.** Even with the read working,
  two concurrent jobs generating into the same project (the global in-flight cap
  is 4) both read "absent" and both insert. In the forked job child it is worse:
  writes are buffered until the job ends and reads use a readonly connection, so
  a second job cannot see the first's buffered create at all
  ([BACKGROUND_JOBS_CHILD.md](../BACKGROUND_JOBS_CHILD.md)). The `doc_mount_folders`
  table already carries a unique index and a reconcile arm for exactly this;
  `folders` had neither.

## Why it survived

Because the two ways it could have been noticed each failed for a different
reason.

**Nothing downstream complained.** `FolderPicker` — the only reader — de-dupes
into a `Map` on the way to the dropdown. That de-dupe was not written as
tolerance for this bug; it is the obvious way to merge folders derived from
files with folders read from the table. It happened to make 207 rows and 1 row
render identically, so the table could inflate for two months in front of a
user looking straight at it.

**The trigger was fixed without looking at what it had done.** The Zod
validation failure was found and fixed in April, from the other end — a folder
read failing loudly enough somewhere else to be diagnosed. The fix was correct
and the commit message is exact. But a read that has been failing for months
has been *doing* something all that time, and nobody asked what. The rows it
had already written were not part of the bug as it presented.

The general form: **a repository read whose failure mode is indistinguishable
from its empty result is a write amplifier**, in any caller whose response to
"not there" is "create it." The failure is silent at the read, invisible at the
write (each insert is valid), and only shows up as a row count nobody has
reason to look at.

## The fix

**One chokepoint.** `FoldersRepository.ensureByPath(data)` replaces every
hand-rolled `findByPath` → `create`, at all six call sites: the
`character-avatar` and `story-background` job handlers, the file-storage
watcher's `handleDirAdd`, both create paths in
`app/api/v1/files/folders/route.ts` (`ensureParentFoldersExist` and
`handleCreateFolder`), and the `.qtap` importer.

**A unique index behind it**, so the chokepoint is enforced rather than merely
offered:

```sql
CREATE UNIQUE INDEX "idx_folders_userId_projectId_path"
  ON "folders" ("userId", COALESCE("projectId", ''), "path");
```

`projectId` is nullable — general files carry NULL — and SQLite treats every
NULL as distinct in a unique index, so it is coalesced to `''` to make "no
project" one value. Same reasoning as the `doc_mount_folders` index.

`ensureByPath` catches a unique-constraint violation and resolves to the row
that won, rather than adding to the pile — so a concurrent create is reconciled
instead of duplicated, and a *future* soft-failing read cannot amplify into
more than one wasted insert. A non-constraint failure is rethrown.

**In the forked job child** the call is buffered whole and replayed by the
parent on its RW connection (`'folders.ensureByPath': 'write'` in the child
proxy's `METHOD_OVERRIDES`), which is what makes it genuinely idempotent there:
the parent has read-your-writes and the index, and applies are serialized. The
in-child callers discard the return value, as they must.

**A migration**, `collapse-duplicate-folders-v1`, keeps the oldest row of each
`(userId, COALESCE(projectId,''), path)` group, repoints any
`folders.parentFolderId` naming a discarded row at that group's survivor,
deletes the rest, and then creates the index. `folders.parentFolderId` is the
only column in the main database that references `folders.id` — `files` locates
its folder by `folderPath` + `projectId`, not by id — so nothing else needs
repointing.

Backup restore tolerates the old shape: a backup taken before the collapse
carries the duplicate rows, and the extras are now dropped quietly instead of
filling the restore report with warnings.

## How to verify

Every group is a single row, and the index is present:

```bash
npx quilltap db --instance <name> query "SELECT path, projectId, COUNT(*) c FROM folders GROUP BY userId, COALESCE(projectId,''), path HAVING c > 1"
```

```bash
npx quilltap db --instance <name> query "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_folders_userId_projectId_path'"
```

The first returns nothing; the second returns the index.

Then generate several story backgrounds into one project and re-run the first
query — it still returns nothing, and

```bash
npx quilltap db --instance <name> query "SELECT COUNT(*) FROM folders"
```

does not climb with the image count.

Automated coverage:

- `__tests__/unit/lib/repositories/folders-ensure-by-path.test.ts` — the
  chokepoint: reuse, create, null-`projectId` normalization, race reconcile,
  and the two rethrow cases.
- `__tests__/unit/migrations/collapse-duplicate-folders.test.ts` — the
  migration against real in-memory SQLite: survivor selection, NULL-`projectId`
  grouping, parent repointing, the index rejecting a duplicate insert
  afterwards, progress reporting, and re-run safety.
- `lib/background-jobs/host/__tests__/write-partition.test.ts` — the buffered
  `folders.ensureByPath` routes to the main database partition.
