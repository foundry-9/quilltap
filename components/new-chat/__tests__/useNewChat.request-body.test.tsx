/**
 * useNewChat — what the create request actually carries.
 *
 * The New Chat form gained a Concierge picker whose default (Monitored) is
 * deliberately *omitted* from `POST /api/v1/chats`, so a plain create stays
 * byte-identical to what it has always been. This suite pins that: absent on
 * Monitored, present verbatim on the other three.
 *
 * `jest.setup.ts` leaves `global.fetch` as a bare stub with no `ok`, so this
 * suite installs its own reference-data responder.
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factories hoist.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useNewChat } from '../hooks/useNewChat'
import type { SelectedCharacter } from '../types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

// --- Stub the ambient app shell the hook reaches for ----------------------

const navigate = jest.fn()
jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({
  useWorkspaceNavigate: () => navigate,
}))

jest.mock('@/components/providers/creation-progress-provider', () => ({
  useCreationProgress: () => null,
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

// --- Fixtures --------------------------------------------------------------

const CHAR_ID = 'char-alice'
const PROFILE_ID = 'profile-1'
const NEW_CHAT_ID = 'chat-new'

const ALICE: SelectedCharacter = {
  character: { id: CHAR_ID, name: 'Alice' },
  connectionProfileId: PROFILE_ID,
  controlledBy: 'llm',
}

/**
 * Answer every reference-data GET with an empty-but-valid payload, and the one
 * create POST with a chat id. Every list the hook reads is keyed off a
 * different property name, so one object satisfies them all.
 */
function installFetchStub(): jest.Mock {
  const stub = jest.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: init?.method === 'POST' ? 201 : 200,
    json: async () => ({
      chat: { id: NEW_CHAT_ID },
      characters: [],
      profiles: [],
      projects: [],
      scenarios: [],
      templates: [],
    }),
  }))
  global.fetch = stub as unknown as typeof fetch
  return stub
}

let fetchStub: jest.Mock

/** The body of the one POST /api/v1/chats the hook sent. */
function createdBody(): Record<string, unknown> {
  const call = fetchStub.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST'
  )
  expect(call).toBeDefined()
  return JSON.parse((call![1] as RequestInit).body as string)
}

async function createWith(conciergeState: ConciergeState) {
  const { result } = renderHook(() => useNewChat())
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.setSelectedCharacters([ALICE])
    result.current.setState((prev) => ({ ...prev, conciergeState }))
  })

  await act(async () => {
    await result.current.handleCreateChat()
  })

  return createdBody()
}

// --- Tests -----------------------------------------------------------------

describe('useNewChat create request — Concierge state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    fetchStub = installFetchStub()
  })

  it('defaults to Monitored on the form', async () => {
    const { result } = renderHook(() => useNewChat())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.conciergeState).toBe('monitored')
  })

  it('omits conciergeState entirely when Monitored', async () => {
    const body = await createWith('monitored')
    expect(body).not.toHaveProperty('conciergeState')
    // The rest of the request is unchanged — the participant still rides along.
    expect(body.participants).toHaveLength(1)
  })

  it.each(['flagged', 'vouched', 'uncensored'] as const)(
    'sends conciergeState verbatim when %s',
    async (state) => {
      const body = await createWith(state)
      expect(body.conciergeState).toBe(state)
    }
  )
})
