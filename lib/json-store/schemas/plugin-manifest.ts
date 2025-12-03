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
  'FILE_BACKEND',          // Replaces/augments file storage
  'UPGRADE_MIGRATION',     // Provides version upgrade migrations (runs early in startup)
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
  email: z.string().email().optional(),
  url: z.string().url().optional(),
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
  priority: z.number().int().min(0).max(100).default(50),
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
  propsSchema: z.record(z.unknown()).optional(),
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

  /** Whether the provider requires a custom base URL */
  requiresBaseUrl: z.boolean().default(false),

  /** Custom label for the API key field (defaults to 'API Key') */
  apiKeyLabel: z.string().min(1).max(100).optional(),

  /** Custom label for the base URL field (defaults to 'Base URL') */
  baseUrlLabel: z.string().min(1).max(100).optional(),

  /** Default base URL for the provider (if customizable) */
  baseUrlDefault: z.string().url().optional(),

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

// ============================================================================
// MAIN MANIFEST SCHEMA
// ============================================================================

/**
 * Complete plugin manifest schema
 */
export const PluginManifestSchema = z.object({
  // ===== JSON SCHEMA REFERENCE =====
  /** JSON Schema reference (for IDE support) */
  $schema: z.string().optional(),

  // ===== BASIC METADATA =====
  /** Plugin package name (must start with 'qtap-plugin-') */
  name: z.string().regex(/^qtap-plugin-[a-z0-9-]+$/),

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
  homepage: z.string().url().optional(),

  /** Repository URL */
  repository: z.union([
    z.string().url(),
    z.object({
      type: z.string(),
      url: z.string().url(),
    }),
  ]).optional(),

  /** Bug tracker URL */
  bugs: z.union([
    z.string().url(),
    z.object({
      url: z.string().url(),
      email: z.string().email().optional(),
    }),
  ]).optional(),

  // ===== COMPATIBILITY =====
  /** Version compatibility requirements */
  compatibility: CompatibilitySchema,

  /** Dependencies (other plugins required) */
  requires: z.record(z.string()).optional(),

  /** Peer dependencies */
  peerDependencies: z.record(z.string()).optional(),

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
  defaultConfig: z.record(z.unknown()).default({}).optional(),

  /** Provider configuration (for LLM/service provider plugins) */
  providerConfig: ProviderConfigSchema.optional(),

  /** Auth provider configuration (for authentication provider plugins) */
  authProviderConfig: AuthProviderConfigSchema.optional(),

  // ===== SECURITY & PERMISSIONS =====
  /** Permissions required by the plugin */
  permissions: PermissionsSchema.default({}).optional(),

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
    'INTEGRATION',
    'UTILITY',
    'ENHANCEMENT',
    'DATABASE',
    'STORAGE',
    'AUTHENTICATION',
    'OTHER',
  ]).default('OTHER').optional(),

  /** Whether the plugin is enabled by default */
  enabledByDefault: z.boolean().default(false).optional(),

  /** Plugin status */
  status: z.enum(['STABLE', 'BETA', 'ALPHA', 'DEPRECATED']).default('STABLE').optional(),
}).strict(); // Prevent unknown fields

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
