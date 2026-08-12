#!/usr/bin/env node
/**
 * Generates `src/version.generated.ts` from the `version` field in package.json.
 *
 * `PLUGIN_UTILS_VERSION` is a published, runtime-readable compatibility marker,
 * so a hand-edited literal drifts the moment someone bumps package.json without
 * remembering to touch the source too (it sat at 2.2.1 while the package shipped
 * 2.2.18). Generating it removes the chance to forget.
 *
 * Runs from `prebuild` and `pretypecheck`, so both `npm run build` (and therefore
 * `prepublishOnly`) and `npm run typecheck` regenerate before reading the file.
 * The output is committed so a fresh checkout typechecks without a build first.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(packageRoot, 'src', 'version.generated.ts');

const { version } = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8')
);

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json is missing a "version" field');
}

// A literal type (not `string`) so the emitted .d.ts carries the exact version,
// matching what the previous hand-written constant declared.
const contents = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by scripts/generate-version.mjs from the "version" field in
 * package.json. Bump the version there; this file follows automatically on
 * \`npm run build\` / \`npm run typecheck\`.
 */

/**
 * Version of the plugin-utils package.
 * Can be used at runtime to check compatibility.
 */
export const PLUGIN_UTILS_VERSION = '${version}';
`;

// Only write when the content actually changes, so builds and typechecks don't
// churn the file's mtime (and trip watch-mode rebuild loops) on every run.
let current = null;
try {
  current = readFileSync(outputPath, 'utf8');
} catch {
  // First run — the file does not exist yet.
}

if (current !== contents) {
  writeFileSync(outputPath, contents, 'utf8');
  console.log(`Generated src/version.generated.ts (${version})`);
}
