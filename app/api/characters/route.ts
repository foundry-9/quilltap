// Character API: List and Create
// GET /api/characters - List all characters for user
// POST /api/characters - Create a new character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Validation schema
const createCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().min(1, 'Description is required'),
  personality: z.string().min(1, 'Personality is required'),
  scenario: z.string().min(1, 'Scenario is required'),
  firstMessage: z.string().min(1, 'First message is required'),
  exampleDialogues: z.string().optional(),
  systemPrompt: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
})

// GET /api/characters - List all characters
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const characters = await prisma.character.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { chats: true },
        },
      },
    })

    return NextResponse.json({ characters })
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = createCharacterSchema.parse(body)

    const character = await prisma.character.create({
      data: {
        userId: user.id,
        name: validatedData.name,
        description: validatedData.description,
        personality: validatedData.personality,
        scenario: validatedData.scenario,
        firstMessage: validatedData.firstMessage,
        exampleDialogues: validatedData.exampleDialogues || null,
        systemPrompt: validatedData.systemPrompt || null,
        avatarUrl: validatedData.avatarUrl || null,
      },
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
