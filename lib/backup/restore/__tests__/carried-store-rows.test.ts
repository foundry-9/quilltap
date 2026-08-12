/**
 * Bug 12 — a second-generation restore must not re-ingest files whose store
 * rows the archive already carries, or the archived link ids collide and die.
 *
 * `makeCarriedStoreRowsResolver` is the decision the file replay consults: it
 * returns the (remapped) storageKey to keep when the archive already carries a
 * file's blob, and null when the replay must ingest the file.
 */

import { makeCarriedStoreRowsResolver } from '../carried-store-rows';

const uploadsMount = { id: 'uploads-mp' };

describe('makeCarriedStoreRowsResolver', () => {
  it('recognises a carried project-less file (second generation) — preserve-id mode', () => {
    // Preserve-id (replace) mode: parsed and remapped rows share ids.
    const blobs = [{ id: 'blob-A' }, { id: 'blob-B' }];
    const mounts = [uploadsMount];
    const resolve = makeCarriedStoreRowsResolver(blobs, blobs, mounts, mounts);

    // A file whose archived storageKey points at a carried blob → keep it.
    expect(resolve('mount-blob:uploads-mp:blob-B')).toBe('mount-blob:uploads-mp:blob-B');
  });

  it('remaps the carried storageKey in new-account mode', () => {
    // New-account mode: index-aligned copies with fresh ids.
    const parsedBlobs = [{ id: 'blob-A' }, { id: 'blob-B' }];
    const remappedBlobs = [{ id: 'blob-A2' }, { id: 'blob-B2' }];
    const parsedMounts = [{ id: 'uploads-mp' }];
    const remappedMounts = [{ id: 'uploads-mp2' }];
    const resolve = makeCarriedStoreRowsResolver(parsedBlobs, remappedBlobs, parsedMounts, remappedMounts);

    // The kept storageKey must point at the blob/mount the restore actually writes.
    expect(resolve('mount-blob:uploads-mp:blob-B')).toBe('mount-blob:uploads-mp2:blob-B2');
  });

  it('does not fire for a first-generation file (bytes not yet in a mount blob)', () => {
    const blobs = [{ id: 'blob-A' }];
    const resolve = makeCarriedStoreRowsResolver(blobs, blobs, [uploadsMount], [uploadsMount]);

    // Legacy disk storage key — not a mount blob → the replay must ingest it.
    expect(resolve('files/_general/photo.png')).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve(undefined)).toBeNull();
  });

  it('does not fire when the referenced blob is not carried in the archive', () => {
    const blobs = [{ id: 'blob-A' }];
    const resolve = makeCarriedStoreRowsResolver(blobs, blobs, [uploadsMount], [uploadsMount]);

    // A mount-blob key whose blob was pruned from the archive → ingest it.
    expect(resolve('mount-blob:uploads-mp:blob-missing')).toBeNull();
  });
});
