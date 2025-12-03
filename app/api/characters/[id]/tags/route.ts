// Character Tags API: Manage tags for a specific character
// GET /api/characters/[id]/tags - Get all tags for a character
// POST /api/characters/[id]/tags - Add a tag to a character
// DELETE /api/characters/[id]/tags?tagId=xxx - Remove a tag from a character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/characters/[id]/tags - Get all tags for a character
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

    const characterId = id

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get tag details for each tag ID
    const tags = await Promise.all(
      character.tags.map(async (tagId) => {
        const tag = await repos.tags.findById(tagId)
        return tag
          ? {
              id: tag.id,
              name: tag.name,
              createdAt: tag.createdAt,
            }
          : null
      })
    )

    // Filter out null values and sort by name
    const validTags = tags.filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name))

    return NextResponse.json({ tags: validTags })
  } catch (error) {
    logger.error('Error fetching character tags', { context: 'GET /api/characters/[id]/tags' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch character tags' },
      { status: 500 }
    )
  }
}

// POST /api/characters/[id]/tags - Add a tag to a character
export async function POST(
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

    const characterId = id

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = addTagSchema.parse(body)

    // Verify tag exists and belongs to user
    const tag = await repos.tags.findById(validatedData.tagId)

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (tag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Add tag to character
    await repos.characters.addTag(characterId, validatedData.tagId)

    return NextResponse.json({ tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error adding tag to character', { context: 'POST /api/characters/[id]/tags' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to add tag to character' },
      { status: 500 }
    )
  }
}

// DELETE /api/characters/[id]/tags?tagId=xxx - Remove a tag from a character
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

    const characterId = id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(characterId)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from character
    await repos.characters.removeTag(characterId, tagId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing tag from character', { context: 'DELETE /api/characters/[id]/tags' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to remove tag from character' },
      { status: 500 }
    )
  }
}
