/**
 * Image Generation Capability Checker
 * Phase 5: Determines which providers support image generation
 */

/**
 * Check if a provider supports image generation
 */
export function supportsImageGeneration(provider: string): boolean {
  const imageCapableProviders = ['OPENAI', 'GOOGLE', 'GROK', 'OPENROUTER'];
  return imageCapableProviders.includes(provider.toUpperCase());
}

/**
 * List of providers that support image generation
 */
export const IMAGE_CAPABLE_PROVIDERS = ['OPENAI', 'GOOGLE', 'GROK', 'OPENROUTER'] as const;

export type ImageCapableProvider = typeof IMAGE_CAPABLE_PROVIDERS[number];
