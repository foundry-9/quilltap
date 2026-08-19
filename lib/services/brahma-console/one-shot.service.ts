/**
 * One-shot Brahma Console engine.
 *
 * Runs a single, ISOLATED Brahma Console query and returns the final answer text
 * — no persistence, no SSE, no chat history. This is what backs the Brahma
 * pseudocharacter when it is consulted as a Carina answerer from inside a Salon
 * (see `lib/services/carina/brahma-answerer.ts`).
 *
 * It mirrors `processBrahmaResponse` (the streaming, persisting console
 * orchestrator) but deliberately diverges on three points:
 *
 *  - **No chat history.** The conversation slate is exactly
 *    `[system, user(question)]`. Loading the surrounding Salon transcript would
 *    leak every other participant's content into Brahma and break Carina's
 *    isolation contract.
 *  - **No persistence.** Tool calls are executed (their own side effects stand),
 *    but the per-iteration assistant / TOOL messages are never written to the
 *    Salon, no tokens are tracked, and no done/error SSE events are emitted. The
 *    answer is accumulated in memory and returned.
 *  - **Operator surface.** Tools run with `operatorSurface: true`, unlocking
 *    `run_sql` and all-store document access — exactly as the standalone
 *    console. The caller (`runCarinaQuery`) gates reachability to the operator,
 *    user-controlled personas, and `systemTransparency` characters BEFORE
 *    calling here, because Brahma answers run at full operator privilege.
 *
 * `processBrahmaResponse` is NOT refactored into a shared core: it was recently
 * stabilised and the divergences above are exactly the parts that make sharing
 * awkward. The in-memory agent loop (submit_final_response handling, tool-call
 * threading, the stuck-loop guard) is reused via the shared helpers.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import {
  buildTools,
  streamMessage,
} from '@/lib/services/chat-message/streaming.service'
import {
  processToolCalls,
  detectToolCallsInResponse,
  type StreamController,
} from '@/lib/services/chat-message/tool-execution.service'
import {
  buildAssistantToolCallMessage,
  buildToolResultMessages,
  type ThreadedMessage,
} from '@/lib/services/chat-message/tool-call-threading'
import {
  buildNativeToolSystemInstructions,
  checkShouldUseTextBlockTools,
  buildTextBlockSystemInstructions,
  parseTextBlocksFromResponse,
  stripTextBlockMarkersFromResponse,
  type TextBlockEnabledToolOptions,
} from '@/lib/services/chat-message/pseudo-tool.service'
import { hasTextBlockMarkers } from '@/lib/tools'
import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
  extractSubmitFinalResponseFromText,
} from '@/lib/services/chat-message/agent-mode-resolver.service'
import { buildBrahmaSystemPrompt } from '@/lib/brahma-console/system-prompt-builder'
import { resolveBrahmaConnectionProfile, normalizeToolCallSignature } from './orchestrator.service'
import { resolveBrahmaMaxAgentTurns } from './turn-budget'

const logger = createServiceLogger('BrahmaOneShot')

/** Consecutive duplicate / stale tool iterations before forcing a final answer. */
const MAX_DUPLICATE_TOOL_CALLS = 2

export interface RunBrahmaQueryOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  /** The Salon chat the answer will be posted into (tool scope / logging only). */
  chatId: string
  /** The standalone question to put to the console. */
  question: string
}

export type BrahmaQueryResult =
  | { ok: true; answer: string }
  | { ok: false; detail: string }

/**
 * Run an isolated Brahma Console query and return the final answer text.
 * Returns `{ ok: false, detail }` (never throws) so the Carina caller can route
 * the failure through Prospero — `detail: 'no-profile'` maps to the no-profile
 * error; anything else is an llm-failed detail string.
 */
export async function runBrahmaQuery(opts: RunBrahmaQueryOptions): Promise<BrahmaQueryResult> {
  const { repos, userId, chatId, question } = opts

  // Profile (model): the user's default — there is no per-chat console profile
  // when Brahma is consulted from a Salon.
  const connectionProfile = await resolveBrahmaConnectionProfile(repos, userId, null)
  if (!connectionProfile) {
    logger.debug('No connection profile resolvable for Brahma query', { chatId })
    return { ok: false, detail: 'no-profile' }
  }

  const keyResolution = await resolveConnectionProfileApiKey(repos, connectionProfile)
  if (!keyResolution.ok) {
    return {
      ok: false,
      detail: keyResolution.reason === 'no-api-key-configured'
        ? 'no API key configured for this connection profile'
        : 'API key not found',
    }
  }
  const apiKey = keyResolution.apiKey

  // Tools — identical to the standalone console: agent mode, doc read/write, the
  // read-only run_sql tool, search-without-memories; NO ask_carina (recursion
  // guard), NO workspace tools.
  const { tools, modelSupportsNativeTools } = await buildTools(
    connectionProfile,
    null,   // imageProfileId
    null,   // imageProfile
    userId,
    null,   // projectId
    false,  // requestFullContext
    [],     // disabledTools
    [],     // disabledToolGroups
    true,   // agentModeEnabled
    false,  // isMultiCharacter
    false,  // helpToolsEnabled
    false,  // canDressThemselves
    false,  // canCreateOutfits
    true,   // documentEditingEnabled
    false,  // askCarinaEnabled — recursion guard
    false,  // includeWorkspaceTools — stripped for the console
    true,   // excludeMemorySearch — no memory source
    true,   // sqlAccess — read-only run_sql
  )

  // Tool mode (native vs. text-block); simple-json downgrades to text-block.
  const profilePseudoToolMode = (connectionProfile as { pseudoToolMode?: 'auto' | 'native' | 'simple-json' | 'text-block' }).pseudoToolMode
  const effectivePseudoToolMode: 'auto' | 'native' | 'text-block' =
    profilePseudoToolMode === 'simple-json' ? 'text-block' : (profilePseudoToolMode ?? 'auto')
  const useTextBlockTools = checkShouldUseTextBlockTools(modelSupportsNativeTools, effectivePseudoToolMode)

  let toolInstructions = ''
  if (useTextBlockTools && tools.length > 0) {
    const textBlockOptions: TextBlockEnabledToolOptions = {
      imageGeneration: false,
      search: true,
      webSearch: !!connectionProfile.allowWebSearch,
      whisper: false,
      state: false,
      rng: false,
      projectInfo: false,
      helpSearch: false,
      helpSettings: false,
      helpNavigate: false,
      createNote: false,
      wardrobeList: false,
      wardrobeRead: false,
      wardrobeWear: false,
      wardrobeTakeOff: false,
      wardrobeCreate: false,
      wardrobeUpdate: false,
      wardrobeArchive: false,
    }
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
  } else if (tools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  // Operator-set turn budget (Settings → Chat → Brahma Console); shared with the
  // standalone console. The stuck-loop guard below is independent of it.
  const maxAgentTurns = await resolveBrahmaMaxAgentTurns()
  const agentInstructions = buildAgentModeInstructions(maxAgentTurns)
  toolInstructions = toolInstructions ? `${toolInstructions}\n\n${agentInstructions}` : agentInstructions

  const systemPrompt = buildBrahmaSystemPrompt({
    profile: connectionProfile,
    toolInstructions,
    includeSqlAccess: true,
  })

  // ISOLATION: system + the single question only — never the Salon transcript.
  const conversationMessages: ThreadedMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ]

  const effectiveTools = (!useTextBlockTools && modelSupportsNativeTools) ? tools : []

  // Sink controller — tool execution streams nowhere; nothing is surfaced live.
  const sink: StreamController = { enqueue: () => {} }
  const encoder = new TextEncoder()

  let agentTurnCount = 0
  let fullResponse = ''
  const toolCallHistory: string[] = []
  // Stuck-loop detection (mirrors the standalone console): an exact-signature
  // repeat OR consecutive iterations that surface nothing new force a final turn.
  const seenResultFingerprints = new Set<string>()
  let staleIterations = 0
  let lastToolResultText = ''

  while (agentTurnCount <= maxAgentTurns) {
    agentTurnCount++

    if (agentTurnCount === maxAgentTurns) {
      conversationMessages.push({ role: 'user', content: buildForceFinalMessage() })
    }

    let currentResponse = ''
    let turnReasoning = ''
    let rawResponse: unknown = null
    let turnThoughtSignature: string | undefined

    for await (const chunk of streamMessage({
      messages: conversationMessages,
      connectionProfile,
      apiKey,
      modelParams: {},
      tools: effectiveTools,
      useNativeWebSearch: false,
      userId,
      chatId,
    })) {
      // Reasoning is request-local continuation state for providers that pair it
      // with the tool-use turn (e.g. Anthropic); never surfaced or re-fed.
      if (chunk.reasoningContent && chunk.reasoningContent !== turnReasoning) {
        turnReasoning = chunk.reasoningContent
      }
      if (chunk.content) currentResponse += chunk.content
      if (chunk.rawResponse) rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) turnThoughtSignature = chunk.thoughtSignature
    }

    // Detect tool calls (native or text-block).
    let hasToolCalls = false
    let toolCallsToProcess: Array<{ name: string; arguments: Record<string, unknown>; callId?: string }> | null = null

    if (modelSupportsNativeTools && !useTextBlockTools) {
      const detected = detectToolCallsInResponse(rawResponse, connectionProfile.provider)
      if (detected && detected.length > 0) {
        toolCallsToProcess = detected
        hasToolCalls = true
      }
    } else if (useTextBlockTools && hasTextBlockMarkers(currentResponse)) {
      const parsed = parseTextBlocksFromResponse(currentResponse)
      if (parsed.length > 0) {
        toolCallsToProcess = parsed
        hasToolCalls = true
        currentResponse = stripTextBlockMarkersFromResponse(currentResponse)
      }
    }

    // submit_final_response (agent-mode completion).
    let isSubmitFinal = toolCallsToProcess?.some((tc) => tc.name === 'submit_final_response') ?? false
    if (isSubmitFinal && toolCallsToProcess) {
      const submitCall = toolCallsToProcess.find((tc) => tc.name === 'submit_final_response')
      const finalContent = (submitCall?.arguments?.response as string) || currentResponse
      currentResponse = finalContent
      fullResponse = currentResponse
      hasToolCalls = false
    }

    // Fallback: submit_final_response emitted as raw JSON text.
    if (!isSubmitFinal && !hasToolCalls) {
      const extracted = extractSubmitFinalResponseFromText(currentResponse)
      if (extracted !== currentResponse) {
        isSubmitFinal = true
        currentResponse = extracted
        fullResponse = extracted
        hasToolCalls = false
      }
    }

    if (hasToolCalls && !isSubmitFinal && toolCallsToProcess && agentTurnCount < maxAgentTurns) {
      const callSignature = normalizeToolCallSignature(toolCallsToProcess)
      const duplicateCount = toolCallHistory.filter((sig) => sig === callSignature).length
      toolCallHistory.push(callSignature)

      const isStuck =
        duplicateCount >= MAX_DUPLICATE_TOOL_CALLS || staleIterations >= MAX_DUPLICATE_TOOL_CALLS
      if (isStuck) {
        logger.warn('Brahma one-shot stuck in tool-call loop, forcing final response', {
          chatId,
          turn: agentTurnCount,
          duplicateCount: duplicateCount + 1,
          staleIterations,
        })
        const toolDataReminder = lastToolResultText
          ? `\n\nHere is the data you already received from your previous tool call:\n${lastToolResultText}`
          : ''
        // Content-only assistant turn — we are NOT executing these calls, so an
        // attached tool-use block would be left unanswered for strict providers.
        conversationMessages.push({ role: 'assistant', content: currentResponse })
        conversationMessages.push({
          role: 'user',
          content: `You have already gathered this data (a repeated call or repeated identical results). You already have what you need — do NOT call any more tools. Please call the submit_final_response tool NOW with your answer based on the data you already received.${toolDataReminder}`,
        })
        continue
      }

      // Thread the assistant tool-call turn WITH its native tool_calls (paired by
      // callId on the next stream) so the model sees it already issued them.
      conversationMessages.push(
        buildAssistantToolCallMessage(toolCallsToProcess, currentResponse, {
          reasoningContent: turnReasoning || undefined,
          thoughtSignature: turnThoughtSignature,
        }),
      )

      // Execute the tools — operator surface (character-less, all-stores). The
      // tool side effects (SQL reads, doc writes) stand; the result MESSAGES are
      // threaded in-memory only and never persisted to the Salon.
      const toolContext: ToolExecutionContext = {
        chatId,
        userId,
        operatorSurface: true,
        pendingWardrobeAnnouncements: new Set<string>(),
      }

      const toolResult = await processToolCalls(
        toolCallsToProcess,
        toolContext,
        sink,
        encoder,
        { characterName: 'Brahma Console', characterId: '' },
      )

      if (toolResult.toolMessages.length > 0) {
        conversationMessages.push(...buildToolResultMessages(toolResult.toolMessages))

        let producedNewInfo = false
        for (const tm of toolResult.toolMessages) {
          lastToolResultText = tm.content
          const fingerprint = `${tm.toolName}:${tm.success}:${tm.content}`
          if (!seenResultFingerprints.has(fingerprint)) {
            seenResultFingerprints.add(fingerprint)
            producedNewInfo = true
          }
        }
        staleIterations = producedNewInfo ? 0 : staleIterations + 1
      }

      continue
    }

    // No tool calls or final response — done.
    fullResponse = currentResponse
    break
  }

  // Models that output submit_final_response as JSON text.
  fullResponse = extractSubmitFinalResponseFromText(fullResponse)

  let finalAnswer = fullResponse.trim()

  // Budget-exhaustion salvage (Bug 47) — the mirror of the standalone
  // orchestrator's. The forced final turn runs no tools, so a model that answers
  // it with another native tool call instead of `submit_final_response` leaves
  // `fullResponse` empty. Rather than report a bare failure to Carina after
  // spending real budget, synthesise an explanatory answer from the last tool
  // result we captured. With no tool data at all there is genuinely nothing to
  // return, so fall through to the empty-response failure below.
  if (!finalAnswer && lastToolResultText) {
    finalAnswer = `I reached my ${maxAgentTurns}-turn budget before I could compose a final answer.\n\nHere is what I gathered before I stopped:\n\n${lastToolResultText}`
    logger.warn('Brahma one-shot exhausted its turn budget without a final response', {
      chatId,
      maxAgentTurns,
    })
  }

  if (!finalAnswer) {
    logger.debug('Brahma one-shot produced an empty answer', { chatId })
    return { ok: false, detail: 'empty response' }
  }

  return { ok: true, answer: finalAnswer }
}
