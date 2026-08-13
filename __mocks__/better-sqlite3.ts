/**
 * Mock for better-sqlite3 native module
 */

import type { Database as DatabaseType } from 'better-sqlite3';

// Mock prepared statement
class MockStatement {
  run(...params: unknown[]) {
    return { changes: 0, lastInsertRowid: BigInt(0) };
  }

  get(...params: unknown[]) {
    return undefined;
  }

  all(...params: unknown[]) {
    return [];
  }

  iterate(...params: unknown[]) {
    return [][Symbol.iterator]();
  }

  columns() {
    return [];
  }

  bind(...params: unknown[]) {
    return this;
  }
}

// Mock transaction - not used directly, transaction() returns a function

// Mock database
class MockDatabase {
  private isOpen = true;
  private data: Map<string, Map<string, unknown>> = new Map();

  constructor(filename?: string, options?: unknown) {
    // Initialize
  }

  /**
   * Real better-sqlite3 throws `TypeError: The database connection is not
   * open` from every statement method once `close()` has run. Mirroring that
   * matters: a mock that keeps answering after close hides exactly the class
   * of defect where a stale handle is handed out (bug 64).
   */
  private assertOpen() {
    if (!this.isOpen) {
      throw new TypeError('The database connection is not open');
    }
  }

  prepare(sql: string) {
    this.assertOpen();
    return new MockStatement();
  }

  exec(sql: string) {
    this.assertOpen();
    return this;
  }

  pragma(sql: string, options?: { simple?: boolean }) {
    this.assertOpen();
    if (options?.simple) {
      return 0;
    }
    return [];
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T) {
    const tx = (...args: unknown[]) => {
      try {
        return fn(...args);
      } catch (error) {
        throw error;
      }
    };

    (tx as any).immediate = () => fn();
    (tx as any).exclusive = () => fn();
    (tx as any).deferred = () => fn();

    return tx as T & {
      immediate: () => ReturnType<T>;
      exclusive: () => ReturnType<T>;
      deferred: () => ReturnType<T>;
    };
  }

  close() {
    this.isOpen = false;
  }

  get open() {
    return this.isOpen;
  }

  get inTransaction() {
    return false;
  }

  get memory() {
    return false;
  }

  get readonly() {
    return false;
  }

  get name() {
    return 'mock-database';
  }

  function(name: string, options: unknown, fn: (...args: unknown[]) => unknown) {
    return this;
  }

  aggregate(name: string, options: unknown) {
    return this;
  }

  loadExtension(path: string) {
    return this;
  }

  defaultSafeIntegers(toggle?: boolean) {
    return this;
  }

  backup(destinationFile: string, options?: unknown) {
    return Promise.resolve({ totalPages: 0, remainingPages: 0 });
  }

  serialize(options?: unknown) {
    return Buffer.alloc(0);
  }

  static SqliteError = class SqliteError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'SqliteError';
    }
  };
}

// The real better-sqlite3 module uses CJS `module.exports = Database`, so
// `require('better-sqlite3')` returns the constructor directly. Mirror that
// shape so plain `require()` callers (e.g. the quilltap CLI's db-helpers.js
// fallback that does `require('better-sqlite3')` after the
// `better-sqlite3-multiple-ciphers` attempt fails) get a usable constructor
// rather than `{ default: ... }`. TS `import Database from 'better-sqlite3'`
// callers still keep working via esModuleInterop.
export default MockDatabase;
(module.exports as unknown) = MockDatabase;
(module.exports as { default: typeof MockDatabase }).default = MockDatabase;
