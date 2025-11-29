/**
 * Chat Module
 * Sprint 5: Context Management
 *
 * Provides chat context management and intelligent context building.
 */

export {
  buildContext,
  buildSystemPrompt,
  calculateContextBudget,
  formatMemoriesForContext,
  formatSummaryForContext,
  selectRecentMessages,
  willExceedContextLimit,
  getContextStatus,
  type ContextMessage,
  type ContextBudget,
  type BuiltContext,
  type BuildContextOptions,
} from './context-manager'

export {
  generateContextSummary,
  generateContextSummaryAsync,
  chatNeedsSummary,
  clearContextSummary,
  checkAndGenerateSummaryIfNeeded,
  calculateInterchangeCount,
  shouldCheckTitleAtInterchange,
  type GenerateSummaryOptions,
  type SummaryGenerationResult,
} from './context-summary'
