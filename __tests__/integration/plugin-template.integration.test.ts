/**
 * Template Plugin Integration Tests
 *
 * Integration tests for the qtap-plugin-template plugin that test the complete
 * lifecycle of enabling/disabling a plugin and verifying its API endpoint
 * availability.
 *
 * Tests:
 * (a) Enable the template plugin
 * (b) Verify that the endpoint it provides works
 * (c) Exercise the functionality of that endpoint (GET and POST)
 * (d) Disable the template plugin
 * (e) Verify that the endpoint no longer works
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import {
  pluginRouteRegistry,
  findPluginRoute,
  registerPluginRoutes,
  refreshPluginRoutes,
  getPluginRouteRegistry,
} from '@/lib/plugins/route-loader';
import { pluginRegistry } from '@/lib/plugins/registry';
import { scanPlugins } from '@/lib/plugins/manifest-loader';
import { logger } from '@/lib/logger';

const TEMPLATE_PLUGIN_NAME = 'qtap-plugin-template';
const TEMPLATE_PLUGIN_API_PATH = '/api/example';

describe('Template Plugin Integration Tests', () => {
  let initialPluginEnabled: boolean;

  beforeAll(async () => {
    // Scan for real plugins in the filesystem
    logger.debug('Scanning for plugins in integration test');
    const scanResult = await scanPlugins();

    // Initialize the plugin registry with real plugins
    await pluginRegistry.initialize(scanResult);

    // Store initial state of the template plugin
    const templatePlugin = pluginRegistry.get(TEMPLATE_PLUGIN_NAME);
    initialPluginEnabled = templatePlugin?.enabled ?? false;

    logger.debug('Integration test setup complete', {
      pluginsFound: scanResult.plugins.length,
      templatePluginFound: !!templatePlugin,
      initialEnabled: initialPluginEnabled,
    });
  });

  afterAll(async () => {
    // Restore the template plugin to its initial state
    if (initialPluginEnabled) {
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
    } else {
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
    }
    refreshPluginRoutes();

    logger.debug('Integration test cleanup complete', {
      restoredTo: initialPluginEnabled,
    });
  });

  beforeEach(() => {
    // Clear route registry before each test
    pluginRouteRegistry.routes.clear();
    pluginRouteRegistry.initialized = false;
    pluginRouteRegistry.skipValidation = false; // Use real file validation
  });

  afterEach(() => {
    // Log state after each test for debugging
    const registry = getPluginRouteRegistry();
    logger.debug('Test completed', {
      totalRoutes: registry.totalRoutes,
      templatePluginEnabled: pluginRegistry.get(TEMPLATE_PLUGIN_NAME)?.enabled,
    });
  });

  describe('Plugin Discovery', () => {
    it('should find the template plugin in the plugins directory', () => {
      const templatePlugin = pluginRegistry.get(TEMPLATE_PLUGIN_NAME);

      expect(templatePlugin).not.toBeNull();
      expect(templatePlugin?.manifest.name).toBe(TEMPLATE_PLUGIN_NAME);
      expect(templatePlugin?.manifest.title).toBe('Quilltap Plugin Template');
      expect(templatePlugin?.manifest.version).toBe('0.1.0');
      expect(templatePlugin?.capabilities).toContain('API_ROUTES');
    });

    it('should have the correct API routes defined in manifest', () => {
      const templatePlugin = pluginRegistry.get(TEMPLATE_PLUGIN_NAME);

      expect(templatePlugin?.manifest.apiRoutes).toBeDefined();
      expect(templatePlugin?.manifest.apiRoutes?.length).toBeGreaterThan(0);

      const exampleRoute = templatePlugin?.manifest.apiRoutes?.find(
        (route) => route.path === TEMPLATE_PLUGIN_API_PATH
      );
      expect(exampleRoute).toBeDefined();
      expect(exampleRoute?.methods).toContain('GET');
      expect(exampleRoute?.methods).toContain('POST');
      expect(exampleRoute?.handler).toBe('exampleHandler.js');
      expect(exampleRoute?.requiresAuth).toBe(true);
    });
  });

  describe('(a) Enable the template plugin', () => {
    it('should be disabled by default (enabledByDefault: false)', () => {
      const templatePlugin = pluginRegistry.get(TEMPLATE_PLUGIN_NAME);
      // Note: The manifest specifies enabledByDefault: false
      expect(templatePlugin?.manifest.enabledByDefault).toBe(false);
    });

    it('should successfully enable the template plugin', () => {
      // Ensure the plugin is disabled first
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);

      // Enable the plugin
      const success = pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      expect(success).toBe(true);

      // Verify it's now enabled
      const templatePlugin = pluginRegistry.get(TEMPLATE_PLUGIN_NAME);
      expect(templatePlugin?.enabled).toBe(true);
    });

    it('should appear in the list of enabled plugins after enabling', () => {
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);

      const enabledPlugins = pluginRegistry.getEnabled();
      const templateInEnabled = enabledPlugins.some(
        (p) => p.manifest.name === TEMPLATE_PLUGIN_NAME
      );
      expect(templateInEnabled).toBe(true);
    });

    it('should appear in enabled plugins with API_ROUTES capability', () => {
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);

      const apiRoutePlugins = pluginRegistry.getEnabledByCapability('API_ROUTES');
      const templateInApiPlugins = apiRoutePlugins.some(
        (p) => p.manifest.name === TEMPLATE_PLUGIN_NAME
      );
      expect(templateInApiPlugins).toBe(true);
    });
  });

  describe('(b) Verify that the endpoint it provides works', () => {
    beforeEach(() => {
      // Enable the plugin and register routes
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      registerPluginRoutes();
    });

    it('should register the /api/example route when plugin is enabled', () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');

      expect(route).not.toBeNull();
      expect(route?.plugin.manifest.name).toBe(TEMPLATE_PLUGIN_NAME);
      expect(route?.route.path).toBe(TEMPLATE_PLUGIN_API_PATH);
    });

    it('should have the route available for GET method', () => {
      const getRoute = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');

      expect(getRoute).not.toBeNull();
      expect(getRoute?.route.methods).toContain('GET');
    });

    it('should have the route available for POST method', () => {
      const postRoute = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'POST');

      expect(postRoute).not.toBeNull();
      expect(postRoute?.route.methods).toContain('POST');
    });

    it('should have the handler file path correctly resolved', () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');

      expect(route?.handlerPath).toBeDefined();
      expect(route?.handlerPath).toContain('exampleHandler.js');
      expect(route?.handlerPath).toContain('qtap-plugin-template');
    });

    it('should correctly specify requiresAuth: true', () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');

      expect(route?.route.requiresAuth).toBe(true);
    });

    it('should include the route in the route registry statistics', () => {
      const registry = getPluginRouteRegistry();

      expect(registry.initialized).toBe(true);
      expect(registry.totalRoutes).toBeGreaterThanOrEqual(1);
      expect(registry.uniquePaths).toBeGreaterThanOrEqual(1);
    });
  });

  describe('(c) Exercise the functionality of that endpoint', () => {
    beforeEach(() => {
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      registerPluginRoutes();
    });

    it('should load the handler module successfully', async () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      expect(route).not.toBeNull();

      // Dynamically import the handler to verify it can be loaded
      const handlerModule = await import(route!.handlerPath);

      expect(handlerModule).toBeDefined();
      expect(typeof handlerModule.GET).toBe('function');
      expect(typeof handlerModule.POST).toBe('function');
    });

    it('should have GET handler that returns 401 without session', async () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      const handlerModule = await import(route!.handlerPath);

      // Create a mock request
      const mockRequest = new Request('http://localhost:3000/api/plugin-routes/example', {
        method: 'GET',
      });

      // Call the handler without a session (context.session is undefined)
      const response = await handlerModule.GET(mockRequest, { session: null });

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('Authentication required');
    });

    it('should have GET handler that returns success with session', async () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      const handlerModule = await import(route!.handlerPath);

      // Create a mock request
      const mockRequest = new Request('http://localhost:3000/api/plugin-routes/example', {
        method: 'GET',
      });

      // Call the handler with a mock session
      const response = await handlerModule.GET(mockRequest, {
        session: { user: { id: 'test-user' } },
        pluginConfig: { exampleSetting: 'test-value' },
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Hello from qtap-plugin-template!');
      expect(body.config).toEqual({ exampleSetting: 'test-value' });
      expect(body.timestamp).toBeDefined();
    });

    it('should have POST handler that processes JSON body', async () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'POST');
      const handlerModule = await import(route!.handlerPath);

      // Create a mock request with JSON body
      const testData = { key: 'value', nested: { data: 123 } };
      const mockRequest = new Request('http://localhost:3000/api/plugin-routes/example', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testData),
      });

      // Call the handler
      const response = await handlerModule.POST(mockRequest, {
        session: { user: { id: 'test-user' } },
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Data received');
      expect(body.receivedData).toEqual(testData);
      expect(body.timestamp).toBeDefined();
    });

    it('should have POST handler that returns 400 for invalid JSON', async () => {
      const route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'POST');
      const handlerModule = await import(route!.handlerPath);

      // Create a mock request with invalid JSON
      const mockRequest = new Request('http://localhost:3000/api/plugin-routes/example', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {{{',
      });

      // Call the handler
      const response = await handlerModule.POST(mockRequest, {
        session: { user: { id: 'test-user' } },
      });

      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid JSON in request body');
    });
  });

  describe('(d) Disable the template plugin', () => {
    beforeEach(() => {
      // Start with the plugin enabled
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      registerPluginRoutes();
    });

    it('should successfully disable the template plugin', () => {
      const success = pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      expect(success).toBe(true);

      const templatePlugin = pluginRegistry.get(TEMPLATE_PLUGIN_NAME);
      expect(templatePlugin?.enabled).toBe(false);
    });

    it('should no longer appear in the list of enabled plugins', () => {
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);

      const enabledPlugins = pluginRegistry.getEnabled();
      const templateInEnabled = enabledPlugins.some(
        (p) => p.manifest.name === TEMPLATE_PLUGIN_NAME
      );
      expect(templateInEnabled).toBe(false);
    });

    it('should no longer appear in enabled API_ROUTES plugins', () => {
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);

      const apiRoutePlugins = pluginRegistry.getEnabledByCapability('API_ROUTES');
      const templateInApiPlugins = apiRoutePlugins.some(
        (p) => p.manifest.name === TEMPLATE_PLUGIN_NAME
      );
      expect(templateInApiPlugins).toBe(false);
    });

    it('should still exist in the all plugins list', () => {
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);

      const allPlugins = pluginRegistry.getAll();
      const templatePlugin = allPlugins.find(
        (p) => p.manifest.name === TEMPLATE_PLUGIN_NAME
      );
      expect(templatePlugin).toBeDefined();
      expect(templatePlugin?.enabled).toBe(false);
    });
  });

  describe('(e) Verify that the endpoint no longer works', () => {
    beforeEach(() => {
      // Start with the plugin enabled and routes registered
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      registerPluginRoutes();
    });

    it('should unregister the route when plugin is disabled', () => {
      // Verify route exists before disabling
      let route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      expect(route).not.toBeNull();

      // Disable the plugin and refresh routes
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();

      // Verify route no longer exists
      route = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      expect(route).toBeNull();
    });

    it('should unregister all methods for the route', () => {
      // Verify routes exist before disabling
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).not.toBeNull();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'POST')).not.toBeNull();

      // Disable the plugin and refresh routes
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();

      // Verify no methods are available
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).toBeNull();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'POST')).toBeNull();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'PUT')).toBeNull();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'DELETE')).toBeNull();
    });

    it('should reduce the route count in registry statistics', () => {
      const registryBefore = getPluginRouteRegistry();
      const routesBefore = registryBefore.totalRoutes;

      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();

      const registryAfter = getPluginRouteRegistry();
      // The route count should decrease (or stay at 0 if no other plugins)
      expect(registryAfter.totalRoutes).toBeLessThan(routesBefore);
    });
  });

  describe('Complete enable/disable lifecycle', () => {
    it('should handle multiple enable/disable cycles correctly', () => {
      // Start fresh
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      registerPluginRoutes();

      // Cycle 1: Enable
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).not.toBeNull();
      expect(pluginRegistry.get(TEMPLATE_PLUGIN_NAME)?.enabled).toBe(true);

      // Cycle 1: Disable
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).toBeNull();
      expect(pluginRegistry.get(TEMPLATE_PLUGIN_NAME)?.enabled).toBe(false);

      // Cycle 2: Enable
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).not.toBeNull();
      expect(pluginRegistry.get(TEMPLATE_PLUGIN_NAME)?.enabled).toBe(true);

      // Cycle 2: Disable
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).toBeNull();
      expect(pluginRegistry.get(TEMPLATE_PLUGIN_NAME)?.enabled).toBe(false);

      // Final enable to verify system is still working
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();
      expect(findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET')).not.toBeNull();
    });

    it('should preserve all route metadata through enable/disable cycles', () => {
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      registerPluginRoutes();

      // Capture route details
      const routeBefore = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      const methodsBefore = routeBefore?.route.methods;
      const requiresAuthBefore = routeBefore?.route.requiresAuth;
      const descriptionBefore = routeBefore?.route.description;

      // Disable and re-enable
      pluginRegistry.disable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();
      pluginRegistry.enable(TEMPLATE_PLUGIN_NAME);
      refreshPluginRoutes();

      // Verify all metadata is preserved
      const routeAfter = findPluginRoute(TEMPLATE_PLUGIN_API_PATH, 'GET');
      expect(routeAfter?.route.methods).toEqual(methodsBefore);
      expect(routeAfter?.route.requiresAuth).toBe(requiresAuthBefore);
      expect(routeAfter?.route.description).toBe(descriptionBefore);
    });
  });
});
