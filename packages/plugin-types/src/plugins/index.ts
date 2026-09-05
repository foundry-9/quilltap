/**
 * Plugin types barrel export
 *
 * @module @quilltap/plugin-types/plugins
 */

export type {
  TextProviderPlugin,
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
  ThinkingTurnRule,
  EmbeddingModelInfo,
  ImageGenerationModelInfo,
  ImageLoraSupport,
  ImageProviderConstraints,
  OrientationStrategy,
  OrientationMapping,
  ImageOrientationSupport,
  IconProps,
  LLMProviderPlugin,
  ProviderPluginExport,
} from './provider';

export type {
  ProviderOptionFieldType,
  ProviderOptionEnumValue,
  ProviderOptionDirective,
  ProviderOptionShowIf,
  ProviderOptionField,
  ProviderOptionGroup,
  ProviderOptionsSchema,
  ProviderOptionsSchemaContext,
} from './provider-options';

export type {
  ScoringProviderMetadata,
  ScoringProviderConfigRequirements,
  ScoringProviderPlugin,
  ScoringProviderPluginExport,
} from './scoring-provider';

export type {
  PluginCapability,
  PluginCategory,
  PluginStatus,
  PluginAuthor,
  PluginCompatibility,
  ProviderConfig,
  SearchProviderConfig,
  ModerationProviderConfig,
  PluginPermissions,
  PluginManifest,
  InstalledPluginInfo,
} from './manifest';

export type {
  ColorPalette,
  Typography,
  Spacing,
  Effects,
  ThemeTokens,
  FontDefinition,
  EmbeddedFont,
  ThemeMetadata,
  ThemePlugin,
  ThemePluginExport,
} from './theme';

/**
 * @deprecated Roleplay template types removed in Quilltap v4.2.0.
 * Import directly from './roleplay-template' if backward compat is needed.
 */

export type {
  SearchProviderMetadata,
  SearchProviderConfigRequirements,
  SearchResult,
  SearchOutput,
  SearchProviderPlugin,
  SearchProviderPluginExport,
} from './search-provider';

export type {
  ModerationProviderMetadata,
  ModerationProviderConfigRequirements,
  ModerationCategoryResult,
  ModerationResult,
  ModerationProviderPlugin,
  ModerationProviderPluginExport,
} from './moderation-provider';
