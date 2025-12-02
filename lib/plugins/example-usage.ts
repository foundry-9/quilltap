/**
 * Example Usage of Plugin Manifest Schema
 *
 * This file demonstrates how to use the plugin system in backend code.
 * This is for documentation/example purposes only.
 */

import { scanPlugins, loadPlugin, isPluginCompatible, validatePluginSecurity } from './manifest-loader';
import { logger } from '@/lib/logger';

/**
 * Example: Scan and load all plugins
 */
export async function exampleScanAllPlugins() {
  const { plugins, errors } = await scanPlugins();

  // Log any errors
  if (errors.length > 0) {
    logger.error('Plugin scan found errors:', { count: errors.length, errors });
  }

  // Process valid plugins
  for (const plugin of plugins) {
    logger.info('Found plugin:', {
      name: plugin.manifest.name,
      title: plugin.manifest.title,
      version: plugin.manifest.version,
      capabilities: plugin.capabilities,
    });

    // Check security warnings
    const warnings = validatePluginSecurity(plugin.manifest);
    if (warnings.length > 0) {
      logger.warn('Plugin security warnings:', {
        plugin: plugin.manifest.name,
        warnings,
      });
    }
  }

  return plugins;
}

/**
 * Example: Load a specific plugin and check compatibility
 */
export async function exampleLoadSpecificPlugin(pluginName: string, quilltapVersion: string) {
  const plugin = await loadPlugin(pluginName);

  if (!plugin) {
    logger.error('Plugin not found or invalid:', { pluginName });
    return null;
  }

  // Check version compatibility
  const compatible = isPluginCompatible(plugin.manifest, quilltapVersion);
  if (!compatible) {
    logger.error('Plugin is not compatible with current version:', {
      plugin: pluginName,
      required: plugin.manifest.compatibility.quilltapVersion,
      current: quilltapVersion,
    });
    return null;
  }

  logger.info('Plugin loaded successfully:', {
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    compatible: true,
  });

  return plugin;
}

/**
 * Example: Filter plugins by capability
 */
export async function exampleFindPluginsByCapability(capability: string) {
  const { plugins } = await scanPlugins();

  const filtered = plugins.filter(plugin =>
    plugin.capabilities.includes(capability as any)
  );

  logger.info('Plugins with capability:', {
    capability,
    count: filtered.length,
    plugins: filtered.map(p => p.manifest.name),
  });

  return filtered;
}

/**
 * Example: Get plugin configuration schema
 */
export async function exampleGetPluginConfig(pluginName: string) {
  const plugin = await loadPlugin(pluginName);

  if (!plugin) {
    return null;
  }

  const configSchema = plugin.manifest.configSchema || [];
  const defaultConfig = plugin.manifest.defaultConfig || {};

  logger.info('Plugin configuration:', {
    plugin: pluginName,
    schema: configSchema,
    defaults: defaultConfig,
  });

  return {
    schema: configSchema,
    defaults: defaultConfig,
  };
}

/**
 * Example: Validate plugin hooks
 */
export async function exampleGetPluginHooks(pluginName: string) {
  const plugin = await loadPlugin(pluginName);

  if (!plugin) {
    return [];
  }

  const hooks = plugin.manifest.hooks || [];

  logger.info('Plugin hooks:', {
    plugin: pluginName,
    hooks: hooks.map(h => ({
      name: h.name,
      priority: h.priority,
      enabled: h.enabled,
    })),
  });

  return hooks;
}

/**
 * Example: Get plugin API routes
 */
export async function exampleGetPluginAPIRoutes(pluginName: string) {
  const plugin = await loadPlugin(pluginName);

  if (!plugin) {
    return [];
  }

  const routes = plugin.manifest.apiRoutes || [];

  logger.info('Plugin API routes:', {
    plugin: pluginName,
    routes: routes.map(r => ({
      path: r.path,
      methods: r.methods,
      requiresAuth: r.requiresAuth,
    })),
  });

  return routes;
}

/**
 * Example: Load all LLM provider plugins
 */
export async function exampleLoadLLMProviders() {
  const plugins = await exampleFindPluginsByCapability('LLM_PROVIDER');

  const providers = plugins.map(plugin => ({
    id: plugin.manifest.name,
    title: plugin.manifest.title,
    version: plugin.manifest.version,
    config: plugin.manifest.configSchema,
  }));

  logger.info('Available LLM providers:', { count: providers.length, providers });

  return providers;
}

/**
 * Example: Load all theme plugins
 */
export async function exampleLoadThemes() {
  const plugins = await exampleFindPluginsByCapability('THEME');

  const themes = plugins.map(plugin => ({
    id: plugin.manifest.name,
    title: plugin.manifest.title,
    description: plugin.manifest.description,
    styling: plugin.manifest.styling,
  }));

  logger.info('Available themes:', { count: themes.length, themes });

  return themes;
}
