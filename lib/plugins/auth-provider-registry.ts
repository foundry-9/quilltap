/**
 * Auth Provider Registry
 *
 * Manages registration and retrieval of authentication provider plugins.
 * Providers are loaded from plugins with AUTH_METHODS capability.
 */

import { logger } from '@/lib/logger';
import type { AuthProviderPluginExport, AuthProviderConfig } from './interfaces/auth-provider-plugin';

// ============================================================================
// REGISTRY STATE
// ============================================================================

interface AuthProviderEntry {
  config: AuthProviderConfig;
  plugin: AuthProviderPluginExport;
  isConfigured: boolean;
}

const authProviders = new Map<string, AuthProviderEntry>();

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register an authentication provider plugin
 */
export function registerAuthProvider(plugin: AuthProviderPluginExport): void {
  const { config } = plugin;

  if (authProviders.has(config.providerId)) {
    logger.warn('Auth provider already registered, replacing', {
      context: 'registerAuthProvider',
      providerId: config.providerId,
    });
  }

  const isConfigured = plugin.isConfigured();

  authProviders.set(config.providerId, {
    config,
    plugin,
    isConfigured,
  });

  logger.info('Auth provider registered', {
    context: 'registerAuthProvider',
    providerId: config.providerId,
    displayName: config.displayName,
    isConfigured,
  });
}

/**
 * Unregister an authentication provider
 */
export function unregisterAuthProvider(providerId: string): boolean {
  const removed = authProviders.delete(providerId);

  if (removed) {
    logger.info('Auth provider unregistered', {
      context: 'unregisterAuthProvider',
      providerId,
    });
  }

  return removed;
}

// ============================================================================
// RETRIEVAL
// ============================================================================

/**
 * Get all registered auth providers
 */
export function getAllAuthProviders(): AuthProviderEntry[] {
  return Array.from(authProviders.values());
}

/**
 * Get all configured (ready to use) auth providers
 */
export function getConfiguredAuthProviders(): AuthProviderEntry[] {
  return Array.from(authProviders.values()).filter(entry => entry.isConfigured);
}

/**
 * Get a specific auth provider by ID
 */
export function getAuthProvider(providerId: string): AuthProviderEntry | undefined {
  return authProviders.get(providerId);
}

/**
 * Check if an auth provider is registered
 */
export function hasAuthProvider(providerId: string): boolean {
  return authProviders.has(providerId);
}

/**
 * Get auth provider configurations for UI display
 */
export function getAuthProviderConfigs(): AuthProviderConfig[] {
  return Array.from(authProviders.values())
    .filter(entry => entry.isConfigured)
    .map(entry => entry.config);
}

// ============================================================================
// NEXTAUTH INTEGRATION
// ============================================================================

/**
 * Build NextAuth providers array from registered auth provider plugins
 * Returns only configured providers
 */
export function buildNextAuthProviders(): ReturnType<AuthProviderPluginExport['createProvider']>[] {
  const providers: ReturnType<AuthProviderPluginExport['createProvider']>[] = [];

  for (const [providerId, entry] of authProviders) {
    if (!entry.isConfigured) {
      logger.debug('Skipping unconfigured auth provider', {
        context: 'buildNextAuthProviders',
        providerId,
      });
      continue;
    }

    try {
      const provider = entry.plugin.createProvider();
      if (provider) {
        providers.push(provider);
        logger.debug('Added auth provider to NextAuth', {
          context: 'buildNextAuthProviders',
          providerId,
        });
      }
    } catch (error) {
      logger.error(
        'Failed to create auth provider',
        { context: 'buildNextAuthProviders', providerId },
        error instanceof Error ? error : undefined
      );
    }
  }

  logger.info('Built NextAuth providers from plugins', {
    context: 'buildNextAuthProviders',
    totalRegistered: authProviders.size,
    totalConfigured: providers.length,
  });

  return providers;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Refresh configuration status for all providers
 * Call this if environment variables may have changed
 */
export function refreshAuthProviderStatus(): void {
  for (const [providerId, entry] of authProviders) {
    const wasConfigured = entry.isConfigured;
    entry.isConfigured = entry.plugin.isConfigured();

    if (wasConfigured !== entry.isConfigured) {
      logger.info('Auth provider configuration status changed', {
        context: 'refreshAuthProviderStatus',
        providerId,
        wasConfigured,
        isConfigured: entry.isConfigured,
      });
    }
  }
}

/**
 * Clear all registered providers
 * Useful for testing
 */
export function clearAuthProviders(): void {
  authProviders.clear();
  logger.debug('Cleared all auth providers', { context: 'clearAuthProviders' });
}
