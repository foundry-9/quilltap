/**
 * Archive bundle encryption (§4.2c of the character-archive spec).
 *
 * `files/` sits outside every SQLCipher database, so an archive bundle written
 * there in the clear would be the one place a character's mail, photographs
 * and personality live unprotected. Bundles are therefore encrypted with **the
 * same mechanism `.dbkey` uses** — PBKDF2-SHA256 at 600k iterations deriving
 * an AES-256-GCM key from the passphrase — and **never** with
 * `ENCRYPTION_MASTER_PEPPER`: backups are logical and the pepper does not
 * travel with them, so a pepper-encrypted bundle would restore onto a new
 * instance byte-perfect and permanently undecryptable. The passphrase (or the
 * `INTERNAL_PASSPHRASE` constant on a no-passphrase instance) is knowledge
 * that survives the instance, which is the whole point of the artifact.
 *
 * This is deliberately **parity with the database, not more**: on a
 * no-passphrase instance the bundle is protected against casual filesystem
 * access — a sync client indexing `files/`, a stray copy on a shared disk —
 * and not against someone holding the disk and a copy of Quilltap.
 *
 * **Do not reuse the string helpers** (`encryptWithPassphrase`,
 * `encryptPepperWithParams`): both JSON-stringify their input and hex-encode
 * the ciphertext — correct for a 32-byte pepper, catastrophic for a 400 MB
 * bundle. This module is their binary sibling: a small plaintext JSON header
 * (version, KDF params, salt, IV, and a key-verification hash), the raw
 * ciphertext produced through chunked `createCipheriv` updates, and the GCM
 * auth tag appended at the end.
 *
 * On-disk layout (version 1):
 *
 *     bytes 0..7    magic 'QTAPARC1'
 *     bytes 8..11   header length N (uint32 BE)
 *     bytes 12..12+N-1  UTF-8 JSON header
 *     ...           ciphertext
 *     last 16 bytes GCM auth tag
 *
 * The header's `keyHash` (sha256 of the derived key, the `pepperHash`
 * convention from `.dbkey`) lets a wrong passphrase be diagnosed as *"this
 * archive predates your passphrase change"* instead of a bare GCM
 * authentication failure.
 */

import crypto from 'crypto';
import { INTERNAL_PASSPHRASE, getHasUserPassphrase } from '@/lib/startup/dbkey';
import { getRuntimePassphrase } from '@/lib/startup/passphrase-cache';

// Parameters mirror `.dbkey` (lib/startup/dbkey.ts) exactly.
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_DIGEST = 'sha256';
const AUTH_TAG_LENGTH = 16;

const MAGIC = Buffer.from('QTAPARC1', 'ascii');
const HEADER_LENGTH_BYTES = 4;

/** Feed the cipher in slices so a huge bundle isn't one giant native call. */
const CIPHER_CHUNK_BYTES = 8 * 1024 * 1024;

interface ArchiveCryptoHeader {
  version: 1;
  algorithm: string;
  kdf: 'pbkdf2';
  kdfIterations: number;
  kdfDigest: string;
  /** PBKDF2 salt, hex. Fresh per bundle. */
  salt: string;
  /** GCM IV, hex. Fresh per bundle. */
  iv: string;
  /** sha256 of the derived key, hex — the passphrase-verification hash. */
  keyHash: string;
}

/** Thrown when the current passphrase cannot open an archive. */
export class ArchivePassphraseMismatchError extends Error {
  constructor(detail = '') {
    super(
      'This archive predates your passphrase change: it was encrypted under a different ' +
        'passphrase than the current one. Unlock it with the passphrase that was in effect ' +
        'when it was written.' +
        (detail ? ` ${detail}` : '')
    );
    this.name = 'ArchivePassphraseMismatchError';
  }
}

/** Thrown when the ciphertext fails GCM authentication (corruption/tamper). */
export class ArchiveIntegrityError extends Error {
  constructor(detail: string) {
    super(`Archive bundle failed integrity verification: ${detail}`);
    this.name = 'ArchiveIntegrityError';
  }
}

/** Thrown when the bytes are not an encrypted archive in a known format. */
export class ArchiveFormatError extends Error {
  constructor(detail: string) {
    super(`Not a readable encrypted archive: ${detail}`);
    this.name = 'ArchiveFormatError';
  }
}

/**
 * Thrown when a user passphrase protects this instance but no passphrase has
 * passed through this process yet (see lib/startup/passphrase-cache.ts) and
 * none was supplied explicitly.
 */
export class ArchiveKeyUnavailableError extends Error {
  constructor() {
    super(
      'Archive encryption needs the instance passphrase, which this process has not seen. ' +
        'Lock and unlock the instance (or restart and enter the passphrase) and try again.'
    );
    this.name = 'ArchiveKeyUnavailableError';
  }
}

/**
 * The passphrase archive crypto should use when the caller doesn't supply
 * one: the passphrase this process last proved (deposited by the `.dbkey`
 * flow), or the internal sentinel on a no-passphrase instance.
 */
export function resolveArchivePassphrase(): string {
  const cached = getRuntimePassphrase();
  if (cached !== null) return cached;
  if (!getHasUserPassphrase()) return INTERNAL_PASSPHRASE;
  throw new ArchiveKeyUnavailableError();
}

/** True when the buffer carries the encrypted-archive magic. */
export function isEncryptedArchive(data: Buffer): boolean {
  return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC);
}

function deriveKey(passphrase: string, salt: Buffer, iterations: number, digest: string): Buffer {
  return crypto.pbkdf2Sync(passphrase, new Uint8Array(salt), iterations, KEY_LENGTH, digest);
}

function hashKey(key: Buffer): string {
  return crypto.createHash('sha256').update(new Uint8Array(key)).digest('hex');
}

/** Run a buffer through a cipher/decipher in slices, returning the output. */
function runChunked(
  transform: { update(data: Uint8Array): Buffer; final(): Buffer },
  input: Buffer
): Buffer {
  const out: Buffer[] = [];
  for (let offset = 0; offset < input.length; offset += CIPHER_CHUNK_BYTES) {
    const slice = input.subarray(offset, Math.min(offset + CIPHER_CHUNK_BYTES, input.length));
    out.push(transform.update(new Uint8Array(slice)));
  }
  out.push(transform.final());
  return Buffer.concat(out);
}

/**
 * Encrypt an archive bundle. Fresh salt and IV per call; the passphrase
 * defaults to {@link resolveArchivePassphrase}.
 */
export function encryptArchive(plaintext: Buffer, passphrase?: string): Buffer {
  const effective = passphrase ?? resolveArchivePassphrase();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(effective, salt, PBKDF2_ITERATIONS, PBKDF2_DIGEST);

  const header: ArchiveCryptoHeader = {
    version: 1,
    algorithm: ALGORITHM,
    kdf: 'pbkdf2',
    kdfIterations: PBKDF2_ITERATIONS,
    kdfDigest: PBKDF2_DIGEST,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    keyHash: hashKey(key),
  };
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const headerLength = Buffer.alloc(HEADER_LENGTH_BYTES);
  headerLength.writeUInt32BE(headerJson.length);

  const cipher = crypto.createCipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv));
  const ciphertext = runChunked(cipher, plaintext);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, headerLength, headerJson, ciphertext, authTag]);
}

function parseHeader(data: Buffer): { header: ArchiveCryptoHeader; bodyStart: number } {
  if (!isEncryptedArchive(data)) {
    throw new ArchiveFormatError('missing the QTAPARC1 magic — this is not an encrypted archive');
  }
  const lengthStart = MAGIC.length;
  const jsonStart = lengthStart + HEADER_LENGTH_BYTES;
  if (data.length < jsonStart) {
    throw new ArchiveFormatError('truncated before the header length');
  }
  const headerLength = data.readUInt32BE(lengthStart);
  const bodyStart = jsonStart + headerLength;
  if (headerLength <= 0 || data.length < bodyStart + AUTH_TAG_LENGTH) {
    throw new ArchiveFormatError('truncated header or missing auth tag');
  }

  let header: ArchiveCryptoHeader;
  try {
    header = JSON.parse(data.subarray(jsonStart, bodyStart).toString('utf8')) as ArchiveCryptoHeader;
  } catch {
    throw new ArchiveFormatError('header is not valid JSON');
  }
  if (
    header.version !== 1 ||
    header.kdf !== 'pbkdf2' ||
    typeof header.algorithm !== 'string' ||
    typeof header.kdfIterations !== 'number' ||
    typeof header.kdfDigest !== 'string' ||
    typeof header.salt !== 'string' ||
    typeof header.iv !== 'string' ||
    typeof header.keyHash !== 'string'
  ) {
    throw new ArchiveFormatError(`unsupported header (version ${String(header.version)})`);
  }
  return { header, bodyStart };
}

/**
 * Decrypt an archive bundle. The KDF parameters come from the header itself
 * (the `.dbkey` convention), so older bundles keep decrypting after future
 * parameter upgrades. A wrong passphrase is diagnosed by the key-verification
 * hash *before* touching the ciphertext and throws
 * {@link ArchivePassphraseMismatchError}; a hash match followed by GCM failure
 * is corruption, {@link ArchiveIntegrityError}.
 */
export function decryptArchive(data: Buffer, passphrase?: string): Buffer {
  const effective = passphrase ?? resolveArchivePassphrase();
  const { header, bodyStart } = parseHeader(data);

  const salt = Buffer.from(header.salt, 'hex');
  const iv = Buffer.from(header.iv, 'hex');
  const key = deriveKey(effective, salt, header.kdfIterations, header.kdfDigest);

  if (hashKey(key) !== header.keyHash) {
    throw new ArchivePassphraseMismatchError();
  }

  const ciphertext = data.subarray(bodyStart, data.length - AUTH_TAG_LENGTH);
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(
      header.algorithm as 'aes-256-gcm',
      new Uint8Array(key),
      new Uint8Array(iv)
    );
    decipher.setAuthTag(new Uint8Array(authTag));
    return runChunked(decipher, ciphertext);
  } catch (error) {
    throw new ArchiveIntegrityError(
      error instanceof Error ? error.message : 'authentication failed'
    );
  }
}
