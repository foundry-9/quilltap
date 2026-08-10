# Bug 55 — a file row that outlived its bytes serves 500 instead of 404

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-10 |
| **Fixed** | 2026-08-10 |
| **Severity** | Low (cosmetic in effect — a broken image either way — but it mislabels permanent loss as a server fault, invites endless client retries, and buries real faults in the error log) |
| **Who it bites** | anyone with a dangling avatar or attachment pointer; the browser re-requests it on every render of the character |
| **Provenance** | Faithful — found by dogfooding on the Friday instance: The Librarian's avatar row pointed at a mount point that no longer exists, and every render logged a 500 |
| **Defect site** | `app/api/v1/files/[id]/actions/download.ts` + `app/api/v1/files/proxy/[...key]/route.ts` (every download failure funnels into `serverError`), rooted in `lib/file-storage/manager.ts` re-wrapping typed failures into a generic `Error` |
| **Fix site** | new `lib/file-storage/errors.ts` + the two routes, the manager, and the local backend |
| **v5 status** | Owed (Faithful) — v5's file routes carry the same catch-all |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-10).** A typed `FileContentMissingError`
(`lib/file-storage/errors.ts`) now marks the one distinction the HTTP layer
needs: the object is *absent* versus the read *failed*. The manager throws it
for a missing mount-blob and passes it through its catch un-wrapped (logging a
warning, not an error); the local backend throws it on `ENOENT`; both file
routes answer `notFound` for it and keep `serverError` for everything else.
Regression tests:
[`__tests__/unit/app/api/v1/files/[id]/actions/download.test.ts`](../../../../__tests__/unit/app/api/v1/files/%5Bid%5D/actions/download.test.ts).

## Symptom

```
GET /api/v1/files/6ea1003e-325a-4844-85cb-32f8cf165f2b 500 in 33ms
```

repeating for as long as anything renders the character. The log pairs two
error-level lines per request:

```
error  File download failed | Mount-blob not found for storageKey: mount-blob:16ffca1b…:e9d12a2f…
error  [Files v1] Error serving file | fileId 6ea1003e…
```

On Friday this was The Librarian, whose `defaultImageId` pointed at a `files`
row whose `storageKey` named a mount point deleted months earlier (the uploads
store in service on 2026-05-10; the current one dates from 2026-05-11). One
row out of 2281 mount-blob-backed rows, plus four more whose mount survives but
whose blob does not.

## Root cause

Two layers, each reasonable alone:

1. `fileStorageManager.downloadFile` catches everything and rethrows a fresh
   generic `Error` carrying only a message, so the distinction between "no such
   object" and "the read blew up" is destroyed before any caller sees it.
2. Both file routes therefore have nothing to branch on and map every throw to
   `serverError`.

The result mislabels a permanent, expected condition. 500 tells the client the
server is at fault and the request is worth retrying; a dangling pointer is
neither. It also drowns genuine storage faults in error-level noise — six 500s
a minute here, all of them the same absent avatar.

## Why it survived

Dangling content pointers are rare (1 in 2281 here) and the *visible* result is
identical either way: a broken image with a UI fallback behind it. Nothing
downstream inspected the status code, so the only tell was log volume, and only
once a personified-feature character — rendered on many screens — happened to
be the one with the dangling pointer.

## The fix

`FileContentMissingError` carries the storage key and means exactly one thing:
the row exists, its content does not. Thrown by the manager for a missing
mount-blob and by the local backend on `ENOENT`; re-thrown un-wrapped by the
manager's catch (which logs it at `warn`, since it is not a fault); mapped to
404 by both file routes. Every other failure — permissions, corruption, a
backend that is down — stays generic and still produces a 500.

## Verification

Point a `files` row at a storage key with nothing behind it and request it:
`404`, one warning in the log, no error lines. Then make the read fail for a
different reason (chmod the file unreadable): still `500`. Confirm a healthy
file still serves 200 with its `Content-Type` intact.

## v5 coordination

v5's file-serving port maps download failures the same catch-all way and so
reproduces the mislabel. It inherits this fix as a drift catch-up, including
the typed error at the storage boundary.
