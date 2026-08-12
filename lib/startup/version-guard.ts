/**
 * Version Guard
 *
 * Prevents an older version of Quilltap from starting against a database
 * that has been touched by a newer version. This protects against schema
 * and data corruption when accidentally running the wrong binary.
 *
 * The guard uses the `instance_settings` table to track the highest version
 * that has ever written to this database. On startup, if the current version
 * is lower than the stored highest version, the server refuses to proceed.
 *
 * Semver comparison follows standard precedence:
 * - 3.3.0 > 3.3.0-dev.128 (release trumps prerelease of same x.y.z)
 * - 3.4.0-dev.1 > 3.3.0 (higher minor, even as prerelease)
 * - 3.3.0-dev.128 > 3.3.0-dev.38 (higher prerelease number)
 *
 * If no `instance_settings` table exists, the database is assumed to be
 * from version 3.3.0-dev.127 (the last version before this feature).
 */

import semver from 'semver';
import { logger } from '@/lib/logger';
import { getDbKeyPath } from '@/lib/startup/dbkey';

/** Version assumed for databases without an instance_settings table */
const LEGACY_ASSUMED_VERSION = '3.3.0-dev.127';

/** Key used in instance_settings for the highest version */
const HIGHEST_VERSION_KEY = 'highest_app_version';

export type VersionGuardResult = {
  blocked: false;
} | {
  blocked: true;
  currentVersion: string;
  highestVersion: string;
};

/**
 * Check whether the current app version is allowed to run against this database.
 *
 * This runs BEFORE migrations, using the migration database utilities directly.
 * It creates the instance_settings table with CREATE TABLE IF NOT EXISTS so it
 * works even on first run.
 */
export function checkVersionGuard(): VersionGuardResult {
  const log = logger.child({ module: 'version-guard' });

  try {
    const {
      isSQLiteBackend,
      getSQLiteDatabase,
      sqliteTableExists,
    } = require('@/migrations/lib/database-utils');

    if (!isSQLiteBackend()) {
      return { blocked: false };
    }

    // Read current version from package.json
    const currentVersion = getAppVersion();
    if (!currentVersion || !semver.valid(currentVersion)) {
      log.warn('Version guard skipped — could not determine valid current version', {
        currentVersion,
      });
      return { blocked: false };
    }

    const db = getSQLiteDatabase();
    const tableExists = sqliteTableExists('instance_settings');

    let storedVersion: string | null = null;

    if (tableExists) {
      // Read the highest version from the table
      const row = db.prepare(
        `SELECT "value" FROM "instance_settings" WHERE "key" = ?`
      ).get(HIGHEST_VERSION_KEY) as { value: string } | undefined;

      storedVersion = row?.value ?? null;
    } else {
      // No instance_settings table — this is a pre-version-guard database.
      // Assume 3.3.0-dev.127 as the baseline.
      storedVersion = LEGACY_ASSUMED_VERSION;

      log.info('No instance_settings table found — assuming legacy version', {
        assumedVersion: LEGACY_ASSUMED_VERSION,
      });
    }

    // No stored version at all (fresh install with the table but no row)
    if (!storedVersion) {
      log.info('No highest version stored — first run with version guard', {
        currentVersion,
      });
      return { blocked: false };
    }

    // Validate the stored version is valid semver
    if (!semver.valid(storedVersion)) {
      log.warn('Stored highest version is not valid semver — skipping guard', {
        storedVersion,
      });
      return { blocked: false };
    }

    // Compare: if current version is less than stored, block
    if (semver.lt(currentVersion, storedVersion)) {
      log.error('Version guard BLOCKED — current version is older than database version', {
        currentVersion,
        highestVersion: storedVersion,
      });
      return {
        blocked: true,
        currentVersion,
        highestVersion: storedVersion,
      };
    }

    return { blocked: false };
  } catch (error) {
    // If the version guard itself fails, log and allow startup to continue.
    // We don't want a bug in the guard to brick the server.
    log.error('Version guard check failed — allowing startup to proceed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { blocked: false };
  }
}

/**
 * Store the current app version as the highest version in instance_settings.
 *
 * Called after migrations complete on every startup, so the stored version
 * always reflects the latest version that successfully initialized this database.
 */
export function storeCurrentVersion(): void {
  const log = logger.child({ module: 'version-guard' });

  try {
    const {
      isSQLiteBackend,
      getSQLiteDatabase,
      sqliteTableExists,
    } = require('@/migrations/lib/database-utils');

    if (!isSQLiteBackend()) {
      return;
    }

    const currentVersion = getAppVersion();
    if (!currentVersion || !semver.valid(currentVersion)) {
      log.warn('Cannot store version — invalid current version', { currentVersion });
      return;
    }

    const db = getSQLiteDatabase();

    // Ensure the table exists (it should after migrations, but be safe)
    if (!sqliteTableExists('instance_settings')) {
      db.exec(`CREATE TABLE IF NOT EXISTS "instance_settings" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL
      )`);
    }

    db.prepare(
      `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`
    ).run(HIGHEST_VERSION_KEY, currentVersion);

    log.info('Stored current version in instance_settings', {
      version: currentVersion,
    });

    // Also write minServerVersion into .dbkey files so the shell can
    // reject launches before even opening the database.
    storeMinServerVersionInDbKeys(currentVersion, log);
  } catch (error) {
    log.error('Failed to store current version in instance_settings', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Patch a .dbkey JSON file on disk, setting `minServerVersion` to the given version.
 *
 * Reads the existing JSON, adds/updates the `minServerVersion` field, and writes
 * it back. Preserves all other fields and file permissions (0o600).
 */
function patchDbKeyFileVersion(filePath: string, version: string, log: ReturnType<typeof logger.child>): void {
  const fs = require('fs');

  try {
    if (!fs.existsSync(filePath)) {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    data.minServerVersion = version;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });

    log.info('Wrote minServerVersion to .dbkey file', { path: filePath, minServerVersion: version });
  } catch (error) {
    log.error('Failed to write minServerVersion to .dbkey file', {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Write `minServerVersion` into the instance's .dbkey file.
 */
function storeMinServerVersionInDbKeys(version: string, log: ReturnType<typeof logger.child>): void {
  patchDbKeyFileVersion(getDbKeyPath(), version, log);
}

/**
 * Read the app version from package.json at runtime.
 */
function getAppVersion(): string {
  try {
    const fs = require('fs');
    const path = require('path');
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}
