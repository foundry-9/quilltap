/**
 * Group Character Members Repository
 *
 * Backend-agnostic repository for GroupCharacterMember entities — the
 * many-to-many join table between groups and characters.
 * Overrides getCollection() to route all operations to the dedicated
 * mount index database (quilltap-mount-index.db), co-located with the other
 * group join table (group_doc_mount_links).
 *
 * Note: both groupId and characterId reference rows in the main database
 * (groups.id / characters.id). `findByCharacterId` is the hot path for
 * per-responding-character tier resolution.
 *
 * When the mount index DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, null, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { GroupCharacterMember, GroupCharacterMemberSchema } from '@/lib/schemas/mount-index.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { requireMountIndexDb } from '../backends/sqlite/mount-index-guard';
import { generateDDL, classifySchemaColumns } from '../schema-translator';

/**
 * Group Character Members Repository
 * Implements CRUD operations for the group-to-character join table.
 * Uses the mount index database instead of the main database.
 */
export class GroupCharacterMembersRepository extends AbstractBaseRepository<GroupCharacterMember> {
  private mountIndexCollectionInitialized = false;

  constructor() {
    super('group_character_members', GroupCharacterMemberSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated mount index
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<GroupCharacterMember>> {
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
        logger.error('Failed to ensure group_character_members table in mount index database', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // Detect JSON, array, and boolean columns from schema
    const { jsonColumns, arrayColumns, booleanColumns } = classifySchemaColumns(this.collectionName, this.schema);

    return new SQLiteCollection<GroupCharacterMember>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<GroupCharacterMember, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<GroupCharacterMember> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<GroupCharacterMember>): Promise<GroupCharacterMember | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all memberships for a group.
   * @param groupId The group ID
   * @returns Promise<GroupCharacterMember[]> Array of memberships for the group
   */
  async findByGroupId(groupId: string): Promise<GroupCharacterMember[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { groupId } as TypedQueryFilter<GroupCharacterMember>
        );
        return results;
      },
      'Error finding group memberships by group ID',
      { groupId },
      []
    );
  }

  /**
   * Find all memberships for a character. Hot path for tier resolution.
   * @param characterId The character ID
   * @returns Promise<GroupCharacterMember[]> Array of memberships for the character
   */
  async findByCharacterId(characterId: string): Promise<GroupCharacterMember[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { characterId } as TypedQueryFilter<GroupCharacterMember>
        );
        return results;
      },
      'Error finding group memberships by character ID',
      { characterId },
      []
    );
  }

  /**
   * Add a character to a group.
   * Checks for an existing membership first to prevent duplicates.
   *
   * @param groupId The group ID
   * @param characterId The character ID
   * @returns Promise<GroupCharacterMember> The existing or newly created membership
   */
  async addMember(groupId: string, characterId: string): Promise<GroupCharacterMember> {
    return this.safeQuery(
      async () => {

        // Check for existing membership to avoid duplicates
        const existing = await this.findOneByFilter({
          groupId,
          characterId,
        } as TypedQueryFilter<GroupCharacterMember>);

        if (existing) {
          return existing;
        }

        const member = await this._create({
          groupId,
          characterId,
        } as Omit<GroupCharacterMember, 'id' | 'createdAt' | 'updatedAt'>);

        return member;
      },
      'Error adding character to group',
      { groupId, characterId }
    );
  }

  /**
   * Remove a character from a group.
   * Deletes the membership matching both groupId and characterId.
   *
   * @param groupId The group ID
   * @param characterId The character ID
   * @returns Promise<boolean> True if a membership was deleted, false if none existed
   */
  async removeMember(groupId: string, characterId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {

        const count = await this.deleteMany({
          groupId,
          characterId,
        } as TypedQueryFilter<GroupCharacterMember>);

        const deleted = count > 0;

        return deleted;
      },
      'Error removing character from group',
      { groupId, characterId }
    );
  }

  /**
   * Delete every membership for a group (used when a group is deleted).
   *
   * @param groupId The group ID
   * @returns Promise<number> Number of membership rows removed
   */
  async deleteByGroupId(groupId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        return this.deleteMany({ groupId } as TypedQueryFilter<GroupCharacterMember>);
      },
      'Error deleting memberships by group ID',
      { groupId },
      0
    );
  }
}
