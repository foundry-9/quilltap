/**
 * Unit tests for Version Guard
 *
 * Tests cover:
 * - checkVersionGuard with various version comparisons
 * - storeCurrentVersion upsert behavior
 * - storeCurrentVersion writes minServerVersion to .dbkey files
 * - Fail-open behavior on errors
 * - Semver prerelease comparison edge cases
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// Mocks
// ============================================================================

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

let mockIsSQLiteBackend = jest.fn<() => boolean>();
let mockGetSQLiteDatabase = jest.fn();
let mockSqliteTableExists = jest.fn<(name: string) => boolean>();

jest.mock('@/migrations/lib/database-utils', () => ({
  isSQLiteBackend: (...args: unknown[]) => mockIsSQLiteBackend(),
  getSQLiteDatabase: (...args: unknown[]) => mockGetSQLiteDatabase(),
  sqliteTableExists: (...args: unknown[]) => mockSqliteTableExists(args[0] as string),
}));

// Mock fs for getAppVersion() which reads package.json, and for .dbkey file patching
const mockReadFileSync = jest.fn<(path: string, encoding: string) => string>();
const mockExistsSync = jest.fn<(path: string) => boolean>().mockReturnValue(false);
const mockWriteFileSync = jest.fn();
jest.mock('fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(args[0] as string, args[1] as string),
  existsSync: (...args: unknown[]) => mockExistsSync(args[0] as string),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// Mock dbkey path functions
const MOCK_DBKEY_PATH = '/mock/data/quilltap.dbkey';
jest.mock('@/lib/startup/dbkey', () => ({
  getDbKeyPath: () => MOCK_DBKEY_PATH,
}));

// Bug 65: a guard that cannot tell you it is broken is not a guard. Failures
// are announced through the migration-warnings channel.
const mockAddMigrationWarning = jest.fn<(message: string) => void>();
jest.mock('@/lib/startup/startup-state', () => ({
  startupState: {
    addMigrationWarning: (...args: unknown[]) => mockAddMigrationWarning(args[0] as string),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(storedVersion?: string | null) {
  const mockGet = jest.fn();
  if (storedVersion !== undefined && storedVersion !== null) {
    mockGet.mockReturnValue({ value: storedVersion });
  } else {
    mockGet.mockReturnValue(undefined);
  }

  const mockRun = jest.fn();

  return {
    prepare: jest.fn().mockReturnValue({
      get: mockGet,
      run: mockRun,
    }),
    exec: jest.fn(),
    _mockGet: mockGet,
    _mockRun: mockRun,
  };
}

function setAppVersion(version: string) {
  mockReadFileSync.mockReturnValue(JSON.stringify({ version }));
}

// ============================================================================
// Tests
// ============================================================================

describe('Version Guard', () => {
  let versionGuard: typeof import('@/lib/startup/version-guard');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    // Re-setup mocks after resetModules
    mockIsSQLiteBackend = jest.fn<() => boolean>().mockReturnValue(true);
    mockGetSQLiteDatabase = jest.fn();
    mockSqliteTableExists = jest.fn<(name: string) => boolean>().mockReturnValue(true);

    setAppVersion('3.4.0');

    versionGuard = await import('@/lib/startup/version-guard');
  });

  describe('checkVersionGuard', () => {
    it('should return blocked: false when not SQLite backend', async () => {
      mockIsSQLiteBackend.mockReturnValue(false);

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false when current version is invalid', async () => {
      setAppVersion('not-a-version');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false when version is "unknown"', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('no file'); });

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false when table exists with no stored version row', async () => {
      const db = createMockDb(null);
      mockGetSQLiteDatabase.mockReturnValue(db);
      mockSqliteTableExists.mockReturnValue(true);

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false when current version >= stored version', async () => {
      const db = createMockDb('3.3.0');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.4.0');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false when current version equals stored version', async () => {
      const db = createMockDb('3.4.0');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.4.0');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: true when current version < stored version', async () => {
      const db = createMockDb('3.4.0');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.3.0');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.currentVersion).toBe('3.3.0');
        expect(result.highestVersion).toBe('3.4.0');
      }
    });

    it('should use legacy assumed version when no instance_settings table exists', async () => {
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);
      mockSqliteTableExists.mockReturnValue(false);
      setAppVersion('3.4.0');

      const result = await versionGuard.checkVersionGuard();
      // 3.4.0 > 3.3.0-dev.127, so should not be blocked
      expect(result.blocked).toBe(false);
    });

    it('should block when current is older than legacy assumed version', async () => {
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);
      mockSqliteTableExists.mockReturnValue(false);
      setAppVersion('3.2.0');

      const result = await versionGuard.checkVersionGuard();
      // 3.2.0 < 3.3.0-dev.127, should be blocked
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.highestVersion).toBe('3.3.0-dev.127');
      }
    });

    it('should return blocked: false when stored version is invalid semver', async () => {
      const db = createMockDb('not-valid');
      mockGetSQLiteDatabase.mockReturnValue(db);

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should return blocked: false on any error (fail-open)', async () => {
      mockGetSQLiteDatabase.mockImplementation(() => { throw new Error('db crashed'); });

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    // Bug 65: the guard was inert for a day because its only failure
    // signal was an `error` line in a log nobody reads on a healthy boot.
    it('should announce a migration warning when the guard itself fails', async () => {
      mockGetSQLiteDatabase.mockImplementation(() => { throw new Error('db crashed'); });

      await versionGuard.checkVersionGuard();

      expect(mockAddMigrationWarning).toHaveBeenCalledTimes(1);
      expect(mockAddMigrationWarning.mock.calls[0][0]).toContain('db crashed');
    });

    it('should announce nothing when the guard completes normally', async () => {
      const db = createMockDb('3.3.0');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.4.0');

      await versionGuard.checkVersionGuard();

      expect(mockAddMigrationWarning).not.toHaveBeenCalled();
    });

    // Semver prerelease edge cases
    it('should not block when release trumps prerelease of same version (3.3.0 > 3.3.0-dev.128)', async () => {
      const db = createMockDb('3.3.0-dev.128');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.3.0');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should not block when higher minor prerelease vs lower release (3.4.0-dev.1 > 3.3.0)', async () => {
      const db = createMockDb('3.3.0');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.4.0-dev.1');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });

    it('should block when prerelease < release of same version (3.3.0-dev.128 < 3.3.0)', async () => {
      const db = createMockDb('3.3.0');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.3.0-dev.128');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(true);
    });

    it('should not block for higher prerelease number (3.3.0-dev.128 > 3.3.0-dev.38)', async () => {
      const db = createMockDb('3.3.0-dev.38');
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.3.0-dev.128');

      const result = await versionGuard.checkVersionGuard();
      expect(result.blocked).toBe(false);
    });
  });

  // Bug 65: `migrations/lib/database-utils` is an async module in the bundler's
  // server graph, and a synchronous `require()` of one returns an exports object
  // whose body never ran — so every call throws and the guard fails open in
  // silence. Jest resolves modules synchronously and cannot reproduce that, so
  // the regression is pinned at the source level instead.
  describe('async module access', () => {
    it('should never reach the migration utilities with a synchronous require', () => {
      const realFs = jest.requireActual<typeof import('fs')>('fs');
      const source = realFs.readFileSync(
        `${process.cwd()}/lib/startup/version-guard.ts`,
        'utf-8'
      );

      expect(source).not.toMatch(/[^.]\brequire\(\s*['"]@\/migrations/);
      expect(source).toMatch(/await import\(\s*'@\/migrations\/lib\/database-utils'\s*\)/);
    });

    it('should expose both entry points as async functions', () => {
      expect(versionGuard.checkVersionGuard.constructor.name).toBe('AsyncFunction');
      expect(versionGuard.storeCurrentVersion.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('storeCurrentVersion', () => {
    it('should skip when not SQLite backend', async () => {
      mockIsSQLiteBackend.mockReturnValue(false);
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);

      await versionGuard.storeCurrentVersion();

      expect(db.prepare).not.toHaveBeenCalled();
    });

    it('should skip when version is invalid', async () => {
      setAppVersion('not-valid');
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);

      await versionGuard.storeCurrentVersion();

      expect(db.prepare).not.toHaveBeenCalled();
    });

    it('should create table if it does not exist and store version', async () => {
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);
      mockSqliteTableExists.mockReturnValue(false);
      setAppVersion('3.4.0');

      await versionGuard.storeCurrentVersion();

      expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS'));
      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'));
    });

    it('should use INSERT ... ON CONFLICT to upsert', async () => {
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.4.0');

      await versionGuard.storeCurrentVersion();

      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'));
    });

    // Bug 65: assert the EFFECT, not the absence of a throw. The previous
    // suite would have passed against a guard that wrote nothing at all.
    it('should write highest_app_version with the running version', async () => {
      const db = createMockDb();
      mockGetSQLiteDatabase.mockReturnValue(db);
      setAppVersion('3.4.0');

      await versionGuard.storeCurrentVersion();

      expect(db._mockRun).toHaveBeenCalledWith('highest_app_version', '3.4.0');
    });

    it('should not throw on error', async () => {
      mockGetSQLiteDatabase.mockImplementation(() => { throw new Error('db error'); });

      await expect(versionGuard.storeCurrentVersion()).resolves.toBeUndefined();
    });

    it('should announce a migration warning when storing fails', async () => {
      mockGetSQLiteDatabase.mockImplementation(() => { throw new Error('db error'); });

      await versionGuard.storeCurrentVersion();

      expect(mockAddMigrationWarning).toHaveBeenCalledTimes(1);
      expect(mockAddMigrationWarning.mock.calls[0][0]).toContain('db error');
    });

    describe('minServerVersion in .dbkey files', () => {
      let db: ReturnType<typeof createMockDb>;

      beforeEach(() => {
        db = createMockDb();
        mockGetSQLiteDatabase.mockReturnValue(db);
        setAppVersion('3.4.0');
        mockExistsSync.mockReturnValue(false);
        mockWriteFileSync.mockClear();
      });

      it('should write minServerVersion to both .dbkey files when they exist', async () => {
        const existingDbKey = { version: 1, algorithm: 'aes-256-gcm', salt: 'abc' };
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockImplementation((filePath: string) => {
          if (filePath.endsWith('.dbkey')) {
            return JSON.stringify(existingDbKey);
          }
          // package.json
          return JSON.stringify({ version: '3.4.0' });
        });

        await versionGuard.storeCurrentVersion();

        // Bug 60: one pepper, one .dbkey file — the version stamp goes to it and
        // nowhere else. The former second write to quilltap-llm-logs.dbkey kept
        // a file alive that nothing ever read.
        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

        const [mainPath, mainContent, mainOpts] = mockWriteFileSync.mock.calls[0];
        expect(mainPath).toBe(MOCK_DBKEY_PATH);
        const mainData = JSON.parse(mainContent as string);
        expect(mainData.minServerVersion).toBe('3.4.0');
        expect(mainData.version).toBe(1);
        expect(mainData.algorithm).toBe('aes-256-gcm');
        expect((mainOpts as { mode: number }).mode).toBe(0o600);
      });

      it('should skip .dbkey files that do not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        await versionGuard.storeCurrentVersion();

        expect(mockWriteFileSync).not.toHaveBeenCalled();
      });

      it('should update minServerVersion when one already exists', async () => {
        const existingDbKey = { version: 1, minServerVersion: '3.3.0', salt: 'abc' };
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockImplementation((filePath: string) => {
          if (filePath.endsWith('.dbkey')) {
            return JSON.stringify(existingDbKey);
          }
          return JSON.stringify({ version: '3.4.0' });
        });

        await versionGuard.storeCurrentVersion();

        const [, mainContent] = mockWriteFileSync.mock.calls[0];
        const mainData = JSON.parse(mainContent as string);
        expect(mainData.minServerVersion).toBe('3.4.0');
      });

      it('should not throw when .dbkey write fails', async () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockImplementation((filePath: string) => {
          if (filePath.endsWith('.dbkey')) {
            return JSON.stringify({ version: 1 });
          }
          return JSON.stringify({ version: '3.4.0' });
        });
        mockWriteFileSync.mockImplementation(() => { throw new Error('disk full'); });

        await expect(versionGuard.storeCurrentVersion()).resolves.toBeUndefined();
      });

      it('should handle only main .dbkey existing but not LLM logs', async () => {
        mockExistsSync.mockImplementation((filePath: string) => filePath === MOCK_DBKEY_PATH);
        mockReadFileSync.mockImplementation((filePath: string) => {
          if (filePath === MOCK_DBKEY_PATH) {
            return JSON.stringify({ version: 1 });
          }
          return JSON.stringify({ version: '3.4.0' });
        });

        await versionGuard.storeCurrentVersion();

        // Only the main .dbkey should be written
        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
        expect(mockWriteFileSync.mock.calls[0][0]).toBe(MOCK_DBKEY_PATH);
      });
    });
  });
});
