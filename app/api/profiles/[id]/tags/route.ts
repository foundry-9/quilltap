// Connection Profile Tags API: Manage tags for a specific connection profile
// GET /api/profiles/[id]/tags - Get all tags for a connection profile
// POST /api/profiles/[id]/tags - Add a tag to a connection profile
// DELETE /api/profiles/[id]/tags?tagId=xxx - Remove a tag from a connection profile

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/profiles/[id]/tags - Get all tags for a connection profile
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

    const profileId = id

    // Verify connection profile exists and belongs to user
    const profile = await repos.connections.findById(profileId)

    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    if (profile.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get tags for this profile
    const allTags = await repos.tags.findAll()
    const profileTags = allTags
      .filter(tag => profile.tags.includes(tag.id))
      .map(tag => ({
        id: tag.id,
        name: tag.name,
        createdAt: tag.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ tags: profileTags })
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

    const profileId = id

    // Verify connection profile exists and belongs to user
    const profile = await repos.connections.findById(profileId)

    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    if (profile.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = addTagSchema.parse(body)

    // Verify tag exists and belongs to user
    const tag = await repos.tags.findById(validatedData.tagId)

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (tag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Add tag to connection profile
    await repos.connections.addTag(profileId, validatedData.tagId)

    return NextResponse.json({ tag }, { status: 201 })
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

    const profileId = id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify connection profile exists and belongs to user
    const profile = await repos.connections.findById(profileId)

    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    if (profile.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from connection profile
    await repos.connections.removeTag(profileId, tagId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from connection profile:', error)
    return NextResponse.json(
      { error: 'Failed to remove tag from connection profile' },
      { status: 500 }
    )
  }
}
