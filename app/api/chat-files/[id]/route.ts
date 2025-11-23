/**
 * Chat File API Routes
 * POST /api/chat-files/:id/tag - Copy to gallery and tag image
 * DELETE /api/chat-files/:id - Delete chat file
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'

interface RouteContext {
  params: Promise<{ id: string }>
}

const tagSchema = z.object({
  tagType: z.enum(['CHARACTER', 'PERSONA']),
  tagId: z.string(),
})

/**
 * POST /api/chat-files/:id
 * Copy chat file to gallery and optionally tag it
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json()
    const { tagType, tagId } = tagSchema.parse(body)

    // Get the chat file
    const chatFile = await prisma.chatFile.findUnique({
      where: { id },
      include: {
        chat: true,
      },
    })

    if (!chatFile) {
      return NextResponse.json({ error: 'Chat file not found' }, { status: 404 })
    }

    // Verify chat belongs to user
    if (chatFile.chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the tagged entity exists and belongs to user
    if (tagType === 'CHARACTER') {
      const character = await prisma.character.findUnique({
        where: { id: tagId, userId: session.user.id },
      })
      if (!character) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }
    } else if (tagType === 'PERSONA') {
      const persona = await prisma.persona.findUnique({
        where: { id: tagId, userId: session.user.id },
      })
      if (!persona) {
        return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
      }
    }

    // Check if this file has already been copied to the gallery with this tag
    const existingImage = await prisma.image.findFirst({
      where: {
        userId: session.user.id,
        filepath: chatFile.filepath,
        tags: {
          some: {
            tagType,
            tagId,
          },
        },
      },
    })

    if (existingImage) {
      return NextResponse.json(
        { error: 'Image already tagged', details: 'This image is already in the gallery with this tag' },
        { status: 400 }
      )
    }

    // Check if image already exists in gallery (by filepath)
    let image = await prisma.image.findFirst({
      where: {
        userId: session.user.id,
        filepath: chatFile.filepath,
      },
    })

    // If image doesn't exist in gallery, create it
    if (!image) {
      image = await prisma.image.create({
        data: {
          userId: session.user.id,
          filename: chatFile.filename,
          filepath: chatFile.filepath,
          mimeType: chatFile.mimeType,
          size: chatFile.size,
          width: chatFile.width,
          height: chatFile.height,
        },
      })
    }

    // Add tag to the image
    await prisma.imageTag.create({
      data: {
        imageId: image.id,
        tagType,
        tagId,
      },
    })

    return NextResponse.json({
      data: {
        imageId: image.id,
        tagType,
        tagId,
      },
    })
  } catch (error) {
    console.error('Error tagging chat file:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
    }

    // Check for unique constraint violation
    if ((error as any)?.code === 'P2002') {
      return NextResponse.json({ error: 'Tag already exists' }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to tag image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chat-files/:id
 * Delete a chat file
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    // Get the chat file
    const chatFile = await prisma.chatFile.findUnique({
      where: { id },
      include: {
        chat: true,
      },
    })

    if (!chatFile) {
      return NextResponse.json({ error: 'Chat file not found' }, { status: 404 })
    }

    // Verify chat belongs to user
    if (chatFile.chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if this file is used by an Image in the gallery
    const galleryImage = await prisma.image.findFirst({
      where: {
        filepath: chatFile.filepath,
      },
    })

    // Delete the database record
    await prisma.chatFile.delete({
      where: { id },
    })

    // Only delete the file from disk if it's not used in the gallery
    if (!galleryImage) {
      const fullPath = path.join(process.cwd(), 'public', chatFile.filepath)
      try {
        await fs.unlink(fullPath)
      } catch (err) {
        // File might already be deleted, that's ok
        console.warn('Could not delete file:', fullPath, err)
      }
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Error deleting chat file:', error)
    return NextResponse.json(
      { error: 'Failed to delete file', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
