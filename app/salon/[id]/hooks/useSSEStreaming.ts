'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { showSuccessToast, showErrorToast, showWarningToast, showInfoToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ChatParticipantBase } from '@/lib/schemas/types'
import { findActiveUserParticipant } from '@/lib/chat/turn-manager'
import type { Message, MessageAttachment, Chat, PendingToolResult } from '../types'
import type { ComposerEditorHandle } from '@/components/chat/lexical/types'

export interface PendingToolCall {
  id: string
  name: string
  status: 'pending' | 'success' | 'error'
  result?: unknown
  arguments?: Record<string, unknown>
}

/**
 * A batch of in-progress tool calls plus the offset into the streamed response
 * text at which they were invoked. Lets the streaming bubble splice each batch
 * back into the live prose at the point the model paused to call it — the live
 * analogue of the persisted `anchorOffset` carried on saved tool messages.
 */
export interface StreamingToolBatch {
  offset: number
  calls: PendingToolCall[]
}

export interface ToolExecutionStatus {
  tool: string
  status: 'pending' | 'success' | 'error'
  message: string
}

/** How long a settled tool-execution notice lingers before it dismisses itself. */
const TOOL_STATUS_DISMISS_MS = 6000

export interface ResponseStatus {
  stage: string
  message: string
  toolName?: string
  characterName?: string
  characterId?: string
}

/** Result of parsing a single SSE data line */
interface SSEEvent {
  content?: string
  /** Live cumulative reasoning ("thinking") text. DISPLAY ONLY — the client
   *  replaces (not appends) its buffer with each value. */
  reasoning?: string
  /** Full reasoning text on the done event (for the optimistic assistant push). */
  reasoningContent?: string | null
  /** Positioned reasoning blocks on the done event. DISPLAY ONLY. */
  reasoningSegments?: Array<{ anchorOffset: number; content: string; seq: number }> | null
  status?: ResponseStatus
  error?: string
  details?: string
  done?: boolean
  messageId?: string
  emptyResponse?: boolean
  emptyResponseReason?: string
  toolsDetected?: boolean
  toolNames?: string[]
  toolArguments?: Record<string, unknown>[]
  toolResult?: {
    index?: number
    name: string
    success: boolean
    result?: any
  }
  provider?: string
  modelName?: string
  // Turn/chain events are sent as flat JSON with boolean flags
  // e.g. { turnStart: true, participantId: "...", characterName: "...", chainDepth: 1 }
  turnStart?: boolean
  turnComplete?: boolean
  chainComplete?: boolean
  participantId?: string
  characterName?: string
  chainDepth?: number
  nextSpeakerId?: string | null
  reason?: string
  isSilentMessage?: boolean
  // The Courier: { pendingExternalTurn: true, messageId, participantId, characterName }
  pendingExternalTurn?: boolean
  // Carina: the full posted reference-answer message, surfaced the instant it
  // returns so the Salon renders the card without waiting for the post-turn
  // fetchChat(). Inserted optimistically and deduped by id; the end-of-turn
  // refresh reconciles it to the authoritative copy.
  carinaAnswer?: Message
  // "Nothing to add" turn-skipping. `hostAnnouncement` carries the full posted
  // Host turn-pass message (surfaced live like carinaAnswer, deduped by id).
  // On the done event, `skipped` marks that this turn was passed so the client
  // resets its streaming buffer without appending a phantom bubble.
  hostAnnouncement?: Message
  // Pascal: the full posted custom-tool outcome message, surfaced the instant
  // the dice fall so the Salon renders the bubble without waiting for the
  // post-turn fetchChat(). Inserted optimistically and deduped by id; the
  // end-of-turn refresh reconciles it to the authoritative copy.
  pascalResult?: Message
  skipped?: boolean
  skippedParticipantId?: string | null
  // Answer confirmation: the resolved state for a just-streamed message. On a
  // re-affirmation rewrite, `content` carries the replacement bubble text.
  confirmationResult?: {
    messageId: string
    confirmed: boolean | null
    revised: boolean
    notes: string | null
    content?: string
  }
}

/**
 * Parse a raw SSE data string into a structured event, or null if it should be skipped.
 */
export function parseSSEData(rawData: string): SSEEvent | null {
  const trimmed = rawData.trim()
  if (!trimmed || trimmed === '[DONE]' || trimmed === '{}') {
    return null
  }
  try {
    return JSON.parse(trimmed) as SSEEvent
  } catch {
    // Ignore JSON parse errors (SSE chunking artifacts)
    return null
  }
}

interface UseSSEStreamingParams {
  chatId: string
  chat: Chat | null
  messages: Message[]
  setMessages: (fn: Message[] | ((prev: Message[]) => Message[])) => void
  isMultiChar: boolean
  hasActiveCharacters: boolean
  participantsAsBase: ChatParticipantBase[]
  isPaused: boolean
  respondingParticipantId: string | null
  setRespondingParticipantId: (id: string | null) => void
  /** The user-controlled participant the human is currently "Speaking As" (null = default) */
  activeTypingParticipantId: string | null
  /** Seats the human is impersonating this session (overlay; `controlledBy` stays `'llm'`) */
  impersonatingParticipantIds: string[]
  fetchChat: () => Promise<void>
  scrollOnUserMessage: () => void
  scrollOnStreamComplete: () => void
  setAttachedFiles: (files: any[]) => void
  inputRef: React.RefObject<ComposerEditorHandle | null>
  getFirstCharacterParticipant: () => import('../types').Participant | undefined
  setPauseState: (paused: boolean) => void
  /** Called when a tool result arrives, allowing the page to react to specific tools */
  onToolResult?: (name: string, success: boolean, result: unknown) => void
}

/**
 * The Salon's live message transport, built on Fetch Streams (SSE-style events).
 *
 * TanStack Query boundary: this is deliberately NOT a TanStack Query concern.
 * Query is a server-state *cache*, not a streaming transport — stream chunks are
 * never written into the query cache, and the live message buffer is owned here
 * via `setMessages`. The query reads that surround
 * streaming (chat list, chat settings, LLM logs) live on TanStack Query and are
 * refreshed through their own hooks (e.g. `useLLMLogs.refreshLogs()` fires when a
 * turn completes); the authoritative post-turn message reconciliation goes
 * through the page's own `fetchChat()`. Keep that separation: do not move stream
 * handling onto `useQuery`, and do not push chunks into `queryClient`.
 */
export function useSSEStreaming({
  chatId,
  chat,
  messages,
  setMessages,
  isMultiChar,
  hasActiveCharacters,
  participantsAsBase,
  isPaused,
  respondingParticipantId,
  setRespondingParticipantId,
  activeTypingParticipantId,
  impersonatingParticipantIds,
  fetchChat,
  scrollOnUserMessage,
  scrollOnStreamComplete,
  setAttachedFiles,
  inputRef,
  getFirstCharacterParticipant,
  setPauseState,
  onToolResult: onToolResultCallback,
}: UseSSEStreamingParams) {
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  // Mirror the live "Speaking As" selection into a ref so the send/continue
  // callbacks read the current value without re-creating on every selection.
  const activeTypingParticipantIdRef = useRef(activeTypingParticipantId)
  useEffect(() => {
    activeTypingParticipantIdRef.current = activeTypingParticipantId
  }, [activeTypingParticipantId])
  // Mirror the impersonation overlay and the participant roster so the optimistic
  // user bubble can resolve its author exactly the way the server will (Bug 45) —
  // the send callback deliberately does not re-create on every roster/overlay
  // change, so it reads these through refs rather than stale closure captures.
  const impersonatingParticipantIdsRef = useRef(impersonatingParticipantIds)
  useEffect(() => {
    impersonatingParticipantIdsRef.current = impersonatingParticipantIds
  }, [impersonatingParticipantIds])
  const participantsAsBaseRef = useRef(participantsAsBase)
  useEffect(() => {
    participantsAsBaseRef.current = participantsAsBase
  }, [participantsAsBase])
  // Live cumulative reasoning ("thinking") for the in-progress turn. DISPLAY ONLY.
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [waitingForResponse, setWaitingForResponse] = useState(false)
  // In-progress tool calls for the turn being streamed, grouped into batches by
  // the point in the prose where each fired (see StreamingToolBatch). Replaces a
  // single flat list so the streaming bubble can interleave them with the text.
  const [streamingToolBatches, setStreamingToolBatches] = useState<StreamingToolBatch[]>([])
  const [toolExecutionStatus, setToolExecutionStatus] = useState<ToolExecutionStatus | null>(null)
  const [responseStatus, setResponseStatus] = useState<ResponseStatus | null>(null)
  // Auto-dismiss timer for a settled (success/error) tool-execution notice. The
  // banner used to be cleared only from the send path's onDone, so any turn that
  // finished by another route — a chain's intermediate done, continue mode, an
  // error, an autonomous turn — left it pinned above the composer forever.
  const toolStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  // Monotonic batch counter so tool-call React keys stay unique across batches.
  const toolBatchSeqRef = useRef(0)

  // rAF-coalesced streaming content updates. SSE chunks can arrive faster
  // than React can render them — in long multi-character chains that burst
  // of per-chunk state updates has tripped React's update-depth limit. We
  // buffer the latest accumulated content in a ref and flush at most once
  // per animation frame, capping the render rate at the display refresh
  // rate regardless of chunk cadence.
  const streamingContentBufferRef = useRef<string>('')
  const streamingContentRafRef = useRef<number | null>(null)
  // Reasoning shares the same rAF-coalescing treatment as content.
  const streamingReasoningBufferRef = useRef<string>('')
  const streamingReasoningRafRef = useRef<number | null>(null)

  const flushStreamingContent = useCallback(() => {
    streamingContentRafRef.current = null
    setStreamingContent(streamingContentBufferRef.current)
  }, [])

  const scheduleStreamingContent = useCallback((content: string) => {
    streamingContentBufferRef.current = content
    if (streamingContentRafRef.current === null) {
      streamingContentRafRef.current = requestAnimationFrame(flushStreamingContent)
    }
  }, [flushStreamingContent])

  const flushStreamingReasoning = useCallback(() => {
    streamingReasoningRafRef.current = null
    setStreamingReasoning(streamingReasoningBufferRef.current)
  }, [])

  // Reasoning arrives cumulatively, so we replace (not append) the buffer.
  const scheduleStreamingReasoning = useCallback((reasoning: string) => {
    streamingReasoningBufferRef.current = reasoning
    if (streamingReasoningRafRef.current === null) {
      streamingReasoningRafRef.current = requestAnimationFrame(flushStreamingReasoning)
    }
  }, [flushStreamingReasoning])

  const resetStreamingContent = useCallback(() => {
    if (streamingContentRafRef.current !== null) {
      cancelAnimationFrame(streamingContentRafRef.current)
      streamingContentRafRef.current = null
    }
    streamingContentBufferRef.current = ''
    setStreamingContent('')
    // Reasoning resets in lockstep with content so every turn-boundary cleanup
    // (turnStart, done, errors, stop) clears the live thinking block too.
    if (streamingReasoningRafRef.current !== null) {
      cancelAnimationFrame(streamingReasoningRafRef.current)
      streamingReasoningRafRef.current = null
    }
    streamingReasoningBufferRef.current = ''
    setStreamingReasoning('')
  }, [])

  // Patch a message in place with its resolved answer-confirmation state. On a
  // re-affirmation rewrite (`content` present) the optimistic bubble text is
  // replaced with the corrected reply — a deliberate, visible transparency swap.
  const applyConfirmationResult = useCallback((result: {
    messageId: string
    confirmed: boolean | null
    revised: boolean
    notes: string | null
    content?: string
  }) => {
    setMessages(prev => prev.map(m => m.id === result.messageId ? {
      ...m,
      confirmed: result.confirmed,
      confirmationChecked: true,
      confirmationRevised: result.revised,
      confirmationNotes: result.notes,
      ...(typeof result.content === 'string' ? { content: result.content } : {}),
    } : m))
  }, [setMessages])

  // Cancel any pending rAF (and the tool-status auto-dismiss timer) on unmount
  // to avoid setting state after teardown.
  useEffect(() => {
    return () => {
      if (streamingContentRafRef.current !== null) {
        cancelAnimationFrame(streamingContentRafRef.current)
      }
      if (streamingReasoningRafRef.current !== null) {
        cancelAnimationFrame(streamingReasoningRafRef.current)
      }
      if (toolStatusTimerRef.current !== null) {
        clearTimeout(toolStatusTimerRef.current)
      }
    }
  }, [])

  /** Clear the tool-execution notice and any pending auto-dismiss timer. */
  const dismissToolExecutionStatus = useCallback(() => {
    if (toolStatusTimerRef.current !== null) {
      clearTimeout(toolStatusTimerRef.current)
      toolStatusTimerRef.current = null
    }
    setToolExecutionStatus(null)
  }, [])

  /**
   * Turn-boundary cleanup: drop a notice that is still 'pending' (its tool
   * result never arrived). A settled notice is left alone — its own
   * auto-dismiss timer is already running.
   */
  const clearPendingToolExecutionStatus = useCallback(() => {
    setToolExecutionStatus(prev => (prev?.status === 'pending' ? null : prev))
  }, [])

  // Single door for the tool-execution notice. A 'pending' notice stays up until
  // it settles or the turn ends; a settled one self-expires, so no caller has to
  // remember to tear it down.
  const publishToolExecutionStatus = useCallback((status: ToolExecutionStatus) => {
    if (toolStatusTimerRef.current !== null) {
      clearTimeout(toolStatusTimerRef.current)
      toolStatusTimerRef.current = null
    }
    setToolExecutionStatus(status)
    if (status.status !== 'pending') {
      toolStatusTimerRef.current = setTimeout(() => {
        toolStatusTimerRef.current = null
        setToolExecutionStatus(null)
      }, TOOL_STATUS_DISMISS_MS)
    }
  }, [])

  // Focus input after response completes
  const focusInput = useCallback(() => {
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 150)
  }, [inputRef])

  // Push a freshly-detected tool batch, tagged with the prose offset where it
  // fired, and surface image-generation status. Shared by the send and continue
  // streaming paths so both interleave tool calls into the live bubble.
  const trackToolsDetected = useCallback((data: SSEEvent, offset: number) => {
    const toolNames = (data.toolNames || []) as string[]
    const toolArgs = (data.toolArguments || []) as Record<string, unknown>[]
    const seq = toolBatchSeqRef.current++
    const calls: PendingToolCall[] = toolNames.map((name, idx) => ({
      id: `tool-${seq}-${idx}`,
      name,
      status: 'pending' as const,
      arguments: toolArgs[idx],
    }))
    setStreamingToolBatches(prev => [...prev, { offset, calls }])
    if (toolNames.includes('generate_image')) {
      publishToolExecutionStatus({
        tool: 'generate_image',
        status: 'pending',
        message: `Generating image...`,
      })
    }
  }, [publishToolExecutionStatus])

  // Mark a tool result on the most recent batch (results stream immediately
  // after their detection) and run per-tool side effects (navigation, image
  // toasts, page callback).
  const trackToolResult = useCallback((data: SSEEvent) => {
    const { index, name, success, result } = data.toolResult!

    setStreamingToolBatches(prev => {
      if (prev.length === 0) return prev
      const lastIdx = prev.length - 1
      const last = prev[lastIdx]
      const calls = last.calls.map((tc, idx) =>
        (index !== undefined && idx === index) || (index === undefined && tc.name === name)
          ? { ...tc, status: success ? ('success' as const) : ('error' as const), result }
          : tc
      )
      const next = prev.slice()
      next[lastIdx] = { ...last, calls }
      return next
    })

    // Handle help_navigate: navigate the current window to the target URL
    if (name === 'help_navigate' && success && result?.navigationUrl) {
      window.location.href = result.navigationUrl
    }

    if (name === 'generate_image') {
      if (success) {
        const imageCount = result?.images?.length || 1
        publishToolExecutionStatus({
          tool: name,
          status: 'success',
          message: `Successfully generated ${imageCount} image${imageCount > 1 ? 's' : ''}!`,
        })
        showSuccessToast(`Image generation complete! ${imageCount} image${imageCount > 1 ? 's' : ''} generated.`)
      } else {
        publishToolExecutionStatus({
          tool: name,
          status: 'error',
          message: result?.error || 'Failed to generate image',
        })
        showErrorToast(`Image generation failed: ${result?.error || 'Unknown error'}`)
      }
    }

    // Notify the page about tool results (for Document Mode, etc.)
    onToolResultCallback?.(name, success, result)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onToolResultCallback is a stable page-level callback
  }, [publishToolExecutionStatus])

  /**
   * Shared SSE stream reader. Processes lines from a ReadableStreamDefaultReader.
   * Returns the accumulated full content string.
   *
   * `onDone` is called when data.done is received, allowing the caller to finalize.
   */
  const readSSEStream = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    opts: {
      participantId: string | null
      /** `offset` is the length of the response text streamed so far — where
       *  this batch of tool calls was invoked in the prose. */
      onToolsDetected?: (data: SSEEvent, offset: number) => void
      onToolResult?: (data: SSEEvent) => void
      onDone: (fullContent: string, data: SSEEvent) => void | Promise<void>
      /** Called when a Carina reference answer is surfaced mid-turn */
      onCarinaAnswer?: (message: Message) => void
      /** Called when a Host announcement (e.g. a turn-pass note) is surfaced mid-turn */
      onHostAnnouncement?: (message: Message) => void
      /** Called when a Pascal custom-tool outcome is surfaced mid-turn */
      onPascalResult?: (message: Message) => void
      /** Called when an answer-confirmation result resolves for a message */
      onConfirmationResult?: (result: NonNullable<SSEEvent['confirmationResult']>) => void
      /** Called for intermediate done events during a chain (not the final one) */
      onIntermediateDone?: (fullContent: string, data: SSEEvent) => void | Promise<void>
      onTurnStart?: (event: { participantId: string; characterName: string; chainDepth: number }) => void
      onTurnComplete?: (event: { participantId: string; messageId: string; chainDepth: number }) => void | Promise<void>
      onChainComplete?: (event: { reason: string; nextSpeakerId: string | null; chainDepth: number }) => void | Promise<void>
    }
  ): Promise<string> => {
    const decoder = new TextDecoder()
    let fullContent = ''
    let inChain = false
    // Tracks whether the "streaming started" flags have been flipped for the
    // current turn. The flags are idempotent after the first content chunk,
    // so re-firing them on every chunk just pressures the reconciler — in
    // long multi-character chains, that pressure has tipped React past its
    // update-depth limit. Reset on turnStart so each chained turn transitions
    // cleanly.
    let hasStartedStreaming = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const rawData = line.slice(6)
        const data = parseSSEData(rawData)
        if (!data) continue

        // Handle status updates
        if (data.status) {
          setResponseStatus(data.status)
          // Show warning toast when retrying due to empty response
          if (data.status.stage === 'retrying') {
            showWarningToast(data.status.message)
          }
        }

        // Handle content chunks
        if (data.content) {
          fullContent += data.content
          if (!hasStartedStreaming) {
            setWaitingForResponse(false)
            setStreaming(true)
            hasStartedStreaming = true
          }
          scheduleStreamingContent(fullContent)
        }

        // Handle live reasoning ("thinking") — cumulative, so replace the buffer.
        // DISPLAY ONLY; the StreamingMessage renders it as a leading block when
        // the chat's thinking-visibility is on.
        if (typeof data.reasoning === 'string') {
          scheduleStreamingReasoning(data.reasoning)
        }

        // Handle errors
        if (data.error) {
          setResponseStatus(null)
          const errorMsg = data.details
            ? `${data.error}: ${data.details}`
            : data.error
          throw new Error(errorMsg)
        }

        // Handle tool detection. `fullContent` is the prose streamed so far —
        // the offset at which this batch was invoked.
        if (data.toolsDetected && opts.onToolsDetected) {
          opts.onToolsDetected(data, fullContent.length)
        }

        // Handle tool results
        if (data.toolResult && opts.onToolResult) {
          opts.onToolResult(data)
        }

        // Handle a Carina reference answer surfaced mid-turn — insert it into the
        // flow immediately rather than waiting for the post-turn fetchChat().
        if (data.carinaAnswer && opts.onCarinaAnswer) {
          opts.onCarinaAnswer(data.carinaAnswer)
        }

        // Handle a Host announcement surfaced mid-turn (turn-pass note) — insert
        // it immediately, deduped by id, same as Carina answers.
        if (data.hostAnnouncement && opts.onHostAnnouncement) {
          opts.onHostAnnouncement(data.hostAnnouncement)
        }

        // Handle a Pascal custom-tool outcome surfaced mid-turn — insert it
        // immediately, deduped by id, same as Carina answers.
        if (data.pascalResult && opts.onPascalResult) {
          opts.onPascalResult(data.pascalResult)
        }

        // Handle an answer-confirmation result — update the badge and, on a
        // revision, swap in the corrected bubble text (a deliberate, visible
        // transparency swap).
        if (data.confirmationResult && opts.onConfirmationResult) {
          opts.onConfirmationResult(data.confirmationResult)
        }

        // Handle completion
        if (data.done) {
          setResponseStatus(null)
          if (inChain && opts.onIntermediateDone) {
            // Intermediate done during a chain — lighter cleanup, no state reset
            await opts.onIntermediateDone(fullContent, data)
          } else {
            await opts.onDone(fullContent, data)
          }
        }

        // The Courier: server placed a placeholder for a manual / clipboard
        // turn. Refetch so the bubble appears with the Markdown blob + paste
        // textarea. The accompanying `done` event closes the stream.
        if (data.pendingExternalTurn) {
          await fetchChat()
        }

        // Handle turn start (chained character about to respond)
        // Server sends flat: { turnStart: true, participantId, characterName, chainDepth }
        if (data.turnStart) {
          inChain = true
          fullContent = ''
          hasStartedStreaming = false
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(true)
          if (data.participantId) {
            opts.onTurnStart?.({
              participantId: data.participantId,
              characterName: data.characterName || 'Unknown',
              chainDepth: data.chainDepth || 0,
            })
          }
        }

        // Handle turn complete (chained character finished)
        // Server sends flat: { turnComplete: true, participantId, messageId, chainDepth }
        if (data.turnComplete) {
          await opts.onTurnComplete?.({
            participantId: data.participantId!,
            messageId: data.messageId || '',
            chainDepth: data.chainDepth || 0,
          })
        }

        // Handle chain complete (all chained turns done)
        // Server sends flat: { chainComplete: true, reason, nextSpeakerId, chainDepth }
        if (data.chainComplete) {
          inChain = false
          await opts.onChainComplete?.({
            reason: data.reason || 'no_next_speaker',
            nextSpeakerId: data.nextSpeakerId ?? null,
            chainDepth: data.chainDepth || 0,
          })
        }
      }
    }

    return fullContent
  }, [scheduleStreamingContent, scheduleStreamingReasoning, resetStreamingContent, fetchChat])

  // Handle common error extraction
  const extractErrorMessage = useCallback((err: unknown): string => {
    if (err instanceof Error) {
      return err.message || err.name || 'Unknown error'
    } else if (typeof err === 'string') {
      return err
    } else if (err && typeof err === 'object') {
      const errObj = err as Record<string, unknown>
      if (typeof errObj.error === 'string') return errObj.error
      if (typeof errObj.message === 'string') return errObj.message
    }
    return 'Unknown error'
  }, [])

  /**
   * Main send message function. Creates the user message, sends request, and streams response.
   */
  const sendMessage = useCallback(async (
    e: React.FormEvent,
    input: string,
    setInput: (v: string) => void,
    attachedFiles: Array<{ id: string; filename: string; filepath: string; mimeType: string }>,
    pendingToolResults: PendingToolResult[],
    setPendingToolResults: (results: PendingToolResult[]) => void,
    clearDraft: () => void,
    userStoppedStreamRef: React.MutableRefObject<boolean>,
  ) => {
    e.preventDefault()
    if ((!input.trim() && attachedFiles.length === 0 && pendingToolResults.length === 0) || sending) return

    // Reset user-stopped flag when user sends a message
    if (!isPaused) {
      userStoppedStreamRef.current = false
    }

    const userMessage = input.trim()
    const fileIds = attachedFiles.map((f) => f.id)
    const messageAttachments: MessageAttachment[] = attachedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.filepath,
      mimeType: f.mimeType,
    }))
    const toolResultsToSend = [...pendingToolResults]
    setInput('')
    clearDraft()
    setAttachedFiles([])
    setPendingToolResults([])
    setSending(true)
    setWaitingForResponse(true)
    setStreaming(false)
    resetStreamingContent()
    setStreamingToolBatches([])
    const firstCharParticipant = getFirstCharacterParticipant()
    // Track the current responding participant across chained turns (mutable for closures)
    let currentParticipantId = firstCharParticipant?.id || null
    setRespondingParticipantId(currentParticipantId)
    // Build display content with file indicators
    const displayContent = messageAttachments.length > 0
      ? `${userMessage}${userMessage ? '\n' : ''}[Attached: ${messageAttachments.map(f => f.filename).join(', ')}]`
      : userMessage

    // Add pending tool result messages to UI
    const toolMessages: Message[] = toolResultsToSend.map((result, index) => ({
      id: `temp-tool-${Date.now()}-${index}`,
      role: 'TOOL',
      content: JSON.stringify({
        tool: result.tool,
        initiatedBy: 'user',
        success: result.success,
        result: result.formattedResult,
        prompt: result.requestPrompt,
        arguments: result.arguments,
      }),
      createdAt: result.createdAt,
    }))

    const tempUserMessageId = `temp-user-${Date.now()}`
    // Attribute the optimistic bubble to the seat the *server* will resolve this
    // message onto — `findActiveUserParticipant`, which honours the impersonation
    // overlay and falls back to the owner user seat when the active-typing id is
    // not itself a user-driven seat. Using the bare `activeTypingParticipantId`
    // here diverged from the persisted row and made the bubble flicker to the
    // wrong author on refetch (Bug 45).
    const optimisticAuthor = findActiveUserParticipant(
      participantsAsBaseRef.current,
      activeTypingParticipantIdRef.current,
      impersonatingParticipantIdsRef.current,
    )
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: displayContent,
      createdAt: new Date().toISOString(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
      // Renders with the chosen character's name/avatar immediately (not the
      // default user), matching what the server persists.
      participantId: optimisticAuthor?.id ?? activeTypingParticipantIdRef.current ?? undefined,
    }
    setMessages((prev) => [...prev, ...toolMessages, tempUserMessage])
    scrollOnUserMessage()

    const requestPayload = {
      content: userMessage || (attachedFiles.length > 0 ? 'Please look at the attached file(s).' : ''),
      fileIds,
      speakingAsParticipantId: activeTypingParticipantIdRef.current ?? undefined,
      pendingToolResults: toolResultsToSend.length > 0 ? toolResultsToSend.map(r => ({
        tool: r.tool,
        success: r.success,
        result: r.formattedResult,
        prompt: r.requestPrompt,
        arguments: r.arguments,
        createdAt: r.createdAt,
      })) : undefined,
    }

    try {
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/v1/messages?chatId=${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal,
      })

      if (!res.ok) {
        let errorMessage = 'Failed to send message'
        try {
          const errorData = await res.json()
          errorMessage = errorData.error || errorData.message || errorMessage
        } catch {
          errorMessage = res.statusText || errorMessage
        }
        throw new Error(errorMessage)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readSSEStream(reader, {
        participantId: firstCharParticipant?.id || null,
        onToolsDetected: trackToolsDetected,
        onToolResult: trackToolResult,
        onCarinaAnswer: (msg) => {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          scrollOnStreamComplete()
        },
        onHostAnnouncement: (msg) => {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          scrollOnStreamComplete()
        },
        onPascalResult: (msg) => {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          scrollOnStreamComplete()
        },
        onConfirmationResult: applyConfirmationResult,
        onDone: async (fullContent, data) => {
          // "Nothing to add" turn-pass: the Host note already surfaced via
          // onHostAnnouncement. Reset streaming without appending a bubble or
          // toasting; the chain (or chainComplete) drives the rest.
          if (data.skipped) {
            resetStreamingContent()
            setStreaming(false)
            return
          }

          if (data.emptyResponse) {
            showErrorToast(data.emptyResponseReason || 'The AI returned an empty response. Use the Resend button to try again.')
            resetStreamingContent()
            setStreaming(false)
            setWaitingForResponse(false)
            setSending(false)
            setRespondingParticipantId(null)
            return
          }

          // The Courier: the server parked a placeholder for a manual /
          // clipboard turn and already pushed an SSE pendingExternalTurn that
          // triggered fetchChat. The placeholder is now in the messages list
          // via that refresh — pushing another optimistic copy here would
          // create a duplicate React key.
          if (data.pendingExternalTurn) {
            resetStreamingContent()
            setStreaming(false)
            setWaitingForResponse(false)
            setRespondingParticipantId(null)
            scrollOnStreamComplete()
            await fetchChat()
            return
          }

          // Use server-provided participantId if available (authoritative)
          const resolvedParticipantId = data.participantId || currentParticipantId

          const assistantMessage: Message = {
            id: data.messageId!,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: resolvedParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
            isSilentMessage: data.isSilentMessage || undefined,
            reasoningContent: data.reasoningContent ?? null,
            reasoningSegments: data.reasoningSegments ?? null,
          }
          setMessages((prev) => [...prev, assistantMessage])
          resetStreamingContent()
          // Live tool batches are spent — the refetched message carries the
          // persisted, interspersed copy. Clearing now also avoids a stale
          // flash on the next turn's bubble.
          setStreamingToolBatches([])
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          notifyQueueChange()
          // A settled notice is already counting itself down; only a 'pending'
          // one that never got a result needs clearing at the turn boundary.
          clearPendingToolExecutionStatus()
        },
        onIntermediateDone: async (fullContent, data) => {
          // Intermediate done during a chain — add temp message but don't reset state
          // "Nothing to add" turn-pass: Host note surfaced via onHostAnnouncement;
          // reset streaming without appending a bubble.
          if (data.skipped) {
            resetStreamingContent()
            setStreaming(false)
            return
          }
          if (data.emptyResponse || !fullContent) return

          // Use server-provided participantId if available (authoritative)
          const resolvedParticipantId = data.participantId || currentParticipantId

          const assistantMessage: Message = {
            id: data.messageId!,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: resolvedParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
            isSilentMessage: data.isSilentMessage || undefined,
            reasoningContent: data.reasoningContent ?? null,
            reasoningSegments: data.reasoningSegments ?? null,
          }
          setMessages((prev) => [...prev, assistantMessage])
          resetStreamingContent()
          setStreaming(false)
        },
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          resetStreamingContent()
          setStreamingToolBatches([])
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          notifyQueueChange()
          focusInput()
        },
      })
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'

      if (isAbort) {
        resetStreamingContent()
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
      } else {
        const errorMessage = extractErrorMessage(err)
        const displayMessage = errorMessage === 'Unknown error' || errorMessage === 'TypeError'
          ? 'Connection lost. Please try again.'
          : errorMessage
        showErrorToast(displayMessage || 'Failed to send message')

        // Don't remove the user message — the backend already saved it.
        // Re-fetch the chat to replace the temp message with the real one.
        resetStreamingContent()
        setStreaming(false)
        setWaitingForResponse(false)
        setRespondingParticipantId(null)
        setResponseStatus(null)
        await fetchChat()
      }
    } finally {
      setSending(false)
      setWaitingForResponse(false)
      abortControllerRef.current = null
      setResponseStatus(null)
      focusInput()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onToolResultCallback is a stable page-level callback
  }, [chatId, sending, isPaused, chat, respondingParticipantId, setMessages, scrollOnUserMessage, scrollOnStreamComplete, fetchChat, setAttachedFiles, setRespondingParticipantId, getFirstCharacterParticipant, readSSEStream, extractErrorMessage, focusInput, resetStreamingContent, trackToolsDetected, trackToolResult, applyConfirmationResult, clearPendingToolExecutionStatus])

  /**
   * Trigger continue mode - request AI to generate a response from a specific participant.
   */
  const triggerContinueMode = useCallback(async (participantId: string, nudge = false) => {
    if (streaming || waitingForResponse) return
    if (isPaused) return

    const participant = participantsAsBase.find(p => p.id === participantId && p.isActive)
    if (!participant) {
      showErrorToast('This participant is no longer available in the chat.')
      return
    }

    if (!hasActiveCharacters) {
      showErrorToast('No characters available. Add a character to continue the conversation.')
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    setWaitingForResponse(true)
    setStreaming(false)
    resetStreamingContent()
    setStreamingToolBatches([])
    // Track the current responding participant across chained turns (mutable for closures)
    let currentParticipantId = participantId
    setRespondingParticipantId(participantId)

    try {
      abortControllerRef.current = new AbortController()
      const { signal } = abortControllerRef.current

      const res = await fetch(`/api/v1/messages?chatId=${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          continueMode: true,
          respondingParticipantId: participantId,
          speakingAsParticipantId: activeTypingParticipantIdRef.current ?? undefined,
          // Nudge (explicit summon) withholds the "nothing to add" skip option;
          // the algorithm-picked Continue button leaves it undefined so skip is offered.
          nudge: nudge || undefined,
        }),
        signal,
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to trigger response')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      await readSSEStream(reader, {
        participantId,
        onToolsDetected: trackToolsDetected,
        onToolResult: trackToolResult,
        onCarinaAnswer: (msg) => {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          scrollOnStreamComplete()
        },
        onHostAnnouncement: (msg) => {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          scrollOnStreamComplete()
        },
        onPascalResult: (msg) => {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          scrollOnStreamComplete()
        },
        onConfirmationResult: applyConfirmationResult,
        onDone: (fullContent, data) => {
          setResponseStatus(null)
          clearPendingToolExecutionStatus()

          // "Nothing to add" turn-pass: Host note surfaced via onHostAnnouncement;
          // reset streaming without appending a bubble or toasting.
          if (data.skipped) {
            resetStreamingContent()
            setStreaming(false)
            return
          }

          if (fullContent.trim()) {
            // Use server-provided participantId if available (authoritative)
            const resolvedParticipantId = data.participantId || currentParticipantId

            const newMessage: Message = {
              id: data.messageId || `continue-${Date.now()}`,
              role: 'ASSISTANT',
              content: fullContent,
              createdAt: new Date().toISOString(),
              participantId: resolvedParticipantId,
              provider: data.provider || null,
              modelName: data.modelName || null,
              isSilentMessage: data.isSilentMessage || undefined,
              reasoningContent: data.reasoningContent ?? null,
              reasoningSegments: data.reasoningSegments ?? null,
            }
            setMessages(prev => [...prev, newMessage])
          }
        },
        onIntermediateDone: async (fullContent, data) => {
          // Intermediate done during a chain — add temp message but don't reset state
          // "Nothing to add" turn-pass: Host note surfaced via onHostAnnouncement;
          // reset streaming without appending a bubble.
          if (data.skipped) {
            resetStreamingContent()
            setStreaming(false)
            return
          }
          if (!fullContent.trim()) return

          // Use server-provided participantId if available (authoritative)
          const resolvedParticipantId = data.participantId || currentParticipantId

          const newMessage: Message = {
            id: data.messageId || `continue-chain-${Date.now()}`,
            role: 'ASSISTANT',
            content: fullContent,
            createdAt: new Date().toISOString(),
            participantId: resolvedParticipantId,
            provider: data.provider || null,
            modelName: data.modelName || null,
            reasoningContent: data.reasoningContent ?? null,
            reasoningSegments: data.reasoningSegments ?? null,
          }
          setMessages(prev => [...prev, newMessage])
        },
        onTurnStart: (event) => {
          currentParticipantId = event.participantId
          setRespondingParticipantId(event.participantId)
          resetStreamingContent()
          setStreamingToolBatches([])
          setWaitingForResponse(true)
          setStreaming(false)
        },
        onTurnComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          await fetchChat()
        },
        onChainComplete: async (event) => {
          resetStreamingContent()
          setStreaming(false)
          setWaitingForResponse(false)
          setRespondingParticipantId(null)
          scrollOnStreamComplete()
          await fetchChat()
          notifyQueueChange()
          focusInput()
        },
      })
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (!isAbort) {
        const errorMessage = extractErrorMessage(err)
        showErrorToast(errorMessage)
      }
    } finally {
      setStreaming(false)
      setWaitingForResponse(false)
      resetStreamingContent()
      setRespondingParticipantId(null)
      setResponseStatus(null)
      abortControllerRef.current = null
      scrollOnStreamComplete()
      // Re-fetch chat to pick up side-channel messages (e.g. whisper tool writes)
      await fetchChat()
      notifyQueueChange()
      focusInput()
    }
  }, [chatId, streaming, waitingForResponse, isPaused, participantsAsBase, hasActiveCharacters, setMessages, scrollOnStreamComplete, setRespondingParticipantId, readSSEStream, extractErrorMessage, focusInput, fetchChat, resetStreamingContent, trackToolsDetected, trackToolResult, applyConfirmationResult, clearPendingToolExecutionStatus])

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStreaming(false)
    setWaitingForResponse(false)
    setSending(false)
    setRespondingParticipantId(null)
    setStreamingToolBatches([])
    dismissToolExecutionStatus()
    if (isMultiChar) {
      setPauseState(true)
    }
    if (streamingContent) {
      showInfoToast('Response stopped - chat paused')
    }
    resetStreamingContent()
  }, [streamingContent, isMultiChar, setPauseState, setRespondingParticipantId, resetStreamingContent, dismissToolExecutionStatus])

  return {
    sending,
    streaming,
    streamingContent,
    streamingReasoning,
    waitingForResponse,
    streamingToolBatches,
    toolExecutionStatus,
    dismissToolExecutionStatus,
    responseStatus,
    abortControllerRef,
    sendMessage,
    triggerContinueMode,
    stopStreaming,
  }
}
