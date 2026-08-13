/**
 * Database Abstraction Layer
 *
 * Provides a unified interface for database operations that works
 * with multiple backends (MongoDB, SQLite).
 *
 * Usage:
 *   import { initializeDatabase, getCollection } from '@/lib/database';
 *
 *   // Initialize on startup
 *   await initializeDatabase();
 *
 *   // Get a collection
 *   const collection = await getCollection<Character>('characters');
 *
 *   // Use collection methods
 *   const character = await collection.findOne({ id });
 */

// Core interfaces - types
export type {
  // Query types
  TypedQueryFilter,
  QueryFilter,
  QueryOptions,
  SortSpec,
  SortDirection,
  ComparisonCondition,
  ComparisonOperator,
  LogicalOperator,

  // Update types
  UpdateSpec,
  UpdateOperators,

  // Result types
  InsertResult,
  UpdateResult,
  DeleteResult,
  CountResult,

  // Backend types
  DatabaseBackend,
  DatabaseCollection,
  DatabaseTransaction,
  ConnectionState,
  DatabaseCapabilities,

  // Entity types
  BaseEntity,
  UserOwnedEntity,
  TaggableEntity,

  // Schema types
  FieldMetadata,
  SchemaMetadata,
  IndexDefinition,
} from './interfaces';

// Core interfaces - values
export {
  // Capability constants
  DEFAULT_CAPABILITIES,
  SQLITE_CAPABILITIES,
} from './interfaces';

// Configuration - types
export type {
  DatabaseBackendType,
  DatabaseConfig,
  SQLiteConfig,
} from './config';

// Configuration - functions
export {
  getDatabaseConfig,
  loadDatabaseConfig,
  resetDatabaseConfig,
  setDatabaseConfig,
  validateDatabaseReady,
  backendSupports,
  detectBackend,
  getDefaultDataDirectory,
  getDefaultSQLitePath,
  ensureDataDirectoryExists,
} from './config';

// Manager (main entry points)
export {
  initializeDatabase,
  getDatabase,
  getDatabaseAsync,
  closeDatabase,
  suspendDatabase,
  resumeDatabase,
  isDatabaseInitialized,
  isDatabaseConnected,
  getCollection,
  ensureCollection,
  listCollections,
  getBackendType,
  getBackendCapabilities,
  supportsCapability,
  healthCheck,
  rawQuery,
  withTransaction,
} from './manager';

// Schema translation - types
export type { SchemaDiff } from './schema-translator';

// Schema translation - functions
export {
  extractSchemaMetadata,
  generateDDL,
  generateCreateTable,
  generateCreateIndexes,
  generateAlterStatements,
  compareSchemas,
} from './schema-translator';

// Base repositories - types
export type {
  CreateOptions,
  ValidationResult,
} from './repositories/base.repository';

// Base repositories - classes
export {
  AbstractBaseRepository,
  UserOwnedBaseRepository,
  TaggableBaseRepository,
} from './repositories/base.repository';

// Backend-specific exports (for advanced use cases)
export { SQLiteBackend, createSQLiteBackend } from './backends/sqlite';
