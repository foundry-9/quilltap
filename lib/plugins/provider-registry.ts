/**
 * Provider Registry
 *
 * Singleton registry for managing LLM provider plugins.
 * Provides centralized access to provider plugins, metadata, and factory methods
 * for creating provider instances.
 *
 * This registry integrates with the main plugin system, automatically discovering
 * and registering plugins with the LLM_PROVIDER capability.
 *
 * @module plugins/provider-registry
 */

import { logger } from '@/lib/logger';
import type { LLMProviderPlugin, ProviderMetadata, AttachmentSupport, ProviderConfigRequirements, ImageProviderConstraints } from './interfaces/provider-plugin';
import type { LLMProvider } from '@/lib/llm/base';
import type { ImageGenProvider } from '@/lib/image-gen/base';

// ============================================================================
// TYPES
// ============================================================================

export interface ProviderRegistryState {
  initialized: boolean;
  providers: Map<string, LLMProviderPlugin>;
  errors: Map<string, string>;
  lastInitTime: Date | null;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ProviderRegistry {
  private state: ProviderRegistryState = {
    initialized: false,
    providers: new Map(),
    errors: new Map(),
    lastInitTime: null,
  };

  private logger = logger.child({
    module: 'provider-registry',
  });

  /**
   * Register a provider plugin
   *
   * @param plugin The provider plugin to register
   * @throws Error if provider with same name is already registered
   */
  registerProvider(plugin: LLMProviderPlugin): void {
    const providerName = plugin.metadata.providerName;

    if (this.state.providers.has(providerName)) {
      const error = `Provider '${providerName}' is already registered`;
      this.logger.warn(error);
      throw new Error(error);
    }

    this.state.providers.set(providerName, plugin);
    this.logger.debug('Provider registered', {
      name: providerName,
      displayName: plugin.metadata.displayName,
    });
  }

  /**
   * Get a specific provider plugin by name
   *
   * @param name The provider name (e.g., 'OPENAI')
   * @returns The provider plugin or null if not found
   */
  getProvider(name: string): LLMProviderPlugin | null {
    return this.state.providers.get(name) || null;
  }

  /**
   * Get all registered provider plugins
   *
   * @returns Array of all registered provider plugins
   */
  getAllProviders(): LLMProviderPlugin[] {
    return Array.from(this.state.providers.values());
  }

  /**
   * Check if a provider is registered
   *
   * @param name The provider name
   * @returns true if provider is registered, false otherwise
   */
  hasProvider(name: string): boolean {
    return this.state.providers.has(name);
  }

  /**
   * Get list of all registered provider names
   *
   * Useful for populating dropdown menus and provider selection UI
   *
   * @returns Array of provider names (e.g., ['OPENAI', 'ANTHROPIC', ...])
   */
  getProviderNames(): string[] {
    return Array.from(this.state.providers.keys());
  }

  /**
   * Create an LLMProvider instance from a registered plugin
   *
   * @param name The provider name
   * @param baseUrl Optional base URL for providers that support custom endpoints
   * @returns An instantiated LLMProvider
   * @throws Error if provider not found or creation fails
   */
  createLLMProvider(name: string, baseUrl?: string): LLMProvider {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Provider '${name}' not found in registry`;
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      this.logger.debug('Creating LLM provider instance', {
        provider: name,
        hasBaseUrl: !!baseUrl,
      });
      return plugin.createProvider(baseUrl);
    } catch (error) {
      this.logger.error('Failed to create LLM provider', {
        provider: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create an ImageGenProvider instance from a registered plugin
   *
   * @param name The provider name
   * @param baseUrl Optional base URL for providers that support custom endpoints
   * @returns An instantiated ImageGenProvider
   * @throws Error if provider not found, doesn't support image generation, or creation fails
   */
  createImageProvider(name: string, baseUrl?: string): ImageGenProvider {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Provider '${name}' not found in registry`;
      this.logger.error(error);
      throw new Error(error);
    }

    if (!plugin.capabilities.imageGeneration) {
      const error = `Provider '${name}' does not support image generation`;
      this.logger.warn(error);
      throw new Error(error);
    }

    if (!plugin.createImageProvider) {
      const error = `Provider '${name}' does not implement createImageProvider`;
      this.logger.error(error);
      throw new Error(error);
    }

    try {
      this.logger.debug('Creating image provider instance', {
        provider: name,
        hasBaseUrl: !!baseUrl,
      });
      return plugin.createImageProvider(baseUrl);
    } catch (error) {
      this.logger.error('Failed to create image provider', {
        provider: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get metadata for a specific provider
   *
   * Metadata includes display name, colors, abbreviation, etc.
   * Useful for UI rendering and provider identification.
   *
   * @param name The provider name
   * @returns The provider metadata or null if not found
   */
  getProviderMetadata(name: string): ProviderMetadata | null {
    const plugin = this.getProvider(name);
    return plugin?.metadata || null;
  }

  /**
   * Get metadata for all registered providers
   *
   * @returns Array of provider metadata objects
   */
  getAllProviderMetadata(): ProviderMetadata[] {
    return this.getAllProviders().map(p => p.metadata);
  }

  /**
   * Get attachment support information for a provider
   *
   * @param name The provider name
   * @returns Attachment support info or null if not found
   */
  getAttachmentSupport(name: string): AttachmentSupport | null {
    const plugin = this.getProvider(name);
    return plugin?.attachmentSupport || null;
  }

  /**
   * Get configuration requirements for a provider
   *
   * @param name The provider name
   * @returns Configuration requirements or null if not found
   */
  getConfigRequirements(name: string): ProviderConfigRequirements | null {
    const plugin = this.getProvider(name);
    return plugin?.config || null;
  }

  /**
   * Get all providers that support a specific capability
   *
   * @param capability The capability to check ('chat', 'imageGeneration', 'embeddings', 'webSearch')
   * @returns Array of provider plugins with the capability
   */
  getProvidersByCapability(capability: keyof typeof DEFAULT_CAPABILITIES): LLMProviderPlugin[] {
    return this.getAllProviders().filter(
      plugin => plugin.capabilities[capability]
    );
  }

  /**
   * Check if a provider supports a specific capability
   *
   * @param name The provider name
   * @param capability The capability to check
   * @returns true if provider supports the capability, false otherwise
   */
  supportsCapability(name: string, capability: keyof typeof DEFAULT_CAPABILITIES): boolean {
    const plugin = this.getProvider(name);
    return plugin?.capabilities[capability] ?? false;
  }

  /**
   * Get all providers that support attachments
   *
   * @returns Array of provider plugins with attachment support
   */
  getProvidersWithAttachmentSupport(): LLMProviderPlugin[] {
    return this.getAllProviders().filter(
      plugin => plugin.attachmentSupport.supportsAttachments
    );
  }

  /**
   * Get image provider constraints for a provider
   *
   * Returns constraints and limitations for image generation.
   * Used to apply provider-specific constraints to image generation tools.
   *
   * @param name The provider name
   * @returns Image provider constraints or null if not found/not supported
   */
  getImageProviderConstraints(name: string): ImageProviderConstraints | null {
    const plugin = this.getProvider(name);
    if (!plugin) {
      return null;
    }

    // Check if provider supports image generation
    if (!plugin.capabilities.imageGeneration) {
      return null;
    }

    // Call getImageProviderConstraints if it exists
    if (plugin.getImageProviderConstraints && typeof plugin.getImageProviderConstraints === 'function') {
      return plugin.getImageProviderConstraints();
    }

    return null;
  }

  /**
   * Initialize the registry (called by the plugin system)
   *
   * @param providers Array of provider plugins to register
   */
  async initialize(providers: LLMProviderPlugin[]): Promise<void> {
    this.logger.info('Initializing provider registry', {
      providerCount: providers.length,
    });

    // Clear existing state
    this.state.providers.clear();
    this.state.errors.clear();

    // Register each provider
    for (const provider of providers) {
      try {
        this.registerProvider(provider);
      } catch (error) {
        const providerName = provider.metadata.providerName;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.state.errors.set(providerName, errorMessage);
        this.logger.warn('Failed to register provider', {
          name: providerName,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();

    this.logger.info('Provider registry initialized', {
      registered: this.state.providers.size,
      errors: this.state.errors.size,
    });
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered providers
   */
  getStats() {
    return {
      total: this.state.providers.size,
      errors: this.state.errors.size,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      providers: Array.from(this.state.providers.keys()),
    };
  }

  /**
   * Get all errors from provider registration
   *
   * @returns Array of registration errors
   */
  getErrors(): Array<{ provider: string; error: string }> {
    return Array.from(this.state.errors.entries()).map(([provider, error]) => ({
      provider,
      error,
    }));
  }

  /**
   * Check if registry is initialized
   *
   * @returns true if registry has been initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Reset the registry (for testing)
   *
   * @internal
   */
  reset(): void {
    this.state.initialized = false;
    this.state.providers.clear();
    this.state.errors.clear();
    this.state.lastInitTime = null;
    this.logger.debug('Provider registry reset');
  }

  /**
   * Export registry state for debugging/admin UI
   *
   * @returns Complete registry state
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      providers: Array.from(this.state.providers.entries()).map(([name, plugin]) => ({
        name,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        capabilities: plugin.capabilities,
        attachmentSupport: plugin.attachmentSupport,
        configRequirements: {
          requiresApiKey: plugin.config.requiresApiKey,
          requiresBaseUrl: plugin.config.requiresBaseUrl,
        },
      })),
      errors: Array.from(this.state.errors.entries()).map(([provider, error]) => ({
        provider,
        error,
      })),
      stats: this.getStats(),
    };
  }
}

// ============================================================================
// DEFAULT CAPABILITIES
// ============================================================================

const DEFAULT_CAPABILITIES = {
  chat: 'chat',
  imageGeneration: 'imageGeneration',
  embeddings: 'embeddings',
  webSearch: 'webSearch',
} as const;

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global provider registry instance
 */
export const providerRegistry = new ProviderRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a provider plugin
 *
 * @param plugin The provider plugin to register
 */
export function registerProvider(plugin: LLMProviderPlugin): void {
  providerRegistry.registerProvider(plugin);
}

/**
 * Get a provider plugin by name
 *
 * @param name The provider name
 * @returns The provider plugin or null
 */
export function getProvider(name: string): LLMProviderPlugin | null {
  return providerRegistry.getProvider(name);
}

/**
 * Get all registered provider plugins
 *
 * @returns Array of all registered providers
 */
export function getAllProviders(): LLMProviderPlugin[] {
  return providerRegistry.getAllProviders();
}

/**
 * Check if a provider is registered
 *
 * @param name The provider name
 * @returns true if provider exists
 */
export function hasProvider(name: string): boolean {
  return providerRegistry.hasProvider(name);
}

/**
 * Get list of provider names
 *
 * @returns Array of provider names
 */
export function getProviderNames(): string[] {
  return providerRegistry.getProviderNames();
}

/**
 * Create an LLMProvider instance
 *
 * @param name The provider name
 * @param baseUrl Optional base URL
 * @returns Instantiated LLMProvider
 */
export function createLLMProvider(name: string, baseUrl?: string): LLMProvider {
  return providerRegistry.createLLMProvider(name, baseUrl);
}

/**
 * Create an ImageGenProvider instance
 *
 * @param name The provider name
 * @param baseUrl Optional base URL
 * @returns Instantiated ImageGenProvider
 */
export function createImageProvider(name: string, baseUrl?: string): ImageGenProvider {
  return providerRegistry.createImageProvider(name, baseUrl);
}

/**
 * Get provider metadata
 *
 * @param name The provider name
 * @returns Provider metadata or null
 */
export function getProviderMetadata(name: string): ProviderMetadata | null {
  return providerRegistry.getProviderMetadata(name);
}

/**
 * Get all provider metadata
 *
 * @returns Array of metadata for all providers
 */
export function getAllProviderMetadata(): ProviderMetadata[] {
  return providerRegistry.getAllProviderMetadata();
}

/**
 * Get attachment support for a provider
 *
 * @param name The provider name
 * @returns Attachment support info or null
 */
export function getAttachmentSupport(name: string): AttachmentSupport | null {
  return providerRegistry.getAttachmentSupport(name);
}

/**
 * Get configuration requirements for a provider
 *
 * @param name The provider name
 * @returns Config requirements or null
 */
export function getConfigRequirements(name: string): ProviderConfigRequirements | null {
  return providerRegistry.getConfigRequirements(name);
}

/**
 * Get providers with a specific capability
 *
 * @param capability The capability to check
 * @returns Array of providers with the capability
 */
export function getProvidersByCapability(
  capability: keyof typeof DEFAULT_CAPABILITIES
): LLMProviderPlugin[] {
  return providerRegistry.getProvidersByCapability(capability);
}

/**
 * Check if provider supports a capability
 *
 * @param name The provider name
 * @param capability The capability to check
 * @returns true if supported
 */
export function supportsCapability(
  name: string,
  capability: keyof typeof DEFAULT_CAPABILITIES
): boolean {
  return providerRegistry.supportsCapability(name, capability);
}

/**
 * Get providers with attachment support
 *
 * @returns Array of providers supporting attachments
 */
export function getProvidersWithAttachmentSupport(): LLMProviderPlugin[] {
  return providerRegistry.getProvidersWithAttachmentSupport();
}

/**
 * Get image provider constraints for a provider
 *
 * @param name The provider name
 * @returns Image provider constraints or null
 */
export function getImageProviderConstraints(name: string): ImageProviderConstraints | null {
  return providerRegistry.getImageProviderConstraints(name);
}

/**
 * Initialize the provider registry
 *
 * @param providers Array of provider plugins to register
 */
export async function initializeProviderRegistry(providers: LLMProviderPlugin[]): Promise<void> {
  return providerRegistry.initialize(providers);
}

/**
 * Get registry statistics
 *
 * @returns Statistics about registered providers
 */
export function getProviderRegistryStats() {
  return providerRegistry.getStats();
}

/**
 * Get registry errors
 *
 * @returns Array of registration errors
 */
export function getProviderRegistryErrors() {
  return providerRegistry.getErrors();
}

/**
 * Check if registry is initialized
 *
 * @returns true if initialized
 */
export function isProviderRegistryInitialized(): boolean {
  return providerRegistry.isInitialized();
}
