/**
 * Chat Import API
 * POST /api/chats/import - Import a SillyTavern chat
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { importSTChat } from '@/lib/sillytavern/chat'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { chatData, characterId, connectionProfileId, personaId, title } =
      body

    if (!chatData || !characterId || !connectionProfileId) {
      return NextResponse.json(
        {
          error:
            'Chat data, character ID, and connection profile ID are required',
        },
        { status: 400 }
      )
    }

    // Verify character belongs to user
    const character = await prisma.character.findFirst({
      where: {
        id: characterId,
        userId: session.user.id,
      },
    })

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Verify connection profile belongs to user
    const profile = await prisma.connectionProfile.findFirst({
      where: {
        id: connectionProfileId,
        userId: session.user.id,
      },
    })

    if (!profile) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // If persona specified, verify it belongs to user
    if (personaId) {
      const persona = await prisma.persona.findFirst({
        where: {
          id: personaId,
          userId: session.user.id,
        },
      })

      if (!persona) {
        return NextResponse.json(
          { error: 'Persona not found' },
          { status: 404 }
        )
      }
    }

    // Import chat from SillyTavern format
    const importedData = importSTChat(chatData, characterId, session.user.id)

    // Get the date from the oldest message or use the create_date from metadata
    let chatCreatedAt = new Date()
    let chatUpdatedAt = new Date()

    if (importedData.messages.length > 0) {
      // Find the earliest message date
      const oldestMessage = importedData.messages.reduce((oldest, current) =>
        current.createdAt < oldest.createdAt ? current : oldest,
        importedData.messages[0]
      )
      chatCreatedAt = oldestMessage.createdAt

      // Find the latest message date
      const newestMessage = importedData.messages.reduce((newest, current) =>
        current.createdAt > newest.createdAt ? current : newest,
        importedData.messages[0]
      )
      chatUpdatedAt = newestMessage.createdAt
    }

    // Override with create_date from metadata if available
    if (chatData.create_date) {
      // Handle SillyTavern date format: "2025-11-16@07h45m47s"
      const dateString = chatData.create_date
      if (typeof dateString === 'string' && dateString.includes('@')) {
        const [datePart, timePart] = dateString.split('@')
        const timeFormatted = timePart.replace(/h/g, ':').replace(/m/g, ':').replace(/s/g, '')
        const isoDate = `${datePart}T${timeFormatted}Z`
        const parsed = new Date(isoDate)
        if (!Number.isNaN(parsed.getTime())) {
          chatCreatedAt = parsed
        }
      } else {
        const parsed = new Date(dateString)
        if (!Number.isNaN(parsed.getTime())) {
          chatCreatedAt = parsed
        }
      }
    }

    // Create chat in database
    const chat = await prisma.chat.create({
      data: {
        userId: session.user.id,
        characterId,
        personaId: personaId || null,
        connectionProfileId,
        title: title || `Chat with ${character.name}`,
        sillyTavernMetadata: importedData.metadata || undefined,
        createdAt: chatCreatedAt,
        updatedAt: chatUpdatedAt,
      },
    })

    // Create messages
    await prisma.message.createMany({
      data: importedData.messages.map((msg: any) => ({
        chatId: chat.id,
        role: msg.role,
        content: msg.content,
        swipeGroupId: msg.swipeGroupId,
        swipeIndex: msg.swipeIndex,
        rawResponse: msg.rawResponse || undefined,
        createdAt: msg.createdAt,
      })),
    })

    // Inherit tags from character, persona, and connection profile
    const tagIds = new Set<string>()

    // Get tags from character
    const characterTags = await prisma.characterTag.findMany({
      where: { characterId },
      select: { tagId: true },
    })
    for (const ct of characterTags) {
      tagIds.add(ct.tagId)
    }

    // Get tags from persona if specified
    if (personaId) {
      const personaTags = await prisma.personaTag.findMany({
        where: { personaId },
        select: { tagId: true },
      })
      for (const pt of personaTags) {
        tagIds.add(pt.tagId)
      }
    }

    // Get tags from connection profile
    const profileTags = await prisma.connectionProfileTag.findMany({
      where: { connectionProfileId },
      select: { tagId: true },
    })
    for (const pt of profileTags) {
      tagIds.add(pt.tagId)
    }

    // Create chat tags
    if (tagIds.size > 0) {
      await prisma.chatTag.createMany({
        data: Array.from(tagIds).map(tagId => ({
          chatId: chat.id,
          tagId,
        })),
        skipDuplicates: true,
      })
    }

    // Fetch the complete chat with messages
    const completeChat = await prisma.chat.findUnique({
      where: { id: chat.id },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        character: {
          include: {
            defaultImage: true,
          },
        },
        persona: true,
        connectionProfile: true,
        tags: {
          include: {
            tag: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    })

    return NextResponse.json(completeChat, { status: 201 })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Error importing chat:', errorMessage, error)
    return NextResponse.json(
      { error: errorMessage || 'Failed to import chat' },
      { status: 500 }
    )
  }
}
