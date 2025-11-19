// Persona Tags API: Manage tags for a specific persona
// GET /api/personas/[id]/tags - Get all tags for a persona
// POST /api/personas/[id]/tags - Add a tag to a persona
// DELETE /api/personas/[id]/tags?tagId=xxx - Remove a tag from a persona

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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

    const personaId = id

    // Verify persona exists and belongs to user
    const persona = await prisma.persona.findUnique({
      where: { id: personaId },
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const tags = await prisma.personaTag.findMany({
      where: { personaId },
      include: {
        tag: {
          select: {
            id: true,
            name: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        tag: {
          name: 'asc',
        },
      },
    })

    return NextResponse.json({ tags: tags.map(pt => pt.tag) })
  } catch (error) {
    console.error('Error fetching persona tags:', error)
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

    const personaId = id

    // Verify persona exists and belongs to user
    const persona = await prisma.persona.findUnique({
      where: { id: personaId },
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = addTagSchema.parse(body)

    // Verify tag exists and belongs to user
    const tag = await prisma.tag.findUnique({
      where: { id: validatedData.tagId },
    })

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (tag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Add tag to persona (ignore if already exists)
    const personaTag = await prisma.personaTag.upsert({
      where: {
        personaId_tagId: {
          personaId,
          tagId: validatedData.tagId,
        },
      },
      create: {
        personaId,
        tagId: validatedData.tagId,
      },
      update: {},
      include: {
        tag: true,
      },
    })

    return NextResponse.json({ tag: personaTag.tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error adding tag to persona:', error)
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

    const personaId = id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify persona exists and belongs to user
    const persona = await prisma.persona.findUnique({
      where: { id: personaId },
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    if (persona.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from persona
    await prisma.personaTag.deleteMany({
      where: {
        personaId,
        tagId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from persona:', error)
    return NextResponse.json(
      { error: 'Failed to remove tag from persona' },
      { status: 500 }
    )
  }
}
