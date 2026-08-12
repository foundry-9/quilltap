/**
 * Regression tests for the migration runner's instance-lock gate.
 *
 * Bug 45: `getSQLiteDatabase()` opened the database with a bare
 * `new Database(dbPath)` and no lock acquisition, while every repository-layer
 * connection went through `acquireInstanceLock`. Migrations are the heaviest
 * writers in the codebase, so the one path that skipped the gate was the one
 * most able to corrupt a WAL shared with another live process.
 */

class MockInstanceLockError extends Error {
  constructor(
    public lockInfo: {
      pid: number;
      hostname: string;
      startedAt: string;
      environment: string;
    },
    public lockPath: string,
  ) {
    super('Another Quilltap instance is already using this database');
    this.name = 'InstanceLockError';
  }
}

jest.mock('@/migrations/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/lib/database/backends/sqlite/instance-lock', () => ({
  acquireInstanceLock: jest.fn(),
  InstanceLockError: MockInstanceLockError,
}));

jest.mock('@/lib/paths', () => ({
  getSQLiteDatabasePath: jest.fn(() => '/tmp/quilltap-test/data/quilltap.db'),
  getDataDir: jest.fn(() => '/tmp/quilltap-test/data'),
  getInstanceLockPath: jest.fn(() => '/tmp/quilltap-test/data/quilltap.lock'),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
}));

const openedPaths: string[] = [];

jest.mock('better-sqlite3', () => {
  return jest.fn().mockImplementation((dbPath: string) => {
    openedPaths.push(dbPath);
    return {
      pragma: jest.fn(),
      prepare: jest.fn(),
      close: jest.fn(),
    };
  });
});

/**
 * `jest.resetModules()` gives every test a fresh module registry — including
 * fresh copies of the mocks — so handles must be taken from the current
 * generation rather than captured once at file scope.
 */
async function loadSubject() {
  const { acquireInstanceLock } = jest.requireMock(
    '@/lib/database/backends/sqlite/instance-lock',
  ) as { acquireInstanceLock: jest.Mock };
  const { logger } = jest.requireMock('@/migrations/lib/logger') as {
    logger: { error: jest.Mock };
  };
  const DatabaseCtor = jest.requireMock('better-sqlite3') as unknown as jest.Mock;
  const { getSQLiteDatabase } = await import('@/migrations/lib/database-utils');

  return { acquireInstanceLock, logger, DatabaseCtor, getSQLiteDatabase };
}

describe('migrations getSQLiteDatabase — instance lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    openedPaths.length = 0;
  });

  it('acquires the instance lock before opening the database', async () => {
    const { acquireInstanceLock, DatabaseCtor, getSQLiteDatabase } = await loadSubject();

    getSQLiteDatabase();

    expect(acquireInstanceLock).toHaveBeenCalledWith('/tmp/quilltap-test/data/quilltap.lock');
    expect(openedPaths).toEqual(['/tmp/quilltap-test/data/quilltap.db']);

    const lockOrder = acquireInstanceLock.mock.invocationCallOrder[0];
    const openOrder = DatabaseCtor.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(openOrder);
  });

  it('refuses to open the database when another instance holds the lock', async () => {
    const { acquireInstanceLock, logger, getSQLiteDatabase } = await loadSubject();

    acquireInstanceLock.mockImplementation(() => {
      throw new MockInstanceLockError(
        {
          pid: 1,
          hostname: '2656f2de3f8a',
          startedAt: '2026-08-12T20:28:57.017Z',
          environment: 'docker',
        },
        '/tmp/quilltap-test/data/quilltap.lock',
      );
    });

    expect(() => getSQLiteDatabase()).toThrow(MockInstanceLockError);
    expect(openedPaths).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'Cannot run migrations: another instance holds the database lock',
      expect.objectContaining({ conflictPid: 1, conflictEnvironment: 'docker' }),
    );
  });
});
