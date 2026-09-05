/**
 * "Will this profile run a thinking turn?" — the one question, one answer.
 *
 * Thinking is not just a display feature. It changes what a request may look
 * like, and two providers are on record refusing an assistant `[Name]` prefill
 * *only* while thinking:
 *
 *   - **Ollama** opens a thinking model's reasoning block from the chat
 *     template at the start of the assistant turn, so a prefill means the
 *     block is never opened and `message.thinking` comes back empty (bug 68);
 *   - **DeepSeek** 400s with *"The `reasoning_content` in the thinking mode
 *     must be passed back to the API"* on a request that ends with an
 *     assistant turn it never produced the reasoning for (bug 85).
 *
 * Both were discovered the hard way because the multi-character prefill
 * default was provider-shaped when the property it was trying to capture is
 * *model*-shaped. This module supplies the model-shaped answer that
 * `lib/llm/multi-character-prefill` now asks for.
 *
 * Two facts make it up, because providers differ on where the truth lives:
 *
 *   1. **The profile's explicit choice** — a `thinkingTurnRule` declared by
 *      the provider plugin names the `parameters` key that switches thinking
 *      on or off, and which values mean which. Only the plugin knows its own
 *      option keys; the host reading them by hand is exactly what bug 68
 *      refused.
 *   2. **The model's own habit** — `ModelInfo.thinksByDefault`, consulted when
 *      the profile says nothing. `deepseek-v4-flash` reasons with
 *      `parameters: '{}'`; Anthropic and Ollama thinking are opt-in.
 *
 * The rule is declarative rather than a predicate function on purpose: the
 * connection-profile editor needs the same answer in the browser, where a
 * server-side plugin closure cannot be called. A rule serialises out through
 * `/api/v1/providers`; a closure does not. `evaluateThinkingTurn` below is
 * pure and is the shared evaluator for both sides — never re-derive it.
 *
 * @module lib/llm/thinking-turn
 */

import type { ThinkingTurnRule } from '@quilltap/plugin-types'

export type { ThinkingTurnRule }

/** The two model facts this module cares about, as the wire carries them. */
export interface ThinkingModelFacts {
  supportsThinking?: boolean
  thinksByDefault?: boolean
}

/** Everything needed to answer the question, from either side of the wire. */
export interface ThinkingTurnInputs {
  /** The provider plugin's declared rule, if it has one. */
  rule?: ThinkingTurnRule | null
  /** The profile's stored `parameters` map. */
  parameters?: Record<string, unknown> | null
  /** Static facts about the profile's selected model, if known. */
  model?: ThinkingModelFacts | null
}

/**
 * A profile option is "unset" when it is absent, null, or the empty string —
 * the last being how every enum field in the options schema spells
 * "(model default)".
 */
function isUnset(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Whether a profile with these inputs will run a thinking turn.
 *
 * An explicit choice in the profile's parameters always wins; absent one, the
 * model's own habit decides; absent that, the answer is no. Pure — safe on
 * the client, in a migration, and in the request path alike.
 */
export function evaluateThinkingTurn(inputs: ThinkingTurnInputs): boolean {
  const { rule, parameters, model } = inputs

  if (rule) {
    const value = parameters?.[rule.optionKey]
    if (!isUnset(value)) {
      if (rule.disabledValues?.some((v) => v === value)) return false
      if (rule.enabledValues?.some((v) => v === value)) return true
    }
  }

  return model?.thinksByDefault === true
}
