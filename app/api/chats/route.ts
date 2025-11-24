// Chat API: List and Create
// GET /api/chats - List all chats for user
// POST /api/chats - Create a new chat (initializes with character context)

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { buildChatContext } from '@/lib/chat/initialize'
import { z } from 'zod'
import type { ChatEvent } from '@/lib/json-store/schemas/types'

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

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get all chats for user
    const chatMetadata = await repos.chats.findByUserId(user.id)

    // Sort by updatedAt descending
    chatMetadata.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // Enrich chats with related data
    const chats = await Promise.all(
      chatMetadata.map(async (chat) => {
        // Get character data
        const character = await repos.characters.findById(chat.characterId)
        let characterDefaultImage = null
        if (character?.defaultImageId) {
          characterDefaultImage = await repos.images.findById(character.defaultImageId)
        }

        // Get persona data if present
        let persona = null
        let personaDefaultImage = null
        if (chat.personaId) {
          persona = await repos.personas.findById(chat.personaId)
          if (persona?.defaultImageId) {
            personaDefaultImage = await repos.images.findById(persona.defaultImageId)
          }
        }

        // Get tags
        const tagData = await Promise.all(
          chat.tags.map(async (tagId) => {
            const tag = await repos.tags.findById(tagId)
            return tag ? { tag: { id: tag.id, name: tag.name } } : null
          })
        )

        // Get message count
        const messageCount = await repos.chats.getMessageCount(chat.id)

        return {
          id: chat.id,
          title: chat.title,
          contextSummary: chat.contextSummary,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          character: character
            ? {
                id: character.id,
                name: character.name,
                title: character.title,
                avatarUrl: character.avatarUrl,
                defaultImageId: character.defaultImageId,
                defaultImage: characterDefaultImage
                  ? {
                      id: characterDefaultImage.id,
                      filepath: characterDefaultImage.relativePath,
                      url: null,
                    }
                  : null,
              }
            : null,
          persona: persona
            ? {
                id: persona.id,
                name: persona.name,
                title: persona.title,
                avatarUrl: persona.avatarUrl,
                defaultImageId: persona.defaultImageId,
                defaultImage: personaDefaultImage
                  ? {
                      id: personaDefaultImage.id,
                      filepath: personaDefaultImage.relativePath,
                      url: null,
                    }
                  : null,
              }
            : null,
          tags: tagData.filter(Boolean),
          _count: {
            messages: messageCount,
          },
        }
      })
    )

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

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = createChatSchema.parse(body)

    // Verify character ownership
    const character = await repos.characters.findById(validatedData.characterId)

    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Verify connection profile ownership
    const profile = await repos.connections.findById(validatedData.connectionProfileId)

    if (!profile || profile.userId !== user.id) {
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

    // Get character tags (from character entity)
    const characterTags = character.tags || []

    // Get persona tags if persona is specified
    let personaTags: string[] = []
    let persona = null
    if (validatedData.personaId) {
      persona = await repos.personas.findById(validatedData.personaId)
      personaTags = persona?.tags || []
    }

    // Combine and deduplicate tags
    const allTagIds = new Set([...characterTags, ...personaTags])

    // Create chat
    const chat = await repos.chats.create({
      userId: user.id,
      characterId: validatedData.characterId,
      personaId: validatedData.personaId || null,
      connectionProfileId: validatedData.connectionProfileId,
      imageProfileId: validatedData.imageProfileId || null,
      title: validatedData.title || `Chat with ${context.character.name}`,
      contextSummary: validatedData.scenario || null,
      tags: Array.from(allTagIds),
      messageCount: 0,
      lastMessageAt: null,
    })

    // Create system message
    const systemMessage: ChatEvent = {
      type: 'message',
      id: crypto.randomUUID(),
      role: 'SYSTEM',
      content: context.systemPrompt,
      attachments: [],
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chat.id, systemMessage)

    // Create first message from character
    const firstMessage: ChatEvent = {
      type: 'message',
      id: crypto.randomUUID(),
      role: 'ASSISTANT',
      content: context.firstMessage,
      attachments: [],
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chat.id, firstMessage)

    // Build response with included relations
    const responseChat = {
      ...chat,
      character,
      persona,
      connectionProfile: profile,
    }

    return NextResponse.json({ chat: responseChat }, { status: 201 })
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
