/**
 * OpenAI-Compatible Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using OpenAI-compatible APIs
 * - Support for LM Studio, vLLM, Text Generation Web UI, and other compatible services
 * - Local and remote LLM deployments
 *
 * Key difference from OpenAI plugin: baseUrl is REQUIRED for configuration
 */

import type { LLMProviderPlugin } from './types';
import { OpenAICompatibleProvider } from './provider';
import { OpenAICompatibleIcon } from './icon';
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
  providerName: 'OPENAI_COMPATIBLE',
  displayName: 'OpenAI-Compatible',
  description: 'OpenAI-compatible API provider for local and remote LLM services',
  colors: {
    bg: 'bg-slate-100',
    text: 'text-slate-800',
    icon: 'text-slate-600',
  },
  abbreviation: 'OAC',
} as const;

/**
 * Configuration requirements
 * Note: baseUrl is REQUIRED for this provider
 */
const config = {
  requiresApiKey: false,
  requiresBaseUrl: true,
  apiKeyLabel: 'API Key (optional)',
  baseUrlLabel: 'Base URL',
  baseUrlPlaceholder: 'http://localhost:8080/v1',
  baseUrlDefault: 'http://localhost:8080/v1',
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
  description: 'File attachments are not supported. Attachment support varies by implementation.',
  notes: 'Some compatible implementations may support attachments; this is a conservative default.',
};

/**
 * The OpenAI-Compatible Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 *
 * KEY DIFFERENCE: This plugin REQUIRES a baseUrl parameter in createProvider
 * because it needs to know where the compatible API is running.
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  /**
   * Factory method to create an OpenAI-compatible LLM provider instance
   * IMPORTANT: baseUrl is REQUIRED for this provider
   */
  createProvider: (baseUrl?: string) => {
    if (!baseUrl) {
      const defaultUrl = 'http://localhost:8080/v1';
      logger.warn('No baseUrl provided for OpenAI-compatible provider, using default', {
        context: 'plugin.createProvider',
        defaultUrl,
      });
    }

    const url = baseUrl || 'http://localhost:8080/v1';
    logger.debug('Creating OpenAI-compatible provider instance', {
      context: 'plugin.createProvider',
      baseUrl: url,
    });
    return new OpenAICompatibleProvider(url);
  },

  /**
   * Get list of available models from the compatible API
   * Requires a valid base URL and optional API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Fetching available OpenAI-compatible models', {
      context: 'plugin.getAvailableModels',
      baseUrl,
    });
    try {
      const url = baseUrl || 'http://localhost:8080/v1';
      const provider = new OpenAICompatibleProvider(url);
      const models = await provider.getAvailableModels(apiKey);
      logger.debug('Successfully fetched OpenAI-compatible models', {
        context: 'plugin.getAvailableModels',
        count: models.length,
      });
      return models;
    } catch (error) {
      logger.error(
        'Failed to fetch OpenAI-compatible models',
        { context: 'plugin.getAvailableModels', baseUrl },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Validate an OpenAI-compatible API connection
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Validating OpenAI-compatible API connection', {
      context: 'plugin.validateApiKey',
      baseUrl,
    });
    try {
      const url = baseUrl || 'http://localhost:8080/v1';
      const provider = new OpenAICompatibleProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug('OpenAI-compatible API validation result', {
        context: 'plugin.validateApiKey',
        isValid,
      });
      return isValid;
    } catch (error) {
      logger.error(
        'Error validating OpenAI-compatible API connection',
        { context: 'plugin.validateApiKey', baseUrl },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  },

  /**
   * Get static model information
   * Returns generic information applicable to most compatible implementations
   */
  getModelInfo: () => {
    return [
      {
        id: 'default',
        name: 'Default Model',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Render the OpenAI-compatible icon
   */
  renderIcon: (props) => {
    logger.debug('Rendering OpenAI-compatible icon', {
      context: 'plugin.renderIcon',
      className: props.className,
    });
    return OpenAICompatibleIcon(props);
  },

  /**
   * Format tools from OpenAI format to OpenAI format
   * OpenAI-compatible providers use OpenAI format, with Grok constraints applied if needed
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): OpenAIToolDefinition[] => {
    logger.debug('Formatting tools for OpenAI-compatible provider', {
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
        'Error formatting tools for OpenAI-compatible',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from OpenAI-compatible response format
   * Extracts tool calls from OpenAI-compatible API responses (OpenAI format)
   *
   * @param response OpenAI-compatible API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    logger.debug('Parsing tool calls from OpenAI-compatible response', {
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
        'Error parsing tool calls from OpenAI-compatible response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
