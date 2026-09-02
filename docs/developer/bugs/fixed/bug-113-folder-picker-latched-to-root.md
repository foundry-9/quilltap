# Bug 113 — the folder picker latched onto its own loading state, so every destination offered only Root

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-01) |
| **Found** | 2026-09-01 |
| **Fixed** | 2026-09-01 |
| **Severity** | Medium (nothing is lost or corrupted, but every file moved into a project lands in its root, and the only way to put it anywhere else is to move it and then move it again from inside the project) |
| **Who it bites** | Anyone moving a file out of General Files, or between projects, via **Move to Project** — the sole consumer of `FolderPicker` |
| **Provenance** | Reported 2026-09-01, from the Friday instance: "I have an image I'm trying to move to a project, but the folder dropdown isn't displaying any of the available folders except for root." The Estate had `/Gary/`, `/character-avatars/` and `/story-backgrounds/` in the `folders` table at the time |
| **Defect site** | `components/files/FolderPicker.tsx` — the derived folder list was copied into a `folders` state behind a `result.length > 0 && folders.length === 0` guard, and the `<select>` rendered that state rather than the derivation |
| **Fix site** | Same file: the list is a `useMemo` over `files` / `dbFolders` / locally-created paths, rendered directly; the state that remains (`localFolders`) holds only folders created while the create API was unreachable, and is scoped to the project they were created under. The create path now `refetch`es instead of re-copying a stale snapshot |
| **v5 status** | Not investigated. **The shape applies** to any port that mirrors derived data into component state behind an "only if empty" guard — the guard is satisfied by the component's own empty first render, so the mirror is filled with the loading state and sealed |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-09-01).** The folder list is derived on every render from
the fetched data rather than cached into state, so the dropdown shows the
project's real folders and re-derives when the destination changes.

## Symptom

Open **Move to Project** on a file in General Files, choose a destination
project, and the **Folder** dropdown offers exactly one entry: `/ (Root)`. It
does so for every project, including projects with folders plainly visible in
the file browser a moment earlier. There is no error, no empty state, and no
spinner — the control looks like a correctly rendered dropdown for a project
that happens to have no folders.

## Root cause

`FolderPicker` fetched two things — the destination's files and its `folders`
rows — and folded them into a `FolderInfo[]`. That derivation was correct. What
it did with the result was not:

```ts
const builtFolders = (() => {
  const folderMap = new Map<string, FolderInfo>()
  folderMap.set('/', { path: '/', name: 'Root', /* … */ })   // always seeded
  for (const dbFolder of dbFolders) { /* … */ }
  // …
  if (result.length > 0 && folders.length === 0) {
    setFolders(result)          // ← mirror into state, once
  }
  return result
})()
```

and the `<select>` rendered `folders` — the state — not `result`.

The guard reads as "fill the mirror the first time we have something," but the
derivation **always** has something: Root is seeded unconditionally, before any
data is consulted. So on the very first render, with both queries still in
flight and `files`/`dbFolders` empty, `result` is `[Root]` — length 1, which
satisfies `result.length > 0` — and `folders` is `[]`, which satisfies
`folders.length === 0`. The mirror is filled with the loading state. From that
moment `folders.length === 1`, the guard can never pass again, and the arrival
of the real data updates nothing the user can see.

The same latch made the picker blind to a change of destination: selecting a
different project swapped the query key and refetched, correctly, into a
`folders` state that had been sealed against writes since the first render.

It survived because every part of it is individually reasonable and the failure
mode is a *plausible* dropdown. Root is genuinely always a valid destination, so
the control never looks broken — it looks like a project with no folders, which
is a real thing a project can be. Nothing throws, nothing logs, and the correct
list is sitting in `result` one line above the one that is rendered.

The condition is also invisible to a reading that assumes the guard runs against
settled data. `builtFolders` is an IIFE in render, not an effect, so it runs
during the loading render as well — and it is precisely that render, the one
nobody pictures, that wins the race and sets the value for the lifetime of the
modal.

## The fix

The derivation is the single source of truth and is rendered directly:

- `folders` is now a `useMemo` over `files`, `dbFolders` and any locally-created
  paths. There is no mirror, so there is nothing to latch and nothing to seal;
  a destination change re-derives by construction.
- Module-level `NO_FILES` / `NO_FOLDERS` / `NO_PATHS` constants stand in for the
  `?? []` fallbacks, so a still-loading query doesn't hand the memo a fresh
  array identity on every render.
- The state that remains, `localFolders`, is only the offline fallback: folders
  the user created while `POST /api/v1/files/folders?action=create` was
  unreachable. It carries the `projectId` it was created under and is ignored
  when the destination changes, so a failed create in one project can't offer a
  phantom folder in another.
- On a *successful* create the picker calls `refetchFolders()` rather than
  copying the previous render's snapshot into state — the old code's
  `setFolders(builtFolders)` could not have included the folder just created.
- Dead `fetchFolders` callback removed.

Separately, and in the same dropdown: nesting was indented with ordinary
spaces, which an `<option>` collapses, so `/Foundry-9/Quilltap/` rendered at the
same visual depth as `/Foundry-9/`. The indent is now non-breaking spaces.

## How to verify

1. In **Files → General Files**, click **Move to Project** on any file.
2. Choose a project that has folders (in Friday: *The Estate*, or
   *Quilltap Plans*).
3. The **Folder** dropdown lists `/ (Root)` plus that project's folders.
4. Change the destination to a different project — the list changes with it.
5. Choose a project with nested folders (*Quilltap Plans* has
   `/Foundry-9/Quilltap/`) and confirm the child is indented under its parent.

Cross-check the expected list against the database:

```sh
npx quilltap db --instance Friday query "SELECT p.name, f.path FROM folders f JOIN projects p ON p.id=f.projectId GROUP BY p.name, f.path ORDER BY p.name, f.path"
```
