'use client'

import { useState, useEffect, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { Chat } from '../types'
import type { SelectLLMProfileDialogState } from './useModalState'

interface UseImpersonationParams {
  chatId: string
  chat: Chat | null
  participantData: ParticipantData[]
  fetchChat: () => Promise<void>
  setSelectLLMProfileDialogState: (state: SelectLLMProfileDialogState | null) => void
}

export function useImpersonation({
  chatId,
  chat,
  participantData,
  fetchChat,
  setSelectLLMProfileDialogState,
}: UseImpersonationParams) {
  const [impersonatingParticipantIds, setImpersonatingParticipantIds] = useState<string[]>([])
  const [activeTypingParticipantId, setActiveTypingParticipantId] = useState<string | null>(null)
  const [allLLMPauseTurnCount, setAllLLMPauseTurnCount] = useState(0)

  // Initialize/sync impersonation state from chat metadata
  useEffect(() => {
    const impersonatingIds = chat?.impersonatingParticipantIds
    const activeTypingId = chat?.activeTypingParticipantId
    const pauseTurnCount = chat?.allLLMPauseTurnCount

    if (impersonatingIds && impersonatingIds.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- user state must re-sync when chat prop changes (parent renders unconditionally)
      setImpersonatingParticipantIds(impersonatingIds)
      // The persisted `activeTypingParticipantId` is only the INITIAL default for
      // "speaking as". It must not be re-applied on every chat refetch, or it
      // clobbers the turn-follow (Bug 49) and any manual SpeakerSelector choice —
      // the composer would snap back to the stale persisted seat after each turn,
      // so one seat "hogs" every turn. Seed it once (when still unset); the
      // turn-follow and the set-active-speaker handler own it thereafter.
      setActiveTypingParticipantId(prev => prev ?? activeTypingId ?? null)
    }
    if (pauseTurnCount !== undefined) {
      setAllLLMPauseTurnCount(pauseTurnCount)
    }
  }, [chat?.impersonatingParticipantIds, chat?.activeTypingParticipantId, chat?.allLLMPauseTurnCount])

  const handleStartImpersonation = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to start impersonation')
      }

      const data = await res.json()

      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || participantId)

      showSuccessToast(`Now speaking as ${characterName}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to start impersonation')
    }
  }, [chatId, participantData])

  const handleStopImpersonation = useCallback(async (participantId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    // Check if we need to show the LLM profile selection dialog
    const character = participant?.character
    if (character && !participant?.connectionProfile) {
      setSelectLLMProfileDialogState({
        isOpen: true,
        participantId,
        character: {
          id: character.id,
          name: character.name,
          defaultImage: character.defaultImage,
          avatarUrl: character.avatarUrl,
          defaultConnectionProfileId: null,
        },
      })
      return
    }

    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=stop-impersonate`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to stop impersonation')
      }

      const data = await res.json()

      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || null)

      showSuccessToast(`Stopped speaking as ${characterName}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to stop impersonation')
    }
  }, [chatId, participantData, setSelectLLMProfileDialogState])

  const handleConfirmStopImpersonation = useCallback(async (participantId: string, connectionProfileId: string) => {
    const participant = participantData.find(p => p.id === participantId)
    const characterName = participant?.character?.name || 'Character'

    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=stop-impersonate`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, newConnectionProfileId: connectionProfileId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to stop impersonation')
      }

      const data = await res.json()

      setImpersonatingParticipantIds(data.impersonatingParticipantIds || [])
      setActiveTypingParticipantId(data.activeTypingParticipantId || null)

      showSuccessToast(`${characterName} is now controlled by AI`)

      await fetchChat()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to assign LLM profile')
    }
  }, [chatId, participantData, fetchChat])

  const handleSetActiveSpeaker = useCallback(async (participantId: string) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=set-active-speaker`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to set active speaker')
      }

      const data = await res.json()
      setActiveTypingParticipantId(participantId)

      if (data.impersonatingParticipantIds) {
        setImpersonatingParticipantIds(data.impersonatingParticipantIds)
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to set active speaker')
    }
  }, [chatId])

  return {
    impersonatingParticipantIds,
    setImpersonatingParticipantIds,
    activeTypingParticipantId,
    setActiveTypingParticipantId,
    allLLMPauseTurnCount,
    setAllLLMPauseTurnCount,
    handleStartImpersonation,
    handleStopImpersonation,
    handleConfirmStopImpersonation,
    handleSetActiveSpeaker,
  }
}
