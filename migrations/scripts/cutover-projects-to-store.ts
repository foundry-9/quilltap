/**
 * Migration: Project store cutover
 *
 * Collapses the `projects` table down to its slim identity row. After this
 * migration the row holds only `id`, `name`, `officialMountPointId`, and the
 * timestamps; everything else moves into the project's official document store
 * as top-level files:
 *
 *   - description  → description.md
 *   - instructions → instructions.md
 *   - state        → state.json
 *   - the 14 settings fields → properties.json
 *
 * `userId` is dropped entirely — projects become global to the instance
 * (single-user-per-instance). Mirrors the 4.6 character vault cutover
 * (`cutover-characters-to-vault-v1`) deliberately.
 *
 * Per-project procedure: ensure the official store exists, write all four
 * overlay files from the (still-wide) DB row, then re-read and verify them. Any
 * project whose store can't be populated/verified is marked `blocked`.
 *
 * Safety: before any per-project work, take a page-level encrypted snapshot of
 * the three SQLCipher databases unless one younger than 24h already exists. The
 * refusal gate at the end means a single blocked project will halt the column
 * drops; the operator fixes the underlying issue and re-runs. The store-only
 * read overlay has no DB-column fallback, so this migration MUST populate the
 * files before the columns disappear — the count guard + blocking gate enforce
 * that we never drop columns we haven't first migrated.
 *
 * Migration ID: cutover-projects-to-store-v1
 */

import fs from 'fs';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import { reportProgress } from '../lib/progress';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import {
  getMountIndexDatabasePath,
  getLLMLogsDatabasePath,
  getBackupsDir,
} from '../../lib/paths';
import {
  createPhysicalBackup,
  createLLMLogsPhysicalBackup,
  createMountIndexPhysicalBackup,
  parseBackupFilename,
  parseLLMLogsBackupFilename,
  parseMountIndexBackupFilename,
} from '../../lib/database/backends/sqlite/physical-backup';
import { normalizeBackgroundDisplayMode } from '../../lib/schemas/project.types';
import { getRepositories } from '../../lib/repositories/factory';
import { getMountIndexSQLiteClient } from '../../lib/database/backends/sqlite/mount-index-client';
import { loadMountIndexConfig } from '../../lib/database/config';
import { PROJECT_OWN_STORE_NAME_PREFIX } from '../../lib/mount-index/project-store-naming';
import { nextUniqueMountPointName } from '../../lib/mount-index/unique-mount-point-name';
import { writeProjectStoreManagedFields } from '../../lib/projects/project-store/write-overlay';
import { readDatabaseDocument } from '../../lib/mount-index/database-store';
import type { Project } from '../../lib/schemas/project.types';

const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Open an encrypted SQLCipher DB at the given path with the instance's pepper.
 * Returns null if the file doesn't exist. Used by the backup safeguard to get
 * handles for the mount-index and llm-logs databases — `getSQLiteDatabase()`
 * only covers the main DB.
 */
function openEncryptedSQLite(dbPath: string): DatabaseType | null {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath);
  try {
    const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
    if (pepper) {
      const keyHex = Buffer.from(pepper, 'base64').toString('hex');
      db.pragma(`key = "x'${keyHex}'"`);
    }
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (err) {
    try { db.close(); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Returns true if any file under `<dataDir>/backups/` matching the given parse
 * function has a timestamp newer than the cutoff.
 */
function recentBackupExists(
  parseFn: (filename: string) => Date | null,
  maxAgeMs: number,
): boolean {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) return false;
  const cutoff = Date.now() - maxAgeMs;
  for (const filename of fs.readdirSync(backupsDir)) {
    const date = parseFn(filename);
    if (date && date.getTime() >= cutoff) return true;
  }
  return false;
}

/**
 * Ensure a fresh physical backup exists for each SQLCipher database before
 * destructive work. Reuses the same `create*PhysicalBackup()` functions the
 * server invokes at startup (no-op if a backup younger than 24h exists).
 * Throws if the main DB ends up without a recent backup; warns for the
 * recoverable secondary databases.
 */
async function ensureBackupsExist(ctx: { context: string }): Promise<void> {
  const mainDb = getSQLiteDatabase();
  const mainResult = await createPhysicalBackup(mainDb);
  logger.info('Main DB backup', { ...ctx, created: mainResult });
  if (!recentBackupExists(parseBackupFilename, BACKUP_MAX_AGE_MS)) {
    throw new Error('Main DB physical backup is missing and creation failed; aborting before destructive work');
  }

  const mountDb = openEncryptedSQLite(getMountIndexDatabasePath());
  if (mountDb) {
    try {
      const mountResult = await createMountIndexPhysicalBackup(mountDb);
      logger.info('Mount-index DB backup', { ...ctx, created: mountResult });
      if (!recentBackupExists(parseMountIndexBackupFilename, BACKUP_MAX_AGE_MS)) {
        throw new Error('Mount-index DB physical backup is missing and creation failed; aborting before destructive work');
      }
    } finally {
      try { mountDb.close(); } catch { /* ignore */ }
    }
  } else {
    logger.info('Mount-index DB not present on this instance; skipping its backup', ctx);
  }

  const llmDb = openEncryptedSQLite(getLLMLogsDatabasePath());
  if (llmDb) {
    try {
      const llmResult = await createLLMLogsPhysicalBackup(llmDb);
      logger.info('LLM-logs DB backup', { ...ctx, created: llmResult });
      if (!recentBackupExists(parseLLMLogsBackupFilename, BACKUP_MAX_AGE_MS)) {
        logger.warn('LLM-logs DB physical backup missing — proceeding (logs are recoverable)', ctx);
      }
    } finally {
      try { llmDb.close(); } catch { /* ignore */ }
    }
  } else {
    logger.info('LLM-logs DB not present on this instance; skipping its backup', ctx);
  }
}

const MIGRATION_ID = 'cutover-projects-to-store-v1';

/**
 * Files `writeProjectStoreManagedFields` writes unconditionally, so a
 * successfully-populated store always has all four. `properties.json` is the
 * keystone the read overlay hard-requires.
 */
const REQUIRED_STORE_FILES = [
  'properties.json',
  'description.md',
  'instructions.md',
  'state.json',
] as const;

/**
 * Columns dropped at the end of the migration. `userId` is included (projects
 * become global). The index on `userId` is dropped first — SQLite refuses to
 * drop a column that participates in an index.
 */
const COLUMNS_TO_DROP = [
  'userId',
  'description',
  'instructions',
  'state',
  'allowAnyCharacter',
  'characterRoster',
  'color',
  'icon',
  'defaultDisabledTools',
  'defaultDisabledToolGroups',
  'defaultAgentModeEnabled',
  'defaultAvatarGenerationEnabled',
  'defaultImageProfileId',
  'defaultAlertCharactersOfLanternImages',
  'storyBackgroundsEnabled',
  'staticBackgroundImageId',
  'storyBackgroundImageId',
  'backgroundDisplayMode',
] as const;

interface ProjectOutcome {
  id: string;
  name: string;
  action: 'verified' | 'blocked';
  blockedReason?: string;
  mountPointId?: string;
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** SQLite stores tri-state booleans as INTEGER 0/1/NULL. */
function nullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return !!value;
}

/**
 * Map a raw, pre-cutover `projects` row into a hydrated `Project`-shaped object
 * the store writer can consume. Coerces the JSON/INTEGER columns back into JS
 * types so `ProjectPropertiesSchema.parse` (inside the writer) accepts them.
 */
export function mapLegacyProjectRow(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    officialMountPointId: (row.officialMountPointId as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    description: (row.description as string | null) ?? null,
    instructions: (row.instructions as string | null) ?? null,
    state: safeJsonParse(row.state, {} as Record<string, unknown>),
    allowAnyCharacter: !!row.allowAnyCharacter,
    characterRoster: safeJsonParse(row.characterRoster, [] as string[]),
    color: (row.color as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    defaultDisabledTools: safeJsonParse(row.defaultDisabledTools, [] as string[]),
    defaultDisabledToolGroups: safeJsonParse(row.defaultDisabledToolGroups, [] as string[]),
    defaultAgentModeEnabled: nullableBool(row.defaultAgentModeEnabled),
    defaultAvatarGenerationEnabled: nullableBool(row.defaultAvatarGenerationEnabled),
    defaultImageProfileId: (row.defaultImageProfileId as string | null) ?? null,
    defaultAlertCharactersOfLanternImages: nullableBool(row.defaultAlertCharactersOfLanternImages),
    storyBackgroundsEnabled: nullableBool(row.storyBackgroundsEnabled),
    staticBackgroundImageId: (row.staticBackgroundImageId as string | null) ?? null,
    storyBackgroundImageId: (row.storyBackgroundImageId as string | null) ?? null,
    // Retired modes ('project', 'static') normalize to 'theme' — see
    // RETIRED_BACKGROUND_DISPLAY_MODES in lib/schemas/project.types.ts.
    backgroundDisplayMode: (normalizeBackgroundDisplayMode(row.backgroundDisplayMode) ??
      'theme') as Project['backgroundDisplayMode'],
  } as Project;
}

function loadLegacyProjectRows(db: DatabaseType): Project[] {
  const rows = db.prepare('SELECT * FROM projects').all() as Record<string, unknown>[];
  return rows.map(mapLegacyProjectRow);
}

/**
 * Resolve (or create) the official store for a legacy project WITHOUT going
 * through the schema-validating / overlay project read.
 *
 * `ensureProjectOfficialStore` re-reads the project via `repos.projects.*`,
 * which can't handle a legacy wide row mid-migration (boolean-coercion metadata
 * isn't applied this early, so the row fails validation). Like the character
 * cutover, we operate on the raw-loaded row instead.
 *
 * If `officialMountPointId` is set we trust it: the v4.10 migration backfilled
 * it from a real linked store, and the per-project verify step below catches a
 * genuinely-broken pointer (the write/read-back would fail → blocked). We
 * deliberately do NOT probe the mount point via `repos.docMountPoints.findById`
 * here — that read could also mis-validate this early and make us create a
 * duplicate store, orphaning the project's existing files. We only create a
 * fresh store when the pointer is genuinely null.
 */
export async function resolveStoreForLegacyProject(project: Project): Promise<string> {
  if (project.officialMountPointId) {
    return project.officialMountPointId;
  }

  const repos = getRepositories();

  // Create a fresh `Project Files: <name>` store. Mount-index writes are safe
  // mid-migration; the project-row FK update uses raw SQL to avoid the
  // (validating) repository write path.
  const desiredName = `${PROJECT_OWN_STORE_NAME_PREFIX}${(project.name || 'Untitled').trim()}`.slice(0, 200);
  const allMounts = await repos.docMountPoints.findAll();
  const taken = new Set(allMounts.map((mp) => mp.name));
  const finalName = nextUniqueMountPointName(taken, desiredName);

  const mountPoint = await repos.docMountPoints.create({
    name: finalName,
    basePath: '',
    mountType: 'database',
    storeType: 'documents',
    includePatterns: [],
    excludePatterns: ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: true,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });
  await repos.projectDocMountLinks.link(project.id, mountPoint.id);
  getSQLiteDatabase()
    .prepare('UPDATE projects SET officialMountPointId = ?, updatedAt = ? WHERE id = ?')
    .run(mountPoint.id, new Date().toISOString(), project.id);

  return mountPoint.id;
}

async function processOneProject(project: Project): Promise<ProjectOutcome> {
  let mountPointId: string;
  try {
    mountPointId = await resolveStoreForLegacyProject(project);
  } catch (err) {
    return {
      id: project.id,
      name: project.name,
      action: 'blocked',
      blockedReason: `could not ensure official document store: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  await writeProjectStoreManagedFields(mountPointId, {
    ...project,
    officialMountPointId: mountPointId,
  });

  const missing: string[] = [];
  for (const file of REQUIRED_STORE_FILES) {
    try {
      const { content } = await readDatabaseDocument(mountPointId, file);
      if (file === 'properties.json') {
        JSON.parse(content); // must parse for the read overlay
      }
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    return {
      id: project.id,
      name: project.name,
      action: 'blocked',
      blockedReason: `missing/invalid store files: ${missing.join(', ')}`,
      mountPointId,
    };
  }

  return { id: project.id, name: project.name, action: 'verified', mountPointId };
}

export const cutoverProjectsToStoreMigration: Migration = {
  id: MIGRATION_ID,
  description:
    'Move every project\'s content and settings fully into its official document store and drop the legacy DB columns (including userId).',
  introducedInVersion: '4.7.0',
  // `add-doc-mount-file-policy-flags-v1` adds the allowEmbed / allowCharacterRead /
  // allowCharacterWrite columns to doc_mount_file_links. This cutover writes link
  // rows (via writeProjectStoreManagedFields → the doc-mount repos) that reference
  // those columns, so the policy-flags migration MUST run first — otherwise the
  // dependency-free topological order places this cutover before it and every link
  // INSERT fails with "table doc_mount_file_links has no column named allowEmbed"
  // on instances where both migrations are still pending. Depending on it also
  // preserves the frontmatter-driven protection backfill (which an in-place ALTER
  // here would skip).
  dependsOn: ['add-project-official-mount-point-v1', 'add-doc-mount-file-policy-flags-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) return false;
    if (!sqliteTableExists('projects')) return false;
    const cols = getSQLiteTableColumns('projects').map((c) => c.name);
    // Any one of the dropped columns still present means the cutover hasn't
    // happened yet on this instance.
    return COLUMNS_TO_DROP.some((c) => cols.includes(c));
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const outcomes: ProjectOutcome[] = [];
    const ctx = { context: `migration.${MIGRATION_ID}` };

    try {
      logger.info('Ensuring physical backups exist before per-project work', ctx);
      await ensureBackupsExist(ctx);

      // Open the mount-index DB connection explicitly. We write each project's
      // overlay files into its mount-index-backed document store, but the
      // mount-index connection is normally established by the app backend's
      // connect(), which runs *after* migrations. The doc-mount repositories
      // read the connection from a global singleton and never trigger the lazy
      // `getDatabaseAsync()` path that initializes it — only a *main-DB* repo
      // access does that. (The character vault cutover gets the connection for
      // free because it touches a main-DB repo en route; our first store touch
      // is a mount-index repo, so we must open it ourselves first.) Without
      // this, every store write throws "Mount index database not initialized".
      // The app's later connect() reuses this same connection.
      const mountIndexDb = getMountIndexSQLiteClient(loadMountIndexConfig());
      if (!mountIndexDb) {
        const message =
          'Refusing to migrate — the mount-index database could not be opened, so project ' +
          'document stores are unreachable. Aborting before any destructive work.';
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message,
          error: 'mount index unavailable',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const db = getSQLiteDatabase();
      const rawCount = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
      const legacy = loadLegacyProjectRows(db);
      logger.info('Loaded raw project rows for cutover', { ...ctx, count: legacy.length, rawCount });

      // Hard guard against the silent-no-op bug: never drop the legacy columns
      // unless we actually read every project row.
      if (legacy.length !== rawCount) {
        const message =
          `Refusing to drop columns — read ${legacy.length} of ${rawCount} project row(s). ` +
          `Aborting before destructive work to avoid dropping un-migrated project data.`;
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: 0,
          message,
          error: 'project read count mismatch',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      for (let i = 0; i < legacy.length; i++) {
        reportProgress(i + 1, legacy.length, 'projects');
        outcomes.push(await processOneProject(legacy[i]));
      }

      const blocked = outcomes.filter((o) => o.action === 'blocked');
      if (blocked.length > 0) {
        const blockedList = blocked
          .map((o) => `${o.name} (${o.id.slice(0, 8)}): ${o.blockedReason}`)
          .join('; ');
        const message = `Refusing to drop columns — ${blocked.length} project(s) blocked: ${blockedList}`;
        logger.error(message, ctx);
        return {
          id: MIGRATION_ID,
          success: false,
          itemsAffected: outcomes.filter((o) => o.action !== 'blocked').length,
          message,
          error: 'projects blocked from cutover',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Schema mutations: one transaction. Drop the userId index first (SQLite
      // refuses to drop an indexed column), then drop the columns in order.
      const existingCols = new Set(getSQLiteTableColumns('projects').map((c) => c.name));
      const dropping = COLUMNS_TO_DROP.filter((c) => existingCols.has(c));
      logger.info('Dropping legacy columns from projects', { ...ctx, columns: dropping });
      const tx = db.transaction(() => {
        db.exec('DROP INDEX IF EXISTS idx_projects_userId');
        for (const col of dropping) {
          db.exec(`ALTER TABLE projects DROP COLUMN ${col}`);
        }
      });
      tx();

      const message =
        `Project store cutover complete: ${outcomes.length} project(s) migrated, ` +
        `${dropping.length} column(s) dropped.`;
      logger.info(message, ctx);

      return {
        id: MIGRATION_ID,
        success: true,
        itemsAffected: legacy.length,
        message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('cutover-projects-to-store aborted', { ...ctx, error: errorMessage });
      return {
        id: MIGRATION_ID,
        success: false,
        itemsAffected: outcomes.filter((o) => o.action !== 'blocked').length,
        message: 'cutover-projects-to-store aborted',
        error: errorMessage,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
