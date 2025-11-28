// Persona Physical Descriptions API: Manage physical descriptions for a persona
// GET /api/personas/[id]/descriptions - Get all descriptions for a persona
// POST /api/personas/[id]/descriptions - Create a new description

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

const createDescriptionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
})

// GET /api/personas/[id]/descriptions - Get all descriptions for a persona
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

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const descriptions = await repos.personas.getDescriptions(id)

    return NextResponse.json({ descriptions })
  } catch (error) {
    console.error('Error fetching persona descriptions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch persona descriptions' },
      { status: 500 }
    )
  }
}

// POST /api/personas/[id]/descriptions - Create a new description
export async function POST(
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

    // Verify persona exists and belongs to user
    const persona = await repos.personas.findById(id)

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = createDescriptionSchema.parse(body)

    const description = await repos.personas.addDescription(id, validatedData)

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

    console.error('Error creating persona description:', error)
    return NextResponse.json(
      { error: 'Failed to create persona description' },
      { status: 500 }
    )
  }
}
