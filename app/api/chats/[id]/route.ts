// Chat API: Get, Update, Delete
// GET /api/chats/:id - Get chat by ID with messages
// PUT /api/chats/:id - Update chat
// DELETE /api/chats/:id - Delete chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

// Validation schema for updates
const updateChatSchema = z.object({
  title: z.string().optional(),
  contextSummary: z.string().optional(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
})

// GET /api/chats/:id
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

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const chatMetadata = await repos.chats.findById(id)

    if (!chatMetadata || chatMetadata.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get character data with default image
    const character = await repos.characters.findById(chatMetadata.characterId)
    let characterDefaultImage = null
    if (character?.defaultImageId) {
      characterDefaultImage = await repos.images.findById(character.defaultImageId)
    }

    // Get default persona from character's persona links
    let defaultPersonaFromCharacter = null
    if (character?.personaLinks) {
      const defaultLink = character.personaLinks.find(link => link.isDefault)
      if (defaultLink) {
        const persona = await repos.personas.findById(defaultLink.personaId)
        if (persona) {
          let personaDefaultImage = null
          if (persona.defaultImageId) {
            personaDefaultImage = await repos.images.findById(persona.defaultImageId)
          }
          defaultPersonaFromCharacter = {
            persona: {
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
            },
          }
        }
      }
    }

    // Get persona data if present on chat
    let persona = null
    if (chatMetadata.personaId) {
      const personaData = await repos.personas.findById(chatMetadata.personaId)
      if (personaData) {
        let personaDefaultImage = null
        if (personaData.defaultImageId) {
          personaDefaultImage = await repos.images.findById(personaData.defaultImageId)
        }
        persona = {
          id: personaData.id,
          name: personaData.name,
          title: personaData.title,
          avatarUrl: personaData.avatarUrl,
          defaultImageId: personaData.defaultImageId,
          defaultImage: personaDefaultImage
            ? {
                id: personaDefaultImage.id,
                filepath: personaDefaultImage.relativePath,
                url: null,
              }
            : null,
        }
      }
    }

    // Get connection profile with API key info
    const connectionProfile = await repos.connections.findById(chatMetadata.connectionProfileId)
    let apiKeyInfo = null
    if (connectionProfile?.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
      if (apiKey) {
        apiKeyInfo = {
          id: apiKey.id,
          provider: apiKey.provider,
          label: apiKey.label,
        }
      }
    }

    // Get messages
    const chatEvents = await repos.chats.getMessages(id)
    const messages = await Promise.all(
      chatEvents
        .filter(event => event.type === 'message')
        .map(async event => {
          if (event.type !== 'message') return null

          // Resolve attachments from image repository
          const imageAttachments = await repos.images.findByMessageId(event.id)
          const attachments = imageAttachments.map(img => ({
            id: img.id,
            filename: img.filename,
            filepath: img.relativePath,
            mimeType: img.mimeType,
          }))

          return {
            id: event.id,
            role: event.role,
            content: event.content,
            tokenCount: event.tokenCount || null,
            createdAt: event.createdAt,
            swipeGroupId: event.swipeGroupId || null,
            swipeIndex: event.swipeIndex || null,
            attachments,
          }
        })
    )
      .then(results => results.filter(Boolean))

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      updatedAt: chatMetadata.updatedAt,
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
            personas: defaultPersonaFromCharacter ? [defaultPersonaFromCharacter] : [],
          }
        : null,
      persona,
      user: {
        id: user.id,
        name: user.name,
        image: user.image,
      },
      connectionProfile: connectionProfile
        ? {
            id: connectionProfile.id,
            name: connectionProfile.name,
            provider: connectionProfile.provider,
            modelName: connectionProfile.modelName,
            apiKey: apiKeyInfo,
          }
        : null,
      messages,
    }

    return NextResponse.json({ chat })
  } catch (error) {
    console.error('Error fetching chat:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chat' },
      { status: 500 }
    )
  }
}

// PUT /api/chats/:id
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify chat ownership
    const existingChat = await repos.chats.findById(id)

    if (!existingChat || existingChat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = updateChatSchema.parse(body)

    const chat = await repos.chats.update(id, validatedData)

    return NextResponse.json({ chat })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error updating chat:', error)
    return NextResponse.json(
      { error: 'Failed to update chat' },
      { status: 500 }
    )
  }
}

// DELETE /api/chats/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify chat ownership
    const existingChat = await repos.chats.findById(id)

    if (!existingChat || existingChat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    await repos.chats.delete(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting chat:', error)
    return NextResponse.json(
      { error: 'Failed to delete chat' },
      { status: 500 }
    )
  }
}
