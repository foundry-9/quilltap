// Tags API: Update and Delete
// PUT /api/tags/[id] - Update a tag name
// DELETE /api/tags/[id] - Delete a tag

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { z } from 'zod'
import type { Tag } from '@/lib/json-store/schemas/types'
import { logger } from '@/lib/logger'

// Validation schema
const updateTagSchema = z
  .object({
    name: z.string().min(1, 'Tag name is required').max(50).optional(),
    quickHide: z.boolean().optional(),
  })
  .refine(
    (data) => typeof data.name !== 'undefined' || typeof data.quickHide !== 'undefined',
    { message: 'At least one field must be provided' }
  )

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

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tagId = id

    // Verify tag exists and belongs to user
    const existingTag = await repos.tags.findById(tagId)

    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (existingTag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = updateTagSchema.parse(body)

    const updateData: Partial<Tag> = {}

    if (typeof validatedData.name !== 'undefined') {
      const nameLower = validatedData.name.toLowerCase()

      // Check if another tag with this name already exists
      const allTags = await repos.tags.findByUserId(user.id)
      const duplicateTag = allTags.find(
        tag => tag.nameLower === nameLower && tag.id !== tagId
      )

      if (duplicateTag) {
        return NextResponse.json(
          { error: 'A tag with this name already exists' },
          { status: 400 }
        )
      }

      updateData.name = validatedData.name
      updateData.nameLower = nameLower
    }

    if (typeof validatedData.quickHide !== 'undefined') {
      updateData.quickHide = validatedData.quickHide
    }

    const tag = await repos.tags.update(tagId, updateData)

    return NextResponse.json({ tag })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Error updating tag:', error as Error)
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

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const tagId = id

    // Verify tag exists and belongs to user
    const existingTag = await repos.tags.findById(tagId)

    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    if (existingTag.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Delete the tag (cascade will remove all junction table entries)
    await repos.tags.delete(tagId)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting tag:', error as Error)
    return NextResponse.json(
      { error: 'Failed to delete tag' },
      { status: 500 }
    )
  }
}
