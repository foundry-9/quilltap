#!/usr/bin/env tsx
/**
 * Build Plugins Script
 *
 * Transpiles all TypeScript plugins to JavaScript using the same
 * transpiler that runs at application startup.
 *
 * Usage:
 *   npm run build:plugins
 *   tsx scripts/build-plugins.ts
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { transpileAllPlugins } from '../lib/plugins/plugin-transpiler';
import { logger } from '../lib/logger';

interface PluginManifest {
  name: string;
  main?: string;
  typescript?: boolean;
}

/**
 * Discover all plugins in the plugins/dist directory
 */
function discoverPlugins() {
  const cwd = process.cwd();
  const pluginsDir = join(cwd, 'plugins', 'dist');

  try {
    const entries = readdirSync(pluginsDir);
    const plugins: Array<{
      name: string;
      pluginPath: string;
      main: string;
      typescript: boolean;
    }> = [];

    for (const entry of entries) {
      const fullPath = join(pluginsDir, entry);

      if (!statSync(fullPath).isDirectory()) {
        continue;
      }

      // Check for manifest.json
      const manifestPath = join(fullPath, 'manifest.json');
      try {
        const manifestContent = readFileSync(manifestPath, 'utf-8');
        const manifest: PluginManifest = JSON.parse(manifestContent);

        // Only include TypeScript plugins
        if (manifest.typescript) {
          plugins.push({
            name: manifest.name,
            pluginPath: join('plugins', 'dist', entry),
            main: manifest.main || 'index.js',
            typescript: true,
          });
        }
      } catch (err) {
        logger.warn('Skipping plugin without valid manifest', {
          context: 'build-plugins',
          plugin: entry,
        });
      }
    }

    return plugins;
  } catch (err) {
    logger.error('Failed to discover plugins', {
      context: 'build-plugins',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Main build function
 */
async function main() {
  console.log('🔨 Building TypeScript plugins...\n');

  const plugins = discoverPlugins();

  if (plugins.length === 0) {
    console.log('No TypeScript plugins found to build.');
    return;
  }

  console.log(`Found ${plugins.length} TypeScript plugin(s) to build:\n`);
  for (const plugin of plugins) {
    console.log(`  - ${plugin.name}`);
  }
  console.log('');

  const result = await transpileAllPlugins(plugins);

  console.log('\n📊 Build Summary:');
  console.log(`  Total:    ${result.stats.total}`);
  console.log(`  Compiled: ${result.stats.compiled}`);
  console.log(`  Cached:   ${result.stats.cached}`);
  console.log(`  Failed:   ${result.stats.failed}`);

  if (result.stats.failed > 0) {
    console.error('\n❌ Some plugins failed to build:');
    for (const pluginResult of result.results) {
      if (!pluginResult.success) {
        console.error(`  - ${pluginResult.pluginName}: ${pluginResult.error}`);
      }
    }
    process.exit(1);
  }

  console.log('\n✅ All plugins built successfully!');
}

main().catch((err) => {
  console.error('Fatal error building plugins:', err);
  process.exit(1);
});
