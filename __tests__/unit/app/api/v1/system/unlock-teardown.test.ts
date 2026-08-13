/**
 * @jest-environment node
 *
 * Regression coverage for bug 64 — the unlock route's teardown wiring.
 *
 * First-run setup and auto-lock both had to close the database: setup because
 * it replaces the files with SQLCipher-encrypted copies, lock because the
 * pepper is about to leave memory. Both reached straight for
 * `closeSQLiteClient()`, which respects only the client singleton's
 * invariant — the backend went on caching the shut handle and the manager
 * went on handing out that backend, so every repository call threw
 * "The database connection is not open" until the process restarted.
 *
 * These tests pin the wiring, not the plumbing underneath it (which
 * `__tests__/unit/lib/database/suspend-resume-reconnect.test.ts` covers):
 * teardown goes through the manager, all three databases are converted, the
 * app is reopened before success is reported, and the raw client closers are
 * never called from here again.
 */

import { POST } from '@/app/api/v1/system/unlock/route';
import {
  suspendDatabase,
  resumeDatabase,
} from '@/lib/database/manager';
import { closeSQLiteClient } from '@/lib/database/backends/sqlite/client';
import { closeLLMLogsSQLiteClient } from '@/lib/database/backends/sqlite/llm-logs-client';
import { convertDatabaseToEncrypted } from '@/lib/startup/db-encryption-converter';
import { getDatabaseEncryptionState } from '@/lib/startup/db-encryption-state';
import { setupDbKey, getDbKeyState, getHasUserPassphrase, lockDbKey } from '@/lib/startup/dbkey';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  closeSQLiteClient: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  closeLLMLogsSQLiteClient: jest.fn(),
}));
jest.mock('@/lib/startup/db-encryption-converter', () => ({
  convertDatabaseToEncrypted: jest.fn(),
}));
jest.mock('@/lib/startup/db-encryption-state', () => ({
  getDatabaseEncryptionState: jest.fn(() => 'plaintext'),
}));
jest.mock('@/lib/startup/dbkey', () => ({
  setupDbKey: jest.fn(() => ({ pepper: 'test-pepper-base64' })),
  getDbKeyState: jest.fn(() => 'resolved'),
  getHasUserPassphrase: jest.fn(() => true),
  lockDbKey: jest.fn(),
  unlockDbKey: jest.fn(() => true),
  storeEnvPepperInDbKey: jest.fn(),
  changePassphrase: jest.fn(),
  INTERNAL_PASSPHRASE: 'internal',
}));
jest.mock('@/lib/startup/startup-state', () => ({
  startupState: {
    setPepperState: jest.fn(),
    getPepperState: jest.fn(() => 'resolved'),
    getPhase: jest.fn(() => 'ready'),
    setPhase: jest.fn(),
  },
}));
jest.mock('@/lib/paths', () => ({
  getSQLiteDatabasePath: () => '/data/quilltap.db',
  getLLMLogsDatabasePath: () => '/data/llm-logs.db',
  getMountIndexDatabasePath: () => '/data/mount-index.db',
}));
jest.mock('fs', () => ({
  __esModule: true,
  default: { existsSync: jest.fn(() => true) },
  existsSync: jest.fn(() => true),
}));

function postRequest(action: string, body: Record<string, unknown> = {}) {
  return {
    nextUrl: new URL(`http://localhost/api/v1/system/unlock?action=${action}`),
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

describe('bug 64 — unlock route teardown wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_MASTER_PEPPER = 'dGVzdC1wZXBwZXItMzItYnl0ZXMtZm9yLXRlc3Rpbmch';
    jest.mocked(setupDbKey).mockReturnValue({ pepper: 'test-pepper-base64' } as never);
    jest.mocked(getDbKeyState).mockReturnValue('resolved' as never);
    jest.mocked(getHasUserPassphrase).mockReturnValue(true);
    jest.mocked(getDatabaseEncryptionState).mockReturnValue('plaintext' as never);
    jest.mocked(suspendDatabase).mockResolvedValue(true as never);
    jest.mocked(resumeDatabase).mockResolvedValue({} as never);
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_MASTER_PEPPER;
  });

  describe('?action=setup', () => {
    it('tears down through the manager and reopens before returning', async () => {
      const res = await POST(postRequest('setup', { passphrase: '' }));
      const body = await res.json();

      expect(suspendDatabase).toHaveBeenCalled();
      expect(resumeDatabase).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(body.pepper).toBe('test-pepper-base64');
      expect(body.requiresRestart).toBe(false);
    });

    it('never closes the client behind the backend’s back', async () => {
      await POST(postRequest('setup', { passphrase: '' }));

      expect(closeSQLiteClient).not.toHaveBeenCalled();
      expect(closeLLMLogsSQLiteClient).not.toHaveBeenCalled();
    });

    it('encrypts all three databases, mount index included', async () => {
      await POST(postRequest('setup', { passphrase: '' }));

      const converted = jest.mocked(convertDatabaseToEncrypted).mock.calls.map(c => c[0]);
      expect(converted).toEqual([
        '/data/quilltap.db',
        '/data/llm-logs.db',
        '/data/mount-index.db',
      ]);
    });

    it('still hands back the one-time key when the reopen fails', async () => {
      jest.mocked(resumeDatabase).mockRejectedValue(new Error('nope') as never);

      const res = await POST(postRequest('setup', { passphrase: '' }));
      const body = await res.json();

      // The key is displayed exactly once; swallowing it behind a 500 would
      // cost the user their only disaster-recovery copy.
      expect(res.status).toBe(200);
      expect(body.pepper).toBe('test-pepper-base64');
      expect(body.requiresRestart).toBe(true);
    });
  });

  describe('?action=lock', () => {
    it('suspends through the manager rather than closing clients directly', async () => {
      const res = await POST(postRequest('lock'));

      expect(res.status).toBe(200);
      expect(suspendDatabase).toHaveBeenCalled();
      expect(closeSQLiteClient).not.toHaveBeenCalled();
      expect(closeLLMLogsSQLiteClient).not.toHaveBeenCalled();
      expect(lockDbKey).toHaveBeenCalled();
    });
  });

  describe('?action=unlock', () => {
    it('resumes the suspended database so no restart is needed', async () => {
      const res = await POST(postRequest('unlock', { passphrase: 'hunter2hunter2' }));

      expect(res.status).toBe(200);
      expect(resumeDatabase).toHaveBeenCalled();
    });
  });
});
