/**
 * Archived-character guard on the vault-first wardrobe write path (§4.2a).
 *
 * Archiving prunes the vault in place, so an archived character still has a
 * live mount behind it — the old "no mount resolved → skip" no longer fires.
 * `resolveWardrobeMount` must throw the named error rather than return null,
 * because a null return sends callers down the legacy DB-fallback write path,
 * which would silently mutate an archived character's wardrobe.
 */

import { describe, expect, it } from '@jest/globals';

const charactersFindByIdRawMock = jest.fn<(id: string) => Promise<unknown>>();

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    characters: { findByIdRaw: charactersFindByIdRawMock },
  }),
}));

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('@/lib/wardrobe/expand-composites', () => ({
  detectComponentCycles: jest.fn(() => []),
}));

jest.mock('@/lib/database/repositories/vault-overlay/vault-readers', () => ({
  readCharacterVaultWardrobe: jest.fn(),
}));

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-sync', () => ({
  projectVaultWardrobe: jest.fn(),
}));

import { resolveWardrobeMount } from '@/lib/database/repositories/vault-overlay/wardrobe-writes';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';

describe('resolveWardrobeMount — archived characters', () => {
  it('resolves a live character to its vault mount', async () => {
    charactersFindByIdRawMock.mockResolvedValue({
      id: 'char-1',
      archivedAt: null,
      characterDocumentMountPointId: 'mount-1',
    });

    await expect(resolveWardrobeMount('char-1')).resolves.toEqual({
      mountPointId: 'mount-1',
      scopeId: 'char-1',
      characterId: 'char-1',
      scope: 'character',
    });
  });

  it('throws CharacterArchivedError for an archived character instead of falling back to the DB path', async () => {
    charactersFindByIdRawMock.mockResolvedValue({
      id: 'char-1',
      archivedAt: '2026-08-10T00:00:00.000Z',
      characterDocumentMountPointId: 'mount-1',
    });

    await expect(resolveWardrobeMount('char-1')).rejects.toBeInstanceOf(CharacterArchivedError);
  });

  it('still returns null for a character with no vault (legacy DB fallback)', async () => {
    charactersFindByIdRawMock.mockResolvedValue({
      id: 'char-1',
      archivedAt: null,
      characterDocumentMountPointId: null,
    });

    await expect(resolveWardrobeMount('char-1')).resolves.toBeNull();
  });
});
