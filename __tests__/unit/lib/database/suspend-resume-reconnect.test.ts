/**
 * Regression coverage for bug 64 — first-run encryption setup wedged every
 * database connection until the process was restarted.
 *
 * Three singleton layers each keep their own copy of "the database is open":
 * the client singleton, `SQLiteBackend.db`, and the manager's cached backend.
 * First-run setup closed only the bottom one, so the backend kept handing out
 * a shut handle and the manager kept handing out that backend — forever.
 *
 * What is asserted here:
 *   1. `suspendDatabase()` really closes all three databases (main, LLM logs,
 *      mount index), so a caller may safely swap the files underneath.
 *   2. `resumeDatabase()` brings the app back without a restart.
 *   3. Suspend/resume keeps the SAME backend instance, so the collection
 *      metadata built by `ensureCollection` survives. A close-and-rebuild
 *      would drop it, and already-initialized repositories never re-run
 *      `ensureCollection`, so their JSON columns would silently start
 *      round-tripping as raw strings.
 *   4. The backend self-heals a handle closed behind its back — the exact
 *      out-of-band `closeSQLiteClient()` sequence the old code performed.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { z } from 'zod';

import {
  initializeDatabase,
  suspendDatabase,
  resumeDatabase,
  getDatabaseAsync,
  _resetForTesting,
} from '@/lib/database/manager';
import { SQLiteBackend } from '@/lib/database/backends/sqlite/backend';
import { closeSQLiteClient, getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';

// The manager is globally mocked in jest.setup.ts; this suite is about the
// real thing.
jest.unmock('@/lib/database/manager');

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

// Startup side-effects that have nothing to do with handle lifecycle.
jest.mock('@/lib/database/backends/sqlite/protection', () => ({
  runIntegrityCheck: jest.fn(),
  startPeriodicCheckpoints: jest.fn(),
  stopPeriodicCheckpoints: jest.fn(),
  runShutdownCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-protection', () => ({
  runLLMLogsIntegrityCheck: jest.fn(),
  startLLMLogsPeriodicCheckpoints: jest.fn(),
  stopLLMLogsPeriodicCheckpoints: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-protection', () => ({
  runMountIndexIntegrityCheck: jest.fn(),
  startMountIndexPeriodicCheckpoints: jest.fn(),
  stopMountIndexPeriodicCheckpoints: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/physical-backup', () => ({
  createPhysicalBackup: jest.fn().mockResolvedValue(undefined),
  createLLMLogsPhysicalBackup: jest.fn().mockResolvedValue(undefined),
  createMountIndexPhysicalBackup: jest.fn().mockResolvedValue(undefined),
  applyRetentionPolicy: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/database/backends/sqlite/instance-lock', () => ({
  acquireInstanceLock: jest.fn(),
  releaseActiveInstanceLock: jest.fn(),
  releaseInstanceLock: jest.fn(),
  startLockHeartbeat: jest.fn(),
  stopLockHeartbeat: jest.fn(),
  InstanceLockError: class InstanceLockError extends Error {},
}));

const TestRowSchema = z.object({
  id: z.string(),
  tags: z.array(z.string()).optional(),
});

describe('bug 64 — database suspend/resume across encryption setup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-bug64-'));
    process.env.SQLITE_PATH = path.join(tmpDir, 'quilltap.db');
    process.env.SQLITE_LLM_LOGS_PATH = path.join(tmpDir, 'llm-logs.db');
    process.env.SQLITE_MOUNT_INDEX_PATH = path.join(tmpDir, 'mount-index.db');
    _resetForTesting();
  });

  afterEach(async () => {
    try {
      const { closeDatabase } = await import('@/lib/database/manager');
      await closeDatabase();
    } catch {
      /* already down */
    }
    _resetForTesting();
    delete process.env.SQLITE_PATH;
    delete process.env.SQLITE_LLM_LOGS_PATH;
    delete process.env.SQLITE_MOUNT_INDEX_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suspend closes all three databases, resume reopens them', async () => {
    await initializeDatabase();

    expect(getRawDatabase()).not.toBeNull();
    expect(getRawLLMLogsDatabase()).not.toBeNull();
    expect(getRawMountIndexDatabase()).not.toBeNull();

    const suspended = await suspendDatabase();
    expect(suspended).toBe(true);

    // All three, not just main + logs. The mount index holds every
    // database-backed document store's bytes; leaving it open while its file
    // was converted left it writing to an unlinked inode.
    expect(getRawDatabase()).toBeNull();
    expect(getRawLLMLogsDatabase()).toBeNull();
    expect(getRawMountIndexDatabase()).toBeNull();

    await resumeDatabase();

    expect(getRawDatabase()).not.toBeNull();
    expect(getRawLLMLogsDatabase()).not.toBeNull();
    expect(getRawMountIndexDatabase()).not.toBeNull();
  });

  it('repositories keep working after suspend/resume — no restart needed', async () => {
    const backend = await initializeDatabase();
    await backend.ensureCollection('bug64_rows', TestRowSchema);

    await suspendDatabase();
    await resumeDatabase();

    // The old code path left this throwing "The database connection is not
    // open" for the rest of the process's life.
    const after = await getDatabaseAsync();
    expect(() => after.getCollection('bug64_rows')).not.toThrow();
    await expect(after.rawQuery('SELECT 1')).resolves.toBeDefined();
  });

  it('keeps the same backend instance so ensureCollection metadata survives', async () => {
    const backend = await initializeDatabase();
    await backend.ensureCollection('bug64_rows', TestRowSchema);

    await suspendDatabase();
    await resumeDatabase();

    const after = await getDatabaseAsync();

    // Identity matters: repositories latch `collectionInitialized` per
    // instance and never re-run ensureCollection, so a rebuilt backend would
    // carry empty JSON/array column maps for every live repository.
    expect(after).toBe(backend);
    expect(
      (after as SQLiteBackend & { collectionArrayColumns: Map<string, string[]> })
        .collectionArrayColumns.get('bug64_rows')
    ).toContain('tags');
  });

  it('self-heals a handle closed behind the backend’s back', async () => {
    const backend = await initializeDatabase();
    await backend.ensureCollection('bug64_rows', TestRowSchema);

    // Precisely what handleSetup used to do: reach past the backend and shut
    // the client singleton, leaving `_state === 'connected'` and a dead handle.
    closeSQLiteClient();
    expect(getRawDatabase()).toBeNull();

    expect(() => backend.getCollection('bug64_rows')).not.toThrow();
    await expect(backend.rawQuery('SELECT 1')).resolves.toBeDefined();
    expect(getRawDatabase()).not.toBeNull();
  });

  it('does not reopen while suspended — the files are being swapped', async () => {
    const backend = await initializeDatabase();

    await suspendDatabase();

    // A request landing mid-conversion must fail loudly rather than bind to
    // the pre-swap inode.
    expect(() => backend.getCollection('bug64_rows')).toThrow('SQLite backend not connected');
    expect(getRawDatabase()).toBeNull();

    await resumeDatabase();
  });
});
