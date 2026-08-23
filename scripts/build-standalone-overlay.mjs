#!/usr/bin/env node
// Build-time overlay for the Next.js standalone tree.
//
// Compiles our custom server entry, the dynamically-loaded terminal WS handler,
// and the forked background-job child entry into a target standalone directory,
// then drops the shared bootstrap shim over Next's auto-generated server.js.
//
// Single source of truth for esbuild flags + the child's externals list.
// Used by:
//   - Dockerfile                                    (local docker build)
//   - .github/workflows/release.yml :: build-app    (published images)
//   - scripts/build-standalone-tarball.mjs           (npx quilltap / shell+direct)
//
// Usage: node scripts/build-standalone-overlay.mjs [targetDir]
//   targetDir defaults to <projectRoot>/.next/standalone
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');

const targetArg = process.argv[2];
const TARGET_DIR = targetArg
  ? resolve(targetArg)
  : join(PROJECT_ROOT, '.next', 'standalone');

if (!existsSync(TARGET_DIR)) {
  console.error(`build-standalone-overlay: target directory not found: ${TARGET_DIR}`);
  process.exit(1);
}

// Server-side entries (server.ts, ws.ts) keep --packages=external because Next's
// outputFileTracing copies their imports into <standalone>/node_modules/ already.
const ESBUILD_SERVER = '--bundle --platform=node --target=node24 --format=cjs --packages=external --tsconfig=tsconfig.json';

// Child entry bundles the FULL JS dep graph and externalizes only true natives.
// Next's outputFileTracing only sees what HTTP routes import — anything reachable
// only through the handler graph (yaml via knowledge-injector → markdown-parser,
// for instance) gets webpack-bundled into the route chunks and never copied to
// <standalone>/node_modules/. The npm wrapper only installs natives, so the
// standalone install has no fallback for missing pure-JS deps. Bundling makes the
// child self-contained; the natives below are exactly what the wrapper symlinks.
const ESBUILD_CHILD = '--bundle --platform=node --target=node24 --format=cjs --tsconfig=tsconfig.json';
const CHILD_NATIVE_EXTERNALS = [
  '--external:better-sqlite3',
  '--external:better-sqlite3-multiple-ciphers',
  '--external:sharp',
  '--external:@img/*',
  '--external:node-pty',
  '--external:@napi-rs/canvas',
  '--external:@napi-rs/*',
].join(' ');

function ensureParent(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function run(cmd, label) {
  console.log(`==> ${label}`);
  execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT });
}

const serverImpl = join(TARGET_DIR, 'server-impl.js');
const wsOut = join(TARGET_DIR, 'lib', 'terminal', 'ws.js');
const childOut = join(TARGET_DIR, 'lib', 'background-jobs', 'child', 'child-entry.js');
ensureParent(wsOut);
ensureParent(childOut);

run(
  `npx esbuild server.ts ${ESBUILD_SERVER} --external:./lib/terminal/ws --outfile="${serverImpl}"`,
  'esbuild server.ts -> server-impl.js',
);
run(
  `npx esbuild lib/terminal/ws.ts ${ESBUILD_SERVER} --outfile="${wsOut}"`,
  'esbuild lib/terminal/ws.ts -> lib/terminal/ws.js',
);
run(
  `npx esbuild lib/background-jobs/child/child-entry.ts ${ESBUILD_CHILD} ${CHILD_NATIVE_EXTERNALS} --outfile="${childOut}"`,
  'esbuild lib/background-jobs/child/child-entry.ts -> child-entry.js (bundled, natives external)',
);

// server.js bootstrap shim sets __NEXT_PRIVATE_STANDALONE_CONFIG so Next's
// loadWebpackHook tolerates the pruned standalone tree, then requires
// server-impl.js. Single source at scripts/standalone-server-bootstrap.js.
const bootstrapSrc = join(PROJECT_ROOT, 'scripts', 'standalone-server-bootstrap.js');
const bootstrapDst = join(TARGET_DIR, 'server.js');
copyFileSync(bootstrapSrc, bootstrapDst);
console.log(`==> Copied bootstrap shim -> ${bootstrapDst}`);

console.log('==> Standalone overlay complete');
