'use client'

import { useMemo, useCallback } from 'react'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import {
  findUserParticipant,
  isMultiCharacterChat,
  isAllLLMChat,
  selectNextSpeaker,
} from '@/lib/chat/turn-manager'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'
import type { Chat, Participant, CharacterData, Message } from '../types'

interface UseParticipantsParams {
  chat: Chat | null
  messages: Message[]
  impersonatingParticipantIds: string[]
  turnState: TurnState
  turnSelectionResult: TurnSelectionResult | null
}

export function useParticipants({
  chat,
  messages,
  impersonatingParticipantIds,
  turnState,
  turnSelectionResult,
}: UseParticipantsParams) {
  // Extract participants once to satisfy React Compiler's dependency inference
  const chatParticipants = chat?.participants ?? null

  // Convert participants to the base type used by turn-manager
  const participantsAsBase = useMemo((): ChatParticipantBase[] => {
    if (!chatParticipants) return []
    return chatParticipants
      .filter(p => p.type === 'CHARACTER' && (p.characterId || p.character?.id))
      .map(p => {
        const characterId = p.characterId || p.character?.id
        return {
          id: p.id,
          type: 'CHARACTER' as const,
          characterId: characterId!,
          controlledBy: p.controlledBy ?? 'llm',
          connectionProfileId: p.connectionProfile?.id ?? null,
          imageProfileId: p.imageProfile?.id ?? null,
          displayOrder: p.displayOrder,
          isActive: p.isActive,
          status: (p.status as 'active' | 'silent' | 'absent' | 'removed') || (p.isActive ? 'active' : (p.removedAt ? 'removed' : 'absent')),
          hasHistoryAccess: p.hasHistoryAccess ?? false,
          joinScenario: p.joinScenario ?? null,
          talkativeness: p.talkativeness ?? null,
          createdAt: p.createdAt ?? new Date().toISOString(),
          updatedAt: p.updatedAt ?? new Date().toISOString(),
        }
      })
  }, [chatParticipants])

  const userParticipantId = useMemo(() => {
    if (participantsAsBase.length === 0) return null
    const userParticipant = findUserParticipant(participantsAsBase)
    return userParticipant?.id ?? null
  }, [participantsAsBase])

  const isMultiChar = useMemo(() => {
    if (participantsAsBase.length === 0) return false
    return isMultiCharacterChat(participantsAsBase)
  }, [participantsAsBase])

  const hasActiveCharacters = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length > 0
  }, [participantsAsBase])

  const isSingleCharacterChat = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length === 1
  }, [participantsAsBase])

  // Get non-user-controlled characters for header display
  const llmCharacters = useMemo(() => {
    if (!chatParticipants) return []
    return chatParticipants
      .filter(p => p.type === 'CHARACTER' && p.controlledBy === 'llm' && p.character)
      .map(p => p.character!)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [chatParticipants])

  const charactersMap = useMemo((): Map<string, Character> => {
    const map = new Map<string, Character>()
    if (!chatParticipants) return map
    chatParticipants.forEach(p => {
      if (p.type === 'CHARACTER' && p.character) {
        map.set(p.character.id, {
          id: p.character.id,
          userId: '',
          name: p.character.name,
          talkativeness: p.character.talkativeness ?? 0.5,
          isFavorite: false,
          createdAt: '',
          updatedAt: '',
        } as Character)
      }
    })
    return map
  }, [chatParticipants])

  const participantData: ParticipantData[] = useMemo(() => {
    if (!chatParticipants) return []
    return chatParticipants.map(p => {
      // The per-chat override wins; fall back to the character's value, then 0.5.
      // We surface the resolved value as `character.talkativeness` so existing
      // consumers (sidebar ordering, slider initial value) Just Work without
      // having to know about the override field.
      const resolvedTalkativeness = p.talkativeness ?? p.character?.talkativeness ?? 0.5
      return {
        id: p.id,
        type: p.type,
        controlledBy: p.controlledBy ?? 'llm',
        displayOrder: p.displayOrder,
        isActive: p.isActive,
        status: (p.status as 'active' | 'silent' | 'absent' | 'removed') || (p.isActive ? 'active' : 'absent'),
        character: p.character ? {
          id: p.character.id,
          name: p.character.name,
          title: p.character.title,
          avatarUrl: p.character.avatarUrl,
          talkativeness: resolvedTalkativeness,
          defaultImage: p.character.defaultImage,
          systemPrompts: p.character.systemPrompts,
          // Bug 66: this projection is rebuilt field by field, so the archive
          // tombstone has to be carried explicitly or the sidebar's Archived
          // badge can never light, however well the payload carries it.
          archivedAt: p.character.archivedAt ?? null,
        } : null,
        // User-controlled characters use the same .character field as LLM characters
        connectionProfile: p.connectionProfile,
        selectedSystemPromptId: p.selectedSystemPromptId ?? null,
      }
    })
  }, [chatParticipants])

  // Characters the user can speak as (for SpeakerSelector)
  const controlledCharacters = useMemo(() => {
    const result: Array<{
      participantId: string
      characterId: string
      name: string
      character: {
        defaultImage?: { id: string; filepath: string; url?: string } | null
        avatarUrl?: string | null
      } | null
    }> = []

    for (const p of participantData) {
      const isUserControlled = p.controlledBy === 'user'
      const isImpersonating = impersonatingParticipantIds.includes(p.id)
      if ((isUserControlled || isImpersonating) && p.isActive) {
        const entity = p.character
        if (entity) {
          result.push({
            participantId: p.id,
            characterId: entity.id,
            name: entity.name,
            character: {
              defaultImage: entity.defaultImage,
              avatarUrl: entity.avatarUrl,
            },
          })
        }
      }
    }

    return result
  }, [participantData, impersonatingParticipantIds])

  // LLM participants for AllLLMPauseModal
  const llmParticipants = useMemo(() => {
    return participantData
      .filter(p => p.type === 'CHARACTER' && p.isActive && p.controlledBy !== 'user' && !impersonatingParticipantIds.includes(p.id))
      .map(p => ({
        id: p.id,
        characterId: p.character?.id || '',
        characterName: p.character?.name || 'Unknown',
        character: p.character ? {
          defaultImage: p.character.defaultImage,
          avatarUrl: p.character.avatarUrl,
        } : null,
      }))
  }, [participantData, impersonatingParticipantIds])

  // Check if this is an all-LLM chat (no user-controlled participants AND no user messages)
  // A chat with USER messages has a human present even without a controlledBy='user' participant
  const isAllLLM = useMemo(() => {
    if (!isAllLLMChat(participantsAsBase)) return false
    return !messages.some(m => m.role === 'USER')
  }, [participantsAsBase, messages])

  // Count turns since last user message (for all-LLM pause logic)
  const allLLMTurnCount = useMemo(() => {
    if (!isAllLLM) return 0
    let count = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'USER') break
      if (messages[i].role === 'ASSISTANT') count++
    }
    return count
  }, [isAllLLM, messages])

  // Compute effective next speaker for all-LLM chats
  const effectiveNextSpeakerId = useMemo(() => {
    if (!turnSelectionResult) return null
    if (turnSelectionResult.nextSpeakerId !== null) {
      return turnSelectionResult.nextSpeakerId
    }
    if (isAllLLM && participantsAsBase.length > 0 && charactersMap.size > 0) {
      const freshResult = selectNextSpeaker(participantsAsBase, charactersMap, turnState, userParticipantId)
      return freshResult.nextSpeakerId
    }
    return null
  }, [turnSelectionResult, isAllLLM, participantsAsBase, charactersMap, turnState, userParticipantId])

  const getParticipantById = useCallback((participantId: string | null | undefined) => {
    if (!participantId || !chatParticipants) return null
    return chatParticipants.find(p => p.id === participantId) ?? null
  }, [chatParticipants])

  // Helper functions to get character from participants
  const getFirstCharacterParticipant = useCallback(() => {
    return chatParticipants?.find(p => p.type === 'CHARACTER' && p.isActive)
  }, [chatParticipants])

  const getFirstUserCharacterParticipant = useCallback(() => {
    return chatParticipants?.find(p => p.controlledBy === 'user' && p.isActive)
  }, [chatParticipants])

  const getFirstCharacter = useCallback(() => getFirstCharacterParticipant()?.character, [getFirstCharacterParticipant])
  const getFirstUserCharacter = useCallback(() => getFirstUserCharacterParticipant()?.character, [getFirstUserCharacterParticipant])
  const getFirstConnectionProfile = useCallback(() => getFirstCharacterParticipant()?.connectionProfile, [getFirstCharacterParticipant])

  return {
    participantsAsBase,
    userParticipantId,
    isMultiChar,
    hasActiveCharacters,
    isSingleCharacterChat,
    llmCharacters,
    charactersMap,
    participantData,
    controlledCharacters,
    llmParticipants,
    isAllLLM,
    allLLMTurnCount,
    effectiveNextSpeakerId,
    getParticipantById,
    getFirstCharacterParticipant,
    getFirstUserCharacterParticipant,
    getFirstCharacter,
    getFirstUserCharacter,
    getFirstConnectionProfile,
  }
}
