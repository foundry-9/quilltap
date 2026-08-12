/**
 * Plugins API v1 - Collection Endpoint
 *
 * GET /api/v1/plugins - List all registered plugins
 * GET /api/v1/plugins?filter=installed - List only installed plugins
 * POST /api/v1/plugins?action=search - Search npm registry for plugins
 * POST /api/v1/plugins?action=install - Install a plugin
 * POST /api/v1/plugins?action=uninstall - Uninstall a plugin
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { pluginRegistry } from '@/lib/plugins/registry';
import { initializePlugins } from '@/lib/startup/plugin-initialization';
import { installPluginFromNpm, uninstallPlugin } from '@/lib/plugins/installer';
import { checkForUpdatesWithMetadata } from '@/lib/plugins/version-checker';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse, created } from '@/lib/api/responses';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';

const PLUGINS_GET_ACTIONS = ['check-upgrades'] as const;
const PLUGINS_POST_ACTIONS = ['search', 'install', 'uninstall'] as const;
type PluginsPostAction = typeof PLUGINS_POST_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

const searchPluginsSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  type: z.enum(['provider', 'theme', 'tool', 'all']).optional().prefault('all'),
});

const installPluginSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
  version: z.string().optional(),
});

const uninstallPluginSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
});

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Check if a package name is a valid Quilltap plugin
 */
function isQuilltapPlugin(name: string): boolean {
  if (name.startsWith('qtap-plugin-')) return true;
  if (name.startsWith('@') && name.includes('/qtap-plugin-')) return true;
  return false;
}

/**
 * Perform npm registry search
 */
async function searchNpm(searchText: string): Promise<any[]> {
  const searchUrl = new URL('https://registry.npmjs.org/-/v1/search');
  searchUrl.searchParams.set('text', searchText);
  searchUrl.searchParams.set('size', '50');

  const response = await fetch(searchUrl.toString(), {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 300 }, // Cache for 5 minutes
  });

  if (!response.ok) {
    logger.warn('[Plugins v1] npm search request failed', {
      searchText,
      status: response.status,
    });
    return [];
  }

  const data = await response.json();
  return data.objects || [];
}

async function handleSearch(req: NextRequest, context: any) {
  const body = await req.json();
  const validatedData = searchPluginsSchema.parse(body);
  // Perform multiple searches to find both scoped and unscoped plugins
  const query = validatedData.query.trim();
  const searchQueries = query
    ? [
        `qtap-plugin-${query}`,
        `@quilltap/ ${query}`,
      ]
    : [
        '@quilltap/',
        'qtap-plugin-',
      ];

  // Run searches in parallel
  const searchPromises = searchQueries.map(q => searchNpm(q));
  const results = await Promise.all(searchPromises);

  // Combine and deduplicate results
  const allObjects = results.flat();
  const seenNames = new Set<string>();
  const uniqueObjects = allObjects.filter(obj => {
    const name = obj.package?.name;
    if (!name || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });

  // Filter to only qtap-plugin-* packages and transform results
  const plugins = uniqueObjects
    .filter((obj: any) => obj.package?.name && isQuilltapPlugin(obj.package.name))
    .map((obj: any) => ({
      name: obj.package.name,
      version: obj.package.version,
      description: obj.package.description || 'No description available',
      author: typeof obj.package.author === 'string'
        ? obj.package.author
        : obj.package.author?.name || obj.package.publisher?.username || 'Unknown',
      keywords: obj.package.keywords || [],
      updated: obj.package.date || '',
      score: obj.score?.final || 0,
      links: obj.package.links,
    }));

  return successResponse({
    results: plugins,
    count: plugins.length,
  });
}

async function handleInstall(req: NextRequest, context: any) {
  const body = await req.json();
  const validatedData = installPluginSchema.parse(body);

  logger.info('[Plugins v1] POST install', {
    userId: context.user.id,
    packageName: validatedData.packageName,
    version: validatedData.version,
  });

  // Call the actual install function
  const result = await installPluginFromNpm(validatedData.packageName);

  if (!result.success) {
    logger.warn('[Plugins v1] Plugin install failed', {
      userId: context.user.id,
      packageName: validatedData.packageName,
      error: result.error,
    });
    return badRequest(result.error || 'Failed to install plugin');
  }

  logger.info('[Plugins v1] Plugin installed successfully', {
    userId: context.user.id,
    packageName: validatedData.packageName,
  });

  // Reinitialize plugin system to reflect changes (force rescan)
  await initializePlugins(true);

  return created({
    success: true,
    message: 'Plugin installed successfully',
    plugin: {
      name: result.manifest?.name,
      version: result.version,
      manifest: result.manifest,
    },
  });
}

async function handleUninstall(req: NextRequest, context: any) {
  const body = await req.json();
  const validatedData = uninstallPluginSchema.parse(body);

  logger.info('[Plugins v1] POST uninstall', {
    userId: context.user.id,
    packageName: validatedData.packageName,
  });

  // Call the actual uninstall function
  const result = await uninstallPlugin(validatedData.packageName);

  if (!result.success) {
    logger.warn('[Plugins v1] Plugin uninstall failed', {
      userId: context.user.id,
      packageName: validatedData.packageName,
      error: result.error,
    });
    return badRequest(result.error || 'Failed to uninstall plugin');
  }

  logger.info('[Plugins v1] Plugin uninstalled successfully', {
    userId: context.user.id,
    packageName: validatedData.packageName,
  });

  // Reinitialize plugin system to reflect changes (force rescan)
  await initializePlugins(true);

  return successResponse({
    success: true,
    message: 'Plugin uninstalled successfully',
  });
}

/**
 * Check for available plugin upgrades with enhanced metadata
 * GET /api/v1/plugins?action=check-upgrades
 */
async function handleCheckUpgrades(context: any) {
  try {
    logger.info('[Plugins v1] GET check-upgrades', {
      userId: context.user.id,
    });

    const upgrades = await checkForUpdatesWithMetadata();

    logger.info('[Plugins v1] Upgrade check complete', {
      userId: context.user.id,
      upgradesAvailable: upgrades.length,
      breakingUpgrades: upgrades.filter(u => !u.isNonBreaking).length,
    });

    return successResponse({
      upgrades,
      lastChecked: new Date().toISOString(),
      count: upgrades.length,
    });
  } catch (error) {
    logger.error(
      '[Plugins v1] Error checking for upgrades',
      { userId: context.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to check for plugin upgrades');
  }
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req: NextRequest, context) => {
  try {
    const action = getActionParam(req);

    // Handle action-based requests
    if (isValidAction(action, PLUGINS_GET_ACTIONS)) {
      return handleCheckUpgrades(context);
    }

    // Ensure plugin system is initialized before accessing registry
    // This handles cases where the API is called before startup initialization completes
    // or when hot-reloading resets module state in development
    if (!pluginRegistry.isInitialized()) {
      await initializePlugins();
    }

    const filter = req.nextUrl.searchParams.get('filter');

    // Get all plugins from registry
    const state = pluginRegistry.exportState();
    const plugins = [...state.plugins];

    // Apply filter
    let filteredPlugins = plugins;
    if (filter === 'installed') {
      filteredPlugins = plugins.filter((p: any) => p.enabled);
    }

    return successResponse({
      plugins: filteredPlugins,
      stats: state.stats,
      errors: state.errors,
      count: filteredPlugins.length,
    });
  } catch (error) {
    logger.error(
      '[Plugins v1] Error listing plugins',
      { userId: context.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch plugins');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createContextHandler(async (req: NextRequest, context) => {
  const action = getActionParam(req);

  if (!isValidAction(action, PLUGINS_POST_ACTIONS)) {
    return badRequest(
      `Unknown action: ${action}. Available actions: ${PLUGINS_POST_ACTIONS.join(', ')}`
    );
  }

  const actionHandlers: Record<PluginsPostAction, () => Promise<NextResponse>> = {
    search: () => handleSearch(req, context),
    install: () => handleInstall(req, context),
    uninstall: () => handleUninstall(req, context),
  };

  return actionHandlers[action]();
});
