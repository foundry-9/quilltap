/**
 * Chat Settings Management Routes
 *
 * GET    /api/chat-settings   - Get chat settings for current user
 * POST   /api/chat-settings   - Update chat settings for current user (legacy)
 * PUT    /api/chat-settings   - Update chat settings for current user
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { TagStyleMapSchema, type AvatarDisplayMode } from '@/lib/json-store/schemas/types'

/**
 * Validate and update chat settings
 */
async function updateChatSettings(
  userId: string,
  avatarDisplayMode?: string,
  avatarDisplayStyle?: string,
  tagStyles?: unknown,
  cheapLLMSettings?: unknown,
  imageDescriptionProfileId?: string | null
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

  const repos = getRepositories()

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

  return repos.users.updateChatSettings(userId, updateData)
}

/**
 * GET /api/chat-settings
 * Get chat settings for the authenticated user
 * Returns default settings if none exist
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    let chatSettings = await repos.users.getChatSettings(session.user.id)

    // If no settings exist, create default settings via update
    if (!chatSettings) {
      chatSettings = await repos.users.updateChatSettings(session.user.id, {
        avatarDisplayMode: 'ALWAYS',
        avatarDisplayStyle: 'CIRCULAR',
        tagStyles: {},
      })
    }

    return NextResponse.json(chatSettings)
  } catch (error) {
    console.error('Error fetching chat settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chat settings' },
      { status: 500 }
    )
  }
}

/**
 * Handle settings update for both POST and PUT
 */
async function handleSettingsUpdate(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { avatarDisplayMode, avatarDisplayStyle, tagStyles, cheapLLMSettings, imageDescriptionProfileId } = body

    const chatSettings = await updateChatSettings(
      session.user.id,
      avatarDisplayMode,
      avatarDisplayStyle,
      tagStyles,
      cheapLLMSettings,
      imageDescriptionProfileId
    )

    return NextResponse.json(chatSettings)
  } catch (error) {
    console.error('Error updating chat settings:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to update chat settings'
    const status = errorMessage.includes('Invalid') ? 400 : 500
    return NextResponse.json(
      { error: errorMessage },
      { status }
    )
  }
}

/**
 * POST /api/chat-settings
 * Update chat settings for the authenticated user (legacy, for backwards compatibility)
 */
export async function POST(req: NextRequest) {
  return handleSettingsUpdate(req)
}

/**
 * PUT /api/chat-settings
 * Update chat settings for the authenticated user
 */
export async function PUT(req: NextRequest) {
  return handleSettingsUpdate(req)
}
