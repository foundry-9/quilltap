/**
 * Database Abstraction Layer - Core Interfaces
 *
 * Defines the contracts for database backends to implement,
 * enabling support for multiple database systems (MongoDB, SQLite, etc.).
 */

import { z } from 'zod';

// ============================================================================
// Query Filter Types
// ============================================================================

/**
 * Comparison operators for query filters
 */
export type ComparisonOperator = '$eq' | '$ieq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin' | '$exists' | '$like';

/**
 * Logical operators for combining filters
 */
export type LogicalOperator = '$and' | '$or' | '$not';

/**
 * A single comparison condition
 */
export interface ComparisonCondition {
  $eq?: unknown;
  /** Case-insensitive equality (ASCII NOCASE). Use for filesystem paths and similar identifiers. */
  $ieq?: unknown;
  $ne?: unknown;
  $gt?: number | string | Date;
  $gte?: number | string | Date;
  $lt?: number | string | Date;
  $lte?: number | string | Date;
  $in?: unknown[];
  $nin?: unknown[];
  $exists?: boolean;
  $regex?: RegExp | string;
  $like?: string;
}

/**
 * Type-safe query filter that maps entity field names to filter conditions.
 * When parameterized with an entity type T, only allows fields that exist on T.
 * Supports nested field access with dot notation via explicit cast for
 * fields not directly on T (e.g., 'participants.characterId').
 *
 * The default parameter (Record<string, unknown>) provides backward compatibility
 * so that unparameterized `QueryFilter` accepts any field name.
 */
export type TypedQueryFilter<T = Record<string, unknown>> = {
  [K in keyof T]?: T[K] | ComparisonCondition | null;
} & {
  $and?: TypedQueryFilter<T>[];
  $or?: TypedQueryFilter<T>[];
  $not?: TypedQueryFilter<T>;
  $expr?: Record<string, unknown>;
};

/**
 * Unparameterized query filter — backward-compatible alias.
 * Equivalent to TypedQueryFilter<Record<string, unknown>>, accepts any field name.
 */
export type QueryFilter = TypedQueryFilter;

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc' | 1 | -1;

/**
 * Sort specification
 */
export interface SortSpec {
  [field: string]: SortDirection;
}

/**
 * Query options for find operations
 */
export interface QueryOptions {
  /** Sort specification */
  sort?: SortSpec;
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip (for pagination) */
  skip?: number;
  /** Fields to include/exclude (projection) */
  projection?: { [field: string]: 0 | 1 | boolean };
}

// ============================================================================
// Update Types
// ============================================================================

/**
 * Update operators
 */
export interface UpdateOperators<T = unknown> {
  /** Set fields to values */
  $set?: Partial<T>;
  /** Unset (remove) fields */
  $unset?: { [K in keyof T]?: true | 1 | '' };
  /** Increment numeric fields */
  $inc?: { [K in keyof T]?: number };
  /** Push values to arrays */
  $push?: { [K in keyof T]?: unknown };
  /** Pull values from arrays */
  $pull?: { [K in keyof T]?: unknown };
  /** Add unique values to arrays */
  $addToSet?: { [K in keyof T]?: unknown };
}

/**
 * Update specification - either a partial object or update operators
 */
export type UpdateSpec<T = unknown> = Partial<T> | UpdateOperators<T>;

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of an insert operation
 */
export interface InsertResult {
  /** The inserted document ID */
  insertedId: string;
  /** Whether the operation was acknowledged */
  acknowledged: boolean;
}

/**
 * Result of an update operation
 */
export interface UpdateResult {
  /** Number of documents matched */
  matchedCount: number;
  /** Number of documents modified */
  modifiedCount: number;
  /** Whether the operation was acknowledged */
  acknowledged: boolean;
  /** ID of upserted document, if applicable */
  upsertedId?: string;
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
  /** Number of documents deleted */
  deletedCount: number;
  /** Whether the operation was acknowledged */
  acknowledged: boolean;
}

/**
 * Result of a count operation
 */
export interface CountResult {
  /** The count of matching documents */
  count: number;
}

// ============================================================================
// Backend Capabilities
// ============================================================================

/**
 * Capabilities that a database backend may support
 */
export interface DatabaseCapabilities {
  /** Supports transactions */
  transactions: boolean;
  /** Supports native JSON field querying */
  jsonFields: boolean;
  /** Supports array field operations ($push, $pull, etc.) */
  arrayOperations: boolean;
  /** Supports text search */
  textSearch: boolean;
  /** Supports vector search/embeddings */
  vectorSearch: boolean;
  /** Supports nested field dot notation queries */
  nestedFieldQueries: boolean;
  /** Supports regex queries */
  regexQueries: boolean;
  /** Supports aggregation pipelines */
  aggregation: boolean;
  /** Supports change streams / real-time updates */
  changeStreams: boolean;
  /** Maximum document size in bytes (0 for no limit) */
  maxDocumentSize: number;
  /** Supports upsert operations */
  upsert: boolean;
}

/**
 * Default capabilities for unknown backends
 */
export const DEFAULT_CAPABILITIES: DatabaseCapabilities = {
  transactions: false,
  jsonFields: false,
  arrayOperations: false,
  textSearch: false,
  vectorSearch: false,
  nestedFieldQueries: false,
  regexQueries: false,
  aggregation: false,
  changeStreams: false,
  maxDocumentSize: 0,
  upsert: false,
};


/**
 * SQLite capabilities
 */
export const SQLITE_CAPABILITIES: DatabaseCapabilities = {
  transactions: true,
  jsonFields: true, // Via JSON1 extension
  arrayOperations: false, // Must be handled in application layer
  textSearch: true, // Via FTS5 extension
  vectorSearch: false, // Not supported natively
  nestedFieldQueries: true, // Via json_extract
  regexQueries: false, // Limited support
  aggregation: false, // No pipeline support, but has SQL aggregates
  changeStreams: false,
  maxDocumentSize: 1024 * 1024 * 1024, // 1GB (practical limit)
  upsert: true, // Via INSERT OR REPLACE / ON CONFLICT
};

// ============================================================================
// Collection/Table Interface
// ============================================================================

/**
 * Abstract collection interface - represents a MongoDB collection or SQLite table
 */
export interface DatabaseCollection<T = unknown> {
  /** Collection/table name */
  readonly name: string;

  /**
   * Find a single document by filter
   */
  findOne(filter: TypedQueryFilter<T>, options?: QueryOptions): Promise<T | null>;

  /**
   * Find multiple documents by filter
   */
  find(filter: TypedQueryFilter<T>, options?: QueryOptions): Promise<T[]>;

  /**
   * Insert a single document
   */
  insertOne(document: T): Promise<InsertResult>;

  /**
   * Insert multiple documents
   */
  insertMany(documents: T[]): Promise<{ insertedIds: string[]; acknowledged: boolean }>;

  /**
   * Update a single document
   */
  updateOne(filter: TypedQueryFilter<T>, update: UpdateSpec<T>): Promise<UpdateResult>;

  /**
   * Update multiple documents
   */
  updateMany(filter: TypedQueryFilter<T>, update: UpdateSpec<T>): Promise<UpdateResult>;

  /**
   * Find and update a document, returning the result
   */
  findOneAndUpdate(
    filter: TypedQueryFilter<T>,
    update: UpdateSpec<T>,
    options?: { returnDocument?: 'before' | 'after'; upsert?: boolean; sort?: SortSpec }
  ): Promise<T | null>;

  /**
   * Delete a single document
   */
  deleteOne(filter: TypedQueryFilter<T>): Promise<DeleteResult>;

  /**
   * Delete multiple documents
   */
  deleteMany(filter: TypedQueryFilter<T>): Promise<DeleteResult>;

  /**
   * Count documents matching filter
   */
  countDocuments(filter?: TypedQueryFilter<T>): Promise<number>;

  /**
   * Check if any documents match filter
   */
  exists(filter: TypedQueryFilter<T>): Promise<boolean>;
}

// ============================================================================
// Database Backend Interface
// ============================================================================

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Main database backend interface
 * Implemented by SQLite
 */
export interface DatabaseBackend {
  /** Backend identifier */
  readonly type: 'sqlite';

  /** Backend capabilities */
  readonly capabilities: DatabaseCapabilities;

  /** Current connection state */
  readonly state: ConnectionState;

  /**
   * Connect to the database
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the database
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): Promise<boolean>;

  /**
   * Get a collection/table by name
   */
  getCollection<T = unknown>(name: string): DatabaseCollection<T>;

  /**
   * Ensure a collection/table exists with the specified schema
   * For SQLite, this creates the table if it doesn't exist
   * For MongoDB, this is largely a no-op but may create indexes
   */
  ensureCollection(name: string, schema: z.ZodType): Promise<void>;

  /**
   * Drop a collection/table
   */
  dropCollection(name: string): Promise<void>;

  /**
   * List all collection/table names
   */
  listCollections(): Promise<string[]>;

  /**
   * Execute a raw query (backend-specific)
   * Use with caution - breaks abstraction
   */
  rawQuery<R = unknown>(query: string, params?: unknown[]): Promise<R>;

  /**
   * Begin a transaction (if supported)
   */
  beginTransaction?(): Promise<DatabaseTransaction>;

  /**
   * Run a health check
   */
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }>;
}

/**
 * Transaction interface for backends that support transactions
 */
export interface DatabaseTransaction {
  /** Commit the transaction */
  commit(): Promise<void>;
  /** Rollback the transaction */
  rollback(): Promise<void>;
  /** Get a collection within the transaction context */
  getCollection<T = unknown>(name: string): DatabaseCollection<T>;
}

// ============================================================================
// Schema Metadata
// ============================================================================

/**
 * Field type information extracted from Zod schemas
 */
export interface FieldMetadata {
  /** Field name */
  name: string;
  /** TypeScript/Zod type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'unknown';
  /** Whether the field is optional */
  optional: boolean;
  /** Whether the field is nullable */
  nullable: boolean;
  /** Default value if any */
  defaultValue?: unknown;
  /** For string fields, max length constraint */
  maxLength?: number;
  /** For number fields, constraints */
  min?: number;
  max?: number;
  /** For arrays, the element type */
  elementType?: FieldMetadata;
  /** For objects, nested field metadata */
  fields?: FieldMetadata[];
  /** Whether this is a primary key */
  isPrimaryKey?: boolean;
  /** Whether this field should be indexed */
  indexed?: boolean;
  /** Whether this field should be unique */
  unique?: boolean;
}

/**
 * Table/collection schema metadata
 */
export interface SchemaMetadata {
  /** Collection/table name */
  name: string;
  /** Field definitions */
  fields: FieldMetadata[];
  /** Primary key field name(s) */
  primaryKey: string | string[];
  /** Index definitions */
  indexes?: IndexDefinition[];
}

/**
 * Index definition
 */
export interface IndexDefinition {
  /** Index name */
  name: string;
  /** Fields to index */
  fields: { [field: string]: 1 | -1 };
  /** Whether the index is unique */
  unique?: boolean;
  /** Whether the index is sparse (only indexes documents with the field) */
  sparse?: boolean;
}

// ============================================================================
// Base Entity Interface
// ============================================================================

/**
 * Base interface for all entities stored in the database
 * All entities must have these common fields
 */
export interface BaseEntity {
  /** UUID v4 identifier */
  id: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last update timestamp */
  updatedAt: string;
}

/**
 * User-owned entity interface
 * Most entities are scoped to a user
 */
export interface UserOwnedEntity extends BaseEntity {
  /** Owner user ID */
  userId: string;
}

/**
 * Taggable entity interface
 * Entities that support tagging
 */
export interface TaggableEntity extends UserOwnedEntity {
  /** Array of tag IDs */
  tags: string[];
}
