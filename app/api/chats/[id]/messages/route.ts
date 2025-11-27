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
import { processMessageForMemoryAsync } from '@/lib/memory'
import { z } from 'zod'

// Validation schema
const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  // Optional array of file IDs to attach to this message
  fileIds: z.array(z.string()).optional(),
})

// Helper function to get tools for a provider
function getToolsForProvider(provider: string, imageProfileId?: string | null, imageProviderType?: string): unknown[] {
  // Only include image generation tool if an image profile is configured for this chat
  if (!imageProfileId) {
    return []
  }

  // Return provider-specific tool format
  switch (provider) {
    case 'ANTHROPIC': {
      // Check if using Grok for image generation
      if (imageProviderType === 'GROK') {
        return [{
          ...anthropicImageGenerationToolDefinition,
          input_schema: {
            ...anthropicImageGenerationToolDefinition.input_schema,
            properties: {
              ...anthropicImageGenerationToolDefinition.input_schema.properties,
              prompt: {
                ...anthropicImageGenerationToolDefinition.input_schema.properties.prompt,
                description: anthropicImageGenerationToolDefinition.input_schema.properties.prompt.description + ' IMPORTANT: Grok has a strict limit of 1024 bytes for image generation prompts. Keep your prompt concise and under this limit.',
              },
            },
          },
        }]
      }
      return [anthropicImageGenerationToolDefinition]
    }
    case 'GOOGLE': {
      // Google uses a similar format to Anthropic but called differently
      const baseGoogleTool = {
        name: anthropicImageGenerationToolDefinition.name,
        description: anthropicImageGenerationToolDefinition.description,
        parameters: anthropicImageGenerationToolDefinition.input_schema,
      }
      // Check if using Grok for image generation
      if (imageProviderType === 'GROK') {
        return [{
          ...baseGoogleTool,
          parameters: {
            ...baseGoogleTool.parameters,
            properties: {
              ...baseGoogleTool.parameters.properties,
              prompt: {
                ...baseGoogleTool.parameters.properties.prompt,
                description: baseGoogleTool.parameters.properties.prompt.description + ' IMPORTANT: Grok has a strict limit of 1024 bytes for image generation prompts. Keep your prompt concise and under this limit.',
              },
            },
          },
        }]
      }
      return [baseGoogleTool]
    }
    case 'OPENAI':
    case 'GROK':
    case 'OPENROUTER':
    case 'OLLAMA':
    case 'OPENAI_COMPATIBLE':
    case 'GAB_AI': {
      // Check if using Grok for image generation
      if (imageProviderType === 'GROK') {
        return [{
          ...imageGenerationToolDefinition,
          function: {
            ...imageGenerationToolDefinition.function,
            parameters: {
              ...imageGenerationToolDefinition.function.parameters,
              properties: {
                ...imageGenerationToolDefinition.function.parameters.properties,
                prompt: {
                  ...imageGenerationToolDefinition.function.parameters.properties.prompt,
                  description: imageGenerationToolDefinition.function.parameters.properties.prompt.description + ' IMPORTANT: Grok has a strict limit of 1024 bytes for image generation prompts. Keep your prompt concise and under this limit.',
                },
              },
            },
          },
        }]
      }
      return [imageGenerationToolDefinition]
    }
    default:
      return []
  }
}

// Helper function to load attached files
async function loadAttachedFiles(repos: ReturnType<typeof getRepositories>, chatId: string, fileIds?: string[]) {
  if (!fileIds || fileIds.length === 0) {
    return []
  }

  const allImages = await repos.images.findByChatId(chatId)
  return allImages
    .filter(img => fileIds.includes(img.id))
    .map(img => ({
      id: img.id,
      filepath: img.relativePath,
      filename: img.filename,
      mimeType: img.mimeType,
      size: img.size,
    }))
}

// Helper function to process tool execution results
async function processToolResults(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  chatId: string,
  userId: string,
  imageProfileId: string | undefined,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  const toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }> = []
  const generatedImagePaths: Array<{ filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }> = []

  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ toolsDetected: toolCalls.length })}\n\n`)
  )

  for (const toolCall of toolCalls) {
    const toolResult = await executeToolCall(toolCall, chatId, userId, imageProfileId)

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

    let resultText: string
    if (!toolResult.success) {
      resultText = `Error: ${toolResult.error || 'Unknown error'}`
    } else if (toolResult.toolName === 'generate_image') {
      resultText = `Generated ${(toolResult.result as unknown[])?.length || 1} image(s)`
    } else {
      resultText = JSON.stringify(toolResult.result, null, 2)
    }

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

  return { toolMessages, generatedImagePaths }
}

// Helper function to save tool messages and generated images
async function saveToolMessages(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }>,
  generatedImagePaths: Array<{ filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }>
) {
  let firstToolMessageId: string | null = null

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
      attachments: [] as string[],
    }
    await repos.chats.addMessage(chatId, toolMessage)

    if (!firstToolMessageId) {
      firstToolMessageId = toolMessageId
    }

    for (const imagePath of generatedImagePaths) {
      if (imagePath.sha256) {
        await repos.images.create({
          userId,
          type: 'chat_file',
          chatId,
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

  return firstToolMessageId
}

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

    // Get first active character participant
    const characterParticipant = chat.participants.find(
      p => p.type === 'CHARACTER' && p.isActive && p.characterId && p.connectionProfileId
    )

    if (!characterParticipant?.characterId) {
      return NextResponse.json({ error: 'No active character in chat' }, { status: 404 })
    }

    if (!characterParticipant.connectionProfileId) {
      return NextResponse.json({ error: 'No connection profile for character' }, { status: 404 })
    }

    // Get character
    const character = await repos.characters.findById(characterParticipant.characterId)
    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Get connection profile with API key from the participant
    const connectionProfile = await repos.connections.findById(characterParticipant.connectionProfileId)
    if (!connectionProfile) {
      return NextResponse.json({ error: 'Connection profile not found' }, { status: 404 })
    }

    let apiKey = null
    if (connectionProfile.apiKeyId) {
      apiKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    }

    // Get image profile from the participant if set
    let imageProfile = null
    const imageProfileId = characterParticipant.imageProfileId
    if (imageProfileId) {
      imageProfile = await repos.imageProfiles.findById(imageProfileId)
    }

    // Get existing messages
    const existingMessages = await repos.chats.getMessages(id)

    // Validate request body
    const body = await req.json()
    const { content, fileIds } = sendMessageSchema.parse(body)

    // Load file attachments if provided
    const attachedFiles = await loadAttachedFiles(repos, id, fileIds)

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
          const messageEvent = msg as { role: string; content: string };
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
    const modelParams = connectionProfile.parameters as Record<string, unknown>

    // Create streaming response
    const encoder = new TextEncoder()
    let fullResponse = ''
    let usage: { totalTokens?: number } | null = null
    let attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null = null
    let rawResponse: unknown = null

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Get tools for this chat if an image profile is configured
          const tools = getToolsForProvider(connectionProfile.provider, imageProfileId, imageProfile?.provider)

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
              hasAttachments: !!(m as { attachments?: unknown[] }).attachments?.length,
            })),
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ debugLLMRequest: llmRequestDetails })}\n\n`)
          )

          for await (const chunk of provider.streamMessage(
            {
              messages,
              model: connectionProfile.modelName,
              temperature: modelParams.temperature as number | undefined,
              maxTokens: modelParams.maxTokens as number | undefined,
              topP: modelParams.topP as number | undefined,
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

          // Detect and execute tool calls
          let toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }> = []
          let generatedImagePaths: Array<{ filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }> = []

          if (rawResponse) {
            const toolCalls = detectToolCalls(rawResponse, connectionProfile.provider)
            if (toolCalls.length > 0) {
              const results = await processToolResults(toolCalls, id, user.id, imageProfileId || undefined, controller, encoder)
              toolMessages = results.toolMessages
              generatedImagePaths = results.generatedImagePaths
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
              rawResponse: (rawResponse as Record<string, unknown>) || null,
              attachments: [] as string[],
            }
            await repos.chats.addMessage(id, assistantMessage)

            // Trigger automatic memory extraction (non-blocking)
            try {
              const chatSettings = await repos.users.getChatSettings(user.id)
              if (chatSettings) {
                const availableProfiles = await repos.connections.findByUserId(user.id)
                processMessageForMemoryAsync({
                  characterId: character.id,
                  characterName: character.name,
                  chatId: id,
                  userMessage: content,
                  assistantMessage: fullResponse,
                  sourceMessageId: assistantMessageId,
                  userId: user.id,
                  connectionProfile,
                  cheapLLMSettings: chatSettings.cheapLLMSettings,
                  availableProfiles,
                })
              }
            } catch (memoryError) {
              console.error('Failed to trigger memory extraction:', memoryError)
            }
          }

          // Save tool messages if tools were executed
          const firstToolMessageId = toolMessages.length > 0 
            ? await saveToolMessages(repos, id, user.id, toolMessages, generatedImagePaths)
            : null

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
