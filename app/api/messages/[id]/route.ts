/**
 * Message API
 * PUT /api/messages/:id - Edit a message
 * DELETE /api/messages/:id - Delete a message
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { content } = body

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    // Get message and verify user owns the chat
    const message = await prisma.message.findFirst({
      where: {
        id: params.id,
      },
      include: {
        chat: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (message.chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Update message
    const updated = await prisma.message.update({
      where: { id: params.id },
      data: {
        content,
      },
    })

    // Update chat's updatedAt timestamp
    await prisma.chat.update({
      where: { id: message.chatId },
      data: {
        updatedAt: new Date(),
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating message:', error)
    return NextResponse.json(
      { error: 'Failed to update message' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get message and verify user owns the chat
    const message = await prisma.message.findFirst({
      where: {
        id: params.id,
      },
      include: {
        chat: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (message.chat.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // If this message is part of a swipe group, delete all messages in the group
    if (message.swipeGroupId) {
      await prisma.message.deleteMany({
        where: {
          swipeGroupId: message.swipeGroupId,
        },
      })
    } else {
      // Delete single message
      await prisma.message.delete({
        where: { id: params.id },
      })
    }

    // Update chat's updatedAt timestamp
    await prisma.chat.update({
      where: { id: message.chatId },
      data: {
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting message:', error)
    return NextResponse.json(
      { error: 'Failed to delete message' },
      { status: 500 }
    )
  }
}
