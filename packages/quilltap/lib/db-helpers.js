'use strict';

const path = require('path');
const fs = require('fs');

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DEL = String.fromCharCode(0x7F);

function resolveDataDir(overrideDir) {
  if (overrideDir) {
    const resolved = overrideDir.startsWith('~')
      ? path.join(require('os').homedir(), overrideDir.slice(1))
      : overrideDir;
    return path.join(resolved, 'data');
  }
  const os = require('os');
  if (process.env.QUILLTAP_DATA_DIR) {
    return path.join(process.env.QUILLTAP_DATA_DIR, 'data');
  }
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Quilltap', 'data');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Quilltap', 'data');
  return path.join(home, '.quilltap', 'data');
}

// Resolve the data dir + database passphrase a subcommand should use, given
// the raw flag values it parsed. `--instance Foo` looks up the registry; an
// explicit `--data-dir` or `--passphrase` still wins so callers can override.
// Errors out if both `--instance` and `--data-dir` were supplied — these
// configure the same thing two different ways and must not silently disagree.
//
// Precedence order (highest to lowest):
//   1. --data-dir (explicit override)
//   2. --instance (explicit instance)
//   3. registered default instance
//   4. QUILLTAP_DATA_DIR env var
//   5. OS platform default
//
// Returns `usedPlatformDefault: true` only when falling back to the true
// platform default (no flags, no env var, no registered default).
// Callers can use this to decide whether to prompt the user with a
// "did you forget --instance?" hint.
function resolveDataDirAndPassphrase({ dataDir, instance, passphrase }) {
  if (dataDir && instance) {
    throw new Error('Specify either --instance or --data-dir, not both.');
  }
  if (instance) {
    const { resolveInstance } = require('./instances');
    const inst = resolveInstance(instance);
    return {
      dataDir: path.join(inst.path, 'data'),
      passphrase: passphrase || inst.passphrase || '',
      instanceName: inst.name,
      usedPlatformDefault: false,
    };
  }
  if (!dataDir && !process.env.QUILLTAP_DATA_DIR) {
    const { getDefaultInstance, resolveInstance } = require('./instances');
    const defaultName = getDefaultInstance();
    if (defaultName) {
      try {
        const inst = resolveInstance(defaultName);
        return {
          dataDir: path.join(inst.path, 'data'),
          passphrase: passphrase || inst.passphrase || '',
          instanceName: inst.name,
          usedPlatformDefault: false,
        };
      } catch {
        // Fall through to env var / platform default if default resolution fails
      }
    }
  }
  const usedPlatformDefault = !dataDir && !process.env.QUILLTAP_DATA_DIR;
  return {
    dataDir: resolveDataDir(dataDir),
    passphrase: passphrase || '',
    instanceName: null,
    usedPlatformDefault,
  };
}

// Print a one-line stderr hint when the CLI silently fell back to the platform
// default instance but the user has registered alternatives — Friday, Ignite,
// etc. The hint fires at most once per process so repeated openDb() calls
// inside a single subcommand stay quiet.
let _instanceHintPrinted = false;
function printDefaultInstanceHint(resolved) {
  if (_instanceHintPrinted) return;
  if (!resolved || !resolved.usedPlatformDefault) return;
  if (process.env.QUILLTAP_QUIET_HINTS) return;
  let registered;
  try {
    const { listInstances } = require('./instances');
    registered = listInstances();
  } catch {
    return;
  }
  if (!registered || registered.length === 0) return;
  _instanceHintPrinted = true;
  const names = registered.map((r) => r.name).join(', ');
  process.stderr.write(
    `Hint: using the default instance (${resolved.dataDir}). ` +
    `Registered: ${names}. Pass --instance <name> to target one. ` +
    `(set QUILLTAP_QUIET_HINTS=1 to silence)\n`
  );
}

function promptPassphrase(prompt) {
  return new Promise((resolve, reject) => {
    const readline = require('readline');
    if (!process.stdin.isTTY) {
      reject(new Error('This database requires a passphrase. Use --passphrase <pass> or set QUILLTAP_DB_PASSPHRASE'));
      return;
    }
    process.stdout.write(prompt || 'Passphrase: ');
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let passphrase = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r' || c === CTRL_D) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        rl.close();
        process.stdout.write('\n');
        resolve(passphrase);
      } else if (c === CTRL_C) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        rl.close();
        process.stdout.write('\n');
        process.exit(130);
      } else if (c === DEL || c === '\b') {
        if (passphrase.length > 0) {
          passphrase = passphrase.slice(0, -1);
        }
      } else {
        passphrase += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function loadDbKey(dataDir, passphrase) {
  const { INTERNAL_PASSPHRASE, readDbKeyFile, decryptDbKey, tryDecryptDbKey } = require('./dbkey');

  const data = readDbKeyFile(dataDir);
  if (!data) {
    return null;
  }

  const internal = tryDecryptDbKey(data, INTERNAL_PASSPHRASE);
  if (internal !== null) {
    return internal;
  }

  // Internal passphrase failed — need a user passphrase.
  if (!passphrase && process.env.QUILLTAP_DB_PASSPHRASE) {
    passphrase = process.env.QUILLTAP_DB_PASSPHRASE;
  }

  if (!passphrase) {
    passphrase = await promptPassphrase('Database passphrase: ');
    if (!passphrase) {
      throw new Error('No passphrase provided');
    }
  }

  return decryptDbKey(data, passphrase);
}

function openEncryptedDb(dbPath, pepper, { readonly = true, friendlyName = 'database' } = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`${friendlyName} not found: ${dbPath}`);
  }

  let Database;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
  } catch {
    Database = require('better-sqlite3');
  }
  const db = new Database(dbPath, { readonly });

  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }

  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    db.close();
    throw new Error(`Cannot open ${friendlyName}: ${err.message}\n` +
      'The database may be encrypted with a different key, or the .dbkey file may be missing.');
  }

  return db;
}

function openMainDb(dataDir, pepper, opts = {}) {
  return openEncryptedDb(path.join(dataDir, 'quilltap.db'), pepper, { ...opts, friendlyName: 'main database' });
}

function openLlmLogsDb(dataDir, pepper, opts = {}) {
  return openEncryptedDb(path.join(dataDir, 'quilltap-llm-logs.db'), pepper, { ...opts, friendlyName: 'LLM logs database' });
}

function openMountIndexDb(dataDir, pepper, opts = {}) {
  return openEncryptedDb(path.join(dataDir, 'quilltap-mount-index.db'), pepper, { ...opts, friendlyName: 'mount index database' });
}

// ---------- shared name resolvers ----------
// Used by `db` and `memories` (and any future CLI namespace) to turn fuzzy
// user input — a UUID, a name, an alias, a substring — into a concrete row.
// Throws an `ambiguous` error (with `.ambiguous = true`) when multiple rows
// match so callers can surface a clean list instead of a stack trace.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ambiguous(kind, rows) {
  const list = rows.slice(0, 10).map(r => `  ${r.id}  ${r.name || r.title || ''}`).join('\n');
  const more = rows.length > 10 ? `\n  … and ${rows.length - 10} more` : '';
  const err = new Error(`Multiple ${kind}s match. Use a UUID or a more specific name:\n${list}${more}`);
  err.ambiguous = true;
  return err;
}

// Read the `aliases` array out of a character vault's `properties.json`.
// The 4.6 vault cutover dropped the `aliases` (and `pronouns`) columns from
// the `characters` table — they now live only in the per-character vault — so
// any alias lookup has to go through the mount-index DB. `mounts` is that
// handle; `mountPointId` is `characters.characterDocumentMountPointId`.
// Returns [] for a missing/empty/unparseable vault so callers can treat the
// absence of aliases as "no match" rather than an error.
function readVaultAliases(mounts, mountPointId) {
  if (!mounts || !mountPointId) return [];
  const rec = mounts.prepare(
    `SELECT d.content AS content
       FROM doc_mount_file_links l
       JOIN doc_mount_documents d ON d.fileId = l.fileId
      WHERE l.mountPointId = ? AND LOWER(l.relativePath) = 'properties.json'
      LIMIT 1`
  ).get(mountPointId);
  if (!rec || !rec.content) return [];
  try {
    const props = JSON.parse(rec.content);
    return Array.isArray(props.aliases)
      ? props.aliases.filter((a) => typeof a === 'string')
      : [];
  } catch {
    return [];
  }
}

// Find characters whose vault aliases contain `query` (case-insensitive
// substring). Requires a mount-index DB handle; returns [{ id, name }].
// Scans every vaulted character's `properties.json` — fine for a CLI, and only
// reached on the fuzzy-resolution fallback (a clean name match returns first).
function resolveCharactersByAlias(db, mounts, query) {
  if (!mounts) return [];
  const needle = query.toLowerCase();
  const chars = db.prepare(
    'SELECT id, name, characterDocumentMountPointId AS mp FROM characters WHERE characterDocumentMountPointId IS NOT NULL'
  ).all();
  const matches = [];
  for (const c of chars) {
    const aliases = readVaultAliases(mounts, c.mp);
    if (aliases.some((a) => a.toLowerCase().includes(needle))) {
      matches.push({ id: c.id, name: c.name });
    }
  }
  return matches;
}

// Resolve a UUID / name / alias to a single { id, name } row.
//
// `openMounts` (optional) is a zero-arg function that returns a mount-index DB
// handle (e.g. `ctx.openMounts`). When supplied, the fuzzy fallback also
// matches against vault-stored aliases; when omitted (or if the mount-index DB
// can't be opened), resolution degrades gracefully to UUID + name only.
function resolveCharacter(db, query, openMounts = null) {
  if (UUID_RE.test(query)) {
    const row = db.prepare('SELECT id, name FROM characters WHERE id = ?').get(query);
    if (!row) throw new Error(`No character with id ${query}`);
    return row;
  }
  const exact = db.prepare(
    'SELECT id, name FROM characters WHERE LOWER(name) = LOWER(?)'
  ).all(query);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw ambiguous('character', exact);
  }

  const candidates = db.prepare(
    'SELECT id, name FROM characters WHERE LOWER(name) LIKE LOWER(?) ORDER BY name'
  ).all(`%${query}%`);

  // Fold in alias matches from the vault when the caller gave us a way to
  // reach the mount-index DB. Aliases moved into properties.json in 4.6.
  if (openMounts) {
    let mounts = null;
    try {
      mounts = openMounts();
    } catch {
      mounts = null; // mount-index DB absent on this instance — skip aliases
    }
    if (mounts) {
      try {
        const seen = new Set(candidates.map((r) => r.id));
        for (const m of resolveCharactersByAlias(db, mounts, query)) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            candidates.push(m);
          }
        }
      } finally {
        try { mounts.close(); } catch {}
      }
    }
  }

  if (candidates.length === 0) throw new Error(`No character matching '${query}'`);
  if (candidates.length > 1) throw ambiguous('character', candidates);
  return candidates[0];
}

function resolveChat(db, query) {
  if (UUID_RE.test(query)) {
    const row = db.prepare('SELECT id, title, chatType, projectId FROM chats WHERE id = ?').get(query);
    if (!row) throw new Error(`No chat with id ${query}`);
    return row;
  }
  const fuzzy = db.prepare(
    "SELECT id, title, chatType, projectId, lastMessageAt FROM chats WHERE LOWER(title) LIKE LOWER(?) ORDER BY lastMessageAt DESC"
  ).all(`%${query}%`);
  if (fuzzy.length === 0) throw new Error(`No chat matching '${query}'`);
  if (fuzzy.length > 1) throw ambiguous('chat', fuzzy);
  return fuzzy[0];
}

function resolveProject(db, query) {
  if (UUID_RE.test(query)) {
    const row = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(query);
    if (!row) throw new Error(`No project with id ${query}`);
    return row;
  }
  const fuzzy = db.prepare(
    'SELECT id, name FROM projects WHERE LOWER(name) LIKE LOWER(?) ORDER BY name'
  ).all(`%${query}%`);
  if (fuzzy.length === 0) throw new Error(`No project matching '${query}'`);
  if (fuzzy.length > 1) throw ambiguous('project', fuzzy);
  return fuzzy[0];
}

module.exports = {
  resolveDataDir,
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  promptPassphrase,
  loadDbKey,
  openEncryptedDb,
  openMainDb,
  openLlmLogsDb,
  openMountIndexDb,
  UUID_RE,
  ambiguous,
  resolveCharacter,
  resolveCharactersByAlias,
  readVaultAliases,
  resolveChat,
  resolveProject,
};
