/**
 * Embedding Status Repository
 *
 * Repository for tracking embedding status of entities (memories, files, etc.).
 * Used to monitor which items need embedding and handle failures.
 */

import { logger } from '@/lib/logger';
import {
  EmbeddingStatus,
  EmbeddingStatusSchema,
  EmbeddingStatusValue,
  EmbeddableEntityType,
} from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';

/**
 * Embedding Status Repository
 *
 * Manages embedding status tracking for entities.
 */
export class EmbeddingStatusRepository extends AbstractBaseRepository<EmbeddingStatus> {
  constructor() {
    super('embedding_status', EmbeddingStatusSchema);
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Find status by ID
   */
  async findById(id: string): Promise<EmbeddingStatus | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.findOne({ id });
      },
      'Error finding embedding status by ID',
      { id },
      null
    );
  }

  /**
   * Find all status records
   */
  async findAll(): Promise<EmbeddingStatus[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.find({});
      },
      'Error finding all embedding statuses',
      {},
      []
    );
  }

  /**
   * Find status by entity
   */
  async findByEntity(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string
  ): Promise<EmbeddingStatus | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.findOne({
          entityType,
          entityId,
          profileId,
        });
      },
      'Error finding embedding status by entity',
      { entityType, entityId, profileId },
      null
    );
  }

  /**
   * Find all statuses for a user
   */
  async findByUserId(userId: string): Promise<EmbeddingStatus[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.find({ userId });
      },
      'Error finding embedding statuses by user ID',
      { userId },
      []
    );
  }

  /**
   * Find all statuses for a profile
   */
  async findByProfileId(profileId: string): Promise<EmbeddingStatus[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.find({ profileId });
      },
      'Error finding embedding statuses by profile ID',
      { profileId },
      []
    );
  }

  /**
   * Find all pending statuses for a profile
   */
  async findPendingByProfileId(profileId: string): Promise<EmbeddingStatus[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.find({
          profileId,
          status: 'PENDING',
        });
      },
      'Error finding pending embedding statuses',
      { profileId },
      []
    );
  }

  /**
   * Entity ids of a given type marked FAILED for a profile, as a Set.
   *
   * Used by the mismatched-dim reindex scope and the startup dimension
   * reconcile to exclude deterministically-unembeddable rows (oversize,
   * over-context, NaN inputs) — without this, every boot would re-enqueue
   * and re-pay for the same guaranteed failures.
   */
  async listFailedEntityIds(
    entityType: EmbeddableEntityType,
    profileId: string
  ): Promise<Set<string>> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const rows = await collection.find({
          entityType,
          profileId,
          status: 'FAILED',
        });
        return new Set(rows.map((r) => r.entityId));
      },
      'Error listing FAILED embedding-status entity ids',
      { entityType, profileId },
      new Set<string>()
    );
  }

  /**
   * Find all statuses with a specific status value
   */
  async findByStatus(status: EmbeddingStatusValue): Promise<EmbeddingStatus[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        return await collection.find({ status });
      },
      'Error finding embedding statuses by status',
      { status },
      []
    );
  }

  /**
   * Create a new status record
   */
  async create(
    data: Omit<EmbeddingStatus, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<EmbeddingStatus> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const status: EmbeddingStatus = {
          id: options?.id || this.generateId(),
          ...data,
          createdAt: options?.createdAt || now,
          updatedAt: now,
        };

        const validated = this.validate(status);
        await collection.insertOne(validated);

        return validated;
      },
      'Error creating embedding status',
      { entityType: data.entityType, entityId: data.entityId, profileId: data.profileId }
    );
  }

  /**
   * Update a status record
   */
  async update(id: string, data: Partial<EmbeddingStatus>): Promise<EmbeddingStatus | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        // Remove immutable fields
        const updateData = { ...data };
        delete updateData.id;
        delete updateData.createdAt;

        const result = await collection.updateOne(
          { id },
          { $set: { ...updateData, updatedAt: now } }
        );

        if (result.modifiedCount === 0) {
          return null;
        }

        return this.findById(id);
      },
      'Error updating embedding status',
      { id }
    );
  }

  /**
   * Upsert status by entity (create or update)
   */
  async upsertByEntity(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string,
    data: Partial<Omit<EmbeddingStatus, 'id' | 'createdAt' | 'updatedAt' | 'entityType' | 'entityId' | 'profileId'>>
  ): Promise<EmbeddingStatus> {
    const existing = await this.findByEntity(entityType, entityId, profileId);

    if (existing) {
      const updated = await this.update(existing.id, data);
      if (!updated) {
        throw new Error(`Failed to update embedding status for ${entityType} ${entityId}`);
      }
      return updated;
    }

    return this.create({
      userId: data.userId || '',
      entityType,
      entityId,
      profileId,
      status: data.status || 'PENDING',
      embeddedAt: data.embeddedAt,
      error: data.error,
    });
  }

  /**
   * Mark entity as embedded.
   *
   * Upserts: creates the status row when none exists for
   * (entityType, entityId, profileId). The old find-then-update shape silently
   * returned null for entities that never got a PENDING row — which, after the
   * enqueue-time upsert paths were removed (see scheduleEmbedding's removal in
   * lib/embedding/embedding-job-scheduler.ts and the reindex batch-insert
   * refactor), was *every* newly-minted entity — so EMBEDDED/FAILED outcomes
   * were lost without an error. `userId` is required for row creation; the
   * embedding-generate handler passes `job.userId`.
   */
  async markAsEmbedded(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string,
    userId: string
  ): Promise<EmbeddingStatus | null> {
    const existing = await this.findByEntity(entityType, entityId, profileId);
    if (existing) {
      return this.update(existing.id, {
        status: 'EMBEDDED',
        embeddedAt: this.getCurrentTimestamp(),
        error: null,
      });
    }

    logger.debug('Creating embedding status row on markAsEmbedded (no existing row)', {
      context: 'EmbeddingStatusRepository.markAsEmbedded',
      entityType,
      entityId,
      profileId,
    });
    return this.create({
      userId,
      entityType,
      entityId,
      profileId,
      status: 'EMBEDDED',
      embeddedAt: this.getCurrentTimestamp(),
      error: null,
    });
  }

  /**
   * Mark entity as failed.
   *
   * Upserts for the same reason as {@link markAsEmbedded} — a permanent
   * embedding failure must land a FAILED row even when no PENDING row was ever
   * created, or the startup reconcile re-attempts the same unembeddable entity
   * on every boot.
   */
  async markAsFailed(
    entityType: EmbeddableEntityType,
    entityId: string,
    profileId: string,
    error: string,
    userId: string
  ): Promise<EmbeddingStatus | null> {
    const existing = await this.findByEntity(entityType, entityId, profileId);
    if (existing) {
      return this.update(existing.id, {
        status: 'FAILED',
        error,
      });
    }

    logger.debug('Creating embedding status row on markAsFailed (no existing row)', {
      context: 'EmbeddingStatusRepository.markAsFailed',
      entityType,
      entityId,
      profileId,
    });
    return this.create({
      userId,
      entityType,
      entityId,
      profileId,
      status: 'FAILED',
      embeddedAt: null,
      error,
    });
  }

  /**
   * Mark all entities as pending for a profile (for re-embedding)
   */
  async markAllPendingByProfileId(profileId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const result = await collection.updateMany(
          { profileId },
          {
            $set: {
              status: 'PENDING',
              embeddedAt: null,
              error: null,
              updatedAt: now,
            },
          }
        );

        logger.info('Marked all embeddings as pending for profile', {
          context: 'EmbeddingStatusRepository.markAllPendingByProfileId',
          profileId,
          modifiedCount: result.modifiedCount,
        });

        return result.modifiedCount;
      },
      'Error marking all embeddings as pending',
      { profileId }
    );
  }

  /**
   * Delete a status record
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const result = await collection.deleteOne({ id });

        if (result.deletedCount > 0) {
          return true;
        }

        return false;
      },
      'Error deleting embedding status',
      { id }
    );
  }

  /**
   * Delete status by entity
   */
  async deleteByEntity(
    entityType: EmbeddableEntityType,
    entityId: string
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const result = await collection.deleteMany({
          entityType,
          entityId,
        });

        return result.deletedCount;
      },
      'Error deleting embedding status by entity',
      { entityType, entityId }
    );
  }

  /**
   * Delete all statuses for a profile
   */
  async deleteByProfileId(profileId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const result = await collection.deleteMany({ profileId });

        if (result.deletedCount > 0) {
          logger.info('Embedding statuses deleted by profile ID', {
            context: 'EmbeddingStatusRepository.deleteByProfileId',
            profileId,
            deletedCount: result.deletedCount,
          });
        }

        return result.deletedCount;
      },
      'Error deleting embedding statuses by profile ID',
      { profileId }
    );
  }

  /**
   * Get embedding statistics for a profile
   */
  async getStatsByProfileId(profileId: string): Promise<{
    total: number;
    pending: number;
    embedded: number;
    failed: number;
  }> {
    return this.safeQuery(
      async () => {
        const statuses = await this.findByProfileId(profileId);

        const stats = {
          total: statuses.length,
          pending: 0,
          embedded: 0,
          failed: 0,
        };

        for (const status of statuses) {
          switch (status.status) {
            case 'PENDING':
              stats.pending++;
              break;
            case 'EMBEDDED':
              stats.embedded++;
              break;
            case 'FAILED':
              stats.failed++;
              break;
          }
        }

        return stats;
      },
      'Error getting embedding stats',
      { profileId },
      { total: 0, pending: 0, embedded: 0, failed: 0 }
    );
  }
}
