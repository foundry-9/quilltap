/**
 * @jest-environment node
 *
 * Round-trip integration test for `quilltap db backup`.
 *
 * Creates a tiny encrypted SQLite database, runs cmdBackup against it, and
 * verifies the snapshot opens with the same encryption key and yields the
 * same row data.
 *
 * Lives under __tests__/unit/ so the standard `npm test` run picks it up,
 * but it touches the real `better-sqlite3-multiple-ciphers` binding rather
 * than a mock.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomBytes } = require('crypto');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');

function loadDriver() {
  try {
    return require(path.join(QUILLTAP_PKG, 'node_modules', 'better-sqlite3-multiple-ciphers'));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      // Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3, so
      // in CI (where only the root install runs) the driver lives at
      // <root>/node_modules/better-sqlite3. Require by absolute path so the jest
      // moduleNameMapper that mocks 'better-sqlite3' for the rest of the suite does
      // not intercept this load — we want the real native binding here.
      return require(path.join(QUILLTAP_PKG, '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}

function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-backup-test-'));
}

function makeEncryptedDb(dataDir, pepperBase64, filename) {
  const dbPath = path.join(dataDir, filename);
  const Database = loadDriver();
  const db = new Database(dbPath);
  const keyHex = Buffer.from(pepperBase64, 'base64').toString('hex');
  db.pragma(`key = "x'${keyHex}'"`);
  db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  db.prepare('INSERT INTO marker (id, label) VALUES (?, ?)').run(1, 'hello-backup');
  db.close();
}

function readMarker(dbPath, pepperBase64) {
  const Database = loadDriver();
  const db = new Database(dbPath, { readonly: true });
  const keyHex = Buffer.from(pepperBase64, 'base64').toString('hex');
  db.pragma(`key = "x'${keyHex}'"`);
  const row = db.prepare('SELECT label FROM marker WHERE id = 1').get();
  db.close();
  return row && row.label;
}

describe('cmdBackup round trip', () => {
  let dataDir;
  let pepper;

  beforeEach(() => {
    dataDir = makeTempDataDir();
    pepper = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  });

  it('snapshots an encrypted DB and the snapshot opens with the same key', async () => {
    makeEncryptedDb(dataDir, pepper, 'quilltap.db');
    // Backup uses ctx.openMain/openLogs/openMounts and looks for the three DBs in dataDir.
    // We only care about the main DB for this round-trip test; create empty placeholders
    // for the other two so cmdBackup's iteration sees them and skips them (or copies them).
    // Actually cmdBackup just skips files that don't exist, so only quilltap.db is needed.

    const { runVerb, makeCtx } = require(path.join(QUILLTAP_PKG, 'lib', 'db-commands'));
    const ctx = makeCtx(dataDir, pepper);

    const outDir = path.join(dataDir, 'snapshot');
    // Suppress the verb's console + stdout output during the test.
    const log = console.log;
    const w = process.stdout.write.bind(process.stdout);
    console.log = () => {};
    process.stdout.write = () => true;
    try {
      await runVerb(['backup', 'main', '--out', outDir, '--json'], ctx);
    } finally {
      console.log = log;
      process.stdout.write = w;
    }

    const snapPath = path.join(outDir, 'quilltap.db');
    expect(fs.existsSync(snapPath)).toBe(true);
    expect(fs.statSync(snapPath).size).toBeGreaterThan(0);

    const label = readMarker(snapPath, pepper);
    expect(label).toBe('hello-backup');
  });

  it('refuses to open the snapshot with the wrong key', async () => {
    makeEncryptedDb(dataDir, pepper, 'quilltap.db');
    const { runVerb, makeCtx } = require(path.join(QUILLTAP_PKG, 'lib', 'db-commands'));
    const ctx = makeCtx(dataDir, pepper);

    const outDir = path.join(dataDir, 'snapshot');
    const log = console.log;
    const w = process.stdout.write.bind(process.stdout);
    console.log = () => {};
    process.stdout.write = () => true;
    try {
      await runVerb(['backup', 'main', '--out', outDir, '--json'], ctx);
    } finally {
      console.log = log;
      process.stdout.write = w;
    }

    const snapPath = path.join(outDir, 'quilltap.db');
    const wrongKey = randomBytes(32).toString('base64');
    expect(() => readMarker(snapPath, wrongKey)).toThrow();
  });
});
