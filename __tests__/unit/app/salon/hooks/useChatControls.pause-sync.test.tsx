/**
 * Regression coverage for bug 123 — the Salon's pause flag drifted from the
 * server's and could never catch up.
 *
 * The sync effect keyed on a *transition* of the fetched `chat.isPaused`, and
 * the Resume button flipped local state without touching the fetched object.
 * So: server pauses (fetched true, local true) → user presses Resume (local
 * false, fetched still true) → server pauses again → refetch says true → no
 * transition → local stays false. The sidebar read "Pause" while every message
 * drew exactly one reply.
 */

import React from 'react'
import { renderHook, act } from '@testing-library/react'

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
}))
jest.mock('@/lib/query/fetcher', () => ({
  apiFetch: jest.fn(),
  ApiFetchError: class ApiFetchError extends Error {},
}))
jest.mock('@/lib/query/keys', () => ({
  queryKeys: { connectionProfiles: { all: ['connection-profiles'] } },
}))
jest.mock('@/lib/chat/patch-chat', () => ({
  patchChat: jest.fn().mockResolvedValue({}),
}))
jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn() }))
jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
}))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

import { useChatControls } from '@/app/salon/[id]/hooks/useChatControls'
import { patchChat } from '@/lib/chat/patch-chat'
import type { Chat } from '@/app/salon/[id]/types'

const mockPatchChat = patchChat as jest.MockedFunction<typeof patchChat>

function makeChat(isPaused: boolean): Chat {
  // Each call is a fresh object, exactly as each fetchChat() produces one.
  return { id: 'chat-1', title: 'Test', participants: [], isPaused } as unknown as Chat
}

describe('useChatControls — pause sync (bug 123)', () => {
  let setIsPaused: jest.Mock
  let setChat: jest.Mock

  function render(chat: Chat | null, isPaused: boolean) {
    return renderHook(
      ({ chat, isPaused }: { chat: Chat | null; isPaused: boolean }) =>
        useChatControls({
          chatId: 'chat-1',
          chat,
          participantData: [],
          participantsAsBase: [],
          isMultiChar: true,
          isAllLLM: false,
          allLLMTurnCount: 0,
          effectiveNextSpeakerId: null,
          userParticipantId: 'user-seat',
          turnState: { spokenSinceUserTurn: [], currentTurnParticipantId: null, queue: [], lastSpeakerId: null },
          streamingRef: React.createRef<boolean>() as unknown as React.MutableRefObject<boolean>,
          isPaused,
          setIsPaused,
          fetchChat: jest.fn().mockResolvedValue(undefined),
          setTurnState: jest.fn(),
          triggerContinueModeRef: { current: jest.fn() },
          setChat,
          startBackgroundPolling: jest.fn(),
        }),
      { initialProps: { chat, isPaused } },
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    setIsPaused = jest.fn()
    setChat = jest.fn()
  })

  it('re-syncs from a fetch whose paused value did not change (the drift)', () => {
    const { rerender } = render(makeChat(true), false)
    expect(setIsPaused).toHaveBeenLastCalledWith(true)

    // The user presses Resume: local false, persisted — the fetched object is
    // NOT refreshed by this. (Simulated by the parent passing isPaused=false.)
    setIsPaused.mockClear()
    rerender({ chat: makeChat(true), isPaused: false })

    // A later fetch returns paused again — same value as before. Before the fix
    // this was a no-op and the client stayed "not paused" forever.
    expect(setIsPaused).toHaveBeenCalledWith(true)
  })

  it('writes the new pause value into the fetched chat object as well as persisting it', async () => {
    const { result } = render(makeChat(true), true)

    await act(async () => {
      await result.current.setPauseState(false)
    })

    expect(setIsPaused).toHaveBeenLastCalledWith(false)
    expect(mockPatchChat).toHaveBeenCalledWith('chat-1', { isPaused: false })
    expect(setChat).toHaveBeenCalledTimes(1)
    const updater = setChat.mock.calls[0][0] as (prev: Chat | null) => Chat | null
    expect(updater(makeChat(true))).toEqual(expect.objectContaining({ isPaused: false }))
    expect(updater(null)).toBeNull()
  })

  it('leaves the flag alone when the chat has not loaded', () => {
    render(null, false)
    expect(setIsPaused).not.toHaveBeenCalled()
  })
})
