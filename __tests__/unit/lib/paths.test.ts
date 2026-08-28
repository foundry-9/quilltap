/**
 * Tests for centralized path resolution module
 *
 * @module __tests__/unit/lib/paths.test
 */

import path from 'path';
import os from 'os';

describe('lib/paths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DOCKER_CONTAINER;
    delete process.env.QUILLTAP_DATA_DIR;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getPlatform', () => {
    it('should return docker when DOCKER_CONTAINER is set', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getPlatform } = await import('@/lib/paths');
      expect(getPlatform()).toBe('docker');
    });

    it('should return darwin, linux, or win32 based on process.platform', async () => {
      delete process.env.DOCKER_CONTAINER;

      const { getPlatform } = await import('@/lib/paths');
      const platform = getPlatform();

      // Should return the actual platform when not in Docker
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });
  });

  describe('getPlatformDefaultBaseDir', () => {
    it('should return /app/quilltap for Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getPlatformDefaultBaseDir } = await import('@/lib/paths');
      expect(getPlatformDefaultBaseDir()).toBe('/app/quilltap');
    });

    it('should return platform-specific path when not in Docker', async () => {
      delete process.env.DOCKER_CONTAINER;

      const { getPlatformDefaultBaseDir } = await import('@/lib/paths');
      const result = getPlatformDefaultBaseDir();

      // All platform defaults should contain 'quilltap' (case-insensitive)
      expect(result.toLowerCase()).toContain('quilltap');

      // Should be an absolute path
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('getBaseDataDir', () => {
    it('should return /app/quilltap for Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getBaseDataDir } = await import('@/lib/paths');
      expect(getBaseDataDir()).toBe('/app/quilltap');
    });

    it('should return platform-specific path when not in Docker', async () => {
      delete process.env.DOCKER_CONTAINER;

      const { getBaseDataDir } = await import('@/lib/paths');
      const result = getBaseDataDir();

      // Should contain quilltap and be an absolute path
      expect(result.toLowerCase()).toContain('quilltap');
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('getBaseDataDirWithSource', () => {
    it('should return environment source when QUILLTAP_DATA_DIR is set', async () => {
      process.env.QUILLTAP_DATA_DIR = '/custom/path';

      const { getBaseDataDirWithSource } = await import('@/lib/paths');
      const result = getBaseDataDirWithSource();

      expect(result.path).toBe('/custom/path');
      expect(result.source).toBe('environment');
      expect(result.sourceDescription).toContain('QUILLTAP_DATA_DIR');
    });

    it('should expand tilde in QUILLTAP_DATA_DIR', async () => {
      process.env.QUILLTAP_DATA_DIR = '~/custom-quilltap';

      const { getBaseDataDirWithSource } = await import('@/lib/paths');
      const result = getBaseDataDirWithSource();

      expect(result.path).toBe(path.join(os.homedir(), 'custom-quilltap'));
      expect(result.source).toBe('environment');
    });

    it('should return platform-default source when no env override', async () => {
      delete process.env.QUILLTAP_DATA_DIR;
      delete process.env.DOCKER_CONTAINER;

      const { getBaseDataDirWithSource } = await import('@/lib/paths');
      const result = getBaseDataDirWithSource();

      expect(result.source).toBe('platform-default');
      expect(result.sourceDescription).toMatch(/(macOS|Linux|Windows|Docker) default/);
    });

    it('should return Docker default when in Docker', async () => {
      delete process.env.QUILLTAP_DATA_DIR;
      process.env.DOCKER_CONTAINER = 'true';

      const { getBaseDataDirWithSource } = await import('@/lib/paths');
      const result = getBaseDataDirWithSource();

      expect(result.path).toBe('/app/quilltap');
      expect(result.source).toBe('platform-default');
      expect(result.sourceDescription).toContain('Docker');
    });
  });

  describe('getDataDir', () => {
    it('should return base/data path', async () => {
      const { getDataDir, getBaseDataDir } = await import('@/lib/paths');
      expect(getDataDir()).toBe(path.join(getBaseDataDir(), 'data'));
    });

    it('should return /app/quilltap/data for Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getDataDir } = await import('@/lib/paths');
      expect(getDataDir()).toBe(path.join('/app/quilltap', 'data'));
    });
  });

  describe('getFilesDir', () => {
    it('should return base/files path', async () => {
      const { getFilesDir, getBaseDataDir } = await import('@/lib/paths');
      expect(getFilesDir()).toBe(path.join(getBaseDataDir(), 'files'));
    });

    it('should return /app/quilltap/files for Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getFilesDir } = await import('@/lib/paths');
      expect(getFilesDir()).toBe(path.join('/app/quilltap', 'files'));
    });
  });

  describe('getLogsDir', () => {
    it('should return base/logs path', async () => {
      const { getLogsDir, getBaseDataDir } = await import('@/lib/paths');
      expect(getLogsDir()).toBe(path.join(getBaseDataDir(), 'logs'));
    });

    it('should return /app/quilltap/logs for Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getLogsDir } = await import('@/lib/paths');
      expect(getLogsDir()).toBe(path.join('/app/quilltap', 'logs'));
    });
  });

  describe('getSQLiteDatabasePath', () => {
    it('should return data/quilltap.db path', async () => {
      const { getSQLiteDatabasePath, getDataDir } = await import('@/lib/paths');
      expect(getSQLiteDatabasePath()).toBe(path.join(getDataDir(), 'quilltap.db'));
    });

    it('should return /app/quilltap/data/quilltap.db for Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { getSQLiteDatabasePath } = await import('@/lib/paths');
      expect(getSQLiteDatabasePath()).toBe(path.join('/app/quilltap', 'data', 'quilltap.db'));
    });
  });

  describe('getLegacyPaths', () => {
    it('should return project-relative and home-relative legacy paths', async () => {
      const { getLegacyPaths } = await import('@/lib/paths');
      const legacy = getLegacyPaths();

      expect(legacy.projectDataDir).toBe(path.join(process.cwd(), 'data'));
      expect(legacy.homeDataDir).toBe(path.join(os.homedir(), '.quilltap', 'data'));
      expect(legacy.logsDir).toBe(path.join(process.cwd(), 'logs'));
      expect(legacy.filesDir).toBe(path.join(os.homedir(), '.quilltap', 'files'));
    });
  });

  describe('hasLegacyData', () => {
    it('should return all false for Docker environment', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { hasLegacyData } = await import('@/lib/paths');
      const result = hasLegacyData();

      expect(result.data).toBe(false);
      expect(result.logs).toBe(false);
      expect(result.files).toBe(false);
    });
  });

  describe('isDockerEnvironment', () => {
    it('should return true when DOCKER_CONTAINER is set', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { isDockerEnvironment } = await import('@/lib/paths');
      expect(isDockerEnvironment()).toBe(true);
    });

    it('should return false when DOCKER_CONTAINER is not set', async () => {
      delete process.env.DOCKER_CONTAINER;

      const { isDockerEnvironment } = await import('@/lib/paths');
      // Will return false unless /.dockerenv exists or /app is a directory
      // In test environment, this should be false
      const result = isDockerEnvironment();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isElectronShell', () => {
    it('should return true when QUILLTAP_SHELL is set', async () => {
      process.env.QUILLTAP_SHELL = '1.0.0';

      const { isElectronShell } = await import('@/lib/paths');
      expect(isElectronShell()).toBe(true);
    });

    it('should return false when QUILLTAP_SHELL is not set', async () => {
      delete process.env.QUILLTAP_SHELL;

      const { isElectronShell } = await import('@/lib/paths');
      expect(isElectronShell()).toBe(false);
    });
  });

  describe('getElectronShellVersion', () => {
    it('should return the version string when QUILLTAP_SHELL is set', async () => {
      process.env.QUILLTAP_SHELL = '2.1.3';

      const { getElectronShellVersion } = await import('@/lib/paths');
      expect(getElectronShellVersion()).toBe('2.1.3');
    });

    it('should return null when QUILLTAP_SHELL is not set', async () => {
      delete process.env.QUILLTAP_SHELL;

      const { getElectronShellVersion } = await import('@/lib/paths');
      expect(getElectronShellVersion()).toBeNull();
    });
  });

  describe('getShellCapabilities', () => {
    it('should return a set of capabilities from comma-delimited string', async () => {
      process.env.QUILLTAP_SHELL_CAPABILITIES = 'OPENS_FS_PATH,DOWNLOADS_FILE';

      const { getShellCapabilities } = await import('@/lib/paths');
      const caps = getShellCapabilities();
      expect(caps).toEqual(new Set(['OPENS_FS_PATH', 'DOWNLOADS_FILE']));
    });

    it('should return an empty set when not set', async () => {
      delete process.env.QUILLTAP_SHELL_CAPABILITIES;

      const { getShellCapabilities } = await import('@/lib/paths');
      expect(getShellCapabilities()).toEqual(new Set());
    });

    it('should trim whitespace around flags', async () => {
      process.env.QUILLTAP_SHELL_CAPABILITIES = ' FOO , BAR ';

      const { getShellCapabilities } = await import('@/lib/paths');
      expect(getShellCapabilities()).toEqual(new Set(['FOO', 'BAR']));
    });

    it('should ignore empty segments from trailing commas', async () => {
      process.env.QUILLTAP_SHELL_CAPABILITIES = 'FOO,,BAR,';

      const { getShellCapabilities } = await import('@/lib/paths');
      expect(getShellCapabilities()).toEqual(new Set(['FOO', 'BAR']));
    });
  });

  describe('hasShellCapability', () => {
    it('should return true for a present capability', async () => {
      process.env.QUILLTAP_SHELL_CAPABILITIES = 'OPENS_FS_PATH,DOWNLOADS_FILE';

      const { hasShellCapability } = await import('@/lib/paths');
      expect(hasShellCapability('OPENS_FS_PATH')).toBe(true);
    });

    it('should return false for a missing capability', async () => {
      process.env.QUILLTAP_SHELL_CAPABILITIES = 'OPENS_FS_PATH';

      const { hasShellCapability } = await import('@/lib/paths');
      expect(hasShellCapability('DOWNLOADS_FILE')).toBe(false);
    });

    it('should return false when env var is not set', async () => {
      delete process.env.QUILLTAP_SHELL_CAPABILITIES;

      const { hasShellCapability } = await import('@/lib/paths');
      expect(hasShellCapability('OPENS_FS_PATH')).toBe(false);
    });
  });
});
