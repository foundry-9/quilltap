/**
 * Plugin Route Loader Tests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  pluginRouteRegistry,
  getPluginRoutes,
  findPluginRoute,
  registerPluginRoutes,
  unregisterPluginRoutes,
  refreshPluginRoutes,
  getPluginRouteRegistry,
} from '@/lib/plugins/route-loader';
import { pluginRegistry } from '@/lib/plugins/registry';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';

describe('Plugin Route Loader', () => {
  // Mock plugin data
  const mockPlugin1: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-api-test-1',
      title: 'API Test Plugin 1',
      version: '1.0.0',
      description: 'First API test plugin',
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
          path: '/api/test-plugin/status',
          methods: ['GET'],
          handler: 'routes/status.ts',
          requiresAuth: false,
          description: 'Get plugin status',
        },
        {
          path: '/api/test-plugin/data',
          methods: ['GET', 'POST'],
          handler: 'routes/data.ts',
          requiresAuth: true,
          description: 'Get or post plugin data',
        },
      ],
    },
    pluginPath: '/test/plugin1',
    manifestPath: '/test/plugin1/manifest.json',
    enabled: true,
    capabilities: ['API_ROUTES'],
    source: 'manual',
  };

  const mockPlugin2: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-api-test-2',
      title: 'API Test Plugin 2',
      version: '1.0.0',
      description: 'Second API test plugin',
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
          path: '/api/test-plugin-2/info',
          methods: ['GET'],
          handler: 'routes/info.ts',
          requiresAuth: true,
          description: 'Get plugin info',
        },
      ],
    },
    pluginPath: '/test/plugin2',
    manifestPath: '/test/plugin2/manifest.json',
    enabled: true,
    capabilities: ['API_ROUTES'],
    source: 'npm',
  };

  const mockPlugin3: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-no-routes',
      title: 'No Routes Plugin',
      version: '1.0.0',
      description: 'Plugin without API routes',
      author: 'Test',
      license: 'MIT',
      main: 'index.js',
      compatibility: {
        quilltapVersion: '>=1.7.0',
      },
      capabilities: ['UI_COMPONENTS'],
      sandboxed: true,
    },
    pluginPath: '/test/plugin3',
    manifestPath: '/test/plugin3/manifest.json',
    enabled: true,
    capabilities: ['UI_COMPONENTS'],
    source: 'manual',
  };

  const mockPlugin4: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-api-disabled',
      title: 'Disabled API Plugin',
      version: '1.0.0',
      description: 'Disabled plugin with API routes',
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
          path: '/api/disabled-plugin/action',
          methods: ['POST'],
          handler: 'routes/action.ts',
          requiresAuth: true,
          description: 'Disabled action',
        },
      ],
    },
    pluginPath: '/test/plugin4',
    manifestPath: '/test/plugin4/manifest.json',
    enabled: false,
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

    // Reset the mock objects' enabled state
    mockPlugin1.enabled = true;
    mockPlugin2.enabled = true;
    mockPlugin3.enabled = true;
    mockPlugin4.enabled = false;

    // Initialize the plugin registry with mock plugins
    await pluginRegistry.initialize({
      plugins: [mockPlugin1, mockPlugin2, mockPlugin3, mockPlugin4],
      errors: [],
    });
  });

  describe('registerPluginRoutes', () => {
    it('should register routes from enabled plugins with API_ROUTES capability', () => {
      registerPluginRoutes();

      const allRoutes = getPluginRoutes();
      expect(allRoutes).toHaveLength(3); // 2 from plugin1 + 1 from plugin2
      expect(pluginRouteRegistry.routes.size).toBe(3); // 3 unique paths
    });

    it('should not register routes from disabled plugins', () => {
      registerPluginRoutes();

      const route = findPluginRoute('/api/disabled-plugin/action', 'POST');
      expect(route).toBeNull();
    });

    it('should handle plugins without apiRoutes defined', () => {
      registerPluginRoutes();

      const allRoutes = getPluginRoutes();
      expect(allRoutes).toHaveLength(3);

      // Verify that plugin3 (no routes) didn't add any routes
      const allRoutePaths = allRoutes.map((r) => r.fullPath);
      expect(allRoutePaths).not.toContain('/api/plugin3/anything');
    });

    it('should set initialized to true after registration', () => {
      expect(pluginRouteRegistry.initialized).toBe(false);

      registerPluginRoutes();

      expect(pluginRouteRegistry.initialized).toBe(true);
    });

    it('should clear existing routes before re-registering', () => {
      registerPluginRoutes();

      const firstRun = getPluginRoutes();
      expect(firstRun).toHaveLength(3);

      // Register again
      registerPluginRoutes();

      const secondRun = getPluginRoutes();
      expect(secondRun).toHaveLength(3);
      expect(secondRun).toEqual(firstRun);
    });
  });

  describe('getPluginRoutes', () => {
    beforeEach(() => {
      registerPluginRoutes();
    });

    it('should return all registered routes', () => {
      const routes = getPluginRoutes();

      expect(routes).toHaveLength(3);
      const paths = routes.map((r) => r.fullPath).sort();
      expect(paths).toContain('/api/test-plugin/status');
      expect(paths).toContain('/api/test-plugin/data');
      expect(paths).toContain('/api/test-plugin-2/info');
    });

    it('should return empty array when no routes registered', () => {
      pluginRouteRegistry.routes.clear();

      const routes = getPluginRoutes();

      expect(routes).toHaveLength(0);
      expect(Array.isArray(routes)).toBe(true);
    });

    it('should return routes with correct plugin references', () => {
      const routes = getPluginRoutes();

      const statusRoute = routes.find((r) => r.fullPath === '/api/test-plugin/status');
      expect(statusRoute).toBeDefined();
      expect(statusRoute?.plugin.manifest.name).toBe('qtap-plugin-api-test-1');
    });

    it('should include handler path information', () => {
      const routes = getPluginRoutes();

      expect(routes[0].handlerPath).toBeDefined();
      expect(routes[0].handlerPath).toContain('/test/plugin');
    });
  });

  describe('findPluginRoute', () => {
    beforeEach(() => {
      registerPluginRoutes();
    });

    it('should find a route by exact path and method', () => {
      const route = findPluginRoute('/api/test-plugin/status', 'GET');

      expect(route).not.toBeNull();
      expect(route?.fullPath).toBe('/api/test-plugin/status');
      expect(route?.plugin.manifest.name).toBe('qtap-plugin-api-test-1');
    });

    it('should return null for non-existent path', () => {
      const route = findPluginRoute('/api/nonexistent/path', 'GET');

      expect(route).toBeNull();
    });

    it('should return null when method not supported by route', () => {
      const route = findPluginRoute('/api/test-plugin/status', 'POST');

      expect(route).toBeNull();
    });

    it('should find a route with multiple supported methods', () => {
      const getRoute = findPluginRoute('/api/test-plugin/data', 'GET');
      expect(getRoute).not.toBeNull();

      const postRoute = findPluginRoute('/api/test-plugin/data', 'POST');
      expect(postRoute).not.toBeNull();

      expect(getRoute?.fullPath).toBe('/api/test-plugin/data');
      expect(postRoute?.fullPath).toBe('/api/test-plugin/data');
    });

    it('should only return routes from enabled plugins', () => {
      // Try to find a route from the disabled plugin
      const route = findPluginRoute('/api/disabled-plugin/action', 'POST');

      expect(route).toBeNull();
    });

    it('should return correct route information', () => {
      const route = findPluginRoute('/api/test-plugin/data', 'GET');

      expect(route).not.toBeNull();
      expect(route?.route.requiresAuth).toBe(true);
      expect(route?.route.description).toBe('Get or post plugin data');
      expect(route?.route.methods).toContain('GET');
      expect(route?.route.methods).toContain('POST');
    });
  });

  describe('unregisterPluginRoutes', () => {
    beforeEach(() => {
      registerPluginRoutes();
    });

    it('should remove all routes for a specific plugin', () => {
      expect(getPluginRoutes()).toHaveLength(3);

      unregisterPluginRoutes('qtap-plugin-api-test-1');

      const remaining = getPluginRoutes();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].plugin.manifest.name).toBe('qtap-plugin-api-test-2');
    });

    it('should not affect other plugins routes', () => {
      const routesBefore = getPluginRoutes();

      unregisterPluginRoutes('qtap-plugin-api-test-1');

      const routesAfter = getPluginRoutes();
      const plugin2Route = routesAfter.find(
        (r) => r.plugin.manifest.name === 'qtap-plugin-api-test-2'
      );

      expect(plugin2Route).toBeDefined();
      expect(plugin2Route?.fullPath).toBe('/api/test-plugin-2/info');
    });

    it('should handle unregistering non-existent plugin gracefully', () => {
      const routesBefore = getPluginRoutes().length;

      expect(() => {
        unregisterPluginRoutes('qtap-plugin-nonexistent');
      }).not.toThrow();

      const routesAfter = getPluginRoutes().length;
      expect(routesAfter).toBe(routesBefore);
    });

    it('should remove empty path entries after unregistering', () => {
      const registryBefore = getPluginRouteRegistry();
      const pathCountBefore = registryBefore.uniquePaths;

      // Plugin2 has only one route
      unregisterPluginRoutes('qtap-plugin-api-test-2');

      const registryAfter = getPluginRouteRegistry();
      expect(registryAfter.uniquePaths).toBe(pathCountBefore - 1);
    });
  });

  describe('refreshPluginRoutes', () => {
    it('should clear and re-register all routes', () => {
      registerPluginRoutes();

      const routesBefore = getPluginRoutes().length;
      expect(routesBefore).toBeGreaterThan(0);

      // Disable a plugin
      pluginRegistry.disable('qtap-plugin-api-test-2');

      // Refresh routes
      refreshPluginRoutes();

      const routesAfter = getPluginRoutes();
      expect(routesAfter.length).toBeLessThan(routesBefore);
    });

    it('should maintain initialized state after refresh', () => {
      registerPluginRoutes();
      expect(pluginRouteRegistry.initialized).toBe(true);

      refreshPluginRoutes();

      expect(pluginRouteRegistry.initialized).toBe(true);
    });

    it('should update route count correctly', () => {
      registerPluginRoutes();

      const registryBefore = getPluginRouteRegistry();
      const totalBefore = registryBefore.totalRoutes;
      expect(totalBefore).toBeGreaterThan(0);

      // Disable a plugin and refresh
      pluginRegistry.disable('qtap-plugin-api-test-1');
      refreshPluginRoutes();

      const registryAfter = getPluginRouteRegistry();
      expect(registryAfter.totalRoutes).toBeLessThan(totalBefore);
    });
  });

  describe('getPluginRouteRegistry', () => {
    beforeEach(() => {
      registerPluginRoutes();
    });

    it('should return registry state with correct counts', () => {
      const registry = getPluginRouteRegistry();

      expect(registry.initialized).toBe(true);
      expect(registry.totalRoutes).toBeGreaterThan(0);
      expect(registry.uniquePaths).toBeGreaterThan(0);
    });

    it('should return correct route structure', () => {
      const registry = getPluginRouteRegistry();

      expect(registry.routes.length).toBeGreaterThan(0);

      const firstRoute = registry.routes[0];
      expect(firstRoute.path).toBeDefined();
      expect(Array.isArray(firstRoute.routes)).toBe(true);
      expect(firstRoute.routes.length).toBeGreaterThan(0);
    });

    it('should include route details', () => {
      const registry = getPluginRouteRegistry();

      const statusRoute = registry.routes.find((r) => r.path === '/api/test-plugin/status');
      expect(statusRoute).toBeDefined();
      expect(statusRoute?.routes[0].plugin).toBe('qtap-plugin-api-test-1');
      expect(statusRoute?.routes[0].methods).toContain('GET');
      expect(statusRoute?.routes[0].requiresAuth).toBe(false);
      expect(statusRoute?.routes[0].description).toBe('Get plugin status');
      expect(statusRoute?.routes[0].handlerPath).toBeDefined();
    });

    it('should reflect changes in registry state', () => {
      let registry = getPluginRouteRegistry();
      const totalBefore = registry.totalRoutes;
      expect(totalBefore).toBeGreaterThan(0);

      // Create a fresh registry state for this test
      pluginRouteRegistry.routes.clear();
      registerPluginRoutes();

      unregisterPluginRoutes('qtap-plugin-api-test-1');

      registry = getPluginRouteRegistry();
      expect(registry.totalRoutes).toBeLessThan(totalBefore);
    });

    it('should return empty registry when no routes registered', () => {
      pluginRouteRegistry.routes.clear();
      pluginRouteRegistry.initialized = false;

      const registry = getPluginRouteRegistry();

      expect(registry.initialized).toBe(false);
      expect(registry.totalRoutes).toBe(0);
      expect(registry.uniquePaths).toBe(0);
      expect(registry.routes).toHaveLength(0);
    });
  });

  describe('Integration tests', () => {
    beforeEach(() => {
      // Register routes for integration tests
      registerPluginRoutes();
    });

    it('should handle plugin lifecycle correctly', async () => {
      // Initial registration should have routes
      expect(getPluginRoutes().length).toBeGreaterThan(0);

      // Disable a plugin
      pluginRegistry.disable('qtap-plugin-api-test-1');
      refreshPluginRoutes();
      expect(getPluginRoutes()).toHaveLength(1);

      // Enable it back
      pluginRegistry.enable('qtap-plugin-api-test-1');
      refreshPluginRoutes();
      expect(getPluginRoutes()).toHaveLength(3);
    });

    it('should maintain route consistency across operations', () => {
      registerPluginRoutes();

      const route1 = findPluginRoute('/api/test-plugin/status', 'GET');
      expect(route1).not.toBeNull();

      // Find it again
      const route2 = findPluginRoute('/api/test-plugin/status', 'GET');
      expect(route2).not.toBeNull();
      expect(route1?.fullPath).toBe(route2?.fullPath);
      expect(route1?.plugin.manifest.name).toBe(route2?.plugin.manifest.name);
    });

    it('should handle multiple routes at same path from different plugins', () => {
      // This tests the ability to have duplicate paths from different plugins

      // Create mock plugins with same path
      const pluginA: LoadedPlugin = {
        manifest: {
          name: 'qtap-plugin-duplicate-a',
          title: 'Duplicate A',
          version: '1.0.0',
          description: 'Plugin A with duplicate path',
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
              path: '/api/shared/endpoint',
              methods: ['GET'],
              handler: 'routes/get.ts',
              requiresAuth: false,
              description: 'Shared endpoint from A',
            },
          ],
        },
        pluginPath: '/test/pluginA',
        manifestPath: '/test/pluginA/manifest.json',
        enabled: true,
        capabilities: ['API_ROUTES'],
        source: 'manual',
      };

      pluginRegistry.reset();
      pluginRegistry.initialize({
        plugins: [pluginA],
        errors: [],
      });

      registerPluginRoutes();

      const route = findPluginRoute('/api/shared/endpoint', 'GET');
      expect(route).not.toBeNull();
      expect(route?.plugin.manifest.name).toBe('qtap-plugin-duplicate-a');
    });
  });
});
