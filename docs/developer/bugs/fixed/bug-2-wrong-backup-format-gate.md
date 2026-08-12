# Bug 2 — restore looks for files under the wrong format number

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-26) |
| **Found** | 2026-07-26 |
| **Fixed** | 2026-07-26 |
| **Severity** | **Critical** |
| **Who it bites** | **every** restore of a modern backup |
| **Fix size (as estimated)** | 1 line |
| **Fix site** | `lib/backup/restore/archive.ts:333` |
| **v5 status** | Converged — gate is `>= 2` on both sides |
| **Index** | [bugs.md](../../bugs.md) |

---

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
