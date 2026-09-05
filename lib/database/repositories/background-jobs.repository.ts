/**
 * Background Jobs Repository
 *
 * Backend-agnostic repository for BackgroundJob entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and queue-specific queries for BackgroundJob entities.
 * Provides atomic job claiming for concurrent-safe queue processing.
 */

import { BackgroundJob, BackgroundJobSchema, BackgroundJobType, BackgroundJobStatus } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';
import {
  ACTIVITY_KINDS,
  JOB_TYPE_ACTIVITY,
  emptyActivityCounts,
  type ActivityKind,
} from '@/lib/background-jobs/activity-kinds';

/**
 * Statistics about the job queue
 */
export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  paused: number;
}

/**
 * Background Jobs Repository
 * Implements CRUD operations and queue-specific methods for background jobs.
 */
export class BackgroundJobsRepository extends UserOwnedBaseRepository<BackgroundJob> {
  constructor() {
    super('background_jobs', BackgroundJobSchema);
  }

  /**
   * Find a job by ID
   */
  async findById(id: string): Promise<BackgroundJob | null> {
    return this._findById(id);
  }

  /**
   * Find all jobs (use with caution - primarily for admin/debugging)
   */
  async findAll(): Promise<BackgroundJob[]> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const results = await collection.find({}, { limit: 1000 });

        const jobs = results
          .map((doc) => {
            const validation = this.validateSafe(doc);
            if (validation.success && validation.data) {
              return validation.data;
            }
            return null;
          })
          .filter((job): job is BackgroundJob => job !== null);
        return jobs;
      },
      'Error finding all background jobs',
      {},
      []
    );
  }

  /**
   * Find the N most-recently-updated jobs of a given type across all users.
   * Used by the housekeeping scheduler to skip the startup tick when a
   * recent scheduled sweep already completed.
   */
  async findRecentByType(type: BackgroundJobType, limit: number): Promise<BackgroundJob[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          { type } as TypedQueryFilter<BackgroundJob>,
          {
            sort: { updatedAt: -1 as any },
            limit,
          },
        );
        return results;
      },
      'Error finding recent background jobs by type',
      { type, limit },
      []
    );
  }

  /**
   * Find jobs by user ID with optional status filter
   */
  async findByUserId(userId: string, status?: BackgroundJobStatus): Promise<BackgroundJob[]> {
    return this.safeQuery(
      async () => {
        const query: TypedQueryFilter<BackgroundJob> = { userId };
        if (status) {
          query.status = status;
        }

        const results = await this.findByFilter(query, {
          sort: { createdAt: -1 as any },
          limit: 100,
        });
        return results;
      },
      'Error finding background jobs by user ID',
      { userId },
      []
    );
  }

  /**
   * Find pending jobs for a specific chat
   * Only returns PENDING and PROCESSING jobs - FAILED jobs don't block new job creation
   * since the user may have fixed the underlying issue (e.g., changed provider)
   */
  async findPendingForChat(chatId: string): Promise<BackgroundJob[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          {
            'payload.chatId': chatId,
            status: { $in: ['PENDING', 'PROCESSING'] },
          } as TypedQueryFilter<BackgroundJob>,
          {
            sort: { priority: -1 as any, createdAt: 1 as any },
          }
        );
        return results;
      },
      'Error finding pending jobs for chat',
      { chatId },
      []
    );
  }

  /**
   * Find pending/processing jobs for a specific entity (by payload.entityId)
   * Used for deduplication of entity-scoped jobs like EMBEDDING_GENERATE
   */
  async findPendingForEntity(entityId: string): Promise<BackgroundJob[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter(
          {
            'payload.entityId': entityId,
            status: { $in: ['PENDING', 'PROCESSING'] },
          } as TypedQueryFilter<BackgroundJob>,
          {
            sort: { priority: -1 as any, createdAt: 1 as any },
          }
        );
        return results;
      },
      'Error finding pending jobs for entity',
      { entityId },
      []
    );
  }

  /**
   * Claim the next available job atomically
   * Uses findOneAndUpdate for concurrent-safe job claiming.
   * Jobs are sorted by priority (highest first), then creation time (oldest first).
   */
  async claimNextJob(): Promise<BackgroundJob | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const result = await collection.findOneAndUpdate(
          {
            status: { $in: ['PENDING', 'FAILED'] },
            scheduledAt: { $lte: now },
            $expr: { $lt: ['$attempts', '$maxAttempts'] },
          } as TypedQueryFilter<BackgroundJob>,
          {
            $set: {
              status: 'PROCESSING',
              startedAt: now,
              updatedAt: now,
            },
            $inc: { attempts: 1 },
          } as any,
          {
            returnDocument: 'after',
            sort: { priority: -1, createdAt: 1 },
          }
        );

        if (!result) {
          return null;
        }

        const validated = this.validate(result);
        logger.info('Claimed job', { jobId: validated.id, type: validated.type, attempts: validated.attempts });
        return validated;
      },
      'Error claiming next job',
      {},
      null
    );
  }

  /**
   * Find the earliest `scheduledAt` among retry-eligible jobs
   * (PENDING or FAILED with attempts < maxAttempts). Used by the processor to
   * arm a wake-up timer when the queue has no currently-claimable jobs but has
   * retries scheduled for the future. Returns null if no such job exists.
   */
  async findNextScheduledAt(): Promise<string | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const results = await collection.find(
          {
            status: { $in: ['PENDING', 'FAILED'] },
            $expr: { $lt: ['$attempts', '$maxAttempts'] },
          } as TypedQueryFilter<BackgroundJob>,
          {
            sort: { scheduledAt: 1 },
            limit: 1,
          } as any
        );
        if (!results.length) return null;
        const scheduledAt = (results[0] as { scheduledAt?: string }).scheduledAt;
        return scheduledAt ?? null;
      },
      'Error finding next scheduled retry time',
      {},
      null
    );
  }

  /**
   * Create a new job
   */
  async create(
    data: Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<BackgroundJob> {
    return this.safeQuery(
      async () => {
        const job = await this._create(data, options);
        logger.info('Background job created', { jobId: job.id, type: data.type, userId: data.userId });
        return job;
      },
      'Error creating background job',
      { type: data.type, userId: data.userId }
    );
  }

  /**
   * Create multiple jobs in batch (for import)
   */
  async createBatch(
    jobs: Array<Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<string[]> {
    return this.safeQuery(
      async () => {
        if (jobs.length === 0) {
          return [];
        }

        const now = this.getCurrentTimestamp();
        const validatedJobs: BackgroundJob[] = [];
        const ids: string[] = [];

        for (const jobData of jobs) {
          const id = this.generateId();
          ids.push(id);

          const job: BackgroundJob = {
            ...jobData,
            id,
            createdAt: now,
            updatedAt: now,
          };

          validatedJobs.push(this.validate(job));
        }

        const collection = await this.getCollection();
        await collection.insertMany(validatedJobs);

        logger.info('Background jobs batch created', { count: validatedJobs.length });
        return ids;
      },
      'Error creating batch of background jobs',
      { count: jobs.length }
    );
  }

  /**
   * Update a job
   */
  async update(id: string, data: Partial<BackgroundJob>): Promise<BackgroundJob | null> {
    return this.safeQuery(
      async () => {
        const result = await this._update(id, data);
        return result;
      },
      'Error updating background job',
      { jobId: id }
    );
  }

  /**
   * Mark a job as completed
   */
  async markCompleted(id: string, result?: Record<string, unknown>): Promise<BackgroundJob | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const updateData: any = {
          status: 'COMPLETED',
          completedAt: now,
          updatedAt: now,
        };

        if (result) {
          updateData['payload.result'] = result;
        }

        const updated = await collection.findOneAndUpdate(
          { id },
          { $set: updateData } as any,
          { returnDocument: 'after' }
        );

        if (!updated) {
          logger.warn('Background job not found for completion', { jobId: id });
          return null;
        }

        const validated = this.validate(updated);
        logger.info('Background job completed', { jobId: id, type: validated.type });
        return validated;
      },
      'Error marking job as completed',
      { jobId: id }
    );
  }

  /**
   * Mark a job as failed with retry scheduling
   */
  async markFailed(id: string, errorMessage: string): Promise<BackgroundJob | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        // First get the current job to check attempts
        const currentJob = await this.findById(id);
        if (!currentJob) {
          logger.warn('Background job not found for failure marking', { jobId: id });
          return null;
        }

        // Calculate next retry time with exponential backoff
        // 30s, 60s, 120s, 240s (capped at 5 minutes)
        const backoffSeconds = Math.min(30 * Math.pow(2, currentJob.attempts), 300);
        const scheduledAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        // Determine if we should mark as DEAD or FAILED for retry
        const newStatus = currentJob.attempts >= currentJob.maxAttempts ? 'DEAD' : 'FAILED';

        const updated = await collection.findOneAndUpdate(
          { id },
          {
            $set: {
              status: newStatus,
              lastError: errorMessage,
              scheduledAt,
              updatedAt: now,
            },
          } as any,
          { returnDocument: 'after' }
        );

        if (!updated) {
          return null;
        }

        const validated = this.validate(updated);

        if (newStatus === 'DEAD') {
          logger.warn('Background job marked as DEAD (max attempts reached)', {
            jobId: id,
            type: validated.type,
            attempts: validated.attempts,
            error: errorMessage,
          });
        } else {
          logger.info('Background job marked as FAILED (will retry)', {
            jobId: id,
            type: validated.type,
            attempts: validated.attempts,
            nextRetryAt: scheduledAt,
            error: errorMessage,
          });
        }

        return validated;
      },
      'Error marking job as failed',
      { jobId: id }
    );
  }

  /**
   * Delete a job
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        return result;
      },
      'Error deleting background job',
      { jobId: id }
    );
  }

  /**
   * Get queue statistics
   *
   * One indexed `COUNT(*)` per status. This used to read and Zod-validate
   * *every* row in the table — completed jobs inside the retention window
   * included — which made the toolbar's poll expensive enough that it had to
   * be rationed. It is now cheap enough to poll on a heartbeat.
   */
  async getStats(userId?: string): Promise<QueueStats> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const statuses: { key: keyof QueueStats; status: BackgroundJobStatus }[] = [
          { key: 'pending', status: 'PENDING' },
          { key: 'processing', status: 'PROCESSING' },
          { key: 'completed', status: 'COMPLETED' },
          { key: 'failed', status: 'FAILED' },
          { key: 'dead', status: 'DEAD' },
          { key: 'paused', status: 'PAUSED' },
        ];

        const stats: QueueStats = {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          dead: 0,
          paused: 0,
        };

        for (const { key, status } of statuses) {
          const filter: TypedQueryFilter<BackgroundJob> = { status } as TypedQueryFilter<BackgroundJob>;
          if (userId) {
            (filter as any).userId = userId;
          }
          stats[key] = await collection.countDocuments(filter);
        }

        return stats;
      },
      'Error getting queue statistics',
      { userId },
      { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0, paused: 0 }
    );
  }

  /**
   * Get active (PENDING + PROCESSING) job counts grouped by *activity kind* —
   * the toolbar-chip grouping from `lib/background-jobs/activity-kinds`.
   *
   * This is the hot path: the toolbar polls it continuously. It runs one
   * indexed `COUNT(*)` per kind rather than hauling every active row (payload
   * JSON and all) out of SQLCipher the way {@link getActiveCountsByType} does,
   * which matters when a mount-point scan has fanned out thousands of
   * `EMBEDDING_GENERATE` jobs.
   */
  async getActiveCountsByKind(userId?: string): Promise<Record<ActivityKind, number>> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const counts = emptyActivityCounts();

        for (const kind of ACTIVITY_KINDS) {
          const types = (Object.keys(JOB_TYPE_ACTIVITY) as BackgroundJobType[]).filter(
            (type) => JOB_TYPE_ACTIVITY[type] === kind
          );
          if (types.length === 0) continue;

          const filter: TypedQueryFilter<BackgroundJob> = {
            status: { $in: ['PENDING', 'PROCESSING'] },
            type: { $in: types },
          } as TypedQueryFilter<BackgroundJob>;
          if (userId) {
            (filter as any).userId = userId;
          }

          counts[kind] = await collection.countDocuments(filter);
        }

        return counts;
      },
      'Error getting active counts by kind',
      { userId },
      emptyActivityCounts()
    );
  }

  /**
   * Get active (PENDING + PROCESSING) job counts grouped by job type
   */
  async getActiveCountsByType(userId?: string): Promise<Record<string, number>> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<BackgroundJob> = {
          status: { $in: ['PENDING', 'PROCESSING'] },
        };
        if (userId) {
          (filter as any).userId = userId;
        }

        const jobs = await this.findByFilter(filter);
        const counts: Record<string, number> = {};

        for (const job of jobs) {
          counts[job.type] = (counts[job.type] || 0) + 1;
        }

        return counts;
      },
      'Error getting active counts by type',
      { userId },
      {}
    );
  }

  /**
   * @deprecated Single-window reaper that treats COMPLETED and DEAD jobs the
   * same. Retention now differs by status (completed jobs are short-lived,
   * dead jobs are kept longer as a forensic trail), so production should call
   * {@link cleanupOldJobsByStatus}. Retained only so the existing
   * queue-service unit test keeps compiling.
   */
  async cleanupOldJobs(olderThan: Date): Promise<number> {
    return this.safeQuery(
      async () => {
        const deletedCount = await this.deleteMany({
          status: { $in: ['COMPLETED', 'DEAD'] },
          completedAt: { $lt: olderThan.toISOString() },
        });

        logger.info('Cleaned up old background jobs', { deletedCount });
        return deletedCount;
      },
      'Error cleaning up old jobs',
      {},
      0
    );
  }

  /**
   * Reap finished jobs on per-status retention windows, keyed off
   * `completedAt`. COMPLETED jobs are reaped after the shorter window; DEAD
   * (retry-exhausted) jobs after the longer one. PENDING, PROCESSING, FAILED,
   * and PAUSED are deliberately left alone — FAILED in particular is the
   * transient between-retries state and must not be reaped on a timer.
   *
   * @returns counts of rows deleted in each bucket.
   */
  async cleanupOldJobsByStatus(
    completedOlderThan: Date,
    deadOlderThan: Date
  ): Promise<{ completed: number; dead: number }> {
    return this.safeQuery(
      async () => {
        const completed = await this.deleteMany({
          status: 'COMPLETED',
          completedAt: { $lt: completedOlderThan.toISOString() },
        });
        const dead = await this.deleteMany({
          status: 'DEAD',
          completedAt: { $lt: deadOlderThan.toISOString() },
        });

        logger.info('Reaped finished background jobs by status', {
          completed,
          dead,
          completedOlderThan: completedOlderThan.toISOString(),
          deadOlderThan: deadOlderThan.toISOString(),
        });
        return { completed, dead };
      },
      'Error reaping finished jobs by status',
      {},
      { completed: 0, dead: 0 }
    );
  }

  /**
   * Cancel a pending job
   */
  async cancel(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const result = await collection.updateOne(
          { id, status: { $in: ['PENDING', 'FAILED'] } } as TypedQueryFilter<BackgroundJob>,
          {
            $set: {
              status: 'DEAD',
              lastError: 'Cancelled by user',
              updatedAt: this.getCurrentTimestamp(),
            },
          } as any
        );

        if (result.modifiedCount === 0) {
          logger.warn('Background job not found or not cancellable', { jobId: id });
          return false;
        }

        logger.info('Background job cancelled', { jobId: id });
        return true;
      },
      'Error cancelling background job',
      { jobId: id },
      false
    );
  }

  /**
   * Hard-delete every job whose type AND status matches the given filters.
   *
   * Used by the regenerate-all flow when the operator presses the button
   * a second time and wants to fully reset the queue: PENDING and
   * PROCESSING jobs from a prior sweep get removed entirely, not just
   * marked DEAD, so the fresh sweep starts from a clean slate.
   *
   * Currently-executing JS handlers will continue running until their
   * LLM call returns; their subsequent markCompleted/markFailed calls
   * become no-ops (the row is gone). Any memories those late writes
   * produce are cleaned up by the next round of MEMORY_REGENERATE_CHAT
   * wipes that the fresh sweep enqueues.
   */
  async deleteByTypesAndStatuses(
    types: BackgroundJobType[],
    statuses: BackgroundJobStatus[],
  ): Promise<number> {
    if (types.length === 0 || statuses.length === 0) return 0;
    return this.safeQuery(
      async () => {
        const deletedCount = await this.deleteMany({
          type: { $in: types },
          status: { $in: statuses },
        } as TypedQueryFilter<BackgroundJob>);
        if (deletedCount > 0) {
          logger.info('Deleted background jobs by types/statuses', {
            context: 'BackgroundJobsRepository.deleteByTypesAndStatuses',
            types,
            statuses,
            deletedCount,
          });
        }
        return deletedCount;
      },
      'Error deleting background jobs by types/statuses',
      { types, statuses },
      0,
    );
  }

  /**
   * Cancel all non-completed jobs of a given type.
   * Used during re-embed to clear stale EMBEDDING_GENERATE jobs before
   * enqueuing fresh ones.  Includes PROCESSING jobs which may be orphaned
   * after a server restart.
   */
  async cancelByType(type: BackgroundJobType): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();
        const result = await collection.updateMany(
          {
            type,
            status: { $in: ['PENDING', 'FAILED', 'PROCESSING'] },
          } as TypedQueryFilter<BackgroundJob>,
          {
            $set: {
              status: 'DEAD',
              lastError: 'Superseded by new reindex',
              updatedAt: now,
            },
          } as any
        );

        if (result.modifiedCount > 0) {
          logger.info('Cancelled background jobs by type', {
            context: 'BackgroundJobsRepository.cancelByType',
            type,
            cancelledCount: result.modifiedCount,
          });
        }

        return result.modifiedCount;
      },
      'Error cancelling background jobs by type',
      { type },
      0
    );
  }

  /**
   * Pause a pending or failed job
   */
  async pause(id: string): Promise<BackgroundJob | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const result = await collection.findOneAndUpdate(
          { id, status: { $in: ['PENDING', 'FAILED'] } } as TypedQueryFilter<BackgroundJob>,
          {
            $set: {
              status: 'PAUSED',
              updatedAt: now,
            },
          } as any,
          { returnDocument: 'after' }
        );

        if (!result) {
          logger.warn('Background job not found or not pausable', { jobId: id });
          return null;
        }

        const validated = this.validate(result);
        logger.info('Background job paused', { jobId: id, type: validated.type });
        return validated;
      },
      'Error pausing background job',
      { jobId: id }
    );
  }

  /**
   * Resume a paused job
   */
  async resume(id: string): Promise<BackgroundJob | null> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const result = await collection.findOneAndUpdate(
          { id, status: 'PAUSED' },
          {
            $set: {
              status: 'PENDING',
              scheduledAt: now,
              updatedAt: now,
            },
          } as any,
          { returnDocument: 'after' }
        );

        if (!result) {
          logger.warn('Background job not found or not resumable', { jobId: id });
          return null;
        }

        const validated = this.validate(result);
        logger.info('Background job resumed', { jobId: id, type: validated.type });
        return validated;
      },
      'Error resuming background job',
      { jobId: id }
    );
  }

  /**
   * Reset stuck processing jobs (for recovery after crash)
   * Jobs that have been processing for longer than timeout are reset to FAILED
   */
  /**
   * Kill ALL jobs in PROCESSING state on startup.
   * No job can legitimately be mid-flight when the server has just started,
   * so they are all orphans from a previous run.  Marking them DEAD avoids
   * retrying stale work that may belong to an outdated embedding profile or
   * model configuration.
   */
  async resetAllProcessingJobs(): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const now = this.getCurrentTimestamp();

        const result = await collection.updateMany(
          {
            status: 'PROCESSING',
          },
          {
            $set: {
              status: 'DEAD',
              lastError: 'Orphaned on startup — killed',
              updatedAt: now,
            },
          } as any
        );

        if (result.modifiedCount > 0) {
          logger.info('Killed orphaned PROCESSING jobs on startup', {
            context: 'BackgroundJobsRepository.resetAllProcessingJobs',
            count: result.modifiedCount,
          });
        }
        return result.modifiedCount;
      },
      'Error resetting all processing jobs',
      {},
      0
    );
  }

  async resetStuckJobs(timeoutMinutes: number = 10): Promise<number> {
    return this.safeQuery(
      async () => {
        const collection = await this.getCollection();
        const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
        const now = this.getCurrentTimestamp();

        const result = await collection.updateMany(
          {
            status: 'PROCESSING',
            startedAt: { $lt: cutoff },
          },
          {
            $set: {
              status: 'FAILED',
              lastError: `Timed out after ${timeoutMinutes} minutes`,
              updatedAt: now,
            },
          } as any
        );

        if (result.modifiedCount > 0) {
          logger.warn('Reset stuck processing jobs', { count: result.modifiedCount });
        }
        return result.modifiedCount;
      },
      'Error resetting stuck jobs',
      {},
      0
    );
  }
}
