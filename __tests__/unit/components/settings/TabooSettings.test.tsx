/**
 * Tests for the Taboo settings card (Settings → Chat → Taboo).
 *
 * The card is instance-scoped and self-fetching, so what's worth pinning is the
 * request contract rather than the styling: every add and remove PUTs the WHOLE
 * `phrases` array, and the response — which the server has already normalized —
 * is what the component renders next. Client-side guards (empty, duplicate,
 * over-long) must not reach the network at all.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { TabooSettings } from '@/components/settings/chat-settings/TabooSettings'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

const TABOO_URL = '/api/v1/settings/taboo'

/** Stub the endpoint: GET answers `phrases`, PUT echoes the submitted body. */
function stubTabooRoute(phrases: string[], onPut?: (body: unknown) => unknown) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      if (!url.startsWith(TABOO_URL)) {
        return Promise.reject(new Error(`unexpected fetch: ${url}`))
      }
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        const payload = onPut ? onPut(body) : body
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => payload,
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ phrases }),
      } as Response)
    })
}

/** Every PUT body sent so far, in order. */
function putBodies(spy: jest.SpyInstance): unknown[] {
  return spy.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PUT')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
}

describe('TabooSettings', () => {
  beforeEach(() => {
    // `fetch` is a persistent global mock (jest-fetch-mock), so spying on it
    // hands back the same mock function each time — call history would carry
    // over between tests without this.
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders the stored phrases in stored order', async () => {
    stubTabooRoute(['weight-bearing', "that's not nothing"])

    renderWithQuery(<TabooSettings />)

    await screen.findByText('weight-bearing')
    expect(screen.getByText("that's not nothing")).toBeInTheDocument()
    expect(screen.getByText(/2 phrases forbidden/)).toBeInTheDocument()
  })

  it('shows the empty state when nothing is forbidden', async () => {
    stubTabooRoute([])

    renderWithQuery(<TabooSettings />)

    await screen.findByText(/Nothing forbidden yet/)
  })

  it('surfaces a load failure instead of rendering an empty list', async () => {
    jest
      .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
      .mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: async () => ({ error: 'Failed to fetch taboo settings' }),
      } as Response)

    renderWithQuery(<TabooSettings />)

    await screen.findByText('Failed to fetch taboo settings')
  })

  it('PUTs the whole array when a phrase is added', async () => {
    const spy = stubTabooRoute(['weight-bearing'])

    renderWithQuery(<TabooSettings />)
    await screen.findByText('weight-bearing')

    fireEvent.change(screen.getByLabelText('Forbidden phrase'), {
      target: { value: "that's not nothing" },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    expect(putBodies(spy)[0]).toEqual({
      phrases: ['weight-bearing', "that's not nothing"],
    })
    await screen.findByText("that's not nothing")
  })

  it('adds on Enter as well as on the Add button', async () => {
    // Enter is handled explicitly rather than left to the form's implicit
    // submission, which is not reliably triggered by synthesized key events.
    const spy = stubTabooRoute([])

    renderWithQuery(<TabooSettings />)
    await screen.findByText(/Nothing forbidden yet/)

    const input = screen.getByLabelText('Forbidden phrase')
    fireEvent.change(input, { target: { value: 'deeply human' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    expect(putBodies(spy)[0]).toEqual({ phrases: ['deeply human'] })
  })

  it('ignores other keys in the phrase input', async () => {
    const spy = stubTabooRoute([])

    renderWithQuery(<TabooSettings />)
    await screen.findByText(/Nothing forbidden yet/)

    const input = screen.getByLabelText('Forbidden phrase')
    fireEvent.change(input, { target: { value: 'deeply human' } })
    fireEvent.keyDown(input, { key: 'a' })

    await waitFor(() => expect(putBodies(spy)).toHaveLength(0))
  })

  it('trims the typed phrase before sending it', async () => {
    const spy = stubTabooRoute([])

    renderWithQuery(<TabooSettings />)
    await screen.findByText(/Nothing forbidden yet/)

    fireEvent.change(screen.getByLabelText('Forbidden phrase'), {
      target: { value: '   weight-bearing   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    expect(putBodies(spy)[0]).toEqual({ phrases: ['weight-bearing'] })
  })

  it('renders the NORMALIZED list the server returns, not what was submitted', async () => {
    // The server drops case-insensitive duplicates; the card must follow it
    // rather than trusting its own optimistic arithmetic.
    const spy = stubTabooRoute(['weight-bearing'], () => ({ phrases: ['weight-bearing'] }))

    renderWithQuery(<TabooSettings />)
    await screen.findByText('weight-bearing')

    fireEvent.change(screen.getByLabelText('Forbidden phrase'), {
      target: { value: 'tapestry' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('tapestry')).not.toBeInTheDocument())
    expect(screen.getByText(/1 phrase forbidden/)).toBeInTheDocument()
  })

  it('PUTs the remaining phrases when one is removed', async () => {
    const spy = stubTabooRoute(['weight-bearing', "that's not nothing"])

    renderWithQuery(<TabooSettings />)
    await screen.findByText('weight-bearing')

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove "weight-bearing" from the Taboo list' }),
    )

    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    expect(putBodies(spy)[0]).toEqual({ phrases: ["that's not nothing"] })
  })

  it('refuses a case-insensitive duplicate without touching the network', async () => {
    const spy = stubTabooRoute(['weight-bearing'])

    renderWithQuery(<TabooSettings />)
    await screen.findByText('weight-bearing')

    fireEvent.change(screen.getByLabelText('Forbidden phrase'), {
      target: { value: 'WEIGHT-BEARING' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('That phrase is already forbidden.')
    expect(putBodies(spy)).toHaveLength(0)
  })

  it('does not send an empty or whitespace-only phrase', async () => {
    const spy = stubTabooRoute([])

    renderWithQuery(<TabooSettings />)
    await screen.findByText(/Nothing forbidden yet/)

    const input = screen.getByLabelText('Forbidden phrase')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(putBodies(spy)).toHaveLength(0))
  })
})
