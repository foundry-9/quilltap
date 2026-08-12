/**
 * Chat Message Service
 *
 * Barrel exports for the chat message service layer.
 */

// Types
export type {
  MessageServiceContext,
  SendMessageOptions,
  AttachedFile,
  ToolMessage,
  GeneratedImage,
  ToolProcessingResult,
  StreamingResult,
  StreamingState,
  CompressionContext,
  TriggerContext,
  NextSpeakerInfo,
  ProcessMessageResult,
  StreamChunkData,
} from './types'

// Orchestrator (main entry point)
export {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
} from './orchestrator.service'

// Request helpers (option-building + SSE response)
export {
  buildSendMessageOptions,
  buildContinueMessageOptions,
  sseStreamResponse,
  type SendMessageRequestExtras,
} from './request-helpers'

// Participant Resolution
export {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
  getActiveCharacterParticipants,
  type ParticipantResolutionResult,
  type AllParticipantsData,
} from './participant-resolver.service'

// Context Building
export {
  loadAndProcessFiles,
  buildConversationMessages,
  buildMessageContext,
  type BuildMessageContextOptions,
  type MessageContextResult,
  type FileProcessingResult,
} from './context-builder.service'

// Regenerate (swipe) — alternative-response generation through the context engine
export {
  regenerateMessageAsSwipe,
  type RegenerateSwipeOptions,
} from './regenerate-swipe.service'

// Tool Execution
export {
  processToolCalls,
  saveToolMessages,
  detectToolCallsInResponse,
  createToolContext,
  type StreamController,
} from './tool-execution.service'

// Streaming
export {
  buildTools,
  streamMessage,
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeContentChunk,
  encodeDoneEvent,
  encodeErrorEvent,
  encodeKeepAlive,
  safeEnqueue,
  safeClose,
  createStreamingResult,
  type StreamOptions,
  type StreamDebugInfo,
  type StreamChunkCallback,
} from './streaming.service'

// Tool mode support and native tool instructions
export {
  buildNativeToolSystemInstructions,
  determineEnabledToolOptions,
  type EnabledToolOptions,
} from './pseudo-tool.service'

// Memory Triggers
export {
  triggerTurnMemoryExtraction,
  triggerContextSummaryCheck,
  type MemoryChatSettings,
} from './memory-trigger.service'

// Per-turn transcript helpers
export {
  buildTurnTranscript,
  findTurnOpenerMessageId,
  type TurnTranscript,
  type TurnCharacterSlice,
} from './turn-transcript'
