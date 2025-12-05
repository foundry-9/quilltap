/**
 * Chat File API Routes
 * POST /api/chat-files/:id - Tag a chat file with CHARACTER/PERSONA
 * DELETE /api/chat-files/:id - Delete a chat file
 *
 * Uses the repository pattern for metadata and S3 for file storage.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { isS3Enabled } from '@/lib/s3/config'
import { deleteFile as deleteS3File } from '@/lib/s3/operations'

interface RouteContext {
  params: Promise<{ id: string }>
}

const tagSchema = z.object({
  tagType: z.enum(['CHARACTER', 'PERSONA']),
  tagId: z.string(),
})

/**
 * POST /api/chat-files/:id
 * Tag a chat file with a CHARACTER or PERSONA
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('POST /api/chat-files/[id] - Unauthorized: no session')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json()
    const { tagType, tagId } = tagSchema.parse(body)

    logger.debug('POST /api/chat-files/[id] - Tagging file', {
      fileId: id,
      tagType,
      tagId,
      userId: session.user.id,
    })

    const repos = getRepositories()

    // Get the file from the repository
    const fileEntry = await repos.files.findById(id)

    if (!fileEntry) {
      logger.debug('POST /api/chat-files/[id] - File not found', { fileId: id })
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Verify file belongs to user
    if (fileEntry.userId !== session.user.id) {
      logger.debug('POST /api/chat-files/[id] - File does not belong to user', {
        fileId: id,
        fileUserId: fileEntry.userId,
        sessionUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the file is linked to a chat
    const chatId = fileEntry.linkedTo.find(linkId => linkId.startsWith('chat-') || linkId.length === 36)
    if (!chatId) {
      logger.debug('POST /api/chat-files/[id] - File not linked to a chat', {
        fileId: id,
        linkedTo: fileEntry.linkedTo,
      })
      return NextResponse.json({ error: 'File is not associated with a chat' }, { status: 400 })
    }

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId)
    if (!chat || chat.userId !== session.user.id) {
      logger.debug('POST /api/chat-files/[id] - Chat does not belong to user', {
        fileId: id,
        chatId,
        chatExists: !!chat,
        chatUserId: chat?.userId,
        sessionUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the tagged entity exists and belongs to user
    if (tagType === 'CHARACTER') {
      const character = await repos.characters.findById(tagId)
      if (!character || character.userId !== session.user.id) {
        logger.debug('POST /api/chat-files/[id] - Character not found or unauthorized', {
          fileId: id,
          tagId,
          characterExists: !!character,
          characterUserId: character?.userId,
          sessionUserId: session.user.id,
        })
        return NextResponse.json({ error: 'Character not found' }, { status: 404 })
      }
      logger.debug('POST /api/chat-files/[id] - Character verified', {
        fileId: id,
        characterId: tagId,
        characterName: character.name,
      })
    } else if (tagType === 'PERSONA') {
      const persona = await repos.personas.findById(tagId)
      if (!persona || persona.userId !== session.user.id) {
        logger.debug('POST /api/chat-files/[id] - Persona not found or unauthorized', {
          fileId: id,
          tagId,
          personaExists: !!persona,
          personaUserId: persona?.userId,
          sessionUserId: session.user.id,
        })
        return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
      }
      logger.debug('POST /api/chat-files/[id] - Persona verified', {
        fileId: id,
        personaId: tagId,
        personaName: persona.name,
      })
    }

    // Check if tag already exists on this file
    const alreadyTagged = fileEntry.tags.includes(tagId)
    if (alreadyTagged) {
      logger.debug('POST /api/chat-files/[id] - File already tagged', {
        fileId: id,
        tagType,
        tagId,
      })
      return NextResponse.json({
        data: {
          fileId: id,
          tagType,
          tagId,
          alreadyTagged: true,
        },
      })
    }

    // Add the tag to the file using repository
    logger.debug('POST /api/chat-files/[id] - Adding tag to file', {
      fileId: id,
      tagType,
      tagId,
    })
    const updatedFileEntry = await repos.files.addTag(id, tagId)

    logger.debug('POST /api/chat-files/[id] - Tag added successfully', {
      fileId: id,
      tagType,
      tagId,
      updatedTags: updatedFileEntry?.tags,
    })

    return NextResponse.json({
      data: {
        fileId: id,
        tagType,
        tagId,
      },
    })
  } catch (error) {
    logger.error(
      'Error tagging chat file',
      { context: 'POST /api/chat-files/[id]' },
      error instanceof Error ? error : undefined
    )

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to tag file', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chat-files/:id
 * Delete a chat file and its physical file
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      logger.debug('DELETE /api/chat-files/[id] - Unauthorized: no session')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    logger.debug('DELETE /api/chat-files/[id] - Deleting file', {
      fileId: id,
      userId: session.user.id,
    })

    const repos = getRepositories()

    // Get the file from repository
    const fileEntry = await repos.files.findById(id)

    if (!fileEntry) {
      logger.debug('DELETE /api/chat-files/[id] - File not found', { fileId: id })
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Verify file belongs to user
    if (fileEntry.userId !== session.user.id) {
      logger.debug('DELETE /api/chat-files/[id] - File does not belong to user', {
        fileId: id,
        fileUserId: fileEntry.userId,
        sessionUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the file is linked to a chat
    const chatId = fileEntry.linkedTo.find(linkId => linkId.startsWith('chat-') || linkId.length === 36)
    if (!chatId) {
      logger.debug('DELETE /api/chat-files/[id] - File not linked to a chat', {
        fileId: id,
        linkedTo: fileEntry.linkedTo,
      })
      return NextResponse.json({ error: 'File is not associated with a chat' }, { status: 400 })
    }

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId)
    if (!chat || chat.userId !== session.user.id) {
      logger.debug('DELETE /api/chat-files/[id] - Chat does not belong to user', {
        fileId: id,
        chatId,
        chatExists: !!chat,
        chatUserId: chat?.userId,
        sessionUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Delete from S3 if applicable
    const s3Enabled = isS3Enabled()
    if (s3Enabled && fileEntry.s3Key) {
      try {
        await deleteS3File(fileEntry.s3Key)
        logger.debug('DELETE /api/chat-files/[id] - Deleted from S3', {
          fileId: id,
          s3Key: fileEntry.s3Key,
        })
      } catch (s3Error) {
        logger.warn('DELETE /api/chat-files/[id] - Failed to delete from S3', {
          fileId: id,
          s3Key: fileEntry.s3Key,
          error: s3Error instanceof Error ? s3Error.message : 'Unknown error',
        })
        // Continue with metadata deletion even if S3 deletion fails
      }
    }

    // Delete the file metadata from repository
    logger.debug('DELETE /api/chat-files/[id] - Deleting file metadata', {
      fileId: id,
      filename: fileEntry.originalFilename,
    })
    const deleted = await repos.files.delete(id)

    if (!deleted) {
      logger.debug('DELETE /api/chat-files/[id] - File metadata not found', { fileId: id })
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    logger.debug('DELETE /api/chat-files/[id] - File deleted successfully', {
      fileId: id,
      filename: fileEntry.originalFilename,
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    logger.error(
      'Error deleting file',
      { context: 'DELETE /api/chat-files/[id]' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to delete file', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
