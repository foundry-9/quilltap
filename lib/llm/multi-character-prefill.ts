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
 *     Anthropic profiles default to off. This one really is a property of the
 *     provider: it holds whether or not thinking is on.
 *   - A model that will run a **thinking** turn. Two providers are on record
 *     breaking on a prefill only while thinking — Ollama never opens the
 *     reasoning block behind a prefilled turn, so `message.thinking` comes
 *     back empty (bug 68), and DeepSeek 400s demanding the
 *     `reasoning_content` that produced an assistant turn a synthetic prefill
 *     never had (bug 85). They are also the population that needs the anchor
 *     least: a model spending tokens working out whose turn it is does not
 *     need `[Name]` put in its mouth. The question is asked per profile
 *     through `lib/llm/thinking-turn`, not per provider, so a thinking-off
 *     Ollama or DeepSeek profile keeps the stronger anchor.
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

/**
 * Providers whose models cannot take an assistant prefill at all, thinking or
 * not. Anthropic is the only genuine member: 4.6+ hard-rejects an assistant
 * tail. Resist adding a provider here because one of its *models* misbehaves —
 * that is what `runsThinkingTurn` is for (bug 85).
 */
const PREFILL_HOSTILE_PROVIDERS = new Set(['ANTHROPIC'])

/**
 * The value a newly created profile should start with.
 *
 * Off for Anthropic (4.6+ hard-rejects an assistant tail) and off for any
 * profile that will run a thinking turn (bugs 68 and 85); on everywhere else,
 * which is the historic behaviour and the stronger anchor for the weak models
 * that need one.
 *
 * `runsThinkingTurn` is the answer from `lib/llm/thinking-turn` — the caller
 * supplies it because working it out needs the provider plugin, which the
 * browser cannot reach. Omit it and only the provider rule applies.
 */
export function defaultMultiCharacterPrefill(
  provider: string | null | undefined,
  runsThinkingTurn = false
): boolean {
  if (runsThinkingTurn) return false
  if (!provider) return true
  return !PREFILL_HOSTILE_PROVIDERS.has(provider.toUpperCase())
}

/**
 * Whether this profile anchors a multi-character turn with the `[Name]`
 * prefill. An explicit stored choice always wins — including a stored `true`
 * on a thinking model, because the tri-state exists so the user may overrule
 * us — and a null/absent one falls back to the default above.
 */
export function profileUsesNamePrefill(
  profile: { provider?: string | null; multiCharacterPrefill?: boolean | null },
  runsThinkingTurn = false
): boolean {
  if (typeof profile.multiCharacterPrefill === 'boolean') {
    return profile.multiCharacterPrefill
  }
  return defaultMultiCharacterPrefill(profile.provider, runsThinkingTurn)
}
