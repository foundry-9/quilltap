# Bug 56 — folder creation mkdir -p's its way up an absent mount root

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-10 |
| **Fixed** | 2026-08-10 |
| **Severity** | Medium (as observed, an opaque 500 on a legitimate action; where the process can write to the missing ancestors, a silent success that fabricates a directory tree divorced from the user's store) |
| **Who it bites** | anyone whose filesystem store's `basePath` is unreachable — an unmounted volume, a renamed vault, or (the way it was found) a host path never bound into a container |
| **Provenance** | Faithful — found by dogfooding on the Friday instance under Docker: creating a folder in the "Church" store failed with `EACCES: permission denied, mkdir '/Users'` |
| **Defect site** | `lib/mount-index/scanner.ts:514` — `fs.mkdir(target, { recursive: true })` with no check that `basePath` exists |
| **Fix site** | new `lib/mount-index/base-path-availability.ts` + `lib/mount-index/scanner.ts` + `app/api/v1/mount-points/[id]/folders/route.ts` + `app/api/v1/mount-points/route.ts` |
| **v5 status** | Owed (Faithful) — the port carries the same unguarded recursive mkdir |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-10).** `createFilesystemFolder` now calls
`assertBasePathAvailable(basePath)` before the recursive mkdir, and the folders
route maps the resulting typed `BasePathUnavailableError` to a 409 carrying the
diagnosis. The same check backs the warning shown when a store is created, so
one helper answers "is this base path reachable, and is a container why not"
for every caller. Regression tests:
[`lib/mount-index/__tests__/base-path-availability.test.ts`](../../../../lib/mount-index/__tests__/base-path-availability.test.ts).

## Symptom

Creating a folder in a filesystem-backed document store fails with a bare
"Failed to create folder" in the picker. The server log:

```json
{"level":"error","message":"[Mount Points v1] Error creating folder in mount point",
 "context":{"mountPointId":"84e8562f-b4fd-4fd1-a238-8caf9e760602"},
 "error":{"message":"EACCES: permission denied, mkdir '/Users'"}}
```

The store's `basePath` was `/Users/csebold/Local Obsidian/Charlie/Church`, and
the message names `/Users` — five levels above the target — which is the tell.

The picker had listed the store's folders quite happily a moment earlier,
because that listing is served from the cached mount index in the database, not
from the filesystem. A store whose bytes are entirely unreachable therefore
browses normally right up to the first operation that touches real files.

## Root cause

`lib/mount-index/scanner.ts:514`:

```ts
await fs.mkdir(target, { recursive: true });
```

`recursive: true` creates every missing ancestor. The boundary check above it
confirms `target` is *inside* `basePath`, but nothing confirms `basePath` is
there at all. When the mount root is missing, "inside a directory that does not
exist" is still a valid path, so mkdir walks up to the topmost missing ancestor
— here `/`, whose child `/Users` the unprivileged container user may not create
— and fails there.

The instance was running in Docker with a single bind mount for its data
directory. Filesystem stores point at arbitrary host paths, and none had been
passed through, so from inside the container `basePath` simply did not exist.

## Why it survived

The failure needs an unreachable `basePath`, which on a normal single-machine
install is rare and self-inflicted. The containerized case makes it the default
rather than the exception, and containers were where nobody dogfooded folder
creation.

It also fails *quietly in the wrong direction* on the more permissive setups. As
root — which plenty of container images run as — the mkdir succeeds, the API
returns 200, and the folder is created inside a fabricated `/Users/…/Church`
tree that has nothing to do with the user's vault and vanishes with the
container. A 500 was the lucky outcome.

## The fix

A new module, `lib/mount-index/base-path-availability.ts`, answers the question
once for every caller:

- `checkBasePathAvailability(basePath)` distinguishes *missing* (ENOENT) from
  *denied* (EACCES/EPERM) from *not a directory*, and reports whether the
  process is containerized (`isDockerEnvironment() || isLimaEnvironment()`).
- `assertBasePathAvailable(basePath)` throws a typed `BasePathUnavailableError`
  carrying that diagnosis.

`createFilesystemFolder` asserts before the mkdir. The folders route maps the
typed error to **409** with the diagnosis as the message — a configuration
problem is neither a bad request nor a server fault. Store creation
(`app/api/v1/mount-points/route.ts`) now uses the same check for its warning,
which replaced the narrower `verifyBasePath` helper.

For the missing-path-inside-a-container case the message names the actual
remedy, which ENOENT never could:

> The path '…' is not visible from inside the container. Filesystem document
> stores must be passed through as bind mounts, which can only be done when the
> container is created. Re-run the start script with `--recreate` to rebuild the
> container with this store included.

That remedy is now real: `quilltap docs docker-mounts` enumerates the binds an
instance's filesystem stores need, and `scripts/start-quilltap-docker.ts` applies
them at container creation and reports drift on an existing container.

## How to verify

1. Create a filesystem store whose `basePath` does not exist (or run under
   Docker without binding an existing store's path through).
2. Try to create a folder in it. Expect **409** and a message naming the base
   path — not a 500, and no directory tree created anywhere.
3. Confirm nothing was fabricated: the missing ancestors must still be missing.
4. With the path present (natively, or bound in via `--recreate`), the same
   request succeeds.

Note that on a non-root container the fabrication is now doubly prevented:
Docker creates a bind's missing destination ancestors itself, as root and mode
0755, so an unbound path is not writable by the app user in the first place. The
guard is what makes the behaviour correct rather than merely lucky.
