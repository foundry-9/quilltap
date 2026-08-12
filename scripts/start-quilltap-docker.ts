#!/usr/bin/env tsx
/**
 * Start Quilltap Docker Container
 *
 * Cross-platform script that detects the host platform, sets sensible defaults,
 * and starts the Quilltap Docker container.
 *
 * Replaces the Docker-startup parts of the former start-quilltap.sh and
 * start-quilltap.ps1 scripts. (Those shell scripts are kept for curl|bash usage.)
 *
 * Usage:
 *   npm run start:docker
 *   tsx scripts/start-quilltap-docker.ts [options]
 *
 * Options:
 *   -d, --data-dir DIR      Data directory on host (default: platform-specific)
 *   -i, --instance NAME     Registered instance to start (supplies the data dir)
 *   -p, --port PORT         Host port (default: 3000)
 *   -n, --name NAME         Container name (default: quilltap)
 *   -t, --tag TAG           Image tag (default: latest)
 *   -e, --env KEY=VALUE     Extra environment variable (repeatable)
 *   --restart POLICY        Restart policy (default: unless-stopped)
 *   --recreate              Replace an existing container instead of reusing it
 *   --no-store-mounts       Don't bind filesystem document stores into the container
 *   --dry-run               Print the docker command without running it
 *   -h, --help              Show this help message
 *
 * Environment variables (override defaults):
 *   QUILLTAP_DATA_DIR           Data directory
 *   QUILLTAP_PORT               Host port
 *   QUILLTAP_CONTAINER_NAME     Container name
 *   QUILLTAP_IMAGE_TAG          Image tag
 *   QUILLTAP_TIMEZONE           IANA timezone (default: detected from this host)
 *   TZ                          Same; QUILLTAP_TIMEZONE wins if both are set
 *
 * The host's timezone is detected and passed to the container automatically, so
 * scheduled rooms, daily budget rollover, and "today"/"yesterday" recall follow
 * the host clock rather than UTC. Override with `-e QUILLTAP_TIMEZONE=Europe/Paris`,
 * or pin the container to UTC with `-e QUILLTAP_TIMEZONE=UTC`.
 *
 * ## Document store binds
 *
 * A container can only reach host paths that were handed to it as bind mounts,
 * and binds can only be set when the container is *created*. Filesystem and
 * Obsidian document stores point at arbitrary host paths, so without this the
 * stores list normally (the mount index is cached in the database) while every
 * read and write against the real files fails.
 *
 * Before creating a container this script asks the CLI which stores exist and
 * binds each at its own host path, so the `basePath` in the database resolves
 * identically inside and outside the container. Because a store added later
 * cannot be bound into a container that already exists, an existing container
 * is checked for drift and the operator is told when a `--recreate` is owed.
 */

import { execFileSync, execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const IMAGE = 'foundry9/quilltap';
const CLI = join(__dirname, '..', 'packages', 'quilltap', 'bin', 'quilltap.js');

// --- Platform detection ---

type Platform = 'macos' | 'linux' | 'windows';

function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

function defaultDataDir(platform: Platform): string {
  const home = homedir();
  switch (platform) {
    case 'macos': return join(home, 'Library', 'Application Support', 'Quilltap');
    case 'windows': return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Quilltap');
    default: return join(home, '.quilltap');
  }
}

// --- Argument parsing ---

function printHelp(): void {
  console.log(`Usage: tsx scripts/start-quilltap-docker.ts [options]

Options:
  -d, --data-dir DIR      Data directory on host (default: platform-specific)
  -i, --instance NAME     Registered instance to start (supplies the data dir)
  -p, --port PORT         Host port (default: 3000)
  -n, --name NAME         Container name (default: quilltap)
  -t, --tag TAG           Image tag (default: latest)
  -e, --env KEY=VALUE     Extra environment variable (repeatable)
  --restart POLICY        Restart policy (default: unless-stopped)
  --recreate              Replace an existing container instead of reusing it
  --no-store-mounts       Don't bind filesystem document stores into the container
  --dry-run               Print the docker command without running it
  -h, --help              Show this help message

Filesystem and Obsidian document stores are bound into the container automatically,
each at its own host path. Binds are fixed when a container is created, so a store
added later needs '--recreate' before it becomes visible.

Environment variables (override defaults):
  QUILLTAP_DATA_DIR           Data directory
  QUILLTAP_PORT               Host port
  QUILLTAP_CONTAINER_NAME     Container name
  QUILLTAP_IMAGE_TAG          Image tag
  QUILLTAP_TIMEZONE           IANA timezone (default: detected from this host)
  TZ                          Same; QUILLTAP_TIMEZONE wins if both are set

The host timezone is detected and passed to the container automatically. Override
with '-e QUILLTAP_TIMEZONE=Europe/Paris', or pin to UTC with '-e QUILLTAP_TIMEZONE=UTC'.`);
}

/**
 * Resolve the host's IANA timezone name (e.g. "America/Chicago"), or null if it
 * can't be determined confidently.
 *
 * Unlike the shell twins, this needs no fallback chain: we are already running
 * under Node, so `Intl` resolves the zone through the same full-ICU build the
 * container will use, which makes it authoritative by construction.
 *
 * The guard matters. Anything that is not "UTC" or an "Area/Location" name —
 * an abbreviation like "CDT" leaking in through TZ, say — would be silently
 * ignored by the container's ICU and fall back to UTC, which is the exact bug
 * this is meant to prevent. Better to pass nothing than to pass a lie.
 */
function detectTimezone(): string | null {
  const candidate =
    process.env.QUILLTAP_TIMEZONE ||
    process.env.TZ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!candidate) return null;
  return candidate === 'UTC' || candidate.includes('/') ? candidate : null;
}

interface StoreBind {
  hostPath: string;
  containerPath: string;
  stores: string[];
}

interface StorePlan {
  binds: StoreBind[];
  skipped: Array<{ hostPath: string; stores: string[]; reason: string }>;
  warnings: string[];
  unsupported: boolean;
}

interface Options {
  dataDir: string;
  instance: string;
  recreate: boolean;
  storeMounts: boolean;
  port: number;
  name: string;
  tag: string;
  extraEnvs: string[];
  restartPolicy: string;
  dryRun: boolean;
}

function parseArgs(platform: Platform): Options {
  const args = process.argv.slice(2);

  const opts: Options = {
    dataDir: process.env.QUILLTAP_DATA_DIR || defaultDataDir(platform),
    instance: '',
    recreate: false,
    storeMounts: true,
    port: parseInt(process.env.QUILLTAP_PORT || '3000', 10),
    name: process.env.QUILLTAP_CONTAINER_NAME || 'quilltap',
    tag: process.env.QUILLTAP_IMAGE_TAG || 'latest',
    extraEnvs: [],
    restartPolicy: 'unless-stopped',
    dryRun: false,
  };

  // An explicit --data-dir must win over one derived from --instance, whatever
  // order the two appear in, so remember whether the caller set it by hand.
  let dataDirExplicit = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '-d':
      case '--data-dir':
        opts.dataDir = args[++i];
        dataDirExplicit = true;
        break;
      case '-i':
      case '--instance':
        opts.instance = args[++i];
        break;
      case '--recreate':
        opts.recreate = true;
        break;
      case '--no-store-mounts':
        opts.storeMounts = false;
        break;
      case '-p':
      case '--port':
        opts.port = parseInt(args[++i], 10);
        break;
      case '-n':
      case '--name':
        opts.name = args[++i];
        break;
      case '-t':
      case '--tag':
        opts.tag = args[++i];
        break;
      case '-e':
      case '--env':
        opts.extraEnvs.push(args[++i]);
        break;
      case '--restart':
        opts.restartPolicy = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error('Run with --help for usage.');
        process.exit(1);
    }
    i++;
  }

  if (opts.instance && !dataDirExplicit) {
    const resolved = resolveInstanceDataDir(opts.instance);
    if (!resolved) {
      console.error(`Unknown instance '${opts.instance}'. Run 'quilltap instances list' to see registered instances.`);
      process.exit(1);
    }
    opts.dataDir = resolved;
  }

  return opts;
}

// --- Document store binds ---

/** Run the bundled CLI and return its stdout, or null if it could not run. */
function runCli(args: string[]): string | null {
  try {
    return execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/** Look up a registered instance's data directory. */
function resolveInstanceDataDir(name: string): string | null {
  const out = runCli(['instances', 'list', '--json']);
  if (!out) return null;
  try {
    const entries = JSON.parse(out) as Array<{ name: string; expandedPath?: string; path: string }>;
    const match = entries.find(e => e.name.toLowerCase() === name.toLowerCase());
    return match ? (match.expandedPath || match.path) : null;
  } catch {
    return null;
  }
}

/**
 * Ask the CLI which filesystem-backed stores this instance has and where they
 * live on the host.
 *
 * A failure here is deliberately non-fatal. The most likely cause is an
 * encrypted instance whose passphrase the CLI cannot reach (pass `--instance`
 * so it can load the stored one), and refusing to start Quilltap at all over a
 * missing document store would be a poor trade.
 */
function resolveStorePlan(opts: Options): StorePlan | null {
  const args = ['docs', 'docker-mounts', '--format', 'json'];
  if (opts.instance) {
    args.push('--instance', opts.instance);
  } else {
    args.push('--data-dir', opts.dataDir);
  }

  const out = runCli(args);
  if (!out) {
    console.log('Note: could not read document stores; starting without store binds.');
    console.log("      For an encrypted instance, pass '--instance <name>' so the CLI can unlock it.");
    return null;
  }

  try {
    return JSON.parse(out) as StorePlan;
  } catch {
    return null;
  }
}

function storeBindArgs(plan: StorePlan | null): string[] {
  if (!plan) return [];
  return plan.binds.flatMap(b => ['-v', `${b.hostPath}:${b.containerPath}`]);
}

function reportStorePlan(plan: StorePlan | null): void {
  if (!plan) return;

  if (plan.binds.length > 0) {
    console.log(`Stores:    ${plan.binds.length} bound`);
    for (const bind of plan.binds) {
      console.log(`           ${bind.hostPath}  (${bind.stores.join(', ')})`);
    }
  } else if (!plan.unsupported) {
    console.log('Stores:    none to bind');
  }

  for (const warning of plan.warnings) {
    console.log(`  warning: ${warning}`);
  }
}

/** Host-side sources a container was created with. */
function existingBindSources(name: string): string[] {
  try {
    const out = execSync(`docker inspect ${name} --format "{{json .Mounts}}"`, { encoding: 'utf-8' });
    const mounts = JSON.parse(out) as Array<{ Type: string; Source: string }>;
    return mounts.filter(m => m.Type === 'bind').map(m => m.Source);
  } catch {
    return [];
  }
}

/**
 * Report stores the existing container cannot see.
 *
 * This is the whole reason the drift check exists: adding a store is an
 * in-app action with no visible connection to the container's lifetime, so
 * without a nudge here the operator discovers the gap much later, as an
 * inexplicably broken store.
 *
 * @returns true when the container is missing at least one required bind
 */
function reportBindDrift(name: string, plan: StorePlan | null): boolean {
  if (!plan || plan.binds.length === 0) return false;

  const existing = new Set(existingBindSources(name).map(s => s.replace(/\/+$/, '')));
  const missing = plan.binds.filter(b => !existing.has(b.hostPath.replace(/\/+$/, '')));
  if (missing.length === 0) return false;

  console.log('');
  console.log(`${missing.length} document store${missing.length === 1 ? '' : 's'} cannot be reached by this container:`);
  for (const bind of missing) {
    console.log(`  ${bind.stores.join(', ')} — ${bind.hostPath}`);
  }
  console.log('');
  console.log('Bind mounts are fixed when a container is created, so this needs a rebuild:');
  console.log(`  npm run start:docker -- --recreate`);
  return true;
}

// --- Docker helpers ---

function dockerContainerExists(name: string): boolean {
  try {
    const out = execSync(`docker ps -a --format "{{.Names}}"`, { encoding: 'utf-8' });
    return out.split('\n').some(line => line.trim() === name);
  } catch {
    return false;
  }
}

function dockerContainerRunning(name: string): boolean {
  try {
    const out = execSync(`docker ps --format "{{.Names}}"`, { encoding: 'utf-8' });
    return out.split('\n').some(line => line.trim() === name);
  } catch {
    return false;
  }
}

// --- Main ---

const platform = detectPlatform();
const opts = parseArgs(platform);

// An explicit --env always wins; detection only fills the gap.
const tzExplicit = opts.extraEnvs.some(
  e => e.startsWith('QUILLTAP_TIMEZONE=') || e.startsWith('TZ=')
);
const timezone = tzExplicit ? null : detectTimezone();

console.log(`Platform:  ${platform}`);
if (opts.instance) {
  console.log(`Instance:  ${opts.instance}`);
}
console.log(`Data dir:  ${opts.dataDir}`);
console.log(`Port:      ${opts.port}`);
console.log(`Container: ${opts.name}`);
console.log(`Image:     ${IMAGE}:${opts.tag}`);
if (tzExplicit) {
  console.log('Timezone:  (set explicitly via --env)');
} else if (timezone) {
  console.log(`Timezone:  ${timezone} (detected)`);
} else {
  console.log('Timezone:  UTC (could not detect host timezone)');
}
// Filesystem-backed document stores must be bound in at creation time.
const storePlan = opts.storeMounts ? resolveStorePlan(opts) : null;
reportStorePlan(storePlan);

console.log('');

// Create data directory if needed
if (!opts.dryRun) {
  mkdirSync(opts.dataDir, { recursive: true });
}

// Build docker run command
const cmd: string[] = [
  'docker', 'run', '-d',
  '--name', opts.name,
  '--restart', opts.restartPolicy,
  '-p', `${opts.port}:3000`,
  '-v', `${opts.dataDir}:/app/quilltap`,
  ...storeBindArgs(storePlan),
];

// Pass the host-side data directory so the app can display it in the UI
cmd.push('-e', `QUILLTAP_HOST_DATA_DIR=${opts.dataDir}`);

// Linux needs explicit host.docker.internal mapping for localhost URL rewriting
if (platform === 'linux') {
  cmd.push('--add-host=host.docker.internal:host-gateway');
}

// Pass the host timezone through, unless the caller already supplied one
if (timezone) {
  cmd.push('-e', `QUILLTAP_TIMEZONE=${timezone}`);
}

// Extra environment variables
for (const env of opts.extraEnvs) {
  cmd.push('-e', env);
}

// Image
cmd.push(`${IMAGE}:${opts.tag}`);

if (opts.dryRun) {
  console.log('Dry run — would execute:');
  const quoted = cmd.map(a => a.includes(' ') ? `"${a}"` : a);
  console.log(`  ${quoted.join(' ')}`);
  process.exit(0);
}

// Check if container already exists
if (dockerContainerExists(opts.name)) {
  if (opts.recreate) {
    console.log(`Replacing existing container '${opts.name}'...`);
    // `docker rm -f` covers both running and stopped containers in one step.
    // Only the container goes; the data directory and the stores are bind
    // mounts, so nothing the user owns is touched.
    try {
      execSync(`docker rm -f ${opts.name}`, { stdio: 'inherit' });
    } catch {
      console.error(`Failed to remove container '${opts.name}'.`);
      process.exit(1);
    }
  } else {
    console.log(`Container '${opts.name}' already exists.`);
    if (dockerContainerRunning(opts.name)) {
      console.log("It's already running.");
    } else {
      console.log('Starting existing container...');
      execSync(`docker start ${opts.name}`, { stdio: 'inherit' });
    }

    // Existing containers keep the binds they were born with, so a store added
    // since then is invisible until the container is rebuilt. Say so here
    // rather than leaving it to be discovered as a broken store later.
    if (!reportBindDrift(opts.name, storePlan)) {
      console.log(`Use '--recreate' to rebuild the container from scratch.`);
    }
    process.exit(0);
  }
}

console.log('Starting Quilltap...');
try {
  execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
} catch {
  console.error('Failed to start container.');
  process.exit(1);
}

console.log('');
console.log(`Quilltap is running at http://localhost:${opts.port}`);
