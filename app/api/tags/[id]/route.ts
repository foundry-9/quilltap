// Tags API: Update and Delete
// PUT /api/tags/[id] - Update a tag name
// DELETE /api/tags/[id] - Delete a tag

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Validation schema
const updateTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(50),
})

// PUT /api/tags/[id] - Update tag name
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

    const tagId = id

    // Verify tag exists and belongs to user
    const existingTag = await prisma.tag.findUnique({
      where: { id: tagId },
    })

    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (existingTag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = updateTagSchema.parse(body)

    const nameLower = validatedData.name.toLowerCase()

    // Check if another tag with this name already exists
    const duplicateTag = await prisma.tag.findFirst({
      where: {
        userId: user.id,
        nameLower,
        id: { not: tagId },
      },
    })

    if (duplicateTag) {
      return NextResponse.json(
        { error: 'A tag with this name already exists' },
        { status: 400 }
      )
    }

    const tag = await prisma.tag.update({
      where: { id: tagId },
      data: {
        name: validatedData.name,
        nameLower,
      },
    })

    return NextResponse.json({ tag })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error updating tag:', error)
    return NextResponse.json(
      { error: 'Failed to update tag' },
      { status: 500 }
    )
  }
}

// DELETE /api/tags/[id] - Delete a tag
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

    const tagId = id

    // Verify tag exists and belongs to user
    const existingTag = await prisma.tag.findUnique({
      where: { id: tagId },
    })

    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (existingTag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Delete the tag (cascade will remove all junction table entries)
    await prisma.tag.delete({
      where: { id: tagId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting tag:', error)
    return NextResponse.json(
      { error: 'Failed to delete tag' },
      { status: 500 }
    )
  }
}
