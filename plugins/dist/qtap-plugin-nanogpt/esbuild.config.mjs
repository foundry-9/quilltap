/**
 * esbuild configuration for qtap-plugin-nanogpt
 *
 * Bundles the plugin with its SDK dependency into a single CommonJS file.
 * External packages (react, zod, etc.) are provided by the main app at runtime.
 */

import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const projectRoot = resolve(__dirname, '..', '..', '..');

const EXTERNAL_PACKAGES = [
  // React (provided by main app)
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  // Next.js (provided by main app)
  'next',
  'next-auth',
  // Other main app dependencies
  'zod',
  // Node.js built-ins
  'fs',
  'path',
  'crypto',
  'http',
  'https',
  'url',
  'util',
  'stream',
  'events',
  'buffer',
  'querystring',
  'os',
  'child_process',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:http',
  'node:https',
  'node:url',
  'node:util',
  'node:stream',
  'node:events',
  'node:buffer',
  'node:querystring',
  'node:os',
  'node:child_process',
  'node:module',
];

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [resolve(__dirname, 'index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: resolve(__dirname, 'index.js'),

      alias: {
        '@': projectRoot,
      },

      external: EXTERNAL_PACKAGES,

      sourcemap: false,
      minify: false,
      treeShaking: true,
      logLevel: 'info',
    });

    if (result.errors.length > 0) {
      console.error('Build failed with errors:', result.errors);
      process.exit(1);
    }

    console.log('Build completed successfully!');

    if (result.warnings.length > 0) {
      console.warn('Warnings:', result.warnings);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
