/**
 * Plugin Initialization Tests
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  initializePlugins,
  resetPluginSystem,
  isPluginSystemInitialized,
  getPluginSystemState,
} from '@/lib/startup/plugin-initialization';
import { pluginRegistry } from '@/lib/plugins/registry';

// Mock the scanPlugins function
jest.mock('@/lib/plugins/manifest-loader', () => ({
  scanPlugins: jest.fn(async () => ({
    plugins: [
      {
        manifest: {
          name: 'qtap-plugin-test',
          title: 'Test Plugin',
          version: '1.0.0',
          description: 'A test plugin',
          author: 'Test',
          license: 'MIT',
          main: 'index.js',
          compatibility: {
            quilltapVersion: '>=1.7.0',
          },
          capabilities: ['UI_COMPONENTS'],
          sandboxed: true,
        },
        pluginPath: '/test/path',
        manifestPath: '/test/path/manifest.json',
        enabled: true,
        capabilities: ['UI_COMPONENTS'],
        source: 'manual',
      },
    ],
    errors: [],
  })),
  isPluginCompatible: jest.fn(() => true),
  validatePluginSecurity: jest.fn(() => []),
}));

describe('Plugin Initialization', () => {
  beforeEach(() => {
    // Reset plugin system before each test
    resetPluginSystem();
  });

  describe('initializePlugins', () => {
    it('should initialize the plugin system', async () => {
      const result = await initializePlugins();

      expect(result.success).toBe(true);
      expect(result.stats.total).toBeGreaterThan(0);
      expect(isPluginSystemInitialized()).toBe(true);
    });

    it('should be idempotent', async () => {
      const result1 = await initializePlugins();
      const result2 = await initializePlugins();

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.stats).toEqual(result2.stats);
    });

    it('should populate the plugin registry', async () => {
      await initializePlugins();

      const stats = pluginRegistry.getStats();
      expect(stats.initialized).toBe(true);
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('getPluginSystemState', () => {
    it('should return current state', () => {
      const state = getPluginSystemState();

      expect(state).toHaveProperty('initialized');
      expect(state).toHaveProperty('inProgress');
      expect(state).toHaveProperty('registry');
    });

    it('should reflect initialization status', async () => {
      const beforeState = getPluginSystemState();
      expect(beforeState.initialized).toBe(false);

      await initializePlugins();

      const afterState = getPluginSystemState();
      expect(afterState.initialized).toBe(true);
    });
  });

  describe('resetPluginSystem', () => {
    it('should reset initialization state', async () => {
      await initializePlugins();
      expect(isPluginSystemInitialized()).toBe(true);

      resetPluginSystem();
      expect(isPluginSystemInitialized()).toBe(false);
    });

    it('should clear registry', async () => {
      await initializePlugins();
      expect(pluginRegistry.getStats().total).toBeGreaterThan(0);

      resetPluginSystem();
      expect(pluginRegistry.getStats().total).toBe(0);
    });
  });
});
