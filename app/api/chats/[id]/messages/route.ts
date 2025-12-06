// Chat Messages API: Send message with streaming response
// POST /api/chats/:id/messages - Send a message and get streaming response

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { createLLMProvider } from '@/lib/llm'
import { decryptApiKey } from '@/lib/encryption'
import { loadChatFilesForLLM } from '@/lib/chat-files-v2'
import { detectToolCalls, executeToolCallWithContext, type ToolExecutionContext } from '@/lib/chat/tool-executor'
import { buildToolsForProvider } from '@/lib/tools'
import { processMessageForMemoryAsync } from '@/lib/memory'
import { buildContext } from '@/lib/chat/context-manager'
import { checkAndGenerateSummaryIfNeeded } from '@/lib/chat/context-summary'
import {
  processFileAttachmentFallback,
  formatFallbackAsMessagePrefix,
  type FallbackResult,
} from '@/lib/chat/file-attachment-fallback'
import { logger } from '@/lib/logger'
import { requiresApiKey } from '@/lib/plugins/provider-validation'
import { z } from 'zod'

// Validation schema
const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required'),
  // Optional array of file IDs to attach to this message
  fileIds: z.array(z.string()).optional(),
})

// Helper function to load attached files
async function loadAttachedFiles(repos: ReturnType<typeof getRepositories>, chatId: string, fileIds?: string[]) {
  if (!fileIds || fileIds.length === 0) {
    return []
  }

  // Use the repository to find files linked to the chat
  const chatFiles = await repos.files.findByLinkedTo(chatId)

  const matched = chatFiles.filter(file => fileIds.includes(file.id))

  return matched.map(file => ({
    id: file.id,
    filepath: `api/files/${file.id}`, // Always use API route for S3-backed files
    filename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
  }))
}

// Helper function to process tool execution results
async function processToolResults(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  toolContext: ToolExecutionContext,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  const toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }> = []
  const generatedImagePaths: Array<{ id: string; filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }> = []

  // Send tool detection info with tool names for proper UI handling
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({
      toolsDetected: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.name),
      toolArguments: toolCalls.map(tc => tc.arguments),
    })}\n\n`)
  )

  for (const toolCall of toolCalls) {
    const toolResult = await executeToolCallWithContext(toolCall, toolContext)

    if (toolResult.success && Array.isArray(toolResult.result)) {
      for (const img of toolResult.result) {
        if (img.filepath && img.id) {
          generatedImagePaths.push({
            id: img.id,
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

// Helper function to save tool messages and link generated images
async function saveToolMessages(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  _userId: string,
  toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }>,
  generatedImagePaths: Array<{ id: string; filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }>,
  characterId?: string
) {
  let firstToolMessageId: string | null = null
  const generatedImageIds: string[] = generatedImagePaths.map(img => img.id)

  for (const toolMsg of toolMessages) {
    const toolMessageId = crypto.randomUUID()
    // Include image IDs as attachments on the tool message
    const toolAttachments = toolMsg.toolName === 'generate_image'
      ? generatedImageIds
      : []

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
      attachments: toolAttachments,
    }
    await repos.chats.addMessage(chatId, toolMessage)

    if (!firstToolMessageId) {
      firstToolMessageId = toolMessageId
    }
  }

  // Link generated images to the tool message and add character tag
  for (const imageId of generatedImageIds) {
    try {
      // Link to the tool message
      if (firstToolMessageId) {
        await repos.files.addLink(imageId, firstToolMessageId)
      }
      // Add character tag so it shows up in character's gallery
      if (characterId) {
        await repos.files.addTag(imageId, characterId)
      }
    } catch (error) {
      logger.warn('Failed to link/tag generated image:', { imageId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { firstToolMessageId, generatedImageIds }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession()
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

    // Update file attachments with message ID using repository
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        // Link the file to the message ID
        await repos.files.addLink(file.id, userMessageId)
      }
    }

    // Load file data for LLM
    const fileAttachments = await loadChatFilesForLLM(attachedFiles.map(f => f.id))

    // Process file attachment fallbacks if provider doesn't support them
    const fallbackResults: FallbackResult[] = []
    let messageContentPrefix = ''

    if (fileAttachments.length > 0 && attachedFiles.length > 0) {
      for (let i = 0; i < fileAttachments.length; i++) {
        const fileAttachment = fileAttachments[i]
        const fileMetadata = attachedFiles[i]

        const fallbackResult = await processFileAttachmentFallback(
          fileMetadata,
          fileAttachment,
          connectionProfile,
          repos,
          user.id
        )

        fallbackResults.push(fallbackResult)

        // Add fallback content to message prefix
        const fallbackPrefix = formatFallbackAsMessagePrefix(fallbackResult)
        if (fallbackPrefix) {
          messageContentPrefix += fallbackPrefix
        }
      }
    }

    // If we have fallback content, prepend it to the user's message
    const finalUserMessageContent = messageContentPrefix ? messageContentPrefix + content : content

    // Get persona if available
    const personaParticipant = chat.participants.find(
      p => p.type === 'PERSONA' && p.isActive && p.personaId
    )
    let persona: { name: string; description: string } | null = null
    if (personaParticipant?.personaId) {
      const personaData = await repos.personas.findById(personaParticipant.personaId)
      if (personaData) {
        persona = { name: personaData.name, description: personaData.description }
      }
    }

    // Get chat settings for embedding profile
    const chatSettings = await repos.users.getChatSettings(user.id)

    // Build context with intelligent token management
    // Filter existing messages to include USER, ASSISTANT, and TOOL messages (exclude SYSTEM)
    // IMPORTANT: Tool results must be included so LLM knows tools were already executed
    const conversationMessages = existingMessages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        const role = (msg as { role: string }).role
        return role === 'USER' || role === 'ASSISTANT' || role === 'TOOL'
      })
      .map(msg => {
        const messageEvent = msg as { role: string; content: string; id?: string }

        // For TOOL messages, parse the content and format as a user message
        // indicating the tool result (LLMs expect tool results as user messages)
        if (messageEvent.role === 'TOOL') {
          try {
            const toolData = JSON.parse(messageEvent.content)
            // toolData.result is already a formatted string, don't stringify again
            const resultText = toolData.result || 'No result'

            return {
              role: 'USER' as const, // Tool results sent back as user messages
              content: `[Tool Result: ${toolData.toolName}]\n${resultText}`,
              id: messageEvent.id,
            }
          } catch {
            // If parsing fails, skip this message
            return null
          }
        }

        return {
          role: messageEvent.role,
          content: messageEvent.content,
          id: messageEvent.id,
        }
      })
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null)

    const builtContext = await buildContext({
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      userId: user.id,
      character,
      persona,
      chat,
      existingMessages: conversationMessages,
      newUserMessage: finalUserMessageContent,
      systemPromptOverride: characterParticipant.systemPromptOverride,
      embeddingProfileId: chatSettings?.cheapLLMSettings?.embeddingProfileId || undefined,
      skipMemories: false,
      maxMemories: 10,
      minMemoryImportance: 0.3,
    })

    // Log context building results for debugging
    if (builtContext.warnings.length > 0) {
      logger.warn('[Context Manager] Warnings:', builtContext.warnings)
    }

    // Prepare final messages for LLM (add attachments to the last user message)
    // Filter out attachments that were processed via fallback
    const attachmentsToSend = fileAttachments.filter((_, idx) => {
      const fallback = fallbackResults[idx]
      // Don't send as attachment if it was converted to text or description
      return !fallback || (fallback.type !== 'text' && fallback.type !== 'image_description')
    })

    const messages = builtContext.messages.map((msg, idx) => {
      if (idx === builtContext.messages.length - 1 && msg.role === 'user' && attachmentsToSend.length > 0) {
        return {
          role: msg.role,
          content: msg.content,
          attachments: attachmentsToSend,
        }
      }
      return {
        role: msg.role,
        content: msg.content,
      }
    })

    // Get API key (only required for providers that need it)
    let decryptedKey = ''
    if (requiresApiKey(connectionProfile.provider)) {
      if (!apiKey) {
        return NextResponse.json(
          { error: 'No API key configured for this connection profile' },
          { status: 400 }
        )
      }
      decryptedKey = decryptApiKey(
        apiKey.ciphertext,
        apiKey.iv,
        apiKey.authTag,
        user.id
      )
    }
    // For providers that don't require API keys (like Ollama), pass empty string

    // Get LLM provider
    const provider = await createLLMProvider(
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

    // Prepare tool execution context
    // Pass the character's participant ID so {{me}} in image prompts resolves to the character
    const toolContext: ToolExecutionContext = {
      chatId: id,
      userId: user.id,
      imageProfileId: imageProfileId || undefined,
      characterId: character.id,
      embeddingProfileId: chatSettings?.cheapLLMSettings?.embeddingProfileId || undefined,
      callingParticipantId: characterParticipant.id,
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Get tools for this chat (image generation if configured, memory search always enabled, web search conditional)
          // For providers that support native web search, we pass webSearchEnabled to the provider directly
          // and skip adding the web search tool here
          const useNativeWebSearch = connectionProfile.allowWebSearch && provider.supportsWebSearch
          logger.debug('[Chat Messages] Building tools for provider', {
            provider: connectionProfile.provider,
            imageProfileId: !!imageProfileId,
            imageProviderType: imageProfile?.provider,
            memorySearchEnabled: true,
            webSearchEnabled: connectionProfile.allowWebSearch && !useNativeWebSearch,
            useNativeWebSearch,
          })
          const tools = buildToolsForProvider(connectionProfile.provider, {
            imageGeneration: !!imageProfileId,
            imageProviderType: imageProfile?.provider,
            memorySearch: true, // Always enable memory search for characters
            webSearch: connectionProfile.allowWebSearch && !useNativeWebSearch,
          })
          logger.debug('[Chat Messages] Tools built successfully', {
            toolCount: tools.length,
            tools: tools.map((t: any) => t.name || t.function?.name || 'unknown'),
          })

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
            // Context management info
            contextManagement: {
              tokenUsage: builtContext.tokenUsage,
              budget: {
                total: builtContext.budget.totalLimit,
                responseReserve: builtContext.budget.responseReserve,
              },
              memoriesIncluded: builtContext.memoriesIncluded,
              messagesIncluded: builtContext.messagesIncluded,
              messagesTruncated: builtContext.messagesTruncated,
              includedSummary: builtContext.includedSummary,
              // Debug content for viewing in debug panel
              debugMemories: builtContext.debugMemories,
              debugSummary: builtContext.debugSummary,
              debugSystemPrompt: builtContext.debugSystemPrompt,
            },
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ debugLLMRequest: llmRequestDetails })}\n\n`)
          )

          // Send fallback processing info if any files were processed
          if (fallbackResults.length > 0) {
            const fallbackInfo = fallbackResults.map((result, idx) => ({
              filename: result.processingMetadata?.originalFilename || 'Unknown',
              type: result.type,
              usedImageDescriptionLLM: result.processingMetadata?.usedImageDescriptionLLM || false,
              error: result.error,
            }))
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ fileProcessing: fallbackInfo })}\n\n`)
            )
          }

          for await (const chunk of provider.streamMessage(
            {
              messages,
              model: connectionProfile.modelName,
              temperature: modelParams.temperature as number | undefined,
              maxTokens: modelParams.maxTokens as number | undefined,
              topP: modelParams.topP as number | undefined,
              tools: tools.length > 0 ? tools : undefined,
              // Enable native web search if the profile has it enabled and provider supports it
              webSearchEnabled: useNativeWebSearch,
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

          // Detect and execute tool calls, then continue conversation if needed
          let toolMessages: Array<{ toolName: string; success: boolean; content: string; arguments?: Record<string, unknown>; metadata?: { provider?: string; model?: string } }> = []
          let generatedImagePaths: Array<{ id: string; filename: string; filepath: string; mimeType: string; size: number; width?: number; height?: number; sha256?: string }> = []

          // Track conversation messages for tool call continuation
          let currentMessages = [...messages]
          let currentResponse = fullResponse
          let currentRawResponse = rawResponse
          const MAX_TOOL_ITERATIONS = 5 // Prevent infinite loops
          let toolIterations = 0

          // Tool call loop - continue until LLM gives a text response or max iterations
          while (currentRawResponse && toolIterations < MAX_TOOL_ITERATIONS) {
            const toolCalls = detectToolCalls(currentRawResponse, connectionProfile.provider)

            if (toolCalls.length === 0) {
              // No tool calls, we're done
              break
            }

            toolIterations++
            logger.debug('[Chat Messages] Processing tool calls, iteration', {
              iteration: toolIterations,
              toolCallCount: toolCalls.length,
              tools: toolCalls.map(tc => tc.name),
            })

            const results = await processToolResults(toolCalls, toolContext, controller, encoder)
            toolMessages = [...toolMessages, ...results.toolMessages]
            generatedImagePaths = [...generatedImagePaths, ...results.generatedImagePaths]

            // Add assistant message with tool call to conversation (if there was any content)
            if (currentResponse && currentResponse.trim().length > 0) {
              currentMessages = [
                ...currentMessages,
                { role: 'assistant' as const, content: currentResponse }
              ]
            } else {
              // Even without content, add a placeholder to maintain conversation flow
              currentMessages = [
                ...currentMessages,
                { role: 'assistant' as const, content: '[Tool call made]' }
              ]
            }

            // Add tool results as user messages (how LLMs expect to receive tool results)
            for (const toolMsg of results.toolMessages) {
              currentMessages = [
                ...currentMessages,
                { role: 'user' as const, content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}` }
              ]
            }

            // Continue the conversation with the tool results
            logger.debug('[Chat Messages] Continuing conversation after tool execution', {
              messageCount: currentMessages.length,
              iteration: toolIterations,
            })

            // Reset for next iteration
            currentResponse = ''
            currentRawResponse = null

            // Stream the continuation from the LLM
            for await (const chunk of provider.streamMessage(
              {
                messages: currentMessages,
                model: connectionProfile.modelName,
                temperature: modelParams.temperature as number | undefined,
                maxTokens: modelParams.maxTokens as number | undefined,
                topP: modelParams.topP as number | undefined,
                tools: tools.length > 0 ? tools : undefined,
                webSearchEnabled: useNativeWebSearch,
              },
              decryptedKey
            )) {
              if (chunk.content) {
                currentResponse += chunk.content
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
                  currentRawResponse = chunk.rawResponse
                  rawResponse = chunk.rawResponse
                }
              }
            }
          }

          if (toolIterations >= MAX_TOOL_ITERATIONS) {
            logger.warn('[Chat Messages] Max tool iterations reached', {
              iterations: toolIterations,
              chatId: id,
            })
          }

          // Save assistant message only if there's actual content (not just a tool call)
          let assistantMessageId: string | null = null
          if (fullResponse && fullResponse.trim().length > 0) {
            assistantMessageId = crypto.randomUUID()

            // Get image IDs from generated images to attach to assistant message
            const assistantAttachments = generatedImagePaths.map(img => img.id)

            const assistantMessage = {
              id: assistantMessageId,
              type: 'message' as const,
              role: 'ASSISTANT' as const,
              content: fullResponse,
              createdAt: new Date().toISOString(),
              tokenCount: usage?.totalTokens || null,
              rawResponse: (rawResponse as Record<string, unknown>) || null,
              attachments: assistantAttachments,
            }
            await repos.chats.addMessage(id, assistantMessage)

            // Save tool messages if tools were executed (this also links images to character)
            const toolSaveResult = toolMessages.length > 0
              ? await saveToolMessages(repos, id, user.id, toolMessages, generatedImagePaths, character.id)
              : null
            const firstToolMessageId = toolSaveResult?.firstToolMessageId ?? null

            // Link images to assistant message as well
            if (assistantAttachments.length > 0) {
              for (const imageId of assistantAttachments) {
                try {
                  await repos.files.addLink(imageId, assistantMessageId)
                } catch (error) {
                  logger.warn('Failed to link image to assistant message:', { imageId, error: error instanceof Error ? error.message : String(error) })
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

            // Trigger automatic memory extraction (non-blocking)
            try {
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
                }, async (result) => {
                  // Store memory debug logs in the assistant message if available
                  if (result.debugLogs && result.debugLogs.length > 0 && assistantMessageId) {
                    try {
                      await repos.chats.updateMessage(id, assistantMessageId, { debugMemoryLogs: result.debugLogs })
                    } catch (e) {
                      logger.error('Failed to store memory debug logs:', {}, e as Error)
                    }
                  }
                })

                // Check if we need to generate a context summary (non-blocking)
                checkAndGenerateSummaryIfNeeded(
                  id,
                  connectionProfile.provider,
                  connectionProfile.modelName,
                  user.id,
                  connectionProfile,
                  chatSettings.cheapLLMSettings,
                  availableProfiles
                )
              }
            } catch (memoryError) {
              logger.error('Failed to trigger memory extraction:', {}, memoryError as Error)
            }
          } else if (toolMessages.length > 0) {
            // Even if there's no text response, send done event if tools were executed
            const toolSaveResult = await saveToolMessages(repos, id, user.id, toolMessages, generatedImagePaths, character.id)
            const firstToolMessageId = toolSaveResult.firstToolMessageId
            await repos.chats.update(id, { updatedAt: new Date().toISOString() })

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  done: true,
                  messageId: firstToolMessageId,
                  usage,
                  attachmentResults,
                  toolsExecuted: true,
                })}\n\n`
              )
            )
          } else {
            // No response content and no tool execution - still need to send done to close the stream
            logger.warn(`[Chat Messages] Empty response for chat ${id}`)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  done: true,
                  messageId: null,
                  usage,
                  attachmentResults,
                  toolsExecuted: false,
                })}\n\n`
              )
            )
          }

          // Close the stream
          try {
            controller.close()
          } catch (e) {
            // Already closed, ignore
          }
        } catch (error) {
          logger.error('Streaming error:', {}, error as Error)
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

    logger.error('Error sending message:', {}, error as Error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
