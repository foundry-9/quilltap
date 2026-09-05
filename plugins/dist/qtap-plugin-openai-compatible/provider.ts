/**
 * OpenAI-Compatible Provider Implementation for Quilltap Plugin
 *
 * The wire implementation lives in @quilltap/plugin-utils — re-exported below
 * so bundled and external plugins share one base class. What this file adds is
 * the knowledge that belongs to *this* endpoint kind rather than to every
 * OpenAI-compatible service: which profile parameters a local runtime accepts,
 * and how one of them has to be shaped.
 */

import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from '@quilltap/plugin-utils';
import type { LLMParams } from './types';

// Re-export the base class so external plugins can extend the same code.
export {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderConfig,
} from '@quilltap/plugin-utils';

/**
 * Profile parameters forwarded to the endpoint, in application order.
 *
 * Allow-listed rather than spread: `model`, `messages`, `stream`,
 * `stream_options` and `tools` must stay unreachable from a profile's
 * free-form `parameters` blob.
 *
 * `chat_template_kwargs` comes first because `reasoning_effort` merges into it
 * (see `normalizeProfileParam`), and a merge should see whatever the profile
 * set for the object itself.
 *
 * These are the keys `llama-server`'s `/v1/chat/completions` route accepts
 * beyond the four standard sampling fields the base class already sends;
 * endpoints that don't know a key generally ignore it, and a profile that sets
 * one is asserting something about its own server.
 */
export const OPENAI_COMPATIBLE_PROFILE_PARAM_ALLOWLIST = [
  'chat_template_kwargs',
  'reasoning_effort',
  'top_k',
  'min_p',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'cache_prompt',
] as const;

/** Keys stored as numbers; a hand-edited profile may hold the string form. */
const NUMERIC_PARAMS = new Set([
  'top_k',
  'min_p',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
  'seed',
]);

/**
 * The OpenAI-compatible endpoint provider.
 *
 * Identical to the base class on the wire except that it forwards the
 * allow-listed profile parameters above.
 */
export class OpenAICompatibleEndpointProvider extends OpenAICompatibleProvider {
  protected override readonly profileParamAllowlist = OPENAI_COMPATIBLE_PROFILE_PARAM_ALLOWLIST;

  /**
   * LOAD-BEARING: this endpoint kind is a *local runtime* as often as not, and
   * a local runtime applies the model's own chat template. The Qwen family —
   * plus several Llama- and Gemma-derived templates — `raise_exception` on any
   * system message after index 0, and Quilltap's context builder deliberately
   * emits up to three leading system blocks so its cache breakpoints survive.
   * The result was that the opening greeting worked and every turn after it
   * died with a 500 (Bug 82). Folding the run is a request-shape concern that
   * belongs to whoever knows the endpoint, which is here.
   *
   * The hosted subclass of this base class (DeepSeek) leaves the default
   * `true` alone and is byte-identical on the wire.
   */
  protected override readonly acceptsRepeatedSystemMessages = false;

  protected override normalizeProfileParam(
    key: string,
    value: unknown,
    _params: LLMParams,
    body: Record<string, unknown>
  ): unknown | undefined {
    // LOAD-BEARING: `reasoning_effort` is NOT a top-level body key here.
    //
    // A local runtime's reasoning level lives in its chat template, and
    // `llama-server` exposes template variables through `chat_template_kwargs`
    // — a flat `reasoning_effort` key is accepted by the JSON parser and then
    // never seen by the template, which is a silent no-op of exactly the kind
    // Bug 71 is about. Do not "simplify" this into a flat key.
    if (key === 'reasoning_effort') {
      const existing = body.chat_template_kwargs;
      body.chat_template_kwargs = {
        ...(typeof existing === 'object' && existing !== null
          ? (existing as Record<string, unknown>)
          : {}),
        reasoning_effort: value,
      };
      return undefined;
    }

    // There is no JSON field type in the options schema, so the object form can
    // only come from a hand-edited profile. Accept the string spelling of it
    // rather than shipping a string where the server expects an object.
    if (key === 'chat_template_kwargs' && typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
      } catch {
        return undefined;
      }
    }

    if (NUMERIC_PARAMS.has(key) && typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return value;
  }
}
