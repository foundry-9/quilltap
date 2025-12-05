// Chat Files API: Upload files for chat messages
// POST /api/chats/:id/files - Upload a file for a chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { uploadChatFile } from '@/lib/chat-files-v2'
import { logger } from '@/lib/logger'
import type { FileEntry } from '@/lib/json-store/schemas/types'

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : ''
  return `data/files/storage/${file.id}${ext}`
}

// POST /api/chats/:id/files - Upload a file
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId)

    if (!chat || chat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get the file from form data
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Upload the file (creates file entry automatically)
    const uploadResult = await uploadChatFile(file, chatId, user.id)

    // Get the file entry from repository to determine correct filepath
    const fileEntry = await repos.files.findById(uploadResult.id)
    const filepath = fileEntry ? getFilePath(fileEntry) : uploadResult.filepath

    return NextResponse.json({
      file: {
        id: uploadResult.id,
        filename: file.name, // Original filename for display
        filepath,
        mimeType: uploadResult.mimeType,
        size: uploadResult.size,
        url: filepath,
      },
    })
  } catch (error) {
    logger.error('Error uploading chat file:', {}, error as Error)

    if (error instanceof Error) {
      // Return validation errors with 400
      if (
        error.message.includes('Invalid file type') ||
        error.message.includes('File size exceeds')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

// GET /api/chats/:id/files - List files for a chat (includes uploaded files and generated images)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify chat belongs to user
    const chat = await repos.chats.findById(chatId)

    if (!chat || chat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get all files linked to this chat from repository
    const chatFiles = await repos.files.findByLinkedTo(chatId)

    // Format files for response
    const allFiles = chatFiles.map((f) => ({
      id: f.id,
      filename: f.originalFilename,
      filepath: getFilePath(f),
      mimeType: f.mimeType,
      size: f.size,
      url: getFilePath(f),
      createdAt: f.createdAt,
      type: f.source === 'GENERATED' ? 'generatedImage' as const : 'chatFile' as const,
    }))

    // Sort by creation time, newest first
    allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json({
      files: allFiles,
    })
  } catch (error) {
    logger.error('Error listing chat files:', {}, error as Error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}
