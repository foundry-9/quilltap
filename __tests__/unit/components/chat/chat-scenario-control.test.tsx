/**
 * The in-chat scenario picker (Salon sidebar → Chat → Scenario).
 *
 * The subtle part is the seeding rule. The control never copies the chat's
 * current scene into state; it DERIVES the picker position from it, so the
 * position keeps settling as the four option tiers arrive over the network —
 * and stops the moment the user makes a choice of their own. A seeded-into-
 * state version either shows "Custom…" forever (tiers arrived too late) or
 * stomps a choice the user already made (tiers arrived too early).
 *
 * Also pinned: "Show archived" belongs to the query key, so the plain and
 * archived answers cache separately instead of one overwriting the other.
 */

import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { ChatScenarioControl } from '@/components/chat/ChatScenarioControl'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

const GENERAL = [
  { path: 'general/masquerade.md', title: 'A Masquerade', body: 'Masks are worn.' },
]
const PROJECT = [
  { path: 'project/atrium.md', title: 'The Atrium', body: 'Glass overhead.' },
]
const CHARACTER = [{ id: 'sc-1', name: 'Her Study', content: 'Books to the ceiling.' }]
const GROUP = [
  {
    groupId: 'g-1',
    groupName: 'The Company',
    scenarios: [{ path: 'group/parlour.md', title: 'The Parlour', body: 'A low fire.' }],
  },
]

/** Route each tier's endpoint to its payload; anything else is an empty tier. */
function stubTiers() {
  const seen: string[] = []
  ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
    seen.push(url)
    const body = (() => {
      if (url.startsWith('/api/v1/scenarios')) return { scenarios: GENERAL }
      if (url.includes('/projects/')) return { scenarios: PROJECT }
      if (url.includes('/groups/scenarios')) return { groupScenarios: GROUP }
      if (url.includes('/scenarios') && url.includes('/characters/')) return { scenarios: CHARACTER }
      return {}
    })()
    return { ok: true, status: 200, json: async () => body }
  })
  return seen
}

function renderControl(props: Partial<React.ComponentProps<typeof ChatScenarioControl>> = {}) {
  return renderWithQuery(
    <ChatScenarioControl
      chatId="chat-1"
      projectId="proj-1"
      scenarioText={null}
      llmCharacterIds={['char-1']}
      singleLlmCharacterId="char-1"
      enabled
      {...props}
    />
  )
}

describe('ChatScenarioControl', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockReset()
  })

  describe('seeding from the chat\'s current scene', () => {
    it('opens on Custom with the text ready to edit when the scene matches no preset', async () => {
      stubTiers()
      renderControl({ scenarioText: 'A scene nobody wrote down.' })

      const box = await screen.findByLabelText('Custom scenario text')
      expect(box).toHaveValue('A scene nobody wrote down.')
    })

    it('opens on Custom with an empty box when the chat has no scene at all', async () => {
      stubTiers()
      renderControl({ scenarioText: null })

      expect(await screen.findByLabelText('Custom scenario text')).toHaveValue('')
    })

    it('preselects the preset once its tier arrives, rather than staying on Custom', async () => {
      stubTiers()
      renderControl({ scenarioText: 'Masks are worn.' })

      // Derived, not seeded: the match can only be made after the fetch lands.
      await waitFor(() => {
        expect(screen.queryByLabelText('Custom scenario text')).not.toBeInTheDocument()
      })
      expect(await screen.findByText('Masks are worn.')).toBeInTheDocument()
    })

    it('matches a preset whose body differs only by surrounding whitespace', async () => {
      stubTiers()
      renderControl({ scenarioText: '  Masks are worn.\n' })

      await waitFor(() => {
        expect(screen.queryByLabelText('Custom scenario text')).not.toBeInTheDocument()
      })
    })

    it('reads a preset with notes layered beneath it as Custom, not as the preset', async () => {
      stubTiers()
      const withNotes = 'Masks are worn.\n\nAnd one guest is not who they claim.'
      renderControl({ scenarioText: withNotes })

      expect(await screen.findByLabelText('Custom scenario text')).toHaveValue(withNotes)
    })
  })

  describe('the archived toggle', () => {
    it('re-fetches every tier with includeArchived so the two answers cache apart', async () => {
      const seen = stubTiers()
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      expect(seen.some(u => u.includes('includeArchived'))).toBe(false)

      await userEvent.click(screen.getByLabelText('Show archived'))

      await waitFor(() => {
        expect(seen.filter(u => u.includes('includeArchived=true')).length).toBeGreaterThan(0)
      })
    })
  })

  describe('saving', () => {
    it('posts the custom text to the scenario action and drops the draft afterwards', async () => {
      stubTiers()
      const onChatUpdated = jest.fn()
      renderControl({ onChatUpdated })

      const box = await screen.findByLabelText('Custom scenario text')
      await userEvent.type(box, 'Rain on the conservatory glass.')
      await userEvent.click(screen.getByRole('button', { name: 'Change scenario' }))

      await waitFor(() => expect(onChatUpdated).toHaveBeenCalled())

      const call = (global.fetch as jest.Mock).mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('action=scenario')
      )
      expect(call).toBeDefined()
      expect(call[0]).toBe('/api/v1/chats/chat-1?action=scenario')
      expect(JSON.parse(call[1].body)).toEqual({ scenario: 'Rain on the conservatory glass.' })
      expect(showSuccessToast).toHaveBeenCalled()
    })

    it('surfaces the server\'s own error text instead of a bare status code', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('action=scenario')) {
          return { ok: false, status: 409, statusText: 'Conflict', json: async () => ({ error: 'That scene is archived' }) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      })
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      await userEvent.click(screen.getByRole('button', { name: 'Change scenario' }))

      await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('That scene is archived'))
    })

    it('re-enables the button after a failed save rather than staying stuck', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('action=scenario')) throw new Error('network down')
        return { ok: true, status: 200, json: async () => ({}) }
      })
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      const button = screen.getByRole('button', { name: 'Change scenario' })
      await userEvent.click(button)

      await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('network down'))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Change scenario' })).toBeEnabled())
    })
  })

  describe('the dropdown', () => {
    it('is hidden entirely when no tier has anything to offer', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ scenarios: [], groupScenarios: [] }),
      }))
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      expect(screen.queryByLabelText('Scenario')).not.toBeInTheDocument()
    })

    it('appears once any tier has options', async () => {
      stubTiers()
      renderControl()

      expect(await screen.findByLabelText('Scenario')).toBeInTheDocument()
    })
  })

  it('fetches nothing until the section has been opened once', async () => {
    stubTiers()
    renderControl({ enabled: false })

    await screen.findByLabelText('Custom scenario text')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
