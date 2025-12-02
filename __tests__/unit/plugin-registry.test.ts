/**
 * Plugin Registry Tests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { pluginRegistry } from '@/lib/plugins/registry';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';

describe('Plugin Registry', () => {
  // Mock plugin data
  const mockPlugin1: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-test-1',
      title: 'Test Plugin 1',
      version: '1.0.0',
      description: 'First test plugin',
      author: 'Test',
      license: 'MIT',
      main: 'index.js',
      compatibility: {
        quilltapVersion: '>=1.7.0',
      },
      capabilities: ['LLM_PROVIDER', 'UI_COMPONENTS'],
      sandboxed: true,
    },
    pluginPath: '/test/plugin1',
    manifestPath: '/test/plugin1/manifest.json',
    enabled: true,
    capabilities: ['LLM_PROVIDER', 'UI_COMPONENTS'],
    source: 'manual',
  };

  const mockPlugin2: LoadedPlugin = {
    manifest: {
      name: 'qtap-plugin-test-2',
      title: 'Test Plugin 2',
      version: '2.0.0',
      description: 'Second test plugin',
      author: 'Test',
      license: 'MIT',
      main: 'index.js',
      compatibility: {
        quilltapVersion: '>=1.7.0',
      },
      capabilities: ['THEME'],
      sandboxed: true,
    },
    pluginPath: '/test/plugin2',
    manifestPath: '/test/plugin2/manifest.json',
    enabled: false,
    capabilities: ['THEME'],
    source: 'npm',
  };

  beforeEach(() => {
    // Reset registry before each test
    pluginRegistry.reset();
  });

  describe('initialize', () => {
    it('should initialize with plugins', async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });

      expect(pluginRegistry.isInitialized()).toBe(true);
      expect(pluginRegistry.getAll()).toHaveLength(2);
    });

    it('should index plugins by capability', async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });

      const llmProviders = pluginRegistry.getByCapability('LLM_PROVIDER');
      expect(llmProviders).toHaveLength(1);
      expect(llmProviders[0].manifest.name).toBe('qtap-plugin-test-1');

      const themes = pluginRegistry.getByCapability('THEME');
      expect(themes).toHaveLength(1);
      expect(themes[0].manifest.name).toBe('qtap-plugin-test-2');
    });

    it('should handle errors', async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1],
        errors: [
          {
            pluginName: 'qtap-plugin-broken',
            pluginPath: '/test/broken',
            error: 'Invalid manifest',
          },
        ],
      });

      const errors = pluginRegistry.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].plugin).toBe('qtap-plugin-broken');
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should get plugin by name', () => {
      const plugin = pluginRegistry.get('qtap-plugin-test-1');
      expect(plugin).not.toBeNull();
      expect(plugin?.manifest.title).toBe('Test Plugin 1');
    });

    it('should return null for non-existent plugin', () => {
      const plugin = pluginRegistry.get('qtap-plugin-nonexistent');
      expect(plugin).toBeNull();
    });
  });

  describe('has', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1],
        errors: [],
      });
    });

    it('should return true for existing plugin', () => {
      expect(pluginRegistry.has('qtap-plugin-test-1')).toBe(true);
    });

    it('should return false for non-existent plugin', () => {
      expect(pluginRegistry.has('qtap-plugin-nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should return all plugins', () => {
      const all = pluginRegistry.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('getEnabled', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should return only enabled plugins', () => {
      const enabled = pluginRegistry.getEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].manifest.name).toBe('qtap-plugin-test-1');
    });
  });

  describe('enable/disable', () => {
    beforeEach(async () => {
      pluginRegistry.reset();
      // Reset the mock objects' enabled state
      mockPlugin1.enabled = true;
      mockPlugin2.enabled = false;
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should enable a disabled plugin', () => {
      expect(pluginRegistry.enable('qtap-plugin-test-2')).toBe(true);
      const plugin = pluginRegistry.get('qtap-plugin-test-2');
      expect(plugin?.enabled).toBe(true);
    });

    it('should disable an enabled plugin', () => {
      expect(pluginRegistry.disable('qtap-plugin-test-1')).toBe(true);
      const plugin = pluginRegistry.get('qtap-plugin-test-1');
      expect(plugin?.enabled).toBe(false);
    });

    it('should return false for non-existent plugin', () => {
      expect(pluginRegistry.enable('qtap-plugin-nonexistent')).toBe(false);
      expect(pluginRegistry.disable('qtap-plugin-nonexistent')).toBe(false);
    });
  });

  describe('getByCapability', () => {
    beforeEach(async () => {
      pluginRegistry.reset();
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should get plugins by capability', () => {
      const llmProviders = pluginRegistry.getByCapability('LLM_PROVIDER');
      expect(llmProviders).toHaveLength(1);

      const uiComponents = pluginRegistry.getByCapability('UI_COMPONENTS');
      expect(uiComponents).toHaveLength(1);

      const themes = pluginRegistry.getByCapability('THEME');
      expect(themes).toHaveLength(1);
    });

    it('should return empty array for capability with no plugins', () => {
      const webhooks = pluginRegistry.getByCapability('WEBHOOKS');
      expect(webhooks).toHaveLength(0);
    });
  });

  describe('getEnabledByCapability', () => {
    beforeEach(async () => {
      pluginRegistry.reset();
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should get only enabled plugins by capability', () => {
      const llmProviders = pluginRegistry.getEnabledByCapability('LLM_PROVIDER');
      expect(llmProviders).toHaveLength(1);

      const themes = pluginRegistry.getEnabledByCapability('THEME');
      expect(themes).toHaveLength(0); // plugin2 is disabled
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [{ pluginName: 'broken', pluginPath: '', error: 'test' }],
      });
    });

    it('should return correct statistics', () => {
      const stats = pluginRegistry.getStats();

      expect(stats.total).toBe(2);
      expect(stats.enabled).toBe(1);
      expect(stats.disabled).toBe(1);
      expect(stats.errors).toBe(1);
      expect(stats.initialized).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should return all available capabilities', () => {
      const capabilities = pluginRegistry.getCapabilities();

      expect(capabilities).toContain('LLM_PROVIDER');
      expect(capabilities).toContain('UI_COMPONENTS');
      expect(capabilities).toContain('THEME');
      expect(capabilities.length).toBe(3);
    });
  });

  describe('exportState', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1],
        errors: [],
      });
    });

    it('should export complete state', () => {
      const state = pluginRegistry.exportState();

      expect(state.initialized).toBe(true);
      expect(state.plugins).toHaveLength(1);
      expect(state.plugins[0].name).toBe('qtap-plugin-test-1');
      expect(state.stats).toBeDefined();
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      await pluginRegistry.initialize({
        plugins: [mockPlugin1, mockPlugin2],
        errors: [],
      });
    });

    it('should reset all state', () => {
      pluginRegistry.reset();

      expect(pluginRegistry.isInitialized()).toBe(false);
      expect(pluginRegistry.getAll()).toHaveLength(0);
      expect(pluginRegistry.getErrors()).toHaveLength(0);
    });
  });
});
