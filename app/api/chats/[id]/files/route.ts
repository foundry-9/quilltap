// Chat Files API: Upload files for chat messages
// POST /api/chats/:id/files - Upload a file for a chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { uploadChatFile } from '@/lib/chat-files'

// POST /api/chats/:id/files - Upload a file
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chatId } = await params
    const session = await getServerSession(authOptions)
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

    // Upload the file
    const uploadResult = await uploadChatFile(file, chatId)

    // Save to images repository
    const chatFile = await repos.images.create({
      userId: user.id,
      type: 'chat_file',
      chatId,
      filename: uploadResult.filename,
      relativePath: uploadResult.filepath || `chats/${chatId}/${uploadResult.filename}`,
      mimeType: uploadResult.mimeType,
      size: uploadResult.size,
      sha256: uploadResult.sha256,
      source: 'upload',
      width: uploadResult.width,
      height: uploadResult.height,
      tags: [],
    })

    return NextResponse.json({
      file: {
        id: chatFile.id,
        filename: file.name, // Original filename for display
        filepath: chatFile.relativePath,
        mimeType: chatFile.mimeType,
        size: chatFile.size,
        url: `/${chatFile.relativePath}`,
      },
    })
  } catch (error) {
    console.error('Error uploading chat file:', error)

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
    const session = await getServerSession(authOptions)
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

    // Get all files for this chat from images repository
    const chatFiles = await repos.images.findByChatId(chatId)

    // Format files for response
    const allFiles = chatFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.relativePath,
      mimeType: f.mimeType,
      size: f.size,
      url: `/${f.relativePath}`,
      createdAt: f.createdAt,
      type: f.type === 'image' ? 'generatedImage' as const : 'chatFile' as const,
    }))

    // Sort by creation time, newest first
    allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json({
      files: allFiles,
    })
  } catch (error) {
    console.error('Error listing chat files:', error)
    return NextResponse.json(
      { error: 'Failed to list files' },
      { status: 500 }
    )
  }
}
