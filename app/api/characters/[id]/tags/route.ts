// Character Tags API: Manage tags for a specific character
// GET /api/characters/[id]/tags - Get all tags for a character
// POST /api/characters/[id]/tags - Add a tag to a character
// DELETE /api/characters/[id]/tags?tagId=xxx - Remove a tag from a character

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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

    const characterId = id

    // Verify character exists and belongs to user
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const tags = await prisma.characterTag.findMany({
      where: { characterId },
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

    return NextResponse.json({ tags: tags.map(ct => ct.tag) })
  } catch (error) {
    console.error('Error fetching character tags:', error)
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

    const characterId = id

    // Verify character exists and belongs to user
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
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

    // Add tag to character (ignore if already exists)
    const characterTag = await prisma.characterTag.upsert({
      where: {
        characterId_tagId: {
          characterId,
          tagId: validatedData.tagId,
        },
      },
      create: {
        characterId,
        tagId: validatedData.tagId,
      },
      update: {},
      include: {
        tag: true,
      },
    })

    return NextResponse.json({ tag: characterTag.tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error adding tag to character:', error)
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

    const characterId = id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify character exists and belongs to user
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    if (character.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from character
    await prisma.characterTag.deleteMany({
      where: {
        characterId,
        tagId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from character:', error)
    return NextResponse.json(
      { error: 'Failed to remove tag from character' },
      { status: 500 }
    )
  }
}
