/**
 * Plugin Interfaces
 *
 * Defines the contracts and types for Quilltap plugins.
 * All plugins must implement the appropriate interface from this module.
 *
 * @module plugins/interfaces
 */

// Export all provider plugin types and interfaces
export type {
  ProviderMetadata,
  AttachmentSupport,
  ProviderConfigRequirements,
  ModelInfo,
  EmbeddingModelInfo,
  ProviderCapabilities,
  ImageProviderConstraints,
  UniversalTool,
  ToolFormatOptions,
  ToolCallRequest,
  LLMProviderPlugin,
  ProviderPluginExport,
} from './provider-plugin';

export {
  createProviderLogger,
} from './provider-plugin';
