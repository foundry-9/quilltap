'use strict';

/**
 * `.dbkey` file primitives for the CLI.
 *
 * The instance's one and only `quilltap.dbkey` wraps the pepper — the actual
 * SQLCipher key for all three databases — in AES-256-GCM under a PBKDF2 key
 * derived from the operator's passphrase (or an internal sentinel when no
 * passphrase is set). The CLI is plain Node and cannot import the TypeScript
 * source of truth at `lib/startup/dbkey.ts` + `lib/startup/pepper-crypto.ts`,
 * so the format and constants below MIRROR it. Keep them in sync.
 *
 * Three call sites needed this unwrap — `db-helpers.loadDbKey`,
 * `instances.verifyPassphrase`, and the `instances restore-key` rebuild — so it
 * lives here once rather than three times.
 *
 * Reading params off the file (rather than the constants) is deliberate: it is
 * what keeps older `.dbkey` files decryptable after a parameter upgrade. The
 * constants are used only when writing a fresh file.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** The instance's single key file. One pepper per instance. */
const DBKEY_FILENAME = 'quilltap.dbkey';

/** Sentinel used to wrap the pepper when the operator sets no passphrase. */
const INTERNAL_PASSPHRASE = '__quilltap_no_passphrase__';

// Mirror of the write-side constants in lib/startup/dbkey.ts.
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_DIGEST = 'sha256';

function getDbKeyPath(dataDir) {
  return path.join(dataDir, DBKEY_FILENAME);
}

/** SHA-256 of the plaintext pepper, hex — the file's `pepperHash` field. */
function hashPepper(pepper) {
  return crypto.createHash('sha256').update(pepper).digest('hex');
}

/**
 * Read and parse `<dataDir>/quilltap.dbkey`, returning null when absent.
 *
 * Strips the legacy `hasPassphrase` flag in passing (it leaked whether a user
 * passphrase was set), rewriting the file the same way the server does.
 */
function readDbKeyFile(dataDir) {
  const dbkeyPath = getDbKeyPath(dataDir);
  if (!fs.existsSync(dbkeyPath)) return null;
  const data = JSON.parse(fs.readFileSync(dbkeyPath, 'utf8'));
  if ('hasPassphrase' in data) {
    delete data.hasPassphrase;
    fs.writeFileSync(dbkeyPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  return data;
}

/**
 * Unwrap the pepper from parsed `.dbkey` contents.
 *
 * Throws on a wrong passphrase, a tampered file, or a pepper whose hash does
 * not match the one recorded alongside it.
 */
function decryptDbKey(data, passphrase) {
  const salt = Buffer.from(data.salt, 'hex');
  const key = crypto.pbkdf2Sync(
    passphrase,
    new Uint8Array(salt),
    data.kdfIterations,
    KEY_LENGTH,
    data.kdfDigest,
  );
  const iv = Buffer.from(data.iv, 'hex');
  const decipher = crypto.createDecipheriv(data.algorithm, new Uint8Array(key), new Uint8Array(iv));
  decipher.setAuthTag(new Uint8Array(Buffer.from(data.authTag, 'hex')));
  let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  if (hashPepper(plaintext) !== data.pepperHash) {
    throw new Error('Pepper hash mismatch');
  }
  return plaintext;
}

/** Unwrap, returning null instead of throwing. */
function tryDecryptDbKey(data, passphrase) {
  try {
    return decryptDbKey(data, passphrase);
  } catch {
    return null;
  }
}

/**
 * Wrap a pepper for storage, generating a fresh salt and IV. Mirrors
 * `encryptPepper` in lib/startup/dbkey.ts, field for field.
 */
function encryptDbKey(pepper, passphrase) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.pbkdf2Sync(
    passphrase,
    new Uint8Array(salt),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST,
  );
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv));
  let ciphertext = cipher.update(pepper, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  return {
    version: 1,
    algorithm: ALGORITHM,
    kdf: 'pbkdf2',
    kdfIterations: PBKDF2_ITERATIONS,
    kdfDigest: PBKDF2_DIGEST,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext,
    authTag: cipher.getAuthTag().toString('hex'),
    pepperHash: hashPepper(pepper),
  };
}

/**
 * The fields that make up the wrapped key itself. Anything else in the file
 * was put there by another subsystem — `minServerVersion`, written by
 * `lib/startup/version-guard.ts` for the Electron shell's pre-launch check —
 * and belongs to the instance rather than to this wrapping, so a rewrap must
 * carry it across.
 */
const KEY_WRAPPER_FIELDS = new Set([
  'version',
  'algorithm',
  'kdf',
  'kdfIterations',
  'kdfDigest',
  'salt',
  'iv',
  'ciphertext',
  'authTag',
  'pepperHash',
]);

/**
 * Copy every field the wrapping does not own from an old key file onto a
 * freshly wrapped one, so rebuilding a `.dbkey` never quietly drops a field
 * some other part of Quilltap depends on.
 */
function preserveExtraFields(existing, fresh) {
  if (!existing) return fresh;
  for (const [key, value] of Object.entries(existing)) {
    if (!KEY_WRAPPER_FIELDS.has(key)) {
      fresh[key] = value;
    }
  }
  return fresh;
}

/** Write the key file at mode 0600, creating the data directory if needed. */
function writeDbKeyFile(dataDir, data) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(getDbKeyPath(dataDir), JSON.stringify(data, null, 2), { mode: 0o600 });
}

module.exports = {
  DBKEY_FILENAME,
  INTERNAL_PASSPHRASE,
  KEY_WRAPPER_FIELDS,
  preserveExtraFields,
  PBKDF2_ITERATIONS,
  getDbKeyPath,
  hashPepper,
  readDbKeyFile,
  decryptDbKey,
  tryDecryptDbKey,
  encryptDbKey,
  writeDbKeyFile,
};
