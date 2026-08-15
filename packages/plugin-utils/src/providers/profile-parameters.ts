/**
 * Profile-parameter passthrough
 *
 * A connection profile's `parameters` blob is free-form JSON: the host stores
 * whatever the profile editor (or a hand-edited profile) puts there and hands
 * it back to the provider as `LLMParams.profileParameters` at call time. What
 * reaches the wire is entirely the provider's business — and a provider that
 * never reads the bag drops every setting in silence, which is exactly the
 * defect Bug 71 records.
 *
 * This is the one mechanism every provider uses to forward those keys.
 *
 * **An exported function rather than a base-class method.** Only one plugin in
 * the repository extends `OpenAICompatibleProvider` (DeepSeek); Z.AI and
 * OpenRouter implement `TextProvider` directly, and Ollama speaks its own
 * REST shape. A `protected` method would have reached one of them, so the
 * mechanism is a free function usable by inheritance *and* composition, and
 * the base class simply calls it.
 *
 * @packageDocumentation
 */

import type { LLMParams } from '@quilltap/plugin-types';

/**
 * Per-key hook applied to an allow-listed profile parameter on its way into
 * the request body.
 *
 * Return the value to send, or `undefined` to omit the key entirely.
 *
 * The `body` is passed so a normalizer can place a value somewhere other than
 * its own top-level key — the OpenAI-compatible plugin folds `reasoning_effort`
 * into `chat_template_kwargs` this way, then returns `undefined` so no flat
 * `reasoning_effort` key is sent. Normalizers that only reshape a value can
 * ignore the argument.
 */
export type ProfileParamNormalizer = (
  key: string,
  value: unknown,
  params: LLMParams,
  body: Record<string, unknown>
) => unknown | undefined;

/**
 * Copy allow-listed keys from `params.profileParameters` onto a request body.
 *
 * Rules, all of which predate this helper (they were hand-rolled identically in
 * the DeepSeek and Z.AI providers before it existed):
 *
 * - **Allow-list, never spread.** `model`, `messages`, `stream`,
 *   `stream_options` and `tools` must be unreachable from a profile — a
 *   misconfigured bag cannot be allowed to retarget the request.
 * - **`undefined` and `null` skip.** So does the empty string, which is what
 *   the schema-driven profile editor stores for "omit this and use the model
 *   default".
 * - **The allow-list is ordered.** Keys are applied in the order given, so a
 *   normalizer that merges into an earlier key (`chat_template_kwargs`) sees
 *   whatever the profile set for it.
 *
 * @param body - Request body under construction; mutated in place
 * @param params - The call's LLM parameters, carrying `profileParameters`
 * @param allowlist - Keys this provider is willing to forward
 * @param normalize - Optional per-key hook (see {@link ProfileParamNormalizer})
 */
export function applyProfileParameters(
  body: Record<string, unknown>,
  params: LLMParams,
  allowlist: readonly string[],
  normalize?: ProfileParamNormalizer
): void {
  const profile = params.profileParameters;
  if (!profile || typeof profile !== 'object') return;
  const bag = profile as Record<string, unknown>;

  for (const key of allowlist) {
    const raw = bag[key];
    if (raw === undefined || raw === null) continue;
    // Empty string from the schema-driven profile editor means "omit the
    // parameter and use the model default."
    if (typeof raw === 'string' && raw === '') continue;
    const value = normalize ? normalize(key, raw, params, body) : raw;
    if (value === undefined) continue;
    body[key] = value;
  }
}
