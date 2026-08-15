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

import type { ProviderOptionsSchema, TextProviderPlugin } from './types';
import { OpenAICompatibleEndpointProvider } from './provider';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';
import { hasAnyXMLToolMarkers, parseAllXMLAsToolCalls, stripAllXMLToolMarkers } from '@quilltap/plugin-utils/tools';

const logger = createPluginLogger('qtap-plugin-openai-compatible');

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
  // Deliberately false: this provider points at an arbitrary user-supplied
  // endpoint, and assuming tool support would break every endpoint that lacks
  // it. The capability seeds a NEW profile's "Allow tool use" checkbox and
  // nothing more — a user whose endpoint does support tools (llama-server
  // --jinja, vLLM, LM Studio) can tick it, and the provider then sends `tools`
  // and parses `tool_calls` back. It is a default, not a ceiling.
  toolUse: false,
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
 * Message format support for multi-character chats
 * Assume OpenAI-compatible providers support the name field
 */
const messageFormat = {
  supportsNameField: true,
  supportedRoles: ['user', 'assistant'] as ('user' | 'assistant')[],
  maxNameLength: 64,
};

/**
 * Cheap model configuration for background tasks
 */
const cheapModels = {
  defaultModel: 'gpt-4o-mini',
  recommendedModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
};

/**
 * Connection-profile options schema rendered by the Quilltap host.
 *
 * Every key here is stored in the profile's `parameters` blob and read back off
 * `LLMParams.profileParameters` at call time through the provider's
 * `OPENAI_COMPATIBLE_PROFILE_PARAM_ALLOWLIST` — the two lists must stay in
 * step, or a field the editor draws goes nowhere.
 *
 * These are the settings a local runtime's model publisher specifies (Qwen3.8
 * asks for `top_k` and `min_p`; most instruct models name a repeat penalty),
 * none of which were reachable before Bug 71.
 */
const optionsSchema: ProviderOptionsSchema = {
  groups: [
    {
      title: 'Endpoint Options',
      helpText:
        'These are sent only when you fill them in. An endpoint that does not recognise a ' +
        'setting generally ignores it, so leave anything your server does not support blank.',
      fields: [
        {
          key: 'reasoning_effort',
          label: 'Reasoning Effort',
          type: 'enum',
          default: '',
          enumValues: [
            { value: '', label: 'Model default', description: 'Send nothing; the model decides' },
            { value: 'none', label: 'None', description: 'Answer without reasoning' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Extra high', description: 'Longest reasoning, slowest replies' },
          ],
          helpText:
            'How long a reasoning model may think before answering. On a machine where every token ' +
            'costs wall-clock time this is the largest speed control you have. Only models whose ' +
            'chat template understands reasoning levels will act on it.',
        },
        {
          key: 'top_k',
          label: 'Top K',
          type: 'number',
          helpText:
            'Keep only the K most likely next tokens. Qwen3 and kin ask for 20. Leave blank for the model default.',
        },
        {
          key: 'min_p',
          label: 'Min P',
          type: 'number',
          helpText:
            'Drop tokens less likely than this fraction of the best one. Qwen3 and kin ask for 0. Leave blank for the model default.',
        },
        {
          key: 'repeat_penalty',
          label: 'Repeat Penalty',
          type: 'number',
          helpText:
            'Penalty applied to tokens already used. Above 1 discourages repetition; 1 disables it.',
        },
        {
          key: 'presence_penalty',
          label: 'Presence Penalty',
          type: 'number',
          helpText:
            'Discourages tokens that have appeared at all. Some publishers recommend a value here for ' +
            'non-thinking mode (Qwen3.8 asks for 1.5).',
        },
        {
          key: 'frequency_penalty',
          label: 'Frequency Penalty',
          type: 'number',
          helpText: 'Discourages tokens in proportion to how often they have already appeared.',
        },
        {
          key: 'seed',
          label: 'Seed',
          type: 'number',
          helpText:
            'Fixes the sampler so the same prompt gives the same answer. Leave blank for a fresh roll each turn.',
        },
        {
          key: 'cache_prompt',
          label: 'Reuse Cached Prompt',
          type: 'boolean',
          helpText:
            'Let the server reuse the part of the prompt it has already processed. llama-server does this ' +
            'by default — this is an escape hatch for servers that do not, and you can leave it alone.',
        },
      ],
    },
  ],
};

/**
 * The OpenAI-Compatible Provider Plugin
 * Implements the LLMProviderPlugin interface for Quilltap
 *
 * KEY DIFFERENCE: This plugin REQUIRES a baseUrl parameter in createProvider
 * because it needs to know where the compatible API is running.
 */
export const plugin: TextProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M8 2v6H6v3c0 2.2 1.8 4 4 4v5h4v-5c2.2 0 4-1.8 4-4V8h-2V2h-2v6h-4V2H8z', fill: 'currentColor' },
    ],
  },

  config,

  capabilities,

  attachmentSupport,

  // Runtime configuration
  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai',
  cheapModels,
  defaultContextWindow: 8192, // Conservative default for unknown implementations

  /**
   * Connection-profile options schema rendered by the host's profile editor.
   */
  getProviderOptionsSchema: () => optionsSchema,

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
    return new OpenAICompatibleEndpointProvider(url);
  },

  /**
   * Get list of available models from the compatible API
   * Requires a valid base URL and optional API key
   */
  getAvailableModels: async (apiKey: string, baseUrl?: string) => {
    try {
      const url = baseUrl || 'http://localhost:8080/v1';
      const provider = new OpenAICompatibleEndpointProvider(url);
      const models = await provider.getAvailableModels(apiKey);
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
    try {
      const url = baseUrl || 'http://localhost:8080/v1';
      const provider = new OpenAICompatibleEndpointProvider(url);
      const isValid = await provider.validateApiKey(apiKey);
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
    try {
      const toolCalls = parseOpenAIToolCalls(response);
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

  /**
   * Detect spontaneous XML tool call markers in OpenAI-compatible text responses
   * Checks all XML formats since unknown endpoints are unpredictable
   */
  hasTextToolMarkers(text: string): boolean {
    return hasAnyXMLToolMarkers(text);
  },

  /**
   * Parse spontaneous XML tool calls from OpenAI-compatible text responses
   */
  parseTextToolCalls(text: string): ToolCallRequest[] {
    try {
      const results = parseAllXMLAsToolCalls(text);
      return results;
    } catch (error) {
      logger.error(
        'Error parsing text tool calls',
        { context: 'openai-compatible.parseTextToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  /**
   * Strip spontaneous XML tool call markers from OpenAI-compatible text responses
   */
  stripTextToolMarkers(text: string): string {
    return stripAllXMLToolMarkers(text);
  },
};

export default plugin;
