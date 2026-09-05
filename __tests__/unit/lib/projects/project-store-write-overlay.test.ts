/**
 * Unit tests for the project-store WRITE overlay's read-modify-write of
 * `properties.json`.
 *
 * The regression under guard: `readProperties` used to swallow every error and
 * return null, and the write overlay read null as "no file yet, seed from the
 * raw row". Post-cutover that row carries no property values, so one transient
 * store failure silently reset a project's whole settings bag to schema
 * defaults — and because the no-default optionals then serialize to nothing,
 * the loss was invisible in the file and compounded on every later write.
 *
 * A store that exists but can't be read or parsed must now THROW. Only a
 * genuinely absent `properties.json` may seed from defaults.
 */

import { applyProjectStoreWriteOverlay } from '@/lib/projects/project-store/write-overlay';
import { getRepositories } from '@/lib/repositories/factory';
import {
  readDatabaseDocumentIfExists,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { ProjectStoreUnavailableError } from '@/lib/projects/project-store/schema';
import type { Project } from '@/lib/schemas/project.types';

jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/mount-index/database-store', () => ({
  ...jest.requireActual('@/lib/mount-index/database-store'),
  readDatabaseDocumentIfExists: jest.fn(),
  writeDatabaseDocument: jest.fn(),
}));

const mockGetRepositories = jest.mocked(getRepositories);
const mockRead = jest.mocked(readDatabaseDocumentIfExists);
const mockWrite = jest.mocked(writeDatabaseDocument);

const MOUNT = 'm1';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const CHAR_UUID = '11111111-1111-4111-8111-111111111111';
const PROFILE_UUID = '44444444-4444-4444-8444-444444444444';

/** The slim post-cutover row: no property values live here any more. */
function rawRow(): Project {
  return {
    id: PROJECT_ID,
    name: 'The Estate',
    officialMountPointId: MOUNT,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Project;
}

/** A fully-populated properties.json, as a healthy project has on disk. */
const STORED_PROPERTIES = {
  allowAnyCharacter: false,
  characterRoster: [CHAR_UUID],
  color: '#ff8800',
  icon: 'estate',
  defaultDisabledTools: [],
  defaultDisabledToolGroups: [],
  defaultImageProfileId: PROFILE_UUID,
  defaultAlertCharactersOfLanternImages: true,
  backgroundDisplayMode: 'theme',
};

function mockRepos(): void {
  mockGetRepositories.mockReturnValue({
    projects: { findByIdRaw: jest.fn(async () => rawRow()) },
  } as unknown as ReturnType<typeof getRepositories>);
}

/** The JSON body handed to the last writeDatabaseDocument call. */
function lastWrittenProperties(): Record<string, unknown> {
  const calls = mockWrite.mock.calls.filter((c) => c[1] === 'properties.json');
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse(calls[calls.length - 1][2] as string) as Record<string, unknown>;
}

describe('applyProjectStoreWriteOverlay — properties read-modify-write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepos();
    mockWrite.mockResolvedValue({ mtime: 0 });
  });

  it('preserves untouched keys when the patch names a single property', async () => {
    mockRead.mockResolvedValue(JSON.stringify(STORED_PROPERTIES));

    await applyProjectStoreWriteOverlay(PROJECT_ID, {
      answerConfirmationOverride: 'ON',
    } as Partial<Project>);

    const written = lastWrittenProperties();
    expect(written.answerConfirmationOverride).toBe('ON');
    expect(written.defaultAlertCharactersOfLanternImages).toBe(true);
    expect(written.characterRoster).toEqual([CHAR_UUID]);
    expect(written.color).toBe('#ff8800');
    expect(written.defaultImageProfileId).toBe(PROFILE_UUID);
  });

  it('throws and writes nothing when properties.json exists but is unreadable', async () => {
    mockRead.mockRejectedValue(new Error('mount index unavailable'));

    await expect(
      applyProjectStoreWriteOverlay(PROJECT_ID, {
        answerConfirmationOverride: 'ON',
      } as Partial<Project>),
    ).rejects.toBeInstanceOf(ProjectStoreUnavailableError);

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('throws and writes nothing when properties.json is unparseable', async () => {
    mockRead.mockResolvedValue('{ not json');

    await expect(
      applyProjectStoreWriteOverlay(PROJECT_ID, {
        answerConfirmationOverride: 'ON',
      } as Partial<Project>),
    ).rejects.toBeInstanceOf(ProjectStoreUnavailableError);

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('throws and writes nothing when the stored body fails schema validation', async () => {
    mockRead.mockResolvedValue(JSON.stringify({ ...STORED_PROPERTIES, defaultImageProfileId: 'not-a-uuid' }));

    await expect(
      applyProjectStoreWriteOverlay(PROJECT_ID, {
        answerConfirmationOverride: 'ON',
      } as Partial<Project>),
    ).rejects.toBeInstanceOf(ProjectStoreUnavailableError);

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('seeds from defaults only when properties.json is genuinely absent', async () => {
    mockRead.mockResolvedValue(null);

    await applyProjectStoreWriteOverlay(PROJECT_ID, {
      answerConfirmationOverride: 'ON',
    } as Partial<Project>);

    const written = lastWrittenProperties();
    expect(written.answerConfirmationOverride).toBe('ON');
    expect(written.characterRoster).toEqual([]);
    expect(written.backgroundDisplayMode).toBe('theme');
  });

  it('normalizes a retired background display mode on the way to disk', async () => {
    // A pre-4.9 .qtap import or backup restore can hand us 'project'/'static'.
    // Writes route through ProjectPropertiesSchema.parse, so the retired value
    // must land on disk already coerced rather than being persisted afresh.
    mockRead.mockResolvedValue(JSON.stringify(STORED_PROPERTIES));

    await applyProjectStoreWriteOverlay(PROJECT_ID, {
      backgroundDisplayMode: 'static',
    } as unknown as Partial<Project>);

    expect(lastWrittenProperties().backgroundDisplayMode).toBe('theme');
  });

  it('strips store-resident keys from the DB-bound patch', async () => {
    mockRead.mockResolvedValue(JSON.stringify(STORED_PROPERTIES));

    const dbPatch = await applyProjectStoreWriteOverlay(PROJECT_ID, {
      name: 'Renamed',
      answerConfirmationOverride: 'ON',
    } as Partial<Project>);

    expect(dbPatch).toEqual({ name: 'Renamed' });
  });
});
