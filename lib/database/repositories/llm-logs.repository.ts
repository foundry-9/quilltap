/**
 * LLM Logs Repository
 *
 * Backend-agnostic repository for LLMLog entities.
 * Overrides getCollection() to route all operations to the dedicated
 * LLM logs database (quilltap-llm-logs.db), isolating high-churn debug
 * data from the main database.
 *
 * When the logs DB is in degraded mode (corruption, permissions, etc.),
 * getCollection() throws and all safeQuery fallbacks kick in — returning
 * empty arrays, 0 counts, etc. The rest of the app continues normally.
 */

import { logger } from '@/lib/logger';
import { LLMLog, LLMLogSchema, LLMLogType } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { DatabaseCollection, TypedQueryFilter, QueryOptions } from '../interfaces';
import { SQLiteCollection } from '../backends/sqlite/backend';
import { getRawLLMLogsDatabase, isLLMLogsDegraded } from '../backends/sqlite/llm-logs-client';
import { generateDDL, extractSchemaMetadata } from '../schema-translator';

/**
 * LLM Logs Repository
 * Implements CRUD operations and advanced queries for LLM logs.
 * Uses AbstractBaseRepository since LLMLog schema uses Date type for timestamps.
 */
export class LLMLogsRepository extends AbstractBaseRepository<LLMLog> {
  private llmLogsCollectionInitialized = false;

  constructor() {
    super('llm_logs', LLMLogSchema);
  }

  /**
   * Override getCollection to return a collection from the dedicated LLM logs
   * database instead of the main database.
   */
  protected async getCollection(): Promise<DatabaseCollection<LLMLog>> {
    if (isLLMLogsDegraded()) {
      throw new Error('LLM logs database is in degraded mode');
    }

    const db = getRawLLMLogsDatabase();
    if (!db) {
      throw new Error('LLM logs database not initialized');
    }

    // Ensure the table exists in the logs DB on first access
    if (!this.llmLogsCollectionInitialized) {
      try {
        const ddlStatements = generateDDL(this.collectionName, this.schema);
        for (const sql of ddlStatements) {
          db.exec(sql);
        }
        this.llmLogsCollectionInitialized = true;
      } catch (error) {
        logger.error('Failed to ensure llm_logs table in LLM logs database', {
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

    return new SQLiteCollection<LLMLog>(db, this.collectionName, jsonColumns, arrayColumns, booleanColumns);
  }

  /**
   * Find logs by user ID with pagination
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 50)
   * @param offset Number of logs to skip (default: 0)
   * @returns Promise<LLMLog[]> Array of logs for the user
   */
  async findByUserId(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
          skip: offset,
          limit,
        };

        const logs = await this.findByFilter({ userId }, options);
        return logs;
      },
      'Error finding LLM logs by user ID',
      { userId, limit, offset },
      []
    );
  }

  /**
   * Find logs by message ID (for viewing logs per chat message)
   * @param messageId The message ID
   * @returns Promise<LLMLog[]> Array of logs associated with the message
   */
  async findByMessageId(messageId: string): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
        };

        const logs = await this.findByFilter({ messageId }, options);
        return logs;
      },
      'Error finding LLM logs by message ID',
      { messageId },
      []
    );
  }

  /**
   * Find logs by chat ID (for title generation, context compression)
   * @param chatId The chat ID
   * @returns Promise<LLMLog[]> Array of logs associated with the chat
   */
  async findByChatId(chatId: string): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
        };

        const logs = await this.findByFilter({ chatId }, options);
        return logs;
      },
      'Error finding LLM logs by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find all logs associated with a chat - both direct chatId matches and
   * logs linked via messageIds belonging to the chat.
   * Used by the LLM Inspector panel to show all activity for a chat.
   * @param chatId The chat ID
   * @param messageIds Array of message IDs belonging to the chat
   * @param limit Maximum results (default 500)
   * @returns Promise<LLMLog[]> Combined logs sorted by createdAt DESC
   */
  async findAllForChat(chatId: string, messageIds: string[], limit: number = 500): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<LLMLog> = {
          $or: [
            { chatId },
            ...(messageIds.length > 0 ? [{ messageId: { $in: messageIds } }] : []),
          ],
        };

        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter(filter, options);
        return logs;
      },
      'Error finding all LLM logs for chat',
      { chatId, messageIdCount: messageIds.length },
      []
    );
  }

  /**
   * Find logs by character ID (for character wizard operations)
   * @param characterId The character ID
   * @returns Promise<LLMLog[]> Array of logs associated with the character
   */
  async findByCharacterId(characterId: string): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
        };

        const logs = await this.findByFilter({ characterId }, options);
        return logs;
      },
      'Error finding LLM logs by character ID',
      { characterId },
      []
    );
  }

  /**
   * Find standalone logs (no messageId, chatId, or characterId - for standalone image gen)
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 50)
   * @returns Promise<LLMLog[]> Array of standalone logs
   */
  async findStandalone(userId: string, limit: number = 50): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<LLMLog> = {
          userId,
          messageId: { $eq: null },
          chatId: { $eq: null },
          characterId: { $eq: null },
        };

        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter(filter, options);
        return logs;
      },
      'Error finding standalone LLM logs',
      { userId, limit },
      []
    );
  }

  /**
   * Find logs by type with user filter
   * @param userId The user ID
   * @param type The log type
   * @param limit Maximum number of logs to return (default: 50)
   * @returns Promise<LLMLog[]> Array of logs of the specified type
   */
  async findByType(userId: string, type: LLMLogType, limit: number = 50): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<LLMLog> = { userId, type };
        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter(filter, options);
        return logs;
      },
      'Error finding LLM logs by type',
      { userId, type, limit },
      []
    );
  }

  /**
   * Find recent logs for a user
   * @param userId The user ID
   * @param limit Maximum number of logs to return (default: 20)
   * @returns Promise<LLMLog[]> Array of recent logs, sorted by creation date (newest first)
   */
  async findRecent(userId: string, limit: number = 20): Promise<LLMLog[]> {
    return this.safeQuery(
      async () => {
        const options: QueryOptions = {
          sort: { createdAt: -1 },
          limit,
        };

        const logs = await this.findByFilter({ userId }, options);
        return logs;
      },
      'Error finding recent LLM logs',
      { userId, limit },
      []
    );
  }

  /**
   * Create a new log
   * @param data The log data (without id, createdAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<LLMLog> The created log with generated id and timestamp
   */
  async create(
    data: Omit<LLMLog, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<LLMLog> {
    return this.safeQuery(
      async () => {
        const log = await this._create(data, options);
        return log;
      },
      'Error creating LLM log',
      { userId: data.userId, type: data.type }
    );
  }

  /**
   * Update a log
   * Note: LLM logs are typically immutable, but this method is provided for completeness
   * @param id The log ID
   * @param data Partial log data to update
   * @returns Promise<LLMLog | null> The updated log if found, null otherwise
   */
  async update(id: string, data: Partial<LLMLog>): Promise<LLMLog | null> {
    return this.safeQuery(
      async () => {
        const log = await this._update(id, data);

        if (!log) {
          logger.warn('LLM log not found for update', { logId: id });
        }

        return log;
      },
      'Error updating LLM log',
      { logId: id }
    );
  }

  /**
   * Delete a log
   * @param id The log ID
   * @returns Promise<boolean> True if log was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (!result) {
          logger.warn('LLM log not found for deletion', { logId: id });
        }

        return result;
      },
      'Error deleting LLM log',
      { logId: id }
    );
  }

  /**
   * Delete logs by user ID (for account cleanup)
   * @param userId The user ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByUserId(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ userId });
        return count;
      },
      'Error deleting LLM logs by user ID',
      { userId }
    );
  }

  /**
   * Cleanup old logs based on retention days
   * @param userId The user ID
   * @param retentionDays Number of days to retain logs (delete older than this)
   * @returns Promise<number> Number of logs deleted
   */
  async cleanupOldLogs(userId: string, retentionDays: number): Promise<number> {
    return this.safeQuery(
      async () => {
        if (retentionDays < 0) {
          logger.warn('Invalid retention days', { retentionDays });
          return 0;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const filter: TypedQueryFilter<LLMLog> = {
          userId,
          createdAt: { $lt: cutoffDate.toISOString() },
        };

        const count = await this.deleteMany(filter);

        logger.info('Cleaned up old LLM logs', {
          userId,
          retentionDays,
          deletedCount: count,
          cutoffDate: cutoffDate.toISOString(),
        });
        return count;
      },
      'Error cleaning up old LLM logs',
      { userId, retentionDays }
    );
  }

  /**
   * Count logs for a user
   * @param userId The user ID
   * @returns Promise<number> Number of logs for the user
   */
  async countByUserId(userId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ userId });
        return count;
      },
      'Error counting LLM logs for user',
      { userId },
      0
    );
  }

  /**
   * Count logs by type for a user
   * @param userId The user ID
   * @param type The log type
   * @returns Promise<number> Number of logs of the specified type
   */
  async countByType(userId: string, type: LLMLogType): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ userId, type });
        return count;
      },
      'Error counting LLM logs by type',
      { userId, type },
      0
    );
  }

  /**
   * Get total token usage for a user
   * Aggregates usage data across all logs for a user.
   * @param userId The user ID
   * @returns Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> Total token usage
   */
  async getTotalTokenUsage(
    userId: string
  ): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    return this.safeQuery(
      async () => {
        // `$exists: true` only. `$ne: null` used to be here too and made this
        // method return zeroes on every install: the SQLite translator emits
        // `usage != ?` with a NULL parameter, i.e. `usage != NULL`, which is
        // unknown for every row by SQL NULL semantics, so the filter matched
        // nothing. The Almanack renders exactly this number, which is how the
        // long-standing "0 tokens logged" reading was finally traced.
        const filter: TypedQueryFilter<LLMLog> = {
          userId,
          usage: { $exists: true },
        };

        const logs = await this.findByFilter(filter);

        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for (const log of logs) {
          if (log.usage) {
            totalPromptTokens += log.usage.promptTokens || 0;
            totalCompletionTokens += log.usage.completionTokens || 0;
            totalTokens += log.usage.totalTokens || 0;
          }
        }
        return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
      },
      'Error getting total token usage',
      { userId },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Get total token usage for a user since a given timestamp.
   *
   * Used by the autonomous-room daily user-token budget check (4.6 Private
   * Character Rooms) — the rollover boundary is instance-local midnight, so
   * the caller computes the ISO timestamp for that boundary and passes it
   * here. Returns zeroed totals when no logs match.
   */
  async getTotalTokenUsageSince(
    userId: string,
    sinceTimestamp: string,
  ): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    return this.safeQuery(
      async () => {
        // `$exists: true` only — see {@link getTotalTokenUsage} for why
        // `$ne: null` must never be added back.
        const filter: TypedQueryFilter<LLMLog> = {
          userId,
          usage: { $exists: true },
          createdAt: { $gte: sinceTimestamp },
        };

        const logs = await this.findByFilter(filter);

        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for (const log of logs) {
          if (log.usage) {
            totalPromptTokens += log.usage.promptTokens || 0;
            totalCompletionTokens += log.usage.completionTokens || 0;
            totalTokens += log.usage.totalTokens || 0;
          }
        }
        return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
      },
      'Error getting total token usage since timestamp',
      { userId, sinceTimestamp },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Get total token usage for a specific chat since a given timestamp.
   *
   * Used by the autonomous-room turn handler to compute per-run token spend
   * across turn-job boundaries. The forked-job child's repository proxy
   * buffers writes and uses a readonly DB connection for reads, which makes
   * the chats.totalPromptTokens delta unreliable mid-job; summing llm_logs
   * is authoritative as soon as the previous turn's job has flushed. A
   * future refinement is to tag each log with the autonomous run's UUID
   * and sum by that instead of a timestamp window.
   */
  async getTotalTokenUsageForChatSince(
    chatId: string,
    sinceTimestamp: string,
  ): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    return this.safeQuery(
      async () => {
        // Only `$exists: true` (→ `usage IS NOT NULL`) — do NOT add
        // `$ne: null`. The SQLite translator emits `usage != NULL`
        // literally, which is unknown/false for every row by SQL NULL
        // semantics, so the filter would return zero matches and the
        // sum would always be 0. The sibling methods getTotalTokenUsage
        // and getTotalTokenUsageSince carried that bug until 4.9 and are
        // now fixed the same way.
        const filter: TypedQueryFilter<LLMLog> = {
          chatId,
          usage: { $exists: true },
          createdAt: { $gte: sinceTimestamp },
        };

        const logs = await this.findByFilter(filter);

        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for (const log of logs) {
          if (log.usage) {
            totalPromptTokens += log.usage.promptTokens || 0;
            totalCompletionTokens += log.usage.completionTokens || 0;
            totalTokens += log.usage.totalTokens || 0;
          }
        }
        return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
      },
      'Error getting total token usage for chat since timestamp',
      { chatId, sinceTimestamp },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Get total token usage for a single autonomous-room run, summed across
   * every llm_logs row tagged with this `autonomousRunId` — the run's
   * conversational turns plus their agent-mode tool sub-calls.
   *
   * This supersedes the timestamp-window {@link getTotalTokenUsageForChatSince}
   * for per-run budget accounting. Summing by run id isolates exactly this
   * run's spend regardless of any overlapping chat activity, and is robust to
   * the forked-job child's buffered-write timing. As with the timestamp
   * variant, the current turn's own log row is still buffered when the handler
   * reads this, so the sum converges one turn behind — acceptable for a budget
   * gate that only needs to trip within a turn of crossing the cap.
   *
   * Cache-read (prompt-cache hit) tokens are excluded from `usage.totalTokens`
   * by the provider plugins at the source, so by default this sum counts only
   * the billable cache-miss input + output tokens. Pass
   * `{ includeCacheHits: true }` to add those stripped cache reads back from
   * each row's `cacheUsage.cacheReadInputTokens` — the "count every token"
   * budget mode (per-room `budgetExcludeCacheHits = 0`).
   */
  async getTotalTokenUsageForRun(
    autonomousRunId: string,
    options: { includeCacheHits?: boolean } = {},
  ): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    const { includeCacheHits = false } = options;
    return this.safeQuery(
      async () => {
        // `$exists: true` only — see getTotalTokenUsageForChatSince for why
        // `$ne: null` must not be added (the translator emits `usage != NULL`,
        // which is unknown for every row and zeroes the sum).
        const filter: TypedQueryFilter<LLMLog> = {
          autonomousRunId,
          usage: { $exists: true },
        };

        const logs = await this.findByFilter(filter);

        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for (const log of logs) {
          if (log.usage) {
            totalPromptTokens += log.usage.promptTokens || 0;
            totalCompletionTokens += log.usage.completionTokens || 0;
            totalTokens += log.usage.totalTokens || 0;
          }
          // Add the cache-read tokens the provider plugins stripped from
          // `usage` back into the prompt/total when counting every token.
          if (includeCacheHits && log.cacheUsage?.cacheReadInputTokens) {
            const cacheReads = log.cacheUsage.cacheReadInputTokens;
            totalPromptTokens += cacheReads;
            totalTokens += cacheReads;
          }
        }
        return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens };
      },
      'Error getting total token usage for autonomous run',
      { autonomousRunId, includeCacheHits },
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  }

  /**
   * Count logs associated with a message ID
   * @param messageId The message ID
   * @returns Promise<number> Number of logs for the message
   */
  async countByMessageId(messageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ messageId });
        return count;
      },
      'Error counting LLM logs for message',
      { messageId },
      0
    );
  }

  /**
   * Delete logs by message ID
   * @param messageId The message ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByMessageId(messageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ messageId });
        return count;
      },
      'Error deleting LLM logs by message ID',
      { messageId }
    );
  }

  /**
   * Delete logs by chat ID
   * @param chatId The chat ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ chatId });
        return count;
      },
      'Error deleting LLM logs by chat ID',
      { chatId }
    );
  }

  /**
   * Delete logs by character ID
   * @param characterId The character ID
   * @returns Promise<number> Number of logs deleted
   */
  async deleteByCharacterId(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.deleteMany({ characterId });
        return count;
      },
      'Error deleting LLM logs by character ID',
      { characterId }
    );
  }

  // ==========================================================================
  // Aggregates (The Almanack)
  // ==========================================================================
  //
  // These are GROUP BY roll-ups over the whole logs table. The sum-in-JS
  // helpers above materialize every matching row through Zod before adding
  // three numbers, which is fine for a single run's worth of rows and
  // hopeless for a table with hundreds of thousands. Everything below runs
  // in SQLite and returns only the rolled-up rows.
  //
  // They target the dedicated logs DB directly (`getRawLLMLogsDatabase()`),
  // NOT `manager.rawQuery`, which addresses the main database.

  /**
   * Run a read-only aggregate against the LLM logs database.
   *
   * Returns `fallback` when the DB is degraded/uninitialized or the query
   * throws — a diagnostic report must never fail because its own source of
   * numbers is unavailable.
   */
  private aggregate<R>(
    sql: string,
    params: unknown[],
    context: string,
    fallback: R[],
  ): R[] {
    if (isLLMLogsDegraded()) {
      return fallback;
    }
    const db = getRawLLMLogsDatabase();
    if (!db) {
      return fallback;
    }
    try {
      return db.prepare(sql).all(...(params as never[])) as R[];
    } catch (error) {
      logger.warn('LLM logs aggregate query failed', {
        context,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  /** Does the table carry the 4.9 profile-attribution columns yet? */
  hasProfileAttributionColumns(): boolean {
    const rows = this.aggregate<{ name: string }>(
      `PRAGMA table_info("llm_logs")`,
      [],
      'llm-logs.hasProfileAttributionColumns',
      [],
    );
    return rows.some(r => r.name === 'connectionProfileId');
  }

  /** Per-`type` request counts, token totals and measured-latency averages. */
  async getStatsByType(userId: string): Promise<LLMLogTypeStatsRow[]> {
    return this.aggregate<LLMLogTypeStatsRow>(
      `SELECT
         "type"                                                        AS type,
         COUNT(*)                                                      AS requests,
         COALESCE(SUM(json_extract("usage", '$.promptTokens')), 0)     AS promptTokens,
         COALESCE(SUM(json_extract("usage", '$.completionTokens')), 0) AS completionTokens,
         COALESCE(SUM(json_extract("usage", '$.totalTokens')), 0)      AS totalTokens,
         SUM(CASE WHEN "durationMs" IS NOT NULL AND "durationMs" > 0 THEN 1 ELSE 0 END) AS measuredRequests,
         AVG(CASE WHEN "durationMs" IS NOT NULL AND "durationMs" > 0 THEN "durationMs" END) AS avgDurationMs,
         SUM(CASE WHEN json_extract("response", '$.error') IS NOT NULL THEN 1 ELSE 0 END) AS failures
       FROM "llm_logs"
       WHERE "userId" = ?
       GROUP BY "type"
       ORDER BY requests DESC`,
      [userId],
      'llm-logs.getStatsByType',
      [],
    );
  }

  /**
   * Per-profile roll-up.
   *
   * `groupBy` picks the attribution key: `'connectionProfileId'` /
   * `'imageProfileId'` are exact (4.9+ rows only); `'providerModel'` is the
   * approximate fallback that older rows must use, and cannot separate two
   * profiles sharing a provider/model pair.
   */
  async getStatsByProfile(
    userId: string,
    groupBy: 'connectionProfileId' | 'imageProfileId' | 'providerModel',
    options: { type?: LLMLogType } = {},
  ): Promise<LLMLogProfileStatsRow[]> {
    const keyExpr =
      groupBy === 'providerModel'
        ? `"provider" || '/' || "modelName"`
        : `"${groupBy}"`;
    const typeClause = options.type ? `AND "type" = ?` : '';
    const params: unknown[] = options.type ? [userId, options.type] : [userId];

    return this.aggregate<LLMLogProfileStatsRow>(
      `SELECT
         ${keyExpr}                                                    AS key,
         "provider"                                                    AS provider,
         "modelName"                                                   AS modelName,
         COUNT(*)                                                      AS requests,
         COALESCE(SUM(json_extract("usage", '$.promptTokens')), 0)     AS promptTokens,
         COALESCE(SUM(json_extract("usage", '$.completionTokens')), 0) AS completionTokens,
         COALESCE(SUM(json_extract("usage", '$.totalTokens')), 0)      AS totalTokens,
         SUM(CASE WHEN "durationMs" IS NOT NULL AND "durationMs" > 0 THEN 1 ELSE 0 END) AS measuredRequests,
         AVG(CASE WHEN "durationMs" IS NOT NULL AND "durationMs" > 0 THEN "durationMs" END) AS avgDurationMs,
         SUM(CASE WHEN json_extract("response", '$.error') IS NOT NULL THEN 1 ELSE 0 END) AS failures
       FROM "llm_logs"
       WHERE "userId" = ? ${typeClause}
         ${groupBy === 'providerModel' ? '' : `AND "${groupBy}" IS NOT NULL`}
       GROUP BY key, "provider", "modelName"
       ORDER BY requests DESC`,
      params,
      `llm-logs.getStatsByProfile:${groupBy}`,
      [],
    );
  }

  /**
   * Median measured `durationMs` per attribution key.
   *
   * SQLite has no percentile aggregate, so this walks the ordered rows with a
   * window function and picks the middle one. Kept separate from
   * {@link getStatsByProfile} because the window pass is the expensive half.
   */
  async getMedianDurationByProfile(
    userId: string,
    groupBy: 'connectionProfileId' | 'imageProfileId' | 'providerModel',
  ): Promise<Array<{ key: string; medianDurationMs: number }>> {
    const keyExpr =
      groupBy === 'providerModel'
        ? `"provider" || '/' || "modelName"`
        : `"${groupBy}"`;
    return this.aggregate<{ key: string; medianDurationMs: number }>(
      `WITH measured AS (
         SELECT ${keyExpr} AS key, "durationMs" AS d,
                ROW_NUMBER() OVER (PARTITION BY ${keyExpr} ORDER BY "durationMs") AS rn,
                COUNT(*)    OVER (PARTITION BY ${keyExpr})                        AS n
         FROM "llm_logs"
         WHERE "userId" = ?
           AND "durationMs" IS NOT NULL AND "durationMs" > 0
           ${groupBy === 'providerModel' ? '' : `AND "${groupBy}" IS NOT NULL`}
       )
       SELECT key, AVG(d) AS medianDurationMs
       FROM measured
       WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
       GROUP BY key`,
      [userId],
      `llm-logs.getMedianDurationByProfile:${groupBy}`,
      [],
    );
  }

  /**
   * Prompt-cache hit/miss roll-up.
   *
   * `cacheUsage` is populated essentially only on `CHAT_MESSAGE` rows (the
   * streaming path is its sole writer). There is no boolean "was this a hit" —
   * a hit is derived as `cacheReadInputTokens > 0`, and the denominator is
   * "rows carrying any cacheUsage at all".
   */
  async getCacheStats(
    userId: string,
    groupBy: 'provider' | 'connectionProfileId',
  ): Promise<LLMLogCacheStatsRow[]> {
    return this.aggregate<LLMLogCacheStatsRow>(
      `SELECT
         "${groupBy}" AS key,
         COUNT(*)     AS rowsWithCacheUsage,
         SUM(CASE WHEN COALESCE(json_extract("cacheUsage", '$.cacheReadInputTokens'), 0) > 0 THEN 1 ELSE 0 END) AS rowsWithCacheRead,
         COALESCE(SUM(json_extract("cacheUsage", '$.cacheReadInputTokens')), 0)     AS cacheReadTokens,
         COALESCE(SUM(json_extract("cacheUsage", '$.cacheCreationInputTokens')), 0) AS cacheCreationTokens,
         COALESCE(SUM(json_extract("usage", '$.promptTokens')), 0)                  AS promptTokens
       FROM "llm_logs"
       WHERE "userId" = ?
         AND "cacheUsage" IS NOT NULL
         AND "${groupBy}" IS NOT NULL
       GROUP BY key
       ORDER BY rowsWithCacheUsage DESC`,
      [userId],
      `llm-logs.getCacheStats:${groupBy}`,
      [],
    );
  }
}

/** One row of {@link LLMLogsRepository.getStatsByType}. */
export interface LLMLogTypeStatsRow {
  type: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Rows with a usable (non-null, non-zero) `durationMs` — the avg's denominator. */
  measuredRequests: number;
  avgDurationMs: number | null;
  failures: number;
}

/** One row of {@link LLMLogsRepository.getStatsByProfile}. */
export interface LLMLogProfileStatsRow {
  /** Profile id, or `provider/model` when attributing approximately. */
  key: string;
  provider: string;
  modelName: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  measuredRequests: number;
  avgDurationMs: number | null;
  failures: number;
}

/** One row of {@link LLMLogsRepository.getCacheStats}. */
export interface LLMLogCacheStatsRow {
  key: string;
  rowsWithCacheUsage: number;
  rowsWithCacheRead: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  promptTokens: number;
}
