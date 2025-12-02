/**
 * Image Generation Capability Checker
 *
 * Determines which providers support image generation by querying
 * the plugin registry. This ensures the list stays in sync with
 * registered provider capabilities.
 *
 * @module llm/image-capable
 */

import { logger } from '@/lib/logger';
import { providerRegistry } from '@/lib/plugins/provider-registry';

const moduleLogger = logger.child({ module: 'image-capable' });

/**
 * Check if a provider supports image generation
 *
 * Queries the provider registry for the imageGeneration capability.
 * Falls back to false if the provider is not found or registry is not initialized.
 *
 * @param provider The provider name (e.g., 'OPENAI', 'GROK')
 * @returns true if the provider supports image generation
 */
export function supportsImageGeneration(provider: string): boolean {
  const normalizedProvider = provider.toUpperCase();

  // Check if registry is initialized
  if (!providerRegistry.isInitialized()) {
    moduleLogger.debug('Provider registry not initialized, cannot check image capability', {
      provider: normalizedProvider,
    });
    return false;
  }

  const result = providerRegistry.supportsCapability(normalizedProvider, 'imageGeneration');

  moduleLogger.debug('Checked image generation support', {
    provider: normalizedProvider,
    supportsImageGeneration: result,
  });

  return result;
}

/**
 * Get list of all providers that support image generation
 *
 * Queries the provider registry for all providers with imageGeneration capability.
 *
 * @returns Array of provider names that support image generation
 */
export function getImageCapableProviders(): string[] {
  if (!providerRegistry.isInitialized()) {
    moduleLogger.debug('Provider registry not initialized, returning empty list');
    return [];
  }

  const providers = providerRegistry
    .getProvidersByCapability('imageGeneration')
    .map(plugin => plugin.metadata.providerName);

  moduleLogger.debug('Retrieved image-capable providers', {
    count: providers.length,
    providers,
  });

  return providers;
}
