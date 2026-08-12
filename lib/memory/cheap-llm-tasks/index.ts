/**
 * Cheap LLM Tasks Service
 *
 * Domain-focused barrel exports for background LLM tasks used by the memory,
 * chat, and image generation systems.
 */

// Types
export type {
  MemoryCandidate,
  ChatMessage,
  Attachment,
  CheapLLMTaskResult,
  UncensoredFallbackOptions,
  ImagePromptExpansionContext,
  DeriveSceneContextInput,
  SceneStateInput,
  StoryBackgroundPromptContext,
  CompressionResult,
  AppearanceResolutionItem,
  CharacterAppearanceInput,
} from './types'

// Memory tasks
export {
  extractSelfMemoriesFromTurn,
  extractOtherMemoriesFromTurn,
  batchExtractMemories,
  extractMemorySearchKeywords,
  summarizeMemoryRecap,
  extractEpisodesFromFold,
  FOLD_EPISODE_CAP,
} from './memory-tasks'
export type {
  OtherSubjectInput,
  OrientingContext,
  ExtractionClock,
  FoldEpisode,
  FoldEpisodeMessage,
  MemorySearchExtraction,
} from './memory-tasks'

// Canon block loader (used by the memory orchestrator to feed extractor prompts)
export {
  renderSelfCanonBlock,
  renderOtherCanonBlock,
  loadCanonForSelf,
  loadCanonForObserverAboutSubject,
  NO_CANON_FALLBACK,
  type CanonSource,
  type SelfCanon,
} from './canon'

// Chat tasks
export {
  summarizeChat,
  stripToolArtifacts,
  extractVisibleConversation,
  titleChat,
  titleHelpChat,
  considerHelpChatTitleUpdate,
  generateHelpChatTitleFromSummary,
  generateTitleFromSummary,
  considerTitleUpdate,
  updateContextSummary,
  foldChatSummary,
} from './chat-tasks'
export type { FoldSummaryInput } from './chat-tasks'

// Image and scene tasks
export {
  describeAttachment,
  craftImagePrompt,
  deriveSceneContext,
  updateSceneState,
  craftStoryBackgroundPrompt,
  resolveAppearance,
  sanitizeAppearance,
} from './image-scene-tasks'

// Compression tasks
export {
  compressConversationHistory,
  compressSystemPrompt,
  compressMemories,
} from './compression-tasks'
