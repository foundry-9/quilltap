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
import { prisma } from '@/lib/prisma'
import { AvatarDisplayMode } from '@prisma/client'

/**
 * Validate and update chat settings
 */
async function updateChatSettings(
  userId: string,
  avatarDisplayMode?: string,
  avatarDisplayStyle?: string
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

  return prisma.chatSettings.upsert({
    where: {
      userId,
    },
    update: updateData,
    create: {
      userId,
      avatarDisplayMode: (avatarDisplayMode as AvatarDisplayMode) || 'ALWAYS',
      avatarDisplayStyle: avatarDisplayStyle || 'CIRCULAR',
    },
  })
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

    let chatSettings = await prisma.chatSettings.findUnique({
      where: {
        userId: session.user.id,
      },
    })

    // If no settings exist, create default settings
    chatSettings ??= await prisma.chatSettings.create({
      data: {
        userId: session.user.id,
        avatarDisplayMode: 'ALWAYS',
      },
    })

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
    const { avatarDisplayMode, avatarDisplayStyle } = body

    const chatSettings = await updateChatSettings(
      session.user.id,
      avatarDisplayMode,
      avatarDisplayStyle
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
