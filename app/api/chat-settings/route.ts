/**
 * Chat Settings Management Routes
 *
 * GET    /api/chat-settings   - Get chat settings for current user
 * POST   /api/chat-settings   - Update chat settings for current user
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AvatarDisplayMode } from '@prisma/client'

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
    if (!chatSettings) {
      chatSettings = await prisma.chatSettings.create({
        data: {
          userId: session.user.id,
          avatarDisplayMode: 'ALWAYS',
        },
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
 * POST /api/chat-settings
 * Update chat settings for the authenticated user
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { avatarDisplayMode } = body

    // Validate avatarDisplayMode
    const validModes: AvatarDisplayMode[] = ['ALWAYS', 'GROUP_ONLY', 'NEVER']
    if (!validModes.includes(avatarDisplayMode)) {
      return NextResponse.json(
        { error: 'Invalid avatar display mode' },
        { status: 400 }
      )
    }

    const chatSettings = await prisma.chatSettings.upsert({
      where: {
        userId: session.user.id,
      },
      update: {
        avatarDisplayMode,
      },
      create: {
        userId: session.user.id,
        avatarDisplayMode,
      },
    })

    return NextResponse.json(chatSettings)
  } catch (error) {
    console.error('Error updating chat settings:', error)
    return NextResponse.json(
      { error: 'Failed to update chat settings' },
      { status: 500 }
    )
  }
}
