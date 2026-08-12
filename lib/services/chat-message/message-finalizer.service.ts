/**
 * Message Finalizer Service
 *
 * Handles assistant message persistence, completion events, token tracking,
 * assistant-side RNG auto-detection, and background memory/summary triggers.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { stripCharacterNamePrefix, truncateAtForeignSpeaker, normalizeContentBlockFormat } from '@/lib/llm/message-formatter'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
  isUsersTurn,
} from '@/lib/chat/turn-manager'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { calculateMaxAvailable, CONTEXT_HISTORY_BUDGET_RATIO } from '@/lib/llm/model-context-data'
import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override'
import { executeRngTool, formatRngResults } from '@/lib/tools/handlers/rng-handler'

import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase, Character, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { GeneratedImage, NextSpeakerInfo, ProcessMessageResult, StreamingState, CompressionContext, TriggerContext, ToolMessage, ReasoningSegment } from './types'
import { saveToolMessages, type ToolWhisperContext } from './tool-execution.service'
import { encodeDoneEvent, encodeCarinaAnswerEvent, encodeStatusEvent, encodeConfirmationResultEvent, safeEnqueue } from './streaming.service'
import {
  isAnswerConfirmationActive,
  isUserDrivenTurn,
  hasCheckableInputs,
  gatherConfirmationInputs,
  findLatestCommonplaceWhisper,
  buildRecentConversationContext,
  runAnswerConfirmation,
  type AnswerConfirmationOverride,
} from './answer-confirmation.service'
import {
  triggerTurnMemoryExtraction,
  triggerContextSummaryCheck,
  triggerChatDangerClassification,
  type MemoryChatSettings,
} from './memory-trigger.service'
import { triggerAsyncCompression } from './compression-cache.service'
import { detectAndConvertRngPatterns } from './rng-pattern-detector.service'
import { runCarinaMarkupQuery } from '@/lib/services/carina/markup-runner'

const logger = createServiceLogger('MessageFinalizer')

export interface FinalizeMessageResponseOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string; status?: string }
  userParticipantId: string | null
  isMultiCharacter: boolean
  isContinueMode: boolean
  generatedImagePaths: GeneratedImage[]
  toolMessages: ToolMessage[]
  preGeneratedAssistantMessageId?: string
  connectionProfile: ConnectionProfile
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  streaming: StreamingState
  compression: CompressionContext
  triggers: TriggerContext
}

/**
 * Finalize a successful assistant text response.
 */
export async function finalizeMessageResponse({
  repos,
  chatId,
  userId,
  chat,
  character,
  characterParticipant,
  userParticipantId,
  isMultiCharacter,
  isContinueMode,
  generatedImagePaths,
  toolMessages,
  preGeneratedAssistantMessageId,
  connectionProfile,
  controller,
  encoder,
  streaming,
  compression,
  triggers,
}: FinalizeMessageResponseOptions): Promise<ProcessMessageResult> {
  const { fullResponse, effectiveProfile, usage, cacheUsage, attachmentResults, rawResponse, thoughtSignature, reasoningContent, reasoningSegments } = streaming
  const { existingMessages, content, builtContext, compressionEnabled, cheapLLMSelection, contextCompressionSettings, allProfiles } = compression
  const { dangerSettings, chatSettings, participantCharacters, resolvedIdentity, userCharacterId } = triggers
  const normalizedResponse = normalizeContentBlockFormat(fullResponse)
  const leadingStripped = stripCharacterNamePrefix(normalizedResponse, character.name, character.aliases)

  // Anti-hijack safeguard (defense-in-depth with the system-prompt anti-
  // impersonation guidance + multi-char anchor): if the model began writing
  // ANOTHER participant's turn — a line opening with "[Name]" / "Name:" for a
  // known other character — cut the response there so one LLM can never carry
  // another character's lines into the transcript. Model-agnostic, runs for
  // every provider. Only fires in multi-character chats (single-char has no
  // foreign roster). If the very FIRST line is a foreign tag, truncation would
  // empty the message — keep the leading-stripped text instead (and warn) so we
  // never persist an empty bubble or break next-speaker selection.
  const foreignSpeakerNames: string[] = []
  if (isMultiCharacter) {
    for (const c of participantCharacters.values()) {
      if (c.id === character.id) continue
      if (c.name) foreignSpeakerNames.push(c.name)
      if (Array.isArray(c.aliases)) foreignSpeakerNames.push(...c.aliases)
    }
  }
  let cleanedResponse = leadingStripped
  if (foreignSpeakerNames.length > 0) {
    const { text: truncated, truncatedAt } = truncateAtForeignSpeaker(leadingStripped, foreignSpeakerNames)
    if (truncatedAt !== null && truncated.trim().length > 0) {
      cleanedResponse = truncated
      logger.warn('Truncated response at a foreign speaker tag (anti-hijack)', {
        chatId,
        characterName: character.name,
        truncatedAt,
        removedChars: leadingStripped.length - truncated.length,
      })
    } else if (truncatedAt !== null) {
      logger.warn('Response opened with a foreign speaker tag; left intact to avoid an empty message', {
        chatId,
        characterName: character.name,
      })
    }
  }

  // Re-base captured tool-call prose anchors from streamed-response coordinates
  // into final stored-content coordinates. The position-shifting transforms are
  // the leading-prefix strip (always a leading-only removal) and, in rare
  // hijack cases, the foreign-speaker tail truncation. `leadingStripDelta`
  // captures ONLY the leading shift; the clamp to `cleanedResponse.length`
  // below absorbs any tail truncation (anchors that fell into the cut-off tail
  // were in hijacked content and collapse harmlessly to the end). If
  // normalizeContentBlockFormat rewrote the body (rare content-block
  // extraction), offsets no longer map — drop them and the tool blocks fall
  // back to bottom-of-bubble rendering.
  const normalizeRewroteBody = normalizedResponse !== fullResponse
  const leadingStripDelta = normalizedResponse.length - leadingStripped.length
  let rebasedAnchorCount = 0
  for (const tm of toolMessages) {
    if (typeof tm.anchorOffset !== 'number') continue
    if (normalizeRewroteBody) {
      tm.anchorOffset = undefined
      continue
    }
    tm.anchorOffset = Math.max(0, Math.min(cleanedResponse.length, tm.anchorOffset - leadingStripDelta))
    rebasedAnchorCount++
  }
  if (rebasedAnchorCount > 0) {
    logger.debug('Re-based tool-call prose anchors into stored-content coordinates', {
      chatId,
      characterName: character.name,
      anchored: rebasedAnchorCount,
      leadingStripDelta,
    })
  }

  // Re-base reasoning ("thinking") segment offsets into stored-content
  // coordinates using the SAME transform as the tool anchors above — both were
  // captured against the streamed `streaming.fullResponse`. If the body was
  // rewritten (content-block extraction), the offsets no longer map: drop them
  // to a single offset-0 block so the thinking still renders (just un-spliced).
  // DISPLAY ONLY — this only affects where the block appears, never the model.
  let rebasedReasoning: ReasoningSegment[] | null = null
  if (reasoningSegments && reasoningSegments.length > 0) {
    if (normalizeRewroteBody) {
      // Collapse to one leading block: positions are invalid, content still good.
      rebasedReasoning = [{
        anchorOffset: 0,
        content: reasoningSegments.map(s => s.content).join(''),
        seq: reasoningSegments[0].seq,
      }]
    } else {
      rebasedReasoning = reasoningSegments.map(s => ({
        ...s,
        anchorOffset: Math.max(0, Math.min(cleanedResponse.length, s.anchorOffset - leadingStripDelta)),
      }))
    }
    logger.debug('Re-based reasoning segments into stored-content coordinates', {
      chatId,
      characterName: character.name,
      segments: rebasedReasoning.length,
      collapsed: normalizeRewroteBody,
      leadingStripDelta,
    })
  }

  // ==========================================================================
  // Answer confirmation (consistency check + re-affirmation)
  // ==========================================================================
  // Between response-cleaning and persistence: vet a character's tool-using
  // reply against what it was told (Commonplace Book whisper) and looked up
  // (in-scope read tools) this turn. Annotates the message (and may replace its
  // text with a re-affirmation rewrite). Never blocks the turn; any failure
  // degrades to `confirmed:null`. See answer-confirmation.service.ts.
  const assistantMessageId = preGeneratedAssistantMessageId || crypto.randomUUID()
  let confirmed: boolean | null | undefined
  let confirmationRevised: boolean | null | undefined
  let confirmationNotes: string | null | undefined
  let confirmationOriginalContent: string | null | undefined

  const isSilentTurn = characterParticipant.status === 'silent'
  if (isUserDrivenTurn(chat, characterParticipant.id)) {
    // A user-controlled/impersonated turn: the human may have sourced facts out
    // of band, so the system can neither confirm nor deny. Explicit null (≠ the
    // undefined "feature off" state).
    confirmed = null
    logger.debug('Answer confirmation: user-driven turn, marking unverifiable', { chatId })
  } else if (!isSilentTurn) {
    const globalEnabled = chatSettings?.answerConfirmationSettings?.enabled === true
    const chatOverride = chat.answerConfirmationOverride as AnswerConfirmationOverride
    let projectOverride: AnswerConfirmationOverride
    if (!chatOverride && chat.projectId) {
      const project = await repos.projects.findById(chat.projectId).catch(() => null)
      projectOverride = (project?.answerConfirmationOverride as AnswerConfirmationOverride) ?? undefined
    }
    if (isAnswerConfirmationActive(chatOverride, projectOverride, globalEnabled)) {
      const priorMessages = await repos.chats.getMessages(chatId)
      const priorEvents = priorMessages.filter(
        (m): m is typeof m & { type: 'message' } => m.type === 'message'
      ) as unknown as MessageEvent[]
      const whisper = findLatestCommonplaceWhisper(priorEvents, characterParticipant.id)
      if (hasCheckableInputs(whisper, toolMessages)) {
        const reference = gatherConfirmationInputs(whisper, toolMessages)
        if (reference) {
          // Recent live conversation, so any re-affirmation rewrite stays anchored
          // to THIS scene instead of drifting into an old conversation the
          // reference material may quote.
          const conversationContext = buildRecentConversationContext(
            priorEvents,
            chat.participants ?? [],
            participantCharacters,
          )
          safeEnqueue(controller, encodeStatusEvent(encoder, {
            stage: 'confirming',
            message: 'Confirming…',
            characterName: character.name,
            characterId: character.id,
          }))
          const outcome = await runAnswerConfirmation({
            reply: cleanedResponse,
            reference,
            userId,
            chatId,
            messageId: assistantMessageId,
            characterId: character.id,
            characterName: character.name,
            conversationContext,
            cheapLLMSelection,
            connectionProfile,
            isDangerousChat: isChatActiveDangerous(chat),
            uncensoredFallback: {
              dangerSettings,
              availableProfiles: allProfiles,
              isDangerousChat: isChatActiveDangerous(chat),
            },
            onAffirming: () => safeEnqueue(controller, encodeStatusEvent(encoder, {
              stage: 'affirming',
              message: 'Requesting affirmation of questionable results…',
              characterName: character.name,
              characterId: character.id,
            })),
          })
          confirmed = outcome.confirmed
          confirmationRevised = outcome.revised
          confirmationNotes = outcome.notes
          if (outcome.revised && outcome.revisedContent) {
            // Keep the original for the logs; show the revised reply. A rewrite
            // invalidates tool-call/reasoning anchors computed against the old
            // prose — mirror normalizeRewroteBody: drop tool anchors and
            // collapse reasoning to a single offset-0 block (display only).
            confirmationOriginalContent = cleanedResponse
            cleanedResponse = outcome.revisedContent
            for (const tm of toolMessages) {
              tm.anchorOffset = undefined
            }
            if (rebasedReasoning && rebasedReasoning.length > 0) {
              rebasedReasoning = [{
                anchorOffset: 0,
                content: rebasedReasoning.map(s => s.content).join(''),
                seq: rebasedReasoning[0].seq,
              }]
            }
          }
        }
      }
    }
  }

  const whisperContext: ToolWhisperContext = {
    userParticipantId,
    allowCrossCharacterVaultReads: chat.allowCrossCharacterVaultReads === true,
  }

  await saveAssistantMessage(
    repos,
    chatId,
    character,
    characterParticipant,
    cleanedResponse,
    usage,
    rawResponse,
    thoughtSignature,
    generatedImagePaths,
    toolMessages,
    assistantMessageId,
    effectiveProfile.provider,
    effectiveProfile.modelName,
    whisperContext,
    reasoningContent,
    rebasedReasoning,
    { confirmed, confirmationRevised, confirmationNotes, confirmationOriginalContent }
  )

  // Surface the resolved confirmation state to the live client (badge +, on a
  // revision, the replacement bubble text). The persisted columns carry it too,
  // so a page refresh shows the same state.
  if (confirmed !== undefined) {
    safeEnqueue(controller, encodeConfirmationResultEvent(encoder, {
      messageId: assistantMessageId,
      confirmed,
      revised: confirmationRevised === true,
      notes: confirmationNotes ?? null,
      ...(confirmationRevised === true ? { content: cleanedResponse } : {}),
    }))
  }

  // Async pre-compression exists to make the *next human message* feel fast.
  // Autonomous-room chains never wait on a human, and each chain step appends
  // enough messages (character + host + commonplace whispers) to trip the
  // staleness threshold within ~2 iterations — so the trigger re-fires the
  // cheap-LLM compression call dozens of times per turn for a cache that no
  // one inside the turn ever reads. Skip it; the next turn's first chain step
  // will fall back to sync compression on demand if no cache is available.
  if (compressionEnabled && cheapLLMSelection && builtContext.originalSystemPrompt && chat.chatType !== 'autonomous') {
    const updatedMessages = [
      ...extractVisibleConversation(existingMessages),
      ...(content && !isContinueMode ? [{
        role: 'user' as const,
        content,
      }] : []),
      {
        role: 'assistant' as const,
        content: cleanedResponse,
      },
    ]

    const asyncBudgetInfo = calculateMaxAvailable(effectiveProfile.provider, effectiveProfile.modelName, effectiveProfile)
    const asyncCompressionTarget = Math.floor(asyncBudgetInfo.maxAvailable * CONTEXT_HISTORY_BUDGET_RATIO)

    triggerAsyncCompression({
      chatId,
      participantId: isMultiCharacter ? characterParticipant.id : undefined,
      messages: updatedMessages,
      systemPrompt: builtContext.originalSystemPrompt,
      compressionOptions: {
        enabled: contextCompressionSettings.enabled,
        windowSize: contextCompressionSettings.windowSize,
        compressionTargetTokens: asyncCompressionTarget,
        systemPromptTargetTokens: contextCompressionSettings.systemPromptTargetTokens,
        selection: cheapLLMSelection,
        userId,
        characterName: character.name,
        userName: 'User',
        dangerSettings,
        availableProfiles: allProfiles,
      },
    })
  }

  const autoDetectRngInResponse = chatSettings?.autoDetectRng ?? true
  if (autoDetectRngInResponse && cleanedResponse) {
    const rngPatternsInResponse = detectAndConvertRngPatterns(cleanedResponse)
    if (rngPatternsInResponse.length > 0) {
      logger.info('Auto-detected RNG patterns in assistant response', {
        chatId,
        userId,
        patternCount: rngPatternsInResponse.length,
        patterns: rngPatternsInResponse.map(p => ({ type: p.type, rolls: p.rolls, matchText: p.matchText })),
      })

      // Walk the response left-to-right so repeated dice notations anchor to
      // successive occurrences rather than all snapping to the first.
      let rngAnchorSearchFrom = 0
      for (const pattern of rngPatternsInResponse) {
        const rngContext = { userId, chatId }
        const result = await executeRngTool(
          { type: pattern.type, rolls: pattern.rolls, modifier: pattern.modifier ?? 0 },
          rngContext
        )
        const formattedResult = formatRngResults(result)

        // Place the result block right after the dice notation that triggered it.
        const matchIdx = cleanedResponse.indexOf(pattern.matchText, rngAnchorSearchFrom)
        let rngAnchor: number | undefined
        if (matchIdx >= 0) {
          rngAnchor = matchIdx + pattern.matchText.length
          rngAnchorSearchFrom = rngAnchor
        }

        const toolMessageId = crypto.randomUUID()
        const toolMessage = {
          id: toolMessageId,
          type: 'message' as const,
          role: 'TOOL' as const,
          content: JSON.stringify({
            tool: 'rng',
            initiatedBy: 'auto-detect-response',
            success: result.success,
            result: formattedResult,
            prompt: pattern.matchText,
            arguments: { type: pattern.type, rolls: pattern.rolls, modifier: pattern.modifier ?? 0 },
            ...(typeof rngAnchor === 'number' ? { anchorOffset: rngAnchor } : {}),
          }),
          createdAt: new Date().toISOString(),
          attachments: [],
        }

        await repos.chats.addMessage(chatId, toolMessage)
        toolMessages.push({
          toolName: 'rng',
          content: formattedResult,
          success: result.success,
          arguments: { type: pattern.type, rolls: pattern.rolls },
        })
      }
    }
  }

  // ============================================================================
  // Carina (inline LLM queries) — assistant-markup path
  // ============================================================================
  // If the character wrote @Name: / @Name? in their response, fire the isolated
  // reference call. Mirrors the RNG-in-response block above: it runs AFTER the
  // assistant message is saved (so the answer is ordered after it) and BEFORE
  // the done event below (so the client's post-turn fetchChat() includes it).
  // The asker is this character's participant; the answer carries
  // systemSender:'carina' and is excluded from memory extraction automatically.
  if (cleanedResponse) {
    await runCarinaMarkupQuery({
      userId,
      chatId,
      text: cleanedResponse,
      askerParticipantId: characterParticipant.id,
      logLabels: { detected: 'assistant response', failed: 'assistant-markup' },
      // Surface the answer live (before this turn's done event) so the Salon
      // renders the card immediately rather than at the post-turn refresh.
      onPosted: (msg) => safeEnqueue(controller, encodeCarinaAnswerEvent(encoder, msg)),
    })
  }

  await repos.chats.update(chatId, { updatedAt: new Date().toISOString() })

  const turnInfo = await calculateNextSpeaker(
    repos,
    chatId,
    chat,
    character,
    characterParticipant,
    userParticipantId
  )

  controller.enqueue(encodeDoneEvent(encoder, {
    messageId: assistantMessageId,
    participantId: characterParticipant.id,
    usage,
    cacheUsage,
    attachmentResults,
    toolsExecuted: toolMessages.length > 0,
    turn: turnInfo,
    provider: effectiveProfile.provider,
    modelName: effectiveProfile.modelName,
    isSilentMessage: characterParticipant.status === 'silent' || undefined,
    // Reasoning ("thinking") for the optimistic client push — DISPLAY ONLY.
    reasoningContent: reasoningContent || null,
    reasoningSegments: rebasedReasoning,
  }))

  // Cost estimation + token tracking are intentionally fire-and-forget so a
  // slow/unreachable pricing fetch never blocks the `done` event and leaves
  // the client stuck on an interim status banner.
  if (usage && (usage.promptTokens || usage.completionTokens)) {
    void estimateMessageCost(
      effectiveProfile.provider,
      effectiveProfile.modelName,
      usage.promptTokens || 0,
      usage.completionTokens || 0,
      userId
    )
      .then(costResult =>
        trackMessageTokenUsage(chatId, effectiveProfile.id, usage, costResult.cost, costResult.source)
      )
      .catch(error => {
        logger.warn('Background token tracking failed', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  if (chatSettings) {
    const memoryChatSettings: MemoryChatSettings = {
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      dangerSettings,
      isDangerousChat: isChatActiveDangerous(chat),
    }

    // Per-turn memory extraction.
    //
    // - Normal chats: fire only when the turn closes (control returns to the
    //   user). On earlier characters' finalize calls in a multi-character
    //   turn, `turnInfo.isUsersTurn` is false and we leave extraction for
    //   the last speaker. Tool / continuation cycles inside a single
    //   character's response don't toggle isUsersTurn either, so those
    //   won't trigger spurious extractions.
    // - Autonomous rooms: there's no user, so `isUsersTurn` is permanently
    //   false. Without this branch, autonomous chats would *never* extract
    //   memories. Fire on every character turn instead — each speaker is
    //   the natural extraction point.
    const isAutonomous = chat.chatType === 'autonomous'
    if (turnInfo.isUsersTurn || isAutonomous) {
      await triggerTurnMemoryExtraction(repos, {
        chatId,
        userId,
        connectionProfile,
        chatSettings: memoryChatSettings,
      })
    }

    // Autonomous rooms drive the context-summary fold themselves, from the
    // turn handler AFTER the autonomous-run-id scope closes — so the fold is
    // awaited (its writes survive the forked-child write-buffer flush instead
    // of being lost fire-and-forget) and untagged (its cheap-LLM tokens don't
    // count against the per-run budget). Running it here too would re-introduce
    // the lost fire-and-forget write, so skip it for autonomous chats.
    if (!isAutonomous) {
      await triggerContextSummaryCheck(repos, {
        chatId,
        provider: connectionProfile.provider,
        modelName: connectionProfile.modelName,
        userId,
        connectionProfile,
        chatSettings: memoryChatSettings,
      })
    }

    await triggerChatDangerClassification(repos, {
      chatId,
      userId,
      connectionProfile,
      chatSettings: memoryChatSettings,
    })

  }

  return {
    isMultiCharacter,
    hasContent: true,
    messageId: assistantMessageId,
    userParticipantId,
    isPaused: chat.isPaused,
    sceneTrackingContext: chatSettings ? {
      connectionProfile,
      memoryChatSettings: {
        cheapLLMSettings: chatSettings.cheapLLMSettings,
        dangerSettings,
        isDangerousChat: isChatActiveDangerous(chat),
      },
      characterIds: Array.from(participantCharacters.values()).map(c => c.id),
    } : undefined,
  }
}

/**
 * Save assistant message to the chat and link tool/image artifacts.
 */
export async function saveAssistantMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  character: { id: string; name: string },
  characterParticipant: { id: string; status?: string },
  content: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null,
  rawResponse: unknown,
  thoughtSignature: string | undefined,
  generatedImagePaths: GeneratedImage[],
  toolMessages: ToolMessage[],
  preGeneratedMessageId?: string,
  provider?: string,
  modelName?: string,
  whisperContext?: ToolWhisperContext,
  // Reasoning ("thinking") for DISPLAY ONLY — persisted so the Salon can show
  // it; never re-fed to any model. See ReasoningSegment.
  reasoningContent?: string | null,
  reasoningSegments?: ReasoningSegment[] | null,
  // Answer-confirmation results (undefined fields are omitted — no field written).
  confirmation?: {
    confirmed?: boolean | null
    confirmationRevised?: boolean | null
    confirmationNotes?: string | null
    confirmationOriginalContent?: string | null
  }
): Promise<string> {
  // A check "ran" whenever a verdict (incl. null) was assigned. Persisted as a
  // real 1 so a reload can tell "unverified" from "never checked" (both leave
  // `confirmed` as SQL NULL).
  const confirmationChecked = confirmation?.confirmed !== undefined ? true : undefined
  const assistantMessageId = preGeneratedMessageId || crypto.randomUUID()
  const assistantAttachments = generatedImagePaths.map(img => img.id)

  const assistantMessage = {
    id: assistantMessageId,
    type: 'message' as const,
    role: 'ASSISTANT' as const,
    content,
    createdAt: new Date().toISOString(),
    tokenCount: usage?.totalTokens || null,
    promptTokens: usage?.promptTokens || null,
    completionTokens: usage?.completionTokens || null,
    rawResponse: (rawResponse as Record<string, unknown>) || null,
    attachments: assistantAttachments,
    thoughtSignature: thoughtSignature || null,
    reasoningContent: reasoningContent || null,
    reasoningSegments: reasoningSegments && reasoningSegments.length > 0 ? reasoningSegments : null,
    participantId: characterParticipant.id,
    provider: provider || null,
    modelName: modelName || null,
    isSilentMessage: characterParticipant.status === 'silent' || null,
    // Only include confirmation keys that were actually resolved, so an
    // untouched turn writes no confirmation fields at all.
    ...(confirmation?.confirmed !== undefined ? { confirmed: confirmation.confirmed } : {}),
    ...(confirmationChecked !== undefined ? { confirmationChecked } : {}),
    ...(confirmation?.confirmationRevised !== undefined ? { confirmationRevised: confirmation.confirmationRevised } : {}),
    ...(confirmation?.confirmationNotes !== undefined ? { confirmationNotes: confirmation.confirmationNotes } : {}),
    ...(confirmation?.confirmationOriginalContent !== undefined ? { confirmationOriginalContent: confirmation.confirmationOriginalContent } : {}),
  }

  await repos.chats.addMessage(chatId, assistantMessage)

  if (toolMessages.length > 0) {
    await saveToolMessages(
      repos,
      chatId,
      '',
      toolMessages,
      generatedImagePaths,
      character.id,
      characterParticipant.id,
      whisperContext
    )
  }

  for (const imageId of assistantAttachments) {
    try {
      await repos.files.addLink(imageId, assistantMessageId)
    } catch (error) {
      logger.warn('Failed to link image to assistant message', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return assistantMessageId
}

/**
 * Calculate the next speaker state for multi-character chats.
 */
export async function calculateNextSpeaker(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  chat: ChatMetadataBase,
  character: Character,
  characterParticipant: { id: string },
  userParticipantId: string | null
): Promise<NextSpeakerInfo> {
  const updatedMessages = await repos.chats.getMessages(chatId)
  const messageEvents = updatedMessages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[]

  // Re-read the chat so spokenThisCycleParticipantIds reflects the most
  // recent persistence (the orchestrator updates this field after each save).
  const freshChat = await repos.chats.findById(chatId)
  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: chat.participants,
    userParticipantId,
    spokenThisCycleParticipantIds: freshChat?.spokenThisCycleParticipantIds ?? chat.spokenThisCycleParticipantIds,
  })

  const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants)
  const charactersMap = new Map<string, Character>()

  for (const p of activeCharacterParticipants) {
    if (p.characterId) {
      const char = p.id === characterParticipant.id
        ? character
        : await repos.characters.findById(p.characterId)
      if (char) {
        charactersMap.set(p.characterId, char)
      }
    }
  }

  const nextSpeakerResult = selectNextSpeaker(
    chat.participants,
    charactersMap,
    turnState,
    userParticipantId,
    chat.impersonatingParticipantIds
  )

  return {
    nextSpeakerId: nextSpeakerResult.nextSpeakerId,
    reason: nextSpeakerResult.reason,
    cycleComplete: nextSpeakerResult.cycleComplete,
    isUsersTurn: isUsersTurn(nextSpeakerResult),
  }
}
