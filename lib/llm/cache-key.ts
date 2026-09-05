/**
 * Provider prompt-cache keys.
 *
 * Builds the cache identifier Quilltap hands to provider plugins so each
 * character gets their own warm cache. The persona block (manifesto /
 * description / personality) sits high in the prompt, so it is the
 * character — not the chat — that determines the cacheable prefix.
 *
 * Each provider applies the key differently:
 *   - OpenAI / Grok: `prompt_cache_key` (sticky routing hint; without it
 *     requests above ~15 RPM shard across machines and degrade hit rate;
 *     on Grok, every request round-robins).
 *   - DeepSeek: `user_id` (KV-cache isolation namespace).
 *   - OpenAI-compatible / Z.AI / OpenRouter (OpenAI-routed): `user`.
 *   - Anthropic: ignored (uses content-hashed `cache_control` breakpoints).
 *   - Ollama / Curl: ignored (local KV / raw passthrough).
 *
 * `PROMPT_CACHE_STRUCTURE_VERSION` invalidates caches on intentional
 * structural changes (tool-schema, system-prompt structure, persona-block
 * format). Bump policy: see docs/developer/features/llm_api_costs_breakdown.md.
 *
 * @module llm/cache-key
 */

// Major version of the cacheable prompt structure. Bump when you change
// anything that should reset all provider caches: tool-schema shape, the
// system-prompt builder layout, persona-block format, or memory-pool format.
// Wording fixes and content edits don't require a bump.
//
// 1 — initial chatId-scoped structure (post-commit 68a9eba6).
// 2 — re-keyed to per-character (persona block became the actual prefix);
//     see docs/developer/features/per-character-prompt-caching.md.
// 3 — Taboo section added to the universal portion of the system prompt
//     (between the math note and tool instructions); see
//     docs/developer/features/complete/taboo.md.
// 4 — Standing-instructions section (project + group `instructions`) added
//     between the Taboo section and the tool instructions; see
//     lib/chat/context/standing-instructions.ts.
export const PROMPT_CACHE_STRUCTURE_VERSION = 4

export function buildCharacterCacheKey(characterId: string | undefined): string | undefined {
  if (!characterId) return undefined
  return `quilltap:char:${characterId}:v${PROMPT_CACHE_STRUCTURE_VERSION}`
}
