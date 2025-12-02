/**
 * Plugin Dynamic Route Loading/Unloading Tests
 *
 * Tests the behavior of plugin routes being dynamically loaded when plugins
 * are enabled and unloaded when plugins are disabled.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  pluginRouteRegistry,
  findPluginRoute,
  registerPluginRoutes,
  refreshPluginRoutes,
  getPluginRouteRegistry,
} from '@/lib/plugins/route-loader';
import { pluginRegistry } from '@/lib/plugins/registry';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';

describe('Plugin Dynamic Route Loading/Unloading', () => {
  // Mock plugin with API routes
  const mockPluginWithRoutes: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-dynamic-test',
      title: 'Dynamic Test Plugin',
      version: '1.0.0',
      description: 'Plugin for testing dynamic route loading',
      author: 'Test',
      license: 'MIT',
      main: 'index.js',
      compatibility: {
        quilltapVersion: '>=1.7.0',
      },
      capabilities: ['API_ROUTES'],
      sandboxed: true,
      apiRoutes: [
        {
          path: '/api/dynamic-test/status',
          methods: ['GET'],
          handler: 'routes/status.js',
          requiresAuth: false,
          description: 'Get status',
        },
        {
          path: '/api/dynamic-test/action',
          methods: ['POST', 'PUT'],
          handler: 'routes/action.js',
          requiresAuth: true,
          description: 'Perform action',
        },
      ],
    },
    pluginPath: '/test/dynamic-plugin',
    manifestPath: '/test/dynamic-plugin/manifest.json',
    enabled: true,
    capabilities: ['API_ROUTES'],
    source: 'manual',
  };

  // Another mock plugin with API routes
  const mockPluginWithRoutes2: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-dynamic-test-2',
      title: 'Dynamic Test Plugin 2',
      version: '1.0.0',
      description: 'Second plugin for testing dynamic route loading',
      author: 'Test',
      license: 'MIT',
      main: 'index.js',
      compatibility: {
        quilltapVersion: '>=1.7.0',
      },
      capabilities: ['API_ROUTES'],
      sandboxed: true,
      apiRoutes: [
        {
          path: '/api/dynamic-test-2/info',
          methods: ['GET'],
          handler: 'routes/info.js',
          requiresAuth: false,
          description: 'Get info',
        },
      ],
    },
    pluginPath: '/test/dynamic-plugin-2',
    manifestPath: '/test/dynamic-plugin-2/manifest.json',
    enabled: true,
    capabilities: ['API_ROUTES'],
    source: 'manual',
  };

  beforeEach(async () => {
    // Reset the plugin registry
    pluginRegistry.reset();

    // Clear the plugin route registry
    pluginRouteRegistry.routes.clear();
    pluginRouteRegistry.initialized = false;
    pluginRouteRegistry.skipValidation = true; // Skip file validation in tests

    // Reset enabled state
    mockPluginWithRoutes.enabled = true;
    mockPluginWithRoutes2.enabled = true;

    // Initialize the plugin registry with mock plugins
    await pluginRegistry.initialize({
      plugins: [mockPluginWithRoutes, mockPluginWithRoutes2],
      errors: [],
    });
  });

  describe('Initial Route Loading on Startup', () => {
    it('should load routes from all enabled plugins on initial registration', () => {
      // Register routes (simulating startup)
      registerPluginRoutes();

      // Check that routes are loaded
      const registry = getPluginRouteRegistry();
      expect(registry.initialized).toBe(true);
      expect(registry.totalRoutes).toBe(3); // 2 routes from plugin1 + 1 from plugin2
      expect(registry.uniquePaths).toBe(3);
    });

    it('should make routes immediately available after registration', () => {
      registerPluginRoutes();

      // Test that all routes are findable
      const route1 = findPluginRoute('/api/dynamic-test/status', 'GET');
      expect(route1).not.toBeNull();
      expect(route1?.plugin.manifest.name).toBe('qtap-plugin-dynamic-test');

      const route2 = findPluginRoute('/api/dynamic-test/action', 'POST');
      expect(route2).not.toBeNull();
      expect(route2?.plugin.manifest.name).toBe('qtap-plugin-dynamic-test');

      const route3 = findPluginRoute('/api/dynamic-test-2/info', 'GET');
      expect(route3).not.toBeNull();
      expect(route3?.plugin.manifest.name).toBe('qtap-plugin-dynamic-test-2');
    });

    it('should not load routes from initially disabled plugins', async () => {
      // Disable plugin before registration
      mockPluginWithRoutes.enabled = false;

      // Re-initialize registry with disabled plugin
      await pluginRegistry.initialize({
        plugins: [mockPluginWithRoutes, mockPluginWithRoutes2],
        errors: [],
      });

      registerPluginRoutes();

      // Routes from disabled plugin should not be found
      const route1 = findPluginRoute('/api/dynamic-test/status', 'GET');
      expect(route1).toBeNull();

      // Routes from enabled plugin should still be found
      const route2 = findPluginRoute('/api/dynamic-test-2/info', 'GET');
      expect(route2).not.toBeNull();
    });
  });

  describe('Dynamic Route Loading on Plugin Enable', () => {
    it('should load routes when a disabled plugin is enabled', () => {
      // Start with plugin disabled
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      registerPluginRoutes();

      // Verify routes are not available
      let route = findPluginRoute('/api/dynamic-test/status', 'GET');
      expect(route).toBeNull();

      // Enable the plugin
      const enabled = pluginRegistry.enable('qtap-plugin-dynamic-test');
      expect(enabled).toBe(true);

      // Refresh routes (simulating what the PUT endpoint does)
      refreshPluginRoutes();

      // Verify routes are now available
      route = findPluginRoute('/api/dynamic-test/status', 'GET');
      expect(route).not.toBeNull();
      expect(route?.plugin.manifest.name).toBe('qtap-plugin-dynamic-test');
      expect(route?.plugin.enabled).toBe(true);
    });

    it('should load all routes for a plugin when enabled', () => {
      // Disable plugin
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      registerPluginRoutes();

      const registryBefore = getPluginRouteRegistry();
      expect(registryBefore.totalRoutes).toBe(1); // Only plugin2's route

      // Enable plugin
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      const registryAfter = getPluginRouteRegistry();
      expect(registryAfter.totalRoutes).toBe(3); // All 3 routes now loaded

      // Verify all routes are accessible
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).not.toBeNull();
      expect(findPluginRoute('/api/dynamic-test/action', 'POST')).not.toBeNull();
      expect(findPluginRoute('/api/dynamic-test/action', 'PUT')).not.toBeNull();
    });

    it('should not affect routes from other plugins when enabling one plugin', () => {
      // Disable plugin1, keep plugin2 enabled
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      registerPluginRoutes();

      // Plugin2 route should be available
      expect(findPluginRoute('/api/dynamic-test-2/info', 'GET')).not.toBeNull();

      // Enable plugin1
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      // Both plugins' routes should be available
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).not.toBeNull();
      expect(findPluginRoute('/api/dynamic-test-2/info', 'GET')).not.toBeNull();
    });
  });

  describe('Dynamic Route Unloading on Plugin Disable', () => {
    it('should unload routes when an enabled plugin is disabled', () => {
      // Start with all plugins enabled and routes registered
      registerPluginRoutes();

      // Verify route is available
      let route = findPluginRoute('/api/dynamic-test/status', 'GET');
      expect(route).not.toBeNull();

      // Disable the plugin
      const disabled = pluginRegistry.disable('qtap-plugin-dynamic-test');
      expect(disabled).toBe(true);

      // Refresh routes (simulating what the PUT endpoint does)
      refreshPluginRoutes();

      // Verify route is no longer available
      route = findPluginRoute('/api/dynamic-test/status', 'GET');
      expect(route).toBeNull();
    });

    it('should unload all routes for a plugin when disabled', () => {
      registerPluginRoutes();

      const registryBefore = getPluginRouteRegistry();
      expect(registryBefore.totalRoutes).toBe(3);

      // Disable plugin with 2 routes
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      const registryAfter = getPluginRouteRegistry();
      expect(registryAfter.totalRoutes).toBe(1); // Only plugin2's route remains

      // Verify all routes from disabled plugin are gone
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).toBeNull();
      expect(findPluginRoute('/api/dynamic-test/action', 'POST')).toBeNull();
      expect(findPluginRoute('/api/dynamic-test/action', 'PUT')).toBeNull();

      // Verify other plugin's routes still available
      expect(findPluginRoute('/api/dynamic-test-2/info', 'GET')).not.toBeNull();
    });

    it('should not affect routes from other plugins when disabling one plugin', () => {
      registerPluginRoutes();

      // Disable plugin1
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      // Plugin1 routes should be gone
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).toBeNull();

      // Plugin2 routes should still be available
      const plugin2Route = findPluginRoute('/api/dynamic-test-2/info', 'GET');
      expect(plugin2Route).not.toBeNull();
      expect(plugin2Route?.plugin.manifest.name).toBe('qtap-plugin-dynamic-test-2');
    });
  });

  describe('Multiple Enable/Disable Cycles', () => {
    it('should handle multiple enable/disable cycles correctly', () => {
      registerPluginRoutes();

      // Cycle 1: Disable
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).toBeNull();

      // Cycle 1: Enable
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).not.toBeNull();

      // Cycle 2: Disable
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).toBeNull();

      // Cycle 2: Enable
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).not.toBeNull();

      // Final state should have all routes
      const registry = getPluginRouteRegistry();
      expect(registry.totalRoutes).toBe(3);
    });

    it('should maintain route integrity across multiple plugins toggling', () => {
      registerPluginRoutes();

      // Disable both
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      pluginRegistry.disable('qtap-plugin-dynamic-test-2');
      refreshPluginRoutes();
      expect(getPluginRouteRegistry().totalRoutes).toBe(0);

      // Enable plugin1
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(getPluginRouteRegistry().totalRoutes).toBe(2);
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).not.toBeNull();
      expect(findPluginRoute('/api/dynamic-test-2/info', 'GET')).toBeNull();

      // Enable plugin2
      pluginRegistry.enable('qtap-plugin-dynamic-test-2');
      refreshPluginRoutes();
      expect(getPluginRouteRegistry().totalRoutes).toBe(3);
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).not.toBeNull();
      expect(findPluginRoute('/api/dynamic-test-2/info', 'GET')).not.toBeNull();

      // Disable plugin1
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(getPluginRouteRegistry().totalRoutes).toBe(1);
      expect(findPluginRoute('/api/dynamic-test/status', 'GET')).toBeNull();
      expect(findPluginRoute('/api/dynamic-test-2/info', 'GET')).not.toBeNull();
    });
  });

  describe('Route Registry State Consistency', () => {
    it('should maintain consistent registry state after enable/disable', () => {
      registerPluginRoutes();

      const initialRegistry = getPluginRouteRegistry();
      expect(initialRegistry.initialized).toBe(true);

      // Disable a plugin
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      const afterDisable = getPluginRouteRegistry();
      expect(afterDisable.initialized).toBe(true);
      expect(afterDisable.totalRoutes).toBeLessThan(initialRegistry.totalRoutes);

      // Enable the plugin again
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      const afterEnable = getPluginRouteRegistry();
      expect(afterEnable.initialized).toBe(true);
      expect(afterEnable.totalRoutes).toBe(initialRegistry.totalRoutes);
    });

    it('should update unique paths count correctly', () => {
      registerPluginRoutes();
      expect(getPluginRouteRegistry().uniquePaths).toBe(3);

      // Disable plugin with 2 unique paths
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(getPluginRouteRegistry().uniquePaths).toBe(1);

      // Enable it again
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      expect(getPluginRouteRegistry().uniquePaths).toBe(3);
    });
  });

  describe('HTTP Method Support After Enable/Disable', () => {
    it('should support all declared methods after enabling a plugin', () => {
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      registerPluginRoutes();

      // Enable the plugin
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      // Both POST and PUT should be available for the action route
      const postRoute = findPluginRoute('/api/dynamic-test/action', 'POST');
      expect(postRoute).not.toBeNull();
      expect(postRoute?.route.methods).toContain('POST');
      expect(postRoute?.route.methods).toContain('PUT');

      const putRoute = findPluginRoute('/api/dynamic-test/action', 'PUT');
      expect(putRoute).not.toBeNull();
      expect(putRoute?.route.methods).toContain('POST');
      expect(putRoute?.route.methods).toContain('PUT');
    });

    it('should not find routes with unsupported methods after disable', () => {
      registerPluginRoutes();

      // Verify route exists with POST method
      expect(findPluginRoute('/api/dynamic-test/action', 'POST')).not.toBeNull();

      // Disable plugin
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      // Route should not be found for any method
      expect(findPluginRoute('/api/dynamic-test/action', 'POST')).toBeNull();
      expect(findPluginRoute('/api/dynamic-test/action', 'PUT')).toBeNull();
      expect(findPluginRoute('/api/dynamic-test/action', 'GET')).toBeNull();
    });
  });

  describe('Authentication Requirements After Enable/Disable', () => {
    it('should preserve authentication requirements after enable/disable cycle', () => {
      registerPluginRoutes();

      // Check initial auth requirements
      const routeBefore = findPluginRoute('/api/dynamic-test/action', 'POST');
      expect(routeBefore?.route.requiresAuth).toBe(true);

      // Disable and re-enable
      pluginRegistry.disable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();
      pluginRegistry.enable('qtap-plugin-dynamic-test');
      refreshPluginRoutes();

      // Auth requirements should be preserved
      const routeAfter = findPluginRoute('/api/dynamic-test/action', 'POST');
      expect(routeAfter?.route.requiresAuth).toBe(true);
    });
  });
});
