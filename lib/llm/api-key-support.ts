/**
 * Two questions about a provider and an API key.
 *
 * `configRequirements.requiresApiKey` used to answer both of them, and they are
 * genuinely the same question for a provider that is wholly hosted (Anthropic,
 * OpenAI, Google — must have a key, may have a key) or wholly local (Ollama —
 * must not, may not). OpenAI-Compatible is the one that splits them: the same
 * provider points at an unauthenticated llama.cpp on localhost *and* at a
 * hosted endpoint behind a bearer token. With a single flag, `false` was the
 * only workable value, and `false` then removed the provider from the
 * Add-New-API-Key list and from the profile form's key field alike — so a
 * hosted OpenAI-compatible endpoint could not be configured at all (Bug 81).
 *
 * The plugin capability `acceptsApiKey` answers question 2 and is optional:
 * omitted, it means "same answer as `requiresApiKey`", so every plugin that
 * predates it keeps exactly its present behaviour.
 *
 * This module is deliberately free of registry, repository and Node imports so
 * the settings UI can ask the same question of a `/api/v1/providers` payload
 * that the server asks of the plugin registry.
 *
 * @module llm/api-key-support
 */

/**
 * The two flags, as they arrive from a plugin's `config` or from the
 * `configRequirements` object on `/api/v1/providers`.
 */
export interface ApiKeyConfigRequirements {
  requiresApiKey?: boolean
  acceptsApiKey?: boolean
}

/**
 * Whether a provider *must* hold an API key before its profile is valid.
 *
 * Defaults to `true` when the requirements are unknown — a provider list that
 * has not loaded is no reason to judge a provider keyless, and demanding a key
 * that turns out to be unnecessary is the safer of the two wrong answers.
 */
export function providerRequiresApiKey(
  requirements: ApiKeyConfigRequirements | null | undefined
): boolean {
  return requirements?.requiresApiKey ?? true
}

/**
 * Whether a provider *may* hold an API key at all — the question that decides
 * whether a key of this provider can be created, whether the profile form
 * shows the key selector, and whether a stored key is allowed to reach the
 * wire.
 *
 * A provider that requires a key necessarily accepts one, so the fallback is
 * `requiresApiKey` rather than a bare `true`: an Ollama endpoint has nowhere to
 * put a bearer token and should not be offered the field.
 */
export function providerAcceptsApiKey(
  requirements: ApiKeyConfigRequirements | null | undefined
): boolean {
  return requirements?.acceptsApiKey ?? providerRequiresApiKey(requirements)
}
