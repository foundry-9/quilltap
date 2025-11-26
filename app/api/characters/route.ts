// Character API: List and Create
// GET /api/characters - List all characters for user
// POST /api/characters - Create a new character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

// Validation schema
const createCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  systemPrompt: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  defaultConnectionProfileId: z.string().uuid().optional(),
})

// GET /api/characters - List all characters
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

    const characters = await repos.characters.findByUserId(user.id)

    // Sort by createdAt descending
    characters.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Enrich characters with related data (defaultImage and chat count)
    const enrichedCharacters = await Promise.all(
      characters.map(async (character) => {
        // Get default image if present
        let defaultImage = null
        if (character.defaultImageId) {
          defaultImage = await repos.images.findById(character.defaultImageId)
        }

        // Get chat count for this character
        const chats = await repos.chats.findByCharacterId(character.id)

        return {
          id: character.id,
          name: character.name,
          title: character.title,
          description: character.description,
          avatarUrl: character.avatarUrl,
          defaultImageId: character.defaultImageId,
          defaultImage: defaultImage
            ? {
                id: defaultImage.id,
                filepath: defaultImage.relativePath,
                url: null,
              }
            : null,
          isFavorite: character.isFavorite,
          createdAt: character.createdAt,
          updatedAt: character.updatedAt,
          _count: {
            chats: chats.length,
          },
        }
      })
    )

    return NextResponse.json({ characters: enrichedCharacters })
  } catch (error) {
    console.error('Error fetching characters:', error)
    return NextResponse.json(
      { error: 'Failed to fetch characters' },
      { status: 500 }
    )
  }
}

// POST /api/characters - Create a new character
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
    const validatedData = createCharacterSchema.parse(body)

    const character = await repos.characters.create({
      userId: user.id,
      name: validatedData.name,
      title: validatedData.title || null,
      description: validatedData.description || null,
      personality: validatedData.personality || null,
      scenario: validatedData.scenario || null,
      firstMessage: validatedData.firstMessage || null,
      exampleDialogues: validatedData.exampleDialogues || null,
      systemPrompt: validatedData.systemPrompt || null,
      avatarUrl: validatedData.avatarUrl || null,
      defaultConnectionProfileId: validatedData.defaultConnectionProfileId || null,
      isFavorite: false,
      tags: [] as string[],
      personaLinks: [] as { personaId: string; isDefault: boolean }[],
      avatarOverrides: [] as { chatId: string; imageId: string }[],
      defaultImageId: null,
    })

    return NextResponse.json({ character }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating character:', error)
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}
