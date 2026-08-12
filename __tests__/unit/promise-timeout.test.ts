/**
 * `withTimeout` is the shared deadline primitive behind every "a provider went
 * quiet" guard. The error-factory overload is load-bearing: callers that need
 * to tell "the deadline fired" from "the work failed" match on the error's
 * *type*, so a regression back to a plain Error would silently reclassify
 * every stall as an ordinary provider failure.
 *
 * Each rejection assertion is attached *before* the timers advance — otherwise
 * the rejection lands with nothing listening and is reported as an unhandled
 * rejection rather than the expected failure.
 */

import { withTimeout } from '@/lib/promise-timeout'

class MarkerError extends Error {
  constructor() {
    super('deadline')
    this.name = 'MarkerError'
  }
}

/** A promise that never settles on its own — only the deadline can end it. */
const stalled = () => new Promise<never>(() => {})

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

it('resolves with the promise value when it settles in time', async () => {
  const pending = withTimeout(Promise.resolve('done'), 1000, 'too slow')
  await jest.advanceTimersByTimeAsync(1)
  await expect(pending).resolves.toBe('done')
})

it('rejects with the string message when the deadline fires', async () => {
  const assertion = expect(withTimeout(stalled(), 1000, 'too slow')).rejects.toThrow('too slow')
  await jest.advanceTimersByTimeAsync(1001)
  await assertion
})

it('rejects with the factory-built error when given one', async () => {
  const assertion = expect(
    withTimeout(stalled(), 1000, () => new MarkerError())
  ).rejects.toBeInstanceOf(MarkerError)
  await jest.advanceTimersByTimeAsync(1001)
  await assertion
})

it('passes the underlying rejection through untouched', async () => {
  const boom = new Error('provider said no')
  const assertion = expect(
    withTimeout(Promise.reject(boom), 1000, () => new MarkerError())
  ).rejects.toBe(boom)
  await jest.advanceTimersByTimeAsync(1)
  await assertion
})

it('builds the error only when the deadline actually fires', async () => {
  const factory = jest.fn(() => new MarkerError())
  const pending = withTimeout(Promise.resolve('fast'), 1000, factory)
  await jest.advanceTimersByTimeAsync(2000)
  await expect(pending).resolves.toBe('fast')
  expect(factory).not.toHaveBeenCalled()
})
