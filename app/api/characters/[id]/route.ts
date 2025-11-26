// Character API: Get, Update, Delete
// GET /api/characters/:id - Get character by ID
// PUT /api/characters/:id - Update character
// DELETE /api/characters/:id - Delete character

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
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
  defaultConnectionProfileId: z.string().uuid().optional(),
})

// GET /api/characters/:id
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

    const character = await repos.characters.findById(id)

    if (!character || character.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get default image if present
    let defaultImage = null
    if (character.defaultImageId) {
      defaultImage = await repos.images.findById(character.defaultImageId)
    }

    // Get chat count
    const chats = await repos.chats.findByCharacterId(id)

    const enrichedCharacter = {
      ...character,
      defaultImage: defaultImage
        ? {
            id: defaultImage.id,
            filepath: defaultImage.relativePath,
            url: null,
          }
        : null,
      _count: {
        chats: chats.length,
      },
    }

    return NextResponse.json({ character: enrichedCharacter })
  } catch (error) {
    console.error('Error fetching character:', error)
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
    const session = await getServerSession(authOptions)
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

    console.error('Error updating character:', error)
    return NextResponse.json(
      { error: 'Failed to update character' },
      { status: 500 }
    )
  }
}

// DELETE /api/characters/:id
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

    // Verify character ownership
    const existingCharacter = await repos.characters.findById(id)

    if (!existingCharacter || existingCharacter.userId !== user.id) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Clean up any image reference if the character has a defaultImageId
    if (existingCharacter.defaultImageId) {
      try {
        await repos.images.update(existingCharacter.defaultImageId, {
          tags: [],
        })
      } catch (err) {
        // Silently fail if image cleanup doesn't work - character deletion is more important
        console.error('Failed to clean up image reference:', err)
      }
    }

    await repos.characters.delete(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting character:', error)
    return NextResponse.json(
      { error: 'Failed to delete character' },
      { status: 500 }
    )
  }
}
