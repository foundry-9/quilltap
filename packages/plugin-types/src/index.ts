/**
 * @quilltap/plugin-types
 *
 * Type definitions for Quilltap plugin development.
 *
 * This package provides TypeScript types and interfaces for building
 * Quilltap plugins, including LLM providers, authentication providers,
 * and utility plugins.
 *
 * @packageDocumentation
 * @module @quilltap/plugin-types
 */

// ============================================================================
// Provider Interfaces — The Four Canonical Shapes
// ============================================================================

export type {
  // Shape 1: Text -> Text
  TextProvider,
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,
  LLMResponse,
  StreamChunk,

  // Shape 2: Text -> Image
  ImageProvider,
  ImageOrientation,
  ImageGenParams,
  ImageLoraSpec,
  GeneratedImage,
  ImageGenResponse,

  // Shape 3: Text -> Vector
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingOptions,
  LocalEmbeddingProviderState,
  LocalEmbeddingProvider,

  // Shape 4: Text + Candidates -> Scores
  ScoringProvider,
  ScoringTask,
  ScoringInput,
  CategoryScore,
  ScoringResult,

  // Common types shared across shapes
  FileAttachment,
  TokenUsage,
  CacheUsage,
  AttachmentResults,
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,
} from './providers';

export { isLocalEmbeddingProvider } from './providers';

// ============================================================================
// Deprecated Provider Aliases (backward compatibility)
// ============================================================================

/**
 * @deprecated Use `TextProvider` instead
 */
export type { TextProvider as LLMProvider } from './providers';

/**
 * @deprecated Use `ImageProvider` instead
 */
export type { ImageProvider as ImageGenProvider } from './providers';

// ============================================================================
// LLM Tool Types
// ============================================================================

export type {
  // Tool definitions
  OpenAIToolDefinition,
  UniversalTool,
  AnthropicToolDefinition,
  GoogleToolDefinition,

  // Tool calls
  ToolCall,
  ToolCallRequest,
  ToolResult,
  ToolFormatOptions,
} from './llm/tools';

// ============================================================================
// Plugin Types
// ============================================================================

export type {
  // Text provider plugin types (primary)
  TextProviderPlugin,
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
  ThinkingTurnRule,
  EmbeddingModelInfo,
  ImageGenerationModelInfo,
  ImageStyleInfo,
  ImageLoraSupport,
  ImageProviderConstraints,
  OrientationStrategy,
  OrientationMapping,
  ImageOrientationSupport,
  IconProps,
  PluginIconData,
  ProviderPluginExport,
  // Runtime configuration types
  MessageFormatSupport,
  CheapModelConfig,
  ToolFormatType,
  // Deprecated alias
  LLMProviderPlugin,
} from './plugins/provider';

export type {
  // Provider options schema (rendered by the connection-profile editor)
  ProviderOptionFieldType,
  ProviderOptionEnumValue,
  ProviderOptionDirective,
  ProviderOptionShowIf,
  ProviderOptionField,
  ProviderOptionGroup,
  ProviderOptionsSchema,
  ProviderOptionsSchemaContext,
} from './plugins/provider-options';

export type {
  // Scoring provider plugin types (primary)
  ScoringProviderMetadata,
  ScoringProviderConfigRequirements,
  ScoringProviderPlugin,
  ScoringProviderPluginExport,
} from './plugins/scoring-provider';

export type {
  // Manifest types
  PluginCapability,
  PluginCategory,
  PluginStatus,
  PluginAuthor,
  PluginCompatibility,
  ProviderConfig,
  SearchProviderConfig,
  PluginPermissions,
  PluginManifest,
  InstalledPluginInfo,
} from './plugins/manifest';

export type {
  // Theme plugin types
  ColorPalette,
  Typography,
  Spacing,
  Effects,
  ThemeTokens,
  FontDefinition,
  EmbeddedFont,
  ThemeMetadata,
  SubsystemOverrides,
  ThemePlugin,
  ThemePluginExport,
} from './plugins/theme';

export type {
  // Roleplay template plugin types
  NarrationDelimiters,
  RoleplayTemplateConfig,
  RoleplayTemplateMetadata,
  RoleplayTemplatePlugin,
  RoleplayTemplatePluginExport,
} from './plugins/roleplay-template';

export type {
  // System prompt plugin types
  SystemPromptData,
  SystemPromptMetadata,
  SystemPromptPlugin,
  SystemPromptPluginExport,
} from './plugins/system-prompt';

export type {
  // Tool plugin types
  ToolMetadata,
  ToolHierarchyInfo,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolPlugin,
  ToolPluginExport,
} from './plugins/tool';

export type {
  // Search provider plugin types
  SearchProviderMetadata,
  SearchProviderConfigRequirements,
  SearchResult,
  SearchOutput,
  SearchProviderPlugin,
  SearchProviderPluginExport,
} from './plugins/search-provider';

export type {
  // Moderation provider plugin types (deprecated, use scoring)
  ModerationProviderMetadata,
  ModerationProviderConfigRequirements,
  ModerationCategoryResult,
  ModerationResult,
  ModerationProviderPlugin,
  ModerationProviderPluginExport,
} from './plugins/moderation-provider';

// ============================================================================
// Common Types
// ============================================================================

export type { LogLevel, LogContext, PluginLogger } from './common/logger';

export type {
  CharacterPluginDataEntry,
  CharacterPluginDataMap,
} from './common/character-plugin-data';

// Error classes (these are values, not just types)
export {
  PluginError,
  ApiKeyError,
  ProviderApiError,
  RateLimitError,
  ConfigurationError,
  ModelNotFoundError,
  AttachmentError,
  ToolExecutionError,
} from './common/errors';

// Logger factories
export { createConsoleLogger, createNoopLogger } from './common/logger';

// ============================================================================
// Version
// ============================================================================

/**
 * Version of the plugin-types package.
 * Can be used at runtime to check compatibility.
 */
export const PLUGIN_TYPES_VERSION = '2.6.0';
