// Persona Physical Description Detail API: Manage a specific physical description
// GET /api/personas/[id]/descriptions/[descId] - Get a description
// PUT /api/personas/[id]/descriptions/[descId] - Update a description
// DELETE /api/personas/[id]/descriptions/[descId] - Delete a description

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const updateDescriptionSchema = z.object({
  name: z.string().min(1).optional(),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/personas/[id]/descriptions/[descId] - Get a description
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; descId: string }> }
) {
  try {
    const { id, descId } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const description = await repos.personas.getDescription(id, descId)

    if (!description) {
      return NextResponse.json({ error: 'Description not found' }, { status: 404 })
    }

    return NextResponse.json({ description })
  } catch (error) {
    logger.error('Error fetching persona description:', error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch persona description' },
      { status: 500 }
    )
  }
}

// PUT /api/personas/[id]/descriptions/[descId] - Update a description
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; descId: string }> }
) {
  try {
    const { id, descId } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = updateDescriptionSchema.parse(body)

    const description = await repos.personas.updateDescription(id, descId, validatedData)

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

    logger.error('Error updating persona description:', error as Error)
    return NextResponse.json(
      { error: 'Failed to update persona description' },
      { status: 500 }
    )
  }
}

// DELETE /api/personas/[id]/descriptions/[descId] - Delete a description
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; descId: string }> }
) {
  try {
    const { id, descId } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const success = await repos.personas.removeDescription(id, descId)

    if (!success) {
      return NextResponse.json({ error: 'Description not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting persona description:', error as Error)
    return NextResponse.json(
      { error: 'Failed to delete persona description' },
      { status: 500 }
    )
  }
}
