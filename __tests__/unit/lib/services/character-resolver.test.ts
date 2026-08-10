/**
 * Unit tests for the shared character resolver.
 *
 * Covers the archived-character rules from the character-archive spec §4.6:
 * name matches skip archived characters (a live namesake wins), while an
 * exact id match still returns an archived character so callers can refuse
 * with the named "archived; rehydrate" message.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

const mockFindByUserId = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    characters: { findByUserId: (...args: unknown[]) => mockFindByUserId(...args) },
  }),
}));

import {
  findCharactersByName,
  resolveCharacterByNameOrId,
} from '@/lib/services/character-resolver';

const USER = 'user-1';
const ARCHIVED_ID = 'a0000000-0000-4000-8000-00000000000a';
const LIVE_ID = 'a0000000-0000-4000-8000-00000000000b';

const archivedBertie = {
  id: ARCHIVED_ID,
  name: 'Bertie',
  createdAt: '2024-01-01T00:00:00.000Z',
  archivedAt: '2026-08-01T00:00:00.000Z',
};
const liveBertie = {
  id: LIVE_ID,
  name: 'Bertie',
  createdAt: '2025-06-01T00:00:00.000Z',
  archivedAt: null,
};
const jeeves = {
  id: 'a0000000-0000-4000-8000-00000000000c',
  name: 'Jeeves',
  createdAt: '2024-02-01T00:00:00.000Z',
  archivedAt: null,
};

describe('character-resolver archived rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByUserId.mockResolvedValue([archivedBertie, liveBertie, jeeves]);
  });

  describe('findCharactersByName', () => {
    it('skips archived characters in name matches', async () => {
      const matches = await findCharactersByName(USER, 'bertie');
      expect(matches.map((c) => c.id)).toEqual([LIVE_ID]);
    });

    it('returns empty when the only namesake is archived', async () => {
      mockFindByUserId.mockResolvedValue([archivedBertie, jeeves]);
      const matches = await findCharactersByName(USER, 'Bertie');
      expect(matches).toEqual([]);
    });
  });

  describe('resolveCharacterByNameOrId', () => {
    it('resolves the live namesake by name, not the older archived one', async () => {
      const resolved = await resolveCharacterByNameOrId(USER, 'Bertie');
      expect(resolved?.id).toBe(LIVE_ID);
    });

    it('returns null for a name whose only holder is archived', async () => {
      mockFindByUserId.mockResolvedValue([archivedBertie, jeeves]);
      const resolved = await resolveCharacterByNameOrId(USER, 'Bertie');
      expect(resolved).toBeNull();
    });

    it('still resolves an archived character by exact id (caller refuses with the named message)', async () => {
      const resolved = await resolveCharacterByNameOrId(USER, ARCHIVED_ID);
      expect(resolved?.id).toBe(ARCHIVED_ID);
      expect(resolved?.archivedAt).toBeTruthy();
    });

    it('resolves live characters by name as before', async () => {
      const resolved = await resolveCharacterByNameOrId(USER, 'jeeves');
      expect(resolved?.id).toBe(jeeves.id);
    });
  });
});
