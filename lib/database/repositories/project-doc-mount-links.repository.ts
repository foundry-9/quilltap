/**
 * Project Document Mount Links Repository
 *
 * Backend-agnostic repository for ProjectDocMountLink entities.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), isolating document
 * mount tracking data from the main database.
 *
 * ProjectDocMountLink is a join table linking projects to mount points.
 * Note: the projectId references a project in the main database — the
 * link itself lives in the mount index DB for co-location with mount data.
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { ProjectDocMountLink, ProjectDocMountLinkSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';
import { generateDDL, classifySchemaColumns } from '../schema-translator';

/**
 * Project Document Mount Links Repository
 * Implements CRUD operations for the project-to-mount-point join table.
 * Uses the mount index database instead of the main database.
 */
export class ProjectDocMountLinksRepository extends AbstractBaseRepository<ProjectDocMountLink> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('project_doc_mount_links', ProjectDocMountLinkSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<ProjectDocMountLink>> {
    const db = requireMountIndexDb();

    // Ensure the table exists in the mount index DB on first access
    if (!this.mountIndexCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }
        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure project_doc_mount_links table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Detect JSON, array, and boolean columns from schema
    const { jsonColumns, arrayColumns, booleanColumns } = classifySchemaColumns(this.collectionName, this.schema);

    return new SQLiteCollection<ProjectDocMountLink>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<ProjectDocMountLink, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ProjectDocMountLink> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ProjectDocMountLink>): Promise<ProjectDocMountLink | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all links for a project
   * @param projectId The project ID
   * @returns Promise<ProjectDocMountLink[]> Array of links for the project
   */
  async findByProjectId(projectId: string): Promise<ProjectDocMountLink[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { projectId } as TypedQueryFilter<ProjectDocMountLink>
        );
        return results;
      },
      'Error finding links by project ID',
      { projectId },
      []
    );
  }

  /**
   * Find all links for a mount point
   * @param mountPointId The mount point ID
   * @returns Promise<ProjectDocMountLink[]> Array of links for the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<ProjectDocMountLink[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { mountPointId } as TypedQueryFilter<ProjectDocMountLink>
        );
        return results;
      },
      'Error finding links by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Link a project to a mount point.
   * Checks for existing link first to prevent duplicates.
   *
   * @param projectId The project ID
   * @param mountPointId The mount point ID
   * @returns Promise<ProjectDocMountLink> The existing or newly created link
   */
  async link(projectId: string, mountPointId: string): Promise<ProjectDocMountLink> {
    return this.safeQuery(
      async () => {

        // Check for existing link to avoid duplicates
        const existing = await this.findOneByFilter({
          projectId,
          mountPointId,
        } as TypedQueryFilter<ProjectDocMountLink>);

        if (existing) {
          return existing;
        }

        const link = await this._create({
          projectId,
          mountPointId,
        } as Omit<ProjectDocMountLink, 'id' | 'createdAt' | 'updatedAt'>);

        return link;
      },
      'Error linking project to mount point',
      { projectId, mountPointId }
    );
  }

  /**
   * Unlink a project from a mount point.
   * Deletes the link record matching both projectId and mountPointId.
   *
   * @param projectId The project ID
   * @param mountPointId The mount point ID
   * @returns Promise<boolean> True if a link was deleted, false if none existed
   */
  async unlink(projectId: string, mountPointId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {

        const count = await this.deleteMany({
          projectId,
          mountPointId,
        } as TypedQueryFilter<ProjectDocMountLink>);

        const deleted = count > 0;

        return deleted;
      },
      'Error unlinking project from mount point',
      { projectId, mountPointId }
    );
  }
}
