#!/usr/bin/env node
/**
 * Assert that a Next.js standalone tree is portable across platforms.
 *
 * The whole release pipeline rests on one invariant: `build-app` runs ONCE, on
 * one x86-64 Linux runner, and its output is consumed by every target —
 * Dockerfile.ci copies it into both the amd64 AND arm64 images, and the
 * standalone tarball ships it to macOS, Windows and Linux alike. Per-platform
 * natives are supplied separately (Docker rebuilds them in `deps-prod`; the
 * tarball strips them and the launcher symlinks the user's own in).
 *
 * That invariant is not self-enforcing, and breaking it fails LATE and far from
 * the cause. Bug 90: switching the bundler to Turbopack made `next build` copy
 * externalized packages into `.next/node_modules/<pkg>-<contenthash>/` — a
 * directory NEITHER consumer strips or replaces — so the build host's x86-64
 * `better_sqlite3.node` rode into the arm64 Docker image and into every macOS
 * tarball, shadowing the correct binary. CI went green; the app could not start.
 *
 * So: no native binary may live anywhere under `<standalone>/.next/`. That
 * subtree is bundler-internal. `<standalone>/node_modules/` is exempt — both
 * consumers deliberately handle it (Docker replaces it wholesale, the tarball
 * strips it by name).
 *
 * Usage: node scripts/assert-standalone-portable.mjs [standaloneDir]
 *   standaloneDir defaults to <projectRoot>/.next/standalone
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SCRIPT_DIR, '..');

const targetArg = process.argv[2];
const STANDALONE_DIR = targetArg
  ? resolve(targetArg)
  : join(PROJECT_ROOT, '.next', 'standalone');

if (!existsSync(STANDALONE_DIR)) {
  console.error(`assert-standalone-portable: directory not found: ${STANDALONE_DIR}`);
  process.exit(1);
}

/** Identify a native binary's target from its magic bytes, or null if not one. */
function nativeKind(file) {
  let head;
  try {
    const buf = readFileSync(file);
    if (buf.length < 20) return null;
    head = buf;
  } catch {
    return null;
  }

  // ELF: 0x7F 'E' 'L' 'F', e_machine at 0x12 (little-endian here; these are
  // always LE on the platforms we build for).
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
    const machine = head.readUInt16LE(0x12);
    const arch = machine === 0x3e ? 'x86-64' : machine === 0xb7 ? 'aarch64' : `machine 0x${machine.toString(16)}`;
    return `Linux ELF (${arch})`;
  }
  // Mach-O (32/64, LE/BE) and universal binaries.
  const magic = head.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) {
    return 'Mach-O';
  }
  // PE/COFF ("MZ").
  if (head[0] === 0x4d && head[1] === 0x5a) return 'Windows PE';
  return null;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    // Do not follow symlinks — a link out of the tree is not part of it.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      out.push(full);
    }
  }
  return out;
}

const bundlerDir = join(STANDALONE_DIR, '.next');
const offenders = walk(bundlerDir, []).map((file) => ({
  path: relative(STANDALONE_DIR, file),
  kind: nativeKind(file) || 'unrecognized binary',
  size: statSync(file).size,
}));

if (offenders.length > 0) {
  console.error('');
  console.error('❌ Standalone tree is NOT portable — native binaries found under .next/');
  console.error('');
  for (const o of offenders) {
    console.error(`   ${o.path}`);
    console.error(`      ${o.kind}, ${o.size.toLocaleString()} bytes`);
  }
  console.error('');
  console.error('   This build ran on ONE platform, but its output is shipped to every');
  console.error('   platform: Dockerfile.ci copies it into both the amd64 and arm64 images,');
  console.error('   and the standalone tarball goes to macOS, Windows and Linux.');
  console.error('');
  console.error('   Nothing strips or replaces <standalone>/.next/, so each file above would');
  console.error('   ride to every target and shadow the correct per-platform binary.');
  console.error('');
  console.error('   Most likely cause: the Next build used Turbopack instead of --webpack.');
  console.error('   See docs/developer/bugs/fixed/bug-90-turbopack-smuggles-build-host-natives.md');
  console.error('');
  process.exit(1);
}

console.log(`✅ Standalone tree is portable — no native binaries under .next/ (${STANDALONE_DIR})`);
