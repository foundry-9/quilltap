// Chat API: List and Create
// GET /api/chats - List all chats for user
// POST /api/chats - Create a new chat (initializes with character context)

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildChatContext } from '@/lib/chat/initialize'
import { z } from 'zod'

// Validation schema
const createChatSchema = z.object({
  characterId: z.string().uuid(),
  personaId: z.string().uuid().optional(),
  connectionProfileId: z.string().uuid(),
  imageProfileId: z.string().uuid().optional(),
  title: z.string().optional(),
  scenario: z.string().optional(),
})

// GET /api/chats - List all chats
export async function GET(req: NextRequest) {
  try {
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

    const chats = await prisma.chat.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            title: true,
            avatarUrl: true,
            defaultImageId: true,
            defaultImage: {
              select: {
                id: true,
                filepath: true,
                url: true,
              },
            },
          },
        },
        persona: {
          select: {
            id: true,
            name: true,
            title: true,
            avatarUrl: true,
            defaultImageId: true,
            defaultImage: {
              select: {
                id: true,
                filepath: true,
                url: true,
              },
            },
          },
        },
        tags: {
          include: {
            tag: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    })

    return NextResponse.json({ chats })
  } catch (error) {
    console.error('Error fetching chats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}

// POST /api/chats - Create a new chat
export async function POST(req: NextRequest) {
  try {
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

    const body = await req.json()
    const validatedData = createChatSchema.parse(body)

    // Verify character ownership
    const character = await prisma.character.findFirst({
      where: {
        id: validatedData.characterId,
        userId: user.id,
      },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Verify connection profile ownership
    const profile = await prisma.connectionProfile.findFirst({
      where: {
        id: validatedData.connectionProfileId,
        userId: user.id,
      },
    })

    if (!profile) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // Build chat context
    const context = await buildChatContext(
      validatedData.characterId,
      validatedData.personaId,
      validatedData.scenario
    )

    // Get character tags
    const characterTags = await prisma.characterTag.findMany({
      where: { characterId: validatedData.characterId },
      select: { tagId: true },
    })

    // Get persona tags if persona is specified
    const personaTags = validatedData.personaId
      ? await prisma.personaTag.findMany({
          where: { personaId: validatedData.personaId },
          select: { tagId: true },
        })
      : []

    // Combine and deduplicate tags
    const allTagIds = new Set([
      ...characterTags.map(ct => ct.tagId),
      ...personaTags.map(pt => pt.tagId),
    ])

    // Create chat
    const chat = await prisma.chat.create({
      data: {
        userId: user.id,
        characterId: validatedData.characterId,
        personaId: validatedData.personaId || null,
        connectionProfileId: validatedData.connectionProfileId,
        imageProfileId: validatedData.imageProfileId || null,
        title: validatedData.title || `Chat with ${context.character.name}`,
        contextSummary: validatedData.scenario || null,
        // Inherit tags from character and persona
        tags: {
          create: Array.from(allTagIds).map(tagId => ({
            tagId,
          })),
        },
      },
      include: {
        character: true,
        persona: true,
        connectionProfile: true,
      },
    })

    // Create system message
    await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'SYSTEM',
        content: context.systemPrompt,
      },
    })

    // Create first message from character
    await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'ASSISTANT',
        content: context.firstMessage,
      },
    })

    return NextResponse.json({ chat }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating chat:', error)
    return NextResponse.json(
      { error: 'Failed to create chat' },
      { status: 500 }
    )
  }
}
