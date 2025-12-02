/**
 * Plugin Route Loader
 *
 * Utilities for loading, managing, and matching plugin API routes.
 * Provides a registry of all available plugin routes and functions
 * to find and invoke them at runtime.
 */

import { logger } from '@/lib/logger';
import { pluginRegistry, getEnabledPluginsByCapability } from './registry';
import type { LoadedPlugin } from './manifest-loader';
import type { APIRoute } from '@/lib/json-store/schemas/plugin-manifest';
import path from 'node:path';
import fs from 'node:fs';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Information about a loaded plugin route
 */
export interface PluginRouteInfo {
  /** The plugin that provides this route */
  plugin: LoadedPlugin;
  /** The route configuration from the plugin manifest */
  route: APIRoute;
  /** The full API path (e.g., /api/plugin/my-route) */
  fullPath: string;
  /** Absolute path to the handler file */
  handlerPath: string;
}

/**
 * Registry for managing plugin routes
 */
export interface PluginRouteRegistry {
  /** Map of path -> routes (multiple plugins could have the same path) */
  routes: Map<string, PluginRouteInfo[]>;
  /** Whether the registry has been initialized */
  initialized: boolean;
  /** Skip handler file validation (for testing) */
  skipValidation: boolean;
}

// ============================================================================
// SINGLETON REGISTRY
// ============================================================================

/**
 * Global plugin route registry instance
 */
const pluginRouteRegistry: PluginRouteRegistry = {
  routes: new Map(),
  initialized: false,
  skipValidation: false,
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Gets all registered plugin routes from enabled plugins with API_ROUTES capability
 * @returns Array of all registered plugin routes
 */
export function getPluginRoutes(): PluginRouteInfo[] {
  const routes: PluginRouteInfo[] = [];

  for (const routeList of pluginRouteRegistry.routes.values()) {
    routes.push(...routeList);
  }

  logger.debug('Retrieved plugin routes', {
    totalRoutes: routes.length,
    uniquePaths: pluginRouteRegistry.routes.size,
  });

  return routes;
}

/**
 * Finds a matching route for a given path and HTTP method
 * @param path - The API path (e.g., /api/plugin/my-route)
 * @param method - The HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @returns The matching route info or null if not found
 */
export function findPluginRoute(path: string, method: string): PluginRouteInfo | null {
  logger.debug('Finding plugin route', { path, method });

  const routeList = pluginRouteRegistry.routes.get(path);
  if (!routeList || routeList.length === 0) {
    logger.debug('No routes found for path', { path });
    return null;
  }

  // Find the first enabled route that supports this method
  const matchedRoute = routeList.find(
    (routeInfo) =>
      routeInfo.plugin.enabled &&
      routeInfo.route.methods.includes(method as APIRoute['methods'][number])
  );

  if (matchedRoute) {
    logger.debug('Found plugin route', {
      path,
      method,
      plugin: matchedRoute.plugin.manifest.name,
      handlerPath: matchedRoute.handlerPath,
    });
    return matchedRoute;
  }

  logger.debug('No enabled route found for method', { path, method });
  return null;
}

/**
 * Validates that a handler file exists at the specified path
 * @param handlerPath - Absolute path to the handler file
 * @returns True if the handler file exists, false otherwise
 */
function validateHandlerExists(handlerPath: string): boolean {
  try {
    // Check for the exact path first
    if (fs.existsSync(handlerPath)) {
      return true;
    }

    // Try common extensions if the path doesn't have one or file not found
    const extensions = ['.ts', '.js', '.mjs', '.cjs'];
    for (const ext of extensions) {
      if (fs.existsSync(handlerPath + ext)) {
        return true;
      }
    }

    // Check if it's a directory with an index file
    for (const ext of extensions) {
      if (fs.existsSync(path.join(handlerPath, `index${ext}`))) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Scans enabled plugins with API_ROUTES capability and registers their routes
 * Should be called after the plugin registry is initialized
 * Gracefully handles missing or invalid handler files by logging errors and continuing
 */
export function registerPluginRoutes(): void {
  logger.info('Registering plugin routes');

  // Clear existing routes
  pluginRouteRegistry.routes.clear();

  // Get all enabled plugins with API_ROUTES capability
  const enabledPlugins = getEnabledPluginsByCapability('API_ROUTES');

  logger.debug('Found plugins with API_ROUTES capability', {
    pluginCount: enabledPlugins.length,
  });

  let totalRoutesRegistered = 0;
  let totalRoutesSkipped = 0;

  for (const plugin of enabledPlugins) {
    const apiRoutes = plugin.manifest.apiRoutes || [];

    logger.debug('Processing plugin routes', {
      plugin: plugin.manifest.name,
      routeCount: apiRoutes.length,
    });

    for (const route of apiRoutes) {
      // Resolve handler path
      const handlerPath = path.join(plugin.pluginPath, route.handler);

      // Validate that handler file exists (skip in test mode)
      if (!pluginRouteRegistry.skipValidation && !validateHandlerExists(handlerPath)) {
        logger.error('Plugin route handler file not found - skipping route', {
          plugin: plugin.manifest.name,
          path: route.path,
          handler: route.handler,
          handlerPath,
          methods: route.methods,
        });
        totalRoutesSkipped++;
        continue;
      }

      logger.debug('Registering route', {
        plugin: plugin.manifest.name,
        path: route.path,
        methods: route.methods,
        handlerPath,
      });

      const routeInfo: PluginRouteInfo = {
        plugin,
        route,
        fullPath: route.path,
        handlerPath,
      };

      // Check for duplicate routes (multiple plugins with same path)
      if (pluginRouteRegistry.routes.has(route.path)) {
        logger.warn('Duplicate plugin route detected', {
          path: route.path,
          existingPlugin: pluginRouteRegistry.routes.get(route.path)?.[0]?.plugin.manifest.name,
          newPlugin: plugin.manifest.name,
        });
      }

      // Store route(s) for this path
      if (!pluginRouteRegistry.routes.has(route.path)) {
        pluginRouteRegistry.routes.set(route.path, []);
      }
      pluginRouteRegistry.routes.get(route.path)!.push(routeInfo);

      totalRoutesRegistered++;
    }
  }

  pluginRouteRegistry.initialized = true;

  logger.info('Plugin routes registered', {
    totalRoutes: totalRoutesRegistered,
    skippedRoutes: totalRoutesSkipped,
    uniquePaths: pluginRouteRegistry.routes.size,
    pluginsProcessed: enabledPlugins.length,
  });

  // Log a summary warning if any routes were skipped
  if (totalRoutesSkipped > 0) {
    logger.warn('Some plugin routes were skipped due to missing handler files', {
      skippedCount: totalRoutesSkipped,
    });
  }
}

/**
 * Removes all routes for a specific plugin
 * @param pluginName - The name of the plugin
 */
export function unregisterPluginRoutes(pluginName: string): void {
  logger.info('Unregistering plugin routes', { plugin: pluginName });

  let routesRemoved = 0;

  for (const [path, routeList] of pluginRouteRegistry.routes.entries()) {
    const beforeLength = routeList.length;

    // Filter out routes from the specified plugin
    const filtered = routeList.filter(
      (routeInfo) => routeInfo.plugin.manifest.name !== pluginName
    );

    if (filtered.length < beforeLength) {
      routesRemoved += beforeLength - filtered.length;

      if (filtered.length === 0) {
        // Remove the path entirely if no routes remain
        pluginRouteRegistry.routes.delete(path);
      } else {
        // Update with filtered routes
        pluginRouteRegistry.routes.set(path, filtered);
      }

      logger.debug('Removed routes for path', {
        path,
        plugin: pluginName,
        count: beforeLength - filtered.length,
      });
    }
  }

  logger.info('Plugin routes unregistered', {
    plugin: pluginName,
    routesRemoved,
  });
}

/**
 * Clears and re-registers all plugin routes
 * Useful for refreshing routes after plugin configuration changes
 */
export function refreshPluginRoutes(): void {
  logger.info('Refreshing plugin routes');

  const oldRouteCount = Array.from(pluginRouteRegistry.routes.values()).reduce(
    (sum, list) => sum + list.length,
    0
  );

  // Clear and re-register
  registerPluginRoutes();

  const newRouteCount = Array.from(pluginRouteRegistry.routes.values()).reduce(
    (sum, list) => sum + list.length,
    0
  );

  logger.info('Plugin routes refreshed', {
    oldRouteCount,
    newRouteCount,
  });
}

/**
 * Gets the current state of the plugin route registry
 * Useful for debugging and admin interfaces
 * @returns Registry state information
 */
export function getPluginRouteRegistry() {
  const routes = Array.from(pluginRouteRegistry.routes.entries()).map(([path, routeList]) => ({
    path,
    routes: routeList.map((routeInfo) => ({
      plugin: routeInfo.plugin.manifest.name,
      methods: routeInfo.route.methods,
      requiresAuth: routeInfo.route.requiresAuth,
      description: routeInfo.route.description,
      handlerPath: routeInfo.handlerPath,
    })),
  }));

  return {
    initialized: pluginRouteRegistry.initialized,
    totalRoutes: Array.from(pluginRouteRegistry.routes.values()).reduce(
      (sum, list) => sum + list.length,
      0
    ),
    uniquePaths: pluginRouteRegistry.routes.size,
    routes,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export { pluginRouteRegistry };
