/**
 * Multi-character turn anchoring — the `[Name]` assistant prefill switch.
 *
 * In a multi-character chat every reply is anchored to the character whose
 * turn it is, by one of two routes:
 *
 *   - **prefill** — the request ends with an assistant message containing
 *     `[Character Name]`, so the model structurally continues only that
 *     character's line;
 *   - **prose** — an instruction is appended to the system message instead,
 *     leaving the conversation ending on a user message.
 *
 * Which route suits a profile is a property of the model on the other end,
 * not of the provider, so it lives on the connection profile as
 * `multiCharacterPrefill`. Reasons to turn it off:
 *
 *   - Anthropic 4.6+ **rejects** a request that ends with an assistant message
 *     ("This model does not support assistant message prefill"), which is why
 *     Anthropic profiles default to off.
 *   - Ollama opens a thinking model's reasoning block from the chat template
 *     at the start of the assistant turn. A prefill means the block is never
 *     opened, so `message.thinking` comes back empty however the profile's
 *     Enable Thinking box is set (bug 68).
 *   - Some models visibly spend their reply working out whether `[Name]` was
 *     an instruction to them or a previous speaker's slip.
 *
 * This module is the single source of truth for both the default and the
 * resolution. Never read `profile.multiCharacterPrefill` directly — a null
 * there means "never chosen" (a row older than
 * `add-profile-multi-character-prefill-field-v1`, or a profile imported from a
 * pre-4.9 bundle), and only `profileUsesNamePrefill` knows what that means.
 *
 * @module lib/llm/multi-character-prefill
 */

/** Providers whose models cannot take an assistant prefill at all. */
const PREFILL_HOSTILE_PROVIDERS = new Set(['ANTHROPIC'])

/**
 * The value a newly created profile should start with, given its provider.
 * Off for Anthropic (4.6+ hard-rejects an assistant tail), on everywhere else
 * — the historic behaviour.
 */
export function defaultMultiCharacterPrefill(provider: string | null | undefined): boolean {
  if (!provider) return true
  return !PREFILL_HOSTILE_PROVIDERS.has(provider.toUpperCase())
}

/**
 * Whether this profile anchors a multi-character turn with the `[Name]`
 * prefill. An explicit stored choice always wins; a null/absent one falls back
 * to the provider default.
 */
export function profileUsesNamePrefill(
  profile: { provider?: string | null; multiCharacterPrefill?: boolean | null }
): boolean {
  if (typeof profile.multiCharacterPrefill === 'boolean') {
    return profile.multiCharacterPrefill
  }
  return defaultMultiCharacterPrefill(profile.provider)
}
