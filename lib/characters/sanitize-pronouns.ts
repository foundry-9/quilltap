/**
 * Pronoun sanitization for LLM-generated character data.
 *
 * Shared by Summon From Lore (lib/services/ai-import.service.ts) and the AI
 * Wizard's properties generation (lib/services/character-wizard.service.ts),
 * which both ask an LLM for a `{ subject, object, possessive }` pronouns
 * object and must reject placeholders before character create.
 */

const PRONOUN_PLACEHOLDERS = new Set([
  '', 'unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not specified', 'not given', 'tbd',
]);

// Validate a parsed pronouns response. Returns the trimmed object if all three
// fields are usable strings; otherwise returns undefined so the assembler stores null.
// PronounsSchema requires non-empty strings ≤20 chars on subject/object/possessive,
// so anything else would explode at character-create time.
// Exported for the AI Wizard's properties generation, which shares the contract.
export function sanitizePronouns(raw: unknown): { subject: string; object: string; possessive: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const fields = ['subject', 'object', 'possessive'] as const;
  const cleaned: Record<string, string> = {};
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 20) return undefined;
    if (PRONOUN_PLACEHOLDERS.has(trimmed.toLowerCase())) return undefined;
    cleaned[f] = trimmed;
  }
  return cleaned as { subject: string; object: string; possessive: string };
}
