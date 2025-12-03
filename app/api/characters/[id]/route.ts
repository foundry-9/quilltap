// Character API: Get, Update, Delete
// GET /api/characters/:id - Get character by ID
// PUT /api/characters/:id - Update character
// DELETE /api/characters/:id - Delete character (supports cascade deletion)

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { findFileById, getFileUrl } from '@/lib/file-manager'
import { executeCascadeDelete } from '@/lib/cascade-delete'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema for updates
const updateCharacterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  systemPrompt: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  defaultConnectionProfileId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
})

// GET /api/characters/:id
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

    const character = await repos.characters.findById(id)

    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get default image from file-manager if present
    let defaultImage = null
    if (character.defaultImageId) {
      const fileEntry = await findFileById(character.defaultImageId)
      if (fileEntry) {
        defaultImage = {
          id: fileEntry.id,
          filepath: getFileUrl(fileEntry.id, fileEntry.originalFilename),
          url: null,
        }
      }
    }

    // Get chat count
    const chats = await repos.chats.findByCharacterId(id)

    const enrichedCharacter = {
      ...character,
      defaultImage,
      _count: {
        chats: chats.length,
      },
    }

    return NextResponse.json({ character: enrichedCharacter })
  } catch (error) {
    logger.error('Error fetching character', { context: 'GET /api/characters/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch character' },
      { status: 500 }
    )
  }
}

// PUT /api/characters/:id
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

    // Verify character ownership
    const existingCharacter = await repos.characters.findById(id)

    if (!existingCharacter || existingCharacter.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = updateCharacterSchema.parse(body)

    const character = await repos.characters.update(id, validatedData)

    // Revalidate the dashboard to reflect character changes
    revalidatePath('/dashboard')

    return NextResponse.json({ character })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error updating character', { context: 'PUT /api/characters/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to update character' },
      { status: 500 }
    )
  }
}

// DELETE /api/characters/:id
// Query params:
//   - cascadeChats: 'true' to delete exclusive chats
//   - cascadeImages: 'true' to delete exclusive images
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

    // Verify character ownership
    const existingCharacter = await repos.characters.findById(id)

    if (!existingCharacter || existingCharacter.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Parse cascade options from query params
    const { searchParams } = new URL(req.url)
    const cascadeChats = searchParams.get('cascadeChats') === 'true'
    const cascadeImages = searchParams.get('cascadeImages') === 'true'

    // Execute cascade delete
    const result = await executeCascadeDelete(id, {
      deleteExclusiveChats: cascadeChats,
      deleteExclusiveImages: cascadeImages,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to delete character' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      deletedChats: result.deletedChats,
      deletedImages: result.deletedImages,
      deletedMemories: result.deletedMemories,
    })
  } catch (error) {
    logger.error('Error deleting character', { context: 'DELETE /api/characters/:id' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete character' },
      { status: 500 }
    )
  }
}
