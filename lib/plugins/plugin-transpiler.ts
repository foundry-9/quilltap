/**
 * Plugin Transpiler
 *
 * Transpiles TypeScript plugins to JavaScript at runtime using esbuild CLI.
 * This allows plugins to be written in TypeScript while still being
 * dynamically loadable at runtime.
 *
 * The transpiler:
 * 1. Checks if compiled .js files exist and are up-to-date
 * 2. If not, uses esbuild CLI to bundle the TypeScript files
 * 3. Resolves @/ path aliases to actual file paths
 * 4. Marks external npm packages (SDKs) as external
 * 5. Outputs CommonJS modules that can be require()'d
 *
 * NOTE: We use the esbuild CLI via child_process instead of the esbuild
 * JavaScript API because Next.js/Turbopack cannot bundle esbuild's
 * platform-specific binaries at build time.
 */

import { resolve, dirname, join } from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// External packages that should NOT be bundled (they're available at runtime)
const EXTERNAL_PACKAGES = [
  '@anthropic-ai/sdk',
  'openai',
  '@google/generative-ai',
  'ollama',
  // Core Node.js modules
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

interface TranspileResult {
  success: boolean;
  pluginName: string;
  outputPath?: string;
  error?: string;
  cached: boolean;
}

/**
 * Get the most recent modification time from all TypeScript files in a directory
 */
async function getLatestModTime(dir: string): Promise<number> {
  let latestTime = 0;

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isFile() && entry.name.endsWith('.ts')) {
        const stats = await stat(fullPath);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subDirTime = await getLatestModTime(fullPath);
        if (subDirTime > latestTime) {
          latestTime = subDirTime;
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return latestTime;
}

/**
 * Check if a plugin needs to be recompiled
 * Returns true if:
 * - The output .js file doesn't exist
 * - Any .ts file in the plugin directory is newer than the output
 */
async function needsRecompile(
  pluginDir: string,
  outputFile: string
): Promise<boolean> {
  // If output doesn't exist, definitely need to compile
  if (!existsSync(outputFile)) {
    return true;
  }

  try {
    const outputStats = await stat(outputFile);
    const latestSourceTime = await getLatestModTime(pluginDir);

    // Also check if lib/llm/base.ts or lib/plugins/interfaces have changed
    const cwd = process.cwd();
    const libDirs = [
      join(cwd, 'lib', 'llm'),
      join(cwd, 'lib', 'plugins', 'interfaces'),
      join(cwd, 'lib', 'image-gen'),
      join(cwd, 'lib', 'logger'),
    ];

    let libLatestTime = 0;
    for (const libDir of libDirs) {
      const libTime = await getLatestModTime(libDir);
      if (libTime > libLatestTime) {
        libLatestTime = libTime;
      }
    }

    const combinedSourceTime = Math.max(latestSourceTime, libLatestTime);

    // Need recompile if sources are newer than output
    return combinedSourceTime > outputStats.mtimeMs;
  } catch {
    // If we can't stat the output, recompile
    return true;
  }
}

/**
 * Transpile a single TypeScript plugin to JavaScript using esbuild CLI
 */
export async function transpilePlugin(
  pluginDir: string,
  entryFile: string,
  outputFile: string
): Promise<TranspileResult> {
  const { logger } = await import('@/lib/logger');
  const pluginName = dirname(outputFile).split('/').pop() || 'unknown';

  // Check if we need to recompile
  const needsCompile = await needsRecompile(pluginDir, outputFile);

  if (!needsCompile) {
    logger.debug('Plugin already compiled and up-to-date', {
      context: 'plugin-transpiler',
      plugin: pluginName,
    });
    return {
      success: true,
      pluginName,
      outputPath: outputFile,
      cached: true,
    };
  }

  logger.info('Transpiling plugin', {
    context: 'plugin-transpiler',
    plugin: pluginName,
    entry: entryFile,
    output: outputFile,
  });

  try {
    const cwd = process.cwd();

    // Build external flags for esbuild CLI
    const externalFlags = EXTERNAL_PACKAGES.map(pkg => `--external:${pkg}`).join(' ');

    // Find the esbuild binary in node_modules
    const esbuildBin = join(cwd, 'node_modules', '.bin', 'esbuild');

    // Build the esbuild command
    // We use --alias to resolve @/ paths to the project root
    const command = [
      esbuildBin,
      entryFile,
      '--bundle',
      '--platform=node',
      '--target=node18',
      '--format=cjs',
      `--outfile=${outputFile}`,
      `--alias:@=${cwd}`,
      externalFlags,
    ].join(' ');

    logger.debug('Running esbuild command', {
      context: 'plugin-transpiler',
      plugin: pluginName,
      command: command.substring(0, 200) + '...',
    });

    // Execute esbuild CLI
    execSync(command, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    // Verify output was created
    if (existsSync(outputFile)) {
      const stats = await stat(outputFile);
      logger.info('Plugin transpiled successfully', {
        context: 'plugin-transpiler',
        plugin: pluginName,
        size: stats.size,
      });

      return {
        success: true,
        pluginName,
        outputPath: outputFile,
        cached: false,
      };
    }

    return {
      success: false,
      pluginName,
      error: 'No output generated',
      cached: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to transpile plugin', {
      context: 'plugin-transpiler',
      plugin: pluginName,
      error: errorMessage,
    });

    return {
      success: false,
      pluginName,
      error: errorMessage,
      cached: false,
    };
  }
}

/**
 * Transpile all TypeScript plugins that need compilation
 */
export async function transpileAllPlugins(
  plugins: Array<{
    name: string;
    pluginPath: string;
    main: string;
    typescript: boolean;
  }>
): Promise<{
  success: boolean;
  results: TranspileResult[];
  stats: {
    total: number;
    compiled: number;
    cached: number;
    failed: number;
  };
}> {
  const { logger } = await import('@/lib/logger');
  const startTime = Date.now();
  const results: TranspileResult[] = [];
  let compiled = 0;
  let cached = 0;
  let failed = 0;

  logger.info('Starting plugin transpilation', {
    context: 'plugin-transpiler',
    totalPlugins: plugins.length,
  });

  for (const plugin of plugins) {
    // Skip non-TypeScript plugins
    if (!plugin.typescript) {
      logger.debug('Skipping non-TypeScript plugin', {
        context: 'plugin-transpiler',
        plugin: plugin.name,
      });
      continue;
    }

    const cwd = process.cwd();
    const pluginDir = resolve(cwd, plugin.pluginPath);
    const mainFile = plugin.main || 'index.js';

    // TypeScript source file
    const tsFile = resolve(pluginDir, mainFile.replace(/\.js$/, '.ts'));

    // JavaScript output file
    const jsFile = resolve(pluginDir, mainFile);

    const result = await transpilePlugin(pluginDir, tsFile, jsFile);
    results.push(result);

    if (result.success) {
      if (result.cached) {
        cached++;
      } else {
        compiled++;
      }
    } else {
      failed++;
    }
  }

  const duration = Date.now() - startTime;

  logger.info('Plugin transpilation completed', {
    context: 'plugin-transpiler',
    duration: `${duration}ms`,
    compiled,
    cached,
    failed,
  });

  return {
    success: failed === 0,
    results,
    stats: {
      total: plugins.filter((p) => p.typescript).length,
      compiled,
      cached,
      failed,
    },
  };
}
