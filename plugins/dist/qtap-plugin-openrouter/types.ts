/**
 * Type exports for OpenRouter Plugin
 * Re-exports types from the core library for use within the plugin
 */

export type {
  FileAttachment,
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
} from '../../../lib/llm/base';

export type { LLMProvider } from '../../../lib/llm/base';
export type { ImageGenProvider } from '../../../lib/image-gen/base';
export type {
  LLMProviderPlugin,
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
} from '../../../lib/plugins/interfaces/provider-plugin';
