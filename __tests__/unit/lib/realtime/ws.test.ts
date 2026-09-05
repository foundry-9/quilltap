/**
 * The realtime invalidation stream's WebSocket upgrade handler.
 *
 * Two properties matter and neither is visible from the client: an
 * unauthenticated upgrade must be closed BEFORE it is attached to the bus (an
 * attached socket receives every invalidation hint the instance emits), and
 * every exit route — clean close, socket error — must detach, or the bus
 * accumulates dead listeners for the life of the process.
 */

import { handleRealtimeUpgrade } from '@/lib/realtime/ws'
import { authenticateUpgrade, WS_CLOSE_POLICY_VIOLATION } from '@/lib/realtime/upgrade-auth'
import { attachRealtimeSocket, realtimeListenerCount } from '@/lib/realtime/bus'

jest.mock('@/lib/logger', () => ({
  logger: { child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}))

jest.mock('@/lib/realtime/upgrade-auth', () => ({
  authenticateUpgrade: jest.fn(),
  WS_CLOSE_POLICY_VIOLATION: 1008,
}))

jest.mock('@/lib/realtime/bus', () => ({
  attachRealtimeSocket: jest.fn(),
  realtimeListenerCount: jest.fn().mockReturnValue(0),
}))

const mockAuth = authenticateUpgrade as jest.MockedFunction<typeof authenticateUpgrade>
const mockAttach = attachRealtimeSocket as jest.MockedFunction<typeof attachRealtimeSocket>

/** A stand-in socket that records sends and exposes its registered handlers. */
function fakeSocket() {
  const handlers = new Map<string, (arg: never) => void>()
  return {
    sent: [] as string[],
    closed: [] as Array<[number, string]>,
    on(event: string, fn: (arg: never) => void) {
      handlers.set(event, fn)
      return this
    },
    send(data: string) {
      this.sent.push(data)
    },
    close(code: number, reason: string) {
      this.closed.push([code, reason])
    },
    fire(event: string, arg?: unknown) {
      handlers.get(event)?.(arg as never)
    },
    has(event: string) {
      return handlers.has(event)
    },
  }
}

const req = {} as never

describe('handleRealtimeUpgrade', () => {
  let detach: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    detach = jest.fn()
    mockAttach.mockReturnValue(detach)
    ;(realtimeListenerCount as jest.Mock).mockReturnValue(1)
  })

  describe('when the upgrade does not authenticate', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: false, reason: 'no session' } as never)
    })

    it('closes with a policy violation and never attaches to the bus', async () => {
      const ws = fakeSocket()

      await handleRealtimeUpgrade(ws as never, req)

      expect(ws.closed).toEqual([[WS_CLOSE_POLICY_VIOLATION, 'Unauthorized']])
      expect(mockAttach).not.toHaveBeenCalled()
    })

    it('registers no listeners on the refused socket', async () => {
      const ws = fakeSocket()

      await handleRealtimeUpgrade(ws as never, req)

      expect(ws.has('message')).toBe(false)
      expect(ws.has('close')).toBe(false)
    })
  })

  describe('once authenticated', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as never)
    })

    it('attaches the socket to the bus', async () => {
      const ws = fakeSocket()

      await handleRealtimeUpgrade(ws as never, req)

      expect(mockAttach).toHaveBeenCalledWith(ws)
      expect(ws.closed).toEqual([])
    })

    it('answers a ping with a pong', async () => {
      const ws = fakeSocket()
      await handleRealtimeUpgrade(ws as never, req)

      ws.fire('message', Buffer.from(JSON.stringify({ type: 'ping' })))

      expect(ws.sent).toEqual([JSON.stringify({ type: 'pong' })])
    })

    it('ignores a message the protocol does not define', async () => {
      const ws = fakeSocket()
      await handleRealtimeUpgrade(ws as never, req)

      ws.fire('message', Buffer.from(JSON.stringify({ type: 'subscribe', topic: 'chats' })))

      expect(ws.sent).toEqual([])
    })

    it('survives malformed JSON instead of taking the connection down', async () => {
      const ws = fakeSocket()
      await handleRealtimeUpgrade(ws as never, req)

      expect(() => ws.fire('message', Buffer.from('not json at all'))).not.toThrow()
      expect(ws.sent).toEqual([])
    })

    it('does not let a failed pong send escape the message handler', async () => {
      const ws = fakeSocket()
      ws.send = () => { throw new Error('socket already closing') }
      await handleRealtimeUpgrade(ws as never, req)

      expect(() => ws.fire('message', Buffer.from(JSON.stringify({ type: 'ping' })))).not.toThrow()
    })

    it('detaches on close, so the bus does not keep a dead listener', async () => {
      const ws = fakeSocket()
      await handleRealtimeUpgrade(ws as never, req)

      ws.fire('close')

      expect(detach).toHaveBeenCalledTimes(1)
    })

    it('detaches on a socket error too — the close event is not guaranteed', async () => {
      const ws = fakeSocket()
      await handleRealtimeUpgrade(ws as never, req)

      ws.fire('error', new Error('ECONNRESET'))

      expect(detach).toHaveBeenCalledTimes(1)
    })
  })
})
