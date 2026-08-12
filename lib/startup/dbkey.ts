/**
 * Database Key Manager (dbkey)
 *
 * Manages the ENCRYPTION_MASTER_PEPPER lifecycle using a `.dbkey` file on disk,
 * replacing the older pepper-vault.ts which stored encrypted pepper in SQLite.
 *
 * The `.dbkey` file is a JSON document containing the encrypted pepper, its
 * verification hash, and all the cryptographic parameters needed to decrypt it.
 * File permissions are set to 0o600 (owner read/write only) for security.
 *
 * Lifecycle:
 * - On first run, generates a new pepper and writes it to `quilltap.dbkey`
 * - On subsequent startups, reads and decrypts the pepper from the file
 * - Supports optional user-provided passphrase for additional security
 * - When no passphrase is set, uses an internal passphrase for encryption
 *
 * IMPORTANT: This module intentionally avoids importing from lib/env.ts,
 * lib/logger.ts, or lib/encryption.ts to prevent circular dependencies
 * and premature env validation. It uses only Node built-ins (crypto, fs, path)
 * plus the migration logger and the paths module (which itself has no
 * problematic dependencies).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger as migrationLogger } from '../../migrations/lib/logger';
import { getDataDir } from '@/lib/paths';
import {
  cacheRuntimePassphrase,
  clearRuntimePassphrase,
} from './passphrase-cache';
import {
  type PepperCryptoParams,
  decryptPepperWithParams,
  encryptPepperWithParams,
  hashPepper,
} from './pepper-crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * The state of the database key provisioning lifecycle.
 *
 * - `resolved` — Pepper is available in process.env and verified
 * - `needs-setup` — No pepper exists; first-run setup required
 * - `needs-passphrase` — A .dbkey file exists with a user passphrase; unlock required
 * - `needs-vault-storage` — Pepper is set via env var but has no .dbkey file yet
 */
export type DbKeyState =
  | 'resolved'
  | 'needs-setup'
  | 'needs-passphrase'
  | 'needs-vault-storage';

/**
 * The JSON structure of the `quilltap.dbkey` file on disk.
 *
 * Contains all cryptographic parameters needed to decrypt the pepper,
 * plus a hash for verification. The file is intentionally opaque — it does
 * not reveal whether a user passphrase was used.
 */
interface DbKeyFileData {
  /** Schema version for forward compatibility */
  version: number;
  /** Encryption algorithm used (always 'aes-256-gcm') */
  algorithm: string;
  /** Key derivation function (always 'pbkdf2') */
  kdf: string;
  /** Number of PBKDF2 iterations */
  kdfIterations: number;
  /** PBKDF2 digest algorithm */
  kdfDigest: string;
  /** Random salt for PBKDF2 key derivation (hex-encoded) */
  salt: string;
  /** Initialization vector for AES-GCM (hex-encoded) */
  iv: string;
  /** Encrypted pepper data (hex-encoded) */
  ciphertext: string;
  /** GCM authentication tag for tamper detection (hex-encoded) */
  authTag: string;
  /** SHA-256 hash of the plaintext pepper for verification (hex-encoded) */
  pepperHash: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Encryption algorithm — AES-256 in GCM mode for authenticated encryption */
const ALGORITHM = 'aes-256-gcm';

/** AES-256 key length in bytes (256 bits) */
const KEY_LENGTH = 32;

/** GCM initialization vector length in bytes (128 bits) */
const IV_LENGTH = 16;

/** PBKDF2 salt length in bytes (256 bits) */
const SALT_LENGTH = 32;

/** PBKDF2 iteration count — upgraded from 100k in pepper-vault to 600k */
const PBKDF2_ITERATIONS = 600000;

/** PBKDF2 digest algorithm */
const PBKDF2_DIGEST = 'sha256';

/**
 * Internal passphrase used when the user opts out of setting a custom one.
 * Matches the convention from pepper-vault.ts.
 * Exported so the unlock route can use it for passphrase change operations.
 */
export const INTERNAL_PASSPHRASE = '__quilltap_no_passphrase__';

/**
 * The instance's one and only .dbkey file.
 *
 * There is a single pepper per instance, wrapped once here. Every database —
 * main, LLM logs, and mount index — opens with it. Quilltap once wrote a second
 * copy at `quilltap-llm-logs.dbkey`, the remnant of a per-database-key design
 * that was never built; nothing ever read it, and it could hold a stale
 * wrapping, so the write was removed in 4.8.1. Instances that changed a
 * passphrase before then may still have that file on disk; it is inert and safe
 * to delete.
 */
const DBKEY_FILENAME = 'quilltap.dbkey';

const log = migrationLogger.child({ context: 'dbkey' });

// ============================================================================
// Module State (stored on global to survive Next.js HMR reloads)
// ============================================================================

declare global {
  var __quilltapDbKeyState: DbKeyState | undefined;
  var __quilltapHasUserPassphrase: boolean | undefined;
}

/**
 * Get the current module-level dbkey state.
 * Defaults to 'needs-setup' if not yet initialized.
 */
function getCurrentState(): DbKeyState {
  return global.__quilltapDbKeyState || 'needs-setup';
}

/**
 * Set the module-level dbkey state on the global object.
 */
function setCurrentState(state: DbKeyState): void {
  global.__quilltapDbKeyState = state;
}

// ============================================================================
// Crypto Helpers (private)
// ============================================================================

function encryptPepper(pepper: string, passphrase: string): DbKeyFileData {
  const bundle = encryptPepperWithParams(pepper, passphrase, {
    algorithm: ALGORITHM,
    keyLength: KEY_LENGTH,
    ivLength: IV_LENGTH,
    saltLength: SALT_LENGTH,
    kdfIterations: PBKDF2_ITERATIONS,
    kdfDigest: PBKDF2_DIGEST,
  });
  return {
    version: 1,
    algorithm: ALGORITHM,
    kdf: 'pbkdf2',
    kdfIterations: PBKDF2_ITERATIONS,
    kdfDigest: PBKDF2_DIGEST,
    ...bundle,
    pepperHash: hashPepper(pepper),
  };
}

/**
 * Decrypt the pepper from a .dbkey file using the given passphrase. The
 * cryptographic params (algorithm, iterations, digest) are read from the
 * file itself so older files keep decrypting after future param upgrades.
 */
function decryptPepperFromFile(data: DbKeyFileData, passphrase: string): string | null {
  const params: PepperCryptoParams = {
    algorithm: data.algorithm,
    keyLength: KEY_LENGTH,
    ivLength: IV_LENGTH,
    saltLength: SALT_LENGTH,
    kdfIterations: data.kdfIterations,
    kdfDigest: data.kdfDigest,
  };
  return decryptPepperWithParams(data, passphrase, params);
}

/**
 * Generate a cryptographically secure pepper.
 *
 * Produces 32 random bytes encoded as base64, yielding a 44-character string.
 *
 * @returns A new random pepper string
 */
function generatePepper(): string {
  const pepper = crypto.randomBytes(32).toString('base64');
  return pepper;
}

// ============================================================================
// File I/O Helpers (private)
// ============================================================================

/**
 * Read and parse a .dbkey JSON file from disk.
 *
 * @param filePath - Absolute path to the .dbkey file
 * @returns Parsed DbKeyFileData, or null if the file doesn't exist or is invalid
 */
function readDbKeyFile(filePath: string): DbKeyFileData | null {

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const raw = JSON.parse(content);

    // Strip legacy hasPassphrase field if present — it leaks whether a
    // user passphrase was set. Rewrite the file without it.
    if ('hasPassphrase' in raw) {
      log.info('Stripping legacy hasPassphrase flag from .dbkey file', { path: filePath });
      delete raw.hasPassphrase;
      const cleaned = JSON.stringify(raw, null, 2);
      fs.writeFileSync(filePath, cleaned, { mode: 0o600 });
    }

    const data = raw as DbKeyFileData;

    return data;
  } catch (error) {
    log.error('Failed to read .dbkey file', {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Write a DbKeyFileData structure to disk as formatted JSON.
 *
 * Sets file permissions to 0o600 (owner read/write only) for security.
 * Creates the parent directory if it doesn't exist.
 *
 * @param filePath - Absolute path to write the .dbkey file
 * @param data - The DbKeyFileData structure to serialize
 */
function writeDbKeyFile(filePath: string, data: DbKeyFileData): void {

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current database key provisioning state.
 *
 * @returns The current DbKeyState
 */
export function getDbKeyState(): DbKeyState {
  return getCurrentState();
}

/**
 * Get the path to the instance's .dbkey file.
 *
 * @returns Absolute path to `quilltap.dbkey` in the data directory
 */
export function getDbKeyPath(): string {
  return path.join(getDataDir(), DBKEY_FILENAME);
}

/**
 * Provision the database key on startup.
 *
 * Determines the pepper state and auto-resolves when possible. This is the
 * main entry point called during application startup (from instrumentation.ts)
 * before logger/env imports.
 *
 * Resolution logic:
 * 1. If ENCRYPTION_MASTER_PEPPER env var is set AND .dbkey exists:
 *    verify hash match (fatal on mismatch), return 'resolved'
 * 2. If env var is set but no .dbkey: return 'needs-vault-storage'
 * 3. If no env var but .dbkey exists without passphrase:
 *    decrypt silently, set env, return 'resolved'
 * 4. If no env var but .dbkey exists with passphrase:
 *    return 'needs-passphrase'
 * 5. If neither exists: return 'needs-setup'
 *
 * @returns The resulting DbKeyState after provisioning
 */
export async function provisionDbKey(): Promise<DbKeyState> {
  log.info('Provisioning database key');

  try {
    const dbKeyPath = getDbKeyPath();
    const envPepper = process.env.ENCRYPTION_MASTER_PEPPER || '';
    const fileData = readDbKeyFile(dbKeyPath);

    // Case 1: Env var set + .dbkey file exists
    if (envPepper && fileData) {
      const envHash = hashPepper(envPepper);

      if (envHash === fileData.pepperHash) {
        log.info('DbKey resolved: env var matches stored hash');
        // Only set passphrase flag if not already determined (e.g., by unlockDbKey)
        if (global.__quilltapHasUserPassphrase === undefined) {
          // Env var was provided directly — no passphrase was needed
          global.__quilltapHasUserPassphrase = false;
        }
        setCurrentState('resolved');
        return 'resolved';
      }

      // Hash mismatch — FATAL: pepper was changed externally
      log.error(
        'FATAL: ENCRYPTION_MASTER_PEPPER does not match stored pepper hash in .dbkey file. ' +
        'The pepper has been changed since it was stored. ' +
        'This would cause all encrypted data to become unreadable. ' +
        'Restore the original pepper or delete the .dbkey file to re-initialize.',
        {
          envHashPrefix: envHash.substring(0, 12),
          storedHashPrefix: fileData.pepperHash.substring(0, 12),
          dbKeyPath,
        }
      );
      process.exit(1);
    }

    // Case 2: Env var set + no .dbkey file
    if (envPepper && !fileData) {
      log.info('Pepper resolved from env var, .dbkey file storage recommended', {
        dbKeyPath,
      });
      global.__quilltapHasUserPassphrase = false;
      setCurrentState('needs-vault-storage');
      return 'needs-vault-storage';
    }

    // Case 3: No env var + .dbkey file exists
    // Always try the internal passphrase first. If it works, no user passphrase
    // was set. If it fails, assume a user passphrase is required.
    if (!envPepper && fileData) {
      const pepper = decryptPepperFromFile(fileData, INTERNAL_PASSPHRASE);

      if (pepper && hashPepper(pepper) === fileData.pepperHash) {
        log.info('DbKey resolved: decrypted from .dbkey file (no passphrase)');
        global.__quilltapHasUserPassphrase = false;
        process.env.ENCRYPTION_MASTER_PEPPER = pepper;
        setCurrentState('resolved');
        return 'resolved';
      }

      // Internal passphrase failed — user passphrase required
      log.info('Internal passphrase did not decrypt .dbkey, user passphrase required');
      global.__quilltapHasUserPassphrase = true;
      setCurrentState('needs-passphrase');
      return 'needs-passphrase';
    }

    // Case 4: No env var + no .dbkey file — first run
    log.info('No database key configured, setup required');
    setCurrentState('needs-setup');
    return 'needs-setup';
  } catch (error) {
    log.error('Error during database key provisioning', {
      error: error instanceof Error ? error.message : String(error),
    });
    // If we can't even check the file, fall through to needs-setup
    setCurrentState('needs-setup');
    return 'needs-setup';
  }
}

/**
 * Set up a new database key (first-run).
 *
 * Generates a new pepper, encrypts it with the given passphrase (or the
 * internal passphrase if empty), writes it to the .dbkey file, and sets
 * the pepper in process.env for immediate use.
 *
 * @param passphrase - User-provided passphrase. Empty string means no passphrase.
 * @returns Object containing the generated pepper (shown to user once for backup)
 * @throws {Error} If current state is not 'needs-setup'
 */
export function setupDbKey(passphrase: string): { pepper: string } {
  log.info('Setting up new database key');

  if (getCurrentState() !== 'needs-setup') {
    const currentState = getCurrentState();
    log.error('Cannot setup database key in current state', { currentState });
    throw new Error(`Cannot setup database key in state: ${currentState}`);
  }

  const pepper = generatePepper();
  const hasUserPassphrase = passphrase.length > 0;
  const actualPassphrase = hasUserPassphrase ? passphrase : INTERNAL_PASSPHRASE;
  const fileData = encryptPepper(pepper, actualPassphrase);

  const dbKeyPath = getDbKeyPath();
  writeDbKeyFile(dbKeyPath, fileData);

  // Set in process.env so the app can use it immediately
  process.env.ENCRYPTION_MASTER_PEPPER = pepper;
  global.__quilltapHasUserPassphrase = hasUserPassphrase;
  cacheRuntimePassphrase(actualPassphrase);
  setCurrentState('resolved');

  log.info('Database key setup complete', {
    dbKeyPath,
    pepperHashPrefix: fileData.pepperHash.substring(0, 12),
  });

  return { pepper };
}

/**
 * Unlock an existing database key using a passphrase.
 *
 * Reads the .dbkey file, decrypts the pepper with the provided passphrase,
 * verifies the hash matches, and sets the pepper in process.env.
 *
 * @param passphrase - The passphrase used when the key was stored
 * @returns true if unlock succeeded, false if the passphrase was wrong
 * @throws {Error} If current state is not 'needs-passphrase'
 */
export function unlockDbKey(passphrase: string): boolean {
  log.info('Attempting to unlock database key');

  if (getCurrentState() !== 'needs-passphrase') {
    const currentState = getCurrentState();
    log.error('Cannot unlock database key in current state', { currentState });
    throw new Error(`Cannot unlock database key in state: ${currentState}`);
  }

  const dbKeyPath = getDbKeyPath();
  const fileData = readDbKeyFile(dbKeyPath);

  if (!fileData) {
    log.error('No .dbkey file found during unlock', { dbKeyPath });
    return false;
  }

  const pepper = decryptPepperFromFile(fileData, passphrase);

  if (!pepper) {
    log.warn('Database key unlock failed: wrong passphrase');
    return false;
  }

  // Verify hash
  if (hashPepper(pepper) !== fileData.pepperHash) {
    log.error('Database key unlock failed: hash mismatch after decryption', {
      dbKeyPath,
    });
    return false;
  }

  // Success
  process.env.ENCRYPTION_MASTER_PEPPER = pepper;
  global.__quilltapHasUserPassphrase = true;
  cacheRuntimePassphrase(passphrase);
  setCurrentState('resolved');

  log.info('Database key unlocked successfully');
  return true;
}

/**
 * Change the passphrase that protects the .dbkey file(s).
 *
 * This does NOT re-encrypt the database — it only re-wraps the pepper
 * (the actual DB encryption key) in a new .dbkey file with new PBKDF2
 * parameters derived from the new passphrase.
 *
 * Both the main and LLM logs .dbkey files are updated atomically (same
 * pepper, new passphrase wrapping) to keep them in sync.
 *
 * @param oldPassphrase - The current passphrase (empty string = no passphrase set)
 * @param newPassphrase - The desired new passphrase (empty string = remove passphrase)
 * @returns Object with `success` boolean and optional `error` message
 */
export function changePassphrase(
  oldPassphrase: string,
  newPassphrase: string
): { success: boolean; error?: string } {
  log.info('Passphrase change requested');

  if (getCurrentState() !== 'resolved') {
    const currentState = getCurrentState();
    log.error('Cannot change passphrase in current state', { currentState });
    return { success: false, error: `Cannot change passphrase in state: ${currentState}` };
  }

  const dbKeyPath = getDbKeyPath();
  const fileData = readDbKeyFile(dbKeyPath);

  if (!fileData) {
    log.error('No .dbkey file found during passphrase change', { dbKeyPath });
    return { success: false, error: 'No .dbkey file found' };
  }

  // Determine the actual old passphrase (empty string → internal sentinel)
  const actualOldPassphrase = oldPassphrase.length > 0 ? oldPassphrase : INTERNAL_PASSPHRASE;

  // Verify the old passphrase can decrypt the pepper
  const pepper = decryptPepperFromFile(fileData, actualOldPassphrase);

  if (!pepper) {
    log.warn('Passphrase change failed: old passphrase incorrect');
    return { success: false, error: 'Current passphrase is incorrect' };
  }

  // Verify hash as additional safety check
  if (hashPepper(pepper) !== fileData.pepperHash) {
    log.error('Passphrase change failed: pepper hash mismatch after decryption');
    return { success: false, error: 'Pepper verification failed' };
  }

  // Re-encrypt with the new passphrase
  const hasNewUserPassphrase = newPassphrase.length > 0;
  const actualNewPassphrase = hasNewUserPassphrase ? newPassphrase : INTERNAL_PASSPHRASE;
  const newFileData = encryptPepper(pepper, actualNewPassphrase);

  // One pepper per instance, one .dbkey file. All three databases (main, LLM
  // logs, mount index) open with the same key, unwrapped from this file alone —
  // see the client modules under lib/database/backends/sqlite/, which each read
  // ENCRYPTION_MASTER_PEPPER rather than a key file of their own.
  writeDbKeyFile(dbKeyPath, newFileData);
  log.info('.dbkey file updated with new passphrase', { dbKeyPath });

  // Update the cached passphrase state
  global.__quilltapHasUserPassphrase = hasNewUserPassphrase;
  cacheRuntimePassphrase(actualNewPassphrase);

  log.info('Passphrase change completed successfully');
  return { success: true };
}

/**
 * Store an existing env var pepper in a .dbkey file.
 *
 * Used when the pepper is already set via the ENCRYPTION_MASTER_PEPPER
 * environment variable but hasn't been persisted to a .dbkey file yet.
 * Encrypts the pepper with the given passphrase and writes it to disk.
 *
 * @param passphrase - User-provided passphrase. Empty string means no passphrase.
 * @throws {Error} If current state is not 'needs-vault-storage'
 * @throws {Error} If no pepper is found in the environment
 */
export function storeEnvPepperInDbKey(passphrase: string): void {
  log.info('Storing existing pepper in .dbkey file');

  if (getCurrentState() !== 'needs-vault-storage') {
    const currentState = getCurrentState();
    log.error('Cannot store pepper in .dbkey in current state', { currentState });
    throw new Error(`Cannot store pepper in .dbkey file in state: ${currentState}`);
  }

  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (!pepper) {
    log.error('No pepper in environment to store');
    throw new Error('No pepper in environment to store');
  }

  const actualPassphrase = passphrase.length > 0 ? passphrase : INTERNAL_PASSPHRASE;
  const fileData = encryptPepper(pepper, actualPassphrase);

  const dbKeyPath = getDbKeyPath();
  writeDbKeyFile(dbKeyPath, fileData);

  global.__quilltapHasUserPassphrase = passphrase.length > 0;
  cacheRuntimePassphrase(actualPassphrase);
  setCurrentState('resolved');

  log.info('Pepper stored in .dbkey file', {
    dbKeyPath,
    pepperHashPrefix: fileData.pepperHash.substring(0, 12),
  });
}

/**
 * Lock the database key by clearing the pepper from memory.
 *
 * This re-locks the application, requiring the passphrase to be
 * re-entered before the database can be accessed again.
 * Used by the auto-lock idle timer feature.
 */
export function lockDbKey(): void {
  log.info('Locking database key — clearing pepper from memory');
  delete process.env.ENCRYPTION_MASTER_PEPPER;
  clearRuntimePassphrase();
  setCurrentState('needs-passphrase');
}

/**
 * Check whether the user has set a custom passphrase.
 *
 * Returns false when the internal (no-passphrase) sentinel was used,
 * true when the user provided their own passphrase.
 *
 * When the in-memory flag has not been set (e.g. after HMR or if
 * setupDbKey/changePassphrase was called without updating it), this
 * falls back to probing the .dbkey file by attempting decryption with
 * the internal passphrase. The result is cached on the global so the
 * expensive PBKDF2 derivation only runs once.
 *
 * @returns true if a user passphrase protects the .dbkey file
 */
export function getHasUserPassphrase(): boolean {
  if (global.__quilltapHasUserPassphrase !== undefined) {
    return global.__quilltapHasUserPassphrase;
  }

  // Probe the .dbkey file to determine passphrase status inherently
  const dbKeyPath = getDbKeyPath();
  const fileData = readDbKeyFile(dbKeyPath);

  if (!fileData) {
    // No .dbkey file — no passphrase can be set
    global.__quilltapHasUserPassphrase = false;
    return false;
  }

  // Try the internal passphrase — if it works, no user passphrase is set
  const pepper = decryptPepperFromFile(fileData, INTERNAL_PASSPHRASE);
  const hasPassphrase = !(pepper && hashPepper(pepper) === fileData.pepperHash);
  global.__quilltapHasUserPassphrase = hasPassphrase;
  return hasPassphrase;
}
