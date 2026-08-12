/**
 * Document Mount Folders Repository
 *
 * Manages explicit folder rows for database-backed mount points. Filesystem-backed
 * stores derive folder structure from the OS; database-backed stores maintain folders
 * as first-class rows with parent pointers and denormalised paths for fast lookup.
 *
 * When the mount index DB is in degraded mode, getCollection() throws and all
 * safeQuery fallbacks kick in — matching the pattern used by other mount-index repos.
 */

import { logger } from '@/lib/logger';
import { DocMountFolder, DocMountFolderSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';
import { ensureFolderNocaseUniqueIndex } from './mount-index-case-repair';

/**
 * Document Mount Folders Repository
 * Implements CRUD operations and queries for document mount folders.
 * Uses the mount index database instead of the main database.
 */
export class DocMountFoldersRepository extends AbstractBaseRepository<DocMountFolder> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_folders', DocMountFolderSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountFolder>> {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }

    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    // Ensure the table exists in the mount index DB on first access.
    // CRITICAL: set `mountIndexCollectionInitialized = true` after DDL but
    // BEFORE the folder backfill runs. The backfill calls `ensureFolderPath`,
    // which calls back into this repo's `getCollection`; if the flag isn't
    // set yet, the recursive call re-enters the init block and re-runs the
    // backfill, recursively forever. Setting the flag first lets the
    // recursive calls get a valid `SQLiteCollection` and proceed.
    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        // Case-insensitive unique constraint on (mountPointId, parentId, name):
        // sibling folders may never differ only by casing. Runs a repair scan
        // every init (catching out-of-band edits, and swapping out the legacy
        // case-sensitive index on older databases) before guaranteeing the
        // NOCASE index.
        ensureFolderNocaseUniqueIndex(db);

        // Fast path lookup by (mountPointId, path)
        db.exec(
          `CREATE INDEX IF NOT EXISTS "idx_${this.collectionName}_mp_path" ` +
          `ON "${this.collectionName}" ("mountPointId", "path")`
        );

        // Mark the collection initialized BEFORE the backfill so re-entrant
        // calls from inside `ensureFolderPath` (which the backfill invokes)
        // skip this entire block and don't recurse into the backfill.
        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_folders table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // Check PRAGMA user_version to determine if backfill is needed.
      // Run AFTER the init flag is set so any recursion (via ensureFolderPath)
      // sees a ready collection. The user_version bump is the source of truth
      // for "backfill has run on this DB" across process restarts.
      try {
        const versionResult = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
        const currentVersion = versionResult?.user_version ?? 0;

        if (currentVersion < 1) {
          // Optimistically bump user_version FIRST so that even if this
          // process is killed mid-backfill, the next start doesn't repeat
          // the same partial work. A missed-folder backfill row is a
          // tolerable downside; an infinite-loop OOM is not.
          db.exec('PRAGMA user_version = 1');

          const repos = await import('@/lib/repositories/factory').then(m => m.getRepositories());
          const mounts = await repos.docMountPoints.findAll();
          const dbBackedMounts = mounts.filter(m => m.mountType === 'database');

          for (const mount of dbBackedMounts) {
            try {
              const { backfillFolderRowsForMountPoint } = await import('@/lib/mount-index/database-store');
              await backfillFolderRowsForMountPoint(mount.id);
            } catch (err) {
              logger.warn('Failed to backfill folder rows for mount point', {
                mountPointId: mount.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn('Failed to run folder backfill', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Detect JSON, array, and boolean columns from schema
    const metadata = extractSchemaMetadata(this.collectionName, this.schema);
    const jsonColumns = metadata.fields
      .filter(f => f.type === 'array' || f.type === 'object')
      .map(f => f.name);
    const arrayColumns = metadata.fields
      .filter(f => f.type === 'array')
      .map(f => f.name);
    const booleanColumns = metadata.fields
      .filter(f => f.type === 'boolean')
      .map(f => f.name);

    return new SQLiteCollection<DocMountFolder>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountFolder, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountFolder> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountFolder>): Promise<DocMountFolder | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find a folder by mount point and relative path. Case-insensitive with an
   * exact-match fast path: the folder namespace is case-insensitive (sibling
   * names are unique except by casing), so `Lore/Maps` resolves the folder
   * stored as `lore/maps`. Matches the LOWER()-based file-path lookups.
   * @param mountPointId The mount point ID
   * @param path The relative path ('' for root)
   * @returns Promise<DocMountFolder | null> The folder if found
   */
  async findByMountPointAndPath(
    mountPointId: string,
    path: string
  ): Promise<DocMountFolder | null> {
    return this.safeQuery(
      async () => {
        const exact = await this.findOneByFilter({
          mountPointId,
          path,
        } as TypedQueryFilter<DocMountFolder>);
        if (exact) return exact;
        const needle = path.toLowerCase();
        const all = await this.findByFilter({
          mountPointId,
        } as TypedQueryFilter<DocMountFolder>);
        return all.find(f => f.path.toLowerCase() === needle) ?? null;
      },
      'Error finding folder by mount point and path',
      { mountPointId, path },
      null
    );
  }

  /**
   * Find all child folders for a given parent folder.
   * @param mountPointId The mount point ID
   * @param parentId The parent folder ID (or null for root children)
   * @returns Promise<DocMountFolder[]> Array of child folders
   */
  async findChildren(
    mountPointId: string,
    parentId: string | null
  ): Promise<DocMountFolder[]> {
    return this.safeQuery(
      async () =>
        this.findByFilter({
          mountPointId,
          parentId,
        } as TypedQueryFilter<DocMountFolder>),
      'Error finding child folders',
      { mountPointId, parentId },
      []
    );
  }

  /**
   * Find all folders for a mount point.
   * @param mountPointId The mount point ID
   * @returns Promise<DocMountFolder[]> Array of all folders in the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<DocMountFolder[]> {
    return this.safeQuery(
      async () =>
        this.findByFilter({
          mountPointId,
        } as TypedQueryFilter<DocMountFolder>),
      'Error finding folders by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Delete all folders for a mount point.
   * @param mountPointId The mount point ID
   * @returns Promise<void>
   */
  async deleteByMountPointId(mountPointId: string): Promise<void> {
    return this.safeQuery(
      async () => {
        await this.deleteMany({
          mountPointId,
        } as TypedQueryFilter<DocMountFolder>);
      },
      'Error deleting folders by mount point ID',
      { mountPointId }
    );
  }
}
