/**
 * Bound a promise by a deadline.
 *
 * Every caller here is wrapping an LLM call whose failure mode is silence
 * rather than an error — a provider that accepts the request and then never
 * answers would otherwise hold a turn (or a roll) open indefinitely. Rejecting
 * on the deadline turns that into an ordinary failure the caller already knows
 * how to degrade through.
 *
 * The underlying promise is NOT cancelled — nothing here can cancel it. It runs
 * to completion and its result is discarded; the timer is cleared either way so
 * a settled promise leaves nothing pending.
 *
 * @module promise-timeout
 */

/**
 * Reject with `timeoutMessage` when `promise` has not settled within `ms`.
 * Resolves/rejects with the promise's own outcome otherwise.
 *
 * The whole sentence is the caller's, not a label this composes into one: some
 * of these messages are logged and some are surfaced to a person reading a
 * failed roll, and those two want different wording.
 *
 * Pass a factory instead of a string when the caller needs to tell "the
 * deadline fired" apart from "the work failed" — a typed error survives the
 * `catch` that a message alone only survives by string matching.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string | (() => Error)
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(typeof timeoutMessage === 'string' ? new Error(timeoutMessage) : timeoutMessage()),
      ms
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
