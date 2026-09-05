/**
 * Quick-hide's one rule for a chat.
 *
 * "Dangerous Chats" used to hide on the raw `isDangerousChat` label, which was
 * wrong in both directions: a chat the operator had vouched safe still carried
 * the label underneath and still vanished, while an uncensored chat — which
 * takes every spicy route — was never hidden at all. The toggle now follows
 * the Concierge state's uncensored row: Flagged and Uncensored, nothing else.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import { QuickHideProvider, useQuickHide } from '@/components/providers/quick-hide-provider'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))

const fetchMock = global.fetch as jest.Mock

/** Reads the context and reports what it would hide, one row per chat. */
function Probe({ chats }: { chats: Array<{ id: string; characterTags?: string[]; conciergeState?: ConciergeState }> }) {
  const { shouldHideChat, hideDangerousChats, toggleHideDangerousChats } = useQuickHide()
  return (
    <div>
      <button onClick={toggleHideDangerousChats}>toggle</button>
      <span data-testid="danger-toggle">{hideDangerousChats ? 'on' : 'off'}</span>
      {chats.map(chat => (
        <span key={chat.id} data-testid={`chat-${chat.id}`}>
          {shouldHideChat(chat) ? 'hidden' : 'visible'}
        </span>
      ))}
    </div>
  )
}

const FOUR_STATES: Array<{ id: string; conciergeState: ConciergeState }> = [
  { id: 'monitored', conciergeState: 'monitored' },
  { id: 'flagged', conciergeState: 'flagged' },
  { id: 'vouched', conciergeState: 'vouched' },
  { id: 'uncensored', conciergeState: 'uncensored' },
]

async function renderProbe(chats: Parameters<typeof Probe>[0]['chats']) {
  render(
    <QuickHideProvider>
      <Probe chats={chats} />
    </QuickHideProvider>
  )
  // The provider fetches its quick-hide tags on mount.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
}

/** Flip "Dangerous Chats" on. */
async function turnDangerHidingOn() {
  await act(async () => { screen.getByText('toggle').click() })
  expect(screen.getByTestId('danger-toggle')).toHaveTextContent('on')
}

describe('QuickHideProvider — shouldHideChat', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tags: [{ id: 'tag-hidden', name: 'Spicy', quickHide: true }] }),
    } as never)
    window.localStorage.clear()
  })

  it('hides nothing while the toggle is off, whatever the state', async () => {
    await renderProbe(FOUR_STATES)

    for (const { id } of FOUR_STATES) {
      expect(screen.getByTestId(`chat-${id}`)).toHaveTextContent('visible')
    }
  })

  it('hides the uncensored row — and only that — when the toggle is on', async () => {
    await renderProbe(FOUR_STATES)
    await turnDangerHidingOn()

    expect(screen.getByTestId('chat-flagged')).toHaveTextContent('hidden')
    expect(screen.getByTestId('chat-uncensored')).toHaveTextContent('hidden')
    // Monitored is the default; Vouched Safe takes the ordinary route, even
    // with a dangerous label preserved underneath.
    expect(screen.getByTestId('chat-monitored')).toHaveTextContent('visible')
    expect(screen.getByTestId('chat-vouched')).toHaveTextContent('visible')
  })

  it('leaves a chat with no state visible', async () => {
    await renderProbe([{ id: 'stateless' }])
    await turnDangerHidingOn()

    expect(screen.getByTestId('chat-stateless')).toHaveTextContent('visible')
  })

  it('hides by character tag independently of the danger toggle', async () => {
    await renderProbe([
      { id: 'tagged', characterTags: ['tag-hidden'], conciergeState: 'monitored' },
      { id: 'untagged', characterTags: ['tag-other'], conciergeState: 'monitored' },
    ])

    await waitFor(() => expect(screen.getByTestId('chat-tagged')).toHaveTextContent('visible'))

    // Hide the quick-hide tag; the danger toggle stays off throughout.
    await act(async () => {
      window.localStorage.setItem('quilltap.quickHide.activeTags', JSON.stringify(['tag-hidden']))
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'quilltap.quickHide.activeTags',
        newValue: JSON.stringify(['tag-hidden']),
      }))
    })

    expect(screen.getByTestId('danger-toggle')).toHaveTextContent('off')
    expect(screen.getByTestId('chat-tagged')).toHaveTextContent('hidden')
    expect(screen.getByTestId('chat-untagged')).toHaveTextContent('visible')
  })

  it('hides a tagged chat even when its state is one the danger toggle ignores', async () => {
    await renderProbe([{ id: 'both', characterTags: ['tag-hidden'], conciergeState: 'vouched' }])

    await act(async () => {
      window.localStorage.setItem('quilltap.quickHide.activeTags', JSON.stringify(['tag-hidden']))
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'quilltap.quickHide.activeTags',
        newValue: JSON.stringify(['tag-hidden']),
      }))
    })

    expect(screen.getByTestId('chat-both')).toHaveTextContent('hidden')
  })
})
