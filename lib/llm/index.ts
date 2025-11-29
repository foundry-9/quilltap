/**
 * LLM Module Exports
 *
 * Central export point for LLM-related functionality
 */

// Provider implementations
export { LLMProvider } from './base'
export { OpenAIProvider } from './openai'
export { AnthropicProvider } from './anthropic'
export { GoogleProvider } from './google'
export { GrokProvider } from './grok'
export { OllamaProvider } from './ollama'
export { OpenRouterProvider } from './openrouter'
export { OpenAICompatibleProvider } from './openai-compatible'
export { GabAIProvider } from './gab-ai'

// Factory
export { createLLMProvider, type ProviderName } from './factory'

// Types
export type {
  FileAttachment,
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
} from './base'

// Attachment support utilities
export {
  getSupportedMimeTypes,
  supportsFileAttachments,
  supportsMimeType,
  getSupportedFileTypes,
  getAttachmentSupportDescription,
  getFileExtensionForMimeType,
  MIME_TYPE_CATEGORIES,
  PROVIDER_ATTACHMENT_CAPABILITIES,
} from './attachment-support'

// Connection profile utilities
export {
  enrichConnectionProfileWithAttachmentSupport,
  enrichConnectionProfiles,
  profileSupportsMimeType,
  filterProfilesWithAttachmentSupport,
  filterProfilesBySupportedMimeType,
  getBestProfileForFile,
  groupProfilesByAttachmentSupport,
  type ConnectionProfileWithAttachmentSupport,
} from './connection-profile-utils'

// Image generation support
export {
  supportsImageGeneration,
  IMAGE_CAPABLE_PROVIDERS,
  type ImageCapableProvider,
} from './image-capable'

// Context and pricing utilities
export {
  getModelContextLimit,
  getSafeInputLimit,
  hasExtendedContext,
  getRecommendedContextAllocation,
  shouldSummarizeConversation,
  calculateRecentMessageCount,
} from './model-context-data'
