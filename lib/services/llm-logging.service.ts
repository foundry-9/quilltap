/**
 * LLM Logging Service
 *
 * Central service for logging LLM API calls to the database.
 * Handles request/response summarization and respects user settings.
 *
 * @module services/llm-logging
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getAutonomousRunId } from '@/lib/background-jobs/autonomous-run-context';
import type {
  LLMLog,
  LLMLogType,
  LLMLogRequestSummary,
  LLMLogResponseSummary,
  LLMLogTokenUsage,
  LLMLogCacheUsage,
  LLMLogRequestHashes,
} from '@/lib/schemas/types';
import type { LLMLoggingSettings } from '@/lib/schemas/settings.types';

const logger = createServiceLogger('llm-logging');

const DEFAULT_LOGGING_SETTINGS: LLMLoggingSettings = {
  enabled: true,
  verboseMode: false,
  retentionDays: 30,
};

/**
 * Parameters for logging an LLM call
 */
export interface LogLLMCallParams {
  userId: string;
  type: LLMLogType;
  messageId?: string;
  chatId?: string;
  characterId?: string;
  provider: string;
  modelName: string;
  /**
   * The connection profile that served this call, when the call site has one
   * in hand. Lets the Almanack attribute usage/latency/cache figures to a
   * specific profile rather than guessing from (provider, modelName).
   */
  connectionProfileId?: string | null;
  /** The image profile that served this call (image-generation call sites). */
  imageProfileId?: string | null;
  request: {
    messages: Array<{
      role: string;
      content: string;
      attachments?: unknown[];
    }>;
    temperature?: number;
    maxTokens?: number;
    tools?: unknown[];
  };
  response: {
    content: string;
    error?: string;
    finishReason?: string | null;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  };
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  cacheUsage?: {
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  rawProviderUsage?: Record<string, unknown> | null;
  requestHashes?: LLMLogRequestHashes;
  durationMs?: number;
}

/**
 * Check if LLM logging is enabled for a user
 */
export async function isLoggingEnabled(userId: string): Promise<LLMLoggingSettings | null> {
  try {
    const repos = getRepositories();
    const settings = await repos.chatSettings.findByUserId(userId);

    // Return the settings if logging is enabled, null otherwise
    if (settings?.llmLoggingSettings?.enabled) {
      return settings.llmLoggingSettings;
    }

    // Default to enabled if settings don't exist yet
    if (!settings || !settings.llmLoggingSettings) {
      return DEFAULT_LOGGING_SETTINGS;
    }
    return null;
  } catch (error) {
    logger.warn('Failed to check LLM logging settings', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Default to enabled on error
    return DEFAULT_LOGGING_SETTINGS;
  }
}

/**
 * Summarize request messages for storage
 * Always stores full message content for debugging purposes
 */
function summarizeRequest(
  request: LogLLMCallParams['request']
): LLMLogRequestSummary {
  const messages = request.messages.map((msg) => ({
    role: msg.role,
    content: msg.content || '',
    contentLength: msg.content?.length || 0,
    hasAttachments: !!(msg.attachments && msg.attachments.length > 0),
  }));

  return {
    messageCount: request.messages.length,
    messages,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    toolCount: request.tools?.length || 0,
  };
}

/**
 * Summarize response for storage
 * Always stores full response content for debugging purposes
 */
function summarizeResponse(
  response: LogLLMCallParams['response']
): LLMLogResponseSummary {
  const summary: LLMLogResponseSummary = {
    content: response.content || '',
    contentLength: response.content?.length || 0,
    error: response.error ?? null,
    finishReason: response.finishReason ?? null,
  };

  if (response.toolCalls && response.toolCalls.length > 0) {
    summary.toolCalls = response.toolCalls.map(tc => ({
      name: tc.name,
      arguments: tc.arguments,
    }));
  }

  return summary;
}

/**
 * Log an LLM API call to the database
 *
 * @param params - The parameters for the log entry
 * @returns The created log entry, or null if logging is disabled or failed
 */
export async function logLLMCall(params: LogLLMCallParams): Promise<LLMLog | null> {
  try {
    // Check if logging is enabled for this user
    const loggingSettings = await isLoggingEnabled(params.userId);
    if (!loggingSettings) {
      return null;
    }

    // Summarize request and response
    const requestSummary = summarizeRequest(params.request);
    const responseSummary = summarizeResponse(params.response);

    // Build usage objects if provided
    let usage: LLMLogTokenUsage | null = null;
    if (
      params.usage?.promptTokens !== undefined ||
      params.usage?.completionTokens !== undefined ||
      params.usage?.totalTokens !== undefined
    ) {
      usage = {
        promptTokens: params.usage.promptTokens ?? 0,
        completionTokens: params.usage.completionTokens ?? 0,
        totalTokens: params.usage.totalTokens ?? 0,
      };
    }

    let cacheUsage: LLMLogCacheUsage | null = null;
    if (
      params.cacheUsage?.cacheCreationInputTokens !== undefined ||
      params.cacheUsage?.cacheReadInputTokens !== undefined
    ) {
      cacheUsage = {
        cacheCreationInputTokens: params.cacheUsage.cacheCreationInputTokens,
        cacheReadInputTokens: params.cacheUsage.cacheReadInputTokens,
      };
    }

    let requestHashes: LLMLogRequestHashes | null = null;
    if (
      params.requestHashes?.systemBlock1Hash !== undefined ||
      params.requestHashes?.systemBlock2Hash !== undefined ||
      params.requestHashes?.systemBlock3Hash !== undefined ||
      params.requestHashes?.toolsArrayHash !== undefined ||
      params.requestHashes?.historyTailHash !== undefined
    ) {
      requestHashes = { ...params.requestHashes };
    }

    const rawProviderUsage =
      params.rawProviderUsage !== undefined ? params.rawProviderUsage : null;

    // Create the log entry
    const repos = getRepositories();
    const logEntry = await repos.llmLogs.create({
      userId: params.userId,
      type: params.type,
      messageId: params.messageId ?? null,
      chatId: params.chatId ?? null,
      characterId: params.characterId ?? null,
      // Stamped from the ambient autonomous-run context (null outside an
      // autonomous turn). Lets the room budget sum spend by run id.
      autonomousRunId: getAutonomousRunId(),
      provider: params.provider,
      modelName: params.modelName,
      connectionProfileId: params.connectionProfileId ?? null,
      imageProfileId: params.imageProfileId ?? null,
      request: requestSummary,
      response: responseSummary,
      usage,
      cacheUsage,
      rawProviderUsage,
      requestHashes,
      durationMs: params.durationMs ?? null,
    });
    return logEntry;
  } catch (error) {
    logger.error('Failed to log LLM call', {
      userId: params.userId,
      type: params.type,
      provider: params.provider,
      model: params.modelName,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - logging failures shouldn't break the main flow
    return null;
  }
}

/**
 * Check if a message has any associated LLM logs
 */
export async function messageHasLogs(messageId: string): Promise<boolean> {
  try {
    const repos = getRepositories();
    const count = await repos.llmLogs.countByMessageId(messageId);

    const hasLogs = count > 0;
    return hasLogs;
  } catch (error) {
    logger.error('Failed to check if message has logs', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Get logs for a specific user with pagination
 */
export async function getLogsForUser(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<LLMLog[]> {
  try {
    const repos = getRepositories();
    const logs = await repos.llmLogs.findByUserId(userId, limit, offset);
    return logs;
  } catch (error) {
    logger.error('Failed to get logs for user', {
      userId,
      limit,
      offset,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get total token usage for a user
 */
export async function getTotalTokenUsage(
  userId: string
): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
  try {
    const repos = getRepositories();
    const usage = await repos.llmLogs.getTotalTokenUsage(userId);
    return usage;
  } catch (error) {
    logger.error('Failed to get total token usage for user', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

/**
 * Cleanup old logs for a user based on retention settings
 */
export async function cleanupOldLogs(userId: string, retentionDays: number): Promise<number> {
  try {
    const repos = getRepositories();
    const deletedCount = await repos.llmLogs.cleanupOldLogs(userId, retentionDays);

    logger.info('Cleaned up old logs for user', { userId, retentionDays, deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Failed to cleanup old logs for user', {
      userId,
      retentionDays,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Delete all logs for a user (for account cleanup)
 */
export async function deleteAllLogsForUser(userId: string): Promise<number> {
  try {
    const repos = getRepositories();
    const deletedCount = await repos.llmLogs.deleteByUserId(userId);

    logger.info('Deleted all logs for user', { userId, deletedCount });
    return deletedCount;
  } catch (error) {
    logger.error('Failed to delete all logs for user', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

