'use client'

import { useCallback, useRef } from 'react'
import type { Message, Participant } from '../types'

export interface PendingToolCall {
  id: string
  name: string
  status: 'pending' | 'success' | 'error'
  result?: unknown
  arguments?: Record<string, unknown>
}

export interface ToolExecutionStatus {
  tool: string
  status: 'pending' | 'success' | 'error'
  message: string
}

export interface StreamingState {
  sending: boolean
  streaming: boolean
  streamingContent: string
  waitingForResponse: boolean
  respondingParticipantId: string | null
  pendingToolCalls: PendingToolCall[]
  toolExecutionStatus: ToolExecutionStatus | null
}

interface StreamingHookParams {
  chatId: string
  messages: Message[]
  participantsAsBase: { id: string; type: 'CHARACTER'; isActive: boolean }[]
  chat: { participants: Participant[] } | null
  isMultiChar: boolean
  scrollToBottom: () => void
  fetchChat: () => Promise<void>
  debug?: { isDebugMode: boolean; addEntry: (arg: any) => string; updateEntry: (id: string, arg: any) => void; appendToEntry: (id: string, text: string) => void; finalizeStreamingEntry: (id: string) => void }
  setSending: (value: boolean) => void
  setStreaming: (value: boolean) => void
  setStreamingContent: (value: string) => void
  setWaitingForResponse: (value: boolean) => void
  setRespondingParticipantId: (value: string | null) => void
  setPendingToolCalls: (value: PendingToolCall[] | ((prev: PendingToolCall[]) => PendingToolCall[])) => void
  setToolExecutionStatus: (value: ToolExecutionStatus | null) => void
  setMessages: (value: Message[] | ((prev: Message[]) => Message[])) => void
}

export function useMessageStreaming({
  chatId,
  messages,
  participantsAsBase,
  chat,
  isMultiChar,
  scrollToBottom,
  fetchChat,
  debug,
  setSending,
  setStreaming,
  setStreamingContent,
  setWaitingForResponse,
  setRespondingParticipantId,
  setPendingToolCalls,
  setToolExecutionStatus,
  setMessages,
}: StreamingHookParams) {
  const abortControllerRef = useRef<AbortController | null>(null)
  const userStoppedStreamRef = useRef<boolean>(false)

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    // Reset streaming state
    setStreaming(false)
    setWaitingForResponse(false)
    setSending(false)
    setRespondingParticipantId(null)
    setPendingToolCalls([])
    setToolExecutionStatus(null)
    // In multi-character chats, set flag to prevent auto-triggering
    if (isMultiChar) {
      userStoppedStreamRef.current = true
    }
    setStreamingContent('')
  }, [isMultiChar, setSending, setStreaming, setStreamingContent, setWaitingForResponse, setRespondingParticipantId, setPendingToolCalls, setToolExecutionStatus])

  const triggerContinueMode = useCallback(async (participantId: string, _nudge = false) => {
    // This is a placeholder - the actual implementation is in page.tsx
    // because it needs access to many page-level dependencies
  }, [])

  return {
    abortControllerRef,
    userStoppedStreamRef,
    stopStreaming,
    triggerContinueMode,
  }
}
