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

    // Create chat in database
    const chat = await prisma.chat.create({
      data: {
        userId: session.user.id,
        characterId,
        personaId: personaId || null,
        connectionProfileId,
        title: title || `Chat with ${character.name}`,
        sillyTavernMetadata: importedData.metadata || undefined,
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

    // Fetch the complete chat with messages
    const completeChat = await prisma.chat.findUnique({
      where: { id: chat.id },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        character: true,
        persona: true,
        connectionProfile: true,
      },
    })

    return NextResponse.json(completeChat, { status: 201 })
  } catch (error) {
    console.error('Error importing chat:', error)
    return NextResponse.json(
      { error: 'Failed to import chat' },
      { status: 500 }
    )
  }
}
