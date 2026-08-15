/**
 * Ollama Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using any Ollama-compatible model
 * - Support for local and remote Ollama servers
 * - Offline AI inference capabilities
 * - Support for multimodal models like llava
 * - Embeddings support through compatible models
 */

import type { TextProviderPlugin, EmbeddingModelInfo, ProviderOptionsSchema } from './types';
import { DEFAULT_REQUEST_TIMEOUT_SECONDS, OllamaProvider } from './provider';
import { OllamaEmbeddingProvider } from './embedding-provider';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';
import { hasAnyXMLToolMarkers, parseAllXMLAsToolCalls, stripAllXMLToolMarkers } from '@quilltap/plugin-utils/tools';

const logger = createPluginLogger('qtap-plugin-ollama');

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'OLLAMA',
  displayName: 'Ollama',
  description: 'Local Ollama LLM models for offline AI inference',
  colors: {
    bg: 'bg-gray-100',
    text: 'text-gray-800',
    icon: 'text-gray-600',
  },
  abbreviation: 'OLL',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: false,
  requiresBaseUrl: true,
  baseUrlLabel: 'Ollama Base URL',
  baseUrlDefault: 'http://localhost:11434',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: true,
  webSearch: false,
  // The provider forwards native tool definitions and normalizes tool_calls,
  // and modern local models (Qwen3 family, Llama 3.x, …) handle them. The
  // per-profile "Allow tool use" checkbox remains the gate; models without
  // template tool support can use the pseudo-tool (simple-json) format.
  toolUse: true,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'File attachments not yet supported (requires multimodal model detection)',
  notes: 'Multimodal models like llava can process images, but require model-specific implementation',
};

/**
 * Message format support for multi-character chats
 * Ollama is conservative - name support varies by model
 */
const messageFormat = {
  supportsNameField: false,
  supportedRoles: [] as ('user' | 'assistant')[],
};

/**
 * Cheap model configuration for background tasks
 */
const cheapModels = {
  defaultModel: 'llama3.2:3b',
  recommendedModels: ['llama3.2:3b', 'llama3.2:1b', 'phi3:mini', 'mistral:7b', 'gemma2:2b'],
};

/**
 * Connection-profile options schema rendered by the Quilltap host.
 * Both keys are stored in the profile's `parameters` blob and read back by the
 * provider off `LLMParams.profileParameters` at call time: `enable_thinking`
 * becomes Ollama's top-level `think` request parameter, and
 * `request_timeout_seconds` sets how long the provider waits on the endpoint.
 */
const optionsSchema: ProviderOptionsSchema = {
  groups: [
    {
      title: 'Ollama Options',
      fields: [
        {
          key: 'enable_thinking',
          label: 'Enable Thinking',
          type: 'boolean',
          default: false,
          helpText:
            'Let thinking-capable models (Qwen3, DeepSeek-R1, and kin) reason before answering. ' +
            'Reasoning streams into the thinking display rather than the reply. When off (the default), ' +
            'the model is asked to answer directly — best when you need clean output such as JSON. ' +
            'Either way, any <think> blocks that leak into the reply are routed to the thinking display.',
        },
        {
          key: 'request_timeout_seconds',
          label: 'Request Timeout (seconds)',
          type: 'number',
          default: DEFAULT_REQUEST_TIMEOUT_SECONDS,
          helpText:
            `How long to wait for the server before giving up (default ${DEFAULT_REQUEST_TIMEOUT_SECONDS}). ` +
            'While streaming this covers only the wait for the first token, so a long answer is never cut ' +
            'off mid-sentence — but loading a large model and reading a long prompt both happen before that ' +
            'first token. Raise it if big models on a busy machine abort with "operation was aborted"; ' +
            'lower it if you would rather a stalled server fail quickly. Leave blank for the default.',
        },
      ],
    },
  ],
};

/**
 * The Ollama Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: TextProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M7 2l2 5h6l2-5h-2l-1.5 3h-3L9 2H7zM12 8a6 6 0 100 12 6 6 0 000-12zm-2 4a1 1 0 110 2 1 1 0 010-2zm4 0a1 1 0 110 2 1 1 0 010-2z', fill: 'currentColor', fillRule: 'evenodd' },
    ],
  },

  config,

  capabilities,

  attachmentSupport,

  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai', // Ollama uses OpenAI-compatible format
  cheapModels,
  defaultContextWindow: 8192, // Conservative default for local models

  /**
   * Connection-profile options schema rendered by the host's profile editor.
   */
  getProviderOptionsSchema: () => optionsSchema,

  /**
   * Factory method to create an Ollama LLM provider instance
   * Requires baseUrl parameter for Ollama server connection
   */
  createProvider: (baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    return new OllamaProvider(url);
  },

  /**
   * Ollama does not support image generation
   */
  createImageProvider: (baseUrl?: string) => {
    throw new Error('Ollama does not support image generation');
  },

  /**
   * Factory method to create an Ollama embedding provider instance
   */
  createEmbeddingProvider: (baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    return new OllamaEmbeddingProvider(url);
  },

  /**
   * Get list of available models from Ollama server
   * No API key required, uses baseUrl to connect to local/remote Ollama instance
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    try {
      const provider = new OllamaProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      return models;
    } catch (error) {
      logger.error('Failed to fetch Ollama models', { context: 'plugin.getAvailableModels', baseUrl: url }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate Ollama server connection
   * Ollama doesn't use API keys, just verifies server is reachable
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    const url = baseUrl || config.baseUrlDefault;
    try {
      const provider = new OllamaProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      return isValid;
    } catch (error) {
      logger.error('Error validating Ollama server', { context: 'plugin.validateApiKey', baseUrl: url }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about common Ollama models
   */
  getModelInfo: () => {
    return [
      {
        id: 'llama2',
        name: 'Llama 2',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'neural-chat',
        name: 'Neural Chat',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'mistral',
        name: 'Mistral',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'llava',
        name: 'LLaVA (Vision)',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: true,
        supportsTools: false,
      },
      {
        id: 'dolphin-mixtral',
        name: 'Dolphin Mixtral',
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Get embedding models supported by Ollama
   * Returns static information about available embedding models
   */
  getEmbeddingModels: (): EmbeddingModelInfo[] => {
    return [
      {
        id: 'nomic-embed-text',
        name: 'Nomic Embed Text',
        dimensions: 768,
        description: 'High-quality open embedding model. Good balance of speed and accuracy.',
      },
      {
        id: 'mxbai-embed-large',
        name: 'MixedBread Embed Large',
        dimensions: 1024,
        description: 'Large embedding model with excellent performance.',
      },
      {
        id: 'all-minilm',
        name: 'All MiniLM',
        dimensions: 384,
        description: 'Fast and lightweight. Good for quick semantic search.',
      },
      {
        id: 'snowflake-arctic-embed',
        name: 'Snowflake Arctic Embed',
        dimensions: 1024,
        description: 'State-of-the-art retrieval embedding model.',
      },
    ];
  },

  /**
   * Render the Ollama icon
   */

  /**
   * Format tools from OpenAI format to OpenAI format
   * Ollama uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): OpenAIToolDefinition[] => {
    try {
      const formattedTools: OpenAIToolDefinition[] = [];

      for (const tool of tools) {
        // Validate tool has function property (OpenAI format)
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', {
            context: 'plugin.formatTools',
          });
          continue;
        }

        // Tools already in OpenAI format, pass through
        formattedTools.push(tool as OpenAIToolDefinition);
      }
      return formattedTools;
    } catch (error) {
      logger.error(
        'Error formatting tools for Ollama',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Ollama response format
   * Extracts tool calls from Ollama API responses (OpenAI format)
   *
   * @param response Ollama API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    try {
      const toolCalls = parseOpenAIToolCalls(response);
      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Ollama response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Detect spontaneous XML tool call markers in Ollama text responses
   * Checks all XML formats since local models are unpredictable
   */
  hasTextToolMarkers(text: string): boolean {
    return hasAnyXMLToolMarkers(text);
  },

  /**
   * Parse spontaneous XML tool calls from Ollama text responses
   */
  parseTextToolCalls(text: string): ToolCallRequest[] {
    try {
      const results = parseAllXMLAsToolCalls(text);
      return results;
    } catch (error) {
      logger.error(
        'Error parsing text tool calls',
        { context: 'ollama.parseTextToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Strip spontaneous XML tool call markers from Ollama text responses
   */
  stripTextToolMarkers(text: string): string {
    return stripAllXMLToolMarkers(text);
  },
};

export default plugin;
