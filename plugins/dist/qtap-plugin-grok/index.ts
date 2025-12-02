/**
 * Grok Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Grok-2 and other Grok models
 * - Image generation using grok-2-image
 * - Vision capabilities (image analysis)
 * - Function calling / tool use
 * - Web search integration (Live Search API)
 */

import type { LLMProviderPlugin, ImageProviderConstraints } from './types';
import { GrokProvider } from './provider';
import { GrokImageProvider } from './image-provider';
import { GrokIcon } from './icon';
import { logger } from '../../../lib/logger';
import {
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '../../../lib/llm/tool-formatting-utils';

/**
 * Grok image generation constraints
 * Grok has a strict 1024-byte limit for image generation prompts
 */
const GROK_IMAGE_CONSTRAINTS: ImageProviderConstraints = {
  maxPromptBytes: 1024,
  promptConstraintWarning: 'IMPORTANT: Grok has a strict limit of 1024 bytes for image generation prompts. Keep your prompt concise and under this limit.',
  supportedSizes: ['1024x1024'],
};

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'GROK',
  displayName: 'Grok (xAI)',
  description: 'Grok models by xAI with chat, vision, and image generation capabilities',
  colors: {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    icon: 'text-purple-600',
  },
  abbreviation: 'XAI',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Grok API Key',
} as const;

/**
 * Supported capabilities
 */
const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: false,
  webSearch: true,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: true as const,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as string[],
  description: 'Images only (JPEG, PNG, GIF, WebP)',
  notes: 'Images are supported in Grok models for vision capabilities',
};

/**
 * The Grok Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  /**
   * Factory method to create a Grok LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    logger.debug('Creating Grok provider instance', { context: 'plugin.createProvider', baseUrl });
    return new GrokProvider();
  },

  /**
   * Factory method to create a Grok image generation provider instance
   */
  createImageProvider: (baseUrl?: string) => {
    logger.debug('Creating Grok image provider instance', { context: 'plugin.createImageProvider', baseUrl });
    return new GrokImageProvider();
  },

  /**
   * Get list of available models from Grok API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Fetching available Grok models', { context: 'plugin.getAvailableModels' });
    try {
      const provider = new GrokProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug('Successfully fetched Grok models', { context: 'plugin.getAvailableModels', count: models.length });
      return models;
    } catch (error) {
      logger.error('Failed to fetch Grok models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate a Grok API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Validating Grok API key', { context: 'plugin.validateApiKey' });
    try {
      const provider = new GrokProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug('Grok API key validation result', { context: 'plugin.validateApiKey', isValid });
      return isValid;
    } catch (error) {
      logger.error('Error validating Grok API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about Grok models without needing API calls
   */
  getModelInfo: () => {
    return [
      {
        id: 'grok-2',
        name: 'Grok-2',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-2-vision-1212',
        name: 'Grok-2 Vision',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'grok-2-image',
        name: 'Grok-2 Image',
        contextWindow: 2048,
        maxOutputTokens: 1024,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Render the Grok icon
   */
  renderIcon: (props) => {
    logger.debug('Rendering Grok icon', { context: 'plugin.renderIcon', className: props.className });
    return GrokIcon(props);
  },

  /**
   * Format tools from OpenAI format to OpenAI format
   * Grok uses OpenAI format, tools pass through as-is
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in OpenAI format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): OpenAIToolDefinition[] => {
    logger.debug('Formatting tools for Grok provider', {
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
        'Error formatting tools for Grok',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Grok response format
   * Extracts tool calls from Grok API responses (OpenAI format)
   *
   * @param response Grok API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    logger.debug('Parsing tool calls from Grok response', {
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
        'Error parsing tool calls from Grok response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Get image provider constraints for Grok
   * Grok has specific limitations for image generation prompts
   *
   * @returns Image provider constraints including prompt byte limit
   */
  getImageProviderConstraints: (): ImageProviderConstraints => {
    logger.debug('Getting Grok image provider constraints', {
      context: 'plugin.getImageProviderConstraints',
    });
    return GROK_IMAGE_CONSTRAINTS;
  },
};

export default plugin;
