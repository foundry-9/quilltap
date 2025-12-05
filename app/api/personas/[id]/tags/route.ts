// Persona Tags API: Manage tags for a specific persona
// GET /api/personas/[id]/tags - Get all tags for a persona
// POST /api/personas/[id]/tags - Add a tag to a persona
// DELETE /api/personas/[id]/tags?tagId=xxx - Remove a tag from a persona

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/personas/[id]/tags - Get all tags for a persona
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

    const personaId = id

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(personaId)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get tag details for each tag ID
    const tags = await Promise.all(
      persona.tags.map(async (tagId) => {
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
    logger.error('Error fetching persona tags', { context: 'personas-tags-GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch persona tags' },
      { status: 500 }
    )
  }
}

// POST /api/personas/[id]/tags - Add a tag to a persona
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

    const personaId = id

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(personaId)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
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

    // Add tag to persona
    await repos.personas.addTag(personaId, validatedData.tagId)

    return NextResponse.json({ tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error adding tag to persona', { context: 'personas-tags-POST' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to add tag to persona' },
      { status: 500 }
    )
  }
}

// DELETE /api/personas/[id]/tags?tagId=xxx - Remove a tag from a persona
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

    const personaId = id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(personaId)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from persona
    await repos.personas.removeTag(personaId, tagId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing tag from persona', { context: 'personas-tags-DELETE' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to remove tag from persona' },
      { status: 500 }
    )
  }
}
