/**
 * Theme Registry Client
 *
 * Manages remote theme registries that users can add to discover and install themes.
 * Registry sources are stored in `<base>/themes/sources.json` and registry indexes
 * are cached in `<base>/themes/.cache/<name>.json` with a 1-hour TTL.
 *
 * @module themes/registry-client
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from '@/lib/logger';
import { getThemesDir } from '@/lib/paths';
import { getErrorMessage } from '@/lib/error-utils';
import { parseVersion } from '@/lib/utils/semver';
import { installThemeBundle } from '@/lib/themes/bundle-loader';
import { hashBuffer, verifyRegistryIndex, OFFICIAL_REGISTRY_PUBLIC_KEY, OFFICIAL_REGISTRY_URL } from '@/lib/themes/crypto';
import {
  type RegistrySource,
  type RegistrySources,
  type RegistryIndex,
  type RegistryTheme,
  type ThemeUpdate,
  type ThemeBundleIndex,
  type ThemeBundleIndexEntry,
  RegistrySourcesSchema,
  RegistryIndexSchema,
} from '@/lib/themes/types';

const registryLogger = logger.child({ module: 'theme-registry-client' });

// ============================================================================
// CONSTANTS
// ============================================================================

const SOURCES_FILENAME = 'sources.json';
const CACHE_DIR_NAME = '.cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const INDEX_FILENAME = 'themes-index.json';

// ============================================================================
// PATH HELPERS
// ============================================================================

function getSourcesPath(): string {
  return path.join(getThemesDir(), SOURCES_FILENAME);
}

function getCacheDir(): string {
  return path.join(getThemesDir(), CACHE_DIR_NAME);
}

function getCachePath(sourceName: string): string {
  // Sanitize the source name for use as a filename
  const safeName = sourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getCacheDir(), `${safeName}.json`);
}

function getIndexPath(): string {
  return path.join(getThemesDir(), INDEX_FILENAME);
}

// ============================================================================
// VERSION COMPARISON
// ============================================================================

export { parseVersion };

/**
 * Returns true if versionB is newer than versionA.
 */
export function isNewerVersion(versionA: string, versionB: string): boolean {
  const a = parseVersion(versionA);
  const b = parseVersion(versionB);
  if (!a || !b) return versionA !== versionB;
  if (b.major !== a.major) return b.major > a.major;
  if (b.minor !== a.minor) return b.minor > a.minor;
  return b.patch > a.patch;
}

// ============================================================================
// INDEX FILE HELPERS
// ============================================================================

async function readBundleIndex(): Promise<ThemeBundleIndex> {
  try {
    const data = await fs.readFile(getIndexPath(), 'utf-8');
    return JSON.parse(data) as ThemeBundleIndex;
  } catch {
    return { version: 1, themes: [] };
  }
}

async function writeBundleIndex(index: ThemeBundleIndex): Promise<void> {
  const indexPath = getIndexPath();
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  registryLogger.debug('Bundle index updated', { themeCount: index.themes.length });
}

// ============================================================================
// SOURCE MANAGEMENT
// ============================================================================

/**
 * Load registry sources from sources.json.
 * Bootstraps the official registry if no sources file exists
 * and an official public key is configured.
 */
export async function loadSources(): Promise<RegistrySources> {
  const sourcesPath = getSourcesPath();

  try {
    const data = await fs.readFile(sourcesPath, 'utf-8');
    const parsed = JSON.parse(data);
    const result = RegistrySourcesSchema.safeParse(parsed);
    if (result.success) {
      registryLogger.debug('Loaded registry sources', { count: result.data.sources.length });
      return result.data;
    }
    registryLogger.warn('Invalid sources.json, returning default', {
      errors: result.error.issues.map(e => e.message),
    });
  } catch {
    // File doesn't exist or isn't readable — bootstrap if possible
    registryLogger.debug('No sources.json found, checking for bootstrap');
  }

  // Bootstrap with official registry if public key is available
  const sources: RegistrySources = { version: 1, sources: [] };
  if (OFFICIAL_REGISTRY_PUBLIC_KEY) {
    const officialSource: RegistrySource = {
      name: 'Quilltap Official',
      url: OFFICIAL_REGISTRY_URL,
      enabled: true,
      publicKey: OFFICIAL_REGISTRY_PUBLIC_KEY,
      trusted: true,
      addedAt: new Date().toISOString(),
      lastFetched: null,
    };
    sources.sources.push(officialSource);
    registryLogger.info('Bootstrapped official registry source', { url: OFFICIAL_REGISTRY_URL });

    // Persist the bootstrapped sources
    await saveSources(sources);
  } else {
    registryLogger.debug('Skipping official registry bootstrap: no official public key configured');
  }

  return sources;
}

/**
 * Save registry sources to sources.json.
 */
export async function saveSources(sources: RegistrySources): Promise<void> {
  const sourcesPath = getSourcesPath();
  await fs.mkdir(path.dirname(sourcesPath), { recursive: true });
  await fs.writeFile(sourcesPath, JSON.stringify(sources, null, 2), 'utf-8');
  registryLogger.debug('Saved registry sources', { count: sources.sources.length });
}

/**
 * Add a new registry source.
 * @returns The created RegistrySource entry
 */
export async function addSource(source: { name: string; url: string; publicKey?: string }): Promise<RegistrySource> {
  const sources = await loadSources();

  // Check for duplicate name
  const existing = sources.sources.find(s => s.name === source.name);
  if (existing) {
    throw new Error(`A registry source named "${source.name}" already exists`);
  }

  const newSource: RegistrySource = {
    name: source.name,
    url: source.url,
    enabled: true,
    publicKey: source.publicKey,
    trusted: false,
    addedAt: new Date().toISOString(),
    lastFetched: null,
  };

  sources.sources.push(newSource);
  await saveSources(sources);

  registryLogger.info('Added registry source', { name: source.name, url: source.url });
  return newSource;
}

/**
 * Remove a registry source by name.
 * @returns true if the source was found and removed
 */
export async function removeSource(name: string): Promise<boolean> {
  const sources = await loadSources();
  const initialCount = sources.sources.length;
  sources.sources = sources.sources.filter(s => s.name !== name);

  if (sources.sources.length === initialCount) {
    registryLogger.debug('Registry source not found for removal', { name });
    return false;
  }

  await saveSources(sources);

  // Remove cached index for this source
  const cachePath = getCachePath(name);
  try {
    await fs.unlink(cachePath);
    registryLogger.debug('Removed cached index for source', { name });
  } catch {
    // Cache file may not exist
  }

  registryLogger.info('Removed registry source', { name });
  return true;
}

/**
 * Get all registry sources.
 */
export async function getSources(): Promise<RegistrySource[]> {
  const sources = await loadSources();
  return sources.sources;
}

// ============================================================================
// REGISTRY FETCHING
// ============================================================================

/**
 * Fetch and validate a registry index from a source.
 * Uses cache if available and fresh (within TTL).
 * Verifies Ed25519 signature if the source has a publicKey.
 */
export async function fetchRegistryIndex(
  source: RegistrySource
): Promise<{ index: RegistryIndex; verified: boolean }> {
  const cachePath = getCachePath(source.name);

  // Check cache freshness
  try {
    const stat = await fs.stat(cachePath);
    const age = Date.now() - stat.mtimeMs;
    if (age < CACHE_TTL_MS) {
      const cachedData = await fs.readFile(cachePath, 'utf-8');
      const cachedIndex = JSON.parse(cachedData) as { index: RegistryIndex; verified: boolean };
      registryLogger.debug('Using cached registry index', {
        source: source.name,
        ageMs: age,
      });
      return cachedIndex;
    }
    registryLogger.debug('Cache expired for registry', { source: source.name, ageMs: age });
  } catch {
    registryLogger.debug('No cache found for registry', { source: source.name });
  }

  // Fetch from remote
  registryLogger.info('Fetching registry index', { source: source.name, url: source.url });
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry index: HTTP ${response.status} from ${source.url}`);
  }

  const rawData = await response.json();
  const parseResult = RegistryIndexSchema.safeParse(rawData);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`);
    registryLogger.warn('Invalid registry index data', { source: source.name, errors });
    throw new Error(`Invalid registry index from ${source.name}: ${errors.join('; ')}`);
  }

  const index = parseResult.data;

  // Verify signature if public key is available
  let verified = false;
  if (source.publicKey) {
    verified = verifyRegistryIndex(index, source.publicKey);
    if (!verified) {
      registryLogger.warn('Registry signature verification failed', {
        source: source.name,
        url: source.url,
      });
    } else {
      registryLogger.info('Registry signature verified', { source: source.name });
    }
  }

  // Cache the result
  const cacheData = { index, verified };
  await fs.mkdir(getCacheDir(), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
  registryLogger.debug('Cached registry index', { source: source.name, themeCount: index.themes.length });

  // Update lastFetched on the source
  const sources = await loadSources();
  const sourceEntry = sources.sources.find(s => s.name === source.name);
  if (sourceEntry) {
    sourceEntry.lastFetched = new Date().toISOString();
    await saveSources(sources);
  }

  return { index, verified };
}

/**
 * Refresh all enabled registries and return a combined list of themes.
 */
export async function refreshAllRegistries(): Promise<RegistryTheme[]> {
  const sources = await loadSources();
  const enabledSources = sources.sources.filter(s => s.enabled);
  const allThemes: RegistryTheme[] = [];

  registryLogger.info('Refreshing all registries', { count: enabledSources.length });

  for (const source of enabledSources) {
    try {
      const { index } = await fetchRegistryIndex(source);
      allThemes.push(...index.themes);
      registryLogger.debug('Refreshed registry', {
        source: source.name,
        themeCount: index.themes.length,
      });
    } catch (err) {
      registryLogger.warn('Failed to refresh registry', {
        source: source.name,
        error: getErrorMessage(err),
      });
      // Continue with other registries
    }
  }

  registryLogger.info('Registry refresh complete', { totalThemes: allThemes.length });
  return allThemes;
}

/**
 * Search for themes across all enabled registries' cached indexes.
 * Matches against theme id, name, description, and tags.
 */
export async function searchThemes(
  query: string
): Promise<Array<RegistryTheme & { registryName: string; registryUrl: string; verified: boolean }>> {
  const sources = await loadSources();
  const enabledSources = sources.sources.filter(s => s.enabled);
  const results: Array<RegistryTheme & { registryName: string; registryUrl: string; verified: boolean }> = [];
  const lowerQuery = query.toLowerCase();

  registryLogger.debug('Searching themes across registries', { query, sourceCount: enabledSources.length });

  for (const source of enabledSources) {
    try {
      const { index, verified } = await fetchRegistryIndex(source);

      for (const theme of index.themes) {
        const searchableFields = [
          theme.id,
          theme.name,
          theme.description || '',
          ...(theme.tags || []),
        ];

        const matches = searchableFields.some(field =>
          field.toLowerCase().includes(lowerQuery)
        );

        if (matches) {
          results.push({
            ...theme,
            registryName: source.name,
            registryUrl: source.url,
            verified,
          });
        }
      }
    } catch (err) {
      registryLogger.warn('Failed to search registry', {
        source: source.name,
        error: getErrorMessage(err),
      });
      // Continue with other registries
    }
  }

  registryLogger.debug('Theme search complete', { query, resultCount: results.length });
  return results;
}

// ============================================================================
// INSTALLATION FROM REGISTRY
// ============================================================================

/**
 * Install a theme from a registry by theme ID and registry URL.
 * Downloads the bundle, verifies its SHA-256 hash, installs it,
 * and updates the index with registry metadata.
 */
export async function installFromRegistry(
  themeId: string,
  registryUrl: string
): Promise<{ success: boolean; error?: string; themeId?: string; version?: string }> {
  registryLogger.info('Installing theme from registry', { themeId, registryUrl });

  // Find the registry source
  const sources = await loadSources();
  const source = sources.sources.find(s => s.url === registryUrl);
  if (!source) {
    registryLogger.warn('Registry source not found', { registryUrl });
    return { success: false, error: `Registry source not found for URL: ${registryUrl}` };
  }

  // Fetch or use cached registry index
  let index: RegistryIndex;
  let verified: boolean;
  try {
    const result = await fetchRegistryIndex(source);
    index = result.index;
    verified = result.verified;
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    registryLogger.error('Failed to fetch registry index for install', {
      source: source.name,
      error: errorMsg,
    });
    return { success: false, error: `Failed to fetch registry: ${errorMsg}` };
  }

  // Find the theme in the registry
  const registryTheme = index.themes.find(t => t.id === themeId);
  if (!registryTheme) {
    registryLogger.warn('Theme not found in registry', { themeId, source: source.name });
    return { success: false, error: `Theme "${themeId}" not found in registry "${source.name}"` };
  }

  // Download the bundle to a temp file
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-registry-install-'));
  const tempFile = path.join(tempDir, `${themeId}.qtap-theme`);

  try {
    registryLogger.debug('Downloading theme bundle', {
      themeId,
      url: registryTheme.downloadUrl,
    });

    const response = await fetch(registryTheme.downloadUrl);
    if (!response.ok) {
      return { success: false, error: `Download failed: HTTP ${response.status}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Verify SHA-256 hash
    const actualHash = hashBuffer(buffer);
    if (actualHash !== registryTheme.sha256) {
      registryLogger.error('SHA-256 hash mismatch for downloaded bundle', {
        themeId,
        expected: registryTheme.sha256,
        actual: actualHash,
      });
      return { success: false, error: 'SHA-256 hash verification failed — the downloaded file may be corrupted or tampered with' };
    }
    registryLogger.debug('SHA-256 hash verified', { themeId, hash: actualHash });

    // Write to temp file
    await fs.writeFile(tempFile, buffer);

    // Install via bundle-loader
    const installResult = await installThemeBundle(tempFile);
    if (!installResult.success) {
      return { success: false, error: installResult.error };
    }

    // Update the themes-index.json entry with registry metadata
    const bundleIndex = await readBundleIndex();
    const entry = bundleIndex.themes.find(t => t.id === installResult.themeId);
    if (entry) {
      entry.source = 'registry';
      entry.registrySource = source.name;
      entry.signatureVerified = verified;
      await writeBundleIndex(bundleIndex);
    }

    registryLogger.info('Theme installed from registry', {
      themeId: installResult.themeId,
      version: installResult.version,
      registry: source.name,
      verified,
    });

    return {
      success: true,
      themeId: installResult.themeId,
      version: installResult.version,
    };
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    registryLogger.error('Failed to install theme from registry', {
      themeId,
      registry: source.name,
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// ============================================================================
// UPDATE CHECKING
// ============================================================================

/**
 * Check installed bundle themes against registry entries for available updates.
 * Only checks themes that were originally installed from a registry.
 */
export async function checkForUpdates(): Promise<ThemeUpdate[]> {
  registryLogger.info('Checking for theme updates');

  const bundleIndex = await readBundleIndex();
  const registryThemes = bundleIndex.themes.filter(t => t.source === 'registry');

  if (registryThemes.length === 0) {
    registryLogger.debug('No registry-installed themes to check for updates');
    return [];
  }

  // Build a map of all themes from enabled registries
  const sources = await loadSources();
  const enabledSources = sources.sources.filter(s => s.enabled);
  const registryThemeMap = new Map<string, { theme: RegistryTheme; sourceName: string; sourceUrl: string }>();

  for (const source of enabledSources) {
    try {
      const { index } = await fetchRegistryIndex(source);
      for (const theme of index.themes) {
        // Prefer the theme entry from the source it was originally installed from
        const existing = registryThemeMap.get(theme.id);
        if (!existing) {
          registryThemeMap.set(theme.id, {
            theme,
            sourceName: source.name,
            sourceUrl: source.url,
          });
        }
      }
    } catch (err) {
      registryLogger.warn('Failed to fetch registry for update check', {
        source: source.name,
        error: getErrorMessage(err),
      });
    }
  }

  // Compare installed versions against registry
  const updates: ThemeUpdate[] = [];

  for (const installed of registryThemes) {
    const registryEntry = registryThemeMap.get(installed.id);
    if (!registryEntry) {
      registryLogger.debug('Installed theme not found in any registry', { themeId: installed.id });
      continue;
    }

    if (isNewerVersion(installed.version, registryEntry.theme.version)) {
      updates.push({
        themeId: installed.id,
        currentVersion: installed.version,
        availableVersion: registryEntry.theme.version,
        registryName: registryEntry.sourceName,
        registryUrl: registryEntry.sourceUrl,
        downloadUrl: registryEntry.theme.downloadUrl,
        sha256: registryEntry.theme.sha256,
      });

      registryLogger.info('Update available for theme', {
        themeId: installed.id,
        currentVersion: installed.version,
        availableVersion: registryEntry.theme.version,
        registry: registryEntry.sourceName,
      });
    }
  }

  registryLogger.info('Update check complete', {
    checkedCount: registryThemes.length,
    updatesAvailable: updates.length,
  });

  return updates;
}
