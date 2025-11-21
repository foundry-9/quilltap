// Chat Messages API: Send message with streaming response
// POST /api/chats/:id/messages - Send a message and get streaming response

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLLMProvider } from '@/lib/llm/factory'
import { decryptApiKey } from '@/lib/encryption'
import { loadChatFilesForLLM } from '@/lib/chat-files'
import { z } from 'zod'

// Validation schema
const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  // Optional array of file IDs to attach to this message
  fileIds: z.array(z.string()).optional(),
})

// POST /api/chats/:id/messages - Send message with streaming response
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
        id,
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
    const { content, fileIds } = sendMessageSchema.parse(body)

    // Load file attachments if provided
    let attachedFiles: Array<{
      id: string
      filepath: string
      filename: string
      mimeType: string
      size: number
    }> = []

    if (fileIds && fileIds.length > 0) {
      // Get the chat files from database
      const chatFiles = await prisma.chatFile.findMany({
        where: {
          id: { in: fileIds },
          chatId: chat.id,
        },
      })
      attachedFiles = chatFiles
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'USER',
        content,
      },
    })

    // Link files to this message
    if (attachedFiles.length > 0) {
      await prisma.chatFile.updateMany({
        where: {
          id: { in: attachedFiles.map((f) => f.id) },
        },
        data: {
          messageId: userMessage.id,
        },
      })
    }

    // Load file data for LLM
    const fileAttachments = await loadChatFilesForLLM(attachedFiles)

    // Prepare messages for LLM
    const messages = [
      ...chat.messages.map((msg: { role: string; content: string }) => ({
        role: msg.role.toLowerCase() as 'system' | 'user' | 'assistant',
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content,
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
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
    const modelParams = chat.connectionProfile.parameters as any

    // Create streaming response
    const encoder = new TextEncoder()
    let fullResponse = ''
    let usage: any = null
    let attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null = null

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Stream the response
          for await (const chunk of provider.streamMessage(
            {
              messages,
              model: chat.connectionProfile.modelName,
              temperature: modelParams.temperature,
              maxTokens: modelParams.maxTokens,
              topP: modelParams.topP,
            },
            decryptedKey
          )) {
            if (chunk.content) {
              fullResponse += chunk.content
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: chunk.content })}\n\n`)
              )
            }

            if (chunk.done) {
              if (chunk.usage) {
                usage = chunk.usage
              }
              if (chunk.attachmentResults) {
                attachmentResults = chunk.attachmentResults
              }
            }
          }

          // Update attachment status in database
          if (attachmentResults) {
            // Mark successfully sent attachments
            if (attachmentResults.sent.length > 0) {
              await prisma.chatFile.updateMany({
                where: { id: { in: attachmentResults.sent } },
                data: { sentToProvider: true, providerError: null },
              })
            }
            // Mark failed attachments with error messages
            for (const failure of attachmentResults.failed) {
              await prisma.chatFile.update({
                where: { id: failure.id },
                data: { sentToProvider: false, providerError: failure.error },
              })
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

          // Send final message with message ID, usage, and attachment results
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                messageId: assistantMessage.id,
                usage,
                attachmentResults,
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
