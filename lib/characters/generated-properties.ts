/**
 * LLM-generated character properties (pronouns + aliases).
 *
 * Summon From Lore (lib/services/ai-import.service.ts) and the AI Wizard
 * (lib/services/character-wizard.service.ts) both ask a model for the same
 * `{ pronouns, aliases }` object and narrate the same one-line result to the
 * progress stream. The parse and the narration live here so the two runners
 * cannot drift.
 */

import { parseLLMJson } from '@/lib/llm/llm-json';
import type { Pronouns } from '@/lib/schemas/character.types';
import { sanitizePronouns } from './sanitize-pronouns';

export interface GeneratedProperties {
  pronouns: Pronouns | null;
  aliases: string[];
}

/**
 * Parse a properties response. Pronouns are sanitized (placeholders rejected)
 * and a model that answers with the bare pronouns object — the pre-aliases
 * response shape — is tolerated. Aliases keep only non-blank strings, trimmed.
 * Throws when the response is not JSON at all, like every other LLM parse.
 */
export function parseGeneratedProperties(raw: string): GeneratedProperties {
  const parsed = parseLLMJson<{ pronouns?: unknown; aliases?: unknown }>(raw);
  const pronouns = sanitizePronouns(parsed?.pronouns) ?? sanitizePronouns(parsed) ?? null;
  const aliases = Array.isArray(parsed?.aliases)
    ? parsed.aliases
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim())
    : [];
  return { pronouns, aliases };
}

/**
 * One-line progress snippet: `she/her/hers; aliases: Em, The Botanist`.
 * `missingPronounsLabel` stands in for the pronoun triple when none was
 * derivable — each runner has its own wording for that.
 */
export function describeGeneratedProperties(
  props: GeneratedProperties,
  missingPronounsLabel: string,
): string {
  const pronounText = props.pronouns
    ? `${props.pronouns.subject}/${props.pronouns.object}/${props.pronouns.possessive}`
    : missingPronounsLabel;
  const aliasText = props.aliases.length > 0 ? `aliases: ${props.aliases.join(', ')}` : 'no aliases';
  return `${pronounText}; ${aliasText}`;
}
