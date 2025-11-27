/**
 * Tool Execution Handler for Chat
 * Detects and executes LLM tool calls during message processing
 */

import {
  executeImageGenerationTool,
  executeMemorySearchTool,
  formatMemorySearchResults,
  type ImageToolExecutionContext,
  type MemorySearchToolContext,
} from '@/lib/tools';

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
      const imageContext: ImageToolExecutionContext = {
        userId,
        profileId: imageProfileId,
        chatId,
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
 * Different providers format tool calls differently
 */
export function detectToolCalls(
  response: any,
  provider: string
): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    // OpenAI format - supports both direct tool_calls and nested in choices[0].message
    if (provider === 'OPENAI') {
      let toolCallsArray = response?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && response?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = response.choices[0].message.tool_calls;
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
    if (provider === 'ANTHROPIC' && response?.content) {
      for (const block of response.content) {
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
      let toolCallsArray = response?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && response?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = response.choices[0].message.tool_calls;
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
    if (provider === 'GOOGLE' && response?.candidates?.[0]?.content?.parts) {
      const parts = response.candidates[0].content.parts;
      for (const part of parts) {
        if (part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
          });
        }
      }
    }

    return toolCalls;
  } catch (error) {
    console.error('Error detecting tool calls:', error);
    return [];
  }
}
