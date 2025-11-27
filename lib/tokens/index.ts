/**
 * Token Counting Module
 * Sprint 5: Context Management
 *
 * Provides token counting and estimation utilities for LLM context management.
 */

export {
  estimateTokens,
  countMessageTokens,
  countMessagesTokens,
  calculateAvailableResponseTokens,
  quickEstimateTokens,
  formatTokenCount,
  exceedsTokenLimit,
  truncateToTokenLimit,
  getContextUsagePercent,
  getContextWarningLevel,
} from './token-counter'
