/**
 * Message Swipe API
 * POST /api/messages/:id/swipe - Generate an alternative response (swipe)
 * PUT /api/messages/:id/swipe - Switch to a different swipe in the group
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { createLLMProvider } from '@/lib/llm'
import { decryptApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'
import type { ChatEvent, MessageEvent } from '@/lib/schemas/types'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const repos = getRepositories()

    // Get all chats to find which chat contains this message
    const allChats = await repos.chats.findAll()
    let foundChat = null
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

    // Only assistant messages can be swiped
    if (foundMessage.role !== 'ASSISTANT') {
      return NextResponse.json(
        { error: 'Only assistant messages can be swiped' },
        { status: 400 }
      )
    }

    // Get connection profile from first active character participant
    const characterParticipant = foundChat.participants.find(
      p => p.type === 'CHARACTER' && p.isActive && p.connectionProfileId
    )
    if (!characterParticipant?.connectionProfileId) {
      return NextResponse.json({ error: 'No connection profile configured' }, { status: 404 })
    }

    const profile = await repos.connections.findById(characterParticipant.connectionProfileId)
    if (!profile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    // Create swipe group ID if this is the first swipe
    const swipeGroupId = foundMessage.swipeGroupId || `swipe-${foundMessage.id}`

    // Update original message with swipe group ID if needed
    if (!foundMessage.swipeGroupId) {
      // Find and update the message in the messages array
      const messageIndex = allMessages.findIndex(
        (m): m is MessageEvent => m.type === 'message' && m.id === id
      )
      if (messageIndex !== -1) {
        const msg = allMessages[messageIndex] as MessageEvent
        msg.swipeGroupId = swipeGroupId
        msg.swipeIndex = 0
      }
    }

    // Get the highest swipe index in this group
    const existingSwipes = allMessages.filter(
      (m): m is MessageEvent =>
        m.type === 'message' && m.swipeGroupId === swipeGroupId
    )
    const maxSwipeIndex = existingSwipes.reduce(
      (max, m) => Math.max(max, m.swipeIndex || 0),
      0
    )
    const newSwipeIndex = maxSwipeIndex + 1

    // Get all messages before this one for context
    const messageCreatedAt = new Date(foundMessage.createdAt).getTime()
    const previousMessages = allMessages.filter(
      (m): m is MessageEvent =>
        m.type === 'message' && new Date(m.createdAt).getTime() < messageCreatedAt
    )

    // Build messages array for LLM
    const llmMessages = previousMessages.map((m) => ({
      role: m.role.toLowerCase() as 'system' | 'user' | 'assistant',
      content: m.content,
    }))

    // Get LLM provider and generate new response
    const provider = await createLLMProvider(profile.provider, profile.baseUrl || undefined)

    let apiKey = ''
    if (profile.apiKeyId) {
      const apiKeyRecord = await repos.connections.findApiKeyById(profile.apiKeyId)
      if (apiKeyRecord) {
        apiKey = decryptApiKey(
          apiKeyRecord.ciphertext,
          apiKeyRecord.iv,
          apiKeyRecord.authTag,
          session.user.id
        )
      }
    }

    const params = profile.parameters as Record<string, unknown>

    const response = await provider.sendMessage(
      {
        messages: llmMessages,
        model: profile.modelName,
        temperature: params.temperature as number | undefined,
        maxTokens: params.max_tokens as number | undefined,
        topP: params.top_p as number | undefined,
      },
      apiKey
    )

    // Create new swipe message
    const newSwipe: MessageEvent = {
      type: 'message',
      id: crypto.randomUUID(),
      role: 'ASSISTANT',
      content: response.content,
      swipeGroupId,
      swipeIndex: newSwipeIndex,
      tokenCount: response.usage.totalTokens,
      rawResponse: response.raw,
      attachments: [],
      createdAt: foundMessage.createdAt, // Keep same timestamp as original
    }

    // Add new swipe to the chat messages
    await repos.chats.addMessage(foundChat.id, newSwipe)

    // Update chat's updatedAt timestamp
    await repos.chats.update(foundChat.id, {})

    return NextResponse.json(newSwipe, { status: 201 })
  } catch (error) {
    logger.error('Error creating swipe', { context: 'POST /api/messages/:id/swipe' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create alternative response' },
      { status: 500 }
    )
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const repos = getRepositories()

    const body = await req.json()
    const { swipeIndex } = body

    if (swipeIndex === undefined) {
      return NextResponse.json(
        { error: 'Swipe index is required' },
        { status: 400 }
      )
    }

    // Find the message across all chats
    const allChats = await repos.chats.findAll()
    let foundMessage: MessageEvent | null = null
    let allMessages: ChatEvent[] = []

    for (const chat of allChats) {
      const messages = await repos.chats.getMessages(chat.id)
      const message = messages.find(
        (m): m is MessageEvent => m.type === 'message' && m.id === id
      )
      if (message) {
        foundMessage = message
        allMessages = messages
        break
      }
    }

    if (!foundMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (!foundMessage.swipeGroupId) {
      return NextResponse.json(
        { error: 'Message is not part of a swipe group' },
        { status: 400 }
      )
    }

    // Find the target swipe
    const targetSwipe = allMessages.find(
      (m): m is MessageEvent =>
        m.type === 'message' &&
        m.swipeGroupId === foundMessage!.swipeGroupId &&
        m.swipeIndex === swipeIndex
    )

    if (!targetSwipe) {
      return NextResponse.json(
        { error: 'Swipe not found' },
        { status: 404 }
      )
    }

    // Return the target swipe (UI will handle switching)
    return NextResponse.json(targetSwipe)
  } catch (error) {
    logger.error('Error switching swipe', { context: 'PUT /api/messages/:id/swipe' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to switch swipe' },
      { status: 500 }
    )
  }
}
