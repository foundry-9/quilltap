/**
 * Regression tests for the first-startup seeding gate.
 *
 * Bug 46: `seedInitialData` decided "this is a first startup" from
 * `characters.findByUserId(...).length === 0`. Every `find*` in the repository
 * layer collapses an error into `[]`, so when another instance held the
 * database lock the probe returned empty and a fully-populated instance was
 * sent down the seeding path. The probe now uses `countOrThrow` and fails
 * closed.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/first-startup', () => ({
  getSeedCharacters: jest.fn(() => []),
  prepareSeedCharacter: jest.fn(),
  getSeedEmbeddingProfiles: jest.fn(() => [{ name: 'Built-in TF-IDF' }]),
  prepareSeedEmbeddingProfile: jest.fn((seed: unknown) => seed),
  getSeedImports: jest.fn(() => []),
  getSeedAvatars: jest.fn(() => []),
}));

jest.mock('@/lib/import/quilltap-import-service', () => ({
  executeImport: jest.fn(),
}));

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn(),
  writeCharacterAvatarToVault: jest.fn(),
}));

jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));

jest.mock('@/lib/photos/resolve-character-avatar', () => ({
  resolveCharacterAvatar: jest.fn(),
}));

const { logger } = jest.requireMock('@/lib/logger') as {
  logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
};
const { getRepositories } = jest.requireMock('@/lib/database/repositories') as {
  getRepositories: jest.Mock;
};

const SEEDING_LOG = 'Seeding initial data for first startup';

interface RepoStubOptions {
  characterCount?: number | Error;
  profileCount?: number | Error;
}

function buildRepos({ characterCount = 0, profileCount = 0 }: RepoStubOptions = {}) {
  const resolve = (value: number | Error) =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);

  return {
    roleplayTemplates: {
      seedBuiltInTemplates: jest.fn(async () => undefined),
    },
    characters: {
      countOrThrow: jest.fn(() => resolve(characterCount)),
      // Present so a regression back to the find-based probe is still callable
      // — and therefore detectable by the assertions below.
      findByUserId: jest.fn(async () => []),
      create: jest.fn(),
      findById: jest.fn(),
    },
    embeddingProfiles: {
      countOrThrow: jest.fn(() => resolve(profileCount)),
      findAll: jest.fn(async () => []),
      create: jest.fn(async (data: unknown) => data),
    },
  };
}

async function runSeed() {
  const { seedInitialData } = await import('@/lib/startup/seed-initial-data');
  await seedInitialData();
}

describe('seedInitialData — first-startup probe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not seed when the character probe fails', async () => {
    const repos = buildRepos({
      characterCount: new Error(
        'Another Quilltap instance (Docker container, PID 1 on 2656f2de3f8a) is already using this database',
      ),
    });
    getRepositories.mockReturnValue(repos);

    await runSeed();

    expect(repos.characters.create).not.toHaveBeenCalled();
    expect(repos.embeddingProfiles.create).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(SEEDING_LOG, expect.anything());
    expect(logger.error).toHaveBeenCalledWith(
      'Skipping initial-data seeding — could not determine whether the database is empty',
      expect.objectContaining({ error: expect.stringContaining('already using this database') }),
    );
  });

  it('does not seed when characters already exist', async () => {
    const repos = buildRepos({ characterCount: 24 });
    getRepositories.mockReturnValue(repos);

    await runSeed();

    expect(repos.characters.create).not.toHaveBeenCalled();
    expect(repos.embeddingProfiles.create).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(SEEDING_LOG, expect.anything());
  });

  it('seeds when the database is genuinely empty', async () => {
    const repos = buildRepos({ characterCount: 0, profileCount: 0 });
    getRepositories.mockReturnValue(repos);

    await runSeed();

    expect(logger.info).toHaveBeenCalledWith(SEEDING_LOG, expect.anything());
    expect(repos.embeddingProfiles.create).toHaveBeenCalledTimes(1);
  });

  it('probes emptiness with countOrThrow, never with a fallback-returning find', async () => {
    const repos = buildRepos({ characterCount: 0 });
    getRepositories.mockReturnValue(repos);

    await runSeed();

    expect(repos.characters.countOrThrow).toHaveBeenCalledWith({
      userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    });
    expect(repos.characters.findByUserId).not.toHaveBeenCalled();
    expect(repos.embeddingProfiles.findAll).not.toHaveBeenCalled();
  });

  it('does not seed an embedding profile when its probe fails', async () => {
    const repos = buildRepos({
      characterCount: 0,
      profileCount: new Error('database is locked'),
    });
    getRepositories.mockReturnValue(repos);

    await runSeed();

    expect(repos.embeddingProfiles.create).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Skipping embedding-profile seeding — could not determine whether any profiles exist',
      expect.objectContaining({ error: expect.stringContaining('database is locked') }),
    );
  });
});
