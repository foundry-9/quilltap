/**
 * esbuild configuration for qtap-plugin-anthropic
 *
 * Bundles the plugin with its SDK dependency into a single CommonJS file.
 * External packages (react, zod, etc.) are provided by the main app at runtime.
 */

import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the project root (3 levels up from plugin directory)
const projectRoot = resolve(__dirname, '..', '..', '..');

// Packages that should NOT be bundled - they're provided by the main app at runtime
const EXTERNAL_PACKAGES = [
  // Quilltap plugin packages — type-only imports stripped at build time.
  // NOTE: @quilltap/plugin-utils is intentionally NOT external here. This
  // plugin is a thin wrapper around plugin-utils' canonical
  // OpenAICompatibleProvider, so leaving it external emitted a bare
  // `require('@quilltap/plugin-utils')` that only resolved by walking up to a
  // host node_modules — the same packaging failure that broke the externally
  // published Mistral plugin. Bundle it like every other distributed plugin.
  '@quilltap/plugin-types',
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

      // Resolve @/ imports to project root
      alias: {
        '@': projectRoot,
      },

      // Don't bundle these - they're available at runtime from the main app
      external: EXTERNAL_PACKAGES,

      // Source maps for debugging (optional, can remove for smaller builds)
      sourcemap: false,

      // Minification (optional, disable for debugging)
      minify: false,

      // Tree shaking
      treeShaking: true,

      // Log level
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
