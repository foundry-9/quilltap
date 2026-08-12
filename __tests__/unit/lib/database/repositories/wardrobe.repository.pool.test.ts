/**
 * Unit tests for `WardrobeRepository.findWearablePoolForCharacter`.
 *
 * Strategy: mock the three tier readers (the character overlay, Quilltap
 * General, and the project stores) and assert only the merge rule — precedence
 * character > project > general, archived filtering, and the degradation
 * behaviour when a project store can't be read.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/database/repositories/character-properties-overlay', () => ({
  getOverlaidWardrobeItems: jest.fn(),
}));

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  createVaultWardrobeItem: jest.fn(),
  updateVaultWardrobeItem: jest.fn(),
  deleteVaultWardrobeItem: jest.fn(),
}));

jest.mock('@/lib/mount-index/general-wardrobe', () => ({
  readGeneralWardrobe: jest.fn(),
}));

jest.mock('@/lib/mount-index/project-wardrobe', () => ({
  readProjectWardrobe: jest.fn(),
}));

const { WardrobeRepository } = require('@/lib/database/repositories/wardrobe.repository');
const { getOverlaidWardrobeItems } = require('@/lib/database/repositories/character-properties-overlay');
const generalWardrobe = require('@/lib/mount-index/general-wardrobe');
const projectWardrobe = require('@/lib/mount-index/project-wardrobe');

const mockOverlay = getOverlaidWardrobeItems as jest.Mock;
const mockGeneral = generalWardrobe.readGeneralWardrobe as jest.Mock;
const mockProject = projectWardrobe.readProjectWardrobe as jest.Mock;

const CHAR_ID = 'c1c1c1c1-0000-0000-0000-000000000001';

function item(id: string, tier: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    characterId: null,
    title: `${id} (${tier})`,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Titles keyed by id, so precedence assertions read as "which tier won". */
function titlesById(items: Array<{ id: string; title: string }>) {
  return Object.fromEntries(items.map((i) => [i.id, i.title]));
}

let repo: InstanceType<typeof WardrobeRepository>;

beforeEach(() => {
  jest.clearAllMocks();
  repo = new WardrobeRepository();
  mockOverlay.mockResolvedValue([]);
  mockGeneral.mockResolvedValue([]);
  mockProject.mockResolvedValue([]);
});

describe('findWearablePoolForCharacter', () => {
  it('applies precedence character > project > general', async () => {
    mockGeneral.mockResolvedValue([item('shared', 'general'), item('g-only', 'general')]);
    mockProject.mockResolvedValue([item('shared', 'project'), item('p-only', 'project')]);
    mockOverlay.mockResolvedValue([
      item('shared', 'character', { characterId: CHAR_ID }),
      item('c-only', 'character', { characterId: CHAR_ID }),
    ]);

    const pool = await repo.findWearablePoolForCharacter(CHAR_ID, {
      projectMountPointIds: ['mp-1'],
    });

    expect(titlesById(pool)).toEqual({
      shared: 'shared (character)',
      'g-only': 'g-only (general)',
      'p-only': 'p-only (project)',
      'c-only': 'c-only (character)',
    });
  });

  it('lets the last project mount win a collision between project stores', async () => {
    mockGeneral.mockResolvedValue([]);
    mockProject.mockImplementation(async (mountPointId: string) => [
      item('livery', `project-${mountPointId}`),
    ]);

    const pool = await repo.findWearablePoolForCharacter(CHAR_ID, {
      projectMountPointIds: ['mp-1', 'mp-2'],
    });

    expect(titlesById(pool)).toEqual({ livery: 'livery (project-mp-2)' });
  });

  it('drops archived shared items from the pool', async () => {
    mockGeneral.mockResolvedValue([
      item('live', 'general'),
      item('gone', 'general', { archivedAt: '2026-02-02T00:00:00.000Z' }),
    ]);

    const pool = await repo.findWearablePoolForCharacter(CHAR_ID);

    expect(pool.map((i: { id: string }) => i.id)).toEqual(['live']);
  });

  it('lets a shared item resurface when the character archives their own copy', async () => {
    // `findByCharacterId` excludes archived items, so an archived personal
    // override simply isn't there to shadow the shared one. Long-standing
    // `wardrobe_list` behaviour, pinned here deliberately.
    mockGeneral.mockResolvedValue([item('livery', 'general')]);
    mockOverlay.mockImplementation(async (_id: string, opts: { includeArchived?: boolean }) => {
      const own = [
        item('livery', 'character', {
          characterId: CHAR_ID,
          archivedAt: '2026-02-02T00:00:00.000Z',
        }),
      ];
      return opts?.includeArchived ? own : own.filter((i) => !i.archivedAt);
    });

    const pool = await repo.findWearablePoolForCharacter(CHAR_ID);

    expect(titlesById(pool)).toEqual({ livery: 'livery (general)' });
  });

  it('short-circuits before touching the project reader when no project mounts are in scope', async () => {
    mockGeneral.mockResolvedValue([item('g-only', 'general')]);

    await repo.findWearablePoolForCharacter(CHAR_ID, { projectMountPointIds: [] });

    expect(mockProject).not.toHaveBeenCalled();
  });

  it('swallows a failing project store and keeps the other tiers', async () => {
    mockGeneral.mockResolvedValue([item('g-only', 'general')]);
    mockOverlay.mockResolvedValue([item('c-only', 'character', { characterId: CHAR_ID })]);
    mockProject.mockImplementation(async (mountPointId: string) => {
      if (mountPointId === 'mp-broken') throw new Error('store offline');
      return [item('p-only', 'project')];
    });

    const pool = await repo.findWearablePoolForCharacter(CHAR_ID, {
      projectMountPointIds: ['mp-broken', 'mp-ok'],
    });

    expect(pool.map((i: { id: string }) => i.id).sort()).toEqual(['c-only', 'g-only', 'p-only']);
  });
});
