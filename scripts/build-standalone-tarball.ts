#!/usr/bin/env tsx
/**
 * Build Quilltap Standalone Tarball
 *
 * Builds the Next.js standalone output and packages it as a tarball
 * for distribution via GitHub Releases. The `quilltap` npm package
 * downloads this tarball on first run.
 *
 * The output is platform-agnostic (pure JavaScript). Native modules
 * (better-sqlite3, sharp) are stripped — they're installed as npm
 * dependencies on the user's machine.
 *
 * Usage:
 *   npx tsx scripts/build-standalone-tarball.ts
 *   npx tsx scripts/build-standalone-tarball.ts --skip-build
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..');
const STAGING_DIR = join(PROJECT_ROOT, '.standalone-staging');
const NEXT_STANDALONE = join(PROJECT_ROOT, '.next', 'standalone');
const NEXT_STATIC = join(PROJECT_ROOT, '.next', 'static');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const PLUGINS_DIST = join(PROJECT_ROOT, 'plugins', 'dist');

const skipBuild = process.argv.includes('--skip-build');

function run(cmd: string, description: string): void {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

function copyDir(src: string, dest: string): void {
  execSync(`cp -R "${src}" "${dest}"`, { stdio: 'ignore' });
}

function dirSize(dir: string): string {
  try {
    return execSync(`du -sh "${dir}" | cut -f1`, { encoding: 'utf-8' }).trim();
  } catch {
    return '?';
  }
}

// Read root version
const rootPackage = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const version: string = rootPackage.version;
const tarballName = `quilltap-standalone-${version}.tar.gz`;
const tarballPath = join(PROJECT_ROOT, tarballName);

console.log('==> Building Quilltap standalone tarball');
console.log(`    Version: ${version}`);
console.log(`    Output:  ${tarballName}`);
console.log('');

// Step 1: Clean staging directory
console.log('==> Step 1/8: Cleaning staging directory');
if (existsSync(STAGING_DIR)) {
  rmSync(STAGING_DIR, { recursive: true, force: true });
}
mkdirSync(STAGING_DIR, { recursive: true });

if (!skipBuild) {
  // Step 2: Build plugins
  console.log('==> Step 2/8: Building plugins');
  run('npm run build:plugins', 'Building plugins');

  // Step 3: Build Next.js standalone
  console.log('==> Step 3/8: Building Next.js (standalone output)');
  run('npx next build', 'Building Next.js');
} else {
  console.log('==> Step 2/8: Skipping plugin build (--skip-build)');
  console.log('==> Step 3/8: Skipping Next.js build (--skip-build)');
}

// Verify standalone output exists
if (!existsSync(NEXT_STANDALONE)) {
  console.error('Error: .next/standalone/ not found. Run without --skip-build first.');
  process.exit(1);
}

// Step 4: Copy standalone output
console.log('==> Step 4/8: Copying .next/standalone/ to staging');
copyDir(`${NEXT_STANDALONE}/.`, STAGING_DIR);

// Step 4.5: Overlay our custom server entry, terminal WS handler, and child
// entry onto the staged standalone tree, then drop the bootstrap shim over
// Next's auto-generated server.js. Single source of truth for esbuild flags
// and the child's externals list lives in scripts/build-standalone-overlay.mjs
// — the same script is invoked from the local Dockerfile and the CI release
// workflow's build-app step, so the three call sites can't drift.
//
// Skip when the staged tree already carries overlay outputs. The CI release
// workflow's build-app step runs the overlay against .next/standalone/ before
// uploading the artifact; the build-standalone job that consumes it never runs
// `npm ci`, so re-running esbuild here would fail to resolve project deps
// (zod, yauzl, @quilltap/*). Local `next build` flows still hit the overlay
// because Next doesn't produce server-impl.js itself.
const overlaySentinel = join(STAGING_DIR, 'server-impl.js');
if (existsSync(overlaySentinel)) {
  console.log('==> Step 5/8: Overlay outputs already present in staged tree (skipping)');
} else {
  console.log('==> Step 5/8: Overlaying custom server entries onto staged standalone tree');
  run(
    `node "${join(PROJECT_ROOT, 'scripts', 'build-standalone-overlay.mjs')}" "${STAGING_DIR}"`,
    'Running build-standalone-overlay.mjs against staging',
  );
}

// Step 6: Copy static assets and public files
console.log('==> Step 6/8: Copying static assets and public files');
const staticDest = join(STAGING_DIR, '.next', 'static');
mkdirSync(staticDest, { recursive: true });
copyDir(`${NEXT_STATIC}/.`, staticDest);

if (existsSync(PUBLIC_DIR)) {
  const publicDest = join(STAGING_DIR, 'public');
  mkdirSync(publicDest, { recursive: true });
  copyDir(`${PUBLIC_DIR}/.`, publicDest);
}

// Step 7: Copy bundled plugins and strip native modules
console.log('==> Step 7/8: Copying plugins and stripping native modules');
if (existsSync(PLUGINS_DIST)) {
  const pluginsDest = join(STAGING_DIR, 'plugins', 'dist');
  mkdirSync(pluginsDest, { recursive: true });
  copyDir(`${PLUGINS_DIST}/.`, pluginsDest);
}

const standaloneNodeModules = join(STAGING_DIR, 'node_modules');
if (existsSync(standaloneNodeModules)) {
  // Remove native-only modules — they'll be resolved from the npm package's node_modules.
  // NOTE: sharp's JS wrapper and its pure-JS dependency @img/colour are kept in the
  // tarball. Only the platform-specific native binaries (@img/sharp-*, @img/sharp-libvips-*)
  // and the platform-specific native module better-sqlite3 are stripped.
  // They're reinstalled on the user's machine via npm install, which compiles them for the target platform.
  //
  // node-pty is intentionally NOT stripped: it ships cross-platform prebuilds
  // (darwin-arm64, darwin-x64, win32-arm64, win32-x64) inside the package, so
  // it can ride along in the tarball and Just Work on every Electron-shell
  // target platform. The Electron shell launches standalone/server.js
  // directly without going through bin/quilltap.js, so it can't rely on the
  // CLI's linkNativeModules step to wire node-pty in. For the npx-quilltap
  // path, linkNativeModules will replace the tarball-shipped copy with a
  // symlink to the npm-installed one (which is rebuilt against the user's
  // Node ABI on Linux where no prebuild exists).
  const nativeModulesToStrip = ['better-sqlite3'];
  for (const mod of nativeModulesToStrip) {
    const modPath = join(standaloneNodeModules, mod);
    if (existsSync(modPath)) {
      rmSync(modPath, { recursive: true, force: true });
      console.log(`    Stripped: ${mod}`);
    }
  }

  // Remove @img/sharp-* platform-specific native packages but keep @img/colour (pure JS).
  // Since sharp 0.35 every native binary lives here — the package itself no longer
  // carries build/ or prebuilds/ directories, and it dropped its install script, so
  // the user's `npm install` restores these purely through optionalDependencies.
  const imgDir = join(standaloneNodeModules, '@img');
  if (existsSync(imgDir)) {
    for (const entry of readdirSync(imgDir)) {
      if (entry.startsWith('sharp-')) {
        const entryPath = join(imgDir, entry);
        rmSync(entryPath, { recursive: true, force: true });
        console.log(`    Stripped: @img/${entry}`);
      }
    }
  }

  // Remove @napi-rs/canvas-* platform-specific native packages but keep the JS
  // wrapper (@napi-rs/canvas) and pure-JS siblings like @napi-rs/wasm-runtime.
  const napiDir = join(standaloneNodeModules, '@napi-rs');
  if (existsSync(napiDir)) {
    for (const entry of readdirSync(napiDir)) {
      if (entry.startsWith('canvas-')) {
        const entryPath = join(napiDir, entry);
        rmSync(entryPath, { recursive: true, force: true });
        console.log(`    Stripped: @napi-rs/${entry}`);
      }
    }
  }

  // Clean up unnecessary files to reduce size
  const cleanDir = (dir: string): void => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.cache') {
          rmSync(fullPath, { recursive: true, force: true });
          continue;
        }
        cleanDir(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.map') || entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) {
          rmSync(fullPath, { force: true });
        }
      }
    }
  };

  cleanDir(standaloneNodeModules);
}

// Step 8: Create tarball
console.log('==> Step 8/8: Creating tarball');
// Remove old tarball if it exists
if (existsSync(tarballPath)) {
  rmSync(tarballPath, { force: true });
}

// Create tarball from staging directory contents (not the directory itself)
run(`tar -czf "${tarballPath}" -C "${STAGING_DIR}" .`, 'Creating tarball');

// Clean up staging
rmSync(STAGING_DIR, { recursive: true, force: true });

// Summary
const tarballSize = (() => {
  try {
    const stat = statSync(tarballPath);
    const mb = stat.size / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  } catch {
    return '?';
  }
})();

console.log('');
console.log('==> Done!');
console.log(`    Tarball: ${tarballName}`);
console.log(`    Size:    ${tarballSize}`);
console.log(`    Version: ${version}`);
console.log('');
console.log('This tarball is uploaded to GitHub Releases and downloaded');
console.log('by the quilltap npm package on first run.');
