/**
 * Chat Import API
 * POST /api/chats/import - Import a SillyTavern chat
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { importSTChat } from '@/lib/sillytavern/chat'
import type { ChatParticipantBase } from '@/lib/json-store/schemas/types'

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

    const repos = getRepositories()

    // Verify character belongs to user
    const character = await repos.characters.findById(characterId)

    if (!character || character.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      )
    }

    // Verify connection profile belongs to user
    const profile = await repos.connections.findById(connectionProfileId)

    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // If persona specified, verify it belongs to user
    let persona = null
    if (personaId) {
      persona = await repos.personas.findById(personaId)

      if (!persona || persona.userId !== session.user.id) {
        return NextResponse.json(
          { error: 'Persona not found' },
          { status: 404 }
        )
      }
    }

    // Import chat from SillyTavern format
    const importedData = importSTChat(chatData, characterId, session.user.id)

    // Collect tags from character, persona, and connection profile
    const tagIds = new Set<string>()

    // Get tags from character
    if (character.tags) {
      for (const tagId of character.tags) {
        tagIds.add(tagId)
      }
    }

    // Get tags from persona if specified
    if (persona?.tags) {
      for (const tagId of persona.tags) {
        tagIds.add(tagId)
      }
    }

    // Get tags from connection profile
    if (profile.tags) {
      for (const tagId of profile.tags) {
        tagIds.add(tagId)
      }
    }

    // Build participants array
    const now = new Date().toISOString()
    const participants: ChatParticipantBase[] = []

    // Add character participant
    participants.push({
      id: crypto.randomUUID(),
      type: 'CHARACTER',
      characterId,
      personaId: null,
      connectionProfileId,
      imageProfileId: null,
      systemPromptOverride: null,
      displayOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    // Add persona participant if specified
    if (personaId) {
      participants.push({
        id: crypto.randomUUID(),
        type: 'PERSONA',
        characterId: null,
        personaId,
        connectionProfileId: null,
        imageProfileId: null,
        systemPromptOverride: null,
        displayOrder: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
    }

    // Create chat in database
    const chat = await repos.chats.create({
      userId: session.user.id,
      participants,
      title: title || `Chat with ${character.name}`,
      sillyTavernMetadata: importedData.metadata || null,
      tags: Array.from(tagIds),
      messageCount: importedData.messages.length,
      lastRenameCheckInterchange: 0,
    })

    // Add messages to the chat
    for (const msg of importedData.messages) {
      await repos.chats.addMessage(chat.id, {
        id: crypto.randomUUID(),
        type: 'message',
        role: msg.role,
        content: msg.content,
        swipeGroupId: msg.swipeGroupId || null,
        swipeIndex: msg.swipeIndex || null,
        rawResponse: msg.rawResponse || null,
        attachments: [],
        createdAt: msg.createdAt.toISOString(),
      })
    }

    // Get the complete chat data for response
    const messages = await repos.chats.getMessages(chat.id)
    const messageEvents = messages.filter(m => m.type === 'message')

    // Get character's default image
    let defaultImage = null
    if (character.defaultImageId) {
      defaultImage = await repos.images.findById(character.defaultImageId)
    }

    // Get tags data
    const allTags = await repos.tags.findAll()
    const chatTagsData = allTags
      .filter(tag => chat.tags.includes(tag.id))
      .map(tag => ({
        chatId: chat.id,
        tagId: tag.id,
        tag: {
          id: tag.id,
          name: tag.name,
          nameLower: tag.nameLower,
          userId: tag.userId,
          createdAt: tag.createdAt,
          updatedAt: tag.updatedAt,
        },
      }))

    // Build response with participants
    const completeChat = {
      ...chat,
      messages: messageEvents.map(msg => ({
        id: msg.id,
        chatId: chat.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        updatedAt: msg.createdAt,
        swipeGroupId: msg.swipeGroupId || null,
        swipeIndex: msg.swipeIndex || null,
        tokenCount: msg.tokenCount || null,
        rawResponse: msg.rawResponse || null,
      })),
      // Include character and persona for backwards compatibility
      character: {
        ...character,
        defaultImage,
      },
      persona: persona,
      connectionProfile: profile,
      tags: chatTagsData,
      _count: {
        messages: messageEvents.length,
      },
    }

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
