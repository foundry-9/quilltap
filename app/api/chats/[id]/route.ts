// Chat API: Get, Update, Delete
// GET /api/chats/:id - Get chat by ID with messages and participants
// PUT /api/chats/:id - Update chat metadata or participants
// DELETE /api/chats/:id - Delete chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import type { ChatParticipantBase, ChatMetadata, FileEntry } from '@/lib/schemas/types'
import { logger } from '@/lib/logger'

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : ''
  return `data/files/storage/${file.id}${ext}`
}

// Validation schema for chat updates
const updateChatSchema = z.object({
  title: z.string().optional(),
  contextSummary: z.string().optional(),
})

// Validation schema for participant updates
const updateParticipantSchema = z.object({
  participantId: z.string().uuid(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
  isActive: z.boolean().optional(),
})

// Validation schema for adding a participant
const addParticipantSchema = z.object({
  type: z.enum(['CHARACTER', 'PERSONA']),
  characterId: z.string().uuid().optional(),
  personaId: z.string().uuid().optional(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().nullish(),
  systemPromptOverride: z.string().nullish(),
  displayOrder: z.number().optional(),
})

// Combined update schema
const chatUpdateRequestSchema = z.object({
  chat: updateChatSchema.optional(),
  updateParticipant: updateParticipantSchema.optional(),
  addParticipant: addParticipantSchema.optional(),
  removeParticipantId: z.string().uuid().optional(),
})

type Repos = ReturnType<typeof getRepositories>

// Helper to get enriched character data
async function getEnrichedCharacter(characterId: string, repos: Repos) {
  const charData = await repos.characters.findById(characterId)
  if (!charData) return null

  let defaultImage = null
  if (charData.defaultImageId) {
    const fileEntry = await repos.files.findById(charData.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: charData.id,
    name: charData.name,
    title: charData.title,
    avatarUrl: charData.avatarUrl,
    defaultImageId: charData.defaultImageId,
    defaultImage,
  }
}

// Helper to get enriched persona data
async function getEnrichedPersona(personaId: string, repos: Repos) {
  const personaData = await repos.personas.findById(personaId)
  if (!personaData) return null

  let defaultImage = null
  if (personaData.defaultImageId) {
    const fileEntry = await repos.files.findById(personaData.defaultImageId)
    if (fileEntry) {
      defaultImage = { id: fileEntry.id, filepath: getFilePath(fileEntry), url: null }
    }
  }

  return {
    id: personaData.id,
    name: personaData.name,
    title: personaData.title,
    avatarUrl: personaData.avatarUrl,
    defaultImageId: personaData.defaultImageId,
    defaultImage,
  }
}

// Helper to get enriched connection profile
async function getEnrichedConnectionProfile(profileId: string, repos: Repos) {
  const profile = await repos.connections.findById(profileId)
  if (!profile) return null

  let apiKeyInfo = null
  if (profile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
    if (apiKey) {
      apiKeyInfo = { id: apiKey.id, provider: apiKey.provider, label: apiKey.label }
    }
  }

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    apiKey: apiKeyInfo,
  }
}

// Helper to get enriched image profile
async function getEnrichedImageProfile(profileId: string, repos: Repos) {
  const imgProfile = await repos.imageProfiles.findById(profileId)
  if (!imgProfile) return null

  return {
    id: imgProfile.id,
    name: imgProfile.name,
    provider: imgProfile.provider,
    modelName: imgProfile.modelName,
  }
}

// Helper to enrich participant data with related entities
async function enrichParticipant(participant: ChatParticipantBase, repos: Repos) {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getEnrichedCharacter(participant.characterId, repos)
    : null

  const persona = participant.type === 'PERSONA' && participant.personaId
    ? await getEnrichedPersona(participant.personaId, repos)
    : null

  const connectionProfile = participant.connectionProfileId
    ? await getEnrichedConnectionProfile(participant.connectionProfileId, repos)
    : null

  const imageProfile = participant.imageProfileId
    ? await getEnrichedImageProfile(participant.imageProfileId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    systemPromptOverride: participant.systemPromptOverride,
    character,
    persona,
    connectionProfile,
    imageProfile,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  }
}

// Helper to validate CHARACTER participant requirements
async function validateCharacterParticipant(
  data: z.infer<typeof addParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ error: string; status: number } | null> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants', status: 400 }
  }
  if (!data.connectionProfileId) {
    return { error: 'connectionProfileId is required for CHARACTER participants', status: 400 }
  }

  const character = await repos.characters.findById(data.characterId)
  if (!character || character.userId !== userId) {
    return { error: 'Character not found', status: 404 }
  }

  const profile = await repos.connections.findById(data.connectionProfileId)
  if (!profile || profile.userId !== userId) {
    return { error: 'Connection profile not found', status: 404 }
  }

  return null
}

// Helper to validate PERSONA participant requirements
async function validatePersonaParticipant(
  data: z.infer<typeof addParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ error: string; status: number } | null> {
  if (!data.personaId) {
    return { error: 'personaId is required for PERSONA participants', status: 400 }
  }

  const persona = await repos.personas.findById(data.personaId)
  if (!persona || persona.userId !== userId) {
    return { error: 'Persona not found', status: 404 }
  }

  return null
}

// Helper to handle participant update
async function handleParticipantUpdate(
  chatId: string,
  data: z.infer<typeof updateParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  const { participantId, ...participantData } = data

  if (participantData.connectionProfileId) {
    const profile = await repos.connections.findById(participantData.connectionProfileId)
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 }
    }
  }

  if (participantData.imageProfileId) {
    const profile = await repos.imageProfiles.findById(participantData.imageProfileId)
    if (!profile || profile.userId !== userId) {
      return { error: 'Image profile not found', status: 404 }
    }
  }

  const result = await repos.chats.updateParticipant(chatId, participantId, participantData)
  if (!result) {
    return { error: 'Participant not found', status: 404 }
  }

  return { chat: result }
}

// Helper to handle adding a participant
async function handleAddParticipant(
  chatId: string,
  data: z.infer<typeof addParticipantSchema>,
  currentParticipantCount: number,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  if (data.type === 'CHARACTER') {
    const validationError = await validateCharacterParticipant(data, userId, repos)
    if (validationError) return validationError
  }

  if (data.type === 'PERSONA') {
    const validationError = await validatePersonaParticipant(data, userId, repos)
    if (validationError) return validationError
  }

  const result = await repos.chats.addParticipant(chatId, {
    type: data.type,
    characterId: data.characterId || null,
    personaId: data.personaId || null,
    connectionProfileId: data.connectionProfileId || null,
    imageProfileId: data.imageProfileId || null,
    systemPromptOverride: data.systemPromptOverride || null,
    displayOrder: data.displayOrder ?? currentParticipantCount,
    isActive: true,
  })

  if (!result) {
    return { error: 'Failed to add participant', status: 500 }
  }

  return { chat: result }
}

// Helper to handle removing a participant
async function handleRemoveParticipant(
  chatId: string,
  participantId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  try {
    const result = await repos.chats.removeParticipant(chatId, participantId)
    if (!result) {
      return { error: 'Participant not found', status: 404 }
    }
    return { chat: result }
  } catch (error) {
    if (error instanceof Error && error.message.includes('last participant')) {
      return { error: 'Cannot remove the last participant from a chat', status: 400 }
    }
    throw error
  }
}

// GET /api/chats/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
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

    const enrichedParticipants = await Promise.all(
      chatMetadata.participants.map(p => enrichParticipant(p, repos))
    )

    const chatEvents = await repos.chats.getMessages(id)
    const messages = await Promise.all(
      chatEvents
        .filter(event => event.type === 'message')
        .map(async event => {
          if (event.type !== 'message') return null

          // Get attachments from repository using linkedTo
          const linkedFiles = await repos.files.findByLinkedTo(event.id)
          const attachments = linkedFiles.map(file => ({
            id: file.id,
            filename: file.originalFilename,
            filepath: getFilePath(file),
            mimeType: file.mimeType,
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
            debugMemoryLogs: event.debugMemoryLogs || undefined,
          }
        })
    ).then(results => results.filter(Boolean))

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      contextSummary: chatMetadata.contextSummary,
      updatedAt: chatMetadata.updatedAt,
      createdAt: chatMetadata.createdAt,
      participants: enrichedParticipants,
      user: { id: user.id, name: user.name, image: user.image },
      messages,
    }

    return NextResponse.json({ chat })
  } catch (error) {
    logger.error('Error fetching chat', { context: 'GET /api/chats/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json({ error: 'Failed to fetch chat' }, { status: 500 })
  }
}

// Helper to process all chat update operations
async function processChatUpdates(
  chatId: string,
  existingChat: ChatMetadata,
  validatedData: z.infer<typeof chatUpdateRequestSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  let updatedChat = existingChat

  if (validatedData.chat) {
    const result = await repos.chats.update(chatId, validatedData.chat)
    if (result) updatedChat = result
  }

  if (validatedData.updateParticipant) {
    const result = await handleParticipantUpdate(chatId, validatedData.updateParticipant, userId, repos)
    if ('error' in result) return result
    updatedChat = result.chat
  }

  if (validatedData.addParticipant) {
    const result = await handleAddParticipant(
      chatId,
      validatedData.addParticipant,
      updatedChat.participants.length,
      userId,
      repos
    )
    if ('error' in result) return result
    updatedChat = result.chat
  }

  if (validatedData.removeParticipantId) {
    const result = await handleRemoveParticipant(chatId, validatedData.removeParticipantId, repos)
    if ('error' in result) return result
    updatedChat = result.chat
  }

  return { chat: updatedChat }
}

// PUT /api/chats/:id
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const existingChat = await repos.chats.findById(id)

    if (!existingChat || existingChat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = chatUpdateRequestSchema.parse(body)

    const result = await processChatUpdates(id, existingChat, validatedData, user.id, repos)

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const enrichedParticipants = await Promise.all(
      result.chat.participants.map(p => enrichParticipant(p, repos))
    )

    return NextResponse.json({
      chat: { ...result.chat, participants: enrichedParticipants }
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error updating chat', { context: 'PUT /api/chats/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json({ error: 'Failed to update chat' }, { status: 500 })
  }
}

// DELETE /api/chats/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const existingChat = await repos.chats.findById(id)

    if (!existingChat || existingChat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    await repos.chats.delete(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting chat', { context: 'DELETE /api/chats/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json({ error: 'Failed to delete chat' }, { status: 500 })
  }
}
