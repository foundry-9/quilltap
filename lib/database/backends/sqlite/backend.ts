/**
 * SQLite Database Backend
 *
 * Implements the DatabaseBackend interface for SQLite using better-sqlite3.
 * Provides collection abstraction over SQLite tables with JSON column support.
 */

import { z } from 'zod';
import { Database as DatabaseType, Statement } from 'better-sqlite3';
import {
  DatabaseBackend,
  DatabaseCollection,
  DatabaseTransaction,
  ConnectionState,
  TypedQueryFilter,
  QueryFilter,
  QueryOptions,
  UpdateSpec,
  InsertResult,
  UpdateResult,
  DeleteResult,
  SQLITE_CAPABILITIES,
} from '../../interfaces';
import { SQLiteConfig, loadSQLiteConfig, loadLLMLogsConfig, loadMountIndexConfig } from '../../config';
import { getSQLiteClient, closeSQLiteClient, isSQLiteConnected, setupSQLiteShutdownHandlers } from './client';
import { runIntegrityCheck, startPeriodicCheckpoints } from './protection';
import {
  createPhysicalBackup,
  createLLMLogsPhysicalBackup,
  createMountIndexPhysicalBackup,
  applyRetentionPolicy,
} from './physical-backup';
import { getLLMLogsSQLiteClient, closeLLMLogsSQLiteClient } from './llm-logs-client';
import { runLLMLogsIntegrityCheck, startLLMLogsPeriodicCheckpoints } from './llm-logs-protection';
import { getMountIndexSQLiteClient, closeMountIndexSQLiteClient } from './mount-index-client';
import { runMountIndexIntegrityCheck, startMountIndexPeriodicCheckpoints } from './mount-index-protection';
import { acquireInstanceLock, releaseActiveInstanceLock, InstanceLockError } from './instance-lock';
import { getInstanceLockPath } from '@/lib/paths';
import { generateDDL, extractSchemaMetadata } from '../../schema-translator';
import { buildSelectQuery, buildCountQuery, buildUpdateQuery, buildDeleteQuery, translateFilter } from './query-translator';
import { documentToRow, rowToDocument, toJson, fromJson, fromJsonSafe, blobToEmbedding } from './json-columns';
import { parseLegacyEmbeddingText } from '@/lib/embedding/float32-conversion';
import { logger } from '@/lib/logger';

// ============================================================================
// SQLite Collection Implementation
// ============================================================================

/**
 * SQLite implementation of DatabaseCollection
 */
export class SQLiteCollection<T = unknown> implements DatabaseCollection<T> {
  readonly name: string;
  private db: DatabaseType;
  private jsonColumns: Set<string>;
  private arrayColumns: Set<string>;
  private booleanColumns: Set<string>;
  private blobColumns: Set<string>;
  private preparedStatements: Map<string, Statement> = new Map();

  constructor(db: DatabaseType, name: string, jsonColumns: string[] = [], arrayColumns: string[] = [], booleanColumns: string[] = [], blobColumns: string[] = []) {
    this.db = db;
    this.name = name;
    this.jsonColumns = new Set(jsonColumns);
    this.arrayColumns = new Set(arrayColumns);
    this.booleanColumns = new Set(booleanColumns);
    this.blobColumns = new Set(blobColumns);
  }

  /**
   * Get or create a prepared statement
   */
  private getStatement(key: string, sql: string): Statement {
    if (!this.preparedStatements.has(key)) {
      this.preparedStatements.set(key, this.db.prepare(sql));
    }
    return this.preparedStatements.get(key)!;
  }

  /**
   * Find a single document
   */
  async findOne(filter: TypedQueryFilter<T>, options?: QueryOptions): Promise<T | null> {
    try {
      const query = buildSelectQuery(this.name, filter as QueryFilter, { ...options, limit: 1 }, this.jsonColumns, this.arrayColumns);
      const row = this.db.prepare(query.sql).get(...query.params) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return this.hydrateRow(row);
    } catch (error) {
      logger.error('SQLite findOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find multiple documents
   */
  async find(filter: TypedQueryFilter<T>, options?: QueryOptions): Promise<T[]> {
    try {
      const query = buildSelectQuery(this.name, filter as QueryFilter, options, this.jsonColumns, this.arrayColumns);
      const rows = this.db.prepare(query.sql).all(...query.params) as Record<string, unknown>[];

      return rows.map(row => this.hydrateRow(row));
    } catch (error) {
      logger.error('SQLite find error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Insert a single document
   */
  async insertOne(document: T): Promise<InsertResult> {
    try {
      const doc = document as Record<string, unknown>;
      const row = documentToRow(doc, Array.from(this.jsonColumns), this.blobColumns);

      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      const values = Object.values(row);

      const sql = `INSERT INTO "${this.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
      const result = this.db.prepare(sql).run(...values);

      return {
        insertedId: doc.id as string,
        acknowledged: result.changes > 0,
      };
    } catch (error) {
      logger.error('SQLite insertOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Insert multiple documents
   */
  async insertMany(documents: T[]): Promise<{ insertedIds: string[]; acknowledged: boolean }> {
    if (documents.length === 0) {
      return { insertedIds: [], acknowledged: true };
    }

    try {
      const insertedIds: string[] = [];
      const firstDoc = documents[0] as Record<string, unknown>;
      const columns = Object.keys(documentToRow(firstDoc, Array.from(this.jsonColumns), this.blobColumns));
      const placeholders = columns.map(() => '?').join(', ');

      const sql = `INSERT INTO "${this.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
      const stmt = this.db.prepare(sql);

      const insertAll = this.db.transaction((docs: T[]) => {
        for (const document of docs) {
          const doc = document as Record<string, unknown>;
          const row = documentToRow(doc, Array.from(this.jsonColumns), this.blobColumns);
          stmt.run(...Object.values(row));
          insertedIds.push(doc.id as string);
        }
      });

      insertAll(documents);
      return { insertedIds, acknowledged: true };
    } catch (error) {
      logger.error('SQLite insertMany error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a single document
   */
  async updateOne(filter: TypedQueryFilter<T>, update: UpdateSpec<T>): Promise<UpdateResult> {
    try {
      // First, check if document exists
      const existing = await this.findOne(filter);
      if (!existing) {
        return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
      }

      const query = buildUpdateQuery(this.name, filter as QueryFilter, update as UpdateSpec<unknown>, this.jsonColumns, this.arrayColumns, this.blobColumns);
      const result = this.db.prepare(query.sql).run(...query.params);

      return {
        matchedCount: result.changes > 0 ? 1 : 0,
        modifiedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite updateOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update multiple documents
   */
  async updateMany(filter: TypedQueryFilter<T>, update: UpdateSpec<T>): Promise<UpdateResult> {
    try {
      const query = buildUpdateQuery(this.name, filter as QueryFilter, update as UpdateSpec<unknown>, this.jsonColumns, this.arrayColumns, this.blobColumns);
      const result = this.db.prepare(query.sql).run(...query.params);

      return {
        matchedCount: result.changes,
        modifiedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite updateMany error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find and update a document, returning the result
   */
  async findOneAndUpdate(
    filter: TypedQueryFilter<T>,
    update: UpdateSpec<T>,
    options?: { returnDocument?: 'before' | 'after'; upsert?: boolean; sort?: import('../../interfaces').SortSpec }
  ): Promise<T | null> {
    try {
      const returnAfter = options?.returnDocument !== 'before';

      // Always find the document first to get its ID
      // This is needed for returnDocument: 'after' since the filter may not match post-update
      const before = await this.findOne(filter, options?.sort ? { sort: options.sort } : undefined);

      if (!before) {
        if (options?.upsert) {
          // Document doesn't exist and upsert is requested
          // This is a simplified implementation - full upsert would need more logic
          logger.warn('Upsert not fully implemented for findOneAndUpdate');
        }
        return null;
      }

      const doc = before as Record<string, unknown>;
      const docId = doc.id;

      // Perform the update using the document's ID for precision
      const updateQuery = buildUpdateQuery(this.name, { id: docId } as QueryFilter, update as UpdateSpec<unknown>, this.jsonColumns, this.arrayColumns, this.blobColumns);
      const result = this.db.prepare(updateQuery.sql).run(...updateQuery.params);

      if (result.changes === 0) {
        return null;
      }

      // Return the appropriate document
      if (returnAfter) {
        // Find by ID since the original filter may no longer match after update
        return await this.findOne({ id: docId } as TypedQueryFilter<T>);
      }

      return before;
    } catch (error) {
      logger.error('SQLite findOneAndUpdate error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a single document
   */
  async deleteOne(filter: TypedQueryFilter<T>): Promise<DeleteResult> {
    try {
      // First find the document to ensure we only delete one
      const existing = await this.findOne(filter);
      if (!existing) {
        return { deletedCount: 0, acknowledged: true };
      }

      // Delete by the document's ID
      const doc = existing as Record<string, unknown>;
      const sql = `DELETE FROM "${this.name}" WHERE "id" = ?`;
      const result = this.db.prepare(sql).run(doc.id);
      return {
        deletedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite deleteOne error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteMany(filter: TypedQueryFilter<T>): Promise<DeleteResult> {
    try {
      const query = buildDeleteQuery(this.name, filter as QueryFilter, this.jsonColumns, this.arrayColumns);
      const result = this.db.prepare(query.sql).run(...query.params);

      return {
        deletedCount: result.changes,
        acknowledged: true,
      };
    } catch (error) {
      logger.error('SQLite deleteMany error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Count documents matching filter
   */
  async countDocuments(filter?: TypedQueryFilter<T>): Promise<number> {
    try {
      const query = buildCountQuery(this.name, (filter || {}) as QueryFilter, this.jsonColumns, this.arrayColumns);

      const result = this.db.prepare(query.sql).get(...query.params) as { count: number };

      return result.count;
    } catch (error) {
      logger.error('SQLite countDocuments error', {
        table: this.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if any documents match filter
   */
  async exists(filter: TypedQueryFilter<T>): Promise<boolean> {
    const count = await this.countDocuments(filter);
    return count > 0;
  }

  /**
   * Hydrate a row from SQLite to a document
   * Converts:
   * - JSON columns (stored as strings) back to objects/arrays
   * - Integer booleans (0/1) back to true/false
   * - null JSON objects to undefined (Zod .optional() expects undefined, not null)
   * - null booleans to undefined (for .optional() boolean fields)
   */
  private hydrateRow(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      // Skip MongoDB _id field if somehow present
      if (key === '_id') continue;

      // BLOB columns: convert Buffer back to number[]
      if (this.blobColumns.has(key)) {
        if (Buffer.isBuffer(value)) {
          result[key] = blobToEmbedding(value);
        } else if (value === null) {
          result[key] = undefined;
        } else {
          // Legacy: might still be JSON text during migration transition.
          // Handles both the JSON-array shape and the index-keyed object shape
          // left by JSON.stringify(Float32Array) on very old rows.
          if (typeof value === 'string') {
            result[key] = parseLegacyEmbeddingText(value);
          } else {
            result[key] = value;
          }
        }
        continue;
      }

      // Check if this is a boolean column (from schema metadata or naming convention)
      const isBoolean = this.booleanColumns.has(key) ||
        key.startsWith('is') ||
        key === 'enabled' ||
        key === 'active' ||
        key === 'npc';  // Known boolean field

      // Parse JSON columns - null JSON values become undefined for Zod .optional() compatibility
      if (this.jsonColumns.has(key)) {
        if (value === null) {
          result[key] = undefined;  // null JSON object → undefined for .optional() schemas
        } else if (typeof value === 'string') {
          // Use fromJsonSafe to handle corrupted/truncated JSON gracefully
          // Returns null for empty strings or parse failures - convert to undefined for .optional() schemas
          const parsed = fromJsonSafe(value);
          if (parsed === null && value !== '' && value !== 'null') {
            // Non-empty string that failed to parse - likely corrupted data
            logger.warn('Corrupted JSON in column, using default', {
              table: this.name,
              column: key,
              valueLength: value.length,
              valuePreview: value.substring(0, 80),
            });
          }
          result[key] = parsed === null ? undefined : parsed;
        } else if (Buffer.isBuffer(value)) {
          // BLOB value in a JSON column — this happens when a column was converted
          // from JSON text to BLOB storage (e.g., embeddings) but blob columns weren't
          // registered for this collection. Deserialize as Float32 embedding.
          result[key] = blobToEmbedding(value);
        } else {
          result[key] = value;  // Already parsed (shouldn't happen, but handle gracefully)
        }
      } else if (isBoolean) {
        // Handle boolean columns - SQLite stores as INTEGER (0/1) or NULL
        if (value === null) {
          result[key] = undefined;  // null boolean → undefined for .optional() schemas
        } else if (typeof value === 'number') {
          result[key] = value === 1;
        } else {
          result[key] = Boolean(value);  // Fallback conversion
        }
      } else if (typeof value === 'number') {
        result[key] = value;
      } else if (Buffer.isBuffer(value)) {
        // Unexpected Buffer in a non-blob, non-JSON column — decode as Float32 BLOB.
        // This handles timing issues where blob columns haven't been registered yet.
        logger.trace('Buffer in non-blob column, decoding as Float32', {
          table: this.name,
          column: key,
          byteLength: value.byteLength,
        });
        result[key] = blobToEmbedding(value);
      } else {
        // Convert null to undefined for Zod .optional() compatibility
        // (.nullable().optional() also accepts undefined, so this is safe for all schemas)
        result[key] = value === null ? undefined : value;
      }
    }

    return result as T;
  }

  /**
   * Add a JSON column to the set
   */
  addJsonColumn(column: string): void {
    this.jsonColumns.add(column);
  }
}

// ============================================================================
// SQLite Backend Implementation
// ============================================================================

/**
 * SQLite Database Backend implementation
 */
export class SQLiteBackend implements DatabaseBackend {
  readonly type = 'sqlite' as const;
  readonly capabilities = SQLITE_CAPABILITIES;

  private config: SQLiteConfig;
  private db: DatabaseType | null = null;
  private _state: ConnectionState = 'disconnected';
  private collectionSchemas: Map<string, z.ZodType> = new Map();
  private collectionJsonColumns: Map<string, string[]> = new Map();
  private collectionArrayColumns: Map<string, string[]> = new Map();
  private collectionBooleanColumns: Map<string, string[]> = new Map();
  private collectionBlobColumns: Map<string, string[]> = new Map();

  constructor(config?: SQLiteConfig) {
    this.config = config || loadSQLiteConfig();
  }

  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (this._state === 'connected' && this.db) {
      return;
    }

    this._state = 'connecting';

    try {
      // Acquire the instance lock before opening the database.
      // This prevents two processes from writing to the same SQLCipher
      // database simultaneously, which causes WAL corruption.
      try {
        acquireInstanceLock(getInstanceLockPath());
      } catch (lockError) {
        this._state = 'error';
        if (lockError instanceof InstanceLockError) {
          logger.error('Cannot open database: another instance holds the lock', {
            conflictPid: lockError.lockInfo.pid,
            conflictHostname: lockError.lockInfo.hostname,
            conflictStartedAt: lockError.lockInfo.startedAt,
            conflictEnvironment: lockError.lockInfo.environment,
            lockPath: lockError.lockPath,
          });

          // Surface the conflict in startup state for the UI
          try {
            const { startupState } = require('@/lib/startup/startup-state');
            startupState.setInstanceLockConflict({
              pid: lockError.lockInfo.pid,
              hostname: lockError.lockInfo.hostname,
              environment: lockError.lockInfo.environment,
              startedAt: lockError.lockInfo.startedAt,
              lockPath: lockError.lockPath,
            });
          } catch {
            // Startup state may not be available yet — log only
          }
        }
        throw lockError;
      }

      this.db = getSQLiteClient(this.config);
      this._state = 'connected';

      setupSQLiteShutdownHandlers();

      // Run integrity check (synchronous, logs result but doesn't block startup)
      runIntegrityCheck(this.db);

      // Start periodic WAL checkpoints
      startPeriodicCheckpoints(this.db);

      // Create a physical backup on startup (async, non-blocking)
      const db = this.db;
      createPhysicalBackup(db)
        .then(() => applyRetentionPolicy())
        .catch((error) => {
          logger.error('Startup physical backup or retention policy failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });

      // Initialize the dedicated LLM logs database (failure is non-fatal)
      try {
        const llmLogsConfig = loadLLMLogsConfig();
        const llmLogsDb = getLLMLogsSQLiteClient(llmLogsConfig);

        if (llmLogsDb) {
          runLLMLogsIntegrityCheck(llmLogsDb);
          startLLMLogsPeriodicCheckpoints(llmLogsDb);

          // Create a physical backup of the logs DB (async, non-blocking)
          createLLMLogsPhysicalBackup(llmLogsDb).catch((error) => {
            logger.error('LLM logs startup physical backup failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      } catch (error) {
        logger.error('Failed to initialize LLM logs database — logs will be unavailable', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Do NOT rethrow — main DB is fine, only logs are affected
      }

      // Initialize the dedicated mount index database (failure is non-fatal)
      try {
        const mountIndexConfig = loadMountIndexConfig();
        const mountIndexDb = getMountIndexSQLiteClient(mountIndexConfig);

        if (mountIndexDb) {
          runMountIndexIntegrityCheck(mountIndexDb);
          startMountIndexPeriodicCheckpoints(mountIndexDb);

          // Create a physical backup of the mount index DB (async,
          // non-blocking). Database-backed document stores keep all of their
          // bytes here, so this is user data and must be part of the sweep.
          createMountIndexPhysicalBackup(mountIndexDb).catch((error) => {
            logger.error('Mount index startup physical backup failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      } catch (error) {
        logger.error('Failed to initialize mount index database — document mounts will be unavailable', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Do NOT rethrow — main DB is fine, only mount index is affected
      }

      logger.info('SQLite backend connected', { path: this.config.path });
    } catch (error) {
      this._state = 'error';
      logger.error('Failed to connect SQLite backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    try {
      // Close LLM logs DB first (non-fatal)
      try {
        closeLLMLogsSQLiteClient();
      } catch (error) {
        logger.error('Error closing LLM logs database during disconnect', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // ...then the mount index (also non-fatal). `connect()` opens all three
      // databases, so `disconnect()` must close all three — otherwise a
      // teardown leaves the mount index pointing at a file that a caller may
      // be about to replace underneath it (bug 64).
      try {
        closeMountIndexSQLiteClient();
      } catch (error) {
        logger.error('Error closing mount index database during disconnect', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      closeSQLiteClient();
      this.db = null;
      this._state = 'disconnected';

      // Release the instance lock after closing the database
      releaseActiveInstanceLock();

      logger.info('SQLite backend disconnected');
    } catch (error) {
      logger.error('Error disconnecting SQLite backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if connected
   */
  async isConnected(): Promise<boolean> {
    return this._state === 'connected' && isSQLiteConnected();
  }

  /**
   * Return the live better-sqlite3 handle, self-healing a handle that was
   * closed behind the backend's back.
   *
   * The backend caches its handle at connect time. If someone closes the
   * underlying client out-of-band — `closeSQLiteClient()` called directly
   * rather than through `disconnect()` — every subsequent operation throws
   * `TypeError: The database connection is not open` for the life of the
   * process, because nothing tells the backend to let go (bug 64). When the
   * backend still believes it is connected but its handle is shut, re-fetch
   * from the client singleton instead of handing out a corpse.
   *
   * Deliberately does NOT reopen while `_state` is anything other than
   * `'connected'`: a suspended backend (see `suspendDatabase()`) is mid-way
   * through having its database files replaced, and reopening there would
   * bind to the pre-swap inode.
   */
  private requireDb(): DatabaseType {
    const db = this.db;

    if (db && db.open) {
      return db;
    }

    if (db && this._state === 'connected') {
      logger.warn('SQLite handle was closed out-of-band — reopening', {
        path: this.config.path,
      });

      const fresh = getSQLiteClient(this.config);
      if (!fresh.open) {
        this.db = null;
        this._state = 'disconnected';
        throw new Error('SQLite backend not connected');
      }

      this.db = fresh;
      return fresh;
    }

    throw new Error('SQLite backend not connected');
  }

  /**
   * Get a collection by name
   */
  /**
   * Register columns that should be stored as Float32 BLOBs instead of JSON text.
   * Call this before using getCollection for tables with embedding columns.
   */
  registerBlobColumns(tableName: string, columns: string[]): void {
    const existing = this.collectionBlobColumns.get(tableName) || [];
    const merged = [...new Set([...existing, ...columns])];
    this.collectionBlobColumns.set(tableName, merged);
  }

  getCollection<T = unknown>(name: string): DatabaseCollection<T> {
    const db = this.requireDb();

    const jsonColumns = this.collectionJsonColumns.get(name) || [];
    const arrayColumns = this.collectionArrayColumns.get(name) || [];
    const booleanColumns = this.collectionBooleanColumns.get(name) || [];
    const blobColumns = this.collectionBlobColumns.get(name) || [];

    return new SQLiteCollection<T>(db, name, jsonColumns, arrayColumns, booleanColumns, blobColumns);
  }

  /**
   * Ensure a collection (table) exists with the specified schema
   */
  async ensureCollection(name: string, schema: z.ZodType): Promise<void> {
    const db = this.requireDb();

    try {
      // Store the schema for later use
      this.collectionSchemas.set(name, schema);

      // Generate DDL from schema
      const ddlStatements = generateDDL(name, schema);

      // Execute DDL
      for (const sql of ddlStatements) {
        db.exec(sql);
      }

      // Detect JSON, array, and boolean columns from schema
      const metadata = extractSchemaMetadata(name, schema);
      const jsonColumns = metadata.fields
        .filter(f => f.type === 'array' || f.type === 'object')
        .map(f => f.name);
      const arrayColumns = metadata.fields
        .filter(f => f.type === 'array')
        .map(f => f.name);
      const booleanColumns = metadata.fields
        .filter(f => f.type === 'boolean')
        .map(f => f.name);

      this.collectionJsonColumns.set(name, jsonColumns);
      this.collectionArrayColumns.set(name, arrayColumns);
      this.collectionBooleanColumns.set(name, booleanColumns);
    } catch (error) {
      logger.error('Failed to ensure collection', {
        table: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Drop a collection (table)
   */
  async dropCollection(name: string): Promise<void> {
    const db = this.requireDb();

    try {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
      this.collectionSchemas.delete(name);
      this.collectionJsonColumns.delete(name);
      this.collectionArrayColumns.delete(name);
      this.collectionBooleanColumns.delete(name);
      this.collectionBlobColumns.delete(name);

      logger.info('Dropped collection', { table: name });
    } catch (error) {
      logger.error('Failed to drop collection', {
        table: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List all collections (tables)
   */
  async listCollections(): Promise<string[]> {
    const db = this.requireDb();

    try {
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      return result.map(r => r.name);
    } catch (error) {
      logger.error('Failed to list collections', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a raw SQL query
   */
  async rawQuery<R = unknown>(query: string, params: unknown[] = []): Promise<R> {
    const db = this.requireDb();

    try {
      // Determine if this is a row-returning statement. CTEs (`WITH ...`)
      // and EXPLAINs are row-returning despite not starting with SELECT —
      // routing them through `.run()` returns a RunResult, not rows, which
      // any caller iterating the result will choke on.
      const trimmed = query.trim().toUpperCase();
      const isRowReturning =
        trimmed.startsWith('SELECT') ||
        trimmed.startsWith('PRAGMA') ||
        trimmed.startsWith('WITH') ||
        trimmed.startsWith('EXPLAIN');
      if (isRowReturning) {
        return db.prepare(query).all(...params) as R;
      } else {
        return db.prepare(query).run(...params) as R;
      }
    } catch (error) {
      logger.error('Raw query failed', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<DatabaseTransaction> {
    const db = this.requireDb();

    // SQLite transactions in better-sqlite3 are handled via the transaction() method
    // For the interface compliance, we provide a wrapper
    return new SQLiteTransaction(db, this.collectionJsonColumns, this.collectionBooleanColumns, this.collectionBlobColumns);
  }

  /**
   * Run a health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    const startTime = Date.now();

    try {
      if (!this.db) {
        return {
          healthy: false,
          latencyMs: Date.now() - startTime,
          message: 'Database not connected',
        };
      }

      // Simple query to verify connection
      this.db.prepare('SELECT 1').get();

      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// SQLite Transaction Implementation
// ============================================================================

/**
 * SQLite Transaction wrapper
 */
class SQLiteTransaction implements DatabaseTransaction {
  private db: DatabaseType;
  private committed = false;
  private rolledBack = false;
  private jsonColumns: Map<string, string[]>;
  private booleanColumns: Map<string, string[]>;
  private blobColumns: Map<string, string[]>;

  constructor(db: DatabaseType, jsonColumns: Map<string, string[]>, booleanColumns: Map<string, string[]>, blobColumns: Map<string, string[]> = new Map()) {
    this.db = db;
    this.jsonColumns = jsonColumns;
    this.booleanColumns = booleanColumns;
    this.blobColumns = blobColumns;
    // Start the transaction
    this.db.exec('BEGIN IMMEDIATE');
  }

  async commit(): Promise<void> {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already ended');
    }
    this.db.exec('COMMIT');
    this.committed = true;
  }

  async rollback(): Promise<void> {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already ended');
    }
    this.db.exec('ROLLBACK');
    this.rolledBack = true;
  }

  getCollection<T = unknown>(name: string): DatabaseCollection<T> {
    const jsonCols = this.jsonColumns.get(name) || [];
    const boolCols = this.booleanColumns.get(name) || [];
    const blobCols = this.blobColumns.get(name) || [];
    return new SQLiteCollection<T>(this.db, name, jsonCols, [], boolCols, blobCols);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SQLite backend instance
 */
export async function createSQLiteBackend(config?: SQLiteConfig): Promise<SQLiteBackend> {
  const backend = new SQLiteBackend(config);
  await backend.connect();
  return backend;
}
