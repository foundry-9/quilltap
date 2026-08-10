# Bug 53 — filesystem reconciliation clobbers and can delete archive bundle rows

| | |
|---|---|
| **Status** | **FIXED in v4** |
| **Found** | 2026-08-10 |
| **Fixed** | 2026-08-10 |
| **Severity** | High (a boot can permanently delete an archived character's bundle row, dangling `archiveFileId`; at minimum every boot strips the bundle out of its `/archives` shelf folder) |
| **Who it bites** | anyone with an archived character — worst on instances whose `files/` sits under a cloud-sync client that can leave bytes dataless at boot |
| **Provenance** | Faithful — found by code inspection while verifying the §4.7 wipe options against a scratch instance, before any operator surface for archiving shipped |
| **Defect site** | `lib/file-storage/reconciliation.ts` (step-3 folderPath "fix", step-4 stale-record delete) + `lib/characters/archive-service.ts` (`createArchiveFileRecord` row/upload ordering) |
| **Fix site** | same three sites |
| **v5 status** | Owed (Faithful) — v5's reconciliation port must carry the same category guard and reference set |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-10).** Reconciliation now leaves ARCHIVE/BACKUP rows'
curated folderPath alone, preserves files referenced by `archiveFileId` /
`archivedAvatarFileId` (via raw character reads, so broken-vault rows still
count), and the archive service writes the `files` row with its storageKey
before the bytes hit disk. Regression tests:
[`__tests__/unit/lib/files/reconciliation.test.ts`](../../../../__tests__/unit/lib/files/reconciliation.test.ts)
(archive-bundle preservation, curated-folderPath guard, ordinary-drift still
corrected).

## Symptom

Three related defects, all rooted in the startup filesystem reconciliation
(and its runtime sibling, the file watcher) not knowing archive bundles exist:

1. **folderPath clobber, every boot.** Archive bundles are `files` rows with
   `folderPath: '/archives'` and a two-segment storage key
   (`<fileId>/character-archive.qtap`). Reconciliation "corrects" any matched
   row whose folderPath differs from the storage-key-derived path — which is
   `/` for every two-segment key — so each boot rewrote the bundle's
   folderPath from `/archives` to `/`.
2. **Row deletion when bytes are absent at boot.** Step 4 deletes DB rows whose
   storage key isn't on disk unless a character references them — but the
   reference set only collected `defaultImageId` / `avatarOverrides[].imageId`,
   never `archiveFileId`. The sha256 cross-match can never rescue a bundle
   either, by design: the row stores the **plaintext** sha256 while the disk
   bytes are encrypted. A bundle whose bytes were momentarily unavailable
   (cloud-sync dataless file, unfinished copy) lost its row permanently,
   leaving the tombstone's `archiveFileId` dangling.
3. **Watcher adoption race on archive creation.** `createArchiveFileRecord`
   created the row with `storageKey: null`, uploaded the bytes, then patched
   the key in. The watcher's add event, firing between upload and patch, found
   no row for the new path and adopted the fresh bundle as an *orphaned
   DOCUMENT* row — a duplicate record for the archive bytes.

## Root cause

Reconciliation and the watcher assume every file's folderPath mirrors its
physical storage key and every valuable row is referenced by an avatar field
or `linkedTo`. Archive bundles violate all three assumptions: curated
folderPath, plaintext-sha row over encrypted bytes, and a reference held in a
column (`archiveFileId`) the preservation set never read.

## Why it survived

The archive service landed (F6/F7) with no operator surface, so no instance
had real ARCHIVE rows for a boot to chew on. It surfaced only when a scratch
instance was seeded with a bundle row to verify the §4.7 wipe options.

## The fix

- `reconcileFilesystem` step 3: skip the folderPath correction for rows of
  category `ARCHIVE` or `BACKUP` (size/sha healing still applies).
- Step 4: collect `archiveFileId` and `archivedAvatarFileId` into the
  referenced set, and read characters via `findAllRaw` so rows whose vault is
  broken still contribute their references.
- `createArchiveFileRecord`: mint the file id up front and create the row with
  its storageKey set, then upload — the watcher's add event now finds the row
  by storage key and stays silent.

## How to verify

Run `__tests__/unit/lib/files/reconciliation.test.ts`. Or on a live instance:
archive a character, reboot, and check the ARCHIVE row still has
`folderPath: '/archives'` and its original id; make the bundle file dataless
and reboot again — the row must survive as "preserved" in the reconciliation
log.
