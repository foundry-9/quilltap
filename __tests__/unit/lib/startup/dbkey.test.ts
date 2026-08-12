/**
 * Unit tests for lib/startup/dbkey.ts
 *
 * Tests the filesystem-based database key manager that replaced the
 * SQLite-based pepper-vault. Uses in-memory filesystem mocking to avoid
 * real disk I/O while allowing real crypto operations.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// In-memory filesystem store - persists across resetModules since it lives
// in test scope. Cleared in beforeEach.
let mockFiles: Record<string, string> = {};

// Store original env
const originalEnv = { ...process.env };

function createFsMock() {
  return {
    existsSync: jest.fn((p: string) => p in mockFiles),
    readFileSync: jest.fn((p: string) => {
      if (!(p in mockFiles)) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      return mockFiles[p];
    }),
    writeFileSync: jest.fn((p: string, content: string | Buffer) => {
      mockFiles[p] = typeof content === 'string' ? content : content.toString();
    }),
    mkdirSync: jest.fn(),
  };
}

function createLoggerMock() {
  const mockLogger: Record<string, jest.Mock> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return { logger: mockLogger };
}

jest.mock('fs', () => createFsMock());
jest.mock('@/lib/paths', () => ({ getDataDir: jest.fn(() => '/mock/data') }));
jest.mock('../../../../migrations/lib/logger', () => createLoggerMock());

async function importDbKey() {
  jest.resetModules();
  jest.mock('fs', () => createFsMock());
  jest.mock('@/lib/paths', () => ({ getDataDir: jest.fn(() => '/mock/data') }));
  jest.mock('../../../../migrations/lib/logger', () => createLoggerMock());
  return await import('@/lib/startup/dbkey');
}

const MOCK_DBKEY_PATH = '/mock/data/quilltap.dbkey';
const MOCK_LLM_DBKEY_PATH = '/mock/data/quilltap-llm-logs.dbkey';

describe('Database Key Manager (dbkey)', () => {
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    mockFiles = {};
    process.env = { ...originalEnv };
    delete process.env.ENCRYPTION_MASTER_PEPPER;

    if ('__quilltapDbKeyState' in global) {
      delete (global as Record<string, unknown>).__quilltapDbKeyState;
    }
    if ('__quilltapHasUserPassphrase' in global) {
      delete (global as Record<string, unknown>).__quilltapHasUserPassphrase;
    }
    if ('__quilltapRuntimePassphrase' in global) {
      delete (global as Record<string, unknown>).__quilltapRuntimePassphrase;
    }

    mockExit = jest.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error(`process.exit called with code ${_code}`);
    });
  });

  afterEach(() => {
    mockExit.mockRestore();
    process.env = originalEnv;
  });

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  describe('getDbKeyPath() / getLLMLogsDbKeyPath()', () => {
    it('returns the path to quilltap.dbkey under getDataDir()', async () => {
      const { getDbKeyPath } = await importDbKey();
      expect(getDbKeyPath()).toBe(MOCK_DBKEY_PATH);
    });

    it('returns the path to quilltap-llm-logs.dbkey under getDataDir()', async () => {
      const { getLLMLogsDbKeyPath } = await importDbKey();
      expect(getLLMLogsDbKeyPath()).toBe(MOCK_LLM_DBKEY_PATH);
    });
  });

  // ---------------------------------------------------------------------------
  // Crypto primitives via setupDbKey roundtrip
  // ---------------------------------------------------------------------------

  describe('Crypto primitives (via setupDbKey roundtrip)', () => {
    it('should generate and store a pepper successfully without a passphrase', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      expect(dbkey.getDbKeyState()).toBe('needs-setup');

      const result = dbkey.setupDbKey('');
      expect(result).toHaveProperty('pepper');
      expect(typeof result.pepper).toBe('string');
      expect(result.pepper).toHaveLength(44);

      // The .dbkey file should have been written
      expect(MOCK_DBKEY_PATH in mockFiles).toBe(true);

      const stored = JSON.parse(mockFiles[MOCK_DBKEY_PATH]);
      expect(stored).toHaveProperty('ciphertext');
      expect(stored).toHaveProperty('iv');
      expect(stored).toHaveProperty('authTag');
      expect(stored).toHaveProperty('pepperHash');
      expect(stored).not.toHaveProperty('hasPassphrase');
      expect(stored.version).toBe(1);
      expect(stored.algorithm).toBe('aes-256-gcm');
      expect(stored.kdf).toBe('pbkdf2');
      expect(stored.kdfIterations).toBe(600000);
    });

    it('should setup with a passphrase and produce a valid .dbkey file', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();

      const result = dbkey.setupDbKey('my-secret-passphrase');
      expect(result.pepper).toHaveLength(44);

      const stored = JSON.parse(mockFiles[MOCK_DBKEY_PATH]);
      expect(stored).not.toHaveProperty('hasPassphrase');
      expect(stored).toHaveProperty('pepperHash');
    });
  });

  // ---------------------------------------------------------------------------
  // provisionDbKey()
  // ---------------------------------------------------------------------------

  describe('provisionDbKey()', () => {
    it('sets state to needs-setup when no env var and no .dbkey file', async () => {
      const dbkey = await importDbKey();
      const state = await dbkey.provisionDbKey();
      expect(state).toBe('needs-setup');
      expect(dbkey.getDbKeyState()).toBe('needs-setup');
    });

    it('sets state to needs-vault-storage when env var is set but no .dbkey file exists', async () => {
      process.env.ENCRYPTION_MASTER_PEPPER = 'a'.repeat(44);
      const dbkey = await importDbKey();
      const state = await dbkey.provisionDbKey();
      expect(state).toBe('needs-vault-storage');
    });

    it('sets state to resolved when env var matches stored hash in .dbkey', async () => {
      // First, set up a pepper
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      const result = dbkey.setupDbKey('');

      // Simulate restart with same pepper in env
      process.env.ENCRYPTION_MASTER_PEPPER = result.pepper;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      const state = await dbkey2.provisionDbKey();
      expect(state).toBe('resolved');
    });

    it('calls process.exit(1) when env var does not match stored hash', async () => {
      // Set up a pepper
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('');

      // Set a DIFFERENT pepper in env
      process.env.ENCRYPTION_MASTER_PEPPER = 'completely-different-pepper-value-that-is-long';
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();
      // process.exit(1) is called inside the try block, but the catch swallows
      // the error thrown by our mock. Check that exit was called.
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('sets state to needs-passphrase when .dbkey has passphrase and no env var', async () => {
      // Set up with passphrase
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('my-passphrase');

      // Simulate restart without env var
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      const state = await dbkey2.provisionDbKey();
      expect(state).toBe('needs-passphrase');
    });

    it('auto-resolves when .dbkey exists with no passphrase and no env var', async () => {
      // Set up without passphrase
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      const result = dbkey.setupDbKey('');

      // Simulate restart without env var
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      const state = await dbkey2.provisionDbKey();
      expect(state).toBe('resolved');
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(result.pepper);
    });
  });

  // ---------------------------------------------------------------------------
  // getHasUserPassphrase()
  // ---------------------------------------------------------------------------

  describe('getHasUserPassphrase()', () => {
    it('returns true after unlocking with a user passphrase', async () => {
      const passphrase = 'test-passphrase';
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey(passphrase);

      // Simulate restart
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;
      delete (global as Record<string, unknown>).__quilltapHasUserPassphrase;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();
      expect(dbkey2.getHasUserPassphrase()).toBe(true);
    });

    it('returns false when no passphrase was set', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('');

      // Simulate restart
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;
      delete (global as Record<string, unknown>).__quilltapHasUserPassphrase;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();
      expect(dbkey2.getHasUserPassphrase()).toBe(false);
    });

    it('preserves hasUserPassphrase=true when provisionDbKey re-runs after unlock', async () => {
      // This tests the bug fix: after unlockDbKey() sets hasUserPassphrase=true,
      // a subsequent provisionDbKey() (triggered by register() re-init) must not
      // overwrite it to false when it sees the env pepper matching the .dbkey hash.
      const passphrase = 'my-secret';
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey(passphrase);

      // Simulate restart without env var (passphrase required)
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;
      delete (global as Record<string, unknown>).__quilltapHasUserPassphrase;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();
      expect(dbkey2.getDbKeyState()).toBe('needs-passphrase');

      // Unlock sets pepper in env and hasUserPassphrase=true
      const success = dbkey2.unlockDbKey(passphrase);
      expect(success).toBe(true);
      expect(dbkey2.getHasUserPassphrase()).toBe(true);

      // Simulate register() re-running provisionDbKey after unlock
      // (pepper is now in process.env, .dbkey file exists)
      delete (global as Record<string, unknown>).__quilltapDbKeyState;
      // Note: do NOT clear __quilltapHasUserPassphrase — that's the point of the test

      const dbkey3 = await importDbKey();
      const state = await dbkey3.provisionDbKey();
      expect(state).toBe('resolved');

      // The critical assertion: hasUserPassphrase must still be true
      expect(dbkey3.getHasUserPassphrase()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // setupDbKey()
  // ---------------------------------------------------------------------------

  describe('setupDbKey()', () => {
    it('throws if not in needs-setup state', async () => {
      process.env.ENCRYPTION_MASTER_PEPPER = 'a'.repeat(44);
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey(); // needs-vault-storage

      expect(() => dbkey.setupDbKey('')).toThrow('Cannot setup database key in state');
    });

    it('generates a base64 pepper of 44 characters (32 bytes)', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();

      const { pepper } = dbkey.setupDbKey('');
      expect(pepper).toHaveLength(44);
      expect(Buffer.from(pepper, 'base64').length).toBe(32);
    });

    it('sets pepper in process.env', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();

      const { pepper } = dbkey.setupDbKey('');
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(pepper);
    });
  });

  // ---------------------------------------------------------------------------
  // unlockDbKey()
  // ---------------------------------------------------------------------------

  describe('unlockDbKey()', () => {
    it('unlocks with the correct passphrase', async () => {
      const passphrase = 'correct-horse-battery-staple';
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      const result = dbkey.setupDbKey(passphrase);
      const expectedPepper = result.pepper;

      // Simulate restart
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();
      expect(dbkey2.getDbKeyState()).toBe('needs-passphrase');

      const success = dbkey2.unlockDbKey(passphrase);
      expect(success).toBe(true);
      expect(dbkey2.getDbKeyState()).toBe('resolved');
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(expectedPepper);
    });

    it('returns false with the wrong passphrase', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('correct-passphrase');

      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();

      const success = dbkey2.unlockDbKey('wrong-passphrase');
      expect(success).toBe(false);
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBeUndefined();
    });

    it('throws if not in needs-passphrase state', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey(); // needs-setup

      expect(() => dbkey.unlockDbKey('anything')).toThrow('Cannot unlock database key in state');
    });
  });

  // ---------------------------------------------------------------------------
  // storeEnvPepperInDbKey()
  // ---------------------------------------------------------------------------

  describe('storeEnvPepperInDbKey()', () => {
    it('stores env pepper with a passphrase', async () => {
      process.env.ENCRYPTION_MASTER_PEPPER = 'a'.repeat(44);
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      expect(dbkey.getDbKeyState()).toBe('needs-vault-storage');

      dbkey.storeEnvPepperInDbKey('vault-passphrase');

      expect(dbkey.getDbKeyState()).toBe('resolved');
      expect(MOCK_DBKEY_PATH in mockFiles).toBe(true);

      const stored = JSON.parse(mockFiles[MOCK_DBKEY_PATH]);
      expect(stored).not.toHaveProperty('hasPassphrase');
    });

    it('stores env pepper without a passphrase', async () => {
      process.env.ENCRYPTION_MASTER_PEPPER = 'b'.repeat(44);
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();

      dbkey.storeEnvPepperInDbKey('');

      expect(dbkey.getDbKeyState()).toBe('resolved');
      const stored = JSON.parse(mockFiles[MOCK_DBKEY_PATH]);
      expect(stored).not.toHaveProperty('hasPassphrase');
    });

    it('throws if not in needs-vault-storage state', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey(); // needs-setup

      expect(() => dbkey.storeEnvPepperInDbKey('')).toThrow('Cannot store pepper in .dbkey file in state');
    });
  });

  // ---------------------------------------------------------------------------
  // getDbKeyState()
  // ---------------------------------------------------------------------------

  describe('getDbKeyState()', () => {
    it('reflects state changes through the full lifecycle', async () => {
      const dbkey = await importDbKey();

      // After provisioning with no config
      await dbkey.provisionDbKey();
      expect(dbkey.getDbKeyState()).toBe('needs-setup');

      // After setup with passphrase → resolved
      dbkey.setupDbKey('lifecycle-test');
      expect(dbkey.getDbKeyState()).toBe('resolved');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple provision calls
  // ---------------------------------------------------------------------------

  describe('Multiple provisionDbKey calls', () => {
    it('handles multiple provisionDbKey calls safely', async () => {
      const dbkey = await importDbKey();

      const state1 = await dbkey.provisionDbKey();
      expect(state1).toBe('needs-setup');

      // Calling again should not error and should return same state
      const state2 = await dbkey.provisionDbKey();
      expect(state2).toBe('needs-setup');
    });

    it('does not re-write the .dbkey file on second provision call', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('');

      // Record content after setup
      const contentAfterSetup = mockFiles[MOCK_DBKEY_PATH];

      // Simulate restart and re-provision (auto-resolve, no passphrase)
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();

      // File should not have been overwritten
      expect(mockFiles[MOCK_DBKEY_PATH]).toBe(contentAfterSetup);
    });
  });

  describe('runtime passphrase cache (archive encryption, §4.2c)', () => {
    // Archive bundles are encrypted under the passphrase, which only ever
    // passes through this module — each chokepoint must deposit it in the
    // runtime cache, and locking must clear it.

    function cachedPassphrase(): string | undefined {
      return (global as Record<string, unknown>).__quilltapRuntimePassphrase as
        | string
        | undefined;
    }

    it('setupDbKey caches the effective passphrase (sentinel when none)', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('');

      expect(cachedPassphrase()).toBe(dbkey.INTERNAL_PASSPHRASE);
    });

    it('unlockDbKey caches the passphrase it just proved', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('my-secret');

      // Simulate a restart with a passphrase-protected key.
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      delete (global as Record<string, unknown>).__quilltapDbKeyState;
      delete (global as Record<string, unknown>).__quilltapHasUserPassphrase;
      delete (global as Record<string, unknown>).__quilltapRuntimePassphrase;

      const dbkey2 = await importDbKey();
      await dbkey2.provisionDbKey();
      expect(cachedPassphrase()).toBeUndefined();
      expect(dbkey2.unlockDbKey('my-secret')).toBe(true);

      expect(cachedPassphrase()).toBe('my-secret');
    });

    it('changePassphrase caches the new effective passphrase', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('old-secret');

      const result = dbkey.changePassphrase('old-secret', 'new-secret');

      expect(result.success).toBe(true);
      expect(cachedPassphrase()).toBe('new-secret');
    });

    it('lockDbKey clears the cached passphrase alongside the pepper', async () => {
      const dbkey = await importDbKey();
      await dbkey.provisionDbKey();
      dbkey.setupDbKey('my-secret');
      expect(cachedPassphrase()).toBe('my-secret');

      dbkey.lockDbKey();

      expect(cachedPassphrase()).toBeUndefined();
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBeUndefined();
    });
  });
});
