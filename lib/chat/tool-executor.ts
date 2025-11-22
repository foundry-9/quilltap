/**
 * Tool Execution Handler for Chat
 * Detects and executes LLM tool calls during message processing
 */

import { executeImageGenerationTool, type ImageToolExecutionContext } from '@/lib/tools';

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
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
 * Execute an image generation tool call
 */
export async function executeToolCall(
  toolCall: ToolCallRequest,
  chatId: string,
  userId: string,
  imageProfileId?: string
): Promise<ToolResult> {
  try {
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
      const context: ImageToolExecutionContext = {
        userId,
        profileId: imageProfileId,
        chatId,
      };

      const result = await executeImageGenerationTool(toolCall.arguments, context);

      return {
        toolName: 'generate_image',
        success: result.success,
        result: result.success ? result.images : null,
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
    console.log('[TOOLS] detectToolCalls - provider:', provider);
    console.log('[TOOLS] detectToolCalls - response type:', typeof response);
    console.log('[TOOLS] detectToolCalls - response keys:', response ? Object.keys(response) : 'null/undefined');

    // OpenAI format - supports both direct tool_calls and nested in choices[0].message
    if (provider === 'OPENAI') {
      let toolCallsArray = response?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && response?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = response.choices[0].message.tool_calls;
        console.log('[TOOLS] detectToolCalls - OpenAI format detected (streaming structure)');
      } else if (toolCallsArray) {
        console.log('[TOOLS] detectToolCalls - OpenAI format detected (direct structure)');
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
      console.log('[TOOLS] detectToolCalls - Anthropic format detected');
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log('[TOOLS] detectToolCalls - Found tool_use block:', block.name);
          toolCalls.push({
            name: block.name,
            arguments: block.input || {},
          });
        }
      }
    }

    // Grok format (similar to OpenAI)
    if (provider === 'GROK' && response?.tool_calls) {
      console.log('[TOOLS] detectToolCalls - Grok format detected');
      for (const toolCall of response.tool_calls) {
        if (toolCall.type === 'function' && toolCall.function) {
          toolCalls.push({
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || '{}'),
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
