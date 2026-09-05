/**
 * `useJobFanOutStatus` — the shared status read behind the memory-tool
 * fan-out cards.
 *
 * What matters is the gating: the `jobs` topic re-reads only while work is
 * in flight (when the card says what "in flight" means), and the fallback
 * poll ticks only while the socket is down and work is in flight. The socket
 * is stubbed at the realtime client so the real `useRealtime*` hooks run.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../../helpers/renderWithQuery'
import { useJobFanOutStatus } from '@/components/tools/hooks/useJobFanOutStatus'
import {
  getRealtimeStatus,
  subscribeRealtime,
  type RealtimeSubscriber,
} from '@/lib/realtime/client'

// Uses global jest (not @jest/globals) for proper SWC mock hoisting
jest.mock('@/lib/realtime/client', () => ({
  subscribeRealtime: jest.fn(),
  subscribeRealtimeStatus: jest.fn(() => () => {}),
  getRealtimeStatus: jest.fn(() => 'idle'),
}))

const mockSubscribe = subscribeRealtime as jest.MockedFunction<typeof subscribeRealtime>
const mockStatus = getRealtimeStatus as jest.MockedFunction<typeof getRealtimeStatus>

const STATUS_URL = '/api/v1/memories?action=regenerate-all'
const POLL_MS = 1_000

/** The subscriber the hook registered, so a test can push a topic event at it. */
let subscriber: RealtimeSubscriber | null = null

function stubStatus(inFlight: number) {
  return jest.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ inFlight }),
    } as Response),
  )
}

function renderStatus(options: { inFlightOf?: (s: { inFlight: number }) => number } = {}) {
  const { wrapper } = createQueryWrapper()
  return renderHook(
    () =>
      useJobFanOutStatus<{ inFlight: number }>({
        queryKey: ['test', 'fan-out-status'],
        url: STATUS_URL,
        pollMs: POLL_MS,
        ...options,
      }),
    { wrapper },
  )
}

beforeEach(() => {
  // `global.fetch` is already a jest.fn (jest.setup.ts), so `spyOn` hands back
  // that same mock and its call history would otherwise leak across tests.
  jest.clearAllMocks()
  subscriber = null
  mockStatus.mockReturnValue('idle')
  mockSubscribe.mockImplementation(s => {
    subscriber = s
    return () => {
      subscriber = null
    }
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('useJobFanOutStatus', () => {
  it('reads the status from the URL through the fetcher', async () => {
    const fetchMock = stubStatus(0)
    const { result } = renderStatus()

    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 0 }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(STATUS_URL)
  })

  it('re-reads on a jobs event only while work is in flight', async () => {
    const fetchMock = stubStatus(0)
    const { result } = renderStatus({ inFlightOf: s => s.inFlight })
    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 0 }))
    expect(subscriber).not.toBeNull()

    await act(async () => {
      subscriber!.onEvent({ topic: 'jobs' } as never)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-reads on a jobs event while work is in flight, ignoring other topics', async () => {
    const fetchMock = stubStatus(3)
    const { result } = renderStatus({ inFlightOf: s => s.inFlight })
    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 3 }))

    await act(async () => {
      subscriber!.onEvent({ topic: 'chats' } as never)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      subscriber!.onEvent({ topic: 'jobs' } as never)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('re-reads on every jobs event when no in-flight rule is given', async () => {
    const fetchMock = stubStatus(0)
    const { result } = renderStatus()
    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 0 }))

    await act(async () => {
      subscriber!.onEvent({ topic: 'jobs' } as never)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('polls at the fallback cadence while the socket is down and work is in flight', async () => {
    jest.useFakeTimers()
    const fetchMock = stubStatus(2)
    const { result } = renderStatus({ inFlightOf: s => s.inFlight })
    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 2 }))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS + 50)
    })
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('does not poll while idle, even with the socket down', async () => {
    jest.useFakeTimers()
    const fetchMock = stubStatus(0)
    const { result } = renderStatus({ inFlightOf: s => s.inFlight })
    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 0 }))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 3)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not poll while the socket is connected', async () => {
    jest.useFakeTimers()
    mockStatus.mockReturnValue('connected')
    const fetchMock = stubStatus(2)
    const { result } = renderStatus({ inFlightOf: s => s.inFlight })
    await waitFor(() => expect(result.current.data).toEqual({ inFlight: 2 }))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 3)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
