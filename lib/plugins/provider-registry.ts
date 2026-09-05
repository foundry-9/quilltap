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
 * Extends AbstractProviderRegistry for shared registration, lookup,
 * initialisation, validation, stats, errors, and state export logic.
 *
 * @module plugins/provider-registry
 */

import type { TextProviderPlugin, TextProvider, ImageProvider, ProviderMetadata, AttachmentSupport, ProviderConfigRequirements, ImageProviderConstraints, ImageGenerationModelInfo, ModelInfo, MessageFormatSupport, CheapModelConfig, ToolFormatType, EmbeddingProvider, LocalEmbeddingProvider } from '@quilltap/plugin-types';

// Backward-compatible alias used throughout this file
type LLMProviderPlugin = TextProviderPlugin;
import { getErrorMessage } from '@/lib/error-utils';
import { rewriteLocalhostUrl } from '@/lib/host-rewrite';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';
import { extractPluginExport } from './dynamic-loader';
import { AbstractProviderRegistry, type ProviderRegistryBaseState } from './abstract-provider-registry';
import { evaluateThinkingTurn } from '@/lib/llm/thinking-turn';

// ============================================================================
// TYPES
// ============================================================================

export type ProviderRegistryState = ProviderRegistryBaseState<LLMProviderPlugin>;

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our provider registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapProviderRegistryState: ProviderRegistryState | undefined;
}

// ============================================================================
// DEFAULT CAPABILITIES
// ============================================================================

const DEFAULT_CAPABILITIES = {
  chat: 'chat',
  imageGeneration: 'imageGeneration',
  embeddings: 'embeddings',
  webSearch: 'webSearch',
  toolUse: 'toolUse',
} as const;

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ProviderRegistry extends AbstractProviderRegistry<LLMProviderPlugin> {
  protected readonly registryName = 'provider-registry';
  protected readonly globalStateKey = '__quilltapProviderRegistryState';
  protected readonly typeName = 'provider';

  protected createEmptyState(): ProviderRegistryState {
    return {
      initialized: false,
      providers: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }

  // =========================================================================
  // LLM-SPECIFIC HELPERS
  // =========================================================================

  private requireProvider(name: string): LLMProviderPlugin {
    const plugin = this.getProvider(name);
    if (!plugin) {
      const error = `Provider '${name}' not found in registry`;
      this.registryLogger.error(error);
      throw new Error(error);
    }
    return plugin;
  }

  private resolveBaseUrl(baseUrl?: string): string | undefined {
    return baseUrl ? rewriteLocalhostUrl(baseUrl) : baseUrl;
  }

  // =========================================================================
  // FACTORY METHODS (LLM-specific)
  // =========================================================================

  /**
   * Create an LLMProvider instance from a registered plugin
   */
  createLLMProvider(name: string, baseUrl?: string): TextProvider {
    const plugin = this.requireProvider(name);

    try {
      const resolvedUrl = this.resolveBaseUrl(baseUrl);
      return plugin.createProvider(resolvedUrl);
    } catch (error) {
      this.registryLogger.error('Failed to create LLM provider', {
        provider: name,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Create an ImageGenProvider instance from a registered plugin
   */
  createImageProvider(name: string, baseUrl?: string): ImageProvider {
    const plugin = this.requireProvider(name);

    if (!plugin.capabilities.imageGeneration) {
      const error = `Provider '${name}' does not support image generation`;
      this.registryLogger.warn(error);
      throw new Error(error);
    }

    if (!plugin.createImageProvider) {
      const error = `Provider '${name}' does not implement createImageProvider`;
      this.registryLogger.error(error);
      throw new Error(error);
    }

    try {
      const resolvedUrl = this.resolveBaseUrl(baseUrl);
      return plugin.createImageProvider(resolvedUrl);
    } catch (error) {
      this.registryLogger.error('Failed to create image provider', {
        provider: name,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Create an EmbeddingProvider instance from a registered plugin
   */
  createEmbeddingProvider(name: string, baseUrl?: string): EmbeddingProvider | LocalEmbeddingProvider {
    const plugin = this.requireProvider(name);

    if (!plugin.capabilities.embeddings) {
      const error = `Provider '${name}' does not support embeddings`;
      this.registryLogger.warn(error);
      throw new Error(error);
    }

    if (!plugin.createEmbeddingProvider) {
      const error = `Provider '${name}' does not implement createEmbeddingProvider`;
      this.registryLogger.error(error);
      throw new Error(error);
    }

    try {
      const resolvedUrl = this.resolveBaseUrl(baseUrl);
      return plugin.createEmbeddingProvider(resolvedUrl);
    } catch (error) {
      this.registryLogger.error('Failed to create embedding provider', {
        provider: name,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  // =========================================================================
  // LLM-SPECIFIC QUERY METHODS
  // =========================================================================

  /**
   * Get attachment support information for a provider
   */
  getAttachmentSupport(name: string): AttachmentSupport | null {
    const plugin = this.getProvider(name);
    return plugin?.attachmentSupport || null;
  }

  /**
   * Get all providers that support a specific capability
   */
  getProvidersByCapability(capability: keyof typeof DEFAULT_CAPABILITIES): LLMProviderPlugin[] {
    return this.getAllProviders().filter(
      plugin => plugin.capabilities[capability]
    );
  }

  /**
   * Check if a provider supports a specific capability
   */
  supportsCapability(name: string, capability: keyof typeof DEFAULT_CAPABILITIES): boolean {
    const plugin = this.getProvider(name);
    return plugin?.capabilities[capability] ?? false;
  }

  /**
   * Get all providers that support attachments
   */
  getProvidersWithAttachmentSupport(): LLMProviderPlugin[] {
    return this.getAllProviders().filter(
      plugin => plugin.attachmentSupport.supportsAttachments
    );
  }

  /**
   * Get image provider constraints for a provider
   */
  getImageProviderConstraints(name: string): ImageProviderConstraints | null {
    const plugin = this.getProvider(name);
    if (!plugin) {
      return null;
    }

    if (!plugin.capabilities.imageGeneration) {
      return null;
    }

    if (plugin.getImageProviderConstraints && typeof plugin.getImageProviderConstraints === 'function') {
      return plugin.getImageProviderConstraints();
    }

    return null;
  }

  /**
   * Get the statically-declared image generation models for a provider.
   *
   * Synchronous (reads the plugin's in-process declaration; no network), so it
   * is safe to call from the forked background-job child. Returns null when the
   * provider is unknown, lacks image generation, or does not declare models.
   */
  getImageGenerationModels(name: string): ImageGenerationModelInfo[] | null {
    const plugin = this.getProvider(name);
    if (!plugin) {
      return null;
    }

    if (!plugin.capabilities.imageGeneration) {
      return null;
    }

    if (plugin.getImageGenerationModels && typeof plugin.getImageGenerationModels === 'function') {
      return plugin.getImageGenerationModels();
    }

    return null;
  }

  /**
   * Validate an API key (override — uses requireProvider for strict checking)
   */
  override async validateApiKey(name: string, apiKey: string, baseUrl?: string): Promise<boolean> {
    const plugin = this.requireProvider(name);
    const resolvedUrl = this.resolveBaseUrl(baseUrl);
    return plugin.validateApiKey(apiKey, resolvedUrl);
  }

  /**
   * Fetch available models from a provider, with localhost URL rewriting.
   */
  async getAvailableModels(name: string, apiKey: string, baseUrl?: string): Promise<string[]> {
    const plugin = this.requireProvider(name);

    if (!plugin.getAvailableModels) {
      return [];
    }

    const resolvedUrl = this.resolveBaseUrl(baseUrl);
    return plugin.getAvailableModels(apiKey, resolvedUrl);
  }

  // =========================================================================
  // Runtime Configuration Query Methods
  // =========================================================================

  /**
   * Get message format support for a provider
   */
  getMessageFormat(name: string): MessageFormatSupport {
    const plugin = this.getProvider(name);
    return plugin?.messageFormat ?? { supportsNameField: false, supportedRoles: [] };
  }

  /**
   * Get token estimation multiplier for a provider
   */
  getCharsPerToken(name: string): number {
    const plugin = this.getProvider(name);
    return plugin?.charsPerToken ?? 3.5;
  }

  /**
   * Get tool format type for a provider
   */
  getToolFormat(name: string): ToolFormatType {
    const plugin = this.getProvider(name);
    return plugin?.toolFormat ?? 'openai';
  }

  /**
   * Get cheap model configuration for a provider
   */
  getCheapModelConfig(name: string): CheapModelConfig | null {
    const plugin = this.getProvider(name);
    return plugin?.cheapModels ?? null;
  }

  /**
   * Get default context window for a provider
   */
  getDefaultContextWindow(name: string): number {
    const plugin = this.getProvider(name);
    return plugin?.defaultContextWindow ?? 8192;
  }

  /**
   * Get model pricing from plugin's getModelInfo()
   */
  getModelPricing(providerName: string, modelId: string): { input: number; output: number } | null {
    const plugin = this.getProvider(providerName);
    const models = plugin?.getModelInfo?.() ?? [];
    const model = models.find(m => m.id === modelId);
    return model?.pricing ?? null;
  }

  /**
   * Whether a connection profile on this provider will run a thinking turn.
   *
   * Joins the two halves the plugin owns — its declared `thinkingTurnRule`
   * (which `parameters` key switches reasoning on or off) and its model
   * table's `thinksByDefault` flag — and hands both to the shared evaluator in
   * `lib/llm/thinking-turn`, which is also what the profile editor runs in the
   * browser. Never re-derive the answer at a call site (bug 85).
   */
  profileRunsThinkingTurn(
    providerName: string | null | undefined,
    modelName: string | null | undefined,
    parameters: Record<string, unknown> | null | undefined
  ): boolean {
    if (!providerName) return false;
    const plugin = this.getProvider(providerName);
    if (!plugin) return false;

    let model: ModelInfo | undefined;
    if (modelName) {
      try {
        model = plugin.getModelInfo?.().find(m => m.id === modelName);
      } catch {
        model = undefined;
      }
    }

    return evaluateThinkingTurn({
      rule: plugin.thinkingTurnRule ?? null,
      parameters: parameters ?? null,
      model: model ?? null,
    });
  }

  // =========================================================================
  // HOT-LOADING (LLM-specific)
  // =========================================================================

  /**
   * Hot-load a provider plugin from disk after installation
   */
  hotLoadProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
    return this.hotLoadProviderPluginBase(
      pluginPath,
      manifest,
      ['LLM_PROVIDER', 'EMBEDDING_PROVIDER'],
      (pluginModule) => extractPluginExport(pluginModule) as LLMProviderPlugin | undefined,
    );
  }

  // =========================================================================
  // EXPORT (override for LLM-specific fields)
  // =========================================================================

  protected override mapProviderToExportItem(name: string, plugin: LLMProviderPlugin): Record<string, unknown> {
    return {
      name,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      capabilities: plugin.capabilities,
      attachmentSupport: plugin.attachmentSupport,
      configRequirements: {
        requiresApiKey: plugin.config.requiresApiKey,
        requiresBaseUrl: plugin.config.requiresBaseUrl,
      },
    };
  }
}

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
 */
export function registerProvider(plugin: LLMProviderPlugin): void {
  providerRegistry.registerProvider(plugin);
}

/**
 * Get a provider plugin by name
 */
export function getProvider(name: string): LLMProviderPlugin | null {
  return providerRegistry.getProvider(name);
}

/**
 * Get all registered provider plugins
 */
export function getAllProviders(): LLMProviderPlugin[] {
  return providerRegistry.getAllProviders();
}

/**
 * Check if a provider is registered
 */
export function hasProvider(name: string): boolean {
  return providerRegistry.hasProvider(name);
}

/**
 * Get list of provider names
 */
export function getProviderNames(): string[] {
  return providerRegistry.getProviderNames();
}

/**
 * Create an LLMProvider instance
 */
export function createLLMProvider(name: string, baseUrl?: string): TextProvider {
  return providerRegistry.createLLMProvider(name, baseUrl);
}

/**
 * Create an ImageGenProvider instance
 */
export function createImageProvider(name: string, baseUrl?: string): ImageProvider {
  return providerRegistry.createImageProvider(name, baseUrl);
}

/**
 * Create an EmbeddingProvider instance
 */
export function createEmbeddingProvider(name: string, baseUrl?: string): EmbeddingProvider | LocalEmbeddingProvider {
  return providerRegistry.createEmbeddingProvider(name, baseUrl);
}

/**
 * Get provider metadata
 */
export function getProviderMetadata(name: string): ProviderMetadata | null {
  return providerRegistry.getProviderMetadata(name);
}

/**
 * Get all provider metadata
 */
export function getAllProviderMetadata(): ProviderMetadata[] {
  return providerRegistry.getAllProviderMetadata();
}

/**
 * Get attachment support for a provider
 */
export function getAttachmentSupport(name: string): AttachmentSupport | null {
  return providerRegistry.getAttachmentSupport(name);
}

/**
 * Get configuration requirements for a provider
 */
export function getConfigRequirements(name: string): ProviderConfigRequirements | null {
  return providerRegistry.getConfigRequirements(name);
}

/**
 * Get providers with a specific capability
 */
export function getProvidersByCapability(
  capability: keyof typeof DEFAULT_CAPABILITIES
): LLMProviderPlugin[] {
  return providerRegistry.getProvidersByCapability(capability);
}

/**
 * Check if provider supports a capability
 */
export function supportsCapability(
  name: string,
  capability: keyof typeof DEFAULT_CAPABILITIES
): boolean {
  return providerRegistry.supportsCapability(name, capability);
}

/**
 * Get providers with attachment support
 */
export function getProvidersWithAttachmentSupport(): LLMProviderPlugin[] {
  return providerRegistry.getProvidersWithAttachmentSupport();
}

/**
 * Get image provider constraints for a provider
 */
export function getImageProviderConstraints(name: string): ImageProviderConstraints | null {
  return providerRegistry.getImageProviderConstraints(name);
}

/**
 * Get the statically-declared image generation models for a provider.
 */
export function getImageGenerationModels(name: string): ImageGenerationModelInfo[] | null {
  return providerRegistry.getImageGenerationModels(name);
}

/**
 * Initialize the provider registry
 */
export async function initializeProviderRegistry(providers: LLMProviderPlugin[]): Promise<void> {
  return providerRegistry.initialize(providers);
}

/**
 * Get registry statistics
 */
export function getProviderRegistryStats() {
  return providerRegistry.getStats();
}

/**
 * Get registry errors
 */
export function getProviderRegistryErrors() {
  return providerRegistry.getErrors();
}

/**
 * Check if registry is initialized
 */
export function isProviderRegistryInitialized(): boolean {
  return providerRegistry.isInitialized();
}

// ============================================================================
// RUNTIME CONFIGURATION CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get message format support for a provider
 */
export function getMessageFormat(name: string): MessageFormatSupport {
  return providerRegistry.getMessageFormat(name);
}

/**
 * Get token estimation multiplier for a provider
 */
export function getCharsPerToken(name: string): number {
  return providerRegistry.getCharsPerToken(name);
}

/**
 * Get tool format type for a provider
 */
export function getToolFormat(name: string): ToolFormatType {
  return providerRegistry.getToolFormat(name);
}

/**
 * Get cheap model configuration for a provider
 */
export function getCheapModelConfig(name: string): CheapModelConfig | null {
  return providerRegistry.getCheapModelConfig(name);
}

/**
 * Get default context window for a provider
 */
export function getDefaultContextWindow(name: string): number {
  return providerRegistry.getDefaultContextWindow(name);
}

/**
 * Get model pricing from plugin's getModelInfo()
 */
export function getModelPricing(providerName: string, modelId: string): { input: number; output: number } | null {
  return providerRegistry.getModelPricing(providerName, modelId);
}

/**
 * Whether a connection profile will run a thinking turn (bug 85).
 */
export function profileRunsThinkingTurn(
  providerName: string | null | undefined,
  modelName: string | null | undefined,
  parameters: Record<string, unknown> | null | undefined
): boolean {
  return providerRegistry.profileRunsThinkingTurn(providerName, modelName, parameters);
}

/**
 * Hot-load a provider plugin from disk after installation
 */
export function hotLoadProviderPlugin(pluginPath: string, manifest: PluginManifest): boolean {
  return providerRegistry.hotLoadProviderPlugin(pluginPath, manifest);
}
