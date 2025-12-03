/**
 * Site Plugins Configuration
 *
 * Manages plugin enablement configuration via environment variables.
 * Provides utilities to determine which plugins should be enabled based on
 * SITE_PLUGINS_ENABLED and SITE_PLUGINS_DISABLED environment variables.
 */

import { logger } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Plugin enablement configuration
 */
export interface SitePluginsConfig {
  enabled: string[] | 'all';
  disabled: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_ENABLED = 'all';
const DEFAULT_DISABLED: string[] = [];

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parses a comma-separated plugin list from an environment variable
 * @param envValue - Environment variable value
 * @returns Array of plugin names, or 'all' string, or empty array
 */
function parsePluginList(envValue: string | undefined): string[] | 'all' {
  if (!envValue || envValue.trim() === '') {
    return [];
  }

  const trimmed = envValue.trim();

  // Check if the value is literally 'all'
  if (trimmed.toLowerCase() === 'all') {
    return 'all';
  }

  // Parse comma-separated list
  const plugins = trimmed
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return plugins;
}

// ============================================================================
// CONFIGURATION FUNCTIONS
// ============================================================================

/**
 * Gets the list of enabled plugins from environment configuration
 * Reads the SITE_PLUGINS_ENABLED environment variable.
 * @returns Array of plugin names, the string 'all', or empty array
 */
export function getSitePluginsEnabled(): string[] | 'all' {
  const enabledValue = process.env.SITE_PLUGINS_ENABLED;
  const result = parsePluginList(enabledValue);

  logger.debug('Site plugins enabled configuration loaded', {
    context: 'getSitePluginsEnabled',
    enabledValue,
    result: typeof result === 'string' ? result : `[${result.join(', ')}]`,
  });

  return result.length === 0 ? DEFAULT_ENABLED : result;
}

/**
 * Gets the list of disabled plugins from environment configuration
 * Reads the SITE_PLUGINS_DISABLED environment variable.
 * @returns Array of plugin names to explicitly disable
 */
export function getSitePluginsDisabled(): string[] {
  const disabledValue = process.env.SITE_PLUGINS_DISABLED;
  const result = parsePluginList(disabledValue);

  logger.debug('Site plugins disabled configuration loaded', {
    context: 'getSitePluginsDisabled',
    disabledValue,
    result: typeof result === 'string' ? [] : `[${result.join(', ')}]`,
  });

  // If result is 'all', that doesn't make sense for disabled list, treat as empty
  return typeof result === 'string' ? DEFAULT_DISABLED : result;
}

/**
 * Determines if a specific plugin should be enabled
 * A plugin is enabled if:
 * 1. It's in the enabled list (or 'all' is enabled), AND
 * 2. It's not in the disabled list
 *
 * @param pluginName - Name of the plugin to check
 * @returns True if the plugin should be enabled
 */
export function isSitePluginEnabled(pluginName: string): boolean {
  const enabled = getSitePluginsEnabled();
  const disabled = getSitePluginsDisabled();

  // Check if plugin is in disabled list
  if (disabled.includes(pluginName)) {
    logger.debug('Site plugin is explicitly disabled', {
      context: 'isSitePluginEnabled',
      pluginName,
      disabled: `[${disabled.join(', ')}]`,
    });
    return false;
  }

  // Check if plugin is in enabled list
  const isInEnabledList = enabled === 'all' || enabled.includes(pluginName);

  logger.debug('Site plugin enablement determination', {
    context: 'isSitePluginEnabled',
    pluginName,
    enabledConfig: typeof enabled === 'string' ? enabled : `[${enabled.join(', ')}]`,
    isEnabled: isInEnabledList,
  });

  return isInEnabledList;
}

/**
 * Gets the complete site plugins configuration
 * @returns Configuration object with enabled and disabled lists
 */
export function getSitePluginsConfig(): SitePluginsConfig {
  const config: SitePluginsConfig = {
    enabled: getSitePluginsEnabled(),
    disabled: getSitePluginsDisabled(),
  };

  logger.debug('Site plugins configuration retrieved', {
    context: 'getSitePluginsConfig',
    config: {
      enabled: typeof config.enabled === 'string' ? config.enabled : `[${config.enabled.join(', ')}]`,
      disabled: `[${config.disabled.join(', ')}]`,
    },
  });

  return config;
}
