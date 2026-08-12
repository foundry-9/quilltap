/**
 * Group Document Mount Links Repository
 *
 * Backend-agnostic repository for GroupDocMountLink entities.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), isolating document
 * mount tracking data from the main database.
 *
 * GroupDocMountLink is a join table linking groups to their *additional linked*
 * mount points (the official store is recorded on the group row as
 * officialMountPointId, not here).
 * Note: the groupId references a group in the main database — the
 * link itself lives in the mount index DB for co-location with mount data.
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { GroupDocMountLink, GroupDocMountLinkSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '../backends/sqlite/mount-index-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

/**
 * Group Document Mount Links Repository
 * Implements CRUD operations for the group-to-mount-point join table.
 * Uses the mount index database instead of the main database.
 */
export class GroupDocMountLinksRepository extends AbstractBaseRepository<GroupDocMountLink> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('group_doc_mount_links', GroupDocMountLinkSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<GroupDocMountLink>> {
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
        this.mountIndexCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure group_doc_mount_links table in mount index database', {
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

    return new SQLiteCollection<GroupDocMountLink>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<GroupDocMountLink, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<GroupDocMountLink> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<GroupDocMountLink>): Promise<GroupDocMountLink | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all links for a group
   * @param groupId The group ID
   * @returns Promise<GroupDocMountLink[]> Array of links for the group
   */
  async findByGroupId(groupId: string): Promise<GroupDocMountLink[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { groupId } as TypedQueryFilter<GroupDocMountLink>
        );
        return results;
      },
      'Error finding links by group ID',
      { groupId },
      []
    );
  }

  /**
   * Find all links for a mount point
   * @param mountPointId The mount point ID
   * @returns Promise<GroupDocMountLink[]> Array of links for the mount point
   */
  async findByMountPointId(mountPointId: string): Promise<GroupDocMountLink[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { mountPointId } as TypedQueryFilter<GroupDocMountLink>
        );
        return results;
      },
      'Error finding links by mount point ID',
      { mountPointId },
      []
    );
  }

  /**
   * Link a group to a mount point.
   * Checks for existing link first to prevent duplicates.
   *
   * @param groupId The group ID
   * @param mountPointId The mount point ID
   * @returns Promise<GroupDocMountLink> The existing or newly created link
   */
  async link(groupId: string, mountPointId: string): Promise<GroupDocMountLink> {
    return this.safeQuery(
      async () => {

        // Check for existing link to avoid duplicates
        const existing = await this.findOneByFilter({
          groupId,
          mountPointId,
        } as TypedQueryFilter<GroupDocMountLink>);

        if (existing) {
          return existing;
        }

        const link = await this._create({
          groupId,
          mountPointId,
        } as Omit<GroupDocMountLink, 'id' | 'createdAt' | 'updatedAt'>);

        return link;
      },
      'Error linking group to mount point',
      { groupId, mountPointId }
    );
  }

  /**
   * Unlink a group from a mount point.
   * Deletes the link record matching both groupId and mountPointId.
   *
   * @param groupId The group ID
   * @param mountPointId The mount point ID
   * @returns Promise<boolean> True if a link was deleted, false if none existed
   */
  async unlink(groupId: string, mountPointId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {

        const count = await this.deleteMany({
          groupId,
          mountPointId,
        } as TypedQueryFilter<GroupDocMountLink>);

        const deleted = count > 0;

        return deleted;
      },
      'Error unlinking group from mount point',
      { groupId, mountPointId }
    );
  }

  /**
   * Delete every link for a group (used when a group is deleted).
   *
   * @param groupId The group ID
   * @returns Promise<number> Number of link rows removed
   */
  async deleteByGroupId(groupId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        return this.deleteMany({ groupId } as TypedQueryFilter<GroupDocMountLink>);
      },
      'Error deleting links by group ID',
      { groupId },
      0
    );
  }

  /**
   * Delete every link that points at a mount point (used when a store is
   * deleted). The sibling of {@link deleteByGroupId} on the mount-point axis —
   * without it, deleting a store left its group's additional-store links
   * standing (Bug 9).
   *
   * @param mountPointId The mount point ID
   * @returns Promise<number> Number of link rows removed
   */
  async deleteByMountPointId(mountPointId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        return this.deleteMany({ mountPointId } as TypedQueryFilter<GroupDocMountLink>);
      },
      'Error deleting group links by mount point ID',
      { mountPointId },
      0
    );
  }
}
