// Character API: List and Create
// GET /api/characters - List all characters for user
// POST /api/characters - Create a new character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import type { FileEntry } from '@/lib/schemas/types'

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
    const session = await getServerSession()
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
        // Get default image from repository if present
        let defaultImage = null
        if (character.defaultImageId) {
          const fileEntry = await repos.files.findById(character.defaultImageId)
          if (fileEntry) {
            defaultImage = {
              id: fileEntry.id,
              filepath: getFilePath(fileEntry),
              url: null,
            }
          }
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
          defaultImage,
          isFavorite: character.isFavorite,
          createdAt: character.createdAt,
          tags: character.tags || [],
          updatedAt: character.updatedAt,
          _count: {
            chats: chats.length,
          },
        }
      })
    )

    return NextResponse.json({ characters: enrichedCharacters })
  } catch (error) {
    logger.error('Error fetching characters:', error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch characters' },
      { status: 500 }
    )
  }
}

// POST /api/characters - Create a new character
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
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
      physicalDescriptions: [],
    })

    return NextResponse.json({ character }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error creating character:', error as Error)
    return NextResponse.json(
      { error: 'Failed to create character' },
      { status: 500 }
    )
  }
}
