/**
 * Unit tests for useTurnManagement hook
 *
 * Tests the turn management actions used in multi-character chat sessions:
 * - handleNudge: Nudge a participant to speak immediately
 * - handleQueue: Add participant to turn queue
 * - handleDequeue: Remove participant from turn queue
 * - handleContinue: Pass turn to next character
 */

import { renderHook, act } from '@testing-library/react'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { ParticipantData } from '@/components/chat/ParticipantCard'


jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

// Mock turn-manager module
jest.mock('@/lib/chat/turn-manager', () => ({
  nudgeParticipant: jest.fn((state: TurnState, participantId: string) => ({
    ...state,
    queue: [participantId, ...state.queue.filter((id: string) => id !== participantId)],
  })),
  addToQueue: jest.fn((state: TurnState, participantId: string) => ({
    ...state,
    queue: state.queue.includes(participantId) ? state.queue : [...state.queue, participantId],
  })),
  removeFromQueue: jest.fn((state: TurnState, participantId: string) => ({
    ...state,
    queue: state.queue.filter((id: string) => id !== participantId),
  })),
}))

// Import the hook and mocked modules after mocks are set up
import { useTurnManagement } from '@/app/salon/[id]/hooks/useTurnManagement'
import { showErrorToast, showInfoToast } from '@/lib/toast'
import {
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
} from '@/lib/chat/turn-manager'

// Get mock references
const mockShowErrorToast = showErrorToast as jest.MockedFunction<typeof showErrorToast>
const mockShowInfoToast = showInfoToast as jest.MockedFunction<typeof showInfoToast>
const mockNudgeParticipant = nudgeParticipant as jest.MockedFunction<typeof nudgeParticipant>
const mockAddToQueue = addToQueue as jest.MockedFunction<typeof addToQueue>
const mockRemoveFromQueue = removeFromQueue as jest.MockedFunction<typeof removeFromQueue>

// Mock fetch for API calls
const mockFetch = jest.fn()
global.fetch = mockFetch

const TEST_CHAT_ID = 'test-chat-id'

/**
 * Create a mock API response for the turn action endpoint
 */
function createMockTurnResponse(overrides: Partial<{
  nextSpeakerId: string | null
  nextSpeakerControlledBy: string | null
  reason: string
  cycleComplete: boolean
  queue: string[]
}> = {}) {
  const nextSpeakerId = 'nextSpeakerId' in overrides ? overrides.nextSpeakerId! : 'p1'
  return {
    success: true,
    action: 'query',
    turn: {
      nextSpeakerId,
      nextSpeakerName: nextSpeakerId ? 'Alice' : null,
      nextSpeakerControlledBy: 'nextSpeakerControlledBy' in overrides
        ? overrides.nextSpeakerControlledBy!
        : 'llm',
      reason: overrides.reason ?? 'weighted_selection',
      explanation: 'Selected by weighted random',
      cycleComplete: overrides.cycleComplete ?? false,
      isUsersTurn: nextSpeakerId === null,
    },
    state: {
      queue: overrides.queue ?? [],
    },
  }
}

// Test data factories
function createMockParticipant(
  id: string,
  type: 'CHARACTER',
  isActive: boolean = true,
  characterId?: string,
  controlledBy?: 'llm' | 'user'
): ChatParticipantBase {
  return {
    id,
    type,
    isActive,
    displayOrder: 0,
    characterId: characterId || `char-${id}`,
    personaId: undefined,
    controlledBy: controlledBy || 'llm',
  }
}

function createMockCharacter(id: string, name: string, talkativeness: number = 0.5): Character {
  return {
    id,
    name,
    talkativeness,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test-user',
    firstMessageTemplate: '',
    systemPrompts: [],
    description: '',
    personality: '',
    scenario: '',
    greetingMessage: '',
  }
}

function createMockParticipantData(
  id: string,
  type: 'CHARACTER',
  name: string,
  controlledBy?: 'llm' | 'user'
): ParticipantData {
  return {
    id,
    type,
    displayOrder: 0,
    isActive: true,
    controlledBy: controlledBy || 'llm',
    character: {
      id: `char-${id}`,
      name,
      talkativeness: 0.5,
    },
  }
}

function createMockTurnState(overrides: Partial<TurnState> = {}): TurnState {
  return {
    spokenSinceUserTurn: [],
    currentTurnParticipantId: null,
    queue: [],
    lastSpeakerId: null,
    ...overrides,
  }
}

describe('useTurnManagement', () => {
  // Mock state setters
  let setTurnState: jest.Mock
  let setTurnSelectionResult: jest.Mock
  let triggerContinueMode: jest.Mock
  let onUnpause: jest.Mock

  // Default test data
  let participantsAsBase: ChatParticipantBase[]
  let charactersMap: Map<string, Character>
  let turnState: TurnState
  let participantData: ParticipantData[]

  beforeEach(() => {
    jest.clearAllMocks()

    // Default fetch mock: return successful response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createMockTurnResponse(),
    })

    // Initialize mock functions
    setTurnState = jest.fn()
    setTurnSelectionResult = jest.fn()
    triggerContinueMode = jest.fn().mockResolvedValue(undefined)
    onUnpause = jest.fn().mockResolvedValue(undefined)

    // Initialize default test data
    participantsAsBase = [
      createMockParticipant('p1', 'CHARACTER', true, 'char-1'),
      createMockParticipant('p2', 'CHARACTER', true, 'char-2'),
      createMockParticipant('p3', 'CHARACTER', true, undefined, 'user'),
    ]

    charactersMap = new Map([
      ['char-1', createMockCharacter('char-1', 'Alice', 0.7)],
      ['char-2', createMockCharacter('char-2', 'Bob', 0.3)],
    ])

    turnState = createMockTurnState()

    participantData = [
      createMockParticipantData('p1', 'CHARACTER', 'Alice'),
      createMockParticipantData('p2', 'CHARACTER', 'Bob'),
      createMockParticipantData('p3', 'CHARACTER', 'User', 'user'),
    ]
  })

  describe('Initial state', () => {
    it('should return all action handlers', () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      expect(typeof result.current.handleNudge).toBe('function')
      expect(typeof result.current.handleQueue).toBe('function')
      expect(typeof result.current.handleDequeue).toBe('function')
      expect(typeof result.current.handleContinue).toBe('function')
    })

    it('should calculate hasActiveCharacters correctly with active characters', () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      expect(result.current.hasActiveCharacters).toBe(true)
    })

    it('should calculate hasActiveCharacters correctly with no active characters', () => {
      const noActiveChars = participantsAsBase.map((p) => ({ ...p, isActive: false }))

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          noActiveChars,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      expect(result.current.hasActiveCharacters).toBe(false)
    })

    it('should calculate hasActiveCharacters correctly with only user-controlled participants', () => {
      const onlyPersona = [createMockParticipant('p3', 'CHARACTER', true, undefined, 'user')]

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          onlyPersona,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      expect(result.current.hasActiveCharacters).toBe(false)
    })
  })

  describe('handleNudge', () => {
    it('should update turn state with nudged participant and trigger continue mode directly', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleNudge('p1')
      })

      expect(mockNudgeParticipant).toHaveBeenCalledWith(turnState, 'p1')
      expect(setTurnState).toHaveBeenCalled()
      // Nudge should NOT call the turn action API — triggerContinueMode handles
      // the immediate response directly.  Adding to the queue AND triggering
      // continueMode caused duplicate responses from the chain loop.
      // Nudge passes `true` (summoned) so the turn-skip option is withheld.
      expect(triggerContinueMode).toHaveBeenCalledWith('p1', true)
    })

    it('should not call turn action API on nudge (avoids duplicate responses)', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleNudge('p1')
      })

      // The nudge action API should NOT be called — only triggerContinueMode
      // Adding to the queue AND triggering continueMode caused the chain loop
      // to pop the queued entry and generate a second duplicate response.
      expect(mockFetch).not.toHaveBeenCalledWith(
        `/api/v1/chats/${TEST_CHAT_ID}?action=turn`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'nudge', participantId: 'p1' }),
        })
      )
      expect(triggerContinueMode).toHaveBeenCalledWith('p1', true)
    })

    it('should trigger continue mode for the nudged participant', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleNudge('p1')
      })

      expect(triggerContinueMode).toHaveBeenCalledWith('p1', true)
    })

    it('should unpause chat before nudge if paused', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode,
          true, // isPaused
          onUnpause
        )
      )

      await act(async () => {
        await result.current.handleNudge('p1')
      })

      expect(onUnpause).toHaveBeenCalled()
    })

    it('should not call onUnpause when chat is not paused', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode,
          false, // isPaused
          onUnpause
        )
      )

      await act(async () => {
        await result.current.handleNudge('p1')
      })

      expect(onUnpause).not.toHaveBeenCalled()
    })

  })

  describe('handleQueue', () => {
    it('should add participant to queue and call API', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleQueue('p1')
      })

      expect(mockAddToQueue).toHaveBeenCalledWith(turnState, 'p1')
      expect(setTurnState).toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/v1/chats/${TEST_CHAT_ID}?action=turn`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'queue', participantId: 'p1' }),
        })
      )
    })

    it('should update turn state from server response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockTurnResponse({ queue: ['p1'] }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleQueue('p1')
      })

      // Should update turn state with server's authoritative queue
      expect(setTurnState).toHaveBeenCalledWith(
        expect.objectContaining({ queue: ['p1'] })
      )
    })
  })

  describe('handleDequeue', () => {
    it('should remove participant from queue and call API', async () => {
      const stateWithQueue = createMockTurnState({ queue: ['p1', 'p2'] })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          stateWithQueue,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleDequeue('p1')
      })

      expect(mockRemoveFromQueue).toHaveBeenCalledWith(stateWithQueue, 'p1')
      expect(setTurnState).toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/v1/chats/${TEST_CHAT_ID}?action=turn`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'dequeue', participantId: 'p1' }),
        })
      )
    })
  })

  describe('handleContinue', () => {
    it('should query server for next speaker and trigger continue mode', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockTurnResponse({ nextSpeakerId: 'p1' }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3', // user participant id
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/v1/chats/${TEST_CHAT_ID}?action=turn`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'query' }),
        })
      )
      expect(triggerContinueMode).toHaveBeenCalledWith('p1')
    })

    it('should show error toast when no active characters', async () => {
      // All inactive characters
      const noActiveChars = participantsAsBase.map((p) => ({
        ...p,
        isActive: p.controlledBy === 'user', // Only user-controlled character is active
      }))

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          noActiveChars,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'No characters available. Add a character to continue.'
      )
      expect(triggerContinueMode).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should show info toast when next speaker is the user', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockTurnResponse({ nextSpeakerId: null }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      expect(mockShowInfoToast).toHaveBeenCalledWith(
        'No characters available to speak. Try adding or activating a character.'
      )
      expect(triggerContinueMode).not.toHaveBeenCalled()
    })

    it('should not auto-continue when next speaker is user-controlled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockTurnResponse({
          nextSpeakerId: 'p2',
          nextSpeakerControlledBy: 'user',
        }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      expect(mockShowInfoToast).not.toHaveBeenCalled()
      expect(triggerContinueMode).not.toHaveBeenCalled()
    })

    it('should show error toast when API call fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Failed to determine next speaker. Please try again.'
      )
      expect(triggerContinueMode).not.toHaveBeenCalled()
    })

    it('should show info toast when next speaker matches user participant id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockTurnResponse({ nextSpeakerId: 'p3' }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      expect(mockShowInfoToast).toHaveBeenCalledWith(
        'No characters available to speak. Try adding or activating a character.'
      )
      expect(triggerContinueMode).not.toHaveBeenCalled()
    })
  })

  describe('Callback stability', () => {
    it('should memoize handleQueue callback when dependencies unchanged', () => {
      const { result, rerender } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      const firstHandleQueue = result.current.handleQueue

      rerender()

      expect(result.current.handleQueue).toBe(firstHandleQueue)
    })

    it('should update handleNudge when turnState changes', () => {
      let currentTurnState = turnState

      const { result, rerender } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          currentTurnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      const firstHandleNudge = result.current.handleNudge

      // Update turn state
      currentTurnState = createMockTurnState({ queue: ['p1'] })
      rerender()

      // Callback should be updated since turnState changed
      expect(result.current.handleNudge).not.toBe(firstHandleNudge)
    })
  })

  describe('Edge cases', () => {
    it('should handle null userParticipantId', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          null, // no user participant
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleContinue()
      })

      // Should call the API with query action
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/v1/chats/${TEST_CHAT_ID}?action=turn`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'query' }),
        })
      )
    })

    it('should handle empty participants array', () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          [],
          charactersMap,
          turnState,
          null,
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      expect(result.current.hasActiveCharacters).toBe(false)
    })

    it('should handle queue with same participant multiple times', async () => {
      const stateWithDuplicates = createMockTurnState({
        queue: ['p1', 'p1'], // shouldn't happen but test defensively
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          stateWithDuplicates,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleDequeue('p1')
      })

      expect(mockRemoveFromQueue).toHaveBeenCalledWith(stateWithDuplicates, 'p1')
    })
  })

  describe('Integration scenarios', () => {
    it('should handle full nudge flow: unpause -> update state -> continue', async () => {
      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode,
          true, // isPaused
          onUnpause
        )
      )

      await act(async () => {
        await result.current.handleNudge('p1')
      })

      // Verify full flow (no API call — triggerContinueMode handles it directly)
      expect(onUnpause).toHaveBeenCalled()
      expect(mockNudgeParticipant).toHaveBeenCalledWith(turnState, 'p1')
      expect(setTurnState).toHaveBeenCalled()
      expect(triggerContinueMode).toHaveBeenCalledWith('p1', true)
    })

    it('should handle queue then dequeue sequence', async () => {
      let currentState = turnState
      setTurnState.mockImplementation((newState: TurnState) => {
        currentState = newState
      })

      mockAddToQueue.mockImplementation((state: TurnState, id: string) => ({
        ...state,
        queue: [...state.queue, id],
      }))

      const { result, rerender } = renderHook(
        ({ state }) =>
          useTurnManagement(
            TEST_CHAT_ID,
            participantsAsBase,
            charactersMap,
            state,
            'p3',
            participantData,
            setTurnState,
            setTurnSelectionResult,
            triggerContinueMode
          ),
        { initialProps: { state: turnState } }
      )

      // Queue participant
      await act(async () => {
        await result.current.handleQueue('p1')
      })

      expect(mockAddToQueue).toHaveBeenCalledWith(turnState, 'p1')

      // Update state and rerender
      rerender({ state: currentState })

      // Dequeue participant
      await act(async () => {
        await result.current.handleDequeue('p1')
      })

      expect(mockRemoveFromQueue).toHaveBeenCalled()
    })

    it('should gracefully handle API failure for queue without breaking UI', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      })

      const { result } = renderHook(() =>
        useTurnManagement(
          TEST_CHAT_ID,
          participantsAsBase,
          charactersMap,
          turnState,
          'p3',
          participantData,
          setTurnState,
          setTurnSelectionResult,
          triggerContinueMode
        )
      )

      await act(async () => {
        await result.current.handleQueue('p1')
      })

      // Optimistic update should still have happened
      expect(mockAddToQueue).toHaveBeenCalledWith(turnState, 'p1')
      expect(setTurnState).toHaveBeenCalled()
    })
  })
})
