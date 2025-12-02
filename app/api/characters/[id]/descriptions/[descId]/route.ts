// Character Physical Description Detail API: Manage a specific physical description
// GET /api/characters/[id]/descriptions/[descId] - Get a description
// PUT /api/characters/[id]/descriptions/[descId] - Update a description
// DELETE /api/characters/[id]/descriptions/[descId] - Delete a description

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const updateDescriptionSchema = z.object({
  name: z.string().min(1).optional(),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/characters/[id]/descriptions/[descId] - Get a description
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; descId: string }> }
) {
  try {
    const { id, descId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const description = await repos.characters.getDescription(id, descId)

    if (!description) {
      return NextResponse.json({ error: 'Description not found' }, { status: 404 })
    }

    return NextResponse.json({ description })
  } catch (error) {
    logger.error('Error fetching character description', { context: 'GET /api/characters/[id]/descriptions/[descId]' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch character description' },
      { status: 500 }
    )
  }
}

// PUT /api/characters/[id]/descriptions/[descId] - Update a description
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; descId: string }> }
) {
  try {
    const { id, descId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = updateDescriptionSchema.parse(body)

    const description = await repos.characters.updateDescription(id, descId, validatedData)

    if (!description) {
      return NextResponse.json({ error: 'Description not found' }, { status: 404 })
    }

    return NextResponse.json({ description })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error updating character description', { context: 'PUT /api/characters/[id]/descriptions/[descId]' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to update character description' },
      { status: 500 }
    )
  }
}

// DELETE /api/characters/[id]/descriptions/[descId] - Delete a description
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; descId: string }> }
) {
  try {
    const { id, descId } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const success = await repos.characters.removeDescription(id, descId)

    if (!success) {
      return NextResponse.json({ error: 'Description not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting character description', { context: 'DELETE /api/characters/[id]/descriptions/[descId]' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete character description' },
      { status: 500 }
    )
  }
}
