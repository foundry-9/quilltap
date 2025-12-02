/**
 * Google Gemini Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Gemini, Gemini 2.0, and other Google models
 * - Vision capabilities (image analysis)
 * - Image generation using Imagen models and Gemini image generation
 * - Function calling / tool use
 * - Web search integration via Google Search
 */

import type { LLMProviderPlugin } from './types';
import { GoogleProvider } from './provider';
import { GoogleImagenProvider } from './image-provider';
import { GoogleIcon } from './icon';
import { logger } from '../../../lib/logger';
import {
  convertOpenAIToGoogleFormat,
  parseGoogleToolCalls,
  type OpenAIToolDefinition,
  type GoogleToolDefinition,
  type ToolCallRequest,
} from '../../../lib/llm/tool-formatting-utils';

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'GOOGLE',
  displayName: 'Google Gemini',
  description: 'Google Gemini models including text and image generation via Generative AI API',
  colors: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    icon: 'text-blue-600',
  },
  abbreviation: 'GGL',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Google Generative AI API Key',
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
  notes: 'Images are supported in Gemini models for vision analysis',
};

/**
 * The Google Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 */
export const plugin: LLMProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  /**
   * Factory method to create a Google LLM provider instance
   */
  createProvider: (baseUrl?: string) => {
    logger.debug('Creating Google provider instance', { context: 'plugin.createProvider', baseUrl });
    return new GoogleProvider();
  },

  /**
   * Factory method to create a Google Imagen image generation provider instance
   */
  createImageProvider: (baseUrl?: string) => {
    logger.debug('Creating Google Imagen provider instance', { context: 'plugin.createImageProvider', baseUrl });
    return new GoogleImagenProvider();
  },

  /**
   * Get list of available models from Google API
   * Requires a valid API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Fetching available Google models', { context: 'plugin.getAvailableModels' });
    try {
      const provider = new GoogleProvider();
      const models = await provider.getAvailableModels(apiKey);
      logger.debug('Successfully fetched Google models', { context: 'plugin.getAvailableModels', count: models.length });
      return models;
    } catch (error) {
      logger.error('Failed to fetch Google models', { context: 'plugin.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  },

  /**
   * Validate a Google API key
   */
  validateApiKey: async (apiKey: string, baseUrl?: string) => {
    logger.debug('Validating Google API key', { context: 'plugin.validateApiKey' });
    try {
      const provider = new GoogleProvider();
      const isValid = await provider.validateApiKey(apiKey);
      logger.debug('Google API key validation result', { context: 'plugin.validateApiKey', isValid });
      return isValid;
    } catch (error) {
      logger.error('Error validating Google API key', { context: 'plugin.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  },

  /**
   * Get static model information
   * Returns cached information about Google models without needing API calls
   */
  getModelInfo: () => {
    logger.debug('Getting Google model information', { context: 'plugin.getModelInfo' });
    return [
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gemini-3-pro-image-preview',
        name: 'Gemini 3 Pro Image Preview',
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'gemini-pro-vision',
        name: 'Gemini Pro Vision',
        contextWindow: 32000,
        maxOutputTokens: 4096,
        supportsImages: true,
        supportsTools: true,
      },
      {
        id: 'imagen-4',
        name: 'Imagen 4',
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false,
      },
      {
        id: 'imagen-4-fast',
        name: 'Imagen 4 Fast',
        contextWindow: 0,
        maxOutputTokens: 0,
        supportsImages: false,
        supportsTools: false,
      },
    ];
  },

  /**
   * Render the Google icon
   */
  renderIcon: (props) => {
    logger.debug('Rendering Google icon', { context: 'plugin.renderIcon', className: props.className });
    return GoogleIcon(props);
  },

  /**
   * Format tools from OpenAI format to Google format
   * Converts tool definitions to Google's function calling format
   *
   * @param tools Array of tools in OpenAI format
   * @returns Array of tools in Google format
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[],
  ): GoogleToolDefinition[] => {
    logger.debug('Formatting tools for Google provider', {
      context: 'plugin.formatTools',
      toolCount: tools.length,
    });

    try {
      const formattedTools: GoogleToolDefinition[] = [];

      for (const tool of tools) {
        // Validate tool has function property (OpenAI format)
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', {
            context: 'plugin.formatTools',
          });
          continue;
        }

        const openaiTool = tool as OpenAIToolDefinition;

        // Convert from OpenAI format to Google format
        const googleTool = convertOpenAIToGoogleFormat(openaiTool);
        formattedTools.push(googleTool);
      }

      logger.debug('Successfully formatted tools', {
        context: 'plugin.formatTools',
        count: formattedTools.length,
      });

      return formattedTools;
    } catch (error) {
      logger.error(
        'Error formatting tools for Google',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Parse tool calls from Google response format
   * Extracts tool calls from Google Gemini API responses
   *
   * @param response Google API response object
   * @returns Array of tool call requests
   */
  parseToolCalls: (response: any): ToolCallRequest[] => {
    logger.debug('Parsing tool calls from Google response', {
      context: 'plugin.parseToolCalls',
    });

    try {
      const toolCalls = parseGoogleToolCalls(response);

      logger.debug('Successfully parsed tool calls', {
        context: 'plugin.parseToolCalls',
        count: toolCalls.length,
      });

      return toolCalls;
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Google response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },
};

export default plugin;
