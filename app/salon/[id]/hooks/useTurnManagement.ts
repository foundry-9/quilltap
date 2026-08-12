'use client'

import { useCallback, useMemo } from 'react'
import { showErrorToast, showInfoToast } from '@/lib/toast'
import type {
  TurnState,
  TurnSelectionResult,
} from '@/lib/chat/turn-manager'
import {
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { ParticipantData } from '@/components/chat/ParticipantCard'

export interface TurnManagementActions {
  handleNudge: (participantId: string) => void | Promise<void>
  handleQueue: (participantId: string) => void | Promise<void>
  handleDequeue: (participantId: string) => void | Promise<void>
  handleContinue: () => void | Promise<void>
  handleSkipUserTurn: (participantId: string) => void | Promise<void>
}

/**
 * Server response from the turn action API
 */
interface TurnActionResponse {
  success: boolean
  action: string
  turn: {
    nextSpeakerId: string | null
    nextSpeakerName: string | null
    nextSpeakerControlledBy: string | null
    reason: string
    explanation: string
    cycleComplete: boolean
    isUsersTurn: boolean
  }
  state: {
    queue: string[]
  }
  participant?: {
    id: string
    name: string
    queuePosition: number
  }
}

/**
 * Call the backend turn action API to persist state changes
 */
async function callTurnAction(
  chatId: string,
  action: 'nudge' | 'queue' | 'dequeue' | 'query' | 'skipUserTurn',
  participantId?: string,
): Promise<TurnActionResponse | null> {
  try {
    const body: Record<string, string> = { action }
    if (participantId) {
      body.participantId = participantId
    }

    const res = await fetch(`/api/v1/chats/${chatId}?action=turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(errorData.error || `Turn action failed (${res.status})`)
    }

    return await res.json()
  } catch (error) {
    console.error('[TurnManagement] API call failed', { action, participantId, error })
    return null
  }
}

/**
 * Update local turn state from server response
 */
function applyServerResponse(
  response: TurnActionResponse,
  setTurnState: (state: TurnState) => void,
  setTurnSelectionResult: (result: TurnSelectionResult | null) => void,
  currentTurnState: TurnState,
) {
  // Update queue from server's authoritative state
  setTurnState({
    ...currentTurnState,
    queue: response.state.queue,
  })

  // Update selection result from server
  setTurnSelectionResult({
    nextSpeakerId: response.turn.nextSpeakerId,
    reason: response.turn.reason as TurnSelectionResult['reason'],
    cycleComplete: response.turn.cycleComplete,
  })
}

export function useTurnManagement(
  chatId: string,
  participantsAsBase: ChatParticipantBase[],
  charactersMap: Map<string, Character>,
  turnState: TurnState,
  userParticipantId: string | null,
  participantData: ParticipantData[],
  setTurnState: (state: TurnState) => void,
  setTurnSelectionResult: (result: TurnSelectionResult | null) => void,
  triggerContinueMode: (participantId: string, nudge?: boolean) => Promise<void>,
  isPaused?: boolean,
  onUnpause?: () => Promise<void>,
) {
  const hasActiveCharacters = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive && p.controlledBy !== 'user').length > 0
  }, [participantsAsBase])

  const handleNudge = useCallback(async (participantId: string) => {
    // Find participant to validate it's LLM-controlled
    const participantBase = participantsAsBase.find(p => p.id === participantId)

    // Safety check: Only LLM-controlled characters can be nudged for AI response
    if (participantBase?.controlledBy === 'user') {
      showErrorToast('User-controlled characters cannot be nudged for AI response. Use Queue instead.')
      return
    }

    // If chat is paused, unpause it first
    if (isPaused && onUnpause) {
      await onUnpause()
    }

    // The Host announces the summon as a persisted message once the request
    // reaches the server (see postHostNudgeAnnouncement in the orchestrator),
    // surfaced live over SSE — no client-only ephemeral note.

    // Optimistic local update for immediate UI feedback
    const newTurnState = nudgeParticipant(turnState, participantId)
    setTurnState(newTurnState)

    // Trigger immediate response generation directly — do NOT also add to
    // the turn queue via callTurnAction('nudge'), because triggerContinueMode
    // already requests a response for this participant.  Adding them to the
    // queue as well causes the server-side chain loop to pop the queue entry
    // and generate a second (duplicate) response.
    // Nudge is an explicit summon → withhold the "nothing to add" skip option.
    triggerContinueMode(participantId, true)
  }, [turnState, participantsAsBase, setTurnState, triggerContinueMode, isPaused, onUnpause])

  const handleQueue = useCallback(async (participantId: string) => {
    // Optimistic local update for immediate UI feedback
    const newTurnState = addToQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Persist to backend and get authoritative state
    const response = await callTurnAction(chatId, 'queue', participantId)
    if (response) {
      applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)
    }
  }, [chatId, turnState, setTurnState, setTurnSelectionResult])

  const handleDequeue = useCallback(async (participantId: string) => {
    // Optimistic local update for immediate UI feedback
    const newTurnState = removeFromQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Persist to backend and get authoritative state
    const response = await callTurnAction(chatId, 'dequeue', participantId)
    if (response) {
      applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)
    }
  }, [chatId, turnState, setTurnState, setTurnSelectionResult])

  const handleContinue = useCallback(async () => {
    // Edge case: No active characters
    if (!hasActiveCharacters) {
      showErrorToast('No characters available. Add a character to continue.')
      return
    }

    // Query the server for the authoritative next speaker
    const response = await callTurnAction(chatId, 'query')

    if (!response) {
      showErrorToast('Failed to determine next speaker. Please try again.')
      return
    }

    applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)

    const { nextSpeakerId, nextSpeakerControlledBy } = response.turn

    if (nextSpeakerId && nextSpeakerId !== userParticipantId) {
      if (nextSpeakerControlledBy === 'user') {
        return
      }
      triggerContinueMode(nextSpeakerId)
    } else {
      showInfoToast('No characters available to speak. Try adding or activating a character.')
    }
  }, [chatId, hasActiveCharacters, userParticipantId, turnState, setTurnState, setTurnSelectionResult, triggerContinueMode])

  const handleSkipUserTurn = useCallback(async (participantId: string) => {
    const participant = participantsAsBase.find(p => p.id === participantId)
    if (participant?.controlledBy !== 'user') {
      showErrorToast('Only user-controlled characters can be skipped.')
      return
    }

    const response = await callTurnAction(chatId, 'skipUserTurn', participantId)
    if (!response) {
      showErrorToast('Failed to skip turn. Please try again.')
      return
    }

    applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)

    const { nextSpeakerId, nextSpeakerControlledBy } = response.turn
    if (nextSpeakerId && nextSpeakerControlledBy !== 'user') {
      triggerContinueMode(nextSpeakerId)
    }
  }, [chatId, participantsAsBase, turnState, setTurnState, setTurnSelectionResult, triggerContinueMode])

  return {
    handleNudge,
    handleQueue,
    handleDequeue,
    handleContinue,
    handleSkipUserTurn,
    hasActiveCharacters,
  }
}
