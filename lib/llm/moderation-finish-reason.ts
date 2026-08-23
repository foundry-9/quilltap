/**
 * Recognising a provider's "I refused this on content grounds" stop reason.
 *
 * Providers report a moderation refusal in the finish-reason field and then
 * return empty content. Quilltap had no branch for any of these strings (bug
 * 94), so a hard refusal reached the Salon as a blank message under the
 * generic "the model returned an empty response, this is a known issue with
 * some providers, try resending" copy — advice that cannot work, for a cause
 * the provider had stated plainly.
 *
 * The list is deliberately literal. A finish reason we don't recognise stays
 * unrecognised rather than being guessed at from a substring, because a false
 * positive tells the user their content was refused when it wasn't.
 *
 * @module llm/moderation-finish-reason
 */

/**
 * Finish reasons that mean "the provider declined to answer on content
 * grounds", lower-cased for comparison.
 *
 * - `sensitive` — Z.AI (GLM), observed on glm-5v-turbo
 * - `content_filter` — OpenAI Chat Completions and Azure OpenAI
 * - `refusal` — OpenAI Responses API
 * - `safety`, `prohibited_content`, `blocklist`, `spii`, `image_safety` —
 *   Google Gemini `finishReason`
 * - `recitation` — Google, a copyright rather than a safety stop, but the same
 *   shape of dead end from the user's point of view
 */
const MODERATION_FINISH_REASONS = new Set([
  'sensitive',
  'content_filter',
  'content-filter',
  'refusal',
  'safety',
  'prohibited_content',
  'blocklist',
  'spii',
  'image_safety',
  'recitation',
]);

/** True when this finish reason is a provider-side content refusal. */
export function isModerationFinishReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return MODERATION_FINISH_REASONS.has(reason.trim().toLowerCase());
}

/**
 * A sentence naming what happened, for the empty-response explanation. Returns
 * null when the reason isn't a moderation refusal, so callers can fall through
 * to their generic copy.
 */
export function describeModerationRefusal(
  reason: string | null | undefined,
  provider: string,
  modelName: string
): string | null {
  if (!isModerationFinishReason(reason)) return null;
  return (
    `${provider} ${modelName} refused this turn on content grounds — it reported ` +
    `\`finish_reason: ${reason}\` and returned nothing. This is the provider's own ` +
    `moderation layer, not a Quilltap error and not a transient fault: resending ` +
    `the same content will be refused again. Route the chat to an uncensored ` +
    `provider (Concierge settings), or change what is being asked for.`
  );
}
