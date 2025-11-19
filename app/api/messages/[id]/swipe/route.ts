/**
 * Message Swipe API
 * POST /api/messages/:id/swipe - Generate an alternative response (swipe)
 * PUT /api/messages/:id/swipe - Switch to a different swipe in the group
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLLMProvider } from '@/lib/llm/factory'
import { decryptApiKey } from '@/lib/encryption'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    // Get message and verify user owns the chat
    const message = await prisma.message.findFirst({
      where: {
        id,
      },
      include: {
        chat: {
          select: {
            id: true,
            userId: true,
            connectionProfile: {
              include: {
                apiKey: true,
              },
            },
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

    // Only assistant messages can be swiped
    if (message.role !== 'ASSISTANT') {
      return NextResponse.json(
        { error: 'Only assistant messages can be swiped' },
        { status: 400 }
      )
    }

    // Create swipe group ID if this is the first swipe
    const swipeGroupId = message.swipeGroupId || `swipe-${message.id}`

    // Update original message with swipe group ID if needed
    if (!message.swipeGroupId) {
      await prisma.message.update({
        where: { id },
        data: {
          swipeGroupId,
          swipeIndex: 0,
        },
      })
    }

    // Get the highest swipe index in this group
    const existingSwipes = await prisma.message.findMany({
      where: {
        swipeGroupId,
      },
      orderBy: {
        swipeIndex: 'desc',
      },
      take: 1,
    })

    const newSwipeIndex = existingSwipes.length > 0
      ? (existingSwipes[0].swipeIndex || 0) + 1
      : 1

    // Get all messages before this one for context
    const previousMessages = await prisma.message.findMany({
      where: {
        chatId: message.chatId,
        createdAt: {
          lt: message.createdAt,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    // Build messages array for LLM
    const llmMessages = previousMessages.map((m) => ({
      role: m.role.toLowerCase() as 'system' | 'user' | 'assistant',
      content: m.content,
    }))

    // Get LLM provider and generate new response
    const profile = message.chat.connectionProfile
    const provider = createLLMProvider(profile.provider, profile.baseUrl || undefined)

    let apiKey = ''
    if (profile.apiKey) {
      apiKey = decryptApiKey(
        profile.apiKey.keyEncrypted,
        profile.apiKey.keyIv,
        profile.apiKey.keyAuthTag,
        session.user.id
      )
    }

    const params = profile.parameters as any

    const response = await provider.sendMessage(
      {
        messages: llmMessages,
        model: profile.modelName,
        temperature: params.temperature,
        maxTokens: params.max_tokens,
        topP: params.top_p,
      },
      apiKey
    )

    // Create new swipe message
    const newSwipe = await prisma.message.create({
      data: {
        chatId: message.chatId,
        role: 'ASSISTANT',
        content: response.content,
        swipeGroupId,
        swipeIndex: newSwipeIndex,
        tokenCount: response.usage.totalTokens,
        rawResponse: response.raw,
        createdAt: message.createdAt, // Keep same timestamp as original
      },
    })

    // Update chat's updatedAt timestamp
    await prisma.chat.update({
      where: { id: message.chatId },
      data: {
        updatedAt: new Date(),
      },
    })

    return NextResponse.json(newSwipe, { status: 201 })
  } catch (error) {
    console.error('Error creating swipe:', error)
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
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params

    const body = await req.json()
    const { swipeIndex } = body

    if (swipeIndex === undefined) {
      return NextResponse.json(
        { error: 'Swipe index is required' },
        { status: 400 }
      )
    }

    // Get message and verify user owns the chat
    const message = await prisma.message.findFirst({
      where: {
        id,
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

    if (!message.swipeGroupId) {
      return NextResponse.json(
        { error: 'Message is not part of a swipe group' },
        { status: 400 }
      )
    }

    // Verify the swipe exists
    const targetSwipe = await prisma.message.findFirst({
      where: {
        swipeGroupId: message.swipeGroupId,
        swipeIndex,
      },
    })

    if (!targetSwipe) {
      return NextResponse.json(
        { error: 'Swipe not found' },
        { status: 404 }
      )
    }

    // Return the target swipe (UI will handle switching)
    return NextResponse.json(targetSwipe)
  } catch (error) {
    console.error('Error switching swipe:', error)
    return NextResponse.json(
      { error: 'Failed to switch swipe' },
      { status: 500 }
    )
  }
}
