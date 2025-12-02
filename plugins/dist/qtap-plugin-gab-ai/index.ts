/**
 * Gab AI Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Gab AI language models
 * - Support for streaming responses
 * - Text-only interactions (no file attachments)
 */

import type { LLMProviderPlugin } from './types';
import { GabAIProvider } from './provider';
import { GabAIIcon } from './icon';
import { logger } from '../../../lib/logger';
import {
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '../../../lib/llm/tool-formatting-utils';

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'GAB_AI',
  displayName: 'Gab AI',
  description: 'Gab AI language models for chat completions',
  colors: {
    bg: 'bg-green-100',
    text: 'text-green-800',
    icon: 'text-green-600',
  },
  abbreviation: 'GAB',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Gab AI API Key',
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
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'No attachment support (text only)',
  notes: 'Gab AI does not currently support file attachments',
};

/**
 * The Gab AI Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  /**
   * Factory method to create a Gab AI LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    logger.debug('Creating Gab AI provider instance', { context: 'plugin.createProvider', baseUrl });
    return new GabAIProvider();
  },

  /**
   * Get list of available models from Gab AI API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Fetching available Gab AI models', { context: 'plugin.getAvailableModels' });
    try {
      const provider = new GabAIProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug('Successfully fetched Gab AI models', { context: 'plugin.getAvailableModels', count: models.length });
      return models;
    } catch (error) {
      logger.error('Failed to fetch Gab AI models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate a Gab AI API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Validating Gab AI API key', { context: 'plugin.validateApiKey' });
    try {
      const provider = new GabAIProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug('Gab AI API key validation result', { context: 'plugin.validateApiKey', isValid });
      return isValid;
    } catch (error) {
      logger.error('Error validating Gab AI API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about Gab AI models without needing API calls
   */
  getModelInfo: () => {
    logger.debug('Getting Gab AI model information', { context: 'plugin.getModelInfo' });
    return [
      {
        id: 'gab-01',
        name: 'Gab AI 01',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Render the Gab AI icon
   */
  renderIcon: (props) => {
    logger.debug('Rendering Gab AI icon', { context: 'plugin.renderIcon', className: props.className });
    return GabAIIcon(props);
  },

  /**
   * Format tools from OpenAI format to OpenAI format
   * Gab AI uses OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): OpenAIToolDefinition[] => {
    logger.debug('Formatting tools for Gab AI provider', {
      context: 'plugin.formatTools',
      toolCount: tools.length,
    });

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

      logger.debug('Successfully formatted tools', {
        context: 'plugin.formatTools',
        count: formattedTools.length,
      });

      return formattedTools;
    } catch (error) {
      logger.error(
        'Error formatting tools for Gab AI',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Gab AI response format
   * Extracts tool calls from Gab AI API responses (OpenAI format)
   *
   * @param response Gab AI API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    logger.debug('Parsing tool calls from Gab AI response', {
      context: 'plugin.parseToolCalls',
    });

    try {
      const toolCalls = parseOpenAIToolCalls(response);

      logger.debug('Successfully parsed tool calls', {
        context: 'plugin.parseToolCalls',
        count: toolCalls.length,
      });

      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Gab AI response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
