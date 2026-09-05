# Bug 69 — the file watcher overwrites an archive bundle's content digest, so no archived character can be rehydrated

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-14 (live, on the V4test instance, while verifying the bug 66 fix needed an archived character) |
| **Fixed** | 2026-08-14 |
| **Severity** | **High** (archiving is one-way: every rehydrate fails "the bundle is corrupt"; no data is lost — the bundle is intact — but the character cannot be brought back without repairing the row by hand) |
| **Who it bites** | anyone who archives a character while the app is running, which is everyone |
| **Provenance** | dogfooding — reproduced twice on a live instance, with the watcher's own log line naming the overwrite |
| **Fix site** | new `lib/file-storage/digest-policy.ts` (`preservesContentDigest`) honoured by `lib/file-storage/watcher.ts` (`handleFileChange`) and `lib/file-storage/reconciliation.ts`; plus a self-heal in `lib/characters/archive-service.ts` (`restoreArchiveBundle`) for bundles already bitten |
| **v5 status** | Not yet assessed — v5's file watcher must carry the same carve-out if it re-derives digests from disk |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-14).**

### Symptom

Archive a character, then press **Rehydrate**:

```
Error: Archive bundle verification failed: the bundle's decrypted content does
not match its recorded digest (expected 473955ff…, got e4095a63…) — the bundle
is corrupt
```

The bundle is not corrupt. Its bytes decrypt cleanly and import fine. What is
wrong is the digest the `files` row was carrying at the time of the check.

### Root cause

`createArchiveFileRecord` (`lib/characters/archive-service.ts`) deliberately
records the **plaintext** digest of the bundle while writing **encrypted** bytes
to disk (§4.2d): a ciphertext digest would change on every re-encryption (a
passphrase change) and would verify nothing about the content. `size` is the
on-disk (encrypted) byte count.

`handleFileChange` in `lib/file-storage/watcher.ts` knew nothing of that. It
re-derives `sha256` and `size` from the bytes on disk for **any** row whose file
changes — and chokidar sees the bundle land seconds after the row is created
(the row is minted before the upload, by bug 53's fix, so the watcher finds it
by `storageKey` rather than adopting it as an orphan). The watcher's own log
line records the damage:

```json
{"timestamp":"2026-08-15T04:04:57.735Z","level":"info",
 "message":"Updated file record after on-disk change",
 "module":"file-storage:watcher","fileId":"29d5ceaf-…",
 "oldSha256":"e4095a63af50…","newSha256":"473955ffb594…"}
```

`e4095a63…` was the plaintext digest; `473955ff…` is `shasum` of the encrypted
file on disk. Ten seconds after the archive, the only value that could ever
verify the bundle was gone, and `restoreArchiveBundle`'s check — comparing the
decrypted content against the row — could never again pass.

`reconciliation.ts` carried the same assumption in a narrower spot: when a
scanned file's size differs from the row's, it recomputes the digest from disk.
For an archive row that is precisely the re-encryption case (a passphrase change
rewrites the bundle at a different length), so a boot could inflict the same
damage the watcher does live.

### Why it survived

Bug 53 taught *reconciliation* that ARCHIVE rows are special — its preservation
set explicitly notes "the row stores the PLAINTEXT sha256 while the disk bytes
are encrypted, so the sha256 cross-match can never rescue it" — but the lesson
stopped at the deletion path in that one file. Nothing told the watcher, the
other writer of the same column, and nothing told reconciliation's own *update*
path. Archive-then-rehydrate had only ever been exercised in unit tests, where
there is no watcher, and in same-process flows too quick for chokidar's
500 ms `awaitWriteFinish` to fire.

### The fix

1. **One place decides.** New `lib/file-storage/digest-policy.ts` exports
   `preservesContentDigest(category)` — true for `ARCHIVE`, the categories whose
   `sha256` describes something other than the bytes at `storageKey`. Anything
   re-deriving a digest from disk asks it first.
2. **The watcher honours it** (`handleFileChange`): for such a row it updates
   `size` alone and leaves `sha256` verbatim. `size` is still corrected, because
   an archive row's size *is* the on-disk count.
3. **Reconciliation honours it** on the size-mismatch update path.
4. **A self-heal for bundles already bitten** (`restoreArchiveBundle`): if the
   decrypted content does not match the recorded digest, the digest of the file
   **as stored** is computed. If the row's value equals that, the bytes are
   intact and the row is what was damaged — the rehydrate repairs the row to the
   plaintext digest, emits a warning, and proceeds. Any other mismatch still
   throws `ArchiveVerificationError`, so a genuinely corrupt bundle is refused
   exactly as before. Without this arm, every archive taken before this fix would
   stay unrehydratable forever.

### How it was verified

End to end on a live instance (V4test), three times:

- **Before the fix** — archive Riya → the row's `sha256` equals `shasum` of the
  encrypted bundle, `updatedAt` ten seconds after `createdAt`; rehydrate fails
  with the digest error.
- **The self-heal** — with the arm in place, the same clobbered bundle
  rehydrates, reporting *"The bundle's recorded digest had been overwritten with
  the digest of its encrypted bytes; the contents verified against the file as
  stored, and the record has been repaired."*
- **After restarting the server** (the watcher is registered at boot, so HMR
  does not reload it) — archive again, wait past the debounce: the row's
  `sha256` now differs from the on-disk digest, no watcher update fires, and the
  rehydrate succeeds with **no** warning.

Regression coverage:
`__tests__/unit/lib/file-storage/watcher-content-digest.test.ts` (ordinary file
still refreshed; archive digest preserved; archive size still corrected),
one case in `__tests__/unit/lib/files/reconciliation.test.ts`, and one in
`__tests__/unit/lib/characters/archive-service.test.ts` for the self-heal
(alongside the existing "refuses a genuinely wrong digest" case, which still
passes).

### v5 coordination

Not assessed on the v5 side. If the port's file watcher re-derives digests from
disk, it inherits this defect wholesale — port the carve-out (and the policy
module's rule, not just the ARCHIVE special case) rather than v4's pre-fix
watcher.
