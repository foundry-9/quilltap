/**
 * Tools Module
 * Exports tool definitions, registry, handlers, and utilities
 */

export {
  getToolRegistry,
  resetToolRegistry,
  ToolRegistry,
  type ToolDefinition,
  type ToolContext,
} from './registry';

export {
  imageGenerationToolDefinition,
  anthropicImageGenerationToolDefinition,
  getOpenAIImageGenerationTool,
  getAnthropicImageGenerationTool,
  validateImageGenerationInput,
  getProviderConstraints,
  type ImageGenerationToolConfig,
  type ImageGenerationToolInput,
  type ImageGenerationToolOutput,
  type GeneratedImageResult,
} from './image-generation-tool';

export {
  executeImageGenerationTool,
  validateImageProfile,
  getDefaultImageProfile,
  ImageGenerationError,
  type ImageToolExecutionContext,
} from './handlers/image-generation-handler';
