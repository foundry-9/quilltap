/**
 * The Almanack — Phase 1, "Taking the measure of the premises".
 *
 * The building itself: the runtime it is standing in, the three databases and
 * their footprints, what backups exist, and how far the migration ladder has
 * been climbed.
 *
 * @module lib/tools/almanack/phase1-premises
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '@/lib/logger';
import {
  getBackupsDir,
  getDataDir,
  getElectronShellVersion,
  getLLMLogsDatabasePath,
  getMountIndexDatabasePath,
  getShellCapabilities,
  getSQLiteDatabasePath,
  isDockerEnvironment,
  isElectronShell,
} from '@/lib/paths';
import { getHasUserPassphrase } from '@/lib/startup/dbkey';
import {
  parseBackupFilename,
  parseLLMLogsBackupFilename,
  parseMountIndexBackupFilename,
} from '@/lib/database/backends/sqlite/physical-backup';
import { getErrorMessage } from '@/lib/error-utils';
import { mainRow, mainRows } from './db';
import type {
  BackupInfo,
  DatabaseSecurityInfo,
  DatabaseSizeInfo,
  MigrationStateInfo,
  RuntimeEnvironmentInfo,
} from './types';

const moduleLogger = logger.child({ module: 'almanack:premises' });

/** Collect runtime environment information. */
export function collectRuntimeEnvironment(): RuntimeEnvironmentInfo {
  moduleLogger.debug('Collecting runtime environment information');

  let runtimeType: RuntimeEnvironmentInfo['runtimeType'] = 'node';
  if (isDockerEnvironment()) {
    runtimeType = 'docker';
  } else if (isElectronShell()) {
    runtimeType = 'electron';
  }

  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    runtimeType,
    electronShellVersion: getElectronShellVersion(),
    shellCapabilities: [...getShellCapabilities()],
    uptimeSeconds: process.uptime(),
    dataDirectory: getDataDir(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

async function statSize(label: string, filePath: string): Promise<DatabaseSizeInfo> {
  try {
    const stat = await fs.stat(filePath);
    return { label, sizeBytes: stat.size, present: true };
  } catch {
    // The file may legitimately not exist yet (fresh install, or a database
    // whose first access hasn't happened).
    return { label, sizeBytes: 0, present: false };
  }
}

/** Security info with nothing known — no passphrase, no databases found. */
export function emptyDatabaseSecurity(): DatabaseSecurityInfo {
  return { passphraseProtected: false, databases: [], highestAppVersion: null };
}

/**
 * Collect database security information.
 *
 * Three databases since 4.9 — the mount index is where character content,
 * wardrobe, photos, mail, scenarios and every document byte actually live, so
 * a report that only weighed the main DB was weighing the wrong shelf.
 */
export async function collectDatabaseSecurity(): Promise<DatabaseSecurityInfo> {
  moduleLogger.debug('Collecting database security information');

  let passphraseProtected = false;
  try {
    passphraseProtected = getHasUserPassphrase();
  } catch (error) {
    moduleLogger.debug('Could not check passphrase status', { error: getErrorMessage(error) });
  }

  const databases = await Promise.all([
    statSize('Main', getSQLiteDatabasePath()),
    statSize('LLM Logs', getLLMLogsDatabasePath()),
    statSize('Mount Index', getMountIndexDatabasePath()),
  ]);

  // The version guard's tripwire, stored in instance_settings. The old report
  // declared this field and then always rendered null.
  const versionRow = await mainRow<{ value: string }>(
    `SELECT "value" FROM "instance_settings" WHERE "key" = 'highest_app_version'`,
    [],
    'premises.highestAppVersion',
  );

  return {
    passphraseProtected,
    databases,
    highestAppVersion: versionRow?.value ?? null,
  };
}

/** Collect backup status for all three databases. */
export async function collectBackupStatus(): Promise<BackupInfo[]> {
  moduleLogger.debug('Collecting backup status');

  const parsers: Array<{ label: string; parse: (filename: string) => Date | null }> = [
    // Order matters: the main-DB parser is the loosest, so the two prefixed
    // parsers must get first refusal on every filename.
    { label: 'LLM Logs', parse: parseLLMLogsBackupFilename },
    { label: 'Mount Index', parse: parseMountIndexBackupFilename },
    { label: 'Main', parse: parseBackupFilename },
  ];

  const buckets = new Map<string, { dates: Date[]; bytes: number }>(
    parsers.map(p => [p.label, { dates: [], bytes: 0 }]),
  );

  try {
    const backupsDir = getBackupsDir();
    let filenames: string[];
    try {
      filenames = await fs.readdir(backupsDir);
    } catch {
      filenames = []; // No backups directory yet.
    }

    for (const filename of filenames) {
      for (const { label, parse } of parsers) {
        const date = parse(filename);
        if (!date) continue;

        let size = 0;
        try {
          const stat = await fs.stat(path.join(backupsDir, filename));
          size = stat.size;
        } catch {
          // Skip files we can't stat; the count still reflects reality.
        }
        const bucket = buckets.get(label)!;
        bucket.dates.push(date);
        bucket.bytes += size;
        break;
      }
    }
  } catch (error) {
    moduleLogger.warn('Failed to collect backup status', { error: getErrorMessage(error) });
  }

  // Present in main → llm-logs → mount-index order, matching the DB size table.
  return ['Main', 'LLM Logs', 'Mount Index'].map((label): BackupInfo => {
    const bucket = buckets.get(label)!;
    const sorted = [...bucket.dates].sort((a, b) => a.getTime() - b.getTime());
    return {
      label,
      count: sorted.length,
      oldestDate: sorted.length > 0 ? sorted[0].toISOString() : null,
      newestDate: sorted.length > 0 ? sorted[sorted.length - 1].toISOString() : null,
      totalSizeBytes: bucket.bytes,
    };
  });
}

/** Migration state with nothing recorded. */
export function emptyMigrationState(): MigrationStateInfo {
  return {
    appliedCount: 0,
    lastMigrationId: null,
    lastMigrationAt: null,
    lastMigrationVersion: null,
  };
}

/** How far up the migration ladder this database has climbed. */
export async function collectMigrationState(): Promise<MigrationStateInfo> {
  moduleLogger.debug('Collecting migration state');

  const rows = await mainRows<{
    id: string;
    completedAt: string;
    quilltapVersion: string;
  }>(
    `SELECT "id", "completedAt", "quilltapVersion"
     FROM "migrations_state"
     ORDER BY "completedAt" DESC`,
    [],
    'premises.migrationState',
  );

  const latest = rows[0];
  return {
    appliedCount: rows.length,
    lastMigrationId: latest?.id ?? null,
    lastMigrationAt: latest?.completedAt ?? null,
    lastMigrationVersion: latest?.quilltapVersion ?? null,
  };
}
