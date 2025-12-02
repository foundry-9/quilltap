/**
 * Provider Plugin Interface
 *
 * Defines the contract that LLM provider plugins must implement.
 * This interface ensures consistency across all provider implementations
 * and provides metadata needed for UI rendering, configuration, and capability discovery.
 *
 * @module plugins/interfaces/provider-plugin
 */

import { logger } from '@/lib/logger';
import type { LLMProvider } from '@/lib/llm/base';
import type { ImageGenProvider } from '@/lib/image-gen/base';

/**
 * Provider metadata for UI display and identification
 *
 * @interface ProviderMetadata
 */
export interface ProviderMetadata {
  /** Internal identifier for the provider (e.g., 'OPENAI', 'ANTHROPIC') */
  providerName: string;

  /** Human-readable display name for UI (e.g., 'OpenAI', 'Anthropic') */
  displayName: string;

  /** Short description of the provider */
  description: string;

  /** Tailwind CSS color classes for UI styling */
  colors: {
    /** Background color class (e.g., 'bg-green-100') */
    bg: string;

    /** Text color class (e.g., 'text-green-800') */
    text: string;

    /** Icon color class (e.g., 'text-green-600') */
    icon: string;
  };

  /** Short abbreviation for icon display (e.g., 'OAI', 'ANT') */
  abbreviation: string;
}

/**
 * Attachment/file support configuration for a provider
 *
 * Describes what types of file attachments the provider can handle.
 *
 * @interface AttachmentSupport
 */
export interface AttachmentSupport {
  /** Whether this provider supports file attachments */
  supportsAttachments: boolean;

  /** Array of MIME types supported for attachments (empty if no support) */
  supportedMimeTypes: string[];

  /** Human-readable description of attachment support */
  description: string;

  /** Additional notes about attachment support or limitations */
  notes?: string;
}

/**
 * Configuration requirements for the provider
 *
 * Describes what configuration is needed to use this provider
 * (e.g., API key, base URL)
 *
 * @interface ProviderConfigRequirements
 */
export interface ProviderConfigRequirements {
  /** Whether this provider requires an API key */
  requiresApiKey: boolean;

  /** Whether this provider requires a custom base URL */
  requiresBaseUrl: boolean;

  /** Label text for API key input field */
  apiKeyLabel?: string;

  /** Label text for base URL input field */
  baseUrlLabel?: string;

  /** Default value for base URL (if applicable) */
  baseUrlDefault?: string;

  /** Placeholder text for base URL input */
  baseUrlPlaceholder?: string;
}

/**
 * Information about a specific model supported by the provider
 *
 * @interface ModelInfo
 */
export interface ModelInfo {
  /** Unique identifier for the model */
  id: string;

  /** Human-readable name of the model */
  name: string;

  /** Context window size (tokens) */
  contextWindow?: number;

  /** Maximum output tokens for this model */
  maxOutputTokens?: number;

  /** Whether this model supports image attachments */
  supportsImages?: boolean;

  /** Whether this model supports tool/function calling */
  supportsTools?: boolean;
}

/**
 * Information about an embedding model supported by the provider
 *
 * @interface EmbeddingModelInfo
 */
export interface EmbeddingModelInfo {
  /** Unique identifier for the embedding model */
  id: string;

  /** Human-readable name of the model */
  name: string;

  /** Dimensions of the embedding vector output */
  dimensions?: number;

  /** Description of the model's characteristics or use cases */
  description?: string;
}

/**
 * Provider capabilities configuration
 *
 * Describes what features/capabilities the provider supports
 *
 * @interface ProviderCapabilities
 */
export interface ProviderCapabilities {
  /** Whether the provider supports chat completions */
  chat: boolean;

  /** Whether the provider supports image generation */
  imageGeneration: boolean;

  /** Whether the provider supports text embeddings */
  embeddings: boolean;

  /** Whether the provider supports web search functionality */
  webSearch: boolean;
}

/**
 * Constraints for image generation providers
 *
 * Describes limitations and requirements for image generation,
 * allowing plugins to specify provider-specific constraints that
 * can be applied to tool definitions.
 *
 * @interface ImageProviderConstraints
 */
export interface ImageProviderConstraints {
  /** Maximum bytes allowed for image generation prompt (optional) */
  maxPromptBytes?: number;

  /** Human-readable warning message to include in tool description when this provider is used */
  promptConstraintWarning?: string;

  /** Maximum number of images that can be generated per request */
  maxImagesPerRequest?: number;

  /** Supported aspect ratios (e.g., ['1:1', '16:9', '9:16']) */
  supportedAspectRatios?: string[];

  /** Supported image sizes (e.g., ['1024x1024', '512x512']) */
  supportedSizes?: string[];
}

/**
 * Universal tool format for cross-provider compatibility
 * Standardizes on OpenAI's function calling format as the universal baseline
 *
 * @interface UniversalTool
 */
export interface UniversalTool {
  /** Indicates this is a function type tool (OpenAI format) */
  type: 'function';

  function: {
    /** Name of the tool/function */
    name: string;

    /** Description of what the tool does */
    description: string;

    /** Parameters schema in JSON Schema format */
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Options for tool formatting operations
 * Allows providers to customize formatting behavior
 *
 * @interface ToolFormatOptions
 */
export interface ToolFormatOptions {
  /** Image provider type for context-aware formatting */
  imageProviderType?: string;

  /** Allow additional custom options for provider-specific needs */
  [key: string]: unknown;
}

/**
 * Standardized tool call request format
 * Used consistently across all providers
 *
 * @interface ToolCallRequest
 */
export interface ToolCallRequest {
  /** Name of the tool being called */
  name: string;

  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
}

/**
 * Main LLM Provider Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded and used
 * by the Quilltap application to provide LLM functionality from various providers.
 *
 * @interface LLMProviderPlugin
 *
 * @example
 * ```typescript
 * const openaiPlugin: LLMProviderPlugin = {
 *   metadata: {
 *     providerName: 'OPENAI',
 *     displayName: 'OpenAI',
 *     description: 'OpenAI API provider for GPT models',
 *     colors: { bg: 'bg-green-100', text: 'text-green-800', icon: 'text-green-600' },
 *     abbreviation: 'OAI',
 *   },
 *   config: {
 *     requiresApiKey: true,
 *     requiresBaseUrl: false,
 *     apiKeyLabel: 'OpenAI API Key',
 *   },
 *   capabilities: {
 *     chat: true,
 *     imageGeneration: true,
 *     embeddings: true,
 *     webSearch: false,
 *   },
 *   attachmentSupport: {
 *     supportsAttachments: true,
 *     supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
 *     description: 'Images only (JPEG, PNG, GIF, WebP)',
 *   },
 *   createProvider: (baseUrl) => new OpenAIProvider(),
 *   getAvailableModels: async (apiKey) => [...],
 *   validateApiKey: async (apiKey) => {...},
 *   renderIcon: ({ className }) => <Icon className={className} />,
 * };
 * ```
 */
export interface LLMProviderPlugin {
  /**
   * Provider metadata for UI display and identification
   */
  metadata: ProviderMetadata;

  /**
   * Configuration requirements for this provider
   */
  config: ProviderConfigRequirements;

  /**
   * Supported capabilities for this provider
   */
  capabilities: ProviderCapabilities;

  /**
   * File attachment support information
   */
  attachmentSupport: AttachmentSupport;

  /**
   * Factory method to create an LLMProvider instance
   *
   * @param baseUrl Optional base URL for the provider (if applicable)
   * @returns An instantiated LLMProvider
   *
   * @example
   * ```typescript
   * const provider = plugin.createProvider('https://api.openai.com/v1');
   * ```
   */
  createProvider: (baseUrl?: string) => LLMProvider;

  /**
   * Factory method to create an ImageGenProvider instance (optional)
   *
   * Only required if `capabilities.imageGeneration` is true.
   *
   * @param baseUrl Optional base URL for the provider
   * @returns An instantiated ImageGenProvider
   */
  createImageProvider?: (baseUrl?: string) => ImageGenProvider;

  /**
   * Factory method to create an embedding provider instance (optional)
   *
   * Only required if `capabilities.embeddings` is true.
   *
   * @param baseUrl Optional base URL for the provider
   * @returns An instantiated embedding provider
   */
  createEmbeddingProvider?: (baseUrl?: string) => unknown;

  /**
   * Get list of available models for this provider
   *
   * May require an API key for the request. This method is called to populate
   * model selection dropdowns in the UI.
   *
   * @param apiKey The API key to use for authentication
   * @param baseUrl Optional base URL for the provider
   * @returns Promise resolving to array of model identifiers
   *
   * @throws Error if the API key is invalid or the request fails
   *
   * @example
   * ```typescript
   * const models = await plugin.getAvailableModels(apiKey);
   * // Returns: ['gpt-4', 'gpt-3.5-turbo', ...]
   * ```
   */
  getAvailableModels: (apiKey: string, baseUrl?: string) => Promise<string[]>;

  /**
   * Get static model information without requiring API calls
   *
   * This method returns cached or hardcoded information about models
   * supported by this provider. Useful for displaying model information
   * without needing to make an API call.
   *
   * @returns Array of ModelInfo objects (optional if expensive to compute)
   *
   * @example
   * ```typescript
   * const models = plugin.getModelInfo?.() || [];
   * // Returns: [
   * //   { id: 'gpt-4', name: 'GPT-4', contextWindow: 8192, ... },
   * //   { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', ... }
   * // ]
   * ```
   */
  getModelInfo?: () => ModelInfo[];

  /**
   * Get embedding models supported by this provider (OPTIONAL)
   *
   * Returns information about embedding models available from this provider.
   * Only applicable for providers where `capabilities.embeddings` is true.
   *
   * @returns Array of EmbeddingModelInfo objects
   *
   * @example
   * ```typescript
   * const embeddingModels = plugin.getEmbeddingModels?.() || [];
   * // Returns: [
   * //   { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimensions: 1536 },
   * //   ...
   * // ]
   * ```
   */
  getEmbeddingModels?: () => EmbeddingModelInfo[];

  /**
   * Validate an API key for this provider
   *
   * Should test the API key by making a minimal API call to verify
   * that it is valid and has proper permissions.
   *
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL for the provider
   * @returns Promise resolving to true if valid, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = await plugin.validateApiKey(apiKey);
   * ```
   */
  validateApiKey: (apiKey: string, baseUrl?: string) => Promise<boolean>;

  /**
   * Render the provider icon as a React component
   *
   * Returns a function that renders the provider's icon.
   * Called by the UI to display provider icons in various places.
   *
   * @param props Component props including optional className for styling
   * @returns JSX Element representing the provider icon
   *
   * @example
   * ```typescript
   * const Icon = plugin.renderIcon({ className: 'w-6 h-6' });
   * ```
   */
  renderIcon: (props: { className?: string }) => React.ReactNode;

  /**
   * Convert universal tool format to provider-specific format (OPTIONAL)
   *
   * Converts UniversalTool(s) (OpenAI format) to the provider's native tool format.
   * Used during request preparation to format tools for the provider's API.
   *
   * Supports both single tool and array of tools for flexibility.
   * Implementation can accept tools in any format (OpenAI format or generic objects)
   * and return provider-specific format.
   *
   * If not implemented, routes will handle formatting (for backwards compatibility).
   * Once all providers implement this, route-level formatting can be removed.
   *
   * @param tool Single tool or array of tools in OpenAI function format
   * @param options Optional formatting options
   * @returns Tool(s) formatted for this provider's API
   *
   * @example
   * ```typescript
   * // For Anthropic, converts OpenAI format to tool_use format (single tool)
   * const anthropicTool = plugin.formatTools?.(universalTool);
   *
   * // Or with array
   * const anthropicTools = plugin.formatTools?.(universalTools);
   * ```
   */
  formatTools?: (tool: any, options?: ToolFormatOptions) => any;

  /**
   * Parse provider-specific tool calls from response (OPTIONAL)
   *
   * Extracts tool call requests from the provider's native response format.
   * Used during response processing to detect and execute tool calls.
   *
   * If not implemented, routes will use detectToolCalls() from tool-executor.ts
   * (for backwards compatibility).
   * Once all providers implement this, centralized detection can be removed.
   *
   * @param response The raw response from the provider's API
   * @returns Array of tool call requests in universal format
   *
   * @example
   * ```typescript
   * // For OpenAI, extracts tool_calls array from response
   * const toolCalls = plugin.parseToolCalls?.(response);
   * ```
   */
  parseToolCalls?: (response: any) => ToolCallRequest[];

  /**
   * Get image provider constraints (OPTIONAL)
   *
   * Returns constraints and limitations for image generation with this provider.
   * Used by the tool builder to add appropriate warnings and constraints
   * to image generation tool definitions.
   *
   * Only applicable for providers where `capabilities.imageGeneration` is true.
   *
   * @returns ImageProviderConstraints object or undefined if no constraints
   *
   * @example
   * ```typescript
   * const constraints = plugin.getImageProviderConstraints?.();
   * // Returns: {
   * //   maxPromptBytes: 1024,
   * //   promptConstraintWarning: 'Keep prompts under 1024 bytes'
   * // }
   * ```
   */
  getImageProviderConstraints?: () => ImageProviderConstraints;
}

/**
 * Standard export type for provider plugins
 *
 * This is the expected export structure from plugin modules.
 *
 * @interface ProviderPluginExport
 *
 * @example
 * ```typescript
 * // In plugin-openai/index.ts
 * export const plugin: LLMProviderPlugin = { ... };
 *
 * // Or with the export type:
 * const pluginExport: ProviderPluginExport = {
 *   plugin: { ... }
 * };
 * export default pluginExport;
 * ```
 */
export interface ProviderPluginExport {
  /** The provider plugin instance */
  plugin: LLMProviderPlugin;
}

/**
 * Create a debug logger for provider plugin operations
 *
 * @param providerName The name of the provider for context
 * @returns A logger instance with provider context
 *
 * @internal
 */
export function createProviderLogger(providerName: string) {
  return logger.child({
    module: 'plugin-provider',
    provider: providerName,
  });
}
