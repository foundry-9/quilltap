/**
 * Plugin Registry
 *
 * Singleton registry for managing loaded plugins.
 * Provides centralized access to plugin information and capabilities.
 */

import { logger } from '@/lib/logger';
import type { LoadedPlugin, PluginScanResult } from './manifest-loader';
import type { PluginCapability } from './index';

// ============================================================================
// TYPES
// ============================================================================

export interface PluginRegistryState {
  initialized: boolean;
  plugins: Map<string, LoadedPlugin>;
  errors: Map<string, string>;
  capabilities: Map<PluginCapability, string[]>;
  lastScanTime: Date | null;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class PluginRegistry {
  private state: PluginRegistryState = {
    initialized: false,
    plugins: new Map(),
    errors: new Map(),
    capabilities: new Map(),
    lastScanTime: null,
  };

  /**
   * Initialize the registry with scanned plugins
   */
  async initialize(scanResult: PluginScanResult): Promise<void> {
    logger.info('Initializing plugin registry', {
      pluginCount: scanResult.plugins.length,
      errorCount: scanResult.errors.length,
    });

    // Clear existing state
    this.state.plugins.clear();
    this.state.errors.clear();
    this.state.capabilities.clear();

    // Register plugins
    for (const plugin of scanResult.plugins) {
      this.registerPlugin(plugin);
    }

    // Store errors
    for (const error of scanResult.errors) {
      this.state.errors.set(error.pluginName, error.error);
    }

    this.state.initialized = true;
    this.state.lastScanTime = new Date();

    logger.info('Plugin registry initialized', {
      registered: this.state.plugins.size,
      errors: this.state.errors.size,
    });
  }

  /**
   * Register a single plugin
   */
  private registerPlugin(plugin: LoadedPlugin): void {
    const pluginName = plugin.manifest.name;

    // Store plugin
    this.state.plugins.set(pluginName, plugin);

    // Index by capabilities
    for (const capability of plugin.capabilities) {
      if (!this.state.capabilities.has(capability)) {
        this.state.capabilities.set(capability, []);
      }
      this.state.capabilities.get(capability)!.push(pluginName);
    }

    logger.debug('Plugin registered', {
      name: pluginName,
      version: plugin.manifest.version,
      capabilities: plugin.capabilities,
    });
  }

  /**
   * Get all registered plugins
   */
  getAll(): LoadedPlugin[] {
    return Array.from(this.state.plugins.values());
  }

  /**
   * Get enabled plugins only
   */
  getEnabled(): LoadedPlugin[] {
    return this.getAll().filter(p => p.enabled);
  }

  /**
   * Get a specific plugin by name
   */
  get(name: string): LoadedPlugin | null {
    return this.state.plugins.get(name) || null;
  }

  /**
   * Get plugins by capability
   */
  getByCapability(capability: PluginCapability): LoadedPlugin[] {
    const names = this.state.capabilities.get(capability) || [];
    return names
      .map(name => this.state.plugins.get(name))
      .filter((p): p is LoadedPlugin => p !== undefined);
  }

  /**
   * Get enabled plugins by capability
   */
  getEnabledByCapability(capability: PluginCapability): LoadedPlugin[] {
    return this.getByCapability(capability).filter(p => p.enabled);
  }

  /**
   * Check if a plugin is registered
   */
  has(name: string): boolean {
    return this.state.plugins.has(name);
  }

  /**
   * Enable a plugin
   */
  enable(name: string): boolean {
    const plugin = this.state.plugins.get(name);
    if (!plugin) {
      logger.warn('Cannot enable plugin: not found', { name });
      return false;
    }

    plugin.enabled = true;
    logger.info('Plugin enabled', { name });
    return true;
  }

  /**
   * Disable a plugin
   */
  disable(name: string): boolean {
    const plugin = this.state.plugins.get(name);
    if (!plugin) {
      logger.warn('Cannot disable plugin: not found', { name });
      return false;
    }

    plugin.enabled = false;
    logger.info('Plugin disabled', { name });
    return true;
  }

  /**
   * Get all available capabilities
   */
  getCapabilities(): PluginCapability[] {
    return Array.from(this.state.capabilities.keys());
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const all = this.getAll();
    const enabled = this.getEnabled();

    return {
      total: all.length,
      enabled: enabled.length,
      disabled: all.length - enabled.length,
      errors: this.state.errors.size,
      capabilities: this.state.capabilities.size,
      initialized: this.state.initialized,
      lastScan: this.state.lastScanTime?.toISOString() || null,
    };
  }

  /**
   * Get all errors
   */
  getErrors(): Array<{ plugin: string; error: string }> {
    return Array.from(this.state.errors.entries()).map(([plugin, error]) => ({
      plugin,
      error,
    }));
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Reset the registry (for testing)
   */
  reset(): void {
    this.state.initialized = false;
    this.state.plugins.clear();
    this.state.errors.clear();
    this.state.capabilities.clear();
    this.state.lastScanTime = null;
    logger.debug('Plugin registry reset');
  }

  /**
   * Export registry state (for debugging/admin UI)
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastScanTime: this.state.lastScanTime?.toISOString() || null,
      plugins: Array.from(this.state.plugins.entries()).map(([name, plugin]) => ({
        name,
        title: plugin.manifest.title,
        version: plugin.manifest.version,
        enabled: plugin.enabled,
        capabilities: plugin.capabilities,
        path: plugin.pluginPath,
        source: plugin.source,
      })),
      errors: Array.from(this.state.errors.entries()).map(([name, error]) => ({
        name,
        error,
      })),
      capabilities: Array.from(this.state.capabilities.entries()).map(([cap, plugins]) => ({
        capability: cap,
        plugins,
      })),
      stats: this.getStats(),
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global plugin registry instance
 */
export const pluginRegistry = new PluginRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get all plugins
 */
export function getAllPlugins(): LoadedPlugin[] {
  return pluginRegistry.getAll();
}

/**
 * Get enabled plugins
 */
export function getEnabledPlugins(): LoadedPlugin[] {
  return pluginRegistry.getEnabled();
}

/**
 * Get a specific plugin
 */
export function getPlugin(name: string): LoadedPlugin | null {
  return pluginRegistry.get(name);
}

/**
 * Get plugins by capability
 */
export function getPluginsByCapability(capability: PluginCapability): LoadedPlugin[] {
  return pluginRegistry.getByCapability(capability);
}

/**
 * Get enabled plugins by capability
 */
export function getEnabledPluginsByCapability(capability: PluginCapability): LoadedPlugin[] {
  return pluginRegistry.getEnabledByCapability(capability);
}

/**
 * Check if a plugin exists
 */
export function hasPlugin(name: string): boolean {
  return pluginRegistry.has(name);
}

/**
 * Get registry statistics
 */
export function getPluginStats() {
  return pluginRegistry.getStats();
}
