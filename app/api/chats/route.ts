// Chat API: List and Create
// GET /api/chats - List all chats for user
// POST /api/chats - Create a new chat with participants

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { buildChatContext, type ChatContext } from '@/lib/chat/initialize'
import { decryptApiKey } from '@/lib/encryption'
import { generateGreetingMessage } from '@/lib/chat/initial-greeting'
import { z } from 'zod'
import type { ChatEvent, ChatParticipantBase } from '@/lib/json-store/schemas/types'

type Repos = ReturnType<typeof getRepositories>

// Result types for participant builders
type ParticipantBuildSuccess = {
  participant: Omit<ChatParticipantBase, 'id' | 'createdAt' | 'updatedAt'>
  tags: string[]
}
type ParticipantBuildError = { error: string }
type ParticipantBuildResult = ParticipantBuildSuccess | ParticipantBuildError

// Participant schema for chat creation
const createParticipantSchema = z.object({
  type: z.enum(['CHARACTER', 'PERSONA']),
  characterId: z.string().uuid().optional(),
  personaId: z.string().uuid().optional(),
  connectionProfileId: z.string().uuid().optional(),
  imageProfileId: z.string().uuid().optional(),
  systemPromptOverride: z.string().optional(),
})

// Validation schema for creating a chat
const createChatSchema = z.object({
  participants: z.array(createParticipantSchema).min(1, 'At least one participant is required'),
  title: z.string().optional(),
  scenario: z.string().optional(),
})

// Helper to get enriched character for list view
async function getCharacterSummary(characterId: string, repos: Repos) {
  const character = await repos.characters.findById(characterId)
  if (!character) return null

  let defaultImage = null
  if (character.defaultImageId) {
    const img = await repos.images.findById(character.defaultImageId)
    if (img) {
      defaultImage = { id: img.id, filepath: img.relativePath, url: null }
    }
  }

  return {
    id: character.id,
    name: character.name,
    title: character.title,
    avatarUrl: character.avatarUrl,
    defaultImageId: character.defaultImageId,
    defaultImage,
  }
}

// Helper to get enriched persona for list view
async function getPersonaSummary(personaId: string, repos: Repos) {
  const persona = await repos.personas.findById(personaId)
  if (!persona) return null

  let defaultImage = null
  if (persona.defaultImageId) {
    const img = await repos.images.findById(persona.defaultImageId)
    if (img) {
      defaultImage = { id: img.id, filepath: img.relativePath, url: null }
    }
  }

  return {
    id: persona.id,
    name: persona.name,
    title: persona.title,
    avatarUrl: persona.avatarUrl,
    defaultImageId: persona.defaultImageId,
    defaultImage,
  }
}

// Helper to enrich participant for list view
async function enrichParticipantSummary(participant: ChatParticipantBase, repos: Repos) {
  const character = participant.type === 'CHARACTER' && participant.characterId
    ? await getCharacterSummary(participant.characterId, repos)
    : null

  const persona = participant.type === 'PERSONA' && participant.personaId
    ? await getPersonaSummary(participant.personaId, repos)
    : null

  return {
    id: participant.id,
    type: participant.type,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    character,
    persona,
  }
}

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

    const chatMetadata = await repos.chats.findByUserId(user.id)

    // Sort by updatedAt descending
    chatMetadata.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // Enrich chats with related data
    const chats = await Promise.all(
      chatMetadata.map(async (chat) => {
        // Enrich participants
        const participants = await Promise.all(
          chat.participants.map(p => enrichParticipantSummary(p, repos))
        )

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
          participants,
          tags: tagData.filter(Boolean),
          _count: { messages: messageCount },
        }
      })
    )

    return NextResponse.json({ chats })
  } catch (error) {
    console.error('Error fetching chats:', error)
    return NextResponse.json({ error: 'Failed to fetch chats' }, { status: 500 })
  }
}

// Helper to validate and build a character participant
async function buildCharacterParticipant(
  data: z.infer<typeof createParticipantSchema>,
  displayOrder: number,
  userId: string,
  repos: Repos
): Promise<ParticipantBuildResult> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants' }
  }
  if (!data.connectionProfileId) {
    return { error: 'connectionProfileId is required for CHARACTER participants' }
  }

  const character = await repos.characters.findById(data.characterId)
  if (character?.userId !== userId) {
    return { error: 'Character not found' }
  }

  const profile = await repos.connections.findById(data.connectionProfileId)
  if (profile?.userId !== userId) {
    return { error: 'Connection profile not found' }
  }

  if (data.imageProfileId) {
    const imgProfile = await repos.imageProfiles.findById(data.imageProfileId)
    if (imgProfile?.userId !== userId) {
      return { error: 'Image profile not found' }
    }
  }

  return {
    participant: {
      type: 'CHARACTER',
      characterId: data.characterId,
      personaId: null,
      connectionProfileId: data.connectionProfileId,
      imageProfileId: data.imageProfileId || null,
      systemPromptOverride: data.systemPromptOverride || null,
      displayOrder,
      isActive: true,
    },
    tags: character.tags || [],
  }
}

// Helper to validate and build a persona participant
async function buildPersonaParticipant(
  data: z.infer<typeof createParticipantSchema>,
  displayOrder: number,
  userId: string,
  repos: Repos
): Promise<ParticipantBuildResult> {
  if (!data.personaId) {
    return { error: 'personaId is required for PERSONA participants' }
  }

  const persona = await repos.personas.findById(data.personaId)
  if (persona?.userId !== userId) {
    return { error: 'Persona not found' }
  }

  return {
    participant: {
      type: 'PERSONA',
      characterId: null,
      personaId: data.personaId,
      connectionProfileId: null,
      imageProfileId: null,
      systemPromptOverride: data.systemPromptOverride || null,
      displayOrder,
      isActive: true,
    },
    tags: persona.tags || [],
  }
}

// Result type for building all participants
type BuildParticipantsResult = {
  participants: Omit<ChatParticipantBase, 'id' | 'createdAt' | 'updatedAt'>[]
  tags: Set<string>
  firstCharacter: { characterId: string; personaId?: string }
} | { error: string }

// Helper to build and validate all participants
async function buildAllParticipants(
  participantsData: z.infer<typeof createParticipantSchema>[],
  userId: string,
  repos: Repos
): Promise<BuildParticipantsResult> {
  const builtParticipants: Omit<ChatParticipantBase, 'id' | 'createdAt' | 'updatedAt'>[] = []
  const allTagIds = new Set<string>()
  let firstCharacter: { characterId: string; personaId?: string } | null = null

  for (let i = 0; i < participantsData.length; i++) {
    const participantData = participantsData[i]
    const builder = participantData.type === 'CHARACTER'
      ? buildCharacterParticipant
      : buildPersonaParticipant

    const result = await builder(participantData, i, userId, repos)
    if ('error' in result) {
      return result
    }

    builtParticipants.push(result.participant)
    for (const tag of result.tags) {
      allTagIds.add(tag)
    }

    // Track first character for context building
    if (participantData.type === 'CHARACTER' && !firstCharacter && participantData.characterId) {
      firstCharacter = { characterId: participantData.characterId }
    }

    // Track first persona for context building
    if (participantData.type === 'PERSONA' && firstCharacter && !firstCharacter.personaId && participantData.personaId) {
      firstCharacter.personaId = participantData.personaId
    }
  }

  if (!firstCharacter) {
    return { error: 'At least one CHARACTER participant is required' }
  }

  return { participants: builtParticipants, tags: allTagIds, firstCharacter }
}

// Helper to create initial chat messages
async function createInitialMessages(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBase[],
  userId: string,
  repos: Repos
): Promise<void> {
  const systemMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'SYSTEM',
    content: context.systemPrompt,
    attachments: [],
    createdAt: new Date().toISOString(),
  }
  await repos.chats.addMessage(chatId, systemMessage)

  let firstMessageContent = (context.firstMessage || '').trim()

  if (!firstMessageContent) {
    firstMessageContent = await autoGenerateFirstMessage(context, participants, userId, repos)
  }

  if (!firstMessageContent) {
    firstMessageContent = defaultGreeting(context.character.name)
  }

  const firstMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: firstMessageContent,
    attachments: [],
    createdAt: new Date().toISOString(),
  }
  await repos.chats.addMessage(chatId, firstMessage)
}

async function autoGenerateFirstMessage(
  context: ChatContext,
  participants: ChatParticipantBase[],
  userId: string,
  repos: Repos
): Promise<string> {
  const participant = selectCharacterParticipant(context.character.id, participants)

  if (!participant?.connectionProfileId) {
    return ''
  }

  const connectionProfile = await repos.connections.findById(participant.connectionProfileId)
  if (!connectionProfile) {
    return ''
  }

  let apiKey = ''
  if (connectionProfile.apiKeyId) {
    const storedKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    if (!storedKey) {
      console.warn('Connection profile is missing its API key; falling back to default greeting')
      return ''
    }

    try {
      apiKey = decryptApiKey(storedKey.ciphertext, storedKey.iv, storedKey.authTag, userId)
    } catch (error) {
      console.error('Failed to decrypt API key for greeting generation', error)
      return ''
    }
  }

  const rawParameters = connectionProfile.parameters as Record<string, unknown> | undefined
  const parameters = rawParameters ?? {}

  try {
    const greeting = await generateGreetingMessage({
      systemPrompt: context.systemPrompt,
      characterName: context.character.name,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      baseUrl: connectionProfile.baseUrl,
      apiKey,
      temperature: extractNumber(parameters.temperature),
      maxTokens: extractNumber(parameters.maxTokens),
      topP: extractNumber(parameters.topP),
    })
    return greeting
  } catch (error) {
    console.error('Failed to auto-generate greeting for chat', error)
    return ''
  }
}

function selectCharacterParticipant(
  characterId: string,
  participants: ChatParticipantBase[]
): ChatParticipantBase | null {
  const matches = participants
    .filter(p => p.type === 'CHARACTER' && p.characterId === characterId)
    .sort((a, b) => a.displayOrder - b.displayOrder)

  if (matches.length > 0) {
    return matches[0]
  }

  const firstCharacter = participants
    .filter(p => p.type === 'CHARACTER')
    .sort((a, b) => a.displayOrder - b.displayOrder)

  return firstCharacter[0] || null
}

function extractNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}

function defaultGreeting(characterName: string): string {
  return `Hello there! I'm ${characterName}. It's great to meet you. What's on your mind today?`
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

    const buildResult = await buildAllParticipants(validatedData.participants, user.id, repos)
    if ('error' in buildResult) {
      return NextResponse.json({ error: buildResult.error }, { status: 400 })
    }

    const context = await buildChatContext(
      buildResult.firstCharacter.characterId,
      buildResult.firstCharacter.personaId,
      validatedData.scenario
    )

    const now = new Date().toISOString()
    const participantsWithTimestamps: ChatParticipantBase[] = buildResult.participants.map(p => ({
      ...p,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }))

    const chat = await repos.chats.create({
      userId: user.id,
      participants: participantsWithTimestamps,
      title: validatedData.title || `Chat with ${context.character.name}`,
      contextSummary: validatedData.scenario || null,
      tags: Array.from(buildResult.tags),
      messageCount: 0,
      lastMessageAt: null,
      lastRenameCheckInterchange: 0,
    })

    await createInitialMessages(
      chat.id,
      context,
      participantsWithTimestamps,
      user.id,
      repos
    )

    const enrichedParticipants = await Promise.all(
      chat.participants.map(p => enrichParticipantSummary(p, repos))
    )

    return NextResponse.json({
      chat: { ...chat, participants: enrichedParticipants }
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating chat:', error)
    return NextResponse.json({ error: 'Failed to create chat' }, { status: 500 })
  }
}
