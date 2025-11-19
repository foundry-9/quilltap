// Chat Tags API: Manage tags for a specific chat
// GET /api/chats/[id]/tags - Get all tags for a chat
// POST /api/chats/[id]/tags - Add a tag to a chat
// DELETE /api/chats/[id]/tags?tagId=xxx - Remove a tag from a chat

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const addTagSchema = z.object({
  tagId: z.string().uuid(),
})

// GET /api/chats/[id]/tags - Get all tags for a chat
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

    const chatId = params.id

    // Verify chat exists and belongs to user
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const tags = await prisma.chatTag.findMany({
      where: { chatId },
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

    return NextResponse.json({ tags: tags.map(ct => ct.tag) })
  } catch (error) {
    console.error('Error fetching chat tags:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chat tags' },
      { status: 500 }
    )
  }
}

// POST /api/chats/[id]/tags - Add a tag to a chat
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

    const chatId = params.id

    // Verify chat exists and belongs to user
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.userId !== user.id) {
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

    // Add tag to chat (ignore if already exists)
    const chatTag = await prisma.chatTag.upsert({
      where: {
        chatId_tagId: {
          chatId,
          tagId: validatedData.tagId,
        },
      },
      create: {
        chatId,
        tagId: validatedData.tagId,
      },
      update: {},
      include: {
        tag: true,
      },
    })

    return NextResponse.json({ tag: chatTag.tag }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error adding tag to chat:', error)
    return NextResponse.json(
      { error: 'Failed to add tag to chat' },
      { status: 500 }
    )
  }
}

// DELETE /api/chats/[id]/tags?tagId=xxx - Remove a tag from a chat
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

    const chatId = params.id
    const tagId = req.nextUrl.searchParams.get('tagId')

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      )
    }

    // Verify chat exists and belongs to user
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    if (chat.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Remove tag from chat
    await prisma.chatTag.deleteMany({
      where: {
        chatId,
        tagId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from chat:', error)
    return NextResponse.json(
      { error: 'Failed to remove tag from chat' },
      { status: 500 }
    )
  }
}
