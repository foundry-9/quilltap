// Character Physical Descriptions API: Manage physical descriptions for a character
// GET /api/characters/[id]/descriptions - Get all descriptions for a character
// POST /api/characters/[id]/descriptions - Create a new description

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const createDescriptionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/characters/[id]/descriptions - Get all descriptions for a character
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

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const descriptions = await repos.characters.getDescriptions(id)

    return NextResponse.json({ descriptions })
  } catch (error) {
    logger.error('Error fetching character descriptions', { context: 'GET /api/characters/[id]/descriptions' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch character descriptions' },
      { status: 500 }
    )
  }
}

// POST /api/characters/[id]/descriptions - Create a new description
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

    // Verify character exists and belongs to user
    const character = await repos.characters.findById(id)

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = createDescriptionSchema.parse(body)

    const description = await repos.characters.addDescription(id, validatedData)

    if (!description) {
      return NextResponse.json(
        { error: 'Failed to create description' },
        { status: 500 }
      )
    }

    return NextResponse.json({ description }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error creating character description', { context: 'POST /api/characters/[id]/descriptions' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create character description' },
      { status: 500 }
    )
  }
}
