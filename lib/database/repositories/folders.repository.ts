/**
 * Folders Repository
 *
 * Backend-agnostic repository for Folder entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and specialized queries for folder hierarchy management.
 */

import { Folder, FolderInput, FolderSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { isUniqueConstraintError } from '../sqlite-errors';
import { TypedQueryFilter, QueryOptions } from '../interfaces';

/**
 * Folders Repository
 * Implements CRUD operations for folders with user-scoping and hierarchy management.
 */
export class FoldersRepository extends UserOwnedBaseRepository<Folder> {
  constructor() {
    super('folders', FolderSchema);
  }

  // ============================================================================
  // CORE CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new folder
   * @param data The folder data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Folder> The created folder with generated id and timestamps
   */
  async create(
    data: Omit<FolderInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Folder> {
    return this.safeQuery(
      async () => {
        const folder = await this._create(data, options);

        logger.info('Folder created', {
          folderId: folder.id,
          userId: data.userId,
          path: data.path,
          projectId: data.projectId,
        });

        return folder;
      },
      'Error creating folder',
      { userId: data.userId, path: data.path }
    );
  }

  /**
   * Find-or-create the folder at `path` — **the only sanctioned way to bring a
   * folder row into being for a path that may already have one.**
   *
   * Every caller used to hand-roll `findByPath` → `create`, and each copy had
   * the same two holes (bug 114):
   *
   *   - **The read can fail soft.** `findByPath` swallows query errors and
   *     returns `null` (its `safeQuery` fallback), which a hand-rolled guard
   *     cannot tell apart from "no such folder" — so a read failure mints a
   *     duplicate instead of surfacing. This is not hypothetical: until
   *     c180246b1 (2026-04-17) `FolderSchema.parentFolderId` was `.nullable()`
   *     without `.optional()` while the SQLite hydrator turns a NULL column
   *     into `undefined`, so *every* root-level folder failed validation on
   *     read and every image generation appended another row.
   *   - **The check and the insert are not atomic.** Two background jobs
   *     generating images into the same project run concurrently (the global
   *     in-flight cap is 4), both read `null`, and both insert. In the forked
   *     child it is worse still: writes are buffered and reads use a readonly
   *     connection, so a second job cannot see the first's buffered create at
   *     all. See docs/developer/BACKGROUND_JOBS_CHILD.md.
   *
   * The `(userId, COALESCE(projectId, ''), path)` unique index closes both: the
   * loser of a race takes a constraint violation and resolves to the winning
   * row rather than adding to the pile.
   *
   * In the forked job child this call is **buffered whole** and replayed by the
   * parent on its RW connection (`folders.ensureByPath` is a `write` in the
   * child proxy's `METHOD_OVERRIDES`), so an in-child caller receives the
   * synthetic `undefined` and **must discard the return value**.
   *
   * @param data The folder data; `projectId` null means general files
   * @returns Promise<Folder> The existing or newly created folder
   */
  async ensureByPath(
    data: Omit<FolderInput, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Folder> {
    const projectId = data.projectId ?? null;

    const existing = await this.findByPath(data.userId, data.path, projectId);
    if (existing) {
      return existing;
    }

    try {
      return await this.create({ ...data, projectId });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      // Someone committed this path between our read and our insert. The
      // winning row is committed and visible, so resolve to it.
      const winner = await this.findByPath(data.userId, data.path, projectId);
      if (!winner) {
        // Unique conflict with nothing to reconcile to — surface it rather
        // than silently returning a folder that does not exist.
        throw error;
      }

      logger.debug('Reconciled concurrent folder create to existing folder', {
        userId: data.userId,
        path: data.path,
        projectId,
        folderId: winner.id,
      });

      return winner;
    }
  }

  /**
   * Update a folder
   * @param id The folder ID
   * @param data Partial folder data to update
   * @returns Promise<Folder | null> The updated folder if found, null otherwise
   */
  async update(id: string, data: Partial<Folder>): Promise<Folder | null> {
    return this.safeQuery(
      async () => {
        const updated = await this._update(id, data);

        if (updated) {
          logger.info('Folder updated', { folderId: id });
        } else {
          logger.warn('Folder not found for update', { folderId: id });
        }

        return updated;
      },
      'Error updating folder',
      { folderId: id }
    );
  }

  /**
   * Delete a folder
   * @param id The folder ID
   * @returns Promise<boolean> True if folder was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Folder deleted', { folderId: id });
        } else {
          logger.warn('Folder not found for deletion', { folderId: id });
        }

        return result;
      },
      'Error deleting folder',
      { folderId: id }
    );
  }

  // ============================================================================
  // SPECIALIZED QUERIES
  // ============================================================================

  /**
   * Find a folder by its path within a user's scope
   * @param userId The user ID
   * @param path The folder path (normalized, e.g., "/documents/reports/")
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder | null> The folder if found, null otherwise
   */
  async findByPath(
    userId: string,
    path: string,
    projectId: string | null
  ): Promise<Folder | null> {
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<Folder> = {
          userId,
          path,
          ...this.createNullableFilter('projectId', projectId),
        };

        const result = await this.findOneByFilter(query);

        if (!result) {
          return null;
        }

        return result;
      },
      'Error finding folder by path',
      { userId, path, projectId },
      null
    );
  }

  /**
   * Find direct child folders of a parent folder
   * @param userId The user ID
   * @param parentFolderId The parent folder ID (null for root level)
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of child folders
   */
  async findByParent(
    userId: string,
    parentFolderId: string | null,
    projectId: string | null
  ): Promise<Folder[]> {
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<Folder> = {
          userId,
          parentFolderId,
          ...this.createNullableFilter('projectId', projectId),
        };

        const options: QueryOptions = { sort: { name: 1 } };

        const results = await this.findByFilter(query, options);

        return results;
      },
      'Error finding folders by parent',
      { userId, parentFolderId, projectId },
      []
    );
  }

  /**
   * Find all folders for a user within a project or general files
   * @param userId The user ID
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of all folders in scope
   */
  async findAllInProject(userId: string, projectId: string | null): Promise<Folder[]> {
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<Folder> = {
          userId,
          ...this.createNullableFilter('projectId', projectId),
        };

        const options: QueryOptions = { sort: { path: 1 } };

        const results = await this.findByFilter(query, options);

        return results;
      },
      'Error finding all folders in project',
      { userId, projectId },
      []
    );
  }

  /**
   * Find all descendant folders under a given path
   * @param userId The user ID
   * @param parentPath The parent path (e.g., "/documents/")
   * @param projectId The project ID (null for general files)
   * @returns Promise<Folder[]> Array of descendant folders
   */
  async findDescendants(
    userId: string,
    parentPath: string,
    projectId: string | null
  ): Promise<Folder[]> {
    return this.safeQuery(
      async () => {
        // Prefix-match via JS filter. SQLite's $regex translator cannot express
        // anchored patterns (it always wraps in %…%), so anchored `^parent`
        // regex silently matches nothing. Fetching the user/project slice and
        // filtering in memory keeps the behaviour correct and matches the
        // adjacent file-rename logic in app/api/v1/files/folders/route.ts.
        const all = await this.findAllInProject(userId, projectId);
        return all
          .filter((f) => f.path.startsWith(parentPath) && f.path !== parentPath)
          .sort((a, b) => a.path.localeCompare(b.path));
      },
      'Error finding descendant folders',
      { userId, parentPath, projectId },
      []
    );
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Create multiple folders at once (for migration)
   * @param folders Array of folder data
   * @returns Promise<Folder[]> Array of created folders
   */
  async createMany(
    folders: Array<Omit<FolderInput, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Folder[]> {
    if (folders.length === 0) {
      return [];
    }

    return this.safeQuery(
      async () => {
        const createdFolders: Folder[] = [];

        for (const data of folders) {
          const folder = await this.create(data);
          createdFolders.push(folder);
        }

        logger.info('Folders created in bulk', { count: createdFolders.length });
        return createdFolders;
      },
      'Error creating folders in bulk',
      { count: folders.length }
    );
  }

  /**
   * Update paths for all folders under a renamed parent
   * Used when renaming a folder to update all descendants
   * @param userId The user ID
   * @param oldPathPrefix The old path prefix (e.g., "/old-name/")
   * @param newPathPrefix The new path prefix (e.g., "/new-name/")
   * @param projectId The project ID (null for general files)
   * @returns Promise<number> Number of folders updated
   */
  async updatePathPrefix(
    userId: string,
    oldPathPrefix: string,
    newPathPrefix: string,
    projectId: string | null
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        // Prefix-match via JS filter. See findDescendants for why the
        // $regex → LIKE translator cannot do anchored matches.
        const all = await this.findAllInProject(userId, projectId);
        const foldersToUpdate = all.filter((f) => f.path.startsWith(oldPathPrefix));

        let updatedCount = 0;
        for (const folder of foldersToUpdate) {
          const newPath = folder.path.replace(oldPathPrefix, newPathPrefix);
          await this.update(folder.id, { path: newPath });
          updatedCount++;
        }

        logger.info('Updated folder path prefixes', {
          userId,
          oldPathPrefix,
          newPathPrefix,
          projectId,
          updatedCount,
        });

        return updatedCount;
      },
      'Error updating folder path prefixes',
      { userId, oldPathPrefix, newPathPrefix, projectId }
    );
  }

  /**
   * Check if a folder has any child folders
   * @param folderId The folder ID
   * @returns Promise<boolean> True if folder has children
   */
  async hasChildren(folderId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ parentFolderId: folderId });
        return count > 0;
      },
      'Error checking for child folders',
      { folderId },
      false
    );
  }
}
