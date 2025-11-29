/**
 * Memory System Module
 * Sprint 2+: Memory System Implementation
 *
 * This module provides memory management functionality for characters,
 * including automatic memory extraction, summarization, and context management.
 */

// Cheap LLM Tasks
export {
  extractMemoryFromMessage,
  summarizeChat,
  titleChat,
  updateContextSummary,
  describeAttachment,
  batchExtractMemories,
  considerTitleUpdate,
  type MemoryCandidate,
  type ChatMessage,
  type Attachment,
  type CheapLLMTaskResult,
} from './cheap-llm-tasks'

// Memory Processor (Sprint 3: Auto-Memory Formation)
export {
  processMessageForMemory,
  processMessageForMemoryAsync,
  batchProcessChatForMemories,
  type MemoryExtractionContext,
  type MemoryProcessingResult,
} from './memory-processor'

// Housekeeping (Sprint 6: Memory Cleanup)
export {
  runHousekeeping,
  getHousekeepingPreview,
  needsHousekeeping,
  type HousekeepingOptions,
  type HousekeepingResult,
  type HousekeepingDetail,
} from './housekeeping'
