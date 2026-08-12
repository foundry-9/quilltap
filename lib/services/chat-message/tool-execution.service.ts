/**
 * Tool Execution Service
 *
 * Handles detection and execution of LLM tool calls,
 * including processing results and saving tool messages.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { detectToolCalls, executeToolCallWithContext, type ToolExecutionContext, type LoadedMemoriesContext } from '@/lib/chat/tool-executor'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ToolMessage, GeneratedImage, ToolProcessingResult } from './types'
import { encodeStatusEvent } from './streaming.service'

const logger = createServiceLogger('ToolExecutionService')

// Tools whose results are inherently per-character (memories, conversation
// transcripts). Whispered to the calling character regardless of chat settings —
// peer characters' LLM contexts never see the body.
const ALWAYS_PRIVATE_TOOLS = new Set<string>([
  'search',
  'read_conversation',
])

// Vault-read tools. Whispered to the calling character UNLESS the chat has
// `allowCrossCharacterVaultReads` enabled (the operator's "characters share
// each other's vaults" mode), in which case the result is public.
const VAULT_READ_TOOLS = new Set<string>([
  'doc_read_file',
  'doc_list_files',
  'doc_grep',
  'doc_read_heading',
  'doc_read_frontmatter',
  'doc_read_blob',
  'doc_list_blobs',
  'doc_open_document',
])

// Tools whose visible artifact is a message somebody else authored. The TOOL row
// still persists — tool-call threading needs its callId linkage, and the model
// needs the result — but the Salon renders nothing for it, so the run shows up
// exactly once instead of twice.
const DELEGATED_DISPLAY_TOOLS = new Set<string>([
  // Pascal announces the outcome in his own bubble.
  'run_custom',
])

/**
 * Per-chat context used to decide whether a tool result should be whispered.
 */
export interface ToolWhisperContext {
  userParticipantId: string | null
  allowCrossCharacterVaultReads: boolean
}

/**
 * Decide the `targetParticipantIds` for a tool-result message.
 * Returning null leaves the message public.
 */
function computeToolMessageTargets(
  toolName: string,
  whisperContext: ToolWhisperContext | undefined
): string[] | null {
  if (!whisperContext) return null
  const isAlwaysPrivate = ALWAYS_PRIVATE_TOOLS.has(toolName)
  const isVaultRead = VAULT_READ_TOOLS.has(toolName)
  const shouldWhisper = isAlwaysPrivate
    || (isVaultRead && !whisperContext.allowCrossCharacterVaultReads)
  if (!shouldWhisper) return null
  return whisperContext.userParticipantId ? [whisperContext.userParticipantId] : []
}

/**
 * Stream controller interface for sending tool updates
 */
export interface StreamController {
  enqueue: (data: Uint8Array) => void
}

/**
 * Process tool calls and stream results
 */
export async function processToolCalls(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; callId?: string }>,
  toolContext: ToolExecutionContext,
  controller: StreamController,
  encoder: TextEncoder,
  statusContext?: { characterName: string; characterId: string }
): Promise<ToolProcessingResult> {
  const toolMessages: ToolMessage[] = []
  const generatedImagePaths: GeneratedImage[] = []

  // Send tool detection info with tool names for proper UI handling
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({
      toolsDetected: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.name),
      toolArguments: toolCalls.map(tc => tc.arguments),
    })}\n\n`)
  )

  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
    const toolCall = toolCalls[toolIndex]

    // Update status for each tool as it starts executing
    if (statusContext) {
      controller.enqueue(encodeStatusEvent(encoder, {
        stage: 'tool_executing',
        message: `Running ${toolCall.name}...`,
        toolName: toolCall.name,
        characterName: statusContext.characterName,
        characterId: statusContext.characterId,
      }))
    }

    const toolResult = await executeToolCallWithContext(toolCall, toolContext)

    // Debug: Log what we received from executeToolCallWithContext

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
      resultText = `Error: ${toolResult.error || 'Unknown error'}${toolResult.message ? ` - ${toolResult.message}` : ''}`
    } else if (toolResult.toolName === 'generate_image') {
      resultText = `Generated ${(toolResult.result as unknown[])?.length || 1} image(s)`
    } else if (toolResult.toolName === 'attach_image') {
      resultText = `Attached ${(toolResult.result as unknown[])?.length || 1} kept image(s)`
    } else {
      resultText = JSON.stringify(toolResult.result, null, 2)
    }

    toolMessages.push({
      toolName: toolResult.toolName,
      success: toolResult.success,
      content: resultText,
      arguments: toolCall.arguments,
      callId: toolCall.callId,
      metadata: toolResult.metadata,
    })

    // Build tool result payload. On failure, carry the human-readable error
    // text (same string persisted as the tool message's content) so live UIs
    // can show a useful message instead of a generic "failed" — the result
    // field itself is often null on error.
    const toolResultPayload: Record<string, unknown> = {
      index: toolIndex,
      name: toolResult.toolName,
      success: toolResult.success,
      result: toolResult.result,
    };
    if (!toolResult.success) {
      toolResultPayload.error = resultText;
    }

    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          toolResult: toolResultPayload,
        })}\n\n`
      )
    )
  }

  return { toolMessages, generatedImagePaths }
}

/**
 * Save tool messages to the chat and link generated images
 */
export async function saveToolMessages(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  _userId: string,
  toolMessages: ToolMessage[],
  generatedImagePaths: GeneratedImage[],
  characterId?: string,
  participantId?: string,
  whisperContext?: ToolWhisperContext
): Promise<{ firstToolMessageId: string | null; generatedImageIds: string[] }> {
  let firstToolMessageId: string | null = null
  const generatedImageIds: string[] = generatedImagePaths.map(img => img.id)

  for (const toolMsg of toolMessages) {
    const toolMessageId = crypto.randomUUID()
    // Include image IDs as attachments on the tool message. attach_image
    // resurfaces previously-kept images via the same generatedImagePaths
    // pipeline as generate_image, so its descriptors get attached too.
    const toolAttachments = (toolMsg.toolName === 'generate_image' || toolMsg.toolName === 'attach_image')
      ? generatedImageIds
      : []

    const targetParticipantIds = computeToolMessageTargets(toolMsg.toolName, whisperContext)

    const toolMessage = {
      id: toolMessageId,
      type: 'message' as const,
      role: 'TOOL' as const,
      participantId: participantId ?? null,
      targetParticipantIds,
      content: JSON.stringify({
        toolName: toolMsg.toolName,
        success: toolMsg.success,
        result: toolMsg.content,
        arguments: toolMsg.arguments,
        callId: toolMsg.callId,
        // Another message is this run's single visible artifact; this row is
        // persisted for threading and the model, but rendered by nobody.
        ...(DELEGATED_DISPLAY_TOOLS.has(toolMsg.toolName) ? { delegatedDisplay: true } : {}),
        // Prose offset where the character paused to call this tool, used by the
        // Salon UI to splice the block back into the message at that point.
        // Omitted (not null) when unavailable so legacy/end-anchored rows fall
        // through to bottom-of-bubble rendering.
        ...(typeof toolMsg.anchorOffset === 'number' ? { anchorOffset: toolMsg.anchorOffset } : {}),
        // Turn-monotonic sequence shared with reasoning segments so the Salon
        // orders same-offset thinking/tool items in true emission order.
        ...(typeof toolMsg.seq === 'number' ? { seq: toolMsg.seq } : {}),
        provider: toolMsg.metadata?.provider,
        model: toolMsg.metadata?.model,
        prompt: toolMsg.metadata?.expandedPrompt,
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
      logger.warn('Failed to link/tag generated image', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { firstToolMessageId, generatedImageIds }
}

/**
 * Detect tool calls in a response
 */
export function detectToolCallsInResponse(
  response: unknown,
  provider: string
): Array<{ name: string; arguments: Record<string, unknown>; callId?: string }> {
  return detectToolCalls(response, provider)
}

/**
 * Create tool execution context
 */
export function createToolContext(
  chatId: string,
  userId: string,
  characterId: string,
  characterParticipantId: string,
  imageProfileId?: string | null,
  embeddingProfileId?: string,
  projectId?: string | null,
  browserUserAgent?: string,
  loadedMemories?: LoadedMemoriesContext,
): ToolExecutionContext {
  return {
    chatId,
    userId,
    imageProfileId: imageProfileId || undefined,
    characterId,
    embeddingProfileId,
    callingParticipantId: characterParticipantId,
    projectId: projectId || undefined,
    browserUserAgent,
    loadedMemories,
    pendingWardrobeAnnouncements: new Set<string>(),
  }
}
