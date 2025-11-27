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
  type MemoryCandidate,
  type ChatMessage,
  type Attachment,
  type CheapLLMTaskResult,
} from './cheap-llm-tasks'
