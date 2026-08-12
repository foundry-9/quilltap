/**
 * Document Mount Points Repository
 *
 * Backend-agnostic repository for DocMountPoint entities.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), isolating document
 * mount tracking data from the main database.
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { DocMountPoint, DocMountPointSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';
import { repairMountPointNameCollisions } from './mount-index-case-repair';

/**
 * Document Mount Points Repository
 * Implements CRUD operations and queries for document mount points.
 * Uses the mount index database instead of the main database.
 */
export class DocMountPointsRepository extends AbstractBaseRepository<DocMountPoint> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('doc_mount_points', DocMountPointSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<DocMountPoint>> {
    if (isMountIndexDegraded()) {
      throw new Error('Mount index database is in degraded mode');
    }

    const db = getRawMountIndexDatabase();
    if (!db) {
      throw new Error('Mount index database not initialized');
    }

    // Ensure the table exists in the mount index DB on first access
    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }

        // Migration: add totalSizeBytes column if missing (added after initial schema)
        const columns = db.pragma(`table_info(${this.collectionName})`) as Array<{ name: string }>;
        if (!columns.some(c => c.name === 'totalSizeBytes')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "totalSizeBytes" INTEGER NOT NULL DEFAULT 0`);
          logger.info('Migrated doc_mount_points: added totalSizeBytes column');
        }

        // Migration: add conversionStatus / conversionError for storage-backend
        // conversion tracking (filesystem ↔ database). Default 'idle' preserves
        // existing behaviour for rows created before this feature shipped.
        if (!columns.some(c => c.name === 'conversionStatus')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "conversionStatus" TEXT NOT NULL DEFAULT 'idle'`);
          logger.info('Migrated doc_mount_points: added conversionStatus column');
        }
        if (!columns.some(c => c.name === 'conversionError')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "conversionError" TEXT DEFAULT NULL`);
          logger.info('Migrated doc_mount_points: added conversionError column');
        }

        // Migration: add storeType to classify stores by content kind
        // ('documents' | 'character'). Default 'documents' preserves existing rows.
        if (!columns.some(c => c.name === 'storeType')) {
          db.exec(`ALTER TABLE "${this.collectionName}" ADD COLUMN "storeType" TEXT NOT NULL DEFAULT 'documents'`);
          logger.info('Migrated doc_mount_points: added storeType column');
        }

        // Repair: mount-point names form one case-insensitive namespace.
        // Runs every init (cheap no-op scan when the invariant holds) so
        // duplicates that slip in through a backup restore of legacy data
        // get suffixed on the next boot. No DB unique index here — restore
        // must be able to recreate legacy rows verbatim before this runs.
        repairMountPointNameCollisions(db);

        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure doc_mount_points table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
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

    return new SQLiteCollection<DocMountPoint>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<DocMountPoint, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<DocMountPoint> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<DocMountPoint>): Promise<DocMountPoint | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all enabled mount points
   * @returns Promise<DocMountPoint[]> Array of enabled mount points
   */
  async findEnabled(): Promise<DocMountPoint[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { enabled: true } as TypedQueryFilter<DocMountPoint>
        );
        return results;
      },
      'Error finding enabled mount points',
      {},
      []
    );
  }

  /**
   * Find enabled mount points whose name matches (case-insensitive, trimmed).
   * Names are kept unique (case-insensitively) at the write chokepoints and by
   * the boot-time repair, but there is no DB constraint — a restore of legacy
   * data can hold duplicates until the next boot — so this still returns an
   * array. Producers use the count to decide whether a `qtap://` URI can
   * safely use the readable name form or must fall back to the UUID escape
   * hatch (see `formatDocStoreUri`).
   * @param name The mount-point name to match
   * @returns Promise<DocMountPoint[]> Matching enabled mount points
   */
  async findByName(name: string): Promise<DocMountPoint[]> {
    return this.safeQuery(
      async () => {
        const enabled = await this.findEnabled();
        const needle = name.trim().toLowerCase();
        return enabled.filter(mp => mp.name.trim().toLowerCase() === needle);
      },
      'Error finding mount points by name',
      { name },
      []
    );
  }

  /**
   * Count enabled mount points whose name matches (case-insensitive). A result
   * greater than 1 means the name is ambiguous and a `qtap://` URI must use the
   * mount-point UUID rather than the name.
   * @param name The mount-point name to match
   * @returns Promise<number> Count of matching enabled mount points
   */
  async countByName(name: string): Promise<number> {
    const matches = await this.findByName(name);
    return matches.length;
  }

  /**
   * Update scan results after a successful scan
   * @param id The mount point ID
   * @param fileCount Number of active files found
   * @param chunkCount Number of chunks generated
   * @param totalSizeBytes Total size of all files in bytes
   */
  async updateLastScanned(id: string, fileCount: number, chunkCount: number, totalSizeBytes: number): Promise<void> {
    await this.safeQuery(
      async () => {
        const updated = await this._update(id, {
          lastScannedAt: this.getCurrentTimestamp(),
          scanStatus: 'idle',
          fileCount,
          chunkCount,
          totalSizeBytes,
        } as Partial<DocMountPoint>);

        if (!updated) {
          throw new Error(`Mount point not found for scan update: ${id}`);
        }
      },
      'Error updating last scanned for mount point',
      { id, fileCount, chunkCount, totalSizeBytes }
    );
  }

  /**
   * Recompute and update cached stats (fileCount, chunkCount, totalSizeBytes)
   * from the actual file and chunk records. Called after single-file reindexing
   * to keep summary stats accurate without requiring a full scan.
   */
  async refreshStats(id: string): Promise<void> {
    await this.safeQuery(
      async () => {
        const { getRepositories } = await import('./index');
        const repos = getRepositories();

        const files = await repos.docMountFiles.findByMountPointId(id);
        const chunks = await repos.docMountChunks.findByMountPointId(id);

        const fileCount = files.length;
        const chunkCount = chunks.length;
        const totalSizeBytes = files.reduce((sum, f) => sum + (f.fileSizeBytes || 0), 0);

        await this._update(id, {
          fileCount,
          chunkCount,
          totalSizeBytes,
        } as Partial<DocMountPoint>);
      },
      'Error refreshing mount point stats',
      { id }
    );
  }

  /**
   * Update the backend-storage conversion status of a mount point
   * (filesystem ↔ database). Use this to drive UI badges during Convert /
   * Deconvert operations and to record failure messages on error.
   */
  async updateConversionStatus(
    id: string,
    status: 'idle' | 'converting' | 'deconverting' | 'error',
    error?: string
  ): Promise<void> {
    await this.safeQuery(
      async () => {

        const updateData: Partial<DocMountPoint> = {
          conversionStatus: status,
        };
        if (status === 'error' && error) {
          updateData.conversionError = error;
        } else if (status !== 'error') {
          updateData.conversionError = null;
        }

        const updated = await this._update(id, updateData);

        if (!updated) {
          throw new Error(`Mount point not found for conversion status update: ${id}`);
        }
      },
      'Error updating conversion status for mount point',
      { id, status }
    );
  }

  /**
   * Update the scan status of a mount point
   * @param id The mount point ID
   * @param status The new scan status
   * @param error Optional error message when status is 'error'
   */
  async updateScanStatus(
    id: string,
    status: 'idle' | 'scanning' | 'error',
    error?: string
  ): Promise<void> {
    await this.safeQuery(
      async () => {

        const updateData: Partial<DocMountPoint> = {
          scanStatus: status,
        };
        if (status === 'error' && error) {
          updateData.lastScanError = error;
        } else if (status !== 'error') {
          updateData.lastScanError = null;
        }

        const updated = await this._update(id, updateData);

        if (!updated) {
          throw new Error(`Mount point not found for status update: ${id}`);
        }
      },
      'Error updating scan status for mount point',
      { id, status }
    );
  }
}
