/**
 * Tool Execution Handler for Chat
 * Detects and executes LLM tool calls during message processing
 */

import { logger } from '@/lib/logger'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import {
  executeImageGenerationTool,
  executeMemorySearchTool,
  formatMemorySearchResults,
  type ImageToolExecutionContext,
  type MemorySearchToolContext,
} from '@/lib/tools';
import {
  executeWebSearchTool,
  formatWebSearchResults,
  type WebSearchToolContext,
} from '@/lib/tools/handlers/web-search-handler';

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
  metadata?: {
    provider?: string;
    model?: string;
  };
}

/**
 * Extended context for tool execution
 */
export interface ToolExecutionContext {
  chatId: string;
  userId: string;
  imageProfileId?: string;
  characterId?: string;
  embeddingProfileId?: string;
  /** Participant ID of who is calling the tool (for {{me}} resolution in image prompts) */
  callingParticipantId?: string;
}

/**
 * Format tool result for inclusion in conversation context
 * Different LLM providers may have different formats
 */
export function formatToolResult(
  toolResult: ToolResult,
  provider: string
): { role: string; content: string } {
  const resultText = toolResult.success
    ? JSON.stringify(toolResult.result, null, 2)
    : `Error: ${toolResult.error || 'Unknown error'}`;

  // Different providers may want different formatting
  switch (provider) {
    case 'ANTHROPIC':
      // Anthropic expects tool results in a specific format
      return {
        role: 'user',
        content: `Tool Result: ${toolResult.toolName}\n\n${resultText}`,
      };

    case 'OPENAI':
      // OpenAI format
      return {
        role: 'user',
        content: `Tool Result: ${toolResult.toolName}\n\n${resultText}`,
      };

    default:
      return {
        role: 'user',
        content: `Tool Result: ${toolResult.toolName}\n\n${resultText}`,
      };
  }
}

/**
 * Execute a tool call (legacy signature for backwards compatibility)
 */
export async function executeToolCall(
  toolCall: ToolCallRequest,
  chatId: string,
  userId: string,
  imageProfileId?: string
): Promise<ToolResult> {
  return executeToolCallWithContext(toolCall, {
    chatId,
    userId,
    imageProfileId,
  });
}

/**
 * Execute a tool call with full context
 */
export async function executeToolCallWithContext(
  toolCall: ToolCallRequest,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const { chatId, userId, imageProfileId, characterId, embeddingProfileId } = context;

  try {
    // Handle image generation
    if (toolCall.name === 'generate_image') {
      // If no image profile is configured, return error
      if (!imageProfileId) {
        return {
          toolName: 'generate_image',
          success: false,
          result: null,
          error: 'Image generation is not enabled for this chat',
        };
      }

      // Execute image generation tool
      // Pass callingParticipantId so {{me}} resolves to the character (who's calling the tool)
      const imageContext: ImageToolExecutionContext = {
        userId,
        profileId: imageProfileId,
        chatId,
        callingParticipantId: context.callingParticipantId,
      };

      const result = await executeImageGenerationTool(toolCall.arguments, imageContext);

      return {
        toolName: 'generate_image',
        success: result.success,
        result: result.success ? result.images : null,
        error: result.success ? undefined : result.error,
        metadata: {
          provider: result.provider,
          model: result.model,
        },
      };
    }

    // Handle memory search
    if (toolCall.name === 'search_memories') {
      // If no character is configured, return error
      if (!characterId) {
        return {
          toolName: 'search_memories',
          success: false,
          result: null,
          error: 'Memory search requires a character context',
        };
      }

      // Execute memory search tool
      const memoryContext: MemorySearchToolContext = {
        userId,
        characterId,
        embeddingProfileId,
      };

      const result = await executeMemorySearchTool(toolCall.arguments, memoryContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.memories
        ? formatMemorySearchResults(result.memories)
        : result.error || 'No memories found';

      return {
        toolName: 'search_memories',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          memories: result.memories,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle web search
    if (toolCall.name === 'search_web') {
      // Execute web search tool
      const webSearchContext: WebSearchToolContext = {
        userId,
      };

      const result = await executeWebSearchTool(toolCall.arguments, webSearchContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.results
        ? formatWebSearchResults(result.results)
        : result.error || 'No search results found';

      return {
        toolName: 'search_web',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Unknown tool
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: `Unknown tool: ${toolCall.name}`,
    };
  } catch (error) {
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Detect tool calls in LLM response
 * Uses plugin's parseToolCalls method when available, with fallback to legacy detection
 */
export function detectToolCalls(
  response: unknown,
  provider: string
): ToolCallRequest[] {
  logger.debug('Detecting tool calls', { context: 'tool-executor', provider })

  try {
    // Try to use plugin's parseToolCalls method
    const plugin = providerRegistry.getProvider(provider)
    if (plugin?.parseToolCalls) {
      logger.debug('Using plugin parseToolCalls', { context: 'tool-executor', provider })
      const toolCalls = plugin.parseToolCalls(response)
      logger.debug('Detected tool calls via plugin', { context: 'tool-executor', count: toolCalls.length, provider })
      return toolCalls
    }

    // Fallback to legacy detection for backwards compatibility
    logger.debug('Plugin parseToolCalls not available, using fallback', { context: 'tool-executor', provider })

    const toolCalls: ToolCallRequest[] = [];

    // OpenAI format - supports both direct tool_calls and nested in choices[0].message
    if (provider === 'OPENAI') {
      let toolCallsArray = (response as any)?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && (response as any)?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = (response as any).choices[0].message.tool_calls;
      }

      if (toolCallsArray && toolCallsArray.length > 0) {
        for (const toolCall of toolCallsArray) {
          if (toolCall.type === 'function' && toolCall.function) {
            toolCalls.push({
              name: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments || '{}'),
            });
          }
        }
      }
    }

    // Anthropic format
    if (provider === 'ANTHROPIC' && (response as any)?.content) {
      for (const block of (response as any).content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name,
            arguments: block.input || {},
          });
        }
      }
    }

    // Grok format (similar to OpenAI)
    if (provider === 'GROK') {
      let toolCallsArray = (response as any)?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && (response as any)?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = (response as any).choices[0].message.tool_calls;
      }

      if (toolCallsArray && toolCallsArray.length > 0) {
        for (const toolCall of toolCallsArray) {
          if (toolCall.type === 'function' && toolCall.function) {
            toolCalls.push({
              name: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments || '{}'),
            });
          }
        }
      }
    }

    // Google/Gemini format
    if (provider === 'GOOGLE' && (response as any)?.candidates?.[0]?.content?.parts) {
      const parts = (response as any).candidates[0].content.parts;
      for (const part of parts) {
        if (part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
          });
        }
      }
    }

    logger.debug('Detected tool calls via fallback', { context: 'tool-executor', count: toolCalls.length, provider })
    return toolCalls;
  } catch (error) {
    logger.error('Error detecting tool calls', { context: 'tool-executor', provider }, error instanceof Error ? error : undefined);
    return [];
  }
}
