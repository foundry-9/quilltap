/**
 * Plugin Manifest Loader
 *
 * Utilities for loading and validating plugin manifests from the filesystem.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import {
  PluginManifest,
  validatePluginManifest,
  safeValidatePluginManifest,
  functionalityToCapabilities,
  type PluginCapability,
} from '@/lib/schemas/plugin-manifest';
import { isSitePluginEnabled } from './site-plugins';

// ============================================================================
// TYPES
// ============================================================================

export type PluginSource = 'included' | 'npm' | 'git' | 'manual';

export interface LoadedPlugin {
  manifest: PluginManifest;
  pluginPath: string;
  manifestPath: string;
  enabled: boolean;
  capabilities: PluginCapability[];
  source: PluginSource;
}

export interface PluginLoadError {
  pluginName: string;
  pluginPath: string;
  error: string;
  details?: unknown;
}

export interface PluginScanResult {
  plugins: LoadedPlugin[];
  errors: PluginLoadError[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const PLUGINS_DIST_DIR = path.join(process.cwd(), 'plugins', 'dist');
const MANIFEST_FILENAME = 'manifest.json';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Determines the source of a plugin based on its path and package.json
 * @param pluginPath - Path to the plugin directory
 * @returns Plugin source type
 */
async function determinePluginSource(pluginPath: string): Promise<PluginSource> {
  // Check if plugin is in plugins/dist (included with Quilltap)
  if (pluginPath.includes(path.join('plugins', 'dist'))) {
    return 'included';
  }

  // Check for package.json to determine npm vs manual
  try {
    const packageJsonPath = path.join(pluginPath, 'package.json');
    await fs.access(packageJsonPath);

    // Read package.json to check for repository info
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

    // If it has a git repository, it's from git
    if (packageJson.repository) {
      const repoUrl = typeof packageJson.repository === 'string'
        ? packageJson.repository
        : packageJson.repository.url;

      if (repoUrl && (repoUrl.includes('git') || repoUrl.includes('github') || repoUrl.includes('gitlab'))) {
        return 'git';
      }
    }

    // If it has a name starting with qtap-plugin- and version, likely from npm
    if (packageJson.name?.startsWith('qtap-plugin-') && packageJson.version) {
      return 'npm';
    }

    return 'manual';
  } catch {
    // No package.json or can't read it = manual installation
    return 'manual';
  }
}

// ============================================================================
// MANIFEST LOADING
// ============================================================================

/**
 * Loads and validates a plugin manifest from a file
 * @param manifestPath - Path to the manifest.json file
 * @returns Validated manifest or null if invalid
 */
export async function loadPluginManifest(manifestPath: string): Promise<PluginManifest | null> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    return validatePluginManifest(data);
  } catch (error) {
    logger.error('Failed to load plugin manifest:', { manifestPath, error });
    return null;
  }
}

/**
 * Loads a plugin manifest with detailed error information
 * @param manifestPath - Path to the manifest.json file
 * @returns Success or error result
 */
export async function loadPluginManifestSafe(manifestPath: string): Promise<
  | { success: true; manifest: PluginManifest }
  | { success: false; error: string; details?: unknown }
> {
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);

    const result = safeValidatePluginManifest(data);
    if (result.success) {
      return { success: true, manifest: result.data };
    }

    return {
      success: false,
      error: 'Manifest validation failed',
      details: result.errors.issues,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: 'Invalid JSON in manifest file',
        details: error.message,
      };
    }

    return {
      success: false,
      error: 'Failed to read manifest file',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// PLUGIN DISCOVERY
// ============================================================================

/**
 * Checks if a directory is a valid plugin directory
 * @param dirPath - Path to check
 * @returns True if the directory contains a valid plugin
 */
async function isPluginDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) return false;

    const manifestPath = path.join(dirPath, MANIFEST_FILENAME);
    const manifestStat = await fs.stat(manifestPath);
    return manifestStat.isFile();
  } catch {
    return false;
  }
}

/**
 * Scans plugin directories for all installed plugins
 * Searches in both the top-level plugins directory and plugins/dist directory
 * @param pluginsDir - Base plugins directory (defaults to ./plugins)
 * @returns Scan results with loaded plugins and errors
 */
export async function scanPlugins(
  pluginsDir: string = PLUGINS_DIR
): Promise<PluginScanResult> {
  const result: PluginScanResult = {
    plugins: [],
    errors: [],
  };

  // Helper function to scan a single directory
  const scanDirectory = async (dirPath: string) => {
    try {
      // Ensure directory exists
      await fs.mkdir(dirPath, { recursive: true });

      // Read all entries in directory
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      // Process each potential plugin directory
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = path.join(dirPath, entry.name);
        const manifestPath = path.join(pluginPath, MANIFEST_FILENAME);

        // Skip if not a plugin directory
        if (!(await isPluginDirectory(pluginPath))) {
          continue;
        }

        // Load and validate manifest
        const loadResult = await loadPluginManifestSafe(manifestPath);

        if (!loadResult.success) {
          result.errors.push({
            pluginName: entry.name,
            pluginPath,
            error: loadResult.error,
            details: loadResult.details,
          });
          continue;
        }

        const manifest = loadResult.manifest;

        // Check if plugin is enabled by site configuration
        const siteEnabled = isSitePluginEnabled(manifest.name);
        if (!siteEnabled) {
          logger.debug('Plugin disabled by site configuration', {
            context: 'scanPlugins',
            pluginName: manifest.name,
          });
          continue;
        }

        // Get capabilities from manifest
        const capabilities = [...manifest.capabilities];

        // Determine plugin source
        const source = await determinePluginSource(pluginPath);

        result.plugins.push({
          manifest,
          pluginPath,
          manifestPath,
          enabled: manifest.enabledByDefault ?? false,
          capabilities,
          source,
        });
      }
    } catch (error) {
      logger.error('Failed to scan plugins directory:', { dirPath, error });
    }
  };

  // Scan top-level plugins directory
  await scanDirectory(pluginsDir);

  // Also scan plugins/dist directory
  await scanDirectory(PLUGINS_DIST_DIR);

  logger.info('Plugin scan complete', {
    found: result.plugins.length,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Loads a specific plugin by name
 * Searches in both top-level plugins directory and plugins/dist directory
 * @param pluginName - Name of the plugin (directory name)
 * @param pluginsDir - Base plugins directory (defaults to ./plugins)
 * @returns Loaded plugin or null if not found/invalid
 */
export async function loadPlugin(
  pluginName: string,
  pluginsDir: string = PLUGINS_DIR
): Promise<LoadedPlugin | null> {
  // Try loading from top-level plugins directory first
  let pluginPath = path.join(pluginsDir, pluginName);
  let manifestPath = path.join(pluginPath, MANIFEST_FILENAME);

  if (!(await isPluginDirectory(pluginPath))) {
    // Try loading from plugins/dist directory
    pluginPath = path.join(PLUGINS_DIST_DIR, pluginName);
    manifestPath = path.join(pluginPath, MANIFEST_FILENAME);

    if (!(await isPluginDirectory(pluginPath))) {
      logger.warn('Plugin directory not found or invalid:', { pluginName });
      return null;
    }
  }

  const loadResult = await loadPluginManifestSafe(manifestPath);
  if (!loadResult.success) {
    logger.error('Failed to load plugin:', {
      pluginName,
      error: loadResult.error,
      details: loadResult.details,
    });
    return null;
  }

  const manifest = loadResult.manifest;

  // Get capabilities from manifest
  const capabilities = [...manifest.capabilities];

  // Determine plugin source
  const source = await determinePluginSource(pluginPath);

  return {
    manifest,
    pluginPath,
    manifestPath,
    enabled: manifest.enabledByDefault ?? false,
    capabilities,
    source,
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Checks if a plugin meets minimum version requirements
 * @param manifest - Plugin manifest
 * @param quilltapVersion - Current Quilltap version
 * @returns True if compatible
 */
export function isPluginCompatible(
  manifest: PluginManifest,
  quilltapVersion: string
): boolean {
  // Simple semver check - in production, use a proper semver library
  const parseVersion = (v: string): number[] => {
    const match = new RegExp(/(\d+)\.(\d+)\.(\d+)/).exec(v);
    return match ? [Number.parseInt(match[1]), Number.parseInt(match[2]), Number.parseInt(match[3])] : [0, 0, 0];
  };

  const current = parseVersion(quilltapVersion);
  const minMatch = new RegExp(/>=?(.+)/).exec(manifest.compatibility.quilltapVersion);
  const maxMatch = manifest.compatibility.quilltapMaxVersion?.match(/<=?(.+)/);

  if (minMatch) {
    const min = parseVersion(minMatch[1]);
    for (let i = 0; i < 3; i++) {
      if (current[i] < min[i]) return false;
      if (current[i] > min[i]) break;
    }
  }

  if (maxMatch) {
    const max = parseVersion(maxMatch[1]);
    for (let i = 0; i < 3; i++) {
      if (current[i] > max[i]) return false;
      if (current[i] < max[i]) break;
    }
  }

  return true;
}

/**
 * Validates plugin permissions against security policy
 * @param manifest - Plugin manifest
 * @returns Array of security warnings/errors
 */
export function validatePluginSecurity(manifest: PluginManifest): string[] {
  const warnings: string[] = [];

  if (!manifest.sandboxed) {
    warnings.push('Plugin runs without sandboxing - security risk');
  }

  if (manifest.permissions?.userData) {
    warnings.push('Plugin requests access to user data');
  }

  if (manifest.permissions?.database) {
    warnings.push('Plugin requests database access');
  }

  if (manifest.permissions?.network && manifest.permissions.network.length > 0) {
    warnings.push(`Plugin requests network access to: ${manifest.permissions.network.join(', ')}`);
  }

  if (manifest.permissions?.fileSystem && manifest.permissions.fileSystem.length > 0) {
    warnings.push(`Plugin requests file system access to: ${manifest.permissions.fileSystem.join(', ')}`);
  }

  return warnings;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  PLUGINS_DIR,
  PLUGINS_DIST_DIR,
  MANIFEST_FILENAME,
};
