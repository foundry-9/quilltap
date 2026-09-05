'use strict';

/**
 * `quilltap instances restore-key` — rebuild a lost `.dbkey`, or re-wrap an
 * existing one under a different passphrase, from the pepper itself.
 *
 * The pepper IS the database key; the `.dbkey` file is only a wrapper around
 * it. So an operator who kept the pepper printed at first-run setup (or who
 * runs with `ENCRYPTION_MASTER_PEPPER` in the environment) can always rebuild
 * the wrapper — including under a new passphrase, when the old one is gone.
 * The server can already do this for the *lost-file* half through
 * `/api/v1/system/unlock?action=store`, but only while it is running and only
 * from the env var; a forgotten passphrase leaves it stuck in locked mode with
 * no way in. This is the offline twin, and it also covers the re-wrap.
 *
 * The load-bearing safety property: a `.dbkey` holding the WRONG pepper is
 * worse than no `.dbkey` at all — the server unwraps it, hands SQLCipher a key
 * that decrypts nothing, and reports what looks like a corrupt database (or,
 * with the env var also set, exits fatally on the hash mismatch). So the
 * candidate pepper is proved against the encrypted databases on disk BEFORE
 * anything is written, and that proof cannot be waived while an encrypted
 * database exists to check.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  INTERNAL_PASSPHRASE,
  getDbKeyPath,
  hashPepper,
  readDbKeyFile,
  tryDecryptDbKey,
  encryptDbKey,
  preserveExtraFields,
  writeDbKeyFile,
} = require('./dbkey');
const { promptPassphrase, openEncryptedDb } = require('./db-helpers');
const { acquireWriteLock, releaseWriteLock } = require('./lock-helpers');
const { resolveInstance, expandPath, setInstancePassphrase, readInstances } = require('./instances');

/** Mirror of lib/startup/db-encryption-state.ts. */
const SQLITE_MAGIC = 'SQLite format 3\0';

/** The three databases the one pepper opens, main first — it is the authority. */
const DATABASES = [
  { filename: 'quilltap.db', label: 'main database' },
  { filename: 'quilltap-llm-logs.db', label: 'LLM logs database' },
  { filename: 'quilltap-mount-index.db', label: 'mount index database' },
];

function promptLine(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    // A closed stdin (piped, /dev/null, CI) never fires `question` — treat the
    // EOF as an empty answer so the caller's default (no) still applies.
    rl.on('close', () => {
      if (!answered) {
        answered = true;
        resolve('');
      }
    });
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

async function confirm(question, assumeYes) {
  if (assumeYes) return true;
  const answer = (await promptLine(`${question} [y/N] `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

/**
 * 'encrypted' | 'plaintext' | 'absent' — by file header, exactly as the server
 * decides whether a database still needs converting.
 */
function databaseState(dbPath) {
  if (!fs.existsSync(dbPath)) return 'absent';
  const fd = fs.openSync(dbPath, 'r');
  try {
    const header = Buffer.alloc(16);
    // Read into the Buffer itself — `new Uint8Array(buf)` would COPY it and
    // the read would land in the copy, leaving `header` all zeroes (which
    // reads as "encrypted" for every file on disk).
    const read = fs.readSync(fd, header, 0, 16, 0);
    if (read < 16) return 'plaintext';
    return header.toString('utf8') === SQLITE_MAGIC ? 'plaintext' : 'encrypted';
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Prove the candidate pepper against every encrypted database in `dataDir`.
 *
 * Returns `{ proved, results }` — `proved` is true only when at least one
 * encrypted database opened AND none that was encrypted failed. Opening is
 * read-only and reads the schema page, which is what actually exercises the
 * key.
 */
function provePepper(dataDir, pepper) {
  const results = [];
  for (const { filename, label } of DATABASES) {
    const dbPath = path.join(dataDir, filename);
    const state = databaseState(dbPath);
    if (state !== 'encrypted') {
      results.push({ label, filename, state, ok: null });
      continue;
    }
    let db;
    try {
      db = openEncryptedDb(dbPath, pepper, { readonly: true, friendlyName: label });
      db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
      results.push({ label, filename, state, ok: true });
    } catch (err) {
      results.push({ label, filename, state, ok: false, error: err.message });
    } finally {
      if (db) {
        try { db.close(); } catch { /* best effort */ }
      }
    }
  }
  const checked = results.filter((r) => r.ok !== null);
  const proved = checked.length > 0 && checked.every((r) => r.ok === true);
  return { proved, results };
}

/** Back an existing key file up beside itself, returning the backup path. */
function backupDbKey(dataDir) {
  const dbkeyPath = getDbKeyPath(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbkeyPath}.bak-${stamp}`;
  fs.copyFileSync(dbkeyPath, backupPath);
  try { fs.chmodSync(backupPath, 0o600); } catch { /* best effort */ }
  return backupPath;
}

/**
 * Resolve the target data directory from either a registered instance name or
 * an explicit instance root, returning the registry name when there is one so
 * a stored passphrase can be kept honest afterwards.
 */
function resolveTarget(name, dataDirFlag) {
  if (name && dataDirFlag) {
    throw new Error('Specify either an instance name or --data-dir, not both.');
  }
  if (name) {
    const inst = resolveInstance(name);
    return { dataDir: path.join(inst.path, 'data'), instanceName: inst.name, root: inst.path };
  }
  if (!dataDirFlag) {
    throw new Error('Usage: quilltap instances restore-key <name> | --data-dir <instance-root>');
  }
  const root = expandPath(dataDirFlag);
  // Accept either the instance root or the data directory itself.
  const dataDir = path.basename(root) === 'data' ? root : path.join(root, 'data');
  const registry = readInstances();
  const match = Object.entries(registry.instances || {}).find(
    ([, entry]) => expandPath(entry.path) === expandPath(path.dirname(dataDir)),
  );
  return { dataDir, instanceName: match ? match[0] : null, root: path.dirname(dataDir) };
}

/**
 * Rebuild `<dataDir>/quilltap.dbkey` from the pepper.
 *
 * @param {object} opts
 * @param {string} opts.name            Registered instance name (optional)
 * @param {string} opts.dataDir         Instance root or data dir (optional)
 * @param {string} opts.passphrase      Passphrase for the new file (non-interactive)
 * @param {boolean} opts.noPassphrase   Write with no user passphrase, don't prompt
 * @param {boolean} opts.force          Proceed when no encrypted database exists to prove against
 * @param {boolean} opts.yes            Skip confirmation prompts
 */
async function restoreKey(opts) {
  const target = resolveTarget(opts.name, opts.dataDir);
  const { dataDir } = target;

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory does not exist: ${dataDir}`);
  }

  console.log(`Instance:    ${target.instanceName || '(unregistered)'}`);
  console.log(`Data dir:    ${dataDir}`);

  // The server keeps the pepper and the effective passphrase in memory; a file
  // rewritten underneath it would leave both stale (archive encryption reads
  // the cached passphrase). Recovery happens with the instance down.
  acquireWriteLock(dataDir);

  try {
    // ---- 1. The pepper. Never a flag: a command line lands in shell history
    // and in `ps`. Environment or hidden prompt only.
    let pepper = (process.env.ENCRYPTION_MASTER_PEPPER || '').trim();
    if (pepper) {
      console.log('Pepper:      from ENCRYPTION_MASTER_PEPPER');
    } else {
      pepper = (await promptPassphrase('Encryption master pepper (hidden): ')).trim();
      if (!pepper) {
        throw new Error('No pepper provided. Set ENCRYPTION_MASTER_PEPPER or paste it at the prompt.');
      }
    }
    if (Buffer.from(pepper, 'base64').length !== 32) {
      console.log('Warning:     that does not look like a Quilltap pepper (44-char base64 of 32 bytes).');
    }

    // ---- 2. Prove it against the databases before writing anything.
    const { proved, results } = provePepper(dataDir, pepper);
    console.log('');
    for (const r of results) {
      if (r.state === 'absent') {
        console.log(`  ${r.filename.padEnd(28)} absent`);
      } else if (r.state === 'plaintext') {
        console.log(`  ${r.filename.padEnd(28)} unencrypted (nothing to check against)`);
      } else if (r.ok) {
        console.log(`  ${r.filename.padEnd(28)} opens with this pepper ✓`);
      } else {
        console.log(`  ${r.filename.padEnd(28)} DOES NOT OPEN — ${r.error.split('\n')[0]}`);
      }
    }
    console.log('');

    const failures = results.filter((r) => r.ok === false);
    if (failures.length > 0) {
      throw new Error(
        'This pepper does not open the databases on disk. Refusing to write a .dbkey that\n' +
        'would make an intact instance look corrupt. If the files are cloud-evicted rather\n' +
        'than wrongly keyed, run `quilltap file-verify` first and try again.',
      );
    }
    if (!proved) {
      console.log('No encrypted database exists here, so the pepper cannot be proved.');
      if (results.some((r) => r.state === 'plaintext')) {
        console.log('The databases are still unencrypted — the server will encrypt them with');
        console.log('this pepper on its next start, whether or not it is the original one.');
      }
      if (!opts.force && !(await confirm('Write the .dbkey anyway?', opts.yes))) {
        throw new Error('Aborted.');
      }
    }

    // ---- 3. What is already on disk.
    const existing = readDbKeyFile(dataDir);
    let replacingDifferentPepper = false;
    if (existing) {
      if (existing.pepperHash === hashPepper(pepper)) {
        console.log('An existing .dbkey already holds this pepper — rewrapping it.');
      } else {
        replacingDifferentPepper = true;
        console.log('WARNING: the existing .dbkey holds a DIFFERENT pepper than the one given.');
        if (proved) {
          console.log('The databases opened with the new one, so the file on disk is the stale part.');
        }
        if (!(await confirm('Replace it? (a timestamped backup is kept)', opts.yes))) {
          throw new Error('Aborted.');
        }
      }
    }

    // ---- 4. The passphrase for the rebuilt file.
    let newPassphrase;
    if (opts.noPassphrase) {
      newPassphrase = '';
    } else if (opts.passphrase !== undefined && opts.passphrase !== '') {
      newPassphrase = opts.passphrase;
    } else if (opts.yes) {
      newPassphrase = '';
    } else {
      newPassphrase = await promptPassphrase('Passphrase for the rebuilt .dbkey (blank for none): ');
      if (newPassphrase) {
        const again = await promptPassphrase('Confirm passphrase: ');
        if (again !== newPassphrase) {
          throw new Error('Passphrases did not match.');
        }
      }
    }

    const hadUserPassphrase = existing
      ? tryDecryptDbKey(existing, INTERNAL_PASSPHRASE) === null
      : false;
    const effective = newPassphrase.length > 0 ? newPassphrase : INTERNAL_PASSPHRASE;

    // ---- 5. Write, then read back and prove the round trip.
    let backupPath = null;
    if (existing) {
      backupPath = backupDbKey(dataDir);
    }

    // `minServerVersion` (the Electron shell's version floor) rides along in
    // the same file without belonging to the wrapping — carry it, and anything
    // like it, across the rebuild.
    writeDbKeyFile(dataDir, preserveExtraFields(existing, encryptDbKey(pepper, effective)));

    const written = readDbKeyFile(dataDir);
    const roundTrip = written && tryDecryptDbKey(written, effective);
    if (roundTrip !== pepper) {
      if (backupPath) {
        fs.copyFileSync(backupPath, getDbKeyPath(dataDir));
      }
      throw new Error('Wrote the .dbkey but could not read the pepper back — restored the previous file.');
    }

    console.log('');
    console.log(`Wrote ${getDbKeyPath(dataDir)} (mode 0600).`);
    if (backupPath) {
      console.log(`Previous file kept at ${path.basename(backupPath)}.`);
    }
    console.log(
      newPassphrase
        ? 'The instance now unlocks with the passphrase you just set.'
        : 'The instance now opens with no passphrase.',
    );

    // ---- 6. Keep the registry's stored passphrase honest.
    if (target.instanceName) {
      setInstancePassphrase(target.instanceName, newPassphrase);
      console.log(
        newPassphrase
          ? `Updated the stored passphrase for "${target.instanceName}".`
          : `Cleared the stored passphrase for "${target.instanceName}".`,
      );
    }

    // ---- 7. The one thing a re-wrap does NOT carry with it.
    const passphraseChanged =
      replacingDifferentPepper ||
      hadUserPassphrase !== (newPassphrase.length > 0) ||
      (hadUserPassphrase && newPassphrase.length > 0);
    if (existing && passphraseChanged) {
      console.log('');
      console.log('Note: character ARCHIVE bundles in files/ are encrypted with the passphrase,');
      console.log('not the pepper. This command does not rewrite them — bundles made under the');
      console.log('old passphrase still want the old one. The server\'s Change Passphrase card');
      console.log('re-encrypts them; this offline path cannot.');
    }
  } finally {
    releaseWriteLock(dataDir);
  }
}

module.exports = { restoreKey, provePepper, databaseState };
