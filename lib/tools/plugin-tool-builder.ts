/**
 * Plugin-Based Tool Builder
 *
 * Constructs provider-specific tools by:
 * 1. Taking provider name and enabled tool options
 * 2. Getting the plugin from the provider registry
 * 3. Building an array of universal tools based on what's enabled
 * 4. Calling the plugin's formatTools() method to convert to provider-specific format
 *
 * All provider plugins are expected to implement formatTools().
 *
 * @module tools/plugin-tool-builder
 */

import { logger } from '@/lib/logger';
import { getProvider, getImageProviderConstraints } from '@/lib/plugins/provider-registry';
import {
  imageGenerationToolDefinition,
  memorySearchToolDefinition,
  webSearchToolDefinition,
} from '@/lib/tools';
import type { UniversalTool, ImageProviderConstraints } from '@/lib/plugins/interfaces';

/**
 * Apply image provider constraints to the image generation tool
 *
 * If the image provider has a prompt constraint warning, it will be appended
 * to the prompt parameter's description.
 *
 * @param baseTool The base image generation tool definition
 * @param constraints The image provider constraints to apply
 * @param moduleLogger Logger instance for debug output
 * @returns Modified tool with constraints applied, or original tool if no constraints
 */
function applyImageConstraintsToTool(
  baseTool: UniversalTool,
  constraints: ImageProviderConstraints | null,
  moduleLogger: ReturnType<typeof logger.child>
): UniversalTool {
  if (!constraints?.promptConstraintWarning) {
    return baseTool;
  }

  moduleLogger.debug('Applying image provider constraints', {
    maxPromptBytes: constraints.maxPromptBytes,
  });

  const properties = baseTool.function.parameters.properties as Record<string, Record<string, string>>;
  const existingDescription = properties.prompt?.description || '';

  return {
    ...baseTool,
    function: {
      ...baseTool.function,
      parameters: {
        ...baseTool.function.parameters,
        properties: {
          ...baseTool.function.parameters.properties,
          prompt: {
            ...properties.prompt,
            description: existingDescription + ' ' + constraints.promptConstraintWarning,
          },
        },
      },
    },
  };
}

/**
 * Options for building tools for a provider
 */
export interface BuildToolsOptions {
  /** Whether to enable image generation tool */
  imageGeneration?: boolean;

  /** The image provider type (e.g., 'GROK', 'OPENAI') */
  imageProviderType?: string;

  /** Whether to enable memory search tool */
  memorySearch?: boolean;

  /** Whether to enable web search tool */
  webSearch?: boolean;
}

/**
 * Build tools for a specific provider using plugin-based formatting
 *
 * This function:
 * 1. Builds an array of universal tools based on enabled options
 * 2. Gets the provider plugin from the registry
 * 3. If the plugin has formatTools(), converts tools to provider-specific format
 * 4. If not, falls back to old behavior (returns tools in OpenAI format)
 *
 * @param providerName The provider name (e.g., 'OPENAI', 'ANTHROPIC', 'GOOGLE')
 * @param options Configuration for which tools to include
 * @returns Array of tools formatted for the provider (or empty array if no provider/tools)
 *
 * @example
 * ```typescript
 * const tools = buildToolsForProvider('OPENAI', {
 *   imageGeneration: true,
 *   imageProviderType: 'OPENAI',
 *   memorySearch: true,
 *   webSearch: true,
 * });
 * ```
 */
export function buildToolsForProvider(
  providerName: string,
  options: BuildToolsOptions
): unknown[] {
  const logger_ = logger.child({
    module: 'plugin-tool-builder',
    provider: providerName,
  });

  logger_.debug('Building tools for provider', {
    provider: providerName,
    options,
  });

  // Step 1: Build array of universal tools based on enabled options
  const universalTools: UniversalTool[] = [];

  // Add image generation tool if enabled
  if (options.imageGeneration) {
    const baseTool = imageGenerationToolDefinition as UniversalTool;
    const constraints = options.imageProviderType
      ? getImageProviderConstraints(options.imageProviderType)
      : null;

    const imageTool = applyImageConstraintsToTool(baseTool, constraints, logger_);
    universalTools.push(imageTool);
    logger_.debug('Added image generation tool');
  }

  // Add memory search tool if enabled
  if (options.memorySearch) {
    universalTools.push(memorySearchToolDefinition as UniversalTool);
    logger_.debug('Added memory search tool');
  }

  // Add web search tool if enabled
  if (options.webSearch) {
    universalTools.push(webSearchToolDefinition as UniversalTool);
    logger_.debug('Added web search tool');
  }

  // If no tools are enabled, return empty array
  if (universalTools.length === 0) {
    logger_.debug('No tools enabled');
    return [];
  }

  logger_.debug('Built universal tools', {
    toolCount: universalTools.length,
    tools: universalTools.map(t => t.function.name),
  });

  // Step 2: Get the provider plugin from registry
  const plugin = getProvider(providerName);

  if (!plugin) {
    logger_.warn('Provider not found in registry, returning tools in OpenAI format', {
      provider: providerName,
    });
    // Backwards compatibility: return tools in OpenAI format if provider not found
    return universalTools;
  }

  // Step 3 & 4: Check if plugin has formatTools() method
  if (plugin.formatTools && typeof plugin.formatTools === 'function') {
    try {
      logger_.debug('Using plugin.formatTools() to convert tools');

      // Call plugin's formatTools with the entire array of tools
      const formattedTools = plugin.formatTools(universalTools, {
        imageProviderType: options.imageProviderType,
      });

      logger_.debug('Tools formatted by plugin', {
        toolCount: formattedTools.length,
      });

      return formattedTools;
    } catch (error) {
      logger_.error('Error formatting tools with plugin, falling back to universal format', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Step 5: Fallback to old behavior (return tools in OpenAI format)
      logger_.debug('Returning tools in OpenAI format (backwards compatibility)');
      return universalTools;
    }
  }

  // Step 5: Plugin doesn't have formatTools, return tools in universal (OpenAI) format
  // All plugins should implement formatTools() - if not, log a warning
  logger_.warn('Plugin does not have formatTools(), returning tools in universal format', {
    provider: providerName,
  });

  return universalTools;
}
