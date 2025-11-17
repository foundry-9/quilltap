// Chat Messages API: Send message with streaming response
// POST /api/chats/:id/messages - Send a message and get streaming response

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { createLLMProvider } from '@/lib/llm/factory'
import { decryptApiKey } from '@/lib/encryption'
import { z } from 'zod'

// Validation schema
const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
})

// POST /api/chats/:id/messages - Send message with streaming response
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

    // Get chat with all necessary relations
    const chat = await prisma.chat.findFirst({
      where: {
        id: params.id,
        userId: user.id,
      },
      include: {
        character: true,
        connectionProfile: {
          include: {
            apiKey: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            content: true,
          },
        },
      },
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Validate request body
    const body = await req.json()
    const { content } = sendMessageSchema.parse(body)

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'USER',
        content,
      },
    })

    // Prepare messages for LLM
    const messages = [
      ...chat.messages.map((msg) => ({
        role: msg.role.toLowerCase() as 'system' | 'user' | 'assistant',
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content,
      },
    ]

    // Get API key
    if (!chat.connectionProfile.apiKey) {
      return NextResponse.json(
        { error: 'No API key configured for this connection profile' },
        { status: 400 }
      )
    }

    const decryptedKey = decryptApiKey(
      chat.connectionProfile.apiKey.keyEncrypted,
      chat.connectionProfile.apiKey.keyIv,
      chat.connectionProfile.apiKey.keyAuthTag,
      user.id
    )

    // Get LLM provider
    const provider = createLLMProvider(
      chat.connectionProfile.provider,
      chat.connectionProfile.baseUrl || undefined
    )

    // Get parameters
    const params = chat.connectionProfile.parameters as any

    // Create streaming response
    const encoder = new TextEncoder()
    let fullResponse = ''
    let usage: any = null

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Stream the response
          for await (const chunk of provider.streamMessage(
            {
              messages,
              model: chat.connectionProfile.modelName,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
              topP: params.topP,
            },
            decryptedKey
          )) {
            if (chunk.content) {
              fullResponse += chunk.content
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: chunk.content })}\n\n`)
              )
            }

            if (chunk.done && chunk.usage) {
              usage = chunk.usage
            }
          }

          // Save assistant message
          const assistantMessage = await prisma.message.create({
            data: {
              chatId: chat.id,
              role: 'ASSISTANT',
              content: fullResponse,
              tokenCount: usage?.totalTokens || null,
              rawResponse: usage || null,
            },
          })

          // Update chat timestamp
          await prisma.chat.update({
            where: { id: chat.id },
            data: { updatedAt: new Date() },
          })

          // Send final message with message ID and usage
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                messageId: assistantMessage.id,
                usage,
              })}\n\n`
            )
          )

          controller.close()
        } catch (error) {
          console.error('Streaming error:', error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: 'Failed to generate response',
                details: error instanceof Error ? error.message : 'Unknown error',
              })}\n\n`
            )
          )
          controller.close()
        }
      },
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error sending message:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
