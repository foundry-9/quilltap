/**
 * Plugin Provider Factory
 *
 * Provides provider creation through the plugin registry system.
 * All providers are now loaded as plugins.
 *
 * Phase 0.7: Multi-Provider Support with Plugin Integration
 */

import { logger } from '@/lib/logger';
import type { LLMProvider } from './base';
import type { ImageGenProvider } from '@/lib/image-gen/base';
import { providerRegistry } from '@/lib/plugins/provider-registry';

// ============================================================================
// LOGGER SETUP
// ============================================================================

const pluginLogger = logger.child({
  module: 'plugin-factory',
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a provider is registered in the plugin registry
 *
 * @param provider The provider name to check
 * @returns true if the provider is registered in the plugin system
 */
export function isProviderFromPlugin(provider: string): boolean {
  return providerRegistry.hasProvider(provider);
}

// ============================================================================
// MAIN FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an LLM provider instance from the plugin registry
 *
 * @param provider The provider name (e.g., 'OPENAI', 'ANTHROPIC')
 * @param baseUrl Optional base URL for providers that support custom endpoints
 * @returns An instantiated LLMProvider
 * @throws Error if provider not found in plugin registry
 */
export async function createLLMProvider(
  provider: string,
  baseUrl?: string
): Promise<LLMProvider> {
  try {
    pluginLogger.debug('Creating LLM provider from plugin registry', {
      provider,
      hasBaseUrl: !!baseUrl,
    });

    // Check if registry is initialized, if not, initialize it
    if (!providerRegistry.isInitialized()) {
      pluginLogger.warn('Provider registry not initialized, initializing now', {
        provider,
      });

      // Dynamically import to avoid circular dependencies
      const { initializePlugins } = await import('@/lib/startup/plugin-initialization');
      await initializePlugins();
    }

    return providerRegistry.createLLMProvider(provider, baseUrl);
  } catch (error) {
    pluginLogger.error('Failed to create provider from plugin registry', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create an image generation provider instance from the plugin registry
 *
 * @param provider The provider name (e.g., 'OPENAI', 'GOOGLE')
 * @param baseUrl Optional base URL for providers that support custom endpoints
 * @returns An instantiated ImageGenProvider
 * @throws Error if provider not found in registry or doesn't support image generation
 */
export function createImageProvider(
  provider: string,
  baseUrl?: string
): ImageGenProvider {
  pluginLogger.debug('Creating image provider from plugin registry', {
    provider,
    hasBaseUrl: !!baseUrl,
  });

  // Map legacy provider names if needed
  const providerName = provider.toUpperCase() === 'GOOGLE_IMAGEN' ? 'GOOGLE' : provider;

  try {
    return providerRegistry.createImageProvider(providerName, baseUrl);
  } catch (error) {
    pluginLogger.error('Failed to create image provider', {
      provider: providerName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// INTROSPECTION FUNCTIONS
// ============================================================================

/**
 * Get all available LLM providers from the plugin registry
 *
 * @returns Array of all available provider names
 */
export function getAllAvailableProviders(): string[] {
  const pluginProviders = providerRegistry.getProviderNames();

  pluginLogger.debug('Retrieved all available providers', {
    pluginCount: pluginProviders.length,
  });

  return pluginProviders;
}

/**
 * Get all available image generation providers
 *
 * @returns Array of all available image provider names
 */
export function getAllAvailableImageProviders(): string[] {
  const providers = providerRegistry
    .getProvidersByCapability('imageGeneration')
    .map(plugin => plugin.metadata.providerName);

  pluginLogger.debug('Retrieved all available image providers', {
    count: providers.length,
    providers,
  });

  return providers;
}
