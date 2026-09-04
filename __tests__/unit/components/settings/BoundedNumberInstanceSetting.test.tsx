/**
 * Tests for the shared bounded-number instance-setting card behind
 * `DataRetentionSettings` and `BrahmaConsoleSettings`.
 *
 * What's worth pinning is the commit contract: an out-of-bounds entry reverts
 * without a request, an unchanged entry normalises without a request, a changed
 * entry PUTs `{ [field]: n }` and renders what the server echoes, and a failed
 * PUT surfaces the server's `error` inline and as a toast, then reverts.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { DataRetentionSettings } from '@/components/settings/chat-settings/DataRetentionSettings'
import { BrahmaConsoleSettings } from '@/components/settings/chat-settings/BrahmaConsoleSettings'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

type PutAnswer = { ok: boolean; status: number; body: unknown }

/** Stub one settings endpoint: GET answers `initial`, PUT answers via `onPut`. */
function stubSettingsRoute(
  url: string,
  initial: unknown,
  onPut: (body: Record<string, unknown>) => PutAnswer = (body) => ({ ok: true, status: 200, body })
) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      if (!target.startsWith(url)) {
        return Promise.reject(new Error(`unexpected fetch: ${target}`))
      }
      if (init?.method === 'PUT') {
        const answer = onPut(JSON.parse(String(init.body)))
        return Promise.resolve({
          ok: answer.ok,
          status: answer.status,
          statusText: answer.ok ? 'OK' : 'Bad Request',
          json: async () => answer.body,
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => initial,
      } as Response)
    })
}

function putBodies(spy: jest.SpyInstance): Record<string, unknown>[] {
  return spy.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PUT')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
}

const RETENTION_URL = '/api/v1/settings/data-retention'
const CONSOLE_URL = '/api/v1/settings/brahma-console'

describe('BoundedNumberInstanceSetting (via DataRetentionSettings / BrahmaConsoleSettings)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('renders the loaded value and saves a changed entry', async () => {
    const spy = stubSettingsRoute(RETENTION_URL, { staleChatDays: 45 })
    renderWithQuery(<DataRetentionSettings />)

    const input = (await screen.findByLabelText(/Keep inactive chats/)) as HTMLInputElement
    expect(input.value).toBe('45')

    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.blur(input)

    await waitFor(() => expect(putBodies(spy)).toEqual([{ staleChatDays: 60 }]))
    await waitFor(() => expect(input.value).toBe('60'))
    expect(showSuccessToast).toHaveBeenCalledWith('Retention window saved')
  })

  it('falls back to the default when the server has no value', async () => {
    stubSettingsRoute(CONSOLE_URL, {})
    renderWithQuery(<BrahmaConsoleSettings />)

    const input = (await screen.findByLabelText(/Let the Console take up to/)) as HTMLInputElement
    expect(input.value).toBe('50')
  })

  it('reverts an out-of-bounds entry without a request', async () => {
    const spy = stubSettingsRoute(CONSOLE_URL, { maxAgentTurns: 50 })
    renderWithQuery(<BrahmaConsoleSettings />)

    const input = (await screen.findByLabelText(/Let the Console take up to/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.blur(input)

    expect(input.value).toBe('50')
    expect(putBodies(spy)).toEqual([])
  })

  it('normalises an unchanged entry without a request', async () => {
    const spy = stubSettingsRoute(RETENTION_URL, { staleChatDays: 30 })
    renderWithQuery(<DataRetentionSettings />)

    const input = (await screen.findByLabelText(/Keep inactive chats/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: '30.7' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(input.value).toBe('30')
    expect(putBodies(spy)).toEqual([])
  })

  it('shows the server error inline and as a toast, then reverts', async () => {
    stubSettingsRoute(RETENTION_URL, { staleChatDays: 30 }, () => ({
      ok: false,
      status: 400,
      body: { error: 'Validation failed' },
    }))
    renderWithQuery(<DataRetentionSettings />)

    const input = (await screen.findByLabelText(/Keep inactive chats/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.blur(input)

    expect(await screen.findByText('Validation failed')).toBeInTheDocument()
    expect(showErrorToast).toHaveBeenCalledWith('Validation failed')
    expect(input.value).toBe('30')
  })

  it('uses the fallback save message when the server sends no error', async () => {
    stubSettingsRoute(CONSOLE_URL, { maxAgentTurns: 50 }, () => ({
      ok: false,
      status: 500,
      body: {},
    }))
    renderWithQuery(<BrahmaConsoleSettings />)

    const input = (await screen.findByLabelText(/Let the Console take up to/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: '80' } })
    fireEvent.blur(input)

    expect(await screen.findByText('Failed to save Brahma Console settings')).toBeInTheDocument()
    expect(showErrorToast).toHaveBeenCalledWith('Failed to save Brahma Console settings')
  })
})
