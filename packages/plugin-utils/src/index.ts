/**
 * @quilltap/plugin-utils
 *
 * Utility functions for Quilltap plugin development.
 *
 * This package provides runtime utilities that complement the type definitions
 * in @quilltap/plugin-types. It includes:
 *
 * - **Tool Parsing**: Parse tool calls from any LLM provider's response format
 * - **Tool Conversion**: Convert between OpenAI, Anthropic, and Google tool formats
 * - **Logger Bridge**: Logging that integrates with Quilltap's core or runs standalone
 *
 * @packageDocumentation
 * @module @quilltap/plugin-utils
 */

// ============================================================================
// Tool Utilities
// ============================================================================

export {
  // Parsers
  parseToolCalls,
  parseOpenAIToolCalls,
  parseAnthropicToolCalls,
  parseGoogleToolCalls,
  detectToolCallFormat,
  hasToolCalls,

  // Converters
  convertToAnthropicFormat,
  convertToGoogleFormat,
  convertFromAnthropicFormat,
  convertFromGoogleFormat,
  convertToolTo,
  convertToolsTo,
  applyDescriptionLimit,
  // Backward-compatible aliases
  convertOpenAIToAnthropicFormat,
  convertOpenAIToGoogleFormat,
} from './tools';

export type {
  // Tool types (re-exported from plugin-types)
  OpenAIToolDefinition,
  UniversalTool,
  AnthropicToolDefinition,
  GoogleToolDefinition,
  ToolCall,
  ToolCallRequest,
  ToolResult,
  ToolFormatOptions,

  // Utility types
  ToolCallFormat,
  ToolConvertTarget,
} from './tools';

// ============================================================================
// Logging Utilities
// ============================================================================

export {
  // Plugin logger factory
  createPluginLogger,
  hasCoreLogger,
  getLogLevelFromEnv,

  // Re-exported from plugin-types
  createConsoleLogger,
  createNoopLogger,

  // Internal APIs for Quilltap core
  __injectCoreLoggerFactory,
  __clearCoreLoggerFactory,
} from './logging';

export type {
  // Logger types
  PluginLoggerWithChild,
  PluginLogger,
  LogContext,
  LogLevel,
} from './logging';

// ============================================================================
// Provider Base Classes
// ============================================================================

export {
  OpenAICompatibleProvider,
  DEFAULT_REQUEST_TIMEOUT_MS,
  resolveRequestTimeoutMs,
  buildSdkRequestOptions,
  buildSdkClientOptions,
  buildRequestAbortSignal,
} from './providers';

export type {
  OpenAICompatibleProviderConfig,
} from './providers';

// ============================================================================
// System Prompt Utilities
// ============================================================================

export {
  // Builder functions
  createSystemPromptPlugin,

  // Validation utilities
  validateSystemPromptPlugin,
} from './system-prompts';

export type {
  // Builder option types
  CreateSystemPromptPluginOptions,
} from './system-prompts';

// ============================================================================
// Built-in Tool Names
// ============================================================================

export {
  BUILTIN_TOOL_NAMES,
  getBuiltinToolNames,
} from './builtin-tools';

// ============================================================================
// Host URL Rewriting
// ============================================================================

export {
  isVMEnvironment,
  resolveHostGateway,
  rewriteLocalhostUrl,
} from './host-rewrite';

// ============================================================================
// Quilltap App Version
// ============================================================================

export {
  // Version injection (for Quilltap core)
  __injectQuilltapVersion,
  __clearQuilltapVersion,

  // Version accessors (for plugins)
  getQuilltapVersion,
  getQuilltapUserAgent,
} from './version';

// ============================================================================
// Character Plugin Data Types (re-exported from plugin-types)
// ============================================================================

export type {
  CharacterPluginDataEntry,
  CharacterPluginDataMap,
} from '@quilltap/plugin-types';

// ============================================================================
// Package Version
// ============================================================================

/**
 * Version of the plugin-utils package.
 * Can be used at runtime to check compatibility.
 */
export const PLUGIN_UTILS_VERSION = '2.2.1';
