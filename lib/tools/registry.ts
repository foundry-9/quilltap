/**
 * Tool Registry
 * Manages available tools and provides provider-specific tool definitions
 */

import { Provider } from '@prisma/client';

/**
 * Tool metadata and execution context
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
  handler?: (input: unknown, context: ToolContext) => Promise<unknown>;
}

/**
 * Context provided to tool handlers
 */
export interface ToolContext {
  userId: string;
  chatId?: string;
  config: Record<string, unknown>;
}

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a specific tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Convert tools to OpenAI format (function calling)
   */
  toOpenAIFormat() {
    return this.getAll().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Convert tools to Anthropic format
   */
  toAnthropicFormat() {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  /**
   * Convert tools to Google format (if applicable)
   * Currently uses a similar format to Anthropic
   */
  toGoogleFormat() {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Get tools in the format expected by a specific provider
   */
  toProviderFormat(provider: Provider) {
    switch (provider) {
      case 'OPENAI':
      case 'OPENAI_COMPATIBLE':
        return this.toOpenAIFormat();

      case 'ANTHROPIC':
        return this.toAnthropicFormat();

      case 'GROK':
        // xAI uses OpenAI-compatible format
        return this.toOpenAIFormat();

      case 'OLLAMA':
        // Ollama often uses OpenAI-compatible format
        return this.toOpenAIFormat();

      case 'OPENROUTER':
        // OpenRouter uses OpenAI format for function calling
        return this.toOpenAIFormat();

      case 'GAB_AI':
        // Gab AI format (check their documentation)
        return this.toOpenAIFormat();

      default:
        return [];
    }
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Singleton instance of the tool registry
 */
let toolRegistry: ToolRegistry | null = null;

/**
 * Get the global tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
  if (!toolRegistry) {
    toolRegistry = new ToolRegistry();
  }
  return toolRegistry;
}

/**
 * Reset the tool registry (useful for testing)
 */
export function resetToolRegistry(): void {
  toolRegistry = null;
}
