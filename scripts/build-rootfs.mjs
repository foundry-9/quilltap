#!/usr/bin/env node
/**
 * Build Rootfs Tarball
 *
 * Cross-platform script that builds the Quilltap Docker image and exports
 * it as a rootfs tarball for use in Lima (macOS) or WSL2 (Windows) VMs.
 *
 * Replaces the former build-rootfs.sh script.
 *
 * Plain .mjs on purpose: the release workflow runs this in jobs that never
 * `npm ci` (they only consume pre-built artifacts), so anything needing tsx
 * would have to be fetched from the registry mid-release at an unpinned
 * version. Same reasoning as scripts/build-standalone-overlay.mjs.
 *
 * Usage:
 *   node scripts/build-rootfs.mjs                         # build for host arch
 *   node scripts/build-rootfs.mjs --platform linux/amd64  # build amd64 rootfs
 *   node scripts/build-rootfs.mjs --no-rebuild            # skip build if image exists
 *   node scripts/build-rootfs.mjs --image TAG             # export from existing image
 *   node scripts/build-rootfs.mjs --print-target          # print Dockerfile target, exit
 */

import { execSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SCRIPT_DIR, '..');

const version = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')).version;

/**
 * The platform → Dockerfile-target mapping. This is the ONE place it lives:
 * the release workflow reads it back out with --print-target rather than
 * restating it in its build matrix, because it used to be in both and nothing
 * kept the two honest.
 *
 * amd64 builds the `wsl2` target (Windows/WSL2 needs the baked-in init script);
 * arm64 builds plain `production` for Lima on Apple silicon.
 */
const PLATFORM_TARGETS = {
  'linux/amd64': { archLabel: 'amd64', dockerTarget: 'wsl2' },
  'linux/arm64': { archLabel: 'arm64', dockerTarget: 'production' },
};

// --- Argument parsing ---

function printHelp() {
  console.log(`Usage: node scripts/build-rootfs.mjs [options]

Options:
  --no-rebuild            Skip Docker build if image already exists
  --platform PLAT         Target platform (default: auto-detected from host)
  --image TAG             Export from an existing Docker image instead of building
  --print-target          Print the Dockerfile target for --platform and exit
  -h, --help              Show this help message`);
}

let skipRebuild = false;
let customImage = '';
let printTarget = false;

// Detect default platform from host
let platform = process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';

const args = process.argv.slice(2);
let i = 0;
while (i < args.length) {
  switch (args[i]) {
    case '--no-rebuild':
      skipRebuild = true;
      break;
    case '--platform':
      platform = args[++i];
      break;
    case '--image':
      customImage = args[++i];
      break;
    case '--print-target':
      printTarget = true;
      break;
    case '-h':
    case '--help':
      printHelp();
      process.exit(0);
      break;
    default:
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
  }
  i++;
}

const targetInfo = PLATFORM_TARGETS[platform];
if (!targetInfo) {
  console.error(`Unsupported platform: ${platform}`);
  console.error(`Supported: ${Object.keys(PLATFORM_TARGETS).join(', ')}`);
  process.exit(1);
}
const { archLabel, dockerTarget } = targetInfo;

// Machine-readable query — must print the bare target and nothing else, so the
// workflow can capture it straight into a step output.
if (printTarget) {
  process.stdout.write(dockerTarget + '\n');
  process.exit(0);
}

const imageTag = customImage || `quilltap-rootfs-${archLabel}:${version}`;
const containerName = `quilltap-rootfs-export-${process.pid}`;
const outputFilename = `quilltap-linux-${archLabel}.tar.gz`;
const outputFile = join(PROJECT_ROOT, outputFilename);

// Determine cache directory based on OS
let imagesDir;
if (process.platform === 'darwin') {
  imagesDir = join(homedir(), 'Library', 'Caches', 'Quilltap', 'lima-images');
} else if (process.platform === 'win32') {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  imagesDir = join(localAppData, 'Quilltap', 'vm-images');
} else {
  // Linux / fallback
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  imagesDir = join(cacheHome, 'quilltap', 'vm-images');
}

console.log('==> Building Quilltap rootfs tarball');
console.log(`    Version:  ${version}`);
console.log(`    Platform: ${platform}`);
console.log(`    Target:   ${dockerTarget}`);
console.log(`    Image:    ${imageTag}`);
console.log(`    Output:   ${outputFile}`);
console.log('');

function run(cmd, description) {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

function imageExists(tag) {
  try {
    execSync(`docker image inspect "${tag}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a tar entry (header + data + padding) for a single file.
 * Uses the basic POSIX ustar format.
 */
function createTarEntry(filepath, content) {
  const header = Buffer.alloc(512, 0);

  // Name (0, 100)
  header.write(filepath, 0, 100, 'utf-8');
  // Mode (100, 8) - 0644
  header.write('0000644\0', 100, 8, 'utf-8');
  // UID (108, 8)
  header.write('0000000\0', 108, 8, 'utf-8');
  // GID (116, 8)
  header.write('0000000\0', 116, 8, 'utf-8');
  // Size (124, 12) - octal
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
  // Mtime (136, 12) - current time in octal
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf-8');
  // Typeflag (156, 1) - '0' for regular file
  header.write('0', 156, 1, 'utf-8');
  // Magic (257, 6) - 'ustar\0'
  header.write('ustar\0', 257, 6, 'utf-8');
  // Version (263, 2) - '00'
  header.write('00', 263, 2, 'utf-8');

  // Compute checksum: sum of all bytes in header, treating checksum field as spaces
  // Checksum field (148, 8) - fill with spaces first
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (let j = 0; j < 512; j++) {
    checksum += header[j];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

  // Data padded to 512-byte boundary
  const dataPadding = (512 - (content.length % 512)) % 512;
  const dataBlock = Buffer.alloc(content.length + dataPadding, 0);
  content.copy(dataBlock);

  return Buffer.concat([header, dataBlock]);
}

/**
 * Format bytes into human-readable size string.
 */
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

async function main() {
  // Step 1: Build the Docker image (if needed)
  if (!customImage) {
    if (imageExists(imageTag) && skipRebuild) {
      console.log(`==> Step 1/5: Docker image '${imageTag}' already exists, skipping build (--no-rebuild)`);
    } else {
      run(
        `docker build --platform "${platform}" --target "${dockerTarget}" -t "${imageTag}" "${PROJECT_ROOT}"`,
        'Step 1/5: Building Docker ' + dockerTarget + ' image'
      );
    }
  } else {
    console.log(`==> Step 1/5: Using existing image '${imageTag}'`);
  }

  // Step 2: Create a temporary container (not started)
  console.log('==> Step 2/5: Creating temporary container...');
  const containerId = runCapture(
    `docker create --platform "${platform}" --name "${containerName}" "${imageTag}"`
  );

  // Step 3: Export the filesystem and add VERSION file
  console.log('==> Step 3/5: Exporting filesystem...');

  const rawTarFile = outputFile + '.raw.tar';
  const finalTarFile = outputFile + '.final.tar';

  try {
    // Export container filesystem to a raw tar file (no pipe needed)
    run(
      `docker export -o "${rawTarFile}" "${containerId}"`,
      'Exporting container filesystem'
    );

    // Create VERSION tar entry
    console.log('> Appending VERSION file');
    const versionContent = Buffer.from(version + '\n', 'utf-8');
    const versionEntry = createTarEntry('app/VERSION', versionContent);

    // Combine: original tar (minus end-of-archive marker) + VERSION entry + end-of-archive
    // Tar files end with two 512-byte blocks of zeros. We strip those before appending.
    const rawTarSize = statSync(rawTarFile).size;

    // Find how many trailing zero blocks to strip (at least 2 × 512 = 1024 bytes)
    // We'll read the last few KB and find where the zero padding starts
    const fd = openSync(rawTarFile, 'r');
    const trailSize = Math.min(rawTarSize, 10240); // read last 10KB
    const trailBuf = Buffer.alloc(trailSize);
    readSync(fd, trailBuf, 0, trailSize, rawTarSize - trailSize);
    closeSync(fd);

    // Count trailing zero bytes (must be multiple of 512)
    let zeroBytes = 0;
    for (let j = trailBuf.length - 1; j >= 0; j--) {
      if (trailBuf[j] === 0) {
        zeroBytes++;
      } else {
        break;
      }
    }
    // Round down to 512-byte block boundary
    const zeroBlocks = Math.floor(zeroBytes / 512);
    const bytesToStrip = zeroBlocks * 512;
    const contentSize = rawTarSize - bytesToStrip;

    // Write final tar: content + VERSION entry + end-of-archive (2 × 512 zero blocks)
    const endOfArchive = Buffer.alloc(1024, 0);
    const ws = createWriteStream(finalTarFile);
    const rs = createReadStream(rawTarFile, { start: 0, end: contentSize - 1 });

    await new Promise((resolve, reject) => {
      rs.pipe(ws, { end: false });
      rs.on('end', () => {
        ws.write(versionEntry, (err) => {
          if (err) return reject(err);
          ws.write(endOfArchive, (err2) => {
            if (err2) return reject(err2);
            ws.end(resolve);
          });
        });
      });
      rs.on('error', reject);
      ws.on('error', reject);
    });

    // Gzip the final tar
    console.log('> Compressing tarball');
    await pipeline(
      createReadStream(finalTarFile),
      createGzip({ level: 6 }),
      createWriteStream(outputFile)
    );
  } finally {
    // Clean up temp files
    console.log('> Cleaning up temp files');
    for (const f of [rawTarFile, finalTarFile]) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }

  // Step 4: Copy to cache directory and write build ID sidecar
  console.log('==> Step 4/5: Copying to cache directory...');
  mkdirSync(imagesDir, { recursive: true });
  console.log(`> Copying to cache`);
  copyFileSync(outputFile, join(imagesDir, outputFilename));

  // Write build ID sidecar so Electron can detect tarball updates
  const buildId = `${version}+${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  const buildIdFile = join(imagesDir, `${outputFilename}.build-id`);
  writeFileSync(buildIdFile, buildId + '\n');
  console.log(`    Build ID: ${buildId}`);

  // Step 5: Clean up Docker container
  console.log('==> Step 5/5: Cleaning up...');
  run(`docker rm "${containerId}"`, 'Removing temporary container');

  // Summary
  console.log('');
  console.log('==> Done! Rootfs tarball ready.');
  console.log(`    Local copy: ${outputFile}`);
  console.log(`    Cache:      ${join(imagesDir, outputFilename)}`);
  console.log(`    Build ID:   ${buildIdFile}`);
  try {
    const size = statSync(outputFile).size;
    console.log(`    Size: ${formatSize(size)}`);
  } catch {
    // stat may fail if file was moved
  }
  console.log(`    Version: ${version}`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
