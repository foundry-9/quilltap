/**
 * Ollama profile parameters — the one answer to "what can a connection profile
 * set on an Ollama request?"
 *
 * Ollama's parameters live at two levels: the sampler knobs go inside the
 * request's `options` object, while residency (`keep_alive`) and the thinking
 * switch (`think`) are top-level fields. A couple of keys are read for control
 * and never reach the wire at all. Before Bug 71 those three groups were three
 * bespoke lookups scattered beside a hardcoded `options` literal, and every
 * other key a user saved was dropped in silence.
 *
 * Anything a profile may set is listed here, and everything else is dropped.
 */

import { applyProfileParameters } from '@quilltap/plugin-utils';
import type { LLMParams } from './types';

/**
 * Keys forwarded verbatim into the request's `options` object.
 *
 * `num_ctx` is injected by the host from the profile's Max Context (see
 * `profileParams` in lib/llm/cheap-llm.ts) and can also be set by hand.
 * The mirostat trio has no field in the options schema — it is deliberately
 * hand-set territory, and the allow-list is what makes that possible.
 */
export const OLLAMA_OPTION_PARAM_ALLOWLIST = [
  'num_ctx',
  'top_k',
  'min_p',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'mirostat',
  'mirostat_tau',
  'mirostat_eta',
] as const;

/** Keys forwarded verbatim at the top level of the request body. */
export const OLLAMA_TOP_LEVEL_PARAM_ALLOWLIST = ['keep_alive'] as const;

/**
 * Keys the provider reads for control and never forwards as-is:
 * `enable_thinking` and `thinking_effort` together become the top-level `think`
 * field, and `request_timeout_seconds` sets the client's wall-clock budget.
 *
 * Not extended to the embedding path. `/api/embed` accepts `keep_alive` on the
 * same terms, but the embedding provider is handed no profile parameters at all
 * (`EmbeddingOptions` is ignored by every Ollama embedding call), so reaching it
 * means widening the embedding interface — a bigger change than this bug, and
 * embedding models are small enough that residency matters far less.
 */
export const OLLAMA_CONTROL_PARAMS = [
  'enable_thinking',
  'thinking_effort',
  'request_timeout_seconds',
] as const;

/** Option keys Ollama types as numbers; a hand-edited profile may hold strings. */
const NUMERIC_OPTIONS = new Set([
  'num_ctx',
  'top_k',
  'min_p',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'mirostat',
  'mirostat_tau',
  'mirostat_eta',
]);

/** Option keys that must be a positive integer or not be sent at all. */
const POSITIVE_INTEGER_OPTIONS = new Set(['num_ctx']);

/**
 * Thinking levels Ollama accepts in place of a boolean `think`.
 *
 * Measured against Ollama 0.32.1 (2026-08-15): an unrecognised value is
 * rejected outright — *"invalid think value: … (must be "high", "medium",
 * "low", "max", true, or false)"* — so the set is the server's, not a guess.
 * Older servers that predate levels reject the string; the provider's existing
 * retry-without-`think` fallback covers them.
 */
export const OLLAMA_THINK_LEVELS = ['low', 'medium', 'high', 'max'] as const;

/**
 * Default wait, in seconds, when the profile names none. Matches
 * `DEFAULT_REQUEST_TIMEOUT_MS` in @quilltap/plugin-utils — restated here in the
 * unit the profile field uses, and exported so the options schema in index.ts
 * advertises the same number the provider actually applies.
 */
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 300;

/**
 * Resolve the profile's thinking settings into Ollama's `think` field.
 *
 * Defaults to `false`: thinking models answer without a reasoning pass, keeping
 * output clean for JSON-shaped work. `enable_thinking` stays the boolean it has
 * always been — existing profiles hold `true`/`false` there, and folding the
 * levels into that same key would have shown every already-thinking profile as
 * blank in the editor while it went on thinking. The level rides a second key
 * that only applies when thinking is on; on a local box, effort is the largest
 * wall-clock control there is, so it is worth reaching.
 */
export function resolveThinkSetting(params: LLMParams): boolean | string {
  const value = params.profileParameters?.enable_thinking;
  if (value !== true && value !== 'true') return false;
  const effort = params.profileParameters?.thinking_effort;
  if (typeof effort === 'string' && (OLLAMA_THINK_LEVELS as readonly string[]).includes(effort)) {
    return effort;
  }
  return true;
}

/**
 * Resolve the profile's `request_timeout_seconds` option into milliseconds.
 *
 * A local Ollama has no fixed answer to "how long should this take": loading a
 * 27B model off disk and reading a 20k-token prompt can outlast the shared
 * 5-minute default on a busy machine, while a small model on a quiet one should
 * fail fast. The number is therefore the user's, per connection profile.
 * Anything absent, unparseable or non-positive falls through to the default.
 */
export function resolveProfileTimeoutMs(params: LLMParams): number {
  const value = params.profileParameters?.request_timeout_seconds;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000;
}

function normalizeOption(key: string, value: unknown): unknown | undefined {
  if (NUMERIC_OPTIONS.has(key)) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(n)) return undefined;
    if (POSITIVE_INTEGER_OPTIONS.has(key)) {
      return n > 0 ? Math.floor(n) : undefined;
    }
    return n;
  }
  return value;
}

function normalizeTopLevel(key: string, value: unknown): unknown | undefined {
  if (key === 'keep_alive') {
    // Ollama parses a duration string with Go's time.ParseDuration and a bare
    // number as seconds. Measured against 0.32.1: `"-1"` is REJECTED — *"time:
    // missing unit in duration"* — while the number `-1` is accepted and means
    // "never unload". So the two numeric sentinels the schema offers (-1 and 0)
    // go out as numbers and everything else as the duration string it is.
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }
  return value;
}

/**
 * Apply the profile's parameters to an Ollama request body, in place.
 *
 * The body must already carry its `options` object; this fills in the rest.
 * Nothing here can reach `model`, `messages`, `stream` or `tools` — a
 * misconfigured bag must not be able to retarget the request.
 */
export function applyOllamaProfileParameters(
  body: Record<string, unknown>,
  params: LLMParams
): void {
  const options = (body.options ?? {}) as Record<string, unknown>;
  applyProfileParameters(options, params, OLLAMA_OPTION_PARAM_ALLOWLIST, (key, value) =>
    normalizeOption(key, value)
  );
  body.options = options;

  applyProfileParameters(body, params, OLLAMA_TOP_LEVEL_PARAM_ALLOWLIST, (key, value) =>
    normalizeTopLevel(key, value)
  );
}
