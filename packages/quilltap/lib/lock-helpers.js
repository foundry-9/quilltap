'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;
const VM_ENVIRONMENTS = new Set(['docker']);

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function verifyPidIsNode(pid) {
  try {
    if (process.platform === 'linux') {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const cmd = cmdline.split('\0')[0] || '';
        return /node|electron|quilltap|next-server/i.test(cmd);
      } catch {
        return true;
      }
    }
    if (process.platform === 'darwin') {
      const output = execSync(`ps -p ${pid} -o comm=`, {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return /node|electron|quilltap|next-server/i.test(output);
    }
    if (process.platform === 'win32') {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return /node|electron|quilltap|next-server/i.test(output);
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Inspect the instance lock at <dataDir>/quilltap.lock and decide whether it
 * is *actively* held by a live Quilltap process.
 *
 * Returns:
 *   { state: 'absent' }                                — no lock file
 *   { state: 'corrupt', lockPath }                     — file exists but unreadable
 *   { state: 'active', lock, lockPath, reason }        — held by a live owner
 *   { state: 'stale',  lock, lockPath, reason }        — owner is gone
 *   { state: 'suspect', lock, lockPath, reason }       — PID alive but not Quilltap-shaped
 */
function getLockStatus(dataDir) {
  const lockPath = path.join(dataDir, 'quilltap.lock');

  if (!fs.existsSync(lockPath)) {
    return { state: 'absent', lockPath };
  }

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return { state: 'corrupt', lockPath };
  }

  const hostname = os.hostname();
  const sameHost = lock.hostname === hostname;

  if (sameHost) {
    const alive = isPidAlive(lock.pid);
    if (!alive) {
      return { state: 'stale', lock, lockPath, reason: `PID ${lock.pid} is no longer running` };
    }
    const isNode = verifyPidIsNode(lock.pid);
    if (!isNode) {
      return {
        state: 'suspect',
        lock, lockPath,
        reason: `PID ${lock.pid} is alive but does not look like a Quilltap process`,
      };
    }
    return { state: 'active', lock, lockPath, reason: `held by PID ${lock.pid} on this host` };
  }

  // Different hostname — could be a VM/container sharing the data dir.
  const isVM = VM_ENVIRONMENTS.has(lock.environment);
  const heartbeatAgeMs = lock.lastHeartbeat
    ? Date.now() - new Date(lock.lastHeartbeat).getTime()
    : Infinity;
  if (isVM && heartbeatAgeMs < HEARTBEAT_FRESH_MS) {
    const ageStr = Math.round(heartbeatAgeMs / 1000) + 's';
    return {
      state: 'active',
      lock, lockPath,
      reason: `held by ${lock.environment} instance on ${lock.hostname} (heartbeat ${ageStr} ago)`,
    };
  }
  return {
    state: 'stale',
    lock, lockPath,
    reason: `held by ${lock.hostname} but no recent heartbeat`,
  };
}

// ============================================================================
// Write-lock acquire / release
//
// When the CLI opens the database read-write (`quilltap db --write`), it must
// claim the very same `<dataDir>/quilltap.lock` the server uses, in the very
// same JSON shape, so that a server starting mid-operation sees it and refuses
// to run. This mirrors `lib/database/backends/sqlite/instance-lock.ts`
// (buildLockContent / addHistoryEntry / writeLockFile / acquireInstanceLock /
// releaseInstanceLock). We reuse getLockStatus() above for the live/stale
// decision rather than re-deriving liveness.
//
// Hard rule: NO overrides. A live lock (state 'active' or 'suspect') is always
// refused. Only an absent or stale (dead-PID / no-heartbeat) lock is claimed —
// claiming a dead lock is exactly what the server does and is not an override.
// ============================================================================

const MAX_HISTORY_ENTRIES = 50;

// Module-level record of the lock path we currently own, so release is safe to
// call repeatedly (exit handler + explicit finally) and from signal handlers.
let ownedLockPath = null;
let heartbeatTimer = null;
let exitHandlersRegistered = false;

/**
 * Detect the runtime environment for lock metadata. JS port of the server's
 * detectEnvironmentType() so a CLI run inside Docker writes the right
 * environment and the cross-host heartbeat semantics keep working.
 */
function detectEnvironmentType() {
  if (process.versions && process.versions.electron) return 'electron';
  if (process.env.ELECTRON_DEV) return 'electron';
  if (process.env.DOCKER_CONTAINER === 'true') return 'docker';
  try {
    if (fs.existsSync('/.dockerenv')) return 'docker';
  } catch { /* not Docker */ }
  return 'local';
}

/** Build a fresh lock content object for the current process. */
function buildLockContent() {
  const now = new Date().toISOString();
  return {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now,
    lastHeartbeat: now,
    environment: detectEnvironmentType(),
    processTitle: process.title,
    processArgv0: process.argv[0] || '',
    history: [],
  };
}

/** Append a history entry, trimming to MAX_HISTORY_ENTRIES. Returns a new object. */
function addHistoryEntry(content, event, detail) {
  const entry = {
    event,
    pid: process.pid,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
  const history = [...(content.history || []), entry];
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.splice(0, history.length - MAX_HISTORY_ENTRIES);
  }
  return { ...content, history };
}

/** Write lock content atomically via tmp + rename (matches the server). */
function writeLockFileAtomic(lockPath, content) {
  const tmpPath = lockPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, lockPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}

function startHeartbeat(lockPath) {
  stopHeartbeat();
  // 60s like the server. unref() so a one-shot command (which exits in
  // milliseconds) is never held open by the timer; only long `--repl --write`
  // sessions ever actually beat.
  heartbeatTimer = setInterval(() => {
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const lock = JSON.parse(raw);
      if (lock.pid !== process.pid || lock.hostname !== os.hostname()) {
        // We no longer own the lock — stop beating, don't fight over it.
        stopHeartbeat();
        return;
      }
      lock.lastHeartbeat = new Date().toISOString();
      writeLockFileAtomic(lockPath, lock);
    } catch { /* best effort */ }
  }, 60_000);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function registerExitHandlers(dataDir) {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;
  // 'exit' can only run sync work — releaseWriteLock's unlink is sync, so this works.
  process.once('exit', () => { releaseWriteLock(dataDir); });
  process.once('SIGINT', () => { releaseWriteLock(dataDir); process.exit(130); });
  process.once('SIGTERM', () => { releaseWriteLock(dataDir); process.exit(143); });
  process.once('uncaughtException', (err) => {
    releaseWriteLock(dataDir);
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

/**
 * Acquire the instance lock for a read-write CLI session. Throws (with
 * `.locked = true` when a live instance holds it) if the lock is not free.
 * On success the lock is held until releaseWriteLock() / process exit.
 */
function acquireWriteLock(dataDir) {
  const lockPath = path.join(dataDir, 'quilltap.lock');
  const status = getLockStatus(dataDir);

  if (status.state === 'active' || status.state === 'suspect') {
    const lines = [`Database is currently in use — ${status.reason}.`];
    if (status.state === 'active') {
      lines.push('Stop the running Quilltap instance before opening the database read-write.');
    } else {
      lines.push('This may be a stale lock from a reused PID. Inspect it with');
      lines.push('`quilltap db --lock-status` and clean it with `quilltap db --lock-clean` if safe.');
    }
    lines.push('(See `quilltap db --lock-status` for details.)');
    const err = new Error(lines.join('\n'));
    err.locked = true;
    throw err;
  }
  if (status.state === 'corrupt') {
    throw new Error(
      `Lock file at ${status.lockPath} is corrupt. Inspect it manually or clean it with ` +
      '`quilltap db --lock-clean`, then retry.',
    );
  }

  if (status.state === 'stale') {
    // Dead PID / no recent heartbeat — claim it, preserving history.
    claimStaleLock(lockPath, status.lock, status.reason);
    finishAcquire(dataDir, lockPath);
    return;
  }

  // Absent — atomic create so we lose cleanly to any racing process.
  const content = addHistoryEntry(buildLockContent(), 'acquired', 'Read-write CLI session (quilltap db --write)');
  const jsonData = JSON.stringify(content, null, 2) + '\n';
  try {
    const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    try {
      fs.writeSync(fd, jsonData, 0, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    finishAcquire(dataDir, lockPath);
    return;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Someone created the lock between our check and our create. Re-decide.
    const recheck = getLockStatus(dataDir);
    if (recheck.state === 'active' || recheck.state === 'suspect' || recheck.state === 'corrupt') {
      const e = new Error(
        `Database is currently in use — ${recheck.reason || 'lock just claimed by another process'}.\n` +
        'Stop the running Quilltap instance before opening the database read-write.',
      );
      e.locked = true;
      throw e;
    }
    // Now stale (or absent again) — claim it.
    claimStaleLock(lockPath, recheck.lock || buildLockContent(), recheck.reason || 'reclaimed after race');
    finishAcquire(dataDir, lockPath);
  }
}

/** Overwrite a stale lock with our process info, preserving prior history. */
function claimStaleLock(lockPath, existing, reason) {
  let content = { ...buildLockContent(), history: (existing && existing.history) || [] };
  content = addHistoryEntry(content, 'stale-detected', reason);
  content = addHistoryEntry(content, 'stale-claimed', `Claimed by PID ${process.pid} (quilltap db --write)`);
  writeLockFileAtomic(lockPath, content);
}

function finishAcquire(dataDir, lockPath) {
  ownedLockPath = lockPath;
  startHeartbeat(lockPath);
  registerExitHandlers(dataDir);
}

/**
 * Release the lock if (and only if) we own it. Idempotent; never throws.
 */
function releaseWriteLock(dataDir) {
  stopHeartbeat();
  const lockPath = path.join(dataDir, 'quilltap.lock');
  if (ownedLockPath !== lockPath && ownedLockPath !== null) {
    // Owned a different path (shouldn't happen in one CLI run) — be conservative.
  }
  try {
    if (!fs.existsSync(lockPath)) { ownedLockPath = null; return; }
    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      // Corrupt — don't touch a lock we can't prove is ours.
      ownedLockPath = null;
      return;
    }
    if (lock.pid !== process.pid || lock.hostname !== os.hostname()) {
      ownedLockPath = null;
      return;
    }
    const updated = addHistoryEntry(lock, 'released', `Released by PID ${process.pid} (quilltap db --write)`);
    try { writeLockFileAtomic(lockPath, updated); } catch { /* best effort */ }
    try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
  } catch {
    /* never throw from release */
  } finally {
    ownedLockPath = null;
  }
}

module.exports = {
  getLockStatus,
  isPidAlive,
  verifyPidIsNode,
  acquireWriteLock,
  releaseWriteLock,
  detectEnvironmentType,
};
