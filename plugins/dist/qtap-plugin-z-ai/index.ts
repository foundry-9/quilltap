/**
 * Z.AI Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion using Z.AI's GLM models (glm-4.6, glm-4.5 series, glm-4-32b-0414-128k)
 * - Vision capabilities (glm-4.5v, glm-4.6v family)
 * - Function calling / tool use
 * - Native web search via Z.AI's web_search tool
 * - Image generation using CogView-4 and GLM-Image
 */

import type { TextProviderPlugin, ImageProviderConstraints, ProviderOptionsSchema } from './types';
import { ZAIProvider } from './provider';
import { ZAIImageProvider } from './image-provider';
import { STATIC_MODELS, STATIC_CHAT_MODEL_IDS } from './models';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';
import { hasAnyXMLToolMarkers, parseAllXMLAsToolCalls, stripAllXMLToolMarkers } from '@quilltap/plugin-utils/tools';

const logger = createPluginLogger('qtap-plugin-z-ai');

/**
 * Image generation constraints for Z.AI's CogView / GLM-Image models.
 * Z.AI supports discrete recommended sizes rather than aspect ratios.
 * glm-image requires width/height in 1024-2048px, divisible by 32.
 * cogview-4 accepts 512-2048px, divisible by 16.
 */
const Z_AI_IMAGE_CONSTRAINTS: ImageProviderConstraints = {
  maxPromptBytes: 4000,
  promptConstraintWarning: 'Z.AI image prompts should stay under ~4000 characters for reliable results.',
  maxImagesPerRequest: 1,
  supportedSizes: [
    '1024x1024',
    '1280x1280',
    '1568x1056',
    '1056x1568',
    '1664x928',
    '928x1664',
    '1472x1104',
    '1104x1472',
  ],
  // Z.AI takes a concrete size (OpenAI-shaped HTTP). Portrait/landscape use the
  // 1056x1568 / 1568x1056 pair from the advertised set; square is 1024x1024.
  orientationSupport: {
    strategy: 'size',
    portrait: { size: '1056x1568', nominalWidth: 1056, nominalHeight: 1568 },
    landscape: { size: '1568x1056', nominalWidth: 1568, nominalHeight: 1056 },
    square: { size: '1024x1024', nominalWidth: 1024, nominalHeight: 1024 },
  },
};

const metadata = {
  providerName: 'Z_AI',
  displayName: 'Z.AI (GLM)',
  description: 'Z.AI GLM models with chat, vision, tool use, web search, and CogView image generation',
  colors: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    icon: 'text-emerald-600',
  },
  abbreviation: 'ZAI',
} as const;

const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'Z.AI API Key',
} as const;

const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: false,
  webSearch: true,
  toolUse: true,
} as const;

const attachmentSupport = {
  supportsAttachments: true as const,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as string[],
  description: 'Images (JPEG, PNG, GIF, WebP) — requires a vision model (e.g. glm-4.5v, glm-4.6v)',
  notes: 'Z.AI vision models accept image URLs or base64; limit 5MB per image, max 6000×6000 pixels.',
  maxBase64Size: 5 * 1024 * 1024,
};

const messageFormat = {
  supportsNameField: true,
  supportedRoles: ['user', 'assistant'] as ('user' | 'assistant')[],
  maxNameLength: 64,
};

const cheapModels = {
  defaultModel: 'glm-4.5-flash',
  recommendedModels: ['glm-4.5-flash', 'glm-4.5-air'],
};

/**
 * Connection-profile options rendered by the host's profile editor.
 *
 * `thinking` is stored as a flat string in `parameters`; the provider
 * normalizes it to Z.AI's wire shape (`{ type: 'enabled' | 'disabled' }`)
 * at request time in `applyProfileParameters`. GLM models stream their
 * chain-of-thought as `reasoning_content` ONLY when thinking is enabled —
 * with no toggle the Salon's thinking block stays empty.
 *
 * `reasoning_effort` dials back GLM-5.2's thinking effort. It is stored as a
 * flat enum string and forwarded verbatim, but ONLY on glm-5.2-and-newer
 * (the provider gates it). Left blank, glm-5.2 still gets `high` applied in
 * the provider — deliberately, to undo the API's expensive `max` default.
 */
const optionsSchema: ProviderOptionsSchema = {
  groups: [
    {
      title: 'Z.AI Options',
      helpText:
        "Thinking mode enables the GLM reasoning models' extended chain-of-thought, shown in the Salon (display only; never re-fed to the model). Only the hybrid-reasoning GLM models (glm-4.5/4.6 family, glm-5.x) produce it; with thinking off, nothing appears.",
      fields: [
        {
          key: 'thinking',
          label: 'Thinking Mode',
          type: 'enum',
          default: '',
          enumValues: [
            { value: '', label: '(model default)' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'disabled', label: 'Disabled' },
          ],
        },
        {
          key: 'reasoning_effort',
          label: 'Reasoning Effort',
          type: 'enum',
          default: '',
          helpText:
            "A dial for how hard glm-5.2 cogitates before it speaks (thinking must be lit; lesser models pay it no heed). Minimal all but silences the rumination; High and Max open the throttle — and mind that low and medium quietly fold up to High, xhigh up to Max. Leave it at (model default) and glm-5.2 still sets to High of its own accord, sparing you the API's spendthrift Max.",
          enumValues: [
            { value: '', label: '(model default)' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' },
          ],
        },
      ],
    },
  ],
};

export const plugin: TextProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      // Stylized "Z" glyph
      { d: 'M5 4h14v3l-9 10h9v3H5v-3l9-10H5V4z', fill: 'currentColor' },
    ],
  },

  config,

  capabilities,

  attachmentSupport,

  messageFormat,
  charsPerToken: 3.5,
  toolFormat: 'openai',
  cheapModels,
  defaultContextWindow: 131072,

  /**
   * Connection-profile options schema rendered by the host's profile editor.
   */
  getProviderOptionsSchema: () => optionsSchema,

  createProvider: (_baseUrl?: string) => {
    return new ZAIProvider();
  },

  createImageProvider: (_baseUrl?: string) => {
    return new ZAIImageProvider();
  },

  getAvailableModels: async (apiKey: string, _baseUrl?: string) => {
    try {
      const provider = new ZAIProvider();
      return await provider.getAvailableModels(apiKey);
    } catch (error) {
      logger.error(
        'Failed to fetch Z.AI models',
        { context: 'plugin.getAvailableModels' },
        error instanceof Error ? error : undefined
      );
      return [...STATIC_CHAT_MODEL_IDS].sort();
    }
  },

  validateApiKey: async (apiKey: string, _baseUrl?: string) => {
    try {
      const provider = new ZAIProvider();
      return await provider.validateApiKey(apiKey);
    } catch (error) {
      logger.error(
        'Error validating Z.AI API key',
        { context: 'plugin.validateApiKey' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  },

  /**
   * Static model info. Context windows below are per Z.AI's published
   * specifications where available; vision models have a reduced context
   * window relative to text-only siblings.
   */
  getModelInfo: () => STATIC_MODELS,

  /**
   * Z.AI uses OpenAI-compatible function tool format — pass through as-is.
   * Z.AI's native web_search tool is attached separately at send time
   * when params.webSearchEnabled is true.
   */
  formatTools: (
    tools: (OpenAIToolDefinition | Record<string, unknown>)[]
  ): OpenAIToolDefinition[] => {
    try {
      const formatted: OpenAIToolDefinition[] = [];
      for (const tool of tools) {
        if (!('function' in tool)) {
          logger.warn('Skipping tool with invalid format', { context: 'plugin.formatTools' });
          continue;
        }
        formatted.push(tool as OpenAIToolDefinition);
      }
      return formatted;
    } catch (error) {
      logger.error(
        'Error formatting tools for Z.AI',
        { context: 'plugin.formatTools' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  parseToolCalls: (response: unknown): ToolCallRequest[] => {
    try {
      return parseOpenAIToolCalls(response);
    } catch (error) {
      logger.error(
        'Error parsing tool calls from Z.AI response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  getImageProviderConstraints: (): ImageProviderConstraints => Z_AI_IMAGE_CONSTRAINTS,

  hasTextToolMarkers(text: string): boolean {
    return hasAnyXMLToolMarkers(text);
  },

  parseTextToolCalls(text: string): ToolCallRequest[] {
    try {
      return parseAllXMLAsToolCalls(text);
    } catch (error) {
      logger.error(
        'Error parsing text tool calls',
        { context: 'z-ai.parseTextToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  stripTextToolMarkers(text: string): string {
    return stripAllXMLToolMarkers(text);
  },
};

export default plugin;
