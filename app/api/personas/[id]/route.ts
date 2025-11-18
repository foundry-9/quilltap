/**
 * Individual Persona API
 * GET /api/personas/:id - Get a specific persona
 * PUT /api/personas/:id - Update a persona
 * DELETE /api/personas/:id - Delete a persona
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const persona = await prisma.persona.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      include: {
        characters: {
          include: {
            character: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    return NextResponse.json(persona)
  } catch (error) {
    console.error('Error fetching persona:', error)
    return NextResponse.json(
      { error: 'Failed to fetch persona' },
      { status: 500 }
    )
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify persona belongs to user
    const existing = await prisma.persona.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    const body = await req.json()
    const { name, description, personalityTraits, avatarUrl, sillyTavernData } =
      body

    const persona = await prisma.persona.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        personalityTraits:
          personalityTraits !== undefined
            ? personalityTraits
            : existing.personalityTraits,
        avatarUrl: avatarUrl !== undefined ? avatarUrl : existing.avatarUrl,
        sillyTavernData:
          sillyTavernData !== undefined
            ? sillyTavernData
            : existing.sillyTavernData,
      },
    })

    return NextResponse.json(persona)
  } catch (error) {
    console.error('Error updating persona:', error)
    return NextResponse.json(
      { error: 'Failed to update persona' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify persona belongs to user
    const existing = await prisma.persona.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    await prisma.persona.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting persona:', error)
    return NextResponse.json(
      { error: 'Failed to delete persona' },
      { status: 500 }
    )
  }
}
