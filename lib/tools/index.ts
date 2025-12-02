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

// Memory Search Tool (Sprint 6)
export {
  memorySearchToolDefinition,
  anthropicMemorySearchToolDefinition,
  getOpenAIMemorySearchTool,
  getAnthropicMemorySearchTool,
  getGoogleMemorySearchTool,
  validateMemorySearchInput,
  type MemorySearchToolInput,
  type MemorySearchToolOutput,
  type MemorySearchResult,
} from './memory-search-tool';

export {
  executeMemorySearchTool,
  formatMemorySearchResults,
  MemorySearchError,
  type MemorySearchToolContext,
} from './handlers/memory-search-handler';

// Web Search Tool
export {
  webSearchToolDefinition,
  anthropicWebSearchToolDefinition,
  getOpenAIWebSearchTool,
  getAnthropicWebSearchTool,
  getGoogleWebSearchTool,
  validateWebSearchInput,
  type WebSearchToolInput,
  type WebSearchToolOutput,
  type WebSearchResult,
} from './web-search-tool';

export {
  executeWebSearchTool,
  formatWebSearchResults,
  WebSearchError,
  type WebSearchToolContext,
} from './handlers/web-search-handler';

// Plugin-Based Tool Builder (Phase 3)
export {
  buildToolsForProvider,
  type BuildToolsOptions,
} from './plugin-tool-builder';
