'use strict';

// Instance registry for the Quilltap CLI.
//
// Stores a per-user mapping of friendly instance names → (instance root path,
// optional database passphrase) so the CLI can be invoked with `--instance Foo`
// instead of `--data-dir <path> --passphrase <secret>`.
//
// File layout: ~/Library/Application Support/Quilltap/instances.json (macOS),
// ~/.quilltap/instances.json (Linux), %APPDATA%\Quilltap\instances.json
// (Windows). Mode 0o600 on POSIX, owned by the current user. The file may
// contain plaintext passphrases, so the read path refuses to load it if those
// invariants are broken.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_VERSION = 1;
const FILENAME = 'instances.json';

function getAppDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Quilltap');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Quilltap');
  }
  return path.join(home, '.quilltap');
}

function getInstancesPath() {
  return path.join(getAppDir(), FILENAME);
}

function expandPath(input) {
  if (!input) return input;
  let p = input;
  if (p.startsWith('~')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

function emptyRegistry() {
  return { version: SCHEMA_VERSION, instances: {}, defaultInstance: null };
}

// Verify ownership + permissions for a passphrase-bearing file on POSIX.
// On Windows we cannot enforce POSIX bits, so we accept and rely on the
// user-profile location to limit access.
function assertSafePermissions(filePath) {
  if (process.platform === 'win32') return;
  const stat = fs.statSync(filePath);
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  if (euid !== null && stat.uid !== euid) {
    throw new Error(
      `Refusing to read ${filePath}: file is owned by uid ${stat.uid}, ` +
      `but current process is uid ${euid}. ` +
      `Either delete the file or run: sudo chown ${euid} "${filePath}"`
    );
  }
  const perms = stat.mode & 0o777;
  if ((perms & 0o077) !== 0) {
    const octal = perms.toString(8).padStart(3, '0');
    throw new Error(
      `Refusing to read ${filePath}: permissions are ${octal} (group/other can access). ` +
      `Quilltap stores passphrases in this file. Restrict it with: chmod 600 "${filePath}"`
    );
  }
}

function readInstances() {
  const filePath = getInstancesPath();
  if (!fs.existsSync(filePath)) {
    return emptyRegistry();
  }
  assertSafePermissions(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid contents in ${filePath}: expected a JSON object.`);
  }
  if (!parsed.instances || typeof parsed.instances !== 'object') {
    parsed.instances = {};
  }
  if (!parsed.version) parsed.version = SCHEMA_VERSION;
  if (!('defaultInstance' in parsed)) {
    parsed.defaultInstance = null;
  }
  return parsed;
}

function writeInstances(registry) {
  const filePath = getInstancesPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = JSON.stringify(
    {
      version: SCHEMA_VERSION,
      instances: registry.instances || {},
      defaultInstance: registry.defaultInstance || null,
    },
    null,
    2
  ) + '\n';

  // Write to a temp file with mode 0600, then rename. This guarantees the file
  // exists with safe permissions from the moment it is visible by name.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(tmpPath, 0o600);
  }
  fs.renameSync(tmpPath, filePath);
  if (process.platform !== 'win32') {
    // rename preserves the tmp file's mode, but be defensive in case of weird
    // umask or filesystem behaviour (e.g. some network mounts).
    fs.chmodSync(filePath, 0o600);
  }
  return filePath;
}

// Case-insensitive lookup so `--instance friday` works even if stored as `Friday`.
function findInstanceKey(registry, name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(registry.instances || {})) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

function resolveInstance(name) {
  const registry = readInstances();
  const key = findInstanceKey(registry, name);
  if (!key) {
    const known = Object.keys(registry.instances || {});
    const hint = known.length
      ? ` Known instances: ${known.join(', ')}.`
      : ' No instances are registered yet — use `quilltap instances add <name>`.';
    throw new Error(`Unknown instance "${name}".${hint}`);
  }
  const entry = registry.instances[key];
  return {
    name: key,
    path: expandPath(entry.path),
    passphrase: entry.passphrase || '',
  };
}

function listInstances() {
  const registry = readInstances();
  const defaultName = registry.defaultInstance;
  return Object.entries(registry.instances || {}).map(([name, entry]) => ({
    name,
    path: entry.path,
    expandedPath: expandPath(entry.path),
    hasPassphrase: typeof entry.passphrase === 'string' && entry.passphrase.length > 0,
    isDefault: name === defaultName,
  }));
}

function upsertInstance(name, { instancePath, passphrase }) {
  if (!name || !name.trim()) {
    throw new Error('Instance name is required.');
  }
  if (!instancePath || !instancePath.trim()) {
    throw new Error('Instance path is required.');
  }
  const registry = readInstances();
  const existingKey = findInstanceKey(registry, name);
  const key = existingKey || name.trim();
  const stored = registry.instances[key] || {};
  registry.instances[key] = {
    path: instancePath.trim(),
    ...(passphrase ? { passphrase } : stored.passphrase ? {} : {}),
  };
  if (passphrase) {
    registry.instances[key].passphrase = passphrase;
  }
  writeInstances(registry);
  return key;
}

function removeInstance(name) {
  const registry = readInstances();
  const key = findInstanceKey(registry, name);
  if (!key) {
    throw new Error(`Unknown instance "${name}".`);
  }
  delete registry.instances[key];
  writeInstances(registry);
  return key;
}

function setInstancePassphrase(name, passphrase) {
  const registry = readInstances();
  const key = findInstanceKey(registry, name);
  if (!key) {
    throw new Error(`Unknown instance "${name}".`);
  }
  if (passphrase) {
    registry.instances[key].passphrase = passphrase;
  } else {
    delete registry.instances[key].passphrase;
  }
  writeInstances(registry);
  return key;
}

function setDefaultInstance(name) {
  const registry = readInstances();
  const key = findInstanceKey(registry, name);
  if (!key) {
    const known = Object.keys(registry.instances || {});
    const hint = known.length
      ? ` Known instances: ${known.join(', ')}.`
      : ' No instances are registered yet — use `quilltap instances add <name>`.';
    throw new Error(`Unknown instance "${name}".${hint}`);
  }
  registry.defaultInstance = key;
  writeInstances(registry);
  return key;
}

function clearDefaultInstance() {
  const registry = readInstances();
  registry.defaultInstance = null;
  writeInstances(registry);
}

function getDefaultInstance() {
  const registry = readInstances();
  return registry.defaultInstance || null;
}

function renameInstance(oldName, newName) {
  if (!oldName || !oldName.trim()) {
    throw new Error('Old instance name is required.');
  }
  if (!newName || !newName.trim()) {
    throw new Error('New instance name is required.');
  }
  const registry = readInstances();
  const oldKey = findInstanceKey(registry, oldName);
  if (!oldKey) {
    throw new Error(`Unknown instance "${oldName}".`);
  }
  const newTrimmed = newName.trim();
  const existingKey = findInstanceKey(registry, newTrimmed);
  if (existingKey) {
    throw new Error(`Instance "${newTrimmed}" already exists.`);
  }
  const entry = registry.instances[oldKey];
  delete registry.instances[oldKey];
  registry.instances[newTrimmed] = entry;
  if (registry.defaultInstance === oldKey) {
    registry.defaultInstance = newTrimmed;
  }
  writeInstances(registry);
  return { oldKey, newKey: newTrimmed };
}

// Verify a candidate passphrase against the .dbkey at <instancePath>/data.
// Returns one of:
//   'valid'        — passphrase unlocks the encrypted pepper
//   'wrong'        — dbkey requires a user passphrase but this one doesn't decrypt
//   'no-dbkey'     — no .dbkey on disk yet (first-run instance)
//   'no-encryption'— dbkey is unlocked by the internal passphrase, no user one needed
async function verifyPassphrase(instanceRoot, passphrase) {
  const { INTERNAL_PASSPHRASE, readDbKeyFile, tryDecryptDbKey } = require('./dbkey');
  const dataDir = path.join(expandPath(instanceRoot), 'data');

  const data = readDbKeyFile(dataDir);
  if (!data) {
    return 'no-dbkey';
  }
  if (tryDecryptDbKey(data, INTERNAL_PASSPHRASE) !== null) {
    return 'no-encryption';
  }
  return tryDecryptDbKey(data, passphrase) !== null ? 'valid' : 'wrong';
}

module.exports = {
  SCHEMA_VERSION,
  getAppDir,
  getInstancesPath,
  expandPath,
  assertSafePermissions,
  readInstances,
  writeInstances,
  listInstances,
  resolveInstance,
  upsertInstance,
  removeInstance,
  setInstancePassphrase,
  setDefaultInstance,
  clearDefaultInstance,
  getDefaultInstance,
  renameInstance,
  verifyPassphrase,
};
