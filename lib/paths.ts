/**
 * Centralized Path Resolution Module
 *
 * Single source of truth for all data directory paths in Quilltap.
 * Provides platform-specific defaults with environment variable override support.
 *
 * Platform-specific defaults:
 * - Linux: ~/.quilltap
 * - macOS: ~/Library/Application Support/Quilltap
 * - Windows: %APPDATA%\Quilltap
 * - Docker: /app/quilltap (mounted from host's platform-specific location)
 *
 * Directory structure under base:
 * <base>/
 * ├── data/        - Database files (SQLite)
 * ├── files/       - User file storage (default mount point)
 * ├── logs/        - Application logs
 * ├── plugins/
 * │   └── npm/     - npm-installed plugins
 * └── themes/       - Theme bundles (.qtap-theme)
 *     └── .cache/   - Registry cache
 *
 * Environment variables:
 * - QUILLTAP_DATA_DIR: Overrides the base directory (non-Docker only)
 * - QUILLTAP_HOST_DATA_DIR: The host-side data directory path. In VM/Docker
 *   environments, this preserves the original host path for display purposes.
 *   Falls back to getBaseDataDir() when not set.
 * - QUILLTAP_SHELL: Set by the quilltap-shell Electron app to its own version
 *   string (e.g., "1.2.0"). Presence indicates the server was spawned by the
 *   Electron desktop shell.
 * - QUILLTAP_SHELL_CAPABILITIES: Comma-delimited string of capability flags
 *   advertised by the shell (e.g., "OPENS_FS_PATH,DOWNLOADS_FILE"). When not
 *   set, no shell capabilities are assumed.
 *
 * @module lib/paths
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export type Platform = 'docker' | 'linux' | 'darwin' | 'win32';

export interface LegacyDataStatus {
  /** Whether legacy data directory exists */
  data: boolean;
  /** Whether legacy logs directory exists */
  logs: boolean;
  /** Whether legacy files directory exists */
  files: boolean;
}

export interface LegacyPaths {
  /** Path to legacy project-relative data directory (./data) */
  projectDataDir: string;
  /** Path to legacy home-relative data directory (~/.quilltap/data) */
  homeDataDir: string;
  /** Path to legacy logs directory (./logs) */
  logsDir: string;
  /** Path to legacy files directory (~/.quilltap/files) */
  filesDir: string;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Check if running in a Docker container
 *
 * Detects Docker by checking:
 * 1. DOCKER_CONTAINER environment variable
 * 2. Existence of /.dockerenv file
 * 3. Existence of /app directory (Quilltap Docker convention)
 */
export function isDockerEnvironment(): boolean {
  if (process.env.DOCKER_CONTAINER === 'true') {
    return true;
  }

  // Check for Docker-specific markers
  try {
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }
    // Check for /app as a directory (Quilltap Docker convention)
    const appStat = fs.statSync('/app');
    if (appStat.isDirectory()) {
      return true;
    }
  } catch {
    // Not in Docker
  }

  return false;
}

/**
 * Check if the server was spawned by the Quilltap Electron shell
 *
 * The quilltap-shell app sets QUILLTAP_SHELL to its own version string
 * (e.g., "1.2.0") when it launches the Next.js server. This is true
 * regardless of whether Electron runs the server directly or via Docker.
 */
export function isElectronShell(): boolean {
  return !!process.env.QUILLTAP_SHELL;
}

/**
 * Get the quilltap-shell version, if running under Electron
 *
 * @returns The shell version string, or null if not running under Electron
 */
export function getElectronShellVersion(): string | null {
  return process.env.QUILLTAP_SHELL || null;
}

/**
 * Get the set of capability flags advertised by the Electron shell
 *
 * QUILLTAP_SHELL_CAPABILITIES is a comma-delimited string of uppercase flags
 * (e.g., "OPENS_FS_PATH,DOWNLOADS_FILE"). Returns an empty set when the
 * variable is unset or empty.
 *
 * @returns Set of capability flag strings
 */
export function getShellCapabilities(): Set<string> {
  const raw = process.env.QUILLTAP_SHELL_CAPABILITIES;
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw.split(',').map((s) => s.trim()).filter(Boolean)
  );
}

/**
 * Get the current platform
 *
 * @returns Platform identifier
 */
export function getPlatform(): Platform {
  if (isDockerEnvironment()) {
    return 'docker';
  }

  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return platform;
  }

  // Default to linux for other Unix-like systems
  return 'linux';
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the platform-specific default base directory
 *
 * Does NOT check QUILLTAP_DATA_DIR - use getBaseDataDir() for that.
 *
 * @returns Platform-specific default base directory path
 */
export function getPlatformDefaultBaseDir(): string {
  const platform = getPlatform();
  const homeDir = os.homedir();

  switch (platform) {
    case 'docker':
      return '/app/quilltap';

    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Quilltap');

    case 'win32':
      // Use APPDATA if available, otherwise fall back to home directory
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      return path.join(appData, 'Quilltap');

    case 'linux':
    default:
      return path.join(homeDir, '.quilltap');
  }
}

export type BaseDataDirSource = 'environment' | 'platform-default';

export interface BaseDataDirInfo {
  /** The resolved base data directory path */
  path: string;
  /** Where the path came from */
  source: BaseDataDirSource;
  /** Human-readable description of the source */
  sourceDescription: string;
}

/**
 * Get the base data directory with source information
 *
 * Respects QUILLTAP_DATA_DIR environment variable if set (non-Docker only),
 * otherwise returns platform-specific default.
 *
 * In Docker, QUILLTAP_DATA_DIR is ignored because the container must use
 * /app/quilltap to match the volume mount configured via `docker run -v`.
 *
 * @returns Object containing the path and its source
 */
export function getBaseDataDirWithSource(): BaseDataDirInfo {
  const platform = getPlatform();

  const platformDescriptions: Record<Platform, string> = {
    docker: 'Docker container default (/app/quilltap)',
    darwin: 'macOS default (~/Library/Application Support/Quilltap)',
    win32: 'Windows default (%APPDATA%\\Quilltap)',
    linux: 'Linux default (~/.quilltap)',
  };

  // In Docker, always use the default path to match volume mounts
  if (platform === 'docker') {
    return {
      path: getPlatformDefaultBaseDir(),
      source: 'platform-default',
      sourceDescription: platformDescriptions[platform],
    };
  }

  const envOverride = process.env.QUILLTAP_DATA_DIR;

  if (envOverride) {
    // Expand ~ to home directory
    const resolvedPath = envOverride.startsWith('~')
      ? path.join(os.homedir(), envOverride.slice(1))
      : envOverride;

    return {
      path: resolvedPath,
      source: 'environment',
      sourceDescription: `QUILLTAP_DATA_DIR environment variable (${envOverride})`,
    };
  }

  return {
    path: getPlatformDefaultBaseDir(),
    source: 'platform-default',
    sourceDescription: platformDescriptions[platform],
  };
}

/**
 * Get the base data directory
 *
 * Respects QUILLTAP_DATA_DIR environment variable if set (non-Docker only),
 * otherwise returns platform-specific default.
 *
 * @returns Base data directory path
 */
export function getBaseDataDir(): string {
  return getBaseDataDirWithSource().path;
}

/**
 * Get the data directory path (for database files)
 *
 * @returns Data directory path (<base>/data)
 */
export function getDataDir(): string {
  return path.join(getBaseDataDir(), 'data');
}

/**
 * Get the files directory path (for user file storage)
 *
 * @returns Files directory path (<base>/files)
 */
export function getFilesDir(): string {
  return path.join(getBaseDataDir(), 'files');
}

/**
 * Get the logs directory path
 *
 * @returns Logs directory path (<base>/logs)
 */
export function getLogsDir(): string {
  return path.join(getBaseDataDir(), 'logs');
}

/**
 * Get the SQLite database file path
 *
 * @returns SQLite database path (<base>/data/quilltap.db)
 */
export function getSQLiteDatabasePath(): string {
  return path.join(getDataDir(), 'quilltap.db');
}

/**
 * Get the LLM logs database file path
 *
 * Separate database for high-churn LLM request/response debug data,
 * isolated from the main database to prevent corruption propagation.
 *
 * @returns LLM logs database path (<base>/data/quilltap-llm-logs.db)
 */
export function getLLMLogsDatabasePath(): string {
  return path.join(getDataDir(), 'quilltap-llm-logs.db');
}

/**
 * Get the mount index database file path
 *
 * Separate database for document mount point tracking, file inventory,
 * checksums, chunks, and embeddings. Isolated from the main database
 * so the mount index can be rebuilt without affecting core data.
 *
 * @returns Mount index database path (<base>/data/quilltap-mount-index.db)
 */
export function getMountIndexDatabasePath(): string {
  return path.join(getDataDir(), 'quilltap-mount-index.db');
}

/**
 * Get the physical database backups directory path
 *
 * Physical backups are stored alongside the database file under data/backups/.
 * These are independent of the logical backup system (Backup & Restore).
 *
 * @returns Backups directory path (<base>/data/backups)
 */
export function getBackupsDir(): string {
  return path.join(getDataDir(), 'backups');
}

/**
 * Get the instance lock file path
 *
 * The lock file prevents two Quilltap processes from opening the same
 * database simultaneously. Contains JSON with PID, hostname, environment,
 * and a history of state changes for debugging.
 *
 * @returns Instance lock file path (<base>/data/quilltap.lock)
 */
export function getInstanceLockPath(): string {
  return path.join(getDataDir(), 'quilltap.lock');
}

/**
 * Get the themes directory path (for .qtap-theme bundles)
 *
 * @returns Themes directory path (<base>/themes)
 */
export function getThemesDir(): string {
  return path.join(getBaseDataDir(), 'themes');
}

/**
 * Get the bundled themes directory path (shipped with the app)
 *
 * @returns Bundled themes directory path (themes/bundled/ in app source)
 */
export function getBundledThemesDir(): string {
  return path.join(process.cwd(), 'themes', 'bundled');
}

/**
 * Get the plugins directory path
 *
 * @returns Plugins directory path (<base>/plugins)
 */
export function getPluginsDir(): string {
  return path.join(getBaseDataDir(), 'plugins');
}

/**
 * Get the npm plugins directory path
 *
 * Site-wide npm-installed plugins are stored here.
 *
 * @returns npm plugins directory path (<base>/plugins/npm)
 */
export function getNpmPluginsDir(): string {
  return path.join(getPluginsDir(), 'npm');
}

/**
 * Get the host-side data directory path for display purposes
 *
 * In Docker, QUILLTAP_HOST_DATA_DIR preserves the original host path
 * (e.g., ~/Library/Application Support/Quilltap on macOS) even though the
 * app sees /app/quilltap inside the container.
 *
 * Falls back to getBaseDataDir() when not set (i.e., running locally).
 *
 * @returns Host-side data directory path
 */
export function getHostDataDir(): string {
  // QUILLTAP_HOST_DATA_DIR is only meaningful inside a container where the
  // internal path differs from the host path. In local environments, always
  // use getBaseDataDir() to respect QUILLTAP_DATA_DIR overrides.
  if (isDockerEnvironment()) {
    const envOverride = process.env.QUILLTAP_HOST_DATA_DIR;
    if (envOverride) {
      return envOverride;
    }
  }
  return getBaseDataDir();
}

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure all data directories exist
 *
 * Creates the base directory and subdirectories if they don't exist:
 * - <base>/data
 * - <base>/files
 * - <base>/logs
 * - <base>/plugins/npm
 *
 * @throws {Error} If directory creation fails
 */
export function ensureDataDirectoriesExist(): void {
  const dirs = [
    getDataDir(),
    getFilesDir(),
    getLogsDir(),
    getNpmPluginsDir(),
    getThemesDir(),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ============================================================================
// Legacy Data Detection
// ============================================================================

/**
 * Get paths to legacy data locations
 *
 * Returns paths that may contain legacy data from older Quilltap versions:
 * - ./data - Project-relative data directory
 * - ~/.quilltap/data - Home-relative data directory (Linux-style, used on all platforms before)
 * - ./logs - Project-relative logs directory
 * - ~/.quilltap/files - Old Linux-style files directory (on macOS/Windows)
 *
 * @returns Object containing legacy paths
 */
export function getLegacyPaths(): LegacyPaths {
  const cwd = process.cwd();
  const homeDir = os.homedir();

  return {
    projectDataDir: path.join(cwd, 'data'),
    homeDataDir: path.join(homeDir, '.quilltap', 'data'),
    logsDir: path.join(cwd, 'logs'),
    filesDir: path.join(homeDir, '.quilltap', 'files'),
  };
}

/**
 * Check if legacy data exists that may need migration
 *
 * Checks for:
 * - ./data directory with quilltap.db (project-relative)
 * - ~/.quilltap/data directory with quilltap.db (home-relative, on macOS/Windows)
 * - ./logs directory with log files
 * - ~/.quilltap/files on macOS/Windows (where it differs from the new default)
 *
 * Does NOT flag as legacy if paths are the same as new paths.
 *
 * @returns Object indicating which legacy data types exist
 */
export function hasLegacyData(): LegacyDataStatus {
  const legacy = getLegacyPaths();
  const currentBase = getBaseDataDir();
  const currentDataDir = getDataDir();
  const currentLogsDir = getLogsDir();
  const platform = getPlatform();

  // For Docker, there's no legacy data to migrate
  if (platform === 'docker') {
    return { data: false, logs: false, files: false };
  }

  // Check if legacy and current paths are different before flagging as legacy
  const legacyBase = path.join(os.homedir(), '.quilltap');
  const pathsAreSame = path.resolve(currentBase) === path.resolve(legacyBase);

  let hasLegacyData = false;

  // Check for legacy ./data directory (project-relative)
  try {
    const legacyDbPath = path.join(legacy.projectDataDir, 'quilltap.db');
    if (fs.existsSync(legacyDbPath)) {
      // Only flag as legacy if it's different from the current data dir
      if (path.resolve(legacy.projectDataDir) !== path.resolve(currentDataDir)) {
        hasLegacyData = true;
      }
    }
  } catch {
    // Ignore errors
  }

  // Check for legacy ~/.quilltap/data directory (home-relative)
  // This is important for macOS/Windows where default path changed
  if (!hasLegacyData && (platform === 'darwin' || platform === 'win32') && !pathsAreSame) {
    try {
      const legacyDbPath = path.join(legacy.homeDataDir, 'quilltap.db');
      if (fs.existsSync(legacyDbPath)) {
        // Only flag as legacy if it's different from the current data dir
        if (path.resolve(legacy.homeDataDir) !== path.resolve(currentDataDir)) {
          hasLegacyData = true;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Check for legacy ./logs directory (project-relative)
  let hasLegacyLogs = false;
  try {
    if (fs.existsSync(legacy.logsDir)) {
      const files = fs.readdirSync(legacy.logsDir);
      const hasLogFiles = files.some(f => f.endsWith('.log'));
      if (hasLogFiles) {
        // Only flag as legacy if it's different from the current logs dir
        if (path.resolve(legacy.logsDir) !== path.resolve(currentLogsDir)) {
          hasLegacyLogs = true;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Check for legacy ~/.quilltap/files on macOS/Windows where default path changed
  let hasLegacyFiles = false;
  if ((platform === 'darwin' || platform === 'win32') && !pathsAreSame) {
    try {
      if (fs.existsSync(legacy.filesDir)) {
        const files = fs.readdirSync(legacy.filesDir);
        if (files.length > 0) {
          hasLegacyFiles = true;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return {
    data: hasLegacyData,
    logs: hasLegacyLogs,
    files: hasLegacyFiles,
  };
}

/**
 * Check if a migration marker file exists
 *
 * Marker files are placed in legacy directories after migration to prevent
 * re-migration on subsequent startups.
 *
 * @param legacyDir - The legacy directory to check
 * @returns True if marker file exists
 */
export function hasMigrationMarker(legacyDir: string): boolean {
  const markerPath = path.join(legacyDir, '.MIGRATED');
  return fs.existsSync(markerPath);
}

/**
 * Create a migration marker file
 *
 * @param legacyDir - The legacy directory to mark
 * @param newPath - The new path where data was migrated to
 */
export function createMigrationMarker(legacyDir: string, newPath: string): void {
  const markerPath = path.join(legacyDir, '.MIGRATED');
  const content = `Data migrated to: ${newPath}\nMigrated at: ${new Date().toISOString()}\n`;
  fs.writeFileSync(markerPath, content, 'utf8');
}
