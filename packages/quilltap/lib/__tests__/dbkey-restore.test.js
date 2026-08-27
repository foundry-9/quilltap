/**
 * `quilltap instances restore-key` — the guards that stand between an operator
 * with a pepper and a `.dbkey` that would brick an instance.
 *
 * The load-bearing one is the pepper proof: a key file holding the WRONG
 * pepper is worse than none at all, because the server unwraps it happily and
 * then reports an intact database as corrupt. So the proof runs against real
 * SQLCipher files, not the suite's `better-sqlite3` mock — the mock would open
 * anything.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PKG_ROOT = path.join(__dirname, '..', '..');

// The root jest config maps both driver names onto __mocks__/better-sqlite3.ts,
// which accepts any key. Point them back at the real binding by absolute path
// so a wrong pepper actually fails to decrypt.
jest.mock('better-sqlite3-multiple-ciphers', () =>
  require(path.join(PKG_ROOT, 'node_modules', 'better-sqlite3-multiple-ciphers'))
);

const Database = require('better-sqlite3-multiple-ciphers');
const { provePepper, databaseState } = require('../dbkey-restore');
const {
  INTERNAL_PASSPHRASE,
  encryptDbKey,
  decryptDbKey,
  tryDecryptDbKey,
  preserveExtraFields,
  readDbKeyFile,
  writeDbKeyFile,
} = require('../dbkey');

const PEPPER = crypto.randomBytes(32).toString('base64');
const OTHER_PEPPER = crypto.randomBytes(32).toString('base64');

let dataDir;

function seedEncryptedDb(filename, pepper) {
  const db = new Database(path.join(dataDir, filename));
  db.pragma(`key = "x'${Buffer.from(pepper, 'base64').toString('hex')}'"`);
  db.exec("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('hello');");
  db.close();
}

function seedPlaintextDb(filename) {
  const db = new Database(path.join(dataDir, filename));
  db.exec('CREATE TABLE t (a TEXT);');
  db.close();
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-restore-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('databaseState', () => {
  it('reads the SQLite magic to tell plaintext from SQLCipher', () => {
    seedPlaintextDb('plain.db');
    seedEncryptedDb('enc.db', PEPPER);

    expect(databaseState(path.join(dataDir, 'plain.db'))).toBe('plaintext');
    expect(databaseState(path.join(dataDir, 'enc.db'))).toBe('encrypted');
    expect(databaseState(path.join(dataDir, 'nope.db'))).toBe('absent');
  });
});

describe('provePepper', () => {
  it('proves the right pepper against every encrypted database', () => {
    seedEncryptedDb('quilltap.db', PEPPER);
    seedEncryptedDb('quilltap-llm-logs.db', PEPPER);
    seedEncryptedDb('quilltap-mount-index.db', PEPPER);

    const { proved, results } = provePepper(dataDir, PEPPER);
    expect(proved).toBe(true);
    expect(results.every((r) => r.ok === true)).toBe(true);
  });

  it('refuses a pepper that does not open the databases', () => {
    seedEncryptedDb('quilltap.db', PEPPER);

    const { proved, results } = provePepper(dataDir, OTHER_PEPPER);
    expect(proved).toBe(false);
    expect(results.find((r) => r.filename === 'quilltap.db').ok).toBe(false);
  });

  it('reports one bad database among good ones rather than averaging it away', () => {
    seedEncryptedDb('quilltap.db', PEPPER);
    seedEncryptedDb('quilltap-llm-logs.db', OTHER_PEPPER);

    const { proved, results } = provePepper(dataDir, PEPPER);
    expect(proved).toBe(false);
    expect(results.find((r) => r.filename === 'quilltap.db').ok).toBe(true);
    expect(results.find((r) => r.filename === 'quilltap-llm-logs.db').ok).toBe(false);
  });

  it('cannot prove anything when the databases are absent or still plaintext', () => {
    expect(provePepper(dataDir, PEPPER).proved).toBe(false);

    seedPlaintextDb('quilltap.db');
    const { proved, results } = provePepper(dataDir, PEPPER);
    expect(proved).toBe(false);
    expect(results.find((r) => r.filename === 'quilltap.db')).toMatchObject({
      state: 'plaintext',
      ok: null,
    });
  });
});

describe('rewrapping a key file', () => {
  it('round-trips the pepper under a new passphrase', () => {
    writeDbKeyFile(dataDir, encryptDbKey(PEPPER, INTERNAL_PASSPHRASE));
    expect(decryptDbKey(readDbKeyFile(dataDir), INTERNAL_PASSPHRASE)).toBe(PEPPER);

    writeDbKeyFile(dataDir, encryptDbKey(PEPPER, 'the lamplighter'));
    const rewrapped = readDbKeyFile(dataDir);
    expect(tryDecryptDbKey(rewrapped, INTERNAL_PASSPHRASE)).toBeNull();
    expect(decryptDbKey(rewrapped, 'the lamplighter')).toBe(PEPPER);
  });

  it('carries fields the wrapping does not own across the rebuild', () => {
    // `minServerVersion` is written by lib/startup/version-guard.ts for the
    // Electron shell's pre-launch check. Dropping it on a rewrap would take
    // the version floor with it.
    const existing = encryptDbKey(PEPPER, INTERNAL_PASSPHRASE);
    existing.minServerVersion = '4.9.0-dev.91';

    const fresh = preserveExtraFields(existing, encryptDbKey(PEPPER, 'the lamplighter'));

    expect(fresh.minServerVersion).toBe('4.9.0-dev.91');
    expect(fresh.salt).not.toBe(existing.salt);
    expect(decryptDbKey(fresh, 'the lamplighter')).toBe(PEPPER);
  });

  it('writes the key file owner-only', () => {
    writeDbKeyFile(dataDir, encryptDbKey(PEPPER, INTERNAL_PASSPHRASE));
    const mode = fs.statSync(path.join(dataDir, 'quilltap.dbkey')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
