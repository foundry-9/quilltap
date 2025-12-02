/**
 * Factory function for creating image generation provider instances
 *
 * @deprecated Use createImageProvider from @/lib/llm/plugin-factory instead.
 * This file is maintained for backwards compatibility only.
 */

import { logger } from '@/lib/logger';
import { ImageGenProvider } from './base';
import { providerRegistry } from '@/lib/plugins/provider-registry';

const moduleLogger = logger.child({ module: 'image-gen-factory' });

/**
 * Get an image generation provider instance
 *
 * @deprecated Use createImageProvider from @/lib/llm/plugin-factory instead.
 * @param provider The provider name (e.g., 'OPENAI', 'GROK', 'GOOGLE')
 * @returns An instantiated ImageGenProvider
 * @throws Error if provider not found or doesn't support image generation
 */
export function getImageGenProvider(provider: string): ImageGenProvider {
  const normalizedProvider = provider.toUpperCase();

  moduleLogger.debug('Getting image provider (deprecated path)', {
    provider: normalizedProvider,
  });

  // Map legacy provider names if needed
  const providerName = normalizedProvider === 'GOOGLE_IMAGEN' ? 'GOOGLE' : normalizedProvider;

  return providerRegistry.createImageProvider(providerName);
}

/**
 * Get list of supported image generation providers
 *
 * @deprecated Use getImageCapableProviders from @/lib/llm/image-capable instead.
 * @returns Array of provider names that support image generation
 */
export function getSupportedImageProviders(): string[] {
  moduleLogger.debug('Getting supported image providers (deprecated path)');

  return providerRegistry
    .getProvidersByCapability('imageGeneration')
    .map(plugin => plugin.metadata.providerName);
}
