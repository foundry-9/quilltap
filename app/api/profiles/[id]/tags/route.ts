// Connection Profile Tags API: Manage tags for a specific connection profile
// GET /api/profiles/[id]/tags - Get all tags for a connection profile
// POST /api/profiles/[id]/tags - Add a tag to a connection profile
// DELETE /api/profiles/[id]/tags?tagId=xxx - Remove a tag from a connection profile

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/profiles/[id]/tags - Get all tags for a connection profile
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const profileId = params.id

    // Verify connection profile exists and belongs to user
    const profile = await prisma.connectionProfile.findUnique({
      where: { id: profileId },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    if (profile.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const tags = await prisma.connectionProfileTag.findMany({
      where: { connectionProfileId: profileId },
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

    return NextResponse.json({ tags: tags.map(cpt => cpt.tag) })
  } catch (error) {
    console.error('Error fetching connection profile tags:', error)
    return NextResponse.json(
      { error: 'Failed to fetch connection profile tags' },
      { status: 500 }
    )
  }
}

// POST /api/profiles/[id]/tags - Add a tag to a connection profile
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const profileId = params.id

    // Verify connection profile exists and belongs to user
    const profile = await prisma.connectionProfile.findUnique({
      where: { id: profileId },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    if (profile.userId !== user.id) {
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

    // Add tag to connection profile (ignore if already exists)
    const profileTag = await prisma.connectionProfileTag.upsert({
      where: {
        connectionProfileId_tagId: {
          connectionProfileId: profileId,
          tagId: validatedData.tagId,
        },
      },
      create: {
        connectionProfileId: profileId,
        tagId: validatedData.tagId,
      },
      update: {},
      include: {
        tag: true,
      },
    })

    return NextResponse.json({ tag: profileTag.tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error adding tag to connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to add tag to connection profile' },
      { status: 500 }
    )
  }
}

// DELETE /api/profiles/[id]/tags?tagId=xxx - Remove a tag from a connection profile
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const profileId = params.id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify connection profile exists and belongs to user
    const profile = await prisma.connectionProfile.findUnique({
      where: { id: profileId },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    if (profile.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from connection profile
    await prisma.connectionProfileTag.deleteMany({
      where: {
        connectionProfileId: profileId,
        tagId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to remove tag from connection profile' },
      { status: 500 }
    )
  }
}
