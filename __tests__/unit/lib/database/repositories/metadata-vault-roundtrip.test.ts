/**
 * Round-trip tests for the character fact sheet (`metadata.json`) through the
 * vault write/read overlay.
 *
 * `metadata` is a writable managed field with no DB column — the vault file is
 * its sole source of truth — and its patch semantics differ deliberately from
 * every other JSON file in the vault: it is a whole-object REPLACE, not a
 * read-modify-write merge. properties.json merges only because five Character
 * fields share that one file; `metadata` is one field owning one file, so PUT-
 * the-object is the coherent reading, and a merge would make deleting a key
 * impossible. These tests pin that down, along with the empty→{} conventions.
 *
 * The database-store is mocked with an in-memory Map acting as the vault, so
 * the real write-overlay code and the real parser run against a shared store —
 * a genuine write→store→read cycle without the full mount-index DB. Mirrors the
 * mock set of manifesto-vault-roundtrip.test.ts.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

// In-memory vault: relativePath -> content. Shared by the mocked read/write.
const vault = new Map<string, string>();

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(async (_mountPointId: string, relativePath: string, content: string) => {
    vault.set(relativePath, content);
    return { mtime: 0 };
  }),
  readDatabaseDocument: jest.fn(async (_mountPointId: string, relativePath: string) => {
    if (!vault.has(relativePath)) {
      throw new (class extends Error {})(`not found: ${relativePath}`);
    }
    const content = vault.get(relativePath)!;
    return { content, mtime: 0, size: content.length };
  }),
  deleteDatabaseDocument: jest.fn(async () => undefined),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) { super(message); }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

import {
  applyDocumentStoreWriteOverlay,
  CHARACTER_METADATA_JSON_PATH,
} from '@/lib/database/repositories/character-properties-overlay';
import { parseVaultMetadata } from '@/lib/database/repositories/vault-overlay/parsers';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.Mock;

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const MOUNT_POINT_ID = '22222222-2222-4222-8222-222222222222';

const SHEET = {
  hasAnsibleAccess: true,
  clearanceLevel: 3,
  faction: 'Ordo Aurum',
  knownLanguages: ['Trade Cant', 'High Gothic'],
};

function wireCharacterWithVault() {
  getRepositoriesMock.mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue({
        id: CHARACTER_ID,
        name: 'Tess',
        characterDocumentMountPointId: MOUNT_POINT_ID, // → hasLinkedVault() === true
      }),
    },
  });
}

/** Read the stored sheet back through the overlay's own parser. */
function readMetadataThroughOverlay(): Record<string, unknown> {
  const content = vault.get(CHARACTER_METADATA_JSON_PATH);
  if (content === undefined) return {};
  return parseVaultMetadata(content, CHARACTER_ID, MOUNT_POINT_ID) ?? {};
}

beforeEach(() => {
  jest.clearAllMocks();
  vault.clear();
  wireCharacterWithVault();
});

describe('metadata vault round-trip — applyDocumentStoreWriteOverlay', () => {
  it('routes a metadata patch to metadata.json and strips it from the DB patch', async () => {
    const dbPatch = await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: SHEET });

    expect(JSON.parse(vault.get(CHARACTER_METADATA_JSON_PATH)!)).toEqual(SHEET);
    // The vault owns the field outright — it must not leak back into the DB patch.
    expect('metadata' in dbPatch).toBe(false);
  });

  it('pretty-prints the file, 2-space, like the scaffold', async () => {
    // The user hand-edits this file; a single-line blob would be hostile.
    await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: { faction: 'Ordo Aurum' } });
    expect(vault.get(CHARACTER_METADATA_JSON_PATH)).toBe('{\n  "faction": "Ordo Aurum"\n}');
  });

  it('leaves metadata.json untouched when the patch does not carry metadata', async () => {
    const dbPatch = await applyDocumentStoreWriteOverlay(CHARACTER_ID, { name: 'Renamed' } as any);

    const writes = writeDatabaseDocumentMock.mock.calls.filter(
      ([, relPath]) => relPath === CHARACTER_METADATA_JSON_PATH
    );
    expect(writes).toHaveLength(0);
    expect(vault.has(CHARACTER_METADATA_JSON_PATH)).toBe(false);
    expect((dbPatch as any).name).toBe('Renamed');
  });

  it('writes {} for a null metadata patch', async () => {
    await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: null });
    expect(readMetadataThroughOverlay()).toEqual({});
  });

  it('round-trips every JSON value type: object → file → object', async () => {
    const rich = { ...SHEET, dossier: { rank: 'adept' }, lastSeen: null, trust: 0.75 };
    await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: rich });
    expect(readMetadataThroughOverlay()).toEqual(rich);
  });

  describe('whole-object replace, not key-merge', () => {
    it('drops keys the new object omits', async () => {
      await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: SHEET });
      await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: { faction: 'Ordo Ferrum' } });

      // A merge would have left hasAnsibleAccess behind, and there would then
      // be no way to ever delete a key through the API.
      expect(readMetadataThroughOverlay()).toEqual({ faction: 'Ordo Ferrum' });
    });

    it('clears the sheet when handed an empty object', async () => {
      await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: SHEET });
      await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: {} });
      expect(readMetadataThroughOverlay()).toEqual({});
    });

    it('overwrites an unparseable file rather than reading it first', async () => {
      // Replace semantics mean a fat-fingered file is repaired by the next
      // write, not an obstacle to it.
      vault.set(CHARACTER_METADATA_JSON_PATH, '{ broken');
      await applyDocumentStoreWriteOverlay(CHARACTER_ID, { metadata: { faction: 'Ordo Aurum' } });
      expect(readMetadataThroughOverlay()).toEqual({ faction: 'Ordo Aurum' });
    });
  });
});
