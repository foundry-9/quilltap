/**
 * Lenient numbers for LLM-supplied tool arguments.
 *
 * Models routinely quote their numbers — `{"type": "6"}` rather than
 * `{"type": 6}` — because a tool call is JSON they wrote by hand, and the habit
 * varies by provider, by model, and by mood. A bare `z.number()` rejects the
 * quoted form outright, so the roll never happens and the character is told
 * their perfectly sensible request was invalid.
 *
 * {@link llmNumber} wraps a numeric schema so a numeric-looking string is
 * converted before validation. It is deliberately narrower than
 * `z.coerce.number()`, which runs everything through `Number()` and therefore
 * quietly turns `true` into 1, and `null` and `[]` into 0 — trading a rejected
 * call for a wrong one, which is the worse failure. Only strings are touched;
 * every other type falls through to the validator untouched and is rejected on
 * its merits.
 *
 * Bounds still apply after conversion, so `"1001"` fails a `max(1000)` exactly
 * as `1001` does, and `"6.5"` fails an `.int()` exactly as `6.5` does. The
 * derived JSON Schema is unchanged — the model is still told `integer`; this
 * only forgives it for not having listened.
 */

import { z } from 'zod';

/**
 * Accept a numeric-looking string wherever `inner` expects a number.
 *
 * ```ts
 * rolls: llmNumber(z.number().int().min(1).max(100)).default(1).optional()
 * ```
 */
export function llmNumber<T extends z.ZodType>(inner: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();
    // '' would become 0 under Number(); an empty string is a missing value, not
    // a zero, so leave it for the validator to refuse.
    if (trimmed === '') return value;

    const parsed = Number(trimmed);
    // Number('nonsense') is NaN — hand the original back so the error message
    // names what the model actually sent.
    return Number.isFinite(parsed) ? parsed : value;
  }, inner);
}
