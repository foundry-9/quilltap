/**
 * Message API
 * PUT /api/messages/:id - Edit a message
 * DELETE /api/messages/:id - Delete a message
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'
import type { ChatEvent, MessageEvent, ChatMetadata } from '@/lib/json-store/schemas/types'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const repos = getRepositories()

    const body = await req.json()
    const { content } = body

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    // Find the message across all chats
    const allChats = await repos.chats.findAll()
    let foundChat: ChatMetadata | null = null
    let foundMessage: MessageEvent | null = null
    let allMessages: ChatEvent[] = []
    let messageIndex = -1

    for (const chat of allChats) {
      const messages = await repos.chats.getMessages(chat.id)
      const idx = messages.findIndex(
        (m): m is MessageEvent => m.type === 'message' && m.id === id
      )
      if (idx !== -1) {
        foundChat = chat
        foundMessage = messages[idx] as MessageEvent
        allMessages = messages
        messageIndex = idx
        break
      }
    }

    if (!foundMessage || !foundChat) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Update the message content
    const updatedMessage: MessageEvent = {
      ...foundMessage,
      content,
    }

    // Update the message in the array
    allMessages[messageIndex] = updatedMessage

    // Rewrite all messages (since we need to update in place)
    // Clear and rewrite the chat messages file
    await repos.chats.clearMessages(foundChat.id)
    for (const msg of allMessages) {
      await repos.chats.addMessage(foundChat.id, msg)
    }

    // Update chat's updatedAt timestamp
    await repos.chats.update(foundChat.id, {})

    return NextResponse.json(updatedMessage)
  } catch (error) {
    logger.error('Error updating message', { endpoint: '/api/messages/[id]', method: 'PUT' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to update message' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const repos = getRepositories()

    // Find the message across all chats
    const allChats = await repos.chats.findAll()
    let foundChat: ChatMetadata | null = null
    let foundMessage: MessageEvent | null = null
    let allMessages: ChatEvent[] = []

    for (const chat of allChats) {
      const messages = await repos.chats.getMessages(chat.id)
      const message = messages.find(
        (m): m is MessageEvent => m.type === 'message' && m.id === id
      )
      if (message) {
        foundChat = chat
        foundMessage = message
        allMessages = messages
        break
      }
    }

    if (!foundMessage || !foundChat) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // If this message is part of a swipe group, delete all messages in the group
    let filteredMessages: ChatEvent[]
    if (foundMessage.swipeGroupId) {
      filteredMessages = allMessages.filter(
        (m) =>
          m.type !== 'message' ||
          (m as MessageEvent).swipeGroupId !== foundMessage!.swipeGroupId
      )
    } else {
      // Delete single message
      filteredMessages = allMessages.filter(
        (m) => m.type !== 'message' || m.id !== id
      )
    }

    // Rewrite all messages without the deleted one(s)
    await repos.chats.clearMessages(foundChat.id)
    for (const msg of filteredMessages) {
      await repos.chats.addMessage(foundChat.id, msg)
    }

    // Update chat's updatedAt timestamp
    await repos.chats.update(foundChat.id, {})

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting message', { endpoint: '/api/messages/[id]', method: 'DELETE' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to delete message' },
      { status: 500 }
    )
  }
}
