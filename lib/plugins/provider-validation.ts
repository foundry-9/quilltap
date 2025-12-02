/**
 * Provider Validation Utilities
 *
 * Centralized validation helpers for provider configuration.
 * These utilities query the provider registry to determine requirements
 * rather than hardcoding provider names.
 *
 * @module plugins/provider-validation
 */

import { logger } from '@/lib/logger';
import { providerRegistry, getConfigRequirements, getProvider } from './provider-registry';

// ============================================================================
// TYPES
// ============================================================================

export interface ProviderConfigValidation {
  valid: boolean;
  errors: string[];
}

export interface ProviderConnectionTestResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate provider configuration requirements
 *
 * Checks if the provided configuration meets the provider's requirements
 * (API key, base URL, etc.) based on the provider's registered metadata.
 *
 * @param provider The provider name (e.g., 'OPENAI', 'OLLAMA')
 * @param config The configuration to validate
 * @returns Validation result with errors if any
 *
 * @example
 * ```typescript
 * const result = validateProviderConfig('OLLAMA', { baseUrl: '' });
 * // result.valid === false
 * // result.errors === ['Base URL is required for OLLAMA']
 * ```
 */
export function validateProviderConfig(
  provider: string,
  config: {
    apiKey?: string;
    baseUrl?: string;
  }
): ProviderConfigValidation {
  const errors: string[] = [];

  // Check if provider exists in registry
  const providerPlugin = getProvider(provider);
  if (!providerPlugin) {
    logger.warn('Provider not found in registry for validation', {
      provider,
      context: 'provider-validation.validateProviderConfig',
    });
    return {
      valid: false,
      errors: [`Provider '${provider}' not found`],
    };
  }

  const requirements = providerPlugin.config;

  // Check base URL requirement
  if (requirements.requiresBaseUrl && !config.baseUrl) {
    const label = requirements.baseUrlLabel || 'Base URL';
    errors.push(`${label} is required for ${provider}`);
  }

  // Check API key requirement
  if (requirements.requiresApiKey && !config.apiKey) {
    const label = requirements.apiKeyLabel || 'API key';
    errors.push(`${label} is required for ${provider}`);
  }

  logger.debug('Provider config validation result', {
    provider,
    valid: errors.length === 0,
    errorCount: errors.length,
    context: 'provider-validation.validateProviderConfig',
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a provider requires a base URL
 *
 * @param provider The provider name
 * @returns true if base URL is required
 */
export function requiresBaseUrl(provider: string): boolean {
  const requirements = getConfigRequirements(provider);
  return requirements?.requiresBaseUrl ?? false;
}

/**
 * Check if a provider requires an API key
 *
 * @param provider The provider name
 * @returns true if API key is required
 */
export function requiresApiKey(provider: string): boolean {
  const requirements = getConfigRequirements(provider);
  return requirements?.requiresApiKey ?? true; // Default to true for safety
}

/**
 * Get the default base URL for a provider (if any)
 *
 * @param provider The provider name
 * @returns The default base URL or undefined
 */
export function getDefaultBaseUrl(provider: string): string | undefined {
  const requirements = getConfigRequirements(provider);
  return requirements?.baseUrlDefault;
}

/**
 * Test provider connection using the plugin's validateApiKey method
 *
 * Delegates connection testing to the provider plugin, which knows
 * the correct endpoints and authentication methods for its API.
 *
 * @param provider The provider name
 * @param apiKey The API key to test (may be empty for providers that don't require it)
 * @param baseUrl Optional base URL for providers that require it
 * @returns Connection test result
 *
 * @example
 * ```typescript
 * const result = await testProviderConnection('OPENAI', 'sk-...');
 * if (result.valid) {
 *   console.log('Connection successful!');
 * } else {
 *   console.error('Connection failed:', result.error);
 * }
 * ```
 */
export async function testProviderConnection(
  provider: string,
  apiKey: string,
  baseUrl?: string
): Promise<ProviderConnectionTestResult> {
  logger.debug('Testing provider connection', {
    provider,
    hasApiKey: !!apiKey,
    hasBaseUrl: !!baseUrl,
    context: 'provider-validation.testProviderConnection',
  });

  // Get provider plugin
  const providerPlugin = getProvider(provider);
  if (!providerPlugin) {
    logger.warn('Provider not found for connection test', {
      provider,
      context: 'provider-validation.testProviderConnection',
    });
    return {
      valid: false,
      error: `Provider '${provider}' not found`,
    };
  }

  // Validate configuration first
  const configValidation = validateProviderConfig(provider, { apiKey, baseUrl });
  if (!configValidation.valid) {
    return {
      valid: false,
      error: configValidation.errors[0], // Return first error
    };
  }

  try {
    // Use the plugin's validateApiKey method to test connection
    const isValid = await providerPlugin.validateApiKey(apiKey, baseUrl);

    if (isValid) {
      logger.debug('Provider connection test successful', {
        provider,
        context: 'provider-validation.testProviderConnection',
      });
      return { valid: true };
    }

    logger.debug('Provider connection test failed', {
      provider,
      context: 'provider-validation.testProviderConnection',
    });
    return {
      valid: false,
      error: `Failed to validate connection to ${providerPlugin.metadata.displayName}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Provider connection test error', {
      provider,
      error: errorMessage,
      context: 'provider-validation.testProviderConnection',
    }, error instanceof Error ? error : undefined);

    return {
      valid: false,
      error: errorMessage,
    };
  }
}

/**
 * Get all providers that support embeddings
 *
 * @returns Array of provider names that support embeddings
 */
export function getEmbeddingProviders(): string[] {
  return providerRegistry
    .getAllProviders()
    .filter(p => p.capabilities.embeddings)
    .map(p => p.metadata.providerName);
}

/**
 * Get embedding models for a specific provider
 *
 * Queries the provider plugin for its embedding model information.
 * Returns the models from the plugin's getModelInfo if available,
 * filtered to only those that are suitable for embeddings.
 *
 * @param provider The provider name
 * @returns Array of embedding model info or empty array
 */
export function getEmbeddingModels(provider: string): Array<{
  id: string;
  name: string;
  dimensions?: number;
  description?: string;
}> {
  const providerPlugin = getProvider(provider);
  if (!providerPlugin) {
    logger.warn('Provider not found for embedding models', {
      provider,
      context: 'provider-validation.getEmbeddingModels',
    });
    return [];
  }

  if (!providerPlugin.capabilities.embeddings) {
    logger.debug('Provider does not support embeddings', {
      provider,
      context: 'provider-validation.getEmbeddingModels',
    });
    return [];
  }

  // Use plugin's getEmbeddingModels method
  if (providerPlugin.getEmbeddingModels) {
    logger.debug('Getting embedding models from plugin', {
      provider,
      context: 'provider-validation.getEmbeddingModels',
    });
    return providerPlugin.getEmbeddingModels();
  }

  // Fallback: return empty array if plugin doesn't implement embedding models
  logger.debug('Provider does not implement getEmbeddingModels', {
    provider,
    context: 'provider-validation.getEmbeddingModels',
  });
  return [];
}

/**
 * Get all embedding models from all providers that support embeddings
 *
 * @returns Object mapping provider names to their embedding models
 */
export function getAllEmbeddingModels(): Record<string, Array<{
  id: string;
  name: string;
  dimensions?: number;
  description?: string;
}>> {
  const result: Record<string, Array<{
    id: string;
    name: string;
    dimensions?: number;
    description?: string;
  }>> = {};

  for (const providerName of getEmbeddingProviders()) {
    const models = getEmbeddingModels(providerName);
    if (models.length > 0) {
      result[providerName] = models;
    }
  }

  return result;
}
