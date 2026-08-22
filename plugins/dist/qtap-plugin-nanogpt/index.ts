/**
 * NanoGPT Provider Plugin for Quilltap
 * Main entry point that exports the plugin configuration
 *
 * This plugin provides:
 * - Chat completion via NanoGPT's OpenAI-compatible gateway (600+ routed
 *   models: OpenAI, Anthropic, Google, open-weight hosts, and NanoGPT's own
 *   auto-model routers)
 * - Function / tool calling in the standard OpenAI format
 * - Reasoning display for routed thinking models (`reasoning_content`)
 * - Image generation via the OpenAI-compatible images route (Flux, HiDream,
 *   Recraft, and 200+ others)
 * - Text embeddings via the OpenAI-compatible embeddings route
 *
 * One NanoGPT API key covers all three capabilities.
 */

import type { TextProviderPlugin, ImageProviderConstraints, EmbeddingModelInfo } from './types';
import { NanoGPTProvider } from './provider';
import { NanoGPTImageProvider } from './image-provider';
import { NanoGPTEmbeddingProvider } from './embedding-provider';
import { STATIC_MODELS, STATIC_MODEL_IDS, STATIC_IMAGE_MODEL_IDS, STATIC_EMBEDDING_MODELS } from './models';
import {
  createPluginLogger,
  parseOpenAIToolCalls,
  type OpenAIToolDefinition,
  type ToolCallRequest,
} from '@quilltap/plugin-utils';
import {
  hasAnyXMLToolMarkers,
  parseAllXMLAsToolCalls,
  stripAllXMLToolMarkers,
} from '@quilltap/plugin-utils/tools';

const logger = createPluginLogger('qtap-plugin-nanogpt');

/**
 * Image generation constraints for NanoGPT's OpenAI-compatible images route.
 * NanoGPT takes a concrete `size` string; the sizes below are the ones the
 * default model (hidream) advertises, plus the 1536-wide pair the Flux and
 * GPT-Image families share. Portrait/landscape use hidream's native
 * 832x1248 / 1248x832 pair (≈2:3), which NanoGPT maps sensibly for models
 * with different native grids.
 */
const NANOGPT_IMAGE_CONSTRAINTS: ImageProviderConstraints = {
  maxImagesPerRequest: 1,
  supportedSizes: [
    '1024x1024',
    '768x1360',
    '1360x768',
    '880x1168',
    '1168x880',
    '1248x832',
    '832x1248',
    '1536x1024',
    '1024x1536',
  ],
  orientationSupport: {
    strategy: 'size',
    portrait: { size: '832x1248', nominalWidth: 832, nominalHeight: 1248 },
    landscape: { size: '1248x832', nominalWidth: 1248, nominalHeight: 832 },
    square: { size: '1024x1024', nominalWidth: 1024, nominalHeight: 1024 },
  },
};

const metadata = {
  providerName: 'NANOGPT',
  displayName: 'NanoGPT',
  description: 'NanoGPT pay-as-you-go gateway: chat, image generation, and embeddings behind one API key',
  colors: {
    bg: 'bg-violet-100',
    text: 'text-violet-800',
    icon: 'text-violet-600',
  },
  abbreviation: 'NGPT',
} as const;

const config = {
  requiresApiKey: true,
  requiresBaseUrl: false,
  apiKeyLabel: 'NanoGPT API Key',
} as const;

const capabilities = {
  chat: true,
  imageGeneration: true,
  embeddings: true,
  webSearch: false,
  toolUse: true,
} as const;

const attachmentSupport = {
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'NanoGPT chat requests are text-only in Quilltap; attachments are not forwarded',
};

const messageFormat = {
  supportsNameField: true,
  supportedRoles: ['user', 'assistant'] as ('user' | 'assistant')[],
  maxNameLength: 64,
};

const cheapModels = {
  defaultModel: 'openai/gpt-5-mini',
  recommendedModels: ['openai/gpt-5-mini', 'openai/gpt-5-nano', 'auto-model-basic'],
};

export const plugin: TextProviderPlugin = {
  metadata,

  icon: {
    viewBox: '0 0 24 24',
    paths: [
      // Ring and nucleus — a nod at the "nano" in NanoGPT
      {
        d: 'M12 4a8 8 0 110 16 8 8 0 010-16zm0 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
        fill: 'currentColor',
      },
      {
        d: 'M12 10a2 2 0 110 4 2 2 0 010-4z',
        fill: 'currentColor',
      },
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

  createProvider: (_baseUrl?: string) => {
    return new NanoGPTProvider();
  },

  createImageProvider: (_baseUrl?: string) => {
    return new NanoGPTImageProvider();
  },

  createEmbeddingProvider: (baseUrl?: string) => {
    return new NanoGPTEmbeddingProvider(baseUrl);
  },

  getAvailableModels: async (apiKey: string, _baseUrl?: string) => {
    try {
      const provider = new NanoGPTProvider();
      const dynamic = await provider.getAvailableModels(apiKey);
      // Merge the live /models output with the curated static catalog so the
      // chat picker keeps working if NanoGPT omits a flagship name.
      const merged = new Set<string>(dynamic);
      for (const id of STATIC_MODEL_IDS) merged.add(id);
      // Image models live in their own listing, but belt-and-braces: keep the
      // curated image ids out of the chat picker if they ever leak in.
      for (const id of STATIC_IMAGE_MODEL_IDS) merged.delete(id);
      return Array.from(merged).sort();
    } catch (error) {
      logger.error(
        'Failed to fetch NanoGPT models',
        { context: 'plugin.getAvailableModels' },
        error instanceof Error ? error : undefined
      );
      return [...STATIC_MODEL_IDS].sort();
    }
  },

  validateApiKey: async (apiKey: string, _baseUrl?: string) => {
    try {
      const provider = new NanoGPTProvider();
      return await provider.validateApiKey(apiKey);
    } catch (error) {
      logger.error(
        'Error validating NanoGPT API key',
        { context: 'plugin.validateApiKey' },
        error instanceof Error ? error : undefined
      );
      return false;
    }
  },

  getModelInfo: () => STATIC_MODELS,

  getEmbeddingModels: (): EmbeddingModelInfo[] => STATIC_EMBEDDING_MODELS,

  getImageProviderConstraints: (): ImageProviderConstraints => NANOGPT_IMAGE_CONSTRAINTS,

  /**
   * NanoGPT's API is OpenAI-compatible, so tools are passed through verbatim.
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
        'Error formatting tools for NanoGPT',
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
        'Error parsing tool calls from NanoGPT response',
        { context: 'plugin.parseToolCalls' },
        error instanceof Error ? error : undefined
      );
      return [];
    }
  },

  hasTextToolMarkers(text: string): boolean {
    return hasAnyXMLToolMarkers(text);
  },

  parseTextToolCalls(text: string): ToolCallRequest[] {
    try {
      return parseAllXMLAsToolCalls(text);
    } catch (error) {
      logger.error(
        'Error parsing text tool calls',
        { context: 'nanogpt.parseTextToolCalls' },
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
