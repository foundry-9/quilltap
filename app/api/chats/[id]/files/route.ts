// Chat Files API: Upload files for chat messages
// POST /api/chats/:id/files - Upload a file for a chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify chat belongs to user
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: user.id,
      },
    })

    if (!chat) {
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

    // Save to database
    const chatFile = await prisma.chatFile.create({
      data: {
        chatId,
        filename: uploadResult.filename,
        filepath: uploadResult.filepath,
        mimeType: uploadResult.mimeType,
        size: uploadResult.size,
        width: uploadResult.width,
        height: uploadResult.height,
      },
    })

    return NextResponse.json({
      file: {
        id: chatFile.id,
        filename: file.name, // Original filename for display
        filepath: chatFile.filepath,
        mimeType: chatFile.mimeType,
        size: chatFile.size,
        url: `/${chatFile.filepath}`,
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify chat belongs to user
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: user.id,
      },
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get uploaded chat files
    const chatFiles = await prisma.chatFile.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
    })

    // Get generated images tagged with this chat
    const generatedImages = await prisma.image.findMany({
      where: {
        userId: user.id,
        tags: {
          some: {
            tagType: 'CHAT',
            tagId: chatId,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Combine both lists, converting to the same format
    const allFiles = [
      ...chatFiles.map((f) => ({
        id: f.id,
        filename: f.filename,
        filepath: f.filepath,
        mimeType: f.mimeType,
        size: f.size,
        url: `/${f.filepath}`,
        sentToProvider: f.sentToProvider,
        providerError: f.providerError,
        createdAt: f.createdAt,
        type: 'chatFile' as const,
      })),
      ...generatedImages.map((img) => ({
        id: img.id,
        filename: img.filename,
        filepath: img.filepath,
        mimeType: img.mimeType,
        size: img.size,
        url: img.url || `/${img.filepath}`,
        createdAt: img.createdAt,
        type: 'generatedImage' as const,
      })),
    ]

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
