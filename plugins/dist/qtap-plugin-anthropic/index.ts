/**
 * Anthropic Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Claude models (Sonnet, Opus, Haiku)
 * - Vision capabilities (image and PDF analysis)
 * - Function calling / tool use
 */

import type { LLMProviderPlugin } from './types'
import { AnthropicProvider } from './provider'
import { AnthropicIcon } from './icon'
import { logger } from '../../../lib/logger'
import {
  convertOpenAIToAnthropicFormat,
  parseAnthropicToolCalls,
  type OpenAIToolDefinition,
  type AnthropicToolDefinition,
  type ToolCallRequest,
} from '../../../lib/llm/tool-formatting-utils'

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'ANTHROPIC',
  displayName: 'Anthropic',
  description: 'Anthropic Claude models with support for image and PDF analysis',
  colors: {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    icon: 'text-purple-600',
  },
  abbreviation: 'ANT',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Anthropic API Key',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: false,
  embeddings: false,
  webSearch: false,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: true as const,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'] as string[],
  description: 'Images (JPEG, PNG, GIF, WebP) and PDFs',
  notes: 'Images and PDFs are supported in Claude models for analysis and understanding',
};

/**
 * The Anthropic Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  /**
   * Factory method to create an Anthropic LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    logger.debug('Creating Anthropic provider instance', { context: 'plugin.createProvider', baseUrl });
    return new AnthropicProvider();
  },


  /**
   * Get list of available models from Anthropic
   * Anthropic doesn't provide a models endpoint, so we return known models
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Fetching available Anthropic models', { context: 'plugin.getAvailableModels' });
    try {
      const provider = new AnthropicProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug('Successfully fetched Anthropic models', { context: 'plugin.getAvailableModels', count: models.length });
      return models;
    } catch (error) {
      logger.error('Failed to fetch Anthropic models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate an Anthropic API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Validating Anthropic API key', { context: 'plugin.validateApiKey' });
    try {
      const provider = new AnthropicProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug('Anthropic API key validation result', { context: 'plugin.validateApiKey', isValid });
      return isValid;
    } catch (error) {
      logger.error('Error validating Anthropic API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about Claude models without needing API calls
   */
  getModelInfo: () => {
    logger.debug('Getting Claude model info', { context: 'plugin.getModelInfo' });
    return [
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'claude-haiku-4-5-20251015',
        name: 'Claude Haiku 4.5',
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'claude-opus-4-1-20250805',
        name: 'Claude Opus 4.1',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        contextWindow: 200000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
    ];
  },

  /**
   * Render the Anthropic icon
   */
  renderIcon: (props) => {
    logger.debug('Rendering Anthropic icon', { context: 'plugin.renderIcon', className: props.className });
    return AnthropicIcon(props);
  },

  /**
   * Format tools from OpenAI format to Anthropic format
   * Converts tool definitions to Anthropic's tool_use format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in Anthropic format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): AnthropicToolDefinition[] => {
    logger.debug('Formatting tools for Anthropic provider', {
      context: 'plugin.formatTools',
      toolCount: tools.length,
    });

    try {
      const formattedTools: AnthropicToolDefinition[] = [];

      for (const tool of tools) {
        // Validate tool has function property (OpenAI format)
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', {
            context: 'plugin.formatTools',
          });
          continue;
        }

        const openaiTool = tool as OpenAIToolDefinition;

        // Convert from OpenAI format to Anthropic format
        const anthropicTool = convertOpenAIToAnthropicFormat(openaiTool);
        formattedTools.push(anthropicTool);
      }

      logger.debug('Successfully formatted tools', {
        context: 'plugin.formatTools',
        count: formattedTools.length,
      });

      return formattedTools;
    } catch (error) {
      logger.error(
        'Error formatting tools for Anthropic',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Anthropic response format
   * Extracts tool use blocks and converts them to standardized ToolCallRequest format
   *
   * @param response Anthropic API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    logger.debug('Parsing tool calls from Anthropic response', {
      context: 'plugin.parseToolCalls',
    });

    try {
      const toolCalls = parseAnthropicToolCalls(response);

      logger.debug('Successfully parsed tool calls', {
        context: 'plugin.parseToolCalls',
        count: toolCalls.length,
      });

      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Anthropic response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
