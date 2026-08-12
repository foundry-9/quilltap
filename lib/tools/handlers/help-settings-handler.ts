/**
 * Help Settings Tool Handler
 *
 * Reads Quilltap instance settings for LLM characters to understand
 * and assist with user configuration.
 *
 * SECURITY: API keys, passphrases, and secrets are NEVER included in output.
 * Uses explicit allowlists of safe fields rather than blocklists.
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import {
  HelpSettingsToolInput,
  HelpSettingsToolOutput,
  HelpSettingsCategory,
  validateHelpSettingsInput,
} from '../help-settings-tool'

const logger_ = logger.child({ module: 'help-settings-handler' })

/**
 * Context required for help settings execution
 */
export interface HelpSettingsToolContext {
  /** User ID for scoping queries */
  userId: string
}

/**
 * Error thrown during help settings execution
 */
export class HelpSettingsError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'DATABASE_ERROR' | 'UNKNOWN_CATEGORY'
  ) {
    super(message)
    this.name = 'HelpSettingsError'
  }
}

/**
 * SECURITY: Allowlisted fields for connection profiles.
 * API keys, tokens, and secrets are NEVER included.
 */
function sanitizeConnectionProfile(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    baseUrl: profile.baseUrl || null,
    allowToolUse: profile.allowToolUse ?? true,
    pseudoToolMode: profile.pseudoToolMode ?? 'auto',
    allowWebSearch: profile.allowWebSearch ?? false,
    useNativeWebSearch: profile.useNativeWebSearch ?? false,
    isDefault: profile.isDefault ?? false,
    sortIndex: profile.sortIndex ?? 0,
  }
}

/**
 * SECURITY: Allowlisted fields for embedding profiles.
 */
function sanitizeEmbeddingProfile(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    dimensions: profile.dimensions,
    isDefault: profile.isDefault ?? false,
  }
}

/**
 * SECURITY: Allowlisted fields for image profiles.
 */
function sanitizeImageProfile(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    isDefault: profile.isDefault ?? false,
  }
}

/**
 * Fetch settings for a specific category
 */
async function fetchCategorySettings(
  category: HelpSettingsCategory,
  userId: string
): Promise<Record<string, unknown>> {
  const repos = getRepositories()

  switch (category) {
    case 'chat': {
      const settings = await repos.chatSettings.findByUserId(userId)
      if (!settings) return { message: 'No chat settings configured yet' }

      return {
        tokenDisplaySettings: settings.tokenDisplaySettings,
        contextCompressionSettings: settings.contextCompressionSettings,
        memoryCascadePreferences: settings.memoryCascadePreferences,
        defaultTimestampConfig: settings.defaultTimestampConfig,
        agentModeSettings: settings.agentModeSettings,
        dangerousContentSettings: settings.dangerousContentSettings,
        autoDetectRng: settings.autoDetectRng,
        customTools: settings.customTools,
        llmLoggingSettings: settings.llmLoggingSettings,
        avatarDisplayMode: settings.avatarDisplayMode,
        avatarDisplayStyle: settings.avatarDisplayStyle,
        timezone: settings.timezone,
      }
    }

    case 'connections': {
      const profiles = await repos.connections.findByUserId(userId)
      return {
        count: profiles.length,
        profiles: profiles.map(p => sanitizeConnectionProfile(p as unknown as Record<string, unknown>)),
      }
    }

    case 'embeddings': {
      const profiles = await repos.embeddingProfiles.findByUserId(userId)
      return {
        count: profiles.length,
        profiles: profiles.map(p => sanitizeEmbeddingProfile(p as unknown as Record<string, unknown>)),
      }
    }

    case 'images': {
      const profiles = await repos.imageProfiles.findByUserId(userId)
      const settings = await repos.chatSettings.findByUserId(userId)
      return {
        count: profiles.length,
        profiles: profiles.map(p => sanitizeImageProfile(p as unknown as Record<string, unknown>)),
        storyBackgroundsSettings: settings?.storyBackgroundsSettings || null,
      }
    }

    case 'appearance': {
      const settings = await repos.chatSettings.findByUserId(userId)
      return {
        themePreference: settings?.themePreference || null,
        avatarDisplayMode: settings?.avatarDisplayMode || null,
        avatarDisplayStyle: settings?.avatarDisplayStyle || null,
        tagStyles: settings?.tagStyles || null,
        sidebarWidth: settings?.sidebarWidth || null,
      }
    }

    case 'templates': {
      const templates = await repos.roleplayTemplates.findByUserId(userId)
      const settings = await repos.chatSettings.findByUserId(userId)
      return {
        count: templates.length,
        templates: templates.map(t => ({
          id: (t as unknown as Record<string, unknown>).id,
          name: (t as unknown as Record<string, unknown>).name,
          description: (t as unknown as Record<string, unknown>).description,
          isDefault: (t as unknown as Record<string, unknown>).isDefault,
        })),
        defaultRoleplayTemplateId: settings?.defaultRoleplayTemplateId || null,
      }
    }

    case 'system': {
      const settings = await repos.chatSettings.findByUserId(userId)
      return {
        llmLoggingSettings: settings?.llmLoggingSettings || null,
        timezone: settings?.timezone || null,
      }
    }

    case 'overview': {
      const [connections, embeddings, images, templates, settings] = await Promise.all([
        repos.connections.findByUserId(userId),
        repos.embeddingProfiles.findByUserId(userId),
        repos.imageProfiles.findByUserId(userId),
        repos.roleplayTemplates.findByUserId(userId),
        repos.chatSettings.findByUserId(userId),
      ])

      return {
        connectionProfiles: {
          count: connections.length,
          providers: [...new Set(connections.map(c => (c as unknown as Record<string, unknown>).provider))],
        },
        embeddingProfiles: {
          count: embeddings.length,
          providers: [...new Set(embeddings.map(e => (e as unknown as Record<string, unknown>).provider))],
        },
        imageProfiles: {
          count: images.length,
          providers: [...new Set(images.map(i => (i as unknown as Record<string, unknown>).provider))],
        },
        roleplayTemplates: {
          count: templates.length,
        },
        theme: settings?.themePreference || 'default',
        agentMode: settings?.agentModeSettings || null,
        contextCompression: settings?.contextCompressionSettings || null,
      }
    }

    default:
      throw new HelpSettingsError(`Unknown category: ${category}`, 'UNKNOWN_CATEGORY')
  }
}

/**
 * Execute a help settings tool call
 */
export async function executeHelpSettingsTool(
  input: unknown,
  context: HelpSettingsToolContext
): Promise<HelpSettingsToolOutput> {
  try {
    const parsed = validateHelpSettingsInput(input)
    if (!parsed) {
      logger_.warn('Help settings validation failed', {
        userId: context.userId,
        input,
      })
      return {
        success: false,
        category: 'overview',
        error: 'Invalid input: category is required and must be one of: overview, chat, connections, embeddings, images, appearance, templates, system',
      }
    }

    const { category } = parsed

    const data = await fetchCategorySettings(category, context.userId)

    return {
      success: true,
      category,
      data,
    }
  } catch (error) {
    logger_.error('Help settings tool execution failed', {
      userId: context.userId,
    }, error instanceof Error ? error : undefined)

    return {
      success: false,
      category: typeof input === 'object' && input !== null && 'category' in input
        ? String((input as Record<string, unknown>).category) as HelpSettingsCategory
        : 'overview',
      error: error instanceof Error ? error.message : 'Unknown error during settings lookup',
    }
  }
}

/**
 * Format help settings results for inclusion in conversation context
 */
export function formatHelpSettingsResults(output: HelpSettingsToolOutput): string {
  if (!output.success || !output.data) {
    return output.error || 'Failed to read settings.'
  }

  const category = output.category
  const data = output.data

  const header = `Settings: ${category.charAt(0).toUpperCase() + category.slice(1)}`
  const body = JSON.stringify(data, null, 2)

  return `${header}\n\n${body}`
}
