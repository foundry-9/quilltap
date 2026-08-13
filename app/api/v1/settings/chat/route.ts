/**
 * Chat Settings Management Routes (v1)
 *
 * GET /api/v1/settings/chat - Get chat settings for current user
 * PUT /api/v1/settings/chat - Update chat settings for current user
 */

import { NextRequest } from 'next/server'
import { createContextHandler, type RequestContext } from '@/lib/api/middleware'
import { successResponse, serverError, badRequest } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import { TagStyleMapSchema, ThemePreferenceSchema } from '@/lib/schemas/common.types'
import { TokenDisplaySettingsSchema, LLMLoggingSettingsSchema, AgentModeSettingsSchema, StoryBackgroundsSettingsSchema, DangerousContentSettingsSchema, AutoLockSettingsSchema, AnswerConfirmationSettingsSchema } from '@/lib/schemas/settings.types'
import { type AvatarDisplayMode } from '@/lib/schemas/types'
import { getErrorMessage } from '@/lib/error-utils'

/**
 * Validate and update chat settings
 */
async function updateChatSettings(
  userId: string,
  repos: any,
  avatarDisplayMode?: string,
  avatarDisplayStyle?: string,
  tagStyles?: unknown,
  cheapLLMSettings?: unknown,
  imageDescriptionProfileId?: string | null,
  uncensoredImageDescriptionProfileId?: string | null,
  themePreference?: unknown,
  defaultRoleplayTemplateId?: string | null,
  sidebarWidth?: number,
  tokenDisplaySettings?: unknown,
  memoryCascadePreferences?: unknown,
  llmLoggingSettings?: unknown,
  autoDetectRng?: boolean,
  customTools?: boolean,
  agentModeSettings?: unknown,
  storyBackgroundsSettings?: unknown,
  contextCompressionSettings?: unknown,
  dangerousContentSettings?: unknown,
  autoLockSettings?: unknown,
  compositionModeDefault?: boolean,
  composerSpellcheck?: boolean,
  composerEmoji?: boolean,
  textReplacementsEnabled?: boolean,
  autonomousRoomSettings?: unknown,
  thinkingDisplay?: unknown,
  autoScrollOnResponseComplete?: boolean,
  answerConfirmationSettings?: unknown,
) {
  // Validate avatarDisplayMode if provided
  if (avatarDisplayMode) {
    const validModes: AvatarDisplayMode[] = ['ALWAYS', 'GROUP_ONLY', 'NEVER']
    if (!validModes.includes(avatarDisplayMode as AvatarDisplayMode)) {
      throw new Error('Invalid avatar display mode')
    }
  }

  // Validate avatarDisplayStyle if provided
  if (avatarDisplayStyle) {
    const validStyles = ['CIRCULAR', 'RECTANGULAR']
    if (!validStyles.includes(avatarDisplayStyle)) {
      throw new Error('Invalid avatar display style')
    }
  }

  const updateData: Record<string, any> = {}
  if (avatarDisplayMode) updateData.avatarDisplayMode = avatarDisplayMode
  if (avatarDisplayStyle) updateData.avatarDisplayStyle = avatarDisplayStyle
  if (typeof tagStyles !== 'undefined') {
    const validatedTagStyles = TagStyleMapSchema.parse(tagStyles)
    updateData.tagStyles = validatedTagStyles
  }
  if (typeof cheapLLMSettings !== 'undefined') {
    // Validate cheapLLMSettings structure
    const validStrategies = ['USER_DEFINED', 'PROVIDER_CHEAPEST', 'LOCAL_FIRST']
    const validEmbeddingProviders = ['SAME_PROVIDER', 'OPENAI', 'LOCAL']

    if (cheapLLMSettings && typeof cheapLLMSettings === 'object') {
      const settings = cheapLLMSettings as any
      if (settings.strategy && !validStrategies.includes(settings.strategy)) {
        throw new Error('Invalid cheap LLM strategy')
      }
      if (settings.embeddingProvider && !validEmbeddingProviders.includes(settings.embeddingProvider)) {
        throw new Error('Invalid embedding provider')
      }
    }
    updateData.cheapLLMSettings = cheapLLMSettings
  }
  if (typeof imageDescriptionProfileId !== 'undefined') {
    updateData.imageDescriptionProfileId = imageDescriptionProfileId
  }
  if (typeof uncensoredImageDescriptionProfileId !== 'undefined') {
    updateData.uncensoredImageDescriptionProfileId = uncensoredImageDescriptionProfileId
  }
  if (typeof themePreference !== 'undefined') {
    const validatedThemePreference = ThemePreferenceSchema.parse(themePreference)
    updateData.themePreference = validatedThemePreference
  }
  if (typeof defaultRoleplayTemplateId !== 'undefined') {
    // Validate template exists if setting a non-null value
    if (defaultRoleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(defaultRoleplayTemplateId)
      if (!template) {
        throw new Error('Invalid roleplay template ID')
      }
    }
    updateData.defaultRoleplayTemplateId = defaultRoleplayTemplateId
  }
  if (typeof sidebarWidth !== 'undefined') {
    // Validate sidebar width range (256-512)
    if (typeof sidebarWidth !== 'number' || sidebarWidth < 256 || sidebarWidth > 512) {
      throw new Error('Invalid sidebar width (must be 256-512)')
    }
    updateData.sidebarWidth = sidebarWidth
  }
  if (typeof tokenDisplaySettings !== 'undefined') {
    const validatedTokenDisplaySettings = TokenDisplaySettingsSchema.parse(tokenDisplaySettings)
    updateData.tokenDisplaySettings = validatedTokenDisplaySettings
  }
  if (typeof memoryCascadePreferences !== 'undefined') {
    // Validate memoryCascadePreferences structure
    const validActions = ['DELETE_MEMORIES', 'KEEP_MEMORIES', 'ASK_EVERY_TIME', 'REGENERATE_MEMORIES']
    if (memoryCascadePreferences && typeof memoryCascadePreferences === 'object') {
      const prefs = memoryCascadePreferences as any
      if (prefs.onMessageDelete && !validActions.includes(prefs.onMessageDelete)) {
        throw new Error('Invalid memory cascade action for onMessageDelete')
      }
      if (prefs.onSwipeRegenerate && !validActions.includes(prefs.onSwipeRegenerate)) {
        throw new Error('Invalid memory cascade action for onSwipeRegenerate')
      }
    }
    updateData.memoryCascadePreferences = memoryCascadePreferences
  }
  if (typeof llmLoggingSettings !== 'undefined') {
    const validatedLLMLoggingSettings = LLMLoggingSettingsSchema.parse(llmLoggingSettings)
    updateData.llmLoggingSettings = validatedLLMLoggingSettings
  }
  if (typeof autoDetectRng !== 'undefined') {
    if (typeof autoDetectRng !== 'boolean') {
      throw new Error('Invalid autoDetectRng value (must be boolean)')
    }
    updateData.autoDetectRng = autoDetectRng
  }
  if (typeof customTools !== 'undefined') {
    if (typeof customTools !== 'boolean') {
      throw new Error('Invalid customTools value (must be boolean)')
    }
    updateData.customTools = customTools
  }
  if (typeof agentModeSettings !== 'undefined') {
    const validatedAgentModeSettings = AgentModeSettingsSchema.parse(agentModeSettings)
    updateData.agentModeSettings = validatedAgentModeSettings
  }
  if (typeof storyBackgroundsSettings !== 'undefined') {
    const validatedStoryBackgroundsSettings = StoryBackgroundsSettingsSchema.parse(storyBackgroundsSettings)
    updateData.storyBackgroundsSettings = validatedStoryBackgroundsSettings
  }
  if (typeof contextCompressionSettings !== 'undefined') {
    // Basic validation - ensure it's an object with expected structure
    if (contextCompressionSettings && typeof contextCompressionSettings === 'object') {
      const settings = contextCompressionSettings as any
      if (typeof settings.enabled !== 'boolean') {
        throw new Error('Invalid contextCompressionSettings.enabled (must be boolean)')
      }
      if (typeof settings.windowSize !== 'number' || settings.windowSize < 1) {
        throw new Error('Invalid contextCompressionSettings.windowSize (must be positive number)')
      }
    }
    updateData.contextCompressionSettings = contextCompressionSettings
  }
  if (typeof dangerousContentSettings !== 'undefined') {
    const validatedDangerousContentSettings = DangerousContentSettingsSchema.parse(dangerousContentSettings)
    updateData.dangerousContentSettings = validatedDangerousContentSettings
  }
  if (typeof autoLockSettings !== 'undefined') {
    const validatedAutoLockSettings = AutoLockSettingsSchema.parse(autoLockSettings)
    updateData.autoLockSettings = validatedAutoLockSettings
  }
  if (typeof compositionModeDefault !== 'undefined') {
    if (typeof compositionModeDefault !== 'boolean') {
      throw new Error('Invalid compositionModeDefault value (must be boolean)')
    }
    updateData.compositionModeDefault = compositionModeDefault
  }
  if (typeof composerSpellcheck !== 'undefined') {
    if (typeof composerSpellcheck !== 'boolean') {
      throw new Error('Invalid composerSpellcheck value (must be boolean)')
    }
    updateData.composerSpellcheck = composerSpellcheck
  }
  if (typeof composerEmoji !== 'undefined') {
    if (typeof composerEmoji !== 'boolean') {
      throw new Error('Invalid composerEmoji value (must be boolean)')
    }
    updateData.composerEmoji = composerEmoji
  }
  if (typeof textReplacementsEnabled !== 'undefined') {
    if (typeof textReplacementsEnabled !== 'boolean') {
      throw new Error('Invalid textReplacementsEnabled value (must be boolean)')
    }
    updateData.textReplacementsEnabled = textReplacementsEnabled
  }
  if (typeof autoScrollOnResponseComplete !== 'undefined') {
    if (typeof autoScrollOnResponseComplete !== 'boolean') {
      throw new Error('Invalid autoScrollOnResponseComplete value (must be boolean)')
    }
    updateData.autoScrollOnResponseComplete = autoScrollOnResponseComplete
    logger.debug('[Settings v1] autoScrollOnResponseComplete updated', { userId, autoScrollOnResponseComplete })
  }
  if (typeof autonomousRoomSettings !== 'undefined') {
    // 4.6 Private Character Rooms — shape validation kept lightweight here;
    // the Zod schema on chat_settings ultimately governs the persisted shape.
    if (autonomousRoomSettings !== null && typeof autonomousRoomSettings !== 'object') {
      throw new Error('Invalid autonomousRoomSettings value (must be an object)')
    }
    const validVisibilities = ['owner_only', 'household', 'open']
    const validPolicies = ['always_refuse', 'opt_in_per_room']
    if (autonomousRoomSettings && typeof autonomousRoomSettings === 'object') {
      const s = autonomousRoomSettings as Record<string, unknown>
      if (
        typeof s.dailyTokenBudget !== 'undefined'
        && s.dailyTokenBudget !== null
        && (typeof s.dailyTokenBudget !== 'number' || !Number.isFinite(s.dailyTokenBudget) || s.dailyTokenBudget <= 0)
      ) {
        throw new Error('Invalid dailyTokenBudget (must be positive number or null)')
      }
      if (
        typeof s.defaultFreshnessWindowMs !== 'undefined'
        && (typeof s.defaultFreshnessWindowMs !== 'number' || !Number.isFinite(s.defaultFreshnessWindowMs) || s.defaultFreshnessWindowMs <= 0)
      ) {
        throw new Error('Invalid defaultFreshnessWindowMs (must be positive number)')
      }
      if (typeof s.visibilityDefault !== 'undefined' && !validVisibilities.includes(s.visibilityDefault as string)) {
        throw new Error('Invalid visibilityDefault')
      }
      if (typeof s.destructiveToolPolicy !== 'undefined' && !validPolicies.includes(s.destructiveToolPolicy as string)) {
        throw new Error('Invalid destructiveToolPolicy')
      }
    }
    updateData.autonomousRoomSettings = autonomousRoomSettings
  }
  if (typeof thinkingDisplay !== 'undefined') {
    // Thinking / reasoning display defaults. Lightweight shape check; the Zod
    // schema on chat_settings governs the persisted shape. DISPLAY ONLY.
    if (thinkingDisplay !== null && typeof thinkingDisplay !== 'object') {
      throw new Error('Invalid thinkingDisplay value (must be an object)')
    }
    if (thinkingDisplay && typeof thinkingDisplay === 'object') {
      const s = thinkingDisplay as Record<string, unknown>
      if (typeof s.defaultVisible !== 'undefined' && typeof s.defaultVisible !== 'boolean') {
        throw new Error('Invalid thinkingDisplay.defaultVisible (must be boolean)')
      }
      if (typeof s.defaultCollapsed !== 'undefined' && typeof s.defaultCollapsed !== 'boolean') {
        throw new Error('Invalid thinkingDisplay.defaultCollapsed (must be boolean)')
      }
    }
    updateData.thinkingDisplay = thinkingDisplay
  }
  if (typeof answerConfirmationSettings !== 'undefined') {
    // Answer confirmation global default. Zod governs the persisted shape.
    const validated = AnswerConfirmationSettingsSchema.parse(answerConfirmationSettings)
    updateData.answerConfirmationSettings = validated
  }

  return repos.chatSettings.updateForUser(userId, updateData)
}

/**
 * GET /api/v1/settings/chat
 * Get chat settings for the authenticated user
 * Returns default settings if none exist
 */
export const GET = createContextHandler(async (req: NextRequest, { user, repos }: RequestContext) => {
  try {

    let chatSettings = await repos.chatSettings.findByUserId(user.id)

    // If no settings exist, create default settings via update
    if (!chatSettings) {
      chatSettings = await repos.chatSettings.updateForUser(user.id, {
        avatarDisplayMode: 'ALWAYS',
        avatarDisplayStyle: 'CIRCULAR',
        tagStyles: {},
        themePreference: {
          activeThemeId: null,
          colorMode: 'system',
          showNavThemeSelector: false,
        },
      })
    }

    return successResponse(chatSettings)
  } catch (error) {
    logger.error('[Settings v1] Error fetching chat settings', { userId: user.id }, error instanceof Error ? error : undefined)
    return serverError('Failed to fetch chat settings')
  }
})

/**
 * PUT /api/v1/settings/chat
 * Update chat settings for the authenticated user
 */
export const PUT = createContextHandler(async (req: NextRequest, { user, repos }: RequestContext) => {
  try {
    const body = await req.json()
    const {
      avatarDisplayMode,
      avatarDisplayStyle,
      tagStyles,
      cheapLLMSettings,
      imageDescriptionProfileId,
      uncensoredImageDescriptionProfileId,
      themePreference,
      defaultRoleplayTemplateId,
      sidebarWidth,
      tokenDisplaySettings,
      memoryCascadePreferences,
      llmLoggingSettings,
      autoDetectRng,
      customTools,
      agentModeSettings,
      storyBackgroundsSettings,
      contextCompressionSettings,
      dangerousContentSettings,
      autoLockSettings,
      compositionModeDefault,
      composerSpellcheck,
      composerEmoji,
      textReplacementsEnabled,
      autonomousRoomSettings,
      thinkingDisplay,
      autoScrollOnResponseComplete,
      answerConfirmationSettings,
    } = body

    const chatSettings = await updateChatSettings(
      user.id,
      repos,
      avatarDisplayMode,
      avatarDisplayStyle,
      tagStyles,
      cheapLLMSettings,
      imageDescriptionProfileId,
      uncensoredImageDescriptionProfileId,
      themePreference,
      defaultRoleplayTemplateId,
      sidebarWidth,
      tokenDisplaySettings,
      memoryCascadePreferences,
      llmLoggingSettings,
      autoDetectRng,
      customTools,
      agentModeSettings,
      storyBackgroundsSettings,
      contextCompressionSettings,
      dangerousContentSettings,
      autoLockSettings,
      compositionModeDefault,
      composerSpellcheck,
      composerEmoji,
      textReplacementsEnabled,
      autonomousRoomSettings,
      thinkingDisplay,
      autoScrollOnResponseComplete,
      answerConfirmationSettings,
    )

    return successResponse(chatSettings)
  } catch (error) {
    logger.error('[Settings v1] Error updating chat settings', { userId: user.id }, error instanceof Error ? error : undefined)
    const errorMessage = getErrorMessage(error, 'Failed to update chat settings')
    const status = errorMessage.includes('Invalid') ? 400 : 500
    if (status === 400) {
      return badRequest(errorMessage)
    }
    return serverError(errorMessage)
  }
})
