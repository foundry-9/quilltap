#!/usr/bin/env tsx
/**
 * Build and Push Docker Images
 *
 * Cross-platform script that builds native and cross-platform Docker images,
 * pushes them to Docker Hub, and creates multi-platform manifests.
 *
 * Replaces the former build-push-docker.sh and build-push-docker.ps1 scripts.
 *
 * Usage:
 *   npm run build:docker
 *   tsx scripts/build-push-docker.ts
 */

import { execSync } from 'child_process';
import { join } from 'path';

const IMAGE = 'foundry9/quilltap';

// Read version from package.json
const packageJson = require(join(__dirname, '..', 'package.json'));
const version: string = packageJson.version;

// Determine branch and channel tag
const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
let channel: string;
if (branch === 'release') {
  channel = 'latest';
} else if (branch === 'main') {
  channel = 'dev';
} else {
  // Use the part after the last slash, or the whole name if no slashes
  const parts = branch.split('/');
  channel = parts[parts.length - 1];
}

// Map Node.js arch to Docker platform
let nativeArch: string;
let foreignArch: string;
if (process.arch === 'x64') {
  nativeArch = 'amd64';
  foreignArch = 'arm64';
} else if (process.arch === 'arm64') {
  nativeArch = 'arm64';
  foreignArch = 'amd64';
} else {
  console.error(`Unknown platform: ${process.arch}`);
  process.exit(1);
}

console.log(`Version: ${version}`);
console.log(`Branch:  ${branch}`);
console.log(`Channel: ${channel}`);
console.log(`Native:  ${nativeArch}`);
console.log(`Foreign: ${foreignArch}`);
console.log('');

function run(cmd: string, description: string): void {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

// Docker login
run('docker login', 'Logging in to Docker Hub');

// Build native image with regular docker (fast)
run(
  `docker build --target production -t ${IMAGE}:${version}-${nativeArch} -t ${IMAGE}:${channel}-${nativeArch} .`,
  `Building native ${nativeArch} image`
);

// Push native tags
run(`docker push ${IMAGE}:${version}-${nativeArch}`, `Pushing ${version}-${nativeArch}`);
run(`docker push ${IMAGE}:${channel}-${nativeArch}`, `Pushing ${channel}-${nativeArch}`);

// Build foreign image with buildx (emulated, slower)
run(
  `docker buildx build --target production --platform linux/${foreignArch} --tag ${IMAGE}:${version}-${foreignArch} --tag ${IMAGE}:${channel}-${foreignArch} --push .`,
  `Building and pushing foreign ${foreignArch} image`
);

// Create multi-platform manifests
run(
  `docker buildx imagetools create --tag ${IMAGE}:${version} ${IMAGE}:${version}-amd64 ${IMAGE}:${version}-arm64`,
  `Creating multi-platform manifest for ${version}`
);
run(
  `docker buildx imagetools create --tag ${IMAGE}:${channel} ${IMAGE}:${channel}-amd64 ${IMAGE}:${channel}-arm64`,
  `Creating multi-platform manifest for ${channel}`
);

// Rebuild better-sqlite3 for the local platform (Docker build compiles for Linux)
console.log('');
run('npm rebuild better-sqlite3', 'Rebuilding better-sqlite3 for local development');

console.log('');
console.log('Done! Pushed:');
console.log(`  ${IMAGE}:${version} (amd64 + arm64)`);
console.log(`  ${IMAGE}:${channel} (amd64 + arm64)`);
