/**
 * Quilltap Plugin System
 *
 * Main exports for the plugin system.
 */

// Export manifest schema and types
export type {
  PluginManifest,
  PluginAuthor,
  Compatibility,
  Functionality,
  HookConfig,
  APIRoute,
  UIComponent,
  DatabaseModel,
  Permissions,
  ConfigSchema,
  PluginCapability,
  FrontendFramework,
  CSSFramework,
} from '@/lib/schemas/plugin-manifest';

export {
  PluginManifestSchema,
  validatePluginManifest,
  safeValidatePluginManifest,
  functionalityToCapabilities,
  PluginCapabilityEnum,
  FrontendFrameworkEnum,
  CSSFrameworkEnum,
} from '@/lib/schemas/plugin-manifest';

// Export manifest loader utilities
export type {
  LoadedPlugin,
  PluginLoadError,
  PluginScanResult,
} from './manifest-loader';

export {
  loadPluginManifest,
  loadPluginManifestSafe,
  scanPlugins,
  loadPlugin,
  isPluginCompatible,
  validatePluginSecurity,
  PLUGINS_DIR,
  MANIFEST_FILENAME,
} from './manifest-loader';

// Export plugin registry
export type {
  PluginRegistryState,
} from './registry';

export {
  pluginRegistry,
  getAllPlugins,
  getEnabledPlugins,
  getPlugin,
  getPluginsByCapability,
  getEnabledPluginsByCapability,
  hasPlugin,
  getPluginStats,
} from './registry';

// Export route loader utilities
export type {
  PluginRouteInfo,
  PluginRouteRegistry,
} from './route-loader';

export {
  pluginRouteRegistry,
  getPluginRoutes,
  findPluginRoute,
  registerPluginRoutes,
  unregisterPluginRoutes,
  refreshPluginRoutes,
  getPluginRouteRegistry,
} from './route-loader';

// Export provider plugin interfaces
export type {
  LLMProviderPlugin,
  ProviderMetadata,
  AttachmentSupport,
  ProviderConfigRequirements,
  ModelInfo,
  ProviderCapabilities,
  ProviderPluginExport,
} from './interfaces/provider-plugin';

export {
  createProviderLogger,
} from './interfaces/provider-plugin';

// Export provider registry
export {
  providerRegistry,
  registerProvider,
  getProvider,
  getAllProviders,
  hasProvider,
  createLLMProvider,
  createImageProvider,
  getProviderMetadata,
  getAllProviderMetadata,
  getProviderNames,
  getAttachmentSupport,
  getConfigRequirements,
  getProvidersByCapability,
  supportsCapability,
  getProvidersWithAttachmentSupport,
  initializeProviderRegistry,
} from './provider-registry';

// Export provider validation utilities
export type {
  ProviderConfigValidation,
  ProviderConnectionTestResult,
} from './provider-validation';

export {
  validateProviderConfig,
  requiresBaseUrl,
  requiresApiKey,
  getDefaultBaseUrl,
  testProviderConnection,
  getEmbeddingProviders,
  getEmbeddingModels,
  getAllEmbeddingModels,
} from './provider-validation';
