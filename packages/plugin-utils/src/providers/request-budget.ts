/**
 * Per-request wall-clock budgets.
 *
 * Every provider SDK ships a generous default request timeout — the OpenAI and
 * Anthropic SDKs both use ten minutes — on the assumption that a slow answer is
 * better than no answer. That assumption is wrong for work Quilltap awaits
 * inline on a user-visible turn: a service that accepts the connection and then
 * goes silent holds the turn for the full ten minutes before the SDK's first
 * retry, with nothing logged, because request logs are only written when a call
 * finishes.
 *
 * `LLMParams.requestTimeoutMs` is the caller's answer to "how long is this
 * worth waiting for". These helpers are the single place that decides what that
 * number means, so an SDK-backed provider and a `fetch`-based one apply it the
 * same way.
 *
 * @packageDocumentation
 */

import type { LLMParams } from '@quilltap/plugin-types';

/**
 * Fallback budget for a request whose caller expressed no preference.
 *
 * Half the SDK default: long enough for a slow non-streaming generation, short
 * enough that a silently-stalled endpoint fails in minutes rather than tens of
 * minutes.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/**
 * The budget for one request, in milliseconds.
 *
 * @param params - LLM parameters, whose `requestTimeoutMs` wins when set
 * @param defaultMs - Budget to use when the caller named none
 * @returns The effective budget in milliseconds
 */
export function resolveRequestTimeoutMs(
  params: Pick<LLMParams, 'requestTimeoutMs'>,
  defaultMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): number {
  const requested = params.requestTimeoutMs;
  return typeof requested === 'number' && requested > 0 ? requested : defaultMs;
}

/**
 * Per-request options for an OpenAI- or Anthropic-style SDK call.
 *
 * A caller-supplied budget is a *ceiling*, not a per-attempt allowance, so
 * retries are disabled for it — three attempts at the requested budget would
 * spend three times what the caller agreed to. Returns undefined when the
 * caller named no budget, leaving the client's own defaults in charge.
 *
 * @param params - LLM parameters for the request
 * @returns SDK request options, or undefined to use the client defaults
 */
export function buildSdkRequestOptions(
  params: Pick<LLMParams, 'requestTimeoutMs'>
): { timeout: number; maxRetries: number } | undefined {
  const requested = params.requestTimeoutMs;
  if (typeof requested !== 'number' || requested <= 0) return undefined;
  return { timeout: requested, maxRetries: 0 };
}

/**
 * Client-construction options for a provider that builds a fresh SDK client
 * per call, where "client default" and "this request" are the same thing.
 *
 * Always defined, unlike {@link buildSdkRequestOptions} — a per-call client has
 * no pre-existing defaults worth preserving, so it takes the resolved budget
 * either way and only forgoes retries when the caller set a ceiling.
 *
 * @param params - LLM parameters for the request
 * @param defaultMs - Budget to use when the caller named none
 * @returns `timeout` and `maxRetries` to spread into the SDK constructor
 */
export function buildSdkClientOptions(
  params: Pick<LLMParams, 'requestTimeoutMs'>,
  defaultMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): { timeout: number; maxRetries: number } {
  const capped = typeof params.requestTimeoutMs === 'number' && params.requestTimeoutMs > 0;
  return {
    timeout: resolveRequestTimeoutMs(params, defaultMs),
    maxRetries: capped ? 0 : 2,
  };
}

/**
 * An abort signal that fires at the request's budget, for providers that call
 * `fetch` directly rather than through an SDK.
 *
 * Unlike the SDK options above this bounds the *whole* exchange, body included:
 * `fetch` resolves at the response headers, but the signal stays live while the
 * body streams. Pass a generous `defaultMs` on streaming paths, or compose with
 * the caller's own signal, so a long generation is not cut off mid-answer.
 *
 * @param params - LLM parameters for the request
 * @param defaultMs - Budget to use when the caller named none
 * @returns An AbortSignal that aborts once the budget elapses
 */
export function buildRequestAbortSignal(
  params: Pick<LLMParams, 'requestTimeoutMs'>,
  defaultMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): AbortSignal {
  return AbortSignal.timeout(resolveRequestTimeoutMs(params, defaultMs));
}
