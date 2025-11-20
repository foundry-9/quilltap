// Character API: Get, Update, Delete
// GET /api/characters/:id - Get character by ID
// PUT /api/characters/:id - Update character
// DELETE /api/characters/:id - Delete character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Validation schema for updates
const updateCharacterSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMessage: z.string().optional(),
  exampleDialogues: z.string().optional(),
  systemPrompt: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const character = await prisma.character.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        defaultImage: true,
        _count: {
          select: { chats: true },
        },
      },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    return NextResponse.json({ character })
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character ownership
    const existingCharacter = await prisma.character.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingCharacter) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    const body = await req.json()
    const validatedData = updateCharacterSchema.parse(body)

    const character = await prisma.character.update({
      where: { id },
      data: {
        ...validatedData,
        updatedAt: new Date(),
      },
    })

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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify character ownership
    const existingCharacter = await prisma.character.findFirst({
      where: {
        id,
        userId: user.id,
      },
    })

    if (!existingCharacter) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    await prisma.character.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting character:', error)
    return NextResponse.json(
      { error: 'Failed to delete character' },
      { status: 500 }
    )
  }
}
