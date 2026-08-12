/**
 * Second-generation restore de-dup (Bug 12).
 *
 * A backup taken from an instance that was itself restored already carries the
 * doc-store rows (file / link / blob) for its project-less user files: each
 * such file's `storageKey` is a `mount-blob:` key pointing at a blob the
 * archive will restore verbatim (phases 22c–22f), and its link already sits at
 * `restored/<name>`. If the restore's file replay re-ingests those files, it
 * mints a *fresh* blob + link at that same path and gets there first, so the
 * archived link then collides on `UNIQUE(mountPointId, relativePath)` and loses
 * its id — one more duplicated store row per restore generation.
 *
 * This helper lets the replay recognise the carried rows and skip re-ingesting,
 * so the archived rows restore intact. It is deliberately a small, pure check
 * (the fix the v4 notes deferred, ported without any phase reorder).
 *
 * @module backup/restore/carried-store-rows
 */

import { parseMountBlobStorageKey, buildMountBlobStorageKey } from '@/lib/file-storage/project-store-bridge';

/** Just enough of a blob row to pair originals with their remapped selves. */
interface BlobIdentity {
  id: string;
}
/** Just enough of a mount-point row to remap its id. */
interface MountPointIdentity {
  id: string;
}

/**
 * Build the carried-store-rows detector for one restore.
 *
 * `parsed*` are the archive's original rows (pre-remap); `remapped*` are the
 * rows as they will actually be written (identical to `parsed*` in replace/
 * preserve-id mode, index-aligned copies with fresh ids in new-account mode).
 *
 * The returned function takes a file's archived `storageKey` and returns the
 * storageKey to record when the archive already carries that file's store rows
 * (remapped so it points at the blob the restore will actually write), or
 * `null` when nothing is carried and the file must be ingested via the replay.
 */
export function makeCarriedStoreRowsResolver(
  parsedBlobs: BlobIdentity[],
  remappedBlobs: BlobIdentity[],
  parsedMountPoints: MountPointIdentity[],
  remappedMountPoints: MountPointIdentity[],
): (storageKey: string | null | undefined) => string | null {
  const blobIndexById = new Map<string, number>();
  parsedBlobs.forEach((b, idx) => blobIndexById.set(b.id, idx));

  const mountIdRemap = new Map<string, string>();
  parsedMountPoints.forEach((mp, idx) => {
    const remapped = remappedMountPoints[idx];
    if (remapped) mountIdRemap.set(mp.id, remapped.id);
  });

  return (storageKey) => {
    if (!storageKey) return null;
    const parsed = parseMountBlobStorageKey(storageKey);
    if (!parsed) return null; // not a mount blob → first-gen file, ingest it
    const blobIdx = blobIndexById.get(parsed.blobId);
    if (blobIdx === undefined) return null; // blob not carried → ingest it
    const remappedBlobId = remappedBlobs[blobIdx]?.id ?? parsed.blobId;
    const remappedMountId = mountIdRemap.get(parsed.mountPointId) ?? parsed.mountPointId;
    return buildMountBlobStorageKey(remappedMountId, remappedBlobId);
  };
}
