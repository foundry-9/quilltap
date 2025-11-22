// Chat Messages API: Send message with streaming response
// POST /api/chats/:id/messages - Send a message and get streaming response

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLLMProvider } from '@/lib/llm/factory'
import { decryptApiKey } from '@/lib/encryption'
import { loadChatFilesForLLM } from '@/lib/chat-files'
import { detectToolCalls, executeToolCall, formatToolResult } from '@/lib/chat/tool-executor'
import { imageGenerationToolDefinition, anthropicImageGenerationToolDefinition } from '@/lib/tools/image-generation-tool'
import { z } from 'zod'

// Validation schema
const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  // Optional array of file IDs to attach to this message
  fileIds: z.array(z.string()).optional(),
})

// Helper function to get tools for a provider
function getToolsForProvider(provider: string, imageProfileId?: string | null): any[] {
  // Only include image generation tool if an image profile is configured for this chat
  if (!imageProfileId) {
    console.log('[TOOLS] No image profile configured for this chat')
    return []
  }

  console.log(`[TOOLS] Image profile configured (${imageProfileId}), providing tools for provider: ${provider}`)

  // Return provider-specific tool format
  switch (provider) {
    case 'ANTHROPIC':
      console.log('[TOOLS] Providing Anthropic tool format')
      return [anthropicImageGenerationToolDefinition]
    case 'OPENAI':
    case 'GROK':
    case 'OPENROUTER':
    case 'OLLAMA':
    case 'OPENAI_COMPATIBLE':
    case 'GAB_AI':
      console.log('[TOOLS] Providing OpenAI-compatible tool format')
      return [imageGenerationToolDefinition]
    default:
      console.log(`[TOOLS] Unknown provider: ${provider}`)
      return []
  }
}

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
        imageProfile: true, // Include image profile for tool calls
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

    console.log('[TOOLS] Chat loaded - imageProfileId:', chat.imageProfileId)

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
    let rawResponse: any = null

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Stream the response from LLM
          await streamLLMResponse({
            provider,
            chat,
            user,
            messages,
            modelParams,
            decryptedKey,
            controller,
            encoder,
            callbacks: {
              onResponse: (response: string) => {
                fullResponse = response
              },
              onUsage: (u: any) => {
                usage = u
              },
              onRawResponse: (r: any) => {
                rawResponse = r
              },
              onAttachmentResults: (ar: any) => {
                attachmentResults = ar
              },
            },
          })

          // Update attachment status in database
          if (attachmentResults) {
            await updateAttachmentStatus(attachmentResults)
          }

          // Log rawResponse details for debugging
          console.log('[TOOLS] rawResponse type:', typeof rawResponse)
          console.log('[TOOLS] rawResponse keys:', rawResponse ? Object.keys(rawResponse) : 'null')
          if (rawResponse) {
            console.log('[TOOLS] rawResponse.choices:', JSON.stringify(rawResponse.choices, null, 2))
            console.log('[TOOLS] rawResponse.content:', JSON.stringify(rawResponse.content, null, 2))
          }

          // Detect and execute tool calls
          const toolExecutionMessages = await processToolCalls(
            rawResponse,
            chat,
            user,
            controller,
            encoder
          )

          // Save assistant message
          const assistantMessage = await prisma.message.create({
            data: {
              chatId: chat.id,
              role: 'ASSISTANT',
              content: fullResponse,
              tokenCount: usage?.totalTokens || null,
              rawResponse: rawResponse || null,
            },
          })

          // If tools were executed, save tool results in conversation
          if (toolExecutionMessages.length > 0) {
            await saveToolResults(chat.id, toolExecutionMessages)
          }

          // Update chat timestamp
          await prisma.chat.update({
            where: { id: chat.id },
            data: { updatedAt: new Date() },
          })

          // Send final message
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                messageId: assistantMessage.id,
                usage,
                attachmentResults,
                toolsExecuted: toolExecutionMessages.length > 0,
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

    // Helper function to stream LLM response
    async function streamLLMResponse(options: {
      provider: any
      chat: any
      user: any
      messages: any[]
      modelParams: any
      decryptedKey: string
      controller: ReadableStreamDefaultController<Uint8Array>
      encoder: TextEncoder
      callbacks: {
        onResponse: (response: string) => void
        onUsage: (usage: any) => void
        onRawResponse: (response: any) => void
        onAttachmentResults: (results: any) => void
      }
    }) {
      const { provider, chat, messages, modelParams, decryptedKey, controller, encoder, callbacks } = options

      // Get tools for this chat if an image profile is configured
      const tools = getToolsForProvider(chat.connectionProfile.provider, chat.imageProfileId)

      console.log('[TOOLS] About to call streamMessage with tools:', tools.length > 0 ? 'YES' : 'NO')
      if (tools.length > 0) {
        console.log('[TOOLS] Tools being passed:', JSON.stringify(tools, null, 2))
      }

      for await (const chunk of provider.streamMessage(
        {
          messages,
          model: chat.connectionProfile.modelName,
          temperature: modelParams.temperature,
          maxTokens: modelParams.maxTokens,
          topP: modelParams.topP,
          tools: tools.length > 0 ? tools : undefined,
        },
        decryptedKey
      )) {
        if (chunk.content) {
          fullResponse += chunk.content
          callbacks.onResponse(fullResponse)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ content: chunk.content })}\n\n`)
          )
        }

        if (chunk.done) {
          if (chunk.usage) {
            callbacks.onUsage(chunk.usage)
          }
          if (chunk.attachmentResults) {
            callbacks.onAttachmentResults(chunk.attachmentResults)
          }
          if (chunk.rawResponse) {
            callbacks.onRawResponse(chunk.rawResponse)
          }
        }
      }
    }

    // Helper function to update attachment status
    async function updateAttachmentStatus(
      attachmentResults: { sent: string[]; failed: { id: string; error: string }[] }
    ) {
      if (attachmentResults.sent.length > 0) {
        await prisma.chatFile.updateMany({
          where: { id: { in: attachmentResults.sent } },
          data: { sentToProvider: true, providerError: null },
        })
      }
      for (const failure of attachmentResults.failed) {
        await prisma.chatFile.update({
          where: { id: failure.id },
          data: { sentToProvider: false, providerError: failure.error },
        })
      }
    }

    // Helper function to process tool calls
    async function processToolCalls(
      rawResponse: any,
      chat: any,
      user: any,
      controller: ReadableStreamDefaultController<Uint8Array>,
      encoder: TextEncoder
    ): Promise<{ role: string; content: string }[]> {
      const toolExecutionMessages: { role: string; content: string }[] = []

      if (!rawResponse) {
        console.log('[TOOLS] No raw response available for tool detection')
        return toolExecutionMessages
      }

      console.log('[TOOLS] Attempting to detect tool calls from response')
      const toolCalls = detectToolCalls(rawResponse, chat.connectionProfile.provider)
      console.log(`[TOOLS] Detected ${toolCalls.length} tool call(s)`)

      if (toolCalls.length === 0) {
        console.log('[TOOLS] No tool calls detected')
        return toolExecutionMessages
      }

      console.log('[TOOLS] Notifying client of tool detection')
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ toolsDetected: toolCalls.length })}\n\n`)
      )

      for (const toolCall of toolCalls) {
        const toolResult = await executeToolCall(
          toolCall,
          chat.id,
          user.id,
          chat.imageProfileId || undefined
        )

        const formattedResult = formatToolResult(toolResult, chat.connectionProfile.provider)
        toolExecutionMessages.push(formattedResult)

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              toolResult: {
                name: toolResult.toolName,
                success: toolResult.success,
                result: toolResult.result,
              },
            })}\n\n`
          )
        )
      }

      return toolExecutionMessages
    }

    // Helper function to save tool results
    async function saveToolResults(
      chatId: string,
      toolExecutionMessages: { role: string; content: string }[]
    ) {
      for (const toolResultMsg of toolExecutionMessages) {
        await prisma.message.create({
          data: {
            chatId,
            role: toolResultMsg.role.toUpperCase() === 'SYSTEM' ? 'SYSTEM' : 'USER',
            content: toolResultMsg.content,
          },
        })
      }
    }

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
