/**
 * Tool Formatting Utilities
 *
 * Provides cross-provider tool format conversion and parsing utilities.
 * Abstracts provider-specific tool formats for use with different LLM providers.
 *
 * This module enables:
 * - Converting from universal (OpenAI) format to provider-specific formats
 * - Parsing provider-specific tool calls from LLM responses
 * - Applying provider-specific constraints (e.g., prompt length limits)
 *
 * @module llm/tool-formatting-utils
 */

import { logger } from '@/lib/logger';

/**
 * Universal tool format for cross-provider compatibility
 * Standardizes on OpenAI's function calling format as the universal baseline
 */
export interface UniversalTool {
  /** Indicates this is a function type tool (OpenAI format) */
  type: 'function';

  function: {
    /** Name of the tool/function */
    name: string;

    /** Description of what the tool does */
    description: string;

    /** Parameters schema in JSON Schema format */
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Options for tool formatting operations
 * Allows providers to customize formatting behavior
 */
export interface ToolFormatOptions {
  /** Image provider type for context-aware formatting */
  imageProviderType?: string;

  /** Allow additional custom options for provider-specific needs */
  [key: string]: unknown;
}

/**
 * Standardized tool call request format
 * Used consistently across all providers
 */
export interface ToolCallRequest {
  /** Name of the tool being called */
  name: string;

  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
}

/**
 * OpenAI format tool definition
 * Used as the universal baseline format for all tool conversions
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Anthropic format tool definition
 * Tool use format expected by Anthropic Claude models
 */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Google format tool definition
 * Function calling format expected by Google Gemini models
 */
export interface GoogleToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Convert OpenAI format tool to Anthropic format
 *
 * Anthropic uses a tool_use format with:
 * - name: string
 * - description: string
 * - input_schema: JSON schema object
 *
 * @param tool Universal tool in OpenAI format
 * @returns Tool formatted for Anthropic's tool_use
 *
 * @example
 * ```typescript
 * const anthropicTool = convertOpenAIToAnthropicFormat(universalTool);
 * // Returns: {
 * //   name: 'search_web',
 * //   description: 'Search the web',
 * //   input_schema: {
 * //     type: 'object',
 * //     properties: { query: { type: 'string' } },
 * //     required: ['query']
 * //   }
 * // }
 * ```
 */
export function convertOpenAIToAnthropicFormat(tool: UniversalTool): any {
  logger.debug('Converting tool to Anthropic format', {
    context: 'tool-formatting',
    toolName: tool.function.name,
  });

  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: 'object',
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required,
    },
  };
}

/**
 * Convert OpenAI format tool to Google Gemini format
 *
 * Google uses a function calling format with:
 * - name: string
 * - description: string
 * - parameters: JSON schema object
 *
 * @param tool Universal tool in OpenAI format
 * @returns Tool formatted for Google's functionCall
 *
 * @example
 * ```typescript
 * const googleTool = convertOpenAIToGoogleFormat(universalTool);
 * // Returns: {
 * //   name: 'search_web',
 * //   description: 'Search the web',
 * //   parameters: {
 * //     type: 'object',
 * //     properties: { query: { type: 'string' } },
 * //     required: ['query']
 * //   }
 * // }
 * ```
 */
export function convertOpenAIToGoogleFormat(tool: UniversalTool): any {
  logger.debug('Converting tool to Google format', {
    context: 'tool-formatting',
    toolName: tool.function.name,
  });

  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: {
      type: 'object',
      properties: tool.function.parameters.properties,
      required: tool.function.parameters.required,
    },
  };
}

/**
 * Apply prompt/description length limit to a tool
 *
 * Modifies a tool's description if it exceeds maxBytes, appending a warning
 * that the description was truncated. This is useful for providers with
 * strict token limits.
 *
 * @param tool Tool object (any format) with a description or name property
 * @param maxBytes Maximum bytes allowed for description (including warning)
 * @returns Modified tool with truncated description if needed
 *
 * @example
 * ```typescript
 * const limitedTool = applyPromptLengthLimit(tool, 500);
 * // If description > 500 bytes, truncates and adds warning
 * ```
 */
export function applyPromptLengthLimit(tool: any, maxBytes: number): any {
  if (!tool || !tool.description) {
    return tool;
  }

  const warningText = ' [Note: description truncated due to length limit]';
  const maxDescBytes = maxBytes - Buffer.byteLength(warningText);

  if (maxDescBytes <= 0) {
    logger.warn('Length limit too small for warning text', {
      context: 'tool-formatting',
      maxBytes,
    });
    return tool;
  }

  const descBytes = Buffer.byteLength(tool.description);

  if (descBytes > maxBytes) {
    logger.debug('Truncating tool description', {
      context: 'tool-formatting',
      toolName: tool.name,
      originalLength: descBytes,
      maxBytes,
    });

    // Truncate description to fit within the byte limit
    let truncated = tool.description;
    while (Buffer.byteLength(truncated) > maxDescBytes && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }

    return {
      ...tool,
      description: truncated + warningText,
    };
  }

  return tool;
}

/**
 * Apply Grok-specific prompt constraints to a tool
 *
 * Grok has specific requirements for tool descriptions when dealing with
 * image generation. This function applies any necessary constraints based
 * on the target format.
 *
 * Currently a pass-through for compatibility, but can be extended if
 * Grok-specific constraints are discovered.
 *
 * @param tool Tool object in any format (Anthropic, Google, OpenAI, etc.)
 * @param targetFormat The format the tool should remain in
 * @returns Tool with Grok constraints applied (may be modified)
 *
 * @example
 * ```typescript
 * const grokTool = applyGrokPromptConstraints(tool, 'anthropic');
 * ```
 */
export function applyGrokPromptConstraints(tool: any, targetFormat: string): any {
  logger.debug('Applying Grok constraints to tool', {
    context: 'tool-formatting',
    toolName: tool.name,
    targetFormat,
  });

  // Currently, Grok uses similar formats to OpenAI, so we pass through
  // This function exists as a placeholder for any future Grok-specific constraints
  return tool;
}

/**
 * Parse OpenAI format tool calls from LLM response
 *
 * Extracts tool calls from OpenAI/Grok API responses which return
 * tool_calls in the message object.
 *
 * @param response The raw response from provider API
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * const toolCalls = parseOpenAIToolCalls(response);
 * // Returns: [{ name: 'search_web', arguments: { query: 'hello' } }]
 * ```
 */
export function parseOpenAIToolCalls(response: any): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    // Handle direct tool_calls array
    let toolCallsArray = response?.tool_calls;

    // Check nested structure from streaming responses
    if (!toolCallsArray && response?.choices?.[0]?.message?.tool_calls) {
      toolCallsArray = response.choices[0].message.tool_calls;
    }

    if (toolCallsArray && Array.isArray(toolCallsArray) && toolCallsArray.length > 0) {
      for (const toolCall of toolCallsArray) {
        if (toolCall.type === 'function' && toolCall.function) {
          logger.debug('Parsed OpenAI tool call', {
            context: 'tool-parsing',
            toolName: toolCall.function.name,
          });

          toolCalls.push({
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || '{}'),
          });
        }
      }
    }
  } catch (error) {
    logger.error('Error parsing OpenAI tool calls', { context: 'tool-parsing' }, error instanceof Error ? error : undefined);
  }

  return toolCalls;
}

/**
 * Parse Anthropic format tool calls from LLM response
 *
 * Extracts tool calls from Anthropic API responses which return
 * tool_use blocks in the content array.
 *
 * @param response The raw response from provider API
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * const toolCalls = parseAnthropicToolCalls(response);
 * // Returns: [{ name: 'search_web', arguments: { query: 'hello' } }]
 * ```
 */
export function parseAnthropicToolCalls(response: any): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    if (!response?.content || !Array.isArray(response.content)) {
      return toolCalls;
    }

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        logger.debug('Parsed Anthropic tool call', {
          context: 'tool-parsing',
          toolName: block.name,
        });

        toolCalls.push({
          name: block.name,
          arguments: block.input || {},
        });
      }
    }
  } catch (error) {
    logger.error('Error parsing Anthropic tool calls', { context: 'tool-parsing' }, error instanceof Error ? error : undefined);
  }

  return toolCalls;
}

/**
 * Parse Google Gemini format tool calls from LLM response
 *
 * Extracts tool calls from Google Gemini API responses which return
 * functionCall objects in the parts array.
 *
 * @param response The raw response from provider API
 * @returns Array of parsed tool call requests
 *
 * @example
 * ```typescript
 * const toolCalls = parseGoogleToolCalls(response);
 * // Returns: [{ name: 'search_web', arguments: { query: 'hello' } }]
 * ```
 */
export function parseGoogleToolCalls(response: any): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  try {
    const parts = response?.candidates?.[0]?.content?.parts;

    if (!parts || !Array.isArray(parts)) {
      return toolCalls;
    }

    for (const part of parts) {
      if (part.functionCall) {
        logger.debug('Parsed Google tool call', {
          context: 'tool-parsing',
          toolName: part.functionCall.name,
        });

        toolCalls.push({
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }
  } catch (error) {
    logger.error('Error parsing Google tool calls', { context: 'tool-parsing' }, error instanceof Error ? error : undefined);
  }

  return toolCalls;
}
