/**
 * Database Manager
 *
 * Singleton orchestrator for the database abstraction layer.
 * Handles backend initialization, collection management, and provides
 * the main entry point for database operations.
 */

import { z } from 'zod';
import { DatabaseBackend, DatabaseCollection, DatabaseCapabilities } from './interfaces';
import { getDatabaseConfig, DatabaseBackendType } from './config';
import { createSQLiteBackend, SQLiteBackend } from './backends/sqlite';
import { logger } from '@/lib/logger';

// ============================================================================
// Global State Persistence
// ============================================================================

// Extend globalThis type for our database manager state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapDatabaseBackend: DatabaseBackend | undefined;
  var __quilltapDatabaseInitPromise: Promise<DatabaseBackend> | undefined;
  var __quilltapDatabaseInitialized: boolean | undefined;
}

/**
 * Get database backend from global state
 */
function getDatabaseBackend(): DatabaseBackend | null {
  return global.__quilltapDatabaseBackend ?? null;
}

/**
 * Set database backend in global state
 */
function setDatabaseBackend(backend: DatabaseBackend | null): void {
  global.__quilltapDatabaseBackend = backend ?? undefined;
}

/**
 * Get initialization promise from global state
 */
function getInitPromise(): Promise<DatabaseBackend> | null {
  return global.__quilltapDatabaseInitPromise ?? null;
}

/**
 * Set initialization promise in global state
 */
function setInitPromise(promise: Promise<DatabaseBackend> | null): void {
  global.__quilltapDatabaseInitPromise = promise ?? undefined;
}

/**
 * Check if database is initialized (from global state)
 */
function isDbInitialized(): boolean {
  return global.__quilltapDatabaseInitialized ?? false;
}

/**
 * Set initialization status in global state
 */
function setDbInitialized(initialized: boolean): void {
  global.__quilltapDatabaseInitialized = initialized;
}

// ============================================================================
// Backend Factory
// ============================================================================

/**
 * Create the SQLite backend
 */
async function createBackend(backendType: DatabaseBackendType): Promise<DatabaseBackend> {
  logger.info('Creating database backend', { type: backendType });

  if (backendType === 'sqlite') {
    return createSQLiteBackend();
  }

  throw new Error(`Unknown database backend: ${backendType}`);
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the database backend
 * This is idempotent - calling multiple times returns the same backend
 */
export async function initializeDatabase(): Promise<DatabaseBackend> {
  // Return existing backend if already initialized
  const existingBackend = getDatabaseBackend();
  if (isDbInitialized() && existingBackend) {
    return existingBackend;
  }

  // Return existing promise if initialization is in progress
  const existingPromise = getInitPromise();
  if (existingPromise) {
    return existingPromise;
  }

  // Start initialization
  const initPromise = (async () => {
    try {
      const config = getDatabaseConfig();
      const backend = await createBackend(config.backend);

      // Register known BLOB columns before exposing the backend.
      // This ensures all collections created via getCollection() will
      // correctly serialize/deserialize Float32 embeddings as BLOBs,
      // regardless of which repository is accessed first.
      if (backend instanceof SQLiteBackend) {
        backend.registerBlobColumns('memories', ['embedding']);
        backend.registerBlobColumns('vector_entries', ['embedding']);
        backend.registerBlobColumns('conversation_chunks', ['embedding']);
        backend.registerBlobColumns('help_docs', ['embedding']);
      }

      setDatabaseBackend(backend);
      setDbInitialized(true);

      logger.info('Database backend initialized', {
        type: backend.type,
        capabilities: backend.capabilities,
      });

      return backend;
    } catch (error) {
      logger.error('Failed to initialize database backend', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      setInitPromise(null);
    }
  })();

  setInitPromise(initPromise);
  return initPromise;
}

/**
 * Get the initialized database backend
 * Throws if not initialized - use initializeDatabase() first
 */
export function getDatabase(): DatabaseBackend {
  const backend = getDatabaseBackend();
  if (!isDbInitialized() || !backend) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return backend;
}

/**
 * Get the database backend, initializing if necessary
 * This is the recommended way to get the database in most cases
 */
export async function getDatabaseAsync(): Promise<DatabaseBackend> {
  const backend = getDatabaseBackend();
  if (isDbInitialized() && backend) {
    return backend;
  }
  return initializeDatabase();
}

/**
 * Check if the database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return isDbInitialized() && getDatabaseBackend() !== null;
}

/**
 * Check if the database is connected
 */
export async function isDatabaseConnected(): Promise<boolean> {
  const backend = getDatabaseBackend();
  if (!backend) {
    return false;
  }
  return backend.isConnected();
}

// ============================================================================
// Shutdown
// ============================================================================

/**
 * Close the database connection and clean up
 */
export async function closeDatabase(): Promise<void> {
  const backend = getDatabaseBackend();
  if (!backend) {
    return;
  }

  try {
    await backend.disconnect();
    setDatabaseBackend(null);
    setDbInitialized(false);
    setInitPromise(null);

    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Collection Access
// ============================================================================

/**
 * Get a collection from the database
 * Initializes the database if not already initialized
 */
export async function getCollection<T = unknown>(name: string): Promise<DatabaseCollection<T>> {
  const backend = await getDatabaseAsync();
  return backend.getCollection<T>(name);
}

/**
 * Ensure a collection exists with the specified schema
 */
export async function ensureCollection(name: string, schema: z.ZodType): Promise<void> {
  const backend = await getDatabaseAsync();
  await backend.ensureCollection(name, schema);
}

/**
 * Register columns that should be stored/hydrated as Float32 BLOBs.
 * Must be called before using getCollection for the table.
 */
export async function registerBlobColumns(tableName: string, columns: string[]): Promise<void> {
  const backend = await getDatabaseAsync();
  if (backend instanceof SQLiteBackend) {
    backend.registerBlobColumns(tableName, columns);
  }
}

/**
 * Get all collection names
 */
export async function listCollections(): Promise<string[]> {
  const backend = await getDatabaseAsync();
  return backend.listCollections();
}

// ============================================================================
// Capabilities
// ============================================================================

/**
 * Get the current backend type
 */
export function getBackendType(): DatabaseBackendType | null {
  return getDatabaseBackend()?.type || null;
}

/**
 * Get the current backend capabilities
 */
export function getBackendCapabilities(): DatabaseCapabilities | null {
  return getDatabaseBackend()?.capabilities || null;
}

/**
 * Check if the current backend supports a specific capability
 */
export function supportsCapability(capability: keyof DatabaseCapabilities): boolean {
  const backend = getDatabaseBackend();
  if (!backend) {
    return false;
  }
  return Boolean(backend.capabilities[capability]);
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Run a health check on the database
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  backend: string;
  latencyMs: number;
  message?: string;
}> {
  const backend = getDatabaseBackend();
  if (!backend) {
    return {
      healthy: false,
      backend: 'none',
      latencyMs: 0,
      message: 'Database not initialized',
    };
  }

  const result = await backend.healthCheck();

  return {
    ...result,
    backend: backend.type,
  };
}

// ============================================================================
// Raw Query Access
// ============================================================================

/**
 * Execute a raw query on the database
 * Use with caution - this bypasses the abstraction layer
 */
export async function rawQuery<R = unknown>(query: string, params?: unknown[]): Promise<R> {
  const backend = await getDatabaseAsync();
  return backend.rawQuery<R>(query, params);
}

// ============================================================================
// Transaction Support
// ============================================================================

/**
 * Execute a function within a transaction
 */
export async function withTransaction<T>(
  fn: (getCollection: <C>(name: string) => DatabaseCollection<C>) => Promise<T>
): Promise<T> {
  const backend = await getDatabaseAsync();

  if (!backend.beginTransaction) {
    // Backend doesn't support transactions, run without
    logger.warn('Backend does not support transactions, running without');
    return fn(<C>(name: string) => backend.getCollection<C>(name));
  }

  const transaction = await backend.beginTransaction();

  try {
    const result = await fn(<C>(name: string) => transaction.getCollection<C>(name));
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

// ============================================================================
// Testing Support
// ============================================================================

/**
 * Reset the database manager (for testing only)
 */
export function _resetForTesting(): void {
  setDatabaseBackend(null);
  setInitPromise(null);
  setDbInitialized(false);
}

/**
 * Set a mock backend (for testing only)
 */
export function _setBackendForTesting(backend: DatabaseBackend): void {
  setDatabaseBackend(backend);
  setDbInitialized(true);
}
