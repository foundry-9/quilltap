#!/usr/bin/env node
'use strict';

const { fork, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getCacheDir, isCacheValid, ensureStandalone } = require('../lib/download-manager');
const {
  resolveDataDir,
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  promptPassphrase,
  loadDbKey,
} = require('../lib/db-helpers');
const { resolveInstance } = require('../lib/instances');
const { resolveModuleDir, ensureNativeModules, ensureDatabaseNativeModule } = require('../lib/native-modules');

const PACKAGE_DIR = path.resolve(__dirname, '..');

// Read version from package.json
function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

// Parse CLI arguments
function parseArgs(argv) {
  const opts = {
    port: 3000,
    dataDir: '',
    instance: '',
    open: false,
    help: false,
    version: false,
    update: false,
  };

  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--port':
      case '-p':
        opts.port = parseInt(args[++i], 10);
        if (isNaN(opts.port) || opts.port < 1 || opts.port > 65535) {
          console.error('Error: --port must be a number between 1 and 65535');
          process.exit(1);
        }
        break;
      case '--data-dir':
      case '-d':
        opts.dataDir = args[++i];
        break;
      case '--instance':
      case '-i':
        opts.instance = args[++i];
        break;
      case '--open':
      case '-o':
        opts.open = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      case '--update':
        opts.update = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        // Allow subcommands to pass through (they're handled before parseArgs)
        console.error(`Unknown argument: ${args[i]}`);
        console.error('Run "quilltap --help" for usage information.');
        process.exit(1);
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Quilltap - Self-hosted AI workspace

Usage: quilltap [options]

Subcommands:
  db                            Query encrypted databases
  themes                        Manage theme bundles
  docs                          Inspect, read, and export document mounts
  memories                      Search, browse, and graph memories
  instances                     Register / inspect named Quilltap instances
  logs                          Tail or print an instance log file
  migrations                    Inspect migration status (status / pending / run)
  maintenance                   Run retention / cleanup sweeps (status / run)
  file-verify                   Force-download cloud-evicted data files (iCloud, etc.)
  memory-diff <chatId>          Dump existing memories and dry-run re-extraction for a chat
  recall-replay <chatId>        Replay a turn's memory recall, old vs episodic ranking
  completion <shell>            Generate a shell completion script (bash / zsh / fish)

Options:
  -p, --port <number>     Port to listen on (default: 3000)
  -d, --data-dir <path>   Data directory (default: platform-specific)
  -i, --instance <name>   Use a registered instance (see 'quilltap instances')
  -o, --open              Open browser after server starts
  -v, --version           Show version number
  --update                Force re-download of application files
  -h, --help              Show this help message

Data directory defaults:
  macOS:    ~/Library/Application Support/Quilltap
  Linux:    ~/.quilltap
  Windows:  %APPDATA%\\Quilltap

Examples:
  quilltap                              # Start on port 3000
  quilltap -p 8080                      # Start on port 8080
  quilltap -d /mnt/data/quilltap        # Custom data directory
  quilltap -o                           # Start and open browser
  quilltap --update                     # Re-download app files
  quilltap --instance Friday db schema  # Universal flags (-i/--instance, -d/--data-dir,
                                        #   --passphrase) work before or after a subcommand

More info: https://quilltap.ai
`);
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(`Could not open browser automatically. Visit: ${url}`);
    }
  });
}

// Symlink native modules into the standalone directory's node_modules
// so that standard Node.js resolution finds them without relying on NODE_PATH.
function linkNativeModules(standaloneDir) {
  const standaloneNodeModules = path.join(standaloneDir, 'node_modules');

  // Ensure top-level node_modules exists in standalone dir
  if (!fs.existsSync(standaloneNodeModules)) {
    fs.mkdirSync(standaloneNodeModules, { recursive: true });
  }

  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

  // Link a single module directory into standaloneDir/node_modules/<name>
  function linkModule(name, sourceDir) {
    if (!sourceDir) return;
    const targetPath = path.join(standaloneNodeModules, name);

    // If already exists and points to the right place, skip
    if (fs.existsSync(targetPath)) {
      try {
        const existing = fs.realpathSync(targetPath);
        const source = fs.realpathSync(sourceDir);
        if (existing === source) return; // already linked correctly
      } catch {
        // If we can't resolve, remove and re-link
      }
      // Remove stale link/dir
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    // Ensure parent directory exists (for scoped packages like @img/sharp-*)
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      fs.symlinkSync(sourceDir, targetPath, symlinkType);
    } catch (err) {
      // If symlink fails (e.g. permissions), try copying as fallback
      console.error(`  Warning: Could not symlink ${name}: ${err.message}`);
    }
  }

  // Link better-sqlite3-multiple-ciphers as 'better-sqlite3' (the app imports it
  // via npm alias). Prefer the SQLCipher build; fall back to plain better-sqlite3.
  const betterSqlite3Dir = resolveModuleDir('better-sqlite3-multiple-ciphers')
                        || resolveModuleDir('better-sqlite3');
  linkModule('better-sqlite3', betterSqlite3Dir);

  // Link node-pty — but only when we have to. The standalone tarball ships
  // node-pty intact with cross-platform prebuilds (darwin-arm64, darwin-x64,
  // win32-arm64, win32-x64). On those platforms the tarball-shipped copy is
  // already correct, and we MUST NOT replace it with a symlink to the
  // npm-installed copy: `sudo npm install -g quilltap` on macOS can strip the
  // executable bit off `spawn-helper`, and we can't chmod a root-owned file
  // back as a non-root runtime user — pty.spawn() then fails with
  // `posix_spawnp failed`. Only Linux (which has no node-pty prebuild) and
  // rebuild-failure cases need the symlink.
  const standaloneNodePtyPath = path.join(standaloneNodeModules, 'node-pty');
  const standaloneHasUsablePty = (() => {
    try {
      const stat = fs.lstatSync(standaloneNodePtyPath);
      if (stat.isSymbolicLink()) return false; // prior broken-symlink state — replace it
      if (!stat.isDirectory()) return false;
    } catch {
      return false;
    }
    const platformPrebuildDir = path.join(
      standaloneNodePtyPath,
      'prebuilds',
      `${process.platform}-${process.arch}`,
    );
    return fs.existsSync(platformPrebuildDir);
  })();

  if (!standaloneHasUsablePty) {
    const nodePtyDir = resolveModuleDir('node-pty');
    linkModule('node-pty', nodePtyDir);
    if (nodePtyDir) {
      // Some npm cache extractions (notably `sudo npm install -g`) strip the
      // executable bit on spawn-helper. Restore it where we can. If chmod
      // fails because we don't own the file (typical when the CLI was
      // installed with sudo and is run as a non-root user), warn loudly —
      // silent failure here produces the `posix_spawnp failed` runtime error
      // with no actionable hint.
      const prebuildsDir = path.join(nodePtyDir, 'prebuilds');
      if (fs.existsSync(prebuildsDir)) {
        try {
          for (const entry of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const helper = path.join(prebuildsDir, entry.name, 'spawn-helper');
            if (!fs.existsSync(helper)) continue;
            try {
              fs.chmodSync(helper, 0o755);
            } catch (err) {
              if (err && err.code === 'EPERM') {
                console.error('');
                console.error(`  Warning: Could not make node-pty spawn-helper executable:`);
                console.error(`    ${helper}`);
                console.error(`  The file is owned by another user (likely root from a sudo'd`);
                console.error(`  global install). Terminal sessions will fail to spawn with`);
                console.error(`  "posix_spawnp failed" until this is fixed. Run:`);
                console.error(`    sudo chmod 755 "${helper}"`);
                console.error('');
              }
              // Other errors are non-fatal — node-pty may still work if the bit was already set.
            }
          }
        } catch { /* best-effort */ }
      }
    }
  }

  // Link sharp
  const sharpDir = resolveModuleDir('sharp');
  linkModule('sharp', sharpDir);

  // Link a scoped native's platform-specific siblings (@img/sharp-*,
  // @napi-rs/canvas-*). Both wrappers require their binary as a SCOPE-SIBLING
  // — `@img/sharp-darwin-arm64` from inside `@img/sharp` — so the binary has to
  // sit in the same node_modules the wrapper was resolved from. It cannot be
  // inherited: the standalone tree lives in the download cache
  // (~/Library/Caches/Quilltap/standalone and friends), far outside this
  // package's node_modules, so Node's upward walk never reaches the copy npm
  // installed for us. Linking the wrapper without its siblings therefore
  // produces a wrapper that resolves and then throws at first use.
  function linkScopedPlatformSiblings(scope, prefix, wrapperName, wrapperDir) {
    if (!wrapperDir) return;
    // Walk back exactly as many segments as the wrapper's own name has, so this
    // works whether the wrapper is unscoped ('sharp' -> one) or scoped
    // ('@napi-rs/canvas' -> two). Counting fixed levels would silently resolve
    // one directory too high for sharp and miss @img entirely.
    let nodeModulesDir = wrapperDir;
    for (let i = 0; i < wrapperName.split('/').length; i++) {
      nodeModulesDir = path.dirname(nodeModulesDir);
    }
    const scopeDir = path.join(nodeModulesDir, scope);
    if (!fs.existsSync(scopeDir)) return;
    try {
      for (const name of fs.readdirSync(scopeDir)) {
        if (!name.startsWith(prefix)) continue;
        linkModule(`${scope}/${name}`, path.join(scopeDir, name));
      }
    } catch {
      // Non-fatal — the wrapper may still find a binary by another route.
    }
  }

  linkScopedPlatformSiblings('@img', 'sharp-', 'sharp', sharpDir);

  // Link @napi-rs/canvas (pdfjs-dist's PDF rasteriser) the same way sharp is
  // handled: build-standalone-tarball.mjs strips every @napi-rs/canvas-* binary
  // from the tarball, so without this the standalone tree keeps only the JS
  // wrapper and PDF rendering dies on a missing native. The wrapper is scoped,
  // so it needs its siblings linked alongside it.
  const canvasDir = resolveModuleDir('@napi-rs/canvas');
  linkModule('@napi-rs/canvas', canvasDir);
  linkScopedPlatformSiblings('@napi-rs', 'canvas-', '@napi-rs/canvas', canvasDir);
}

// Main
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const version = getVersion();

  if (opts.version) {
    console.log(version);
    process.exit(0);
  }

  // Ensure standalone files are downloaded and cached
  const cacheDir = getCacheDir();
  let standaloneDir;

  try {
    standaloneDir = await ensureStandalone(version, cacheDir, { force: opts.update });
  } catch (err) {
    console.error('');
    console.error(err.message);
    process.exit(1);
  }

  const serverJs = path.join(standaloneDir, 'server.js');

  if (!fs.existsSync(serverJs)) {
    console.error('Error: server.js not found in cached standalone directory.');
    console.error('Try running "quilltap --update" to re-download.');
    process.exit(1);
  }

  // Ensure native modules are compiled for the current Node.js version
  ensureNativeModules();

  // Symlink native modules into standalone dir so standard resolution finds them
  linkNativeModules(standaloneDir);

  // Set up environment
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(opts.port),
    HOSTNAME: '0.0.0.0',
  };

  if (opts.dataDir && opts.instance) {
    console.error('Error: Specify either --instance or --data-dir, not both.');
    process.exit(1);
  }
  if (opts.instance) {
    try {
      const inst = resolveInstance(opts.instance);
      env.QUILLTAP_DATA_DIR = inst.path;
      opts.dataDir = inst.path; // surfaced in the startup banner below
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  } else if (opts.dataDir) {
    env.QUILLTAP_DATA_DIR = path.resolve(opts.dataDir);
  }

  // Set NODE_PATH as a fallback — native modules are symlinked into standaloneDir
  // but NODE_PATH covers any other dependencies. Include the parent node_modules
  // to handle npm hoisting (e.g. npx installs where deps are hoisted up a level).
  const packageNodeModules = path.join(PACKAGE_DIR, 'node_modules');
  const parentNodeModules = path.resolve(PACKAGE_DIR, '..');
  env.NODE_PATH = [packageNodeModules, parentNodeModules, env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);

  const url = `http://localhost:${opts.port}`;

  console.log('');
  console.log(`  Quilltap v${version}`);
  console.log('');
  console.log(`  URL:       ${url}`);
  if (opts.dataDir) {
    console.log(`  Data dir:  ${env.QUILLTAP_DATA_DIR}`);
  }
  console.log('');
  console.log('  Starting server...');
  console.log('');

  // Fork the Next.js standalone server
  const child = fork(serverJs, [], {
    cwd: standaloneDir,
    env,
    stdio: 'inherit',
  });

  // Open browser once server is listening
  if (opts.open) {
    setTimeout(() => openBrowser(url), 2000);
  }

  // Forward signals for graceful shutdown
  function shutdown(signal) {
    child.kill(signal);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

// ============================================================================
// db subcommand helpers (resolveDataDir, promptPassphrase, loadDbKey) live in
// ../lib/db-helpers.js so the docs subcommand can share them.
// ============================================================================

// ============================================================================
// Instance Lock CLI Commands
// ============================================================================

/**
 * Check whether a PID is alive using signal 0.
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM = exists but no permission
  }
}

/**
 * Verify a PID looks like a Node/Quilltap process (best-effort).
 */
function verifyPidIsNode(pid, expectedArgv0) {
  try {
    if (process.platform === 'linux') {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const cmd = cmdline.split('\0')[0] || '';
        return /node|electron|quilltap|next-server/i.test(cmd);
      } catch {
        return true; // Can't read — assume match
      }
    }
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      const output = execSync(`ps -p ${pid} -o comm=`, {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return /node|electron|quilltap|next-server/i.test(output);
    }
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
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
 * Handle --lock-status, --lock-clean, --lock-override commands.
 */
function handleLockCommand(dataDir, opts) {
  const lockPath = path.join(dataDir, 'quilltap.lock');
  const hostname = require('os').hostname();

  // Read lock file
  let lock = null;
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8');
      lock = JSON.parse(raw);
    }
  } catch (err) {
    if (opts.lockStatus) {
      console.log('Lock file exists but is corrupt or unreadable.');
      console.log(`  Path: ${lockPath}`);
      if (opts.lockClean) {
        fs.unlinkSync(lockPath);
        console.log('  Removed corrupt lock file.');
      }
    }
    return;
  }

  // --lock-status: display current lock state
  if (opts.lockStatus) {
    if (!lock) {
      console.log('No instance lock found. Database is not currently claimed.');
      console.log(`  Lock path: ${lockPath}`);
      return;
    }

    const sameHost = lock.hostname === hostname;
    const alive = sameHost && isPidAlive(lock.pid);
    const isNode = alive ? verifyPidIsNode(lock.pid, lock.processArgv0 || '') : false;

    // Status line
    let status;
    if (alive && isNode) {
      status = '\x1b[32mACTIVE\x1b[0m (process confirmed running)';
    } else if (alive && !isNode) {
      status = '\x1b[33mSUSPECT\x1b[0m (PID alive but does not look like Quilltap — possible PID reuse)';
    } else if (!sameHost) {
      // Different hostname — could be a container on this machine
      const isVMOrContainer = lock.environment === 'docker';
      const heartbeatAgeMs = lock.lastHeartbeat
        ? Date.now() - new Date(lock.lastHeartbeat).getTime()
        : Infinity;
      const heartbeatFreshMs = 5 * 60 * 1000;

      if (isVMOrContainer && heartbeatAgeMs < heartbeatFreshMs) {
        const ageStr = Math.round(heartbeatAgeMs / 1000) + 's';
        status = `\x1b[32mACTIVE (${lock.environment}, heartbeat ${ageStr} ago)\x1b[0m`;
      } else if (isVMOrContainer) {
        status = `\x1b[33mSTALE (${lock.environment}, no recent heartbeat)\x1b[0m — will be auto-claimed on next startup`;
      } else {
        status = '\x1b[33mSTALE (different host)\x1b[0m — will be auto-claimed on next startup';
      }
    } else {
      status = '\x1b[31mSTALE (process dead)\x1b[0m — will be auto-claimed on next startup';
    }

    console.log(`Instance Lock Status: ${status}`);
    console.log();
    console.log(`  PID:          ${lock.pid}`);
    console.log(`  Hostname:     ${lock.hostname}${sameHost ? ' (this host)' : ' (different host)'}`);
    console.log(`  Environment:  ${lock.environment || 'unknown'}`);
    console.log(`  Process:      ${lock.processTitle || 'unknown'}`);
    console.log(`  Started:      ${lock.startedAt || 'unknown'}`);

    // Show heartbeat age if available
    if (lock.lastHeartbeat) {
      const heartbeatAge = Math.round((Date.now() - new Date(lock.lastHeartbeat).getTime()) / 1000);
      let heartbeatDisplay;
      if (heartbeatAge < 120) {
        heartbeatDisplay = `${heartbeatAge}s ago`;
      } else if (heartbeatAge < 7200) {
        heartbeatDisplay = `${Math.round(heartbeatAge / 60)}m ago`;
      } else {
        heartbeatDisplay = `${Math.round(heartbeatAge / 3600)}h ago`;
      }
      // Warn if heartbeat is older than 5 minutes (process may be hung)
      if (alive && heartbeatAge > 300) {
        heartbeatDisplay = `\x1b[33m${heartbeatDisplay} (stale — process may be hung)\x1b[0m`;
      }
      console.log(`  Heartbeat:    ${heartbeatDisplay}`);
    }

    console.log(`  Lock file:    ${lockPath}`);

    if (lock.history && lock.history.length > 0) {
      console.log();
      console.log(`  Recent history (${lock.history.length} entries):`);
      const recent = lock.history.slice(-10);
      for (const entry of recent) {
        const ts = entry.timestamp ? entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '?';
        const detail = entry.detail ? ` — ${entry.detail}` : '';
        console.log(`    [${ts}] ${entry.event} (PID ${entry.pid})${detail}`);
      }
      if (lock.history.length > 10) {
        console.log(`    ... and ${lock.history.length - 10} earlier entries`);
      }
    }
    return;
  }

  // --lock-clean: remove stale locks only
  if (opts.lockClean) {
    if (!lock) {
      console.log('No lock file found. Nothing to clean.');
      return;
    }

    const sameHost = lock.hostname === hostname;
    const alive = sameHost && isPidAlive(lock.pid);

    if (alive) {
      const isNode = verifyPidIsNode(lock.pid, lock.processArgv0 || '');
      if (isNode) {
        console.log(`Lock is held by a live Quilltap process (PID ${lock.pid}). Cannot clean.`);
        console.log('Stop the running instance first, or use --lock-override to force.');
        process.exit(1);
      } else {
        console.log(`Lock references PID ${lock.pid} which is alive but does NOT look like a Quilltap process.`);
        console.log('This is likely a stale lock with a reused PID. Removing.');
      }
    } else if (!sameHost) {
      // Different hostname — check if it's a container with a recent heartbeat
      const isVMOrContainer = lock.environment === 'docker';
      const heartbeatAgeMs = lock.lastHeartbeat
        ? Date.now() - new Date(lock.lastHeartbeat).getTime()
        : Infinity;
      const heartbeatFreshMs = 5 * 60 * 1000;

      if (isVMOrContainer && heartbeatAgeMs < heartbeatFreshMs) {
        const ageStr = Math.round(heartbeatAgeMs / 1000) + 's';
        console.log(`Lock is held by a live ${lock.environment} instance (heartbeat ${ageStr} ago). Cannot clean.`);
        console.log('Stop the other instance first, or use --lock-override to force.');
        process.exit(1);
      } else if (isVMOrContainer) {
        console.log(`Lock was held by ${lock.environment} (${lock.hostname}) with no recent heartbeat. Removing stale lock.`);
      } else {
        console.log(`Lock was held by a different host (${lock.hostname}). Removing stale lock.`);
      }
    } else {
      console.log(`Lock was held by PID ${lock.pid} which is no longer running. Removing stale lock.`);
    }

    // Write a final history entry before deleting
    if (!lock.history) lock.history = [];
    lock.history.push({
      event: 'stale-claimed',
      pid: process.pid,
      hostname: hostname,
      timestamp: new Date().toISOString(),
      detail: `Cleaned via CLI (quilltap db --lock-clean)`,
    });

    // Write final state then remove
    try {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    } catch { /* best effort */ }

    try {
      fs.unlinkSync(lockPath);
      console.log('Lock file removed.');
    } catch (err) {
      console.error(`Failed to remove lock file: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // --lock-override: forcibly claim the lock
  if (opts.lockOverride) {
    if (!lock) {
      console.log('No lock file found. Nothing to override.');
      return;
    }

    const sameHost = lock.hostname === hostname;
    const alive = sameHost && isPidAlive(lock.pid);

    if (alive) {
      const isNode = verifyPidIsNode(lock.pid, lock.processArgv0 || '');
      if (!isNode) {
        console.error(`Lock override rejected: PID ${lock.pid} is alive but does not appear to be`);
        console.error('a Quilltap/Node process. The PID may have been reused. Verify manually.');
        process.exit(1);
      }
      console.log(`WARNING: Overriding lock held by live process (PID ${lock.pid}, ${lock.environment || 'unknown'}).`);
      console.log('The other instance may corrupt the database if it is still writing.');
    } else {
      console.log(`Overriding stale lock (PID ${lock.pid} is no longer running).`);
    }

    // Record override in history
    if (!lock.history) lock.history = [];
    lock.history.push({
      event: 'override',
      pid: process.pid,
      hostname: hostname,
      timestamp: new Date().toISOString(),
      detail: `Manual override via CLI (quilltap db --lock-override)` +
              (alive ? ` — overriding live PID ${lock.pid}` : ` — PID ${lock.pid} was dead`),
    });

    // Write final state then remove so next startup gets a clean acquire
    try {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    } catch { /* best effort */ }

    try {
      fs.unlinkSync(lockPath);
      console.log('Lock file removed. Next Quilltap startup will acquire a fresh lock.');
    } catch (err) {
      console.error(`Failed to remove lock file: ${err.message}`);
      process.exit(1);
    }
    return;
  }
}

function printDbHelp() {
  console.log(`
Quilltap Database Tool

Usage: quilltap db [options] [sql]
       quilltap db <subcommand> [args]

Query your encrypted Quilltap database directly.

Subcommands (high-level shortcuts; auto-pick the right database):
  schema [table]              Schema overview, or details for one table
  schema --grep <text>        Find tables/columns whose name matches
  find character [query]      List or look up characters by name/id
  find chat [query]           List or look up chats by title/id
  find project [query]        List or look up projects by name/id
  chats --character <name|id> Chats containing a character
  chats --project <name|id>   Chats in a project
  messages --chat <id|title>  Recent messages in a chat
                              (flags: --last N --full --from <pid> --type <t>)
  logs --chat <id|title>      LLM logs for a chat
  logs --message <id>         LLM logs for a single message
  logs --character <name|id>  LLM logs for a character
  logs --tail N               Most recent LLM logs
  message <id>                Full content of a single chat message
  log <id>                    Full request/response of a single LLM log
  memories --character <id>   Memories held by a character
                              (flags: --about <id|name> --source AUTO|MANUAL)
  characters status           Per-character vault readiness report:
                              flag value, vault present, single-file count,
                              Prompts/ and Scenarios/ folder counts, and any
                              divergence between DB columns and vault content.
                              (flags: --id <id|name> --diverged --blocked --limit N)
  characters archives         List archived characters and ARCHIVE bundles on
                              the shelf, loose bundles included. Read-only.
  characters archive <name|id> --write [--port N]
                              Archive a character via the RUNNING server (it
                              holds the export pipeline and the passphrase).
  characters rehydrate <name|id> --write [--port N]
                              Wake an archived character via the running server.
  characters export <name|id> [--out <path>] [--port N]
                              Write a PLAINTEXT .qtap for a character. Archived:
                              decrypts the bundle offline (prompts for the
                              passphrase on protected instances) — the only way
                              to reach packed-away mail/photos/summaries without
                              rehydrating. Live: runs the server's export
                              pipeline (server must be up). Read-only.
  optimize [target...]        Run maintenance (VACUUM + ANALYZE + PRAGMA optimize)
                              on the named databases, or all of them if no
                              target is given. Targets: main, llm-logs,
                              mount-points (or "all"). Refuses to run while a
                              live Quilltap instance holds the lock.
  backup [target...] [--out <dir>]
                              Online consistent snapshot of the encrypted
                              databases. Safe while the server is running.
                              Default destination: <dataDir>/backups/<timestamp>/.
                              Each snapshot is re-opened with the same key and
                              verified with PRAGMA quick_check.
  integrity [target...]       Run PRAGMA cipher_integrity_check and
                              PRAGMA integrity_check on the encrypted
                              databases. Read-only; safe alongside a live
                              instance. Exit code: 0 ok, 1 issues, 2 open
                              failure.
  Most subcommands also accept --json and --limit N.

Low-level options (legacy; still supported):
  The database is opened READ-ONLY by default. Add --write to make changes.
  --tables              List all tables in the active database
  --count <table>       Show row count for a table
  --repl                Interactive SQL prompt (extras: .cols, .find).
                        Read-only unless combined with --write.
  --write               Open the database read-write. Claims the instance lock
                        for the duration and releases it on exit. Refuses (no
                        override) if a running server or another instance holds
                        the lock — stop it first. Works with raw SQL and --repl.
  --json                Emit machine-readable JSON instead of a table
                        (works with --tables, --count, and raw SQL)
  --llm-logs            Target the LLM logs database
  --mount-points        Target the document mount-index database
  --data-dir <path>     Override data directory (pass instance root)
  -i, --instance <name> Use a registered instance from instances.json
                        (see 'quilltap instances --help')
  --passphrase <pass>   Provide passphrase for encrypted .dbkey
  -h, --help            Show this help

Instance Lock Commands:
  --lock-status         Show the current instance lock state
  --lock-clean          Remove stale locks (dead processes only)
  --lock-override       Forcibly claim the lock for this process

If a passphrase is required and not provided via --passphrase, the tool
will check the QUILLTAP_DB_PASSPHRASE environment variable, then prompt
interactively (with hidden input) if a TTY is available.

Examples:
  quilltap db schema                                   # tables grouped by domain
  quilltap db schema chat_messages                     # columns + indexes + DDL link
  quilltap db find character Friday                    # name → uuid
  quilltap db chats --character Friday                 # all chats with Friday
  quilltap db messages --chat <id> --last 50 --full    # recent messages
  quilltap db logs --chat "physical prompts"           # llm logs for a chat
  quilltap db log <log-id>                             # full request/response
  quilltap db optimize                                 # VACUUM + ANALYZE all DBs
  quilltap db optimize llm-logs                        # only the LLM logs DB
  quilltap db backup                                   # snapshot all DBs to <dataDir>/backups/<ts>/
  quilltap db backup main --out /tmp/qtap-snap         # snapshot only the main DB
  quilltap db integrity                                # cipher_integrity_check + integrity_check
  quilltap db --tables
  quilltap db "SELECT count(*) FROM characters"
  quilltap db --count messages
  quilltap db --repl
  quilltap db --write "UPDATE characters SET title = 'rival' WHERE id = '...'"
  quilltap db --repl --write                           # interactive, read-write
  quilltap db --lock-status
  QUILLTAP_DB_PASSPHRASE=secret quilltap db --tables
`);
}

async function dbCommand(args) {
  // ---- Pre-flight: extract dataDir/passphrase, then check for a verb subcommand
  //      before the legacy flag loop. This lets `quilltap db <verb>` dispatch
  //      to the new high-level commands without touching the legacy path.
  const { isVerb, runVerb, makeCtx } = require('../lib/db-commands');

  // Strip --data-dir / --passphrase / --instance out so they can appear anywhere
  // on the line, including before or after the verb.
  const cleaned = [];
  let dataDirOverride = '';
  let passphrase = '';
  let instanceName = '';
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === '--data-dir' || a === '-d') { dataDirOverride = args[++j]; continue; }
    if (a === '--passphrase') { passphrase = args[++j]; continue; }
    if (a === '--instance' || a === '-i') { instanceName = args[++j]; continue; }
    cleaned.push(a);
  }

  // Find first non-flag arg to test for verb
  const firstPositional = cleaned.find(a => !a.startsWith('-'));
  if (firstPositional && isVerb(firstPositional)) {
    let resolved;
    try {
      resolved = resolveDataDirAndPassphrase({
        dataDir: dataDirOverride,
        instance: instanceName,
        passphrase,
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    printDefaultInstanceHint(resolved);
    const dataDir = resolved.dataDir;
    let pepper;
    try {
      pepper = await loadDbKey(dataDir, resolved.passphrase);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    // Re-strip global flags but preserve everything else (verb + its flags)
    const ctx = makeCtx(dataDir, pepper);
    try {
      await runVerb(cleaned, ctx);
    } catch (err) {
      if (!err.silent) {
        console.error(`Error: ${err.message}`);
      }
      const code = err.exitCode != null ? err.exitCode : (err.ambiguous ? 2 : 1);
      process.exit(code);
    }
    return;
  }

  // ---- Legacy flag-based path (unchanged) ----
  let useLlmLogs = false;
  let useMountPoints = false;
  let showTables = false;
  let countTable = '';
  let repl = false;
  let writable = false;
  let sql = '';
  let showHelp = false;
  let lockStatus = false;
  let lockClean = false;
  let lockOverride = false;
  let asJson = false;

  let i = 0;
  while (i < cleaned.length) {
    switch (cleaned[i]) {
      case '--llm-logs': useLlmLogs = true; break;
      case '--mount-points': useMountPoints = true; break;
      case '--tables': showTables = true; break;
      case '--count': countTable = cleaned[++i]; break;
      case '--repl': repl = true; break;
      case '--write': writable = true; break;
      case '--json': asJson = true; break;
      case '--help': case '-h': showHelp = true; break;
      case '--lock-status': lockStatus = true; break;
      case '--lock-clean': lockClean = true; break;
      case '--lock-override': lockOverride = true; break;
      default:
        if (cleaned[i].startsWith('-')) {
          console.error(`Unknown option: ${cleaned[i]}`);
          process.exit(1);
        }
        sql = cleaned[i];
        break;
    }
    i++;
  }

  if (showHelp) {
    printDbHelp();
    process.exit(0);
  }

  let legacyResolved;
  try {
    legacyResolved = resolveDataDirAndPassphrase({
      dataDir: dataDirOverride,
      instance: instanceName,
      passphrase,
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  printDefaultInstanceHint(legacyResolved);
  const dataDir = legacyResolved.dataDir;
  passphrase = legacyResolved.passphrase;

  // ---- Instance lock commands (no database open required) ----
  if (lockStatus || lockClean || lockOverride) {
    handleLockCommand(dataDir, { lockStatus, lockClean, lockOverride });
    return;
  }

  if (useLlmLogs && useMountPoints) {
    console.error('Error: --llm-logs and --mount-points are mutually exclusive');
    process.exit(1);
  }

  let dbFilename;
  if (useLlmLogs) dbFilename = 'quilltap-llm-logs.db';
  else if (useMountPoints) dbFilename = 'quilltap-mount-index.db';
  else dbFilename = 'quilltap.db';
  const dbPath = path.join(dataDir, dbFilename);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  // Load encryption key
  let pepper;
  try {
    pepper = await loadDbKey(dataDir, passphrase);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  // Read-write opens (`--write`, optionally with `--repl`) must claim the
  // instance lock first so a server starting mid-operation refuses to run.
  // Refuses (no override) if a live instance already holds it.
  if (writable) {
    const { acquireWriteLock } = require('../lib/lock-helpers');
    try {
      acquireWriteLock(dataDir);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  // Open database — prefer SQLCipher-capable build
  let Database;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
  } catch {
    Database = require('better-sqlite3');
  }
  const db = new Database(dbPath, { readonly: !writable });

  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }

  try {
    // Verify database is readable
    db.prepare('SELECT 1').get();
  } catch (err) {
    console.error(`Cannot open database: ${err.message}`);
    console.error('The database may be encrypted with a different key, or the .dbkey file may be missing.');
    db.close();
    process.exit(1);
  }

  try {
    if (showTables) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      if (asJson) console.log(JSON.stringify(tables.map(t => t.name), null, 2));
      else for (const t of tables) console.log(t.name);
    } else if (countTable) {
      const row = db.prepare(`SELECT count(*) as count FROM "${countTable}"`).get();
      if (asJson) console.log(JSON.stringify({ table: countTable, count: row.count }, null, 2));
      else console.log(row.count);
    } else if (sql) {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all();
        if (asJson) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (rows.length === 0) {
          console.log('(no results)');
        } else {
          console.table(rows);
        }
      } else {
        const info = stmt.run();
        if (asJson) console.log(JSON.stringify({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }, null, 2));
        else console.log(`Changes: ${info.changes}`);
      }
    } else if (repl) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'quilltap> ' });
      console.log(`Connected to ${dbPath}${writable ? '  (read-write — instance lock held)' : '  (read-only)'}`);
      console.log('Type .tables, .schema <table>, .cols <table>, .find <text>, or SQL. Ctrl+D to exit.\n');
      rl.prompt();
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) { rl.prompt(); return; }
        try {
          if (trimmed === '.tables') {
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
            for (const t of tables) console.log(t.name);
          } else if (trimmed.startsWith('.schema')) {
            const table = trimmed.split(/\s+/)[1];
            if (!table) { console.log('Usage: .schema <table>'); }
            else {
              const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table);
              console.log(row ? row.sql : `Table '${table}' not found`);
            }
          } else if (trimmed.startsWith('.cols')) {
            const table = trimmed.split(/\s+/)[1];
            if (!table) { console.log('Usage: .cols <table>'); }
            else {
              const cols = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
              if (cols.length === 0) console.log(`Table '${table}' not found`);
              else console.table(cols.map(c => ({
                name: c.name, type: c.type,
                notNull: c.notnull ? 'NOT NULL' : '',
                default: c.dflt_value === null ? '' : c.dflt_value,
                pk: c.pk ? 'pk' : '',
              })));
            }
          } else if (trimmed.startsWith('.find')) {
            const needle = trimmed.slice(5).trim();
            if (!needle) { console.log('Usage: .find <text>'); }
            else {
              const lc = needle.toLowerCase();
              const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
              const matches = [];
              for (const t of tables) {
                const tableHit = t.toLowerCase().includes(lc);
                const cols = db.prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all();
                const colHits = cols.filter(c => c.name.toLowerCase().includes(lc)).map(c => c.name);
                if (tableHit || colHits.length) matches.push({ table: t, tableMatch: tableHit, columns: colHits });
              }
              if (matches.length === 0) console.log(`No tables or columns matching '${needle}'`);
              else for (const m of matches) {
                const flag = m.tableMatch ? '*' : ' ';
                console.log(`${flag} ${m.table}${m.columns.length ? '  ' + m.columns.map(c => '.' + c).join(', ') : ''}`);
              }
            }
          } else {
            const stmt = db.prepare(trimmed);
            if (stmt.reader) {
              const rows = stmt.all();
              if (rows.length === 0) console.log('(no results)');
              else console.table(rows);
            } else {
              const info = stmt.run();
              console.log(`Changes: ${info.changes}`);
            }
          }
        } catch (err) {
          console.error(`Error: ${err.message}`);
          if (!writable && /readonly|read-only/i.test(err.message)) {
            console.error('This REPL is read-only. Exit and re-run as `quilltap db --repl --write` to make changes.');
          }
        }
        rl.prompt();
      });
      rl.on('close', () => {
        db.close();
        if (writable) {
          const { releaseWriteLock } = require('../lib/lock-helpers');
          releaseWriteLock(dataDir);
        }
        process.exit(0);
      });
      return; // Don't close db yet — REPL is interactive
    } else {
      printDbHelp();
    }
  } catch (err) {
    if (!writable && /readonly|read-only/i.test(err.message)) {
      console.error('This database was opened read-only, so it cannot be modified.');
      console.error('Re-run with --write to make changes — it claims the instance lock while it runs');
      console.error('and refuses if another Quilltap instance is using the database. For example:');
      console.error(`  quilltap db --write ${sql ? JSON.stringify(sql) : '"UPDATE ..."'}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
  } finally {
    if (!repl) db.close();
    if (writable && !repl) {
      const { releaseWriteLock } = require('../lib/lock-helpers');
      releaseWriteLock(dataDir);
    }
  }
}

// Route to subcommand or main.
//
// Universal flags (-i/--instance, -d/--data-dir, --passphrase, -p/--port) may
// appear *before* the subcommand, e.g. `quilltap --instance Friday db schema`.
// We locate the subcommand by walking the args and skipping those
// value-taking flags (so an instance literally named "db" is not mistaken for
// the subcommand), then hand every other arg — including the leading flags —
// to the subcommand. Each subcommand parses these flags position-independently,
// so they behave the same before or after the verb.
const SUBCOMMANDS = new Set([
  'db', 'themes', 'docs', 'memories', 'instances', 'memory-diff', 'recall-replay', 'completion', 'logs', 'migrations', 'maintenance', 'file-verify',
]);
// Global flags that consume the following token as their value.
const GLOBAL_VALUE_FLAGS = new Set(['-p', '--port', '-d', '--data-dir', '-i', '--instance', '--passphrase']);

function locateSubcommand(argv) {
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (GLOBAL_VALUE_FLAGS.has(a)) { k++; continue; } // skip the flag's value
    if (a.startsWith('-')) continue;                  // boolean / unknown flag
    return SUBCOMMANDS.has(a) ? k : -1;               // first bare token decides
  }
  return -1;
}

const cliArgs = process.argv.slice(2);
const subIdx = locateSubcommand(cliArgs);
const subName = subIdx >= 0 ? cliArgs[subIdx] : '';
// Everything except the subcommand token itself (leading global flags kept).
const subArgs = subIdx >= 0 ? [...cliArgs.slice(0, subIdx), ...cliArgs.slice(subIdx + 1)] : [];

// Subcommands load the SQLCipher binding directly and never reach main()'s
// native-module heal, so self-heal the database ABI here first. Cheap no-op when
// healthy; rebuilds (with a friendly notice, not an error) only on a real
// Node-ABI mismatch — e.g. after the user upgrades Node under a cached install.
// `file-verify` is excluded: it's a pure-fs recovery tool that never opens the
// database, so it must work even when the native binding is broken.
if (subName && subName !== 'file-verify') {
  ensureDatabaseNativeModule();
}

if (subName === 'db') {
  dbCommand(subArgs);
} else if (subName === 'themes') {
  const { themesCommand } = require('../lib/theme-commands');
  themesCommand(subArgs);
} else if (subName === 'docs') {
  const { docsCommand } = require('../lib/docs-commands');
  docsCommand(subArgs);
} else if (subName === 'memories') {
  const { memoriesCommand } = require('../lib/memories-commands');
  memoriesCommand(subArgs).catch(err => {
    if (!err.silent) {
      console.error(`Error: ${err.message}`);
    }
    const code = err.exitCode != null ? err.exitCode : (err.ambiguous ? 2 : 1);
    process.exit(code);
  });
} else if (subName === 'instances') {
  const { instancesCommand } = require('../lib/instances-commands');
  instancesCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'memory-diff') {
  const { memoryDiffCommand } = require('../lib/memory-diff-command');
  memoryDiffCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'recall-replay') {
  const { recallReplayCommand } = require('../lib/recall-replay-command');
  recallReplayCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'completion') {
  const { completionCommand } = require('../lib/completion-commands');
  completionCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'logs') {
  const { logsCommand } = require('../lib/logs-commands');
  logsCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'migrations') {
  const { migrationsCommand } = require('../lib/migrations-commands');
  migrationsCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'maintenance') {
  const { maintenanceCommand } = require('../lib/maintenance-commands');
  maintenanceCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (subName === 'file-verify') {
  const { fileVerifyCommand } = require('../lib/file-verify-commands');
  fileVerifyCommand(subArgs).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {
  main();
}
