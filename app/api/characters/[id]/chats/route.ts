// Character Chats API: Get recent chats involving this character
// GET /api/characters/:id/chats - List recent chats with this character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/characters/:id/chats - Get recent chats for this character
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character belongs to user
    const character = await prisma.character.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get recent chats with this character
    const chats = await prisma.chat.findMany({
      where: {
        userId: user.id,
        characterId: id,
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: {
        character: {
          select: {
            id: true,
            name: true,
          },
        },
        persona: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 3, // Get last 3 messages for preview
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    })

    return NextResponse.json({ chats })
  } catch (error) {
    console.error('Error fetching character chats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}
