/**
 * Sampling knobs from a connection profile's `parameters` blob.
 *
 * The profile editor stores the three shared sampling controls under snake_case
 * keys — `temperature`, `max_tokens`, `top_p` (see useProfileForm) — while
 * `LLMParams` names them `temperature` / `maxTokens` / `topP`. Call sites that
 * spread the blob straight onto an `LLMParams` object therefore silently drop
 * two of the three: `parameters.maxTokens` and `parameters.topP` do not exist,
 * so the provider falls back to its own defaults and the profile's Max Tokens
 * and Top P are never sent. This module is the one place that bridges the two
 * spellings, so a profile means the same thing on every path that reads it.
 *
 * Not to be confused with `resolveMaxTokens` in model-context-data.ts: that one
 * answers "how much output should the *context budget* reserve" and
 * deliberately ignores `parameters.max_tokens`. This one is the per-request
 * generation cap that goes on the wire.
 */

/**
 * Read one numeric knob under its canonical snake_case key, tolerating the
 * camelCase spelling in case a profile was seeded or imported with one.
 * Strings are accepted because JSON blobs edited by hand often carry them.
 */
function readNumber(
  params: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!params) return undefined
  for (const key of keys) {
    const value = params[key]
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** The sampling knobs an `LLMParams` object expects, in its own spelling. */
export interface SamplingParams {
  temperature?: number
  maxTokens?: number
  topP?: number
}

/**
 * Extract `temperature` / `maxTokens` / `topP` from a profile's parameters blob
 * in the shape `LLMParams` wants.
 *
 * Absent knobs come back undefined so the caller — or the provider — keeps
 * whatever default it had; nothing here invents a value.
 *
 * @param params - A connection profile's `parameters` record (as returned by
 *   `profileParams`), or undefined
 * @returns The three sampling knobs, each present only if the profile set it
 */
export function resolveSamplingParams(
  params: Record<string, unknown> | undefined
): SamplingParams {
  return {
    temperature: readNumber(params, 'temperature'),
    maxTokens: readNumber(params, 'max_tokens', 'maxTokens'),
    topP: readNumber(params, 'top_p', 'topP'),
  }
}
