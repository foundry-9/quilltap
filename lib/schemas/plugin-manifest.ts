/**
 * Plugin Manifest Schema
 *
 * Validates the manifest.json file for Quilltap plugins.
 * This schema defines the structure and requirements for plugin metadata.
 */

import { z } from 'zod';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Functional capabilities that a plugin can provide
 */
export const PluginCapabilityEnum = z.enum([
  'CHAT_COMMANDS',           // Provides custom chat commands
  'MESSAGE_PROCESSORS',      // Processes/transforms messages
  'UI_COMPONENTS',          // Provides React components
  'DATA_STORAGE',           // Adds database tables/storage
  'API_ROUTES',             // Adds new API endpoints
  'AUTH_METHODS',           // Provides authentication methods
  'WEBHOOKS',               // Handles webhooks
  'BACKGROUND_TASKS',       // Runs background jobs
  'CUSTOM_MODELS',          // Adds new data models
  'FILE_HANDLERS',          // Handles file operations
  'NOTIFICATIONS',          // Provides notification system
  'BACKEND_INTEGRATIONS',   // Integrates with external services
  'LLM_PROVIDER',          // Provides LLM integration
  'IMAGE_PROVIDER',        // Provides image generation
  'EMBEDDING_PROVIDER',    // Provides embedding generation
  'THEME',                 // Provides UI theme
  'DATABASE_BACKEND',      // Replaces/augments database
  'UPGRADE_MIGRATION',     // Provides version upgrade migrations (runs early in startup)
  'TOOL_PROVIDER',         // Provides LLM tools (e.g., curl, calculators, etc.)
  'SEARCH_PROVIDER',       // Provides web search backend (e.g., Serper, Bing, DuckDuckGo)
  'MODERATION_PROVIDER',   // Provides content moderation (e.g., OpenAI moderation endpoint)
  'SYSTEM_PROMPT',         // Provides system prompt templates for characters
]);

export type PluginCapability = z.infer<typeof PluginCapabilityEnum>;

/**
 * Frontend framework/library used by the plugin
 */
export const FrontendFrameworkEnum = z.enum([
  'REACT',
  'PREACT',
  'VUE',
  'SVELTE',
  'NONE',
]);

export type FrontendFramework = z.infer<typeof FrontendFrameworkEnum>;

/**
 * CSS framework used by the plugin
 */
export const CSSFrameworkEnum = z.enum([
  'TAILWIND',
  'BOOTSTRAP',
  'MATERIAL_UI',
  'CSS_MODULES',
  'STYLED_COMPONENTS',
  'NONE',
]);

export type CSSFramework = z.infer<typeof CSSFrameworkEnum>;

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

/**
 * Author information
 */
export const PluginAuthorSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email().optional(),
  url: z.url().optional(),
});

export type PluginAuthor = z.infer<typeof PluginAuthorSchema>;

/**
 * Version compatibility requirements
 */
export const CompatibilitySchema = z.object({
  /** Minimum Quilltap version (semver) */
  quilltapVersion: z.string().regex(/^>=?\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/),
  /** Maximum Quilltap version (optional) */
  quilltapMaxVersion: z.string().regex(/^<=?\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/).optional(),
  /** Minimum Node.js version */
  nodeVersion: z.string().regex(/^>=?\d+\.\d+\.\d+$/).optional(),
});

export type Compatibility = z.infer<typeof CompatibilitySchema>;

/**
 * Functionality flags - what capabilities the plugin provides
 */
export const FunctionalitySchema = z.object({
  /** @deprecated Use capabilities array instead */
  providesChatCommands: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesMessageProcessors: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesUIComponents: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesDataStorage: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesAPIRoutes: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesAuthenticationMethods: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesWebhooks: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesBackgroundTasks: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesCustomModels: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesFileHandlers: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesNotifications: z.boolean().default(false).optional(),
  /** @deprecated Use capabilities array instead */
  providesBackendIntegrations: z.boolean().default(false).optional(),
});

export type Functionality = z.infer<typeof FunctionalitySchema>;

/**
 * Hook configuration
 */
export const HookConfigSchema = z.object({
  /** Hook identifier */
  name: z.string().min(1).max(100),
  /** Hook handler file path (relative to plugin root) */
  handler: z.string(),
  /** Priority (lower = runs first) */
  priority: z.int().min(0).max(100).default(50),
  /** Whether the hook is enabled */
  enabled: z.boolean().default(true),
});

export type HookConfig = z.infer<typeof HookConfigSchema>;

/**
 * API route configuration
 */
export const APIRouteSchema = z.object({
  /** Route path (e.g., "/api/plugin/my-route") */
  path: z.string().regex(/^\/api\//),
  /** HTTP methods supported */
  methods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])).min(1),
  /** Handler file path (relative to plugin root) */
  handler: z.string(),
  /** Whether authentication is required */
  requiresAuth: z.boolean().default(true),
  /** Description of what the route does */
  description: z.string().optional(),
});

export type APIRoute = z.infer<typeof APIRouteSchema>;

/**
 * UI component registration
 */
export const UIComponentSchema = z.object({
  /** Component identifier (used for registration) */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Human-readable name */
  name: z.string().min(1).max(100),
  /** Component file path (relative to plugin root) */
  path: z.string(),
  /** Where the component can be used */
  slots: z.array(z.string()).optional(),
  /** Props schema (JSON Schema) */
  propsSchema: z.record(z.string(), z.unknown()).optional(),
});

export type UIComponent = z.infer<typeof UIComponentSchema>;

/**
 * Database table/model definition
 */
export const DatabaseModelSchema = z.object({
  /** Model name */
  name: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/),
  /** Schema file path (Zod schema, relative to plugin root) */
  schemaPath: z.string(),
  /** Collection/table name */
  collectionName: z.string().regex(/^[a-z][a-z0-9-_]*$/),
  /** Description */
  description: z.string().optional(),
});

export type DatabaseModel = z.infer<typeof DatabaseModelSchema>;

/**
 * Permission requirements
 */
export const PermissionsSchema = z.object({
  /** File system access paths (relative to data directory) */
  fileSystem: z.array(z.string()).default([]),
  /** Network access (domains/URLs the plugin needs to access) */
  network: z.array(z.string()).default([]),
  /** Environment variables the plugin needs */
  environment: z.array(z.string()).default([]),
  /** Whether the plugin needs database access */
  database: z.boolean().default(false),
  /** Whether the plugin needs user data access */
  userData: z.boolean().default(false),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

/**
 * Configuration schema definition
 */
export const ConfigSchemaSchema = z.object({
  /** Configuration key */
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  /** Display label */
  label: z.string().min(1).max(100),
  /** Input type */
  type: z.enum(['text', 'number', 'boolean', 'select', 'textarea', 'password', 'url', 'email']),
  /** Default value */
  default: z.unknown().optional(),
  /** Whether the field is required */
  required: z.boolean().default(false),
  /** Help text */
  description: z.string().optional(),
  /** Options for select type */
  options: z.array(z.object({
    label: z.string(),
    value: z.unknown(),
  })).optional(),
  /** Validation pattern (regex) */
  pattern: z.string().optional(),
  /** Minimum value (for number type) */
  min: z.number().optional(),
  /** Maximum value (for number type) */
  max: z.number().optional(),
});

export type ConfigSchema = z.infer<typeof ConfigSchemaSchema>;

/**
 * Provider configuration schema
 *
 * Defines the configuration for LLM/service provider plugins.
 * This schema is used by provider plugins (e.g., OpenAI, Anthropic) to declare
 * their provider identity, visual branding, and supported features.
 */
export const ProviderConfigSchema = z.object({
  /** Internal identifier for the provider (e.g., 'OPENAI', 'ANTHROPIC') */
  providerName: z.string().regex(/^[A-Z][A-Z0-9_]*$/),

  /** Human-readable display name (e.g., 'OpenAI', 'Anthropic') */
  displayName: z.string().min(1).max(100),

  /** Short description of the provider */
  description: z.string().min(1).max(500),

  /** 2-4 character abbreviation for use in icons/badges (e.g., 'OAI', 'ANT') */
  abbreviation: z.string().min(2).max(4).regex(/^[A-Z0-9]+$/),

  /** Color configuration using Tailwind CSS classes */
  colors: z.object({
    /** Background color class (e.g., 'bg-blue-500') */
    bg: z.string().min(1),
    /** Text color class (e.g., 'text-white') */
    text: z.string().min(1),
    /** Icon color class (e.g., 'text-blue-600') */
    icon: z.string().min(1),
  }),

  /** Whether the provider requires an API key */
  requiresApiKey: z.boolean().default(true),

  /**
   * Whether the provider *may* hold an API key at all. Omitted means "same
   * answer as `requiresApiKey`", which is correct for every provider that is
   * wholly hosted or wholly local; OpenAI-Compatible is the one that spans both
   * and declares `false` / `true`. See lib/llm/api-key-support.ts (Bug 81).
   */
  acceptsApiKey: z.boolean().optional(),

  /** Whether the provider requires a custom base URL */
  requiresBaseUrl: z.boolean().default(false),

  /** Custom label for the API key field (defaults to 'API Key') */
  apiKeyLabel: z.string().min(1).max(100).optional(),

  /** Custom label for the base URL field (defaults to 'Base URL') */
  baseUrlLabel: z.string().min(1).max(100).optional(),

  /** Default base URL for the provider (if customizable) */
  baseUrlDefault: z.url().optional(),

  /** Capabilities supported by this provider */
  capabilities: z.object({
    /** Supports chat/completion endpoints */
    chat: z.boolean().default(true).optional(),
    /** Supports image generation */
    imageGeneration: z.boolean().default(false).optional(),
    /** Supports embeddings */
    embeddings: z.boolean().default(false).optional(),
    /** Supports web search */
    webSearch: z.boolean().default(false).optional(),
  }).optional(),

  /** File attachment support configuration */
  attachmentSupport: z.object({
    /** Whether attachments are supported */
    supported: z.boolean().default(false),
    /** List of supported MIME types (e.g., ['image/jpeg', 'application/pdf']) */
    mimeTypes: z.array(z.string()).default([]),
    /** Description of attachment support */
    description: z.string().optional(),
  }).optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Auth provider configuration schema
 *
 * Defines the configuration for authentication provider plugins.
 * This schema is used by auth plugins (e.g., Google OAuth, GitHub OAuth) to declare
 * their provider identity, visual branding, and required environment variables.
 */
export const AuthProviderConfigSchema = z.object({
  /** Internal identifier for the provider (e.g., 'google', 'github') */
  providerId: z.string().regex(/^[a-z][a-z0-9-]*$/),

  /** Human-readable display name (e.g., 'Google', 'GitHub') */
  displayName: z.string().min(1).max(100),

  /** Environment variables required for this provider */
  requiredEnvVars: z.array(z.string()).min(1),

  /** Optional environment variables */
  optionalEnvVars: z.array(z.string()).optional(),

  /** Button background color (Tailwind classes) */
  buttonColor: z.string().optional(),

  /** Button text color (Tailwind classes) */
  buttonTextColor: z.string().optional(),

  /** Icon name or identifier */
  icon: z.string().optional(),
});

export type AuthProviderConfig = z.infer<typeof AuthProviderConfigSchema>;

/**
 * Font definition for theme plugins
 * Allows themes to bundle and load custom fonts
 */
export const ThemeFontDefinitionSchema = z.object({
  /** Font family name (as used in CSS) */
  family: z.string().min(1).describe('Font family name'),
  /** Font file path (relative to plugin root) */
  src: z.string().min(1).describe('Font file path relative to plugin'),
  /** Font weight (e.g., "400", "700") */
  weight: z.string().default('400').describe('Font weight'),
  /** Font style (e.g., "normal", "italic") */
  style: z.string().default('normal').describe('Font style'),
  /** Font display strategy */
  display: z.enum(['auto', 'block', 'swap', 'fallback', 'optional']).default('swap'),
});

export type ThemeFontDefinition = z.infer<typeof ThemeFontDefinitionSchema>;

/**
 * Subsystem display override schema
 * Allows themes to rename or re-image Foundry subsystem pages.
 */
export const SubsystemOverridesSchema = z.object({
  /** Override the display name */
  name: z.string().min(1).max(100).optional(),
  /** Override the short description */
  description: z.string().min(1).max(500).optional(),
  /** Override the thumbnail image (URL, data URI, or relative path) */
  thumbnail: z.string().optional(),
  /** Override the full-page background image (URL, data URI, or relative path) */
  backgroundImage: z.string().optional(),
});

export type SubsystemOverridesType = z.infer<typeof SubsystemOverridesSchema>;

/**
 * Theme plugin configuration schema
 *
 * Defines the configuration for theme plugins that provide UI theming.
 * Theme plugins use the THEME capability and provide design tokens
 * (colors, typography, spacing) plus optional component CSS overrides.
 */
export const ThemeConfigSchema = z.object({
  /** Theme tokens file path (relative to plugin root) - used for file-based loading */
  tokensPath: z.string().default('tokens.json').describe('Path to theme tokens JSON file'),

  /** Optional component overrides CSS file path (relative to plugin root) - used for file-based loading */
  stylesPath: z.string().optional().describe('Path to component override CSS file'),

  /** Whether this theme supports dark mode (default: true) */
  supportsDarkMode: z.boolean().default(true).describe('Whether theme provides dark mode colors'),

  /** Preview image path (relative to plugin root) */
  previewImage: z.string().optional().describe('Theme preview image for theme picker'),

  /** Base theme to extend (null = extend default theme) */
  extendsTheme: z.string().nullable().optional().describe('Plugin name of theme to extend'),

  /** Theme tags for categorization */
  tags: z.array(z.string()).default([]).optional().describe('Tags for theme discovery'),

  /** Custom fonts bundled with the theme - used for file-based loading */
  fonts: z.array(ThemeFontDefinitionSchema).default([]).optional().describe('Custom fonts to load'),

  /**
   * Whether to use module-based loading (self-contained theme).
   * When true (default), the registry will try to load the theme from the main entry point
   * as a ThemePlugin export. If module loading fails, it falls back to file-based loading.
   * Set to false to force file-based loading (tokens.json + styles.css).
   */
  useModule: z.boolean().default(true).optional().describe('Use module-based self-contained loading'),

  /** Subsystem display overrides — keys are subsystem IDs */
  subsystems: z.record(z.string(), SubsystemOverridesSchema).optional().describe('Override Foundry subsystem names, descriptions, and images'),
});

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;


/**
 * Tool plugin configuration schema
 *
 * Defines the configuration for tool plugins that provide LLM tools.
 * Tool plugins use the TOOL_PROVIDER capability and provide tools
 * that can be called by LLMs during chat interactions.
 */
export const ToolConfigSchema = z.object({
  /** Tool name used in LLM function calls (lowercase with underscores) */
  toolName: z.string().regex(/^[a-z][a-z0-9_]*$/).min(1).max(50).describe('Tool name for LLM function calls'),

  /** Human-readable display name */
  displayName: z.string().min(1).max(100).describe('Display name for UI'),

  /** Tool description for LLM to understand when to use it */
  description: z.string().min(1).max(1000).describe('Description for LLM'),

  /** Whether the tool requires user configuration before use (e.g., API keys, allowlists) */
  requiresConfiguration: z.boolean().default(false).describe('Whether user must configure before use'),

  /** Whether the tool is enabled by default when the plugin is installed */
  enabledByDefault: z.boolean().default(true).describe('Whether tool is enabled by default'),
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

/**
 * Search provider plugin configuration schema
 *
 * Defines the configuration for web search provider plugins.
 * These plugins use the SEARCH_PROVIDER capability and provide
 * backends for the built-in `search_web` tool.
 */
export const SearchProviderConfigSchema = z.object({
  /** Internal identifier for the search provider (e.g., 'SERPER', 'BING') */
  providerName: z.string().regex(/^[A-Z][A-Z0-9_]*$/),

  /** Human-readable display name (e.g., 'Serper Web Search') */
  displayName: z.string().min(1).max(100),

  /** Short description of the search provider */
  description: z.string().min(1).max(500),

  /** 2-4 character abbreviation for use in icons/badges (e.g., 'SRP', 'BNG') */
  abbreviation: z.string().min(2).max(4).regex(/^[A-Z0-9]+$/),

  /** Color configuration using Tailwind CSS classes */
  colors: z.object({
    /** Background color class */
    bg: z.string().min(1),
    /** Text color class */
    text: z.string().min(1),
    /** Icon color class */
    icon: z.string().min(1),
  }),

  /** Whether the search provider requires an API key */
  requiresApiKey: z.boolean().default(true),

  /** Custom label for the API key field */
  apiKeyLabel: z.string().min(1).max(100).optional(),

  /** Whether the search provider requires a custom base URL */
  requiresBaseUrl: z.boolean().default(false),

  /** Default base URL for the search provider (if customizable) */
  baseUrlDefault: z.url().optional(),
});

export type SearchProviderConfig = z.infer<typeof SearchProviderConfigSchema>;

/**
 * Moderation provider plugin configuration schema
 *
 * Defines the configuration for content moderation provider plugins.
 * These plugins use the MODERATION_PROVIDER capability and provide
 * content classification backends (e.g., OpenAI moderation endpoint).
 */
export const ModerationProviderConfigSchema = z.object({
  /** Internal identifier for the moderation provider (e.g., 'OPENAI') */
  providerName: z.string().regex(/^[A-Z][A-Z0-9_]*$/),

  /** Human-readable display name (e.g., 'OpenAI Moderation') */
  displayName: z.string().min(1).max(100),

  /** Short description of the moderation provider */
  description: z.string().min(1).max(500),

  /** 2-4 character abbreviation for use in icons/badges (e.g., 'OAI') */
  abbreviation: z.string().min(2).max(4).regex(/^[A-Z0-9]+$/),

  /** Color configuration using Tailwind CSS classes */
  colors: z.object({
    /** Background color class */
    bg: z.string().min(1),
    /** Text color class */
    text: z.string().min(1),
    /** Icon color class */
    icon: z.string().min(1),
  }),

  /** Whether the moderation provider requires an API key */
  requiresApiKey: z.boolean().default(true),

  /** Custom label for the API key field */
  apiKeyLabel: z.string().min(1).max(100).optional(),

  /** Whether the moderation provider requires a custom base URL */
  requiresBaseUrl: z.boolean().default(false),

  /** Default base URL for the moderation provider (if customizable) */
  baseUrlDefault: z.url().optional(),
});

export type ModerationProviderConfig = z.infer<typeof ModerationProviderConfigSchema>;

/**
 * System prompt plugin configuration schema
 *
 * Defines the manifest-level metadata for system prompt plugins.
 * The actual prompt content is provided by the plugin module export,
 * not the manifest (since prompts contain long-form markdown content).
 */
export const SystemPromptConfigSchema = z.object({
  /** How many system prompts this plugin provides */
  promptCount: z.number().int().min(1).describe('Number of system prompts provided'),

  /** Short description of the prompt collection */
  description: z.string().max(500).optional().describe('Description of the prompt collection'),

  /** Tags for categorization */
  tags: z.array(z.string()).default([]).optional().describe('Tags for categorization'),
});

export type SystemPromptConfig = z.infer<typeof SystemPromptConfigSchema>;

// ============================================================================
// MAIN MANIFEST SCHEMA
// ============================================================================

/**
 * Complete plugin manifest schema
 */
export const PluginManifestSchema = z.strictObject({
  // ===== JSON SCHEMA REFERENCE =====
  /** JSON Schema reference (for IDE support) */
  $schema: z.string().optional(),

  // ===== BASIC METADATA =====
  /** Plugin package name (must start with 'qtap-plugin-' or '@scope/qtap-plugin-') */
  name: z.string().regex(/^(@[a-z0-9-]+\/)?qtap-plugin-[a-z0-9-]+$/),

  /** Display title */
  title: z.string().min(1).max(100),

  /** Plugin description */
  description: z.string().min(1).max(500),

  /** Semantic version */
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/),

  /** Author information */
  author: z.union([z.string(), PluginAuthorSchema]),

  /** License (SPDX identifier) */
  license: z.string().default('MIT'),

  /** Main entry point (JavaScript/TypeScript file) */
  main: z.string().default('index.js'),

  /** Homepage URL */
  homepage: z.url().optional(),

  /** Repository URL */
  repository: z.union([
    z.url(),
    z.strictObject({
      type: z.string(),
      url: z.url(),
      directory: z.string().optional(),
    }),
  ]).optional(),

  /** Bug tracker URL */
  bugs: z.union([
    z.url(),
    z.strictObject({
      url: z.url(),
      email: z.email().optional(),
    }),
  ]).optional(),

  // ===== COMPATIBILITY =====
  /** Version compatibility requirements */
  compatibility: CompatibilitySchema,

  /** Dependencies (other plugins required) */
  requires: z.record(z.string(), z.string()).optional(),

  /** Peer dependencies */
  peerDependencies: z.record(z.string(), z.string()).optional(),

  // ===== CAPABILITIES =====
  /** Modern capability flags (preferred over functionality object) */
  capabilities: z.array(PluginCapabilityEnum).default([]),

  /** @deprecated Legacy functionality flags */
  functionality: FunctionalitySchema.optional(),

  // ===== TECHNICAL DETAILS =====
  /** Frontend framework used */
  frontend: FrontendFrameworkEnum.default('REACT').optional(),

  /** CSS framework used */
  styling: CSSFrameworkEnum.default('TAILWIND').optional(),

  /** TypeScript support */
  typescript: z.boolean().default(true).optional(),

  // ===== HOOKS & EXTENSIONS =====
  /** Hook registrations */
  hooks: z.array(HookConfigSchema).default([]).optional(),

  /** API routes provided */
  apiRoutes: z.array(APIRouteSchema).default([]).optional(),

  /** UI components provided */
  components: z.array(UIComponentSchema).default([]).optional(),

  /** Database models/tables */
  models: z.array(DatabaseModelSchema).default([]).optional(),

  // ===== CONFIGURATION =====
  /** Configuration schema for the plugin */
  configSchema: z.array(ConfigSchemaSchema).default([]).optional(),

  /** Default configuration values */
  defaultConfig: z.record(z.string(), z.unknown()).default({}).optional(),

  /** Provider configuration (for LLM/service provider plugins) */
  providerConfig: ProviderConfigSchema.optional(),

  /** Auth provider configuration (for authentication provider plugins) */
  authProviderConfig: AuthProviderConfigSchema.optional(),

  /** Theme configuration (for THEME capability plugins) */
  themeConfig: ThemeConfigSchema.optional(),

  /** Tool configuration (for TOOL_PROVIDER capability plugins) */
  toolConfig: ToolConfigSchema.optional(),

  /** Search provider configuration (for SEARCH_PROVIDER capability plugins) */
  searchProviderConfig: SearchProviderConfigSchema.optional(),

  /** Moderation provider configuration (for MODERATION_PROVIDER capability plugins) */
  moderationProviderConfig: ModerationProviderConfigSchema.optional(),

  /** System prompt configuration (for SYSTEM_PROMPT capability plugins) */
  systemPromptConfig: SystemPromptConfigSchema.optional(),

  // ===== SECURITY & PERMISSIONS =====
  /** Permissions required by the plugin */
  permissions: PermissionsSchema.default({
    fileSystem: [],
    network: [],
    environment: [],
    database: false,
    userData: false,
  }).optional(),

  /** Whether the plugin is sandboxed */
  sandboxed: z.boolean().default(true).optional(),

  // ===== METADATA =====
  /** Keywords for search/discovery */
  keywords: z.array(z.string()).default([]),

  /** Icon file path (relative to plugin root) */
  icon: z.string().optional(),

  /** Screenshots (URLs or file paths) */
  screenshots: z.array(z.string()).default([]).optional(),

  /** Plugin category */
  category: z.enum([
    'PROVIDER',
    'THEME',
    'TEMPLATE',
    'INTEGRATION',
    'UTILITY',
    'ENHANCEMENT',
    'DATABASE',
    'STORAGE',
    'AUTHENTICATION',
    'TOOLS',
    'OTHER',
  ]).default('OTHER').optional(),

  /** Whether the plugin is enabled by default */
  enabledByDefault: z.boolean().default(false).optional(),

  /** Plugin status */
  status: z.enum(['STABLE', 'BETA', 'ALPHA', 'DEPRECATED']).default('STABLE').optional(),

  /** Whether this plugin requires a server restart to activate (inferred from capabilities if not set) */
  requiresRestart: z.boolean().optional(),
}); // Prevent unknown fields

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates a plugin manifest object
 * @param data - The manifest data to validate
 * @returns Validated and typed manifest
 * @throws ZodError if validation fails
 */
export function validatePluginManifest(data: unknown): PluginManifest {
  return PluginManifestSchema.parse(data);
}

/**
 * Safely validates a plugin manifest, returning errors instead of throwing
 * @param data - The manifest data to validate
 * @returns Success or error result
 */
export function safeValidatePluginManifest(data: unknown):
  { success: true; data: PluginManifest } |
  { success: false; errors: z.ZodError } {
  const result = PluginManifestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Converts legacy functionality flags to modern capabilities array
 * @param functionality - Legacy functionality object
 * @returns Array of capabilities
 */
export function functionalityToCapabilities(functionality?: Functionality): PluginCapability[] {
  if (!functionality) return [];

  const capabilities: PluginCapability[] = [];
  const mapping: Record<string, PluginCapability> = {
    providesChatCommands: 'CHAT_COMMANDS',
    providesMessageProcessors: 'MESSAGE_PROCESSORS',
    providesUIComponents: 'UI_COMPONENTS',
    providesDataStorage: 'DATA_STORAGE',
    providesAPIRoutes: 'API_ROUTES',
    providesAuthenticationMethods: 'AUTH_METHODS',
    providesWebhooks: 'WEBHOOKS',
    providesBackgroundTasks: 'BACKGROUND_TASKS',
    providesCustomModels: 'CUSTOM_MODELS',
    providesFileHandlers: 'FILE_HANDLERS',
    providesNotifications: 'NOTIFICATIONS',
    providesBackendIntegrations: 'BACKEND_INTEGRATIONS',
  };

  for (const [key, capability] of Object.entries(mapping)) {
    if (functionality[key as keyof Functionality]) {
      capabilities.push(capability);
    }
  }

  return capabilities;
}

/**
 * Capabilities that require a server restart to activate.
 * These capabilities affect core infrastructure that is initialized at startup.
 * Note: LLM_PROVIDER and IMAGE_PROVIDER are hot-loaded after installation,
 * so they don't require a restart (handled in installer.ts).
 */
const RESTART_REQUIRED_CAPABILITIES: PluginCapability[] = [
  'AUTH_METHODS',
  'DATABASE_BACKEND',
  'UPGRADE_MIGRATION',
];

/**
 * Determines if a plugin requires a server restart to activate.
 *
 * The restart requirement is determined by:
 * 1. Explicit `requiresRestart` field in the manifest (takes precedence)
 * 2. Inference from capabilities (AUTH_METHODS, DATABASE_BACKEND, UPGRADE_MIGRATION)
 *
 * @param manifest - The plugin manifest to check
 * @returns true if the plugin requires a server restart to activate
 */
export function pluginRequiresRestart(manifest: PluginManifest): boolean {
  // Explicit field takes precedence
  if (manifest.requiresRestart !== undefined) {
    return manifest.requiresRestart;
  }

  // Infer from capabilities
  return manifest.capabilities.some(cap =>
    RESTART_REQUIRED_CAPABILITIES.includes(cap)
  );
}
