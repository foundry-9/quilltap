/**
 * LLM Module Exports
 *
 * Central export point for LLM-related functionality
 */

// Provider base class
export { LLMProvider } from './base'

// Factory (now uses plugin registry)
export { createLLMProvider, createImageProvider, getAllAvailableProviders, getAllAvailableImageProviders, isProviderFromPlugin } from './plugin-factory'

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
  getImageCapableProviders,
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
