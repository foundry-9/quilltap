/**
 * Unit tests for the cutover-projects-to-store migration's legacy-row mapper.
 *
 * Focus: the coercion of the raw, pre-cutover `projects` columns (INTEGER
 * booleans, JSON-string arrays/object) back into the JS types the store writer
 * (`ProjectPropertiesSchema.parse`) expects, plus safe fallbacks on malformed
 * JSON. The mapper is pure, so the runtime-only deps are stubbed just to keep
 * importing the module light.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Stub the runtime-only deps the migration module imports so importing the
// module under test doesn't drag the world in — we only exercise the mapper.
jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  getSQLiteDatabase: () => ({}),
  sqliteTableExists: () => true,
  getSQLiteTableColumns: () => [],
}));
const mockFindById = jest.fn();
jest.mock('../../../../../lib/repositories/factory', () => ({
  getRepositories: () => ({ docMountPoints: { findById: mockFindById, findAll: jest.fn(), create: jest.fn() } }),
}));
jest.mock('../../../../../lib/mount-index/project-store-naming', () => ({
  PROJECT_OWN_STORE_NAME_PREFIX: 'Project Files: ',
}));
jest.mock('../../../../../lib/projects/project-store/write-overlay', () => ({
  writeProjectStoreManagedFields: jest.fn(),
}));
jest.mock('../../../../../lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
}));

describe('mapLegacyProjectRow', () => {
  let mapLegacyProjectRow: typeof import('@/migrations/scripts/cutover-projects-to-store').mapLegacyProjectRow;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ mapLegacyProjectRow } = await import('@/migrations/scripts/cutover-projects-to-store'));
  });

  it('passes through the slim row fields verbatim', () => {
    const p = mapLegacyProjectRow({
      id: 'proj-1',
      name: 'Atlas',
      officialMountPointId: 'mount-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
    expect(p.id).toBe('proj-1');
    expect(p.name).toBe('Atlas');
    expect(p.officialMountPointId).toBe('mount-1');
    expect(p.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(p.updatedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('coerces INTEGER booleans into JS booleans', () => {
    expect(mapLegacyProjectRow({ id: 'a', name: 'A', allowAnyCharacter: 1 }).allowAnyCharacter).toBe(true);
    expect(mapLegacyProjectRow({ id: 'b', name: 'B', allowAnyCharacter: 0 }).allowAnyCharacter).toBe(false);
    // Missing → defaults to false (not nullable).
    expect(mapLegacyProjectRow({ id: 'c', name: 'C' }).allowAnyCharacter).toBe(false);
  });

  it('maps tri-state INTEGER columns to boolean|null', () => {
    expect(mapLegacyProjectRow({ id: 'a', name: 'A', defaultAgentModeEnabled: 1 }).defaultAgentModeEnabled).toBe(true);
    expect(mapLegacyProjectRow({ id: 'b', name: 'B', defaultAgentModeEnabled: 0 }).defaultAgentModeEnabled).toBe(false);
    expect(mapLegacyProjectRow({ id: 'c', name: 'C', defaultAgentModeEnabled: null }).defaultAgentModeEnabled).toBeNull();
    expect(mapLegacyProjectRow({ id: 'd', name: 'D' }).storyBackgroundsEnabled).toBeNull();
  });

  it('parses the legacy JSON columns the store writer reads', () => {
    const p = mapLegacyProjectRow({
      id: 'a',
      name: 'JSONy',
      characterRoster: JSON.stringify(['char-1', 'char-2']),
      defaultDisabledTools: JSON.stringify(['tool-a']),
      defaultDisabledToolGroups: JSON.stringify(['plugin:mcp']),
      state: JSON.stringify({ turn: 3, score: 10 }),
    });
    expect(p.characterRoster).toEqual(['char-1', 'char-2']);
    expect(p.defaultDisabledTools).toEqual(['tool-a']);
    expect(p.defaultDisabledToolGroups).toEqual(['plugin:mcp']);
    expect(p.state).toEqual({ turn: 3, score: 10 });
  });

  it('falls back safely on malformed/absent JSON instead of throwing', () => {
    const p = mapLegacyProjectRow({
      id: 'a',
      name: 'Broken',
      characterRoster: '{not json',
      defaultDisabledTools: undefined,
      state: 'also not json',
    });
    expect(p.characterRoster).toEqual([]);
    expect(p.defaultDisabledTools).toEqual([]);
    expect(p.state).toEqual({});
  });

  it('defaults backgroundDisplayMode to theme and nullable string fields to null', () => {
    const p = mapLegacyProjectRow({ id: 'a', name: 'A' });
    expect(p.backgroundDisplayMode).toBe('theme');
    expect(p.description).toBeNull();
    expect(p.instructions).toBeNull();
    expect(p.color).toBeNull();
    expect(p.icon).toBeNull();
    expect(p.defaultImageProfileId).toBeNull();
    expect(p.officialMountPointId).toBeNull();
  });

  it('preserves an explicit backgroundDisplayMode', () => {
    expect(mapLegacyProjectRow({ id: 'a', name: 'A', backgroundDisplayMode: 'latest_chat' }).backgroundDisplayMode).toBe('latest_chat');
  });

  it('normalizes the modes retired in 4.9 to theme', () => {
    for (const retired of ['project', 'static']) {
      expect(
        mapLegacyProjectRow({ id: 'a', name: 'A', backgroundDisplayMode: retired }).backgroundDisplayMode
      ).toBe('theme');
    }
  });
});

describe('resolveStoreForLegacyProject', () => {
  let resolveStoreForLegacyProject: typeof import('@/migrations/scripts/cutover-projects-to-store').resolveStoreForLegacyProject;

  beforeEach(async () => {
    jest.clearAllMocks();
    ({ resolveStoreForLegacyProject } = await import('@/migrations/scripts/cutover-projects-to-store'));
  });

  it('trusts an existing officialMountPointId without re-reading the project or probing the mount', async () => {
    const project = { id: 'p1', name: 'Church', officialMountPointId: 'mp-existing' } as never;
    const result = await resolveStoreForLegacyProject(project);
    expect(result).toBe('mp-existing');
    // Critical: it must NOT probe the mount point (a validating read that can
    // mis-validate mid-migration and trigger a duplicate store).
    expect(mockFindById).not.toHaveBeenCalled();
  });
});
