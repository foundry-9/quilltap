/**
 * Factory function for creating image generation provider instances
 */

import { ImageGenProvider } from './base';
import { OpenAIImageProvider } from './openai';
import { GrokImageProvider } from './grok';
import { GoogleImagenProvider } from './google-imagen';

const providers: Record<string, () => ImageGenProvider> = {
  OPENAI: () => new OpenAIImageProvider(),
  GROK: () => new GrokImageProvider(),
  GOOGLE_IMAGEN: () => new GoogleImagenProvider(),
};

export function getImageGenProvider(provider: string): ImageGenProvider {
  const factory = providers[provider];
  if (!factory) {
    throw new Error(`Unknown image provider: ${provider}`);
  }
  return factory();
}

export function getSupportedImageProviders(): string[] {
  return Object.keys(providers);
}
