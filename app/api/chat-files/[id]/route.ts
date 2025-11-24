/**
 * Chat File API Routes
 * POST /api/chat-files/:id/tag - Copy to gallery and tag image
 * DELETE /api/chat-files/:id - Delete chat file
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
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

    const repos = getRepositories()

    // Get the chat file (binary entry with type chat_file)
    const chatFile = await repos.images.findById(id)

    if (!chatFile || chatFile.type !== 'chat_file') {
      return NextResponse.json({ error: 'Chat file not found' }, { status: 404 })
    }

    // Verify chat belongs to user by checking the chatId
    if (chatFile.chatId) {
      const chat = await repos.chats.findById(chatFile.chatId)
      if (!chat || chat.userId !== session.user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else if (chatFile.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the tagged entity exists and belongs to user
    if (tagType === 'CHARACTER') {
      const character = await repos.characters.findById(tagId)
      if (!character || character.userId !== session.user.id) {
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }
    } else if (tagType === 'PERSONA') {
      const persona = await repos.personas.findById(tagId)
      if (!persona || persona.userId !== session.user.id) {
        return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
      }
    }

    // Check if this file has already been copied to the gallery with this tag
    // Look for an image type entry with same filepath/sha256 and the tag
    const allImages = await repos.images.findByUserId(session.user.id)
    const existingImage = allImages.find(
      img => img.type === 'image' &&
             img.relativePath === chatFile.relativePath &&
             img.tags.includes(tagId)
    )

    if (existingImage) {
      return NextResponse.json(
        { error: 'Image already tagged', details: 'This image is already in the gallery with this tag' },
        { status: 400 }
      )
    }

    // Check if image already exists in gallery (by filepath)
    let image = allImages.find(
      img => img.type === 'image' && img.relativePath === chatFile.relativePath
    )

    // If image doesn't exist in gallery, create it
    if (!image) {
      image = await repos.images.create({
        sha256: chatFile.sha256,
        type: 'image',
        userId: session.user.id,
        filename: chatFile.filename,
        relativePath: chatFile.relativePath,
        mimeType: chatFile.mimeType,
        size: chatFile.size,
        source: chatFile.source || 'upload',
        width: chatFile.width ?? undefined,
        height: chatFile.height ?? undefined,
        tags: [tagId],
      })
    } else {
      // Add tag to existing image
      await repos.images.addTag(image.id, tagId)
      const updatedImage = await repos.images.findById(image.id)
      if (updatedImage) {
        image = updatedImage
      }
    }

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

    return NextResponse.json(
      { error: 'Failed to tag image', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chat-files/:id
 * Delete a chat file or generated image in a chat
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    const repos = getRepositories()

    // Get the file (can be chat_file or image)
    const file = await repos.images.findById(id)

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Accept both 'chat_file' (uploaded) and 'image' (generated in chat) types
    if (file.type !== 'chat_file' && file.type !== 'image') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // For images, require a chatId to ensure they belong to a chat
    if (file.type === 'image' && !file.chatId) {
      return NextResponse.json({ error: 'Invalid file for deletion' }, { status: 400 })
    }

    // Verify the file belongs to a chat that belongs to the user
    if (file.chatId) {
      const chat = await repos.chats.findById(file.chatId)
      if (!chat || chat.userId !== session.user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else if (file.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if this file is being used elsewhere
    const allImages = await repos.images.findByUserId(session.user.id)
    
    // For chat_file type, check if there's a corresponding image in gallery
    let canDeleteFromDisk = true
    if (file.type === 'chat_file') {
      const galleryImage = allImages.find(
        img => img.type === 'image' && img.relativePath === file.relativePath
      )
      canDeleteFromDisk = !galleryImage
    }

    // Delete the database record
    const deleted = await repos.images.delete(id)
    
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
    }

    // Only delete the file from disk if it's not referenced elsewhere
    if (canDeleteFromDisk) {
      const fullPath = path.join(process.cwd(), 'public', file.relativePath)
      try {
        await fs.unlink(fullPath)
      } catch (err) {
        // File might already be deleted, that's ok
      }
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Error deleting file:', error)
    return NextResponse.json(
      { error: 'Failed to delete file', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
