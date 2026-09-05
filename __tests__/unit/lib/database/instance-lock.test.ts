/**
 * Unit tests for Instance Lock Manager
 *
 * Tests cover:
 * - Environment detection
 * - Lock file reading/parsing
 * - PID liveness checks
 * - Lock acquisition (clean, re-entrant, stale claim)
 * - Lock release
 * - Lock override with PID verification
 * - Heartbeat start/stop
 * - InstanceLockError
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

const mockFs = {
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
  openSync: jest.fn(),
  writeSync: jest.fn(),
  closeSync: jest.fn(),
  existsSync: jest.fn(),
  constants: {
    O_CREAT: 0o100,
    O_EXCL: 0o200,
    O_WRONLY: 0o1,
  },
};
jest.mock('fs', () => mockFs);

const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

jest.mock('os', () => ({
  hostname: () => 'test-host',
}));

// ============================================================================
// Helpers
// ============================================================================

interface LockFileContent {
  pid: number;
  hostname: string;
  startedAt: string;
  lastHeartbeat: string;
  environment: string;
  processTitle: string;
  processArgv0: string;
  history: Array<{ event: string; pid: number; hostname: string; timestamp: string; detail?: string }>;
}

function createMockLockContent(overrides?: Partial<LockFileContent>): LockFileContent {
  return {
    pid: 12345,
    hostname: 'test-host',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastHeartbeat: new Date().toISOString(),
    environment: 'local',
    processTitle: 'node',
    processArgv0: '/usr/bin/node',
    history: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Instance Lock Manager', () => {
  let instanceLock: typeof import('@/lib/database/backends/sqlite/instance-lock');
  const originalKill = process.kill;
  const originalEnv = { ...process.env };
  const LOCK_PATH = '/mock/data/quilltap.lock';

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset env
    process.env = { ...originalEnv };
    delete process.env.ELECTRON_DEV;
    delete process.env.DOCKER_CONTAINER;

    // Reset globals
    globalThis.__quilltapInstanceLockPath = undefined;
    globalThis.__quilltapInstanceHeartbeatInterval = undefined;

    // Patch setInterval to return an object with unref() (fake timers return a primitive number)
    const origSetInterval = globalThis.setInterval;
    jest.spyOn(globalThis, 'setInterval').mockImplementation((fn: TimerHandler, ms?: number) => {
      const id = origSetInterval(fn, ms);
      // Wrap the numeric ID in an object with unref() so instance-lock.ts doesn't crash
      const wrapped = Object.assign(Object.create(null), { _id: id, unref: () => {}, ref: () => wrapped, hasRef: () => false, refresh: () => wrapped, [Symbol.toPrimitive]: () => id });
      return wrapped as unknown as ReturnType<typeof setInterval>;
    });

    instanceLock = await import('@/lib/database/backends/sqlite/instance-lock');
  });

  afterEach(() => {
    process.kill = originalKill;
    process.env = { ...originalEnv };
    jest.useRealTimers();

    // Clean up any heartbeat
    if (globalThis.__quilltapInstanceHeartbeatInterval) {
      clearInterval(globalThis.__quilltapInstanceHeartbeatInterval);
      globalThis.__quilltapInstanceHeartbeatInterval = undefined;
    }
  });

  // ==========================================================================
  // detectEnvironmentType
  // ==========================================================================

  describe('detectEnvironmentType', () => {
    it('should return electron when ELECTRON_DEV env is set', () => {
      process.env.ELECTRON_DEV = 'true';
      expect(instanceLock.detectEnvironmentType()).toBe('electron');
    });

    it('should return docker when DOCKER_CONTAINER=true', () => {
      process.env.DOCKER_CONTAINER = 'true';
      expect(instanceLock.detectEnvironmentType()).toBe('docker');
    });

    it('should return docker when /.dockerenv exists', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      expect(instanceLock.detectEnvironmentType()).toBe('docker');
    });

    it('should return local when no environment markers', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      expect(instanceLock.detectEnvironmentType()).toBe('local');
    });

    it('should prioritize electron over docker', () => {
      process.env.ELECTRON_DEV = 'true';
      process.env.DOCKER_CONTAINER = 'true';
      expect(instanceLock.detectEnvironmentType()).toBe('electron');
    });
  });

  // ==========================================================================
  // readLockFile
  // ==========================================================================

  describe('readLockFile', () => {
    it('should return parsed content for valid lock file', () => {
      const content = createMockLockContent();
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      const result = instanceLock.readLockFile(LOCK_PATH);
      expect(result).not.toBeNull();
      expect(result?.pid).toBe(12345);
      expect(result?.hostname).toBe('test-host');
    });

    it('should return null for missing file (ENOENT)', () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw error; });

      expect(instanceLock.readLockFile(LOCK_PATH)).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue('not json{{{');

      expect(instanceLock.readLockFile(LOCK_PATH)).toBeNull();
    });

    it('should return null when pid is not a number', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ pid: 'not-a-number', hostname: 'test', history: [] })
      );

      expect(instanceLock.readLockFile(LOCK_PATH)).toBeNull();
    });

    it('should return null when hostname is not a string', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ pid: 123, hostname: 456, history: [] })
      );

      expect(instanceLock.readLockFile(LOCK_PATH)).toBeNull();
    });

    it('should return null when history is not an array', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ pid: 123, hostname: 'test', history: 'not-array' })
      );

      expect(instanceLock.readLockFile(LOCK_PATH)).toBeNull();
    });

    it('should return null on non-ENOENT read errors', () => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw error; });

      expect(instanceLock.readLockFile(LOCK_PATH)).toBeNull();
    });
  });

  // ==========================================================================
  // isPidAlive
  // ==========================================================================

  describe('isPidAlive', () => {
    it('should return true when process.kill succeeds', () => {
      process.kill = jest.fn() as typeof process.kill;

      expect(instanceLock.isPidAlive(12345)).toBe(true);
    });

    it('should return true on EPERM (process exists, no permission)', () => {
      const error = new Error('EPERM') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      process.kill = jest.fn().mockImplementation(() => { throw error; }) as typeof process.kill;

      expect(instanceLock.isPidAlive(12345)).toBe(true);
    });

    it('should return false on ESRCH (no such process)', () => {
      const error = new Error('ESRCH') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      process.kill = jest.fn().mockImplementation(() => { throw error; }) as typeof process.kill;

      expect(instanceLock.isPidAlive(12345)).toBe(false);
    });
  });

  // ==========================================================================
  // acquireInstanceLock
  // ==========================================================================

  describe('acquireInstanceLock', () => {
    it('should create lock file when no existing lock', () => {
      // readLockFile returns null (no lock)
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw enoent; });

      // openSync succeeds (exclusive create)
      (mockFs.openSync as jest.Mock).mockReturnValue(42);

      instanceLock.acquireInstanceLock(LOCK_PATH);

      expect(mockFs.openSync).toHaveBeenCalledWith(
        LOCK_PATH,
        mockFs.constants.O_CREAT | mockFs.constants.O_EXCL | mockFs.constants.O_WRONLY
      );
      expect(mockFs.writeSync).toHaveBeenCalled();
      expect(mockFs.closeSync).toHaveBeenCalledWith(42);
    });

    it('should re-acquire lock for same PID (re-entrant HMR)', () => {
      const content = createMockLockContent({
        pid: process.pid,
        hostname: 'test-host',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.acquireInstanceLock(LOCK_PATH);

      // Should write updated lock file (not use openSync)
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(mockFs.renameSync).toHaveBeenCalled();
    });

    it('should claim stale lock when PID is dead on same host', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'test-host',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      // PID is dead
      const esrch = new Error('ESRCH') as NodeJS.ErrnoException;
      esrch.code = 'ESRCH';
      process.kill = jest.fn().mockImplementation(() => { throw esrch; }) as typeof process.kill;

      instanceLock.acquireInstanceLock(LOCK_PATH);

      // Should have written new lock content
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(mockFs.renameSync).toHaveBeenCalled();
    });

    it('should throw InstanceLockError when live process holds lock on same host', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'test-host',
        environment: 'local',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      // PID is alive
      process.kill = jest.fn() as typeof process.kill;

      expect(() => instanceLock.acquireInstanceLock(LOCK_PATH)).toThrow(
        instanceLock.InstanceLockError
      );
    });

    it('should throw InstanceLockError for VM/container with recent heartbeat', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'other-host',
        environment: 'docker',
        lastHeartbeat: new Date().toISOString(), // very fresh
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      expect(() => instanceLock.acquireInstanceLock(LOCK_PATH)).toThrow(
        instanceLock.InstanceLockError
      );
    });

    it('should claim lock for different hostname with stale heartbeat', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'other-host',
        environment: 'docker',
        lastHeartbeat: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.acquireInstanceLock(LOCK_PATH);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should claim lock for non-VM different hostname', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'other-host',
        environment: 'local',
        lastHeartbeat: new Date().toISOString(),
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.acquireInstanceLock(LOCK_PATH);

      // Non-VM different hostname is always treated as stale
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // releaseInstanceLock
  // ==========================================================================

  describe('releaseInstanceLock', () => {
    it('should delete lock file when owned by current process', () => {
      const content = createMockLockContent({
        pid: process.pid,
        hostname: 'test-host',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.releaseInstanceLock(LOCK_PATH);

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK_PATH);
    });

    it('should skip release when not owned by current process', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'test-host',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.releaseInstanceLock(LOCK_PATH);

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle missing lock file gracefully', () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw enoent; });

      expect(() => instanceLock.releaseInstanceLock(LOCK_PATH)).not.toThrow();
    });

    it('should never throw even on errors', () => {
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('unexpected');
      });

      expect(() => instanceLock.releaseInstanceLock(LOCK_PATH)).not.toThrow();
    });

    it('should skip release when owned by different hostname', () => {
      const content = createMockLockContent({
        pid: process.pid,
        hostname: 'other-host',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.releaseInstanceLock(LOCK_PATH);

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // overrideInstanceLock
  // ==========================================================================

  describe('overrideInstanceLock', () => {
    it('should acquire normally when no existing lock', () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw enoent; });
      (mockFs.openSync as jest.Mock).mockReturnValue(42);

      instanceLock.overrideInstanceLock(LOCK_PATH);

      expect(mockFs.openSync).toHaveBeenCalled();
    });

    it('should override lock when PID is dead', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'test-host',
      });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      const esrch = new Error('ESRCH') as NodeJS.ErrnoException;
      esrch.code = 'ESRCH';
      process.kill = jest.fn().mockImplementation(() => { throw esrch; }) as typeof process.kill;

      instanceLock.overrideInstanceLock(LOCK_PATH);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should override lock when PID is alive and matches process verification', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'test-host',
        processArgv0: '/usr/bin/node',
      });
      const lockJson = JSON.stringify(content);
      // Return lock file for lock path, 'node' for /proc/<pid>/cmdline (Linux path)
      (mockFs.readFileSync as jest.Mock).mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].startsWith('/proc/')) return 'node\0';
        return lockJson;
      });

      // PID is alive
      process.kill = jest.fn() as typeof process.kill;
      // verifyPidMatchesProcess returns true (match) — used on macOS/win32
      mockExecSync.mockReturnValue('node');

      instanceLock.overrideInstanceLock(LOCK_PATH);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should throw when PID is alive but does not match (PID reuse)', () => {
      const content = createMockLockContent({
        pid: 99999,
        hostname: 'test-host',
        processArgv0: '/usr/bin/node',
      });
      const lockJson = JSON.stringify(content);
      // Return lock file for lock path, 'nginx' for /proc/<pid>/cmdline (Linux path)
      (mockFs.readFileSync as jest.Mock).mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].startsWith('/proc/')) return 'nginx\0';
        return lockJson;
      });

      // PID is alive
      process.kill = jest.fn() as typeof process.kill;
      // verifyPidMatchesProcess returns false (some unrelated process like 'nginx') — used on macOS/win32
      mockExecSync.mockReturnValue('nginx');

      expect(() => instanceLock.overrideInstanceLock(LOCK_PATH)).toThrow(
        /Lock override rejected/
      );
    });
  });

  // ==========================================================================
  // InstanceLockError
  // ==========================================================================

  describe('InstanceLockError', () => {
    it('should have correct name, message, lockInfo, and lockPath', () => {
      const lockInfo = createMockLockContent();
      const error = new instanceLock.InstanceLockError(
        'test message',
        lockInfo as import('@/lib/database/backends/sqlite/instance-lock').LockFileContent,
        '/test/path'
      );

      expect(error.name).toBe('InstanceLockError');
      expect(error.message).toBe('test message');
      expect(error.lockInfo).toEqual(lockInfo);
      expect(error.lockPath).toBe('/test/path');
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  describe('Heartbeat management', () => {
    it('should start heartbeat interval', () => {
      instanceLock.startLockHeartbeat(LOCK_PATH);

      expect(globalThis.__quilltapInstanceHeartbeatInterval).toBeDefined();
    });

    it('should stop heartbeat interval', () => {
      instanceLock.startLockHeartbeat(LOCK_PATH);
      expect(globalThis.__quilltapInstanceHeartbeatInterval).toBeDefined();

      instanceLock.stopLockHeartbeat();
      expect(globalThis.__quilltapInstanceHeartbeatInterval).toBeUndefined();
    });

    it('should stop previous heartbeat when starting new one (HMR safety)', () => {
      instanceLock.startLockHeartbeat(LOCK_PATH);
      const first = globalThis.__quilltapInstanceHeartbeatInterval;

      instanceLock.startLockHeartbeat(LOCK_PATH);
      const second = globalThis.__quilltapInstanceHeartbeatInterval;

      expect(second).toBeDefined();
      expect(second).not.toBe(first);
    });
  });

  // ==========================================================================
  // releaseActiveInstanceLock
  // ==========================================================================

  describe('releaseActiveInstanceLock', () => {
    it('should release active lock when one is set', () => {
      // Set up an active lock by acquiring one
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw enoent; });
      (mockFs.openSync as jest.Mock).mockReturnValue(42);

      instanceLock.acquireInstanceLock(LOCK_PATH);
      jest.clearAllMocks();

      // Now set up readFileSync to return our content for release
      const content = createMockLockContent({ pid: process.pid, hostname: 'test-host' });
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      instanceLock.releaseActiveInstanceLock();

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should be a no-op when no active lock', () => {
      globalThis.__quilltapInstanceLockPath = undefined;

      instanceLock.releaseActiveInstanceLock();

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getInstanceLockInfo
  // ==========================================================================

  describe('getInstanceLockInfo', () => {
    it('should return lock content when file exists', () => {
      const content = createMockLockContent();
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(content));

      const result = instanceLock.getInstanceLockInfo(LOCK_PATH);
      expect(result).not.toBeNull();
      expect(result?.pid).toBe(12345);
    });

    it('should return null when no lock file', () => {
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => { throw enoent; });

      expect(instanceLock.getInstanceLockInfo(LOCK_PATH)).toBeNull();
    });
  });

  // ==========================================================================
  // verifyPidMatchesProcess
  // ==========================================================================

  describe('verifyPidMatchesProcess', () => {
    it('should return true when process command contains expected basename', () => {
      mockExecSync.mockReturnValue('node');

      expect(instanceLock.verifyPidMatchesProcess(12345, '/usr/bin/node')).toBe(true);
    });

    it('should return true when process is a known Node name', () => {
      mockExecSync.mockReturnValue('electron');

      expect(instanceLock.verifyPidMatchesProcess(12345, '/some/other/path')).toBe(true);
    });

    it('should return true when verification fails (conservative)', () => {
      mockExecSync.mockImplementation(() => { throw new Error('ps failed'); });

      expect(instanceLock.verifyPidMatchesProcess(12345, '/usr/bin/node')).toBe(true);
    });
  });
});
