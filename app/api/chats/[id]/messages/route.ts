// Chat Messages API: Send message with streaming response
// POST /api/chats/:id/messages - Send a message and get streaming response

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { createLLMProvider } from '@/lib/llm/factory'
import { decryptApiKey } from '@/lib/encryption'
import { loadChatFilesForLLM } from '@/lib/chat-files'
import { detectToolCalls, executeToolCall } from '@/lib/chat/tool-executor'
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
    return []
  }

  // Return provider-specific tool format
  switch (provider) {
    case 'ANTHROPIC':
      return [anthropicImageGenerationToolDefinition]
    case 'GOOGLE':
      // Google uses a similar format to Anthropic but called differently
      return [
        {
          name: anthropicImageGenerationToolDefinition.name,
          description: anthropicImageGenerationToolDefinition.description,
          parameters: anthropicImageGenerationToolDefinition.input_schema,
        },
      ]
    case 'OPENAI':
    case 'GROK':
    case 'OPENROUTER':
    case 'OLLAMA':
    case 'OPENAI_COMPATIBLE':
    case 'GAB_AI':
      return [imageGenerationToolDefinition]
    default:
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

    const repos = getRepositories()
    const user = await repos.users.findByEmail(session.user.email)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get chat metadata
    const chat = await repos.chats.findById(id)

    if (!chat || chat.userId !== user.id) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Get character
    const character = await repos.characters.findById(chat.characterId)
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get connection profile with API key
    const connectionProfile = await repos.connections.findById(chat.connectionProfileId)
    if (!connectionProfile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    let apiKey = null
    if (connectionProfile.apiKeyId) {
      apiKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    }

    // Get image profile if set
    let imageProfile = null
    if (chat.imageProfileId) {
      imageProfile = await repos.imageProfiles.findById(chat.imageProfileId)
    }

    // Get existing messages
    const existingMessages = await repos.chats.getMessages(id)

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
      // Get the chat files from images repository
      const allImages = await repos.images.findByChatId(id)
      attachedFiles = allImages
        .filter(img => fileIds.includes(img.id))
        .map(img => ({
          id: img.id,
          filepath: img.relativePath,
          filename: img.filename,
          mimeType: img.mimeType,
          size: img.size,
        }))
    }

    // Create user message event
    const userMessageId = crypto.randomUUID()
    const now = new Date().toISOString()
    const userMessage = {
      id: userMessageId,
      type: 'message' as const,
      role: 'USER' as const,
      content,
      createdAt: now,
      attachments: fileIds || [],
    }

    // Add user message to chat
    await repos.chats.addMessage(id, userMessage)

    // Update file attachments with message ID
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        await repos.images.update(file.id, { messageId: userMessageId })
      }
    }

    // Load file data for LLM
    const fileAttachments = await loadChatFilesForLLM(attachedFiles)

    // Prepare messages for LLM
    // Filter to only message events and exclude TOOL messages - they should not be sent to the LLM
    const messages = [
      ...existingMessages
        .filter(msg => msg.type === 'message')
        .map(msg => {
          const messageEvent = msg as any;
          return {
            role: messageEvent.role.toLowerCase() as 'system' | 'user' | 'assistant',
            content: messageEvent.content,
          };
        }),
      {
        role: 'user' as const,
        content,
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      },
    ]

    // Get API key
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No API key configured for this connection profile' },
        { status: 400 }
      )
    }

    const decryptedKey = decryptApiKey(
      apiKey.ciphertext,
      apiKey.iv,
      apiKey.authTag,
      user.id
    )

    // Get LLM provider
    const provider = createLLMProvider(
      connectionProfile.provider,
      connectionProfile.baseUrl || undefined
    )

    // Get parameters
    const modelParams = connectionProfile.parameters as any

    // Create streaming response
    const encoder = new TextEncoder()
    let fullResponse = ''
    let usage: any = null
    let attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null = null
    let rawResponse: any = null

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Get tools for this chat if an image profile is configured
          const tools = getToolsForProvider(connectionProfile.provider, chat.imageProfileId)

          // Send debug info about the actual LLM request (for debug panel)
          const llmRequestDetails = {
            provider: connectionProfile.provider,
            model: connectionProfile.modelName,
            temperature: modelParams.temperature,
            maxTokens: modelParams.maxTokens,
            topP: modelParams.topP,
            messageCount: messages.length,
            hasTools: tools.length > 0,
            tools: tools.length > 0 ? tools : undefined,
            messages: messages.map((m) => ({
              role: m.role,
              contentLength: m.content.length,
              hasAttachments: !!((m as any).attachments && (m as any).attachments.length > 0),
            })),
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ debugLLMRequest: llmRequestDetails })}\n\n`)
          )

          for await (const chunk of provider.streamMessage(
            {
              messages,
              model: connectionProfile.modelName,
              temperature: modelParams.temperature,
              maxTokens: modelParams.maxTokens,
              topP: modelParams.topP,
              tools: tools.length > 0 ? tools : undefined,
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
              if (chunk.rawResponse) {
                rawResponse = chunk.rawResponse
              }
            }
          }

          // Note: attachment status tracking (sentToProvider, providerError) would require
          // extending the BinaryIndexEntry schema and is deferred to a future phase

          // Detect and execute tool calls
          const toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }> = []
          const generatedImagePaths: Array<{ filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }> = []

          if (rawResponse) {
            const toolCalls = detectToolCalls(rawResponse, connectionProfile.provider)

            if (toolCalls.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ toolsDetected: toolCalls.length })}\n\n`)
              )

              for (const toolCall of toolCalls) {
                const toolResult = await executeToolCall(
                  toolCall,
                  id,
                  user.id,
                  chat.imageProfileId || undefined
                )

                // Collect generated image paths for ChatFile creation
                if (toolResult.success && Array.isArray(toolResult.result)) {
                  for (const img of toolResult.result) {
                    if (img.filepath) {
                      generatedImagePaths.push({
                        filename: img.filename,
                        filepath: img.filepath,
                        mimeType: img.mimeType || 'image/png',
                        size: img.size || 0,
                        width: img.width,
                        height: img.height,
                        sha256: img.sha256,
                      })
                    }
                  }
                }

                // Format tool result for display
                const resultText = toolResult.success
                  ? toolResult.toolName === 'generate_image'
                    ? `Generated ${(toolResult.result as any)?.length || 1} image(s)`
                    : JSON.stringify(toolResult.result, null, 2)
                  : `Error: ${toolResult.error || 'Unknown error'}`

                toolMessages.push({
                  toolName: toolResult.toolName,
                  success: toolResult.success,
                  content: resultText,
                  arguments: toolCall.arguments,
                  metadata: toolResult.metadata,
                })

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
            }
          }

          // Save assistant message only if there's actual content (not just a tool call)
          let assistantMessageId: string | null = null
          if (fullResponse && fullResponse.trim().length > 0) {
            assistantMessageId = crypto.randomUUID()
            const assistantMessage = {
              id: assistantMessageId,
              type: 'message' as const,
              role: 'ASSISTANT' as const,
              content: fullResponse,
              createdAt: new Date().toISOString(),
              tokenCount: usage?.totalTokens || null,
              rawResponse: rawResponse || null,
              attachments: [],
            }
            await repos.chats.addMessage(id, assistantMessage)
          }

          // Save tool messages if tools were executed
          let firstToolMessageId: string | null = null
          if (toolMessages.length > 0) {
            for (const toolMsg of toolMessages) {
              const toolMessageId = crypto.randomUUID()
              const toolMessage = {
                id: toolMessageId,
                type: 'message' as const,
                role: 'TOOL' as const,
                content: JSON.stringify({
                  toolName: toolMsg.toolName,
                  success: toolMsg.success,
                  result: toolMsg.content,
                  arguments: toolMsg.arguments,
                  provider: toolMsg.metadata?.provider,
                  model: toolMsg.metadata?.model,
                }),
                createdAt: new Date().toISOString(),
                attachments: [],
              }
              await repos.chats.addMessage(id, toolMessage)

              // Track the first tool message ID
              if (!firstToolMessageId) {
                firstToolMessageId = toolMessageId
              }

              // Attach generated images to images repository
              if (generatedImagePaths.length > 0) {
                for (const imagePath of generatedImagePaths) {
                  // If we have a SHA256, we can create the record.
                  // If not, we should probably compute it, but for now let's assume it's there
                  // or use a placeholder if the schema allows (it doesn't, it requires 64 chars)
                  
                  // If sha256 is missing, we can't create a valid record.
                  // However, executeToolCall should have provided it.
                  if (imagePath.sha256) {
                    await repos.images.create({
                      userId: user.id,
                      type: 'chat_file',
                      chatId: id,
                      messageId: toolMessageId,
                      filename: imagePath.filename,
                      relativePath: imagePath.filepath,
                      mimeType: imagePath.mimeType,
                      size: imagePath.size,
                      source: 'generated',
                      sha256: imagePath.sha256,
                      width: imagePath.width,
                      height: imagePath.height,
                      tags: [],
                    })
                  } else {
                    console.warn('Skipping chat_file creation for generated image due to missing SHA256:', imagePath.filename)
                  }
                }
              }
            }
          }

          // Update chat timestamp
          await repos.chats.update(id, { updatedAt: new Date().toISOString() })

          // Send final message - use assistant message ID if available, otherwise use the first tool message ID
          const finalMessageId = assistantMessageId || firstToolMessageId

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                done: true,
                messageId: finalMessageId,
                usage,
                attachmentResults,
                toolsExecuted: toolMessages.length > 0,
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
