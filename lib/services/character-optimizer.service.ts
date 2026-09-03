/**
 * Character Optimizer Service
 *
 * Analyzes a character's reinforced memories to identify behavioral patterns
 * that should be reflected in their configuration. Provides suggestions for
 * updating character fields (description, personality, scenario, etc.) based
 * on demonstrated behavior across interactions.
 *
 * Follows the same LLM orchestration pattern as ai-import.service.ts with
 * streaming progress updates and structured JSON responses.
 */

import { createLLMProvider } from '@/lib/llm';
import { profileParams } from '@/lib/llm/cheap-llm';
import { buildCharacterCacheKey } from '@/lib/llm/cache-key';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { logger } from '@/lib/logger';
import { rankMemoriesByWeight } from '@/lib/memory/memory-weighting';
import { parseLLMJson, stripCodeFences } from '@/lib/llm/llm-json';
import {
  FIELD_SEMANTICS_PREAMBLE,
  FULL_FIELD_SEMANTICS,
  PROPERTIES_SEMANTICS,
  WARDROBE_SEMANTICS,
} from '@/lib/services/character-field-semantics';
import { sanitizeGeneratedWardrobeItems, type GeneratedWardrobeItem } from '@/lib/wardrobe/generated-items';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { getCharacterVectorStore } from '@/lib/embedding/vector-store';
import { isEmbeddingAvailable } from '@/lib/embedding/embedding-service';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { Character, CharacterScenario, CharacterSystemPrompt, Memory } from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

// ============================================================================
// Types
// ============================================================================

export interface OptimizerSuggestion {
  id: string;
  field: 'identity' | 'description' | 'manifesto' | 'personality' | 'scenarios' | 'exampleDialogues' | 'systemPrompt' | 'physicalDescription' | 'talkativeness' | 'wardrobeItems' | 'aliases';
  /**
   * For an existing scenario, system prompt, or wardrobe item, the item's id.
   * For a `physicalDescription` suggestion, the sub-field key being refined —
   * one of `fullDescription | headAndShouldersPrompt | shortPrompt | mediumPrompt | longPrompt | completePrompt`.
   */
  subId?: string;
  subName?: string;
  title?: string;
  /** Suggested name for a brand-new system prompt or wardrobe item (only when no `subId`). */
  name?: string;
  currentValue: string;
  proposedValue: string;
  rationale: string;
  significance: number;
  memoryExcerpts: string[];
  /**
   * Structured payload for a brand-new wardrobe item (field='wardrobeItems',
   * no subId). `proposedValue` stays a human-readable summary for the review
   * card; the apply step persists this object.
   */
  wardrobeItem?: GeneratedWardrobeItem;
}

export interface BehavioralPattern {
  pattern: string;
  evidence: string;
  frequency: string;
}

export interface OptimizerAnalysis {
  behavioralPatterns: BehavioralPattern[];
  summary: string;
}

export type OptimizerProgressEventType =
  | 'start'
  | 'step_start'
  | 'step_complete'
  | 'substep_start'
  | 'substep_complete'
  | 'suggestions_file_written'
  | 'done'
  | 'error';
export type OptimizerStepName = 'loading' | 'analyzing' | 'generating';

export type OptimizerSubStepKind =
  | 'general'
  | 'scenario'
  | 'systemPrompt'
  | 'physicalDescription'
  | 'wardrobe'
  | 'properties'
  | 'newSystemPrompts';

export interface OptimizerSubStep {
  kind: OptimizerSubStepKind;
  label: string;
  index: number;
  total: number;
}

export type OptimizerOutputMode = 'apply' | 'suggestions-file';

export interface OptimizerProgressEvent {
  type: OptimizerProgressEventType;
  step?: OptimizerStepName;
  subStep?: OptimizerSubStep;
  analysis?: OptimizerAnalysis;
  suggestions?: OptimizerSuggestion[];
  partialSuggestions?: OptimizerSuggestion[];
  suggestionsFilePath?: string;
  error?: string;
  memoryCount?: number;
  filteredCount?: number;
}

export type OptimizerProgressCallback = (event: OptimizerProgressEvent) => void;

export interface OptimizerOptions {
  maxMemories?: number;
  searchQuery?: string;
  useSemanticSearch?: boolean;
  sinceDate?: string | null;
  beforeDate?: string | null;
  outputMode?: OptimizerOutputMode;
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_MESSAGE = `You are a character analysis assistant for Quilltap, a creative writing and roleplay platform. Your job is to analyze a character's accumulated memories and identify behavioral patterns that should be reflected in their configuration.

Key concepts:
- Characters can have MULTIPLE named scenarios. A scenario is a setting for a chat — it describes the environment, circumstances, and context in which an interaction takes place. Scenarios set the stage but do not fundamentally change the character's personality, voice, or behavior. Think of them as different locations or situations where the character might be encountered.
- Characters can have MULTIPLE named system prompts. Each system prompt provides different instructions for how the AI should roleplay the character, potentially for different contexts or styles of interaction.
- Characters have a WARDROBE of slot-typed clothing/accessory items (top, bottom, footwear, accessories, hair) that is separate from their physical description — the physical description covers only the person, nothing removable. The "hair" slot holds a hairstyle or hairdo (braided, permed, an updo, a wig) — the styling, not the hair itself; natural hair colour, length, and texture stay in the physical description.
- Characters have structured PROPERTIES: pronouns (read-only for you) and aliases (nicknames others actually call the character).

Always respond with ONLY valid JSON — no markdown code fences, no explanations, no extra text.`;

const MIN_REINFORCED_MEMORIES = 2;
const MAX_MEMORIES_FOR_ANALYSIS = 30;
const MIN_SIGNIFICANCE_THRESHOLD = 0.3;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Defensively coerce any value into a renderable string. The LLM sometimes
 * "structures" content that contains `{{user}}` / `{{char}}` template
 * placeholders into a JSON object like `{user: "...", char: "..."}` instead
 * of leaving the literal string alone — rendering that object as a React
 * child crashes the modal. Numbers/booleans become their string form,
 * null/undefined become empty string, and anything else is JSON-stringified.
 */
function coerceSuggestionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Defensively coerce a sub-step's parsed JSON into an array of suggestions.
 * The prompts ask for a bare JSON array, but a model periodically answers with
 * a wrapper object (`{"suggestions": [...]}`) or, when it has exactly one
 * amendment to offer, with a single bare suggestion object. Both parse
 * cleanly, so the parse guard never fires — and the array operations that
 * follow then threw a TypeError that aborted the whole optimization run,
 * discarding every suggestion the earlier sub-steps had already produced
 * (bug 119). Anything genuinely unusable becomes an empty array.
 */
export function coerceSuggestionArray(value: unknown): OptimizerSuggestion[] {
  if (Array.isArray(value)) return value as OptimizerSuggestion[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  // A wrapper object: take the first plausibly-named array property.
  for (const key of ['suggestions', 'items', 'results', 'data', 'amendments']) {
    if (Array.isArray(record[key])) return record[key] as OptimizerSuggestion[];
  }
  // A lone suggestion object, un-arrayed. `field` is the shape's fingerprint.
  if (typeof record.field === 'string') return [record as unknown as OptimizerSuggestion];
  return [];
}

/**
 * Build character context string from character data. `wardrobeItems` is the
 * character's current wardrobe (optional — omitted in some tests); it is shown
 * so suggestions can account for what the character already owns and wears.
 */
export function buildCharacterContext(character: Character, wardrobeItems?: WardrobeItem[]): string {
  const pronounText = character.pronouns
    ? `${character.pronouns.subject}/${character.pronouns.object}/${character.pronouns.possessive}`
    : '(not set)';
  const parts: string[] = [
    `=== Character: ${character.name} ===`,
    '',
    `Title (private label; read-only): ${character.title || '(empty)'}`,
    `Pronouns (read-only): ${pronounText}`,
    `Aliases: ${character.aliases && character.aliases.length > 0 ? character.aliases.join(', ') : '(none)'}`,
    '',
    `Identity:`,
    character.identity || '(empty)',
    '',
    `Description:`,
    character.description || '(empty)',
    '',
    `Manifesto:`,
    character.manifesto || '(empty)',
    '',
    `Personality:`,
    character.personality || '(empty)',
    '',
    `Scenarios:`,
    character.scenarios && character.scenarios.length > 0
      ? character.scenarios.map(s => `  - ${s.title}: ${s.content}`).join('\n')
      : '(empty)',
    '',
    `First Message:`,
    character.firstMessage || '(empty)',
    '',
    `Example Dialogues:`,
    character.exampleDialogues || '(empty)',
    '',
    `Talkativeness: ${character.talkativeness}`,
  ];

  if (character.systemPrompts && character.systemPrompts.length > 0) {
    parts.push('');
    parts.push('=== System Prompts ===');
    for (const sp of character.systemPrompts) {
      parts.push(`[System Prompt: "${sp.name}" (ID: ${sp.id})]`);
      parts.push(sp.content);
      parts.push('');
    }
  }

  if (character.physicalDescription) {
    const pd = character.physicalDescription;
    parts.push('=== Physical Description ===');
    parts.push(`[Physical Description: "${pd.name}" (ID: ${pd.id})]`);
    parts.push(`Head & Shoulders: ${pd.headAndShouldersPrompt || '(empty)'}`);
    parts.push(`Short: ${pd.shortPrompt || '(empty)'}`);
    parts.push(`Medium: ${pd.mediumPrompt || '(empty)'}`);
    parts.push(`Long: ${pd.longPrompt || '(empty)'}`);
    parts.push(`Complete: ${pd.completePrompt || '(empty)'}`);
    parts.push(`Full: ${pd.fullDescription || '(empty)'}`);
    parts.push('');
  }

  if (wardrobeItems && wardrobeItems.length > 0) {
    parts.push('=== Wardrobe ===');
    for (const item of wardrobeItems) {
      if (item.archivedAt) continue;
      const flags: string[] = [];
      if (item.isDefault) flags.push('default');
      if (item.componentItemIds && item.componentItemIds.length > 0) {
        flags.push(`composite of ${item.componentItemIds.length} item(s)`);
      }
      const flagText = flags.length > 0 ? ` [${flags.join('; ')}]` : '';
      parts.push(`[Wardrobe Item: "${item.title}" (ID: ${item.id})]${flagText}`);
      parts.push(`  Slots: ${item.types.join(', ')}`);
      if (item.appropriateness) parts.push(`  Appropriateness: ${item.appropriateness}`);
      parts.push(`  Description: ${item.description || '(empty)'}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Build memory context string from ranked memories
 */
export function buildMemoryContext(memories: Array<{ memory: Memory }>): string {
  const parts: string[] = [
    `=== Reinforced Memories (top ${memories.length}) ===`,
  ];

  for (let i = 0; i < memories.length; i++) {
    const { memory } = memories[i];
    parts.push(`[Memory #${i + 1}] (reinforced ${memory.reinforcementCount} times): ${memory.content}`);
  }

  return parts.join('\n');
}

/**
 * Get analysis prompt
 */
export function getAnalysisPrompt(): string {
  return `${FULL_FIELD_SEMANTICS}

Analyze this character's configuration alongside their most-reinforced memories. Identify 3-8 behavioral patterns that are established in the memories but not fully captured in the character's current configuration.

For every pattern you identify, decide which of the three editable fields (IDENTITY, DESCRIPTION, PERSONALITY) it is evidence for, using the vantage-point rule above. Patterns that demonstrate behavior visible to interlocutors → DESCRIPTION. Patterns that reveal the character's self-knowledge or inner drivers → PERSONALITY. Public-knowledge facts strangers could know on sight → IDENTITY. Patterns that don't fit any of these (e.g. environment) belong to scenarios and should still be surfaced.

Look for:
- Speech habits and verbal patterns (DESCRIPTION)
- Emotional tendencies and inner drivers (PERSONALITY)
- Relationship dynamics — outward (DESCRIPTION) vs. inward attitude (PERSONALITY)
- Behavioural quirks or consistent actions (DESCRIPTION)
- Self-knowledge, motivations, beliefs the character privately holds (PERSONALITY)
- Public-facing facts: station, occupation, reputation that strangers know on sight (IDENTITY)
- Recurring settings or environments that might warrant refining an existing scenario (remember: a scenario describes the setting/environment of a chat, not a change in the character's personality)
- Concrete physical/appearance details the memories establish — scars, hair, height (these inform the physical description, not behaviour)
- Habitual garments, outfits, or accessories the memories establish — a signature coat, a locket always worn (these inform the WARDROBE, never the physical description)
- Nicknames or alternate names other characters repeatedly use for this character (these inform the ALIASES property)

Respond with JSON:
{
  "behavioralPatterns": [
    {
      "pattern": "Brief description of the behavioral pattern",
      "evidence": "Specific examples from the memories that demonstrate this pattern",
      "frequency": "How often this appears across the memories"
    }
  ],
  "summary": "A 2-3 sentence overview of how the character has evolved through their interactions, highlighting the gap between their current configuration and their demonstrated behavior."
}`;
}

const SUGGESTION_SCHEMA_PREAMBLE = `Each suggestion object in the JSON array must follow this schema:
{
  "field": "identity|description|manifesto|personality|exampleDialogues|talkativeness|scenarios|systemPrompt|physicalDescription|wardrobeItems|aliases",
  "subId": "ID of the existing scenario, system prompt, or wardrobe item being updated (only when refining an existing item); for a physicalDescription suggestion, the sub-field key being refined — one of fullDescription, headAndShouldersPrompt, shortPrompt, mediumPrompt, longPrompt, completePrompt",
  "subName": "Human-readable name of the existing sub-item, or the label of the physical sub-field (only when subId is set)",
  "name": "Name for a NEW system prompt or wardrobe item (only when no subId is provided)",
  "currentValue": "The current text of the field/item being changed",
  "proposedValue": "The complete new text for the field/item",
  "rationale": "Why this change is suggested, referencing specific behavioral patterns",
  "significance": 0.5,
  "memoryExcerpts": ["Memory excerpt 1", "Memory excerpt 2"]
}

Rules that apply to every suggestion:
- Assign a significance score: 0.3+ = noticeable shift, 0.6+ = fundamental behavioral change.
- Include 1-3 memory excerpts that support the suggestion.
- Only propose changes that are meaningfully different from the current value.
- Preserve the character's existing voice and style while incorporating the behavioral patterns.
- Keep each field's form of address exactly as its definition states, even when the current value gets it wrong elsewhere: manifesto, personality, and system prompts speak TO the character ("You keep your worry behind your teeth"); identity and description speak ABOUT the character from outside ("She finishes other people's sentences"); physical-description sub-fields are bare noun phrases ("auburn hair cut short; grey eyes"). Never flip a field from one form to another while rewording it.
- Do NOT propose brand-new scenarios. Existing scenarios may be refined, but creating new scenarios is out of scope.
- Scenarios describe "where and when" (setting, environment, circumstances). They should not alter the character's personality, voice, or core behavior unless the environment itself demands it.`;

/**
 * Suggestions prompt for the general, character-wide fields: identity,
 * description, personality, exampleDialogues, and talkativeness. Per-item
 * scenario and system-prompt suggestions are produced by their own dedicated
 * passes.
 */
export function getGeneralFieldsSuggestionsPrompt(analysis: OptimizerAnalysis): string {
  return `${FIELD_SEMANTICS_PREAMBLE}

Based on the behavioral analysis below and the character's current configuration, propose targeted modifications to the character's GENERAL fields only:

  - identity (public-knowledge / outside-view facts only — name, station, occupation, reputation)
  - description (behavior, mannerisms, verbal patterns visible to interlocutors)
  - manifesto (the basic tenets, the axiomatic core; not a vantage-point field, it is the load-bearing truth the character is built on)
  - personality (the character's own self-knowledge; inner drivers of speech and behavior)
  - exampleDialogues
  - talkativeness (a number between 0.1 and 1.0)

The vantage-point rule is strict:
- A suggestion for IDENTITY may only contain facts a stranger could plausibly know without having spoken to the character. Never put internal motivation, private mannerisms, or self-knowledge here.
- A suggestion for DESCRIPTION must reflect things someone who has interacted with the character would notice — not the character's own internal monologue, and not surface-level public reputation.
- A suggestion for MANIFESTO should be rare and high-stakes — propose manifesto changes only when the memory contradicts a basic tenet, not for tonal or stylistic improvements. Manifesto edits reverberate across every other field.
- A suggestion for PERSONALITY must reflect the character's own self-knowledge and inner drivers. Never put outward behavior someone else would observe here, and never put public-facing identity facts.
- Do NOT propose the same content under two different fields. Pick the one whose vantage point matches.
- Do NOT suggest edits to title, scenarios, system prompts, the physical description, the wardrobe, or aliases in this response — those are out of scope for this pass (title is never editable here; the rest are each handled by their own dedicated passes).

If you see nothing worth changing in the general fields, respond with an empty JSON array.

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

${SUGGESTION_SCHEMA_PREAMBLE}

Respond with a JSON array of suggestion objects.`;
}

/**
 * Suggestions prompt scoped to a single scenario. Keeps the rest of the
 * character context available for grounding but asks the model to reason about
 * ONE scenario at a time so patterns particular to that setting don't get
 * averaged out across the character's whole set of scenarios.
 */
export function getScenarioSuggestionPrompt(
  analysis: OptimizerAnalysis,
  scenario: CharacterScenario,
): string {
  return `Focus solely on the following scenario. Decide whether its content should be refined to better reflect the demonstrated behavior below. A scenario describes the environment, circumstances, and context of a chat — it is the stage, not the actor. Refinements should sharpen the setting (place, circumstance, atmosphere, starting situation), not rewrite the character's personality.

=== Scenario Under Review ===
ID: ${scenario.id}
Title: ${scenario.title}
Current content:
${scenario.content || '(empty)'}

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

Produce at most ONE suggestion. If the current scenario is already an appropriate setting for the patterns observed, respond with an empty JSON array.

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to scenario refinement:
- Set field="scenarios" and subId="${scenario.id}".
- currentValue must be the existing scenario content verbatim.
- proposedValue must be a complete replacement for the scenario content.

Respond with a JSON array of at most one suggestion.`;
}

/**
 * Suggestions prompt scoped to a single system prompt. System prompts govern
 * how the AI roleplays the character in a given interaction style; each one
 * gets its own focused pass so suggestions can acknowledge the prompt's
 * intended style rather than being blended across all variants.
 */
export function getSystemPromptSuggestionPrompt(
  analysis: OptimizerAnalysis,
  prompt: CharacterSystemPrompt,
): string {
  return `Focus solely on the following system prompt. Decide whether its text should be refined to better reflect the demonstrated behavior below, while preserving the interaction style the prompt is clearly trying to achieve.

=== System Prompt Under Review ===
ID: ${prompt.id}
Name: ${prompt.name}
Is default variant: ${prompt.isDefault ? 'yes' : 'no'}
Current content:
${prompt.content || '(empty)'}

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

Produce at most ONE suggestion. If the current prompt already captures the patterns you would want to reinforce, respond with an empty JSON array.

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to system-prompt refinement:
- Set field="systemPrompt" and subId="${prompt.id}".
- currentValue must be the existing prompt content verbatim.
- proposedValue must be a complete replacement for the prompt content.
- Do NOT change the prompt's evident interaction style (e.g. a "terse" prompt should stay terse); only sharpen its articulation of the character.

Respond with a JSON array of at most one suggestion.`;
}

/**
 * Suggestions prompt scoped to the character's single physical description —
 * the prose appearance (physical-description.md) plus the tiered image-prompt
 * fields (physical-prompts.json). Asks the model to refine only the appearance
 * sub-fields the memories actually speak to. Each sub-field becomes its own
 * suggestion keyed by `subId` so the apply step can merge them back into the
 * one physicalDescription object.
 */
export function getPhysicalDescriptionSuggestionPrompt(
  analysis: OptimizerAnalysis,
  physical: Character['physicalDescription'] | null,
): string {
  const pd = physical ?? null;
  const current = pd
    ? [
        `Name: ${pd.name}`,
        `fullDescription: ${pd.fullDescription || '(empty)'}`,
        `headAndShouldersPrompt: ${pd.headAndShouldersPrompt || '(empty)'}`,
        `shortPrompt: ${pd.shortPrompt || '(empty)'}`,
        `mediumPrompt: ${pd.mediumPrompt || '(empty)'}`,
        `longPrompt: ${pd.longPrompt || '(empty)'}`,
        `completePrompt: ${pd.completePrompt || '(empty)'}`,
      ].join('\n')
    : '(this character has no physical description yet)';

  return `Focus solely on the character's PHYSICAL DESCRIPTION — their appearance. Decide whether any of its sub-fields should be refined to reflect concrete appearance details established in the memories. This is about how the character LOOKS, not how they behave; ignore behavioural patterns unless they imply a visible, physical trait (a habitual posture, a recurring article of dress, an acquired scar).

The physical description has these sub-fields:
- fullDescription — prose appearance description (the physical-description document)
- headAndShouldersPrompt — a tight head-and-shoulders portrait prompt for avatars: face, hair, expression, neckline and visible upper attire ONLY; never breasts, torso, waist, hips, legs, or any anatomy below the shoulders
- shortPrompt — a brief image-generation prompt (a few words / phrases)
- mediumPrompt — a moderately detailed image-generation prompt
- longPrompt — a detailed image-generation prompt
- completePrompt — the most complete image-generation prompt

=== Current Physical Description ===
${current}

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

Produce at most ONE suggestion per sub-field, and only for sub-fields the memories genuinely speak to. If the memories reveal nothing about the character's appearance, respond with an empty JSON array — this is the common case.

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to physical-description refinement:
- Set field="physicalDescription".
- Set subId to the exact sub-field key being changed: one of fullDescription, headAndShouldersPrompt, shortPrompt, mediumPrompt, longPrompt, completePrompt.
- Set subName to a human label for that sub-field (e.g. "Full Description", "Head & Shoulders", "Short Prompt", "Medium Prompt", "Long Prompt", "Complete Prompt").
- currentValue must be the existing text of that sub-field (empty string if it has none).
- proposedValue must be the complete new text for that sub-field.
- Keep the image prompts (headAndShoulders/short/medium/long/complete) in the comma-or-phrase style image models expect; keep fullDescription in prose.
- For headAndShouldersPrompt specifically: describe ONLY what a head-and-shoulders crop shows (face, hair, expression, neckline, visible upper attire). Never describe breasts, torso, waist, hips, legs, or any anatomy below the shoulders.

Respond with a JSON array of suggestion objects (may be empty).`;
}

/**
 * Suggestions prompt scoped to the character's wardrobe. Two kinds of
 * suggestions: refining an existing item's description, and proposing a
 * brand-new item the memories establish (a habitual garment, an acquired
 * accessory). New items carry a structured `wardrobeItem` payload; the apply
 * step persists it via the wardrobe API.
 */
export function getWardrobeSuggestionPrompt(
  analysis: OptimizerAnalysis,
  wardrobeItems: WardrobeItem[],
): string {
  const activeItems = wardrobeItems.filter((item) => !item.archivedAt);
  return `${WARDROBE_SEMANTICS}

Focus solely on the character's WARDROBE (shown in the character context above). Decide whether the memories establish anything about what the character habitually wears that the wardrobe does not yet capture. This is about removable things — clothing, outfits, accessories, and hairstyles. A bodily feature (scar, tattoo, fur) belongs to the physical description and must NEVER become a wardrobe item — with one deliberate exception: a hairSTYLE goes in the wardrobe's "hair" slot, while the hair's natural colour, length, and texture stay in the physical description.

Two kinds of suggestions are allowed:

1. REFINE an existing item's description. Set field="wardrobeItems" and subId to the item's ID (from the character context), subName to its title, currentValue to its existing description verbatim, and proposedValue to the complete new description.
2. ADD a new item the memories genuinely establish — a signature garment or accessory that appears repeatedly. Set field="wardrobeItems", omit subId, set name to the item's title, currentValue to the empty string, proposedValue to a one-or-two-sentence human-readable summary of the item, and include a "wardrobeItem" object:
   "wardrobeItem": {
     "title": "Short descriptive name",
     "description": "A sentence or two describing the item's appearance",
     "imagePrompt": "Terse literal visual cue for image generation (optional)",
     "types": ["top"],
     "appropriateness": "casual, everyday",
     "isDefault": false
   }
   Valid slot types: "top", "bottom", "footwear", "accessories", "hair"; a single garment may cover several slots (a dress is ["top","bottom"]; a braided updo is ["hair"]).

The character currently has ${activeItems.length} wardrobe item(s). Only propose what the memories genuinely support; if they reveal nothing about the character's clothing or accessories, respond with an empty JSON array — this is the common case. Never propose deleting items.

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

${SUGGESTION_SCHEMA_PREAMBLE}

Respond with a JSON array of suggestion objects (may be empty).`;
}

/**
 * Suggestions prompt scoped to the character's properties. Only alias
 * ADDITIONS may be proposed; pronouns are read-only context for the optimizer.
 */
export function getPropertiesSuggestionPrompt(
  analysis: OptimizerAnalysis,
  character: Character,
): string {
  const aliases = character.aliases ?? [];
  return `${PROPERTIES_SEMANTICS}

Focus solely on the character's ALIASES. Current aliases: ${aliases.length > 0 ? aliases.join(', ') : '(none)'}.

Decide whether the memories establish nicknames or alternate names that other characters repeatedly use for this character and that are missing from the alias list. Propose at most 3 additions — one suggestion per alias:
- Set field="aliases".
- currentValue is the current alias list joined with commas (or the empty string when there are none).
- proposedValue is the single new alias to add, exactly as others use it.
- Do NOT propose removing or renaming existing aliases, do NOT propose the character's primary name or their title/epithet, and do NOT propose one-off forms of address that only appeared once.
- Pronouns are read-only context for you — never propose pronoun changes.

If the memories establish no new aliases, respond with an empty JSON array — this is the common case.

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

${SUGGESTION_SCHEMA_PREAMBLE}

Respond with a JSON array of suggestion objects (may be empty).`;
}

/**
 * Suggestions prompt for proposing genuinely new system prompts based on
 * interaction styles the existing prompts don't already cover. New scenarios
 * are intentionally NOT proposed — only existing scenarios may be refined.
 */
export function getNewSystemPromptsSuggestionPrompt(analysis: OptimizerAnalysis): string {
  return `Review the character's existing system prompts (shown in the character context). Propose any NEW system prompts that are warranted by the behavioral patterns below but aren't already covered by the existing set. Do NOT propose edits to existing prompts here — this pass handles additions only. Do NOT propose new scenarios. If no new system prompt is warranted, respond with an empty JSON array.

=== Behavioural Analysis ===
${JSON.stringify(analysis, null, 2)}

${SUGGESTION_SCHEMA_PREAMBLE}

Additional rules specific to this pass:
- For each new system prompt: field="systemPrompt", omit subId, include a "name" field with a short descriptive label, and put the complete prompt text in proposedValue. currentValue should be the empty string.
- Be conservative: only propose a new prompt if there is a clear interaction style the existing set does not cover.

Respond with a JSON array of suggestion objects (may be empty).`;
}

type LLMProvider = Awaited<ReturnType<typeof createLLMProvider>>;

/**
 * Make an LLM call for the optimizer
 */
async function callOptimizerLLM(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  characterContext: string,
  memoryContext: string,
  instruction: string,
  options: {
    temperature: number;
    maxTokens: number;
  },
  characterId?: string,
  profileParameters?: Record<string, unknown>
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_MESSAGE },
    { role: 'user' as const, content: `${characterContext}\n\n---\n\n${memoryContext}\n\n---\n\n${instruction}` },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: modelName,
      messages,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      cacheKey: buildCharacterCacheKey(characterId),
      profileParameters,
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from model');
  }

  return response.content.trim();
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Run the character optimizer with streaming progress updates.
 * Analyzes a character's reinforced memories to identify behavioral patterns
 * and suggests configuration updates.
 */
export async function runCharacterOptimizer(
  characterId: string,
  connectionProfileId: string,
  userId: string,
  repos: RepositoryContainer,
  onProgress: OptimizerProgressCallback,
  options?: OptimizerOptions
): Promise<void> {
  const maxMemories = options?.maxMemories ?? MAX_MEMORIES_FOR_ANALYSIS;
  const searchQuery = options?.searchQuery?.trim() ?? '';
  const useSemanticSearch = options?.useSemanticSearch ?? true;
  const sinceDate = options?.sinceDate ?? null;
  const beforeDate = options?.beforeDate ?? null;

  logger.info('[CharacterOptimizer] Starting character optimization', {
    userId,
    characterId,
    connectionProfileId,
    maxMemories,
    searchQuery: searchQuery || '(none)',
    useSemanticSearch,
    sinceDate,
    beforeDate,
  });

  onProgress({ type: 'start' });

  try {
    // Step 1: Load character and memories
    onProgress({ type: 'step_start', step: 'loading' });

    const character = await repos.characters.findById(characterId);
    if (!character || character.userId !== userId) {
      throw new Error('Character not found');
    }

    // Memory retrieval pipeline: search → date filter → rank → reinforcement filter → limit.
    //
    // The optimizer only learns from memories ABOUT the character (self-references:
    // aboutCharacterId === characterId). Inter-character memories the character holds
    // about other participants would skew behavioral-pattern analysis toward those
    // others' habits. Legacy null-aboutCharacterId rows are excluded by design — the
    // post-attribution-overhaul pipeline collapses self-references to characterId, so
    // the null pile is genuinely unattributed and not a fallback for "self".
    let candidateMemories: Memory[] = [];

    if (searchQuery) {
      if (useSemanticSearch) {
        // Try semantic search first, fall back to text search
        let usedSemantic = false;
        try {
          const embeddingAvailable = await isEmbeddingAvailable(userId);
          if (embeddingAvailable) {
            const embeddingResult = await generateEmbeddingForUser(searchQuery, userId, undefined, { priority: 'background' });
            const vectorStore = await getCharacterVectorStore(characterId);
            const results = vectorStore.search(embeddingResult.embedding, 500);
            const matchedIds = new Set(results.map(r => r.id));
            const aboutSelf = await repos.memories.findByCharacterAboutCharacter(characterId, characterId);
            candidateMemories = aboutSelf.filter(m => matchedIds.has(m.id));
            usedSemantic = true;
          }
        } catch (err) {
          logger.warn('[CharacterOptimizer] Semantic search failed, falling back to text search', {
            characterId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (!usedSemantic) {
          candidateMemories = await repos.memories.searchByContentAboutCharacter(characterId, characterId, searchQuery);
        }
      } else {
        // Text search only
        candidateMemories = await repos.memories.searchByContentAboutCharacter(characterId, characterId, searchQuery);
      }
    } else {
      // No search query — load all about-self memories
      candidateMemories = await repos.memories.findByCharacterAboutCharacter(characterId, characterId);
    }

    // Apply date filters
    if (sinceDate) {
      const sinceTimestamp = new Date(`${sinceDate}T00:00:00.000Z`).getTime();
      candidateMemories = candidateMemories.filter(m => new Date(m.createdAt).getTime() >= sinceTimestamp);
    }
    if (beforeDate) {
      const beforeTimestamp = new Date(`${beforeDate}T00:00:00.000Z`).getTime();
      candidateMemories = candidateMemories.filter(m => new Date(m.createdAt).getTime() < beforeTimestamp);
    }

    // Rank by weight and filter by reinforcement
    const ranked = rankMemoriesByWeight(candidateMemories);
    const reinforced = ranked.filter(({ memory }) => memory.reinforcementCount >= MIN_REINFORCED_MEMORIES);
    const filteredCount = reinforced.length;
    const qualifyingMemories = reinforced.slice(0, maxMemories);


    onProgress({
      type: 'step_complete',
      step: 'loading',
      memoryCount: qualifyingMemories.length,
      filteredCount,
    });

    // Check if we have enough memories
    if (qualifyingMemories.length < MIN_REINFORCED_MEMORIES) {
      logger.info('[CharacterOptimizer] Not enough reinforced memories for analysis', {
        characterId,
        found: qualifyingMemories.length,
        required: MIN_REINFORCED_MEMORIES,
      });

      onProgress({
        type: 'done',
        analysis: {
          behavioralPatterns: [],
          summary: 'Not enough reinforced memories to analyze.',
        },
        suggestions: [],
      });
      return;
    }

    // Step 2: Perform analysis
    onProgress({ type: 'step_start', step: 'analyzing' });

    const profile = await repos.connections.findById(connectionProfileId);
    if (!profile || profile.userId !== userId) {
      throw new Error('Connection profile not found');
    }

    // Get API key
    let apiKey = '';
    if (profile.apiKeyId) {
      const keyRecord = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
      if (keyRecord) {
        apiKey = keyRecord.key_value;
      }
    }

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins();
      if (!initResult.success) {
        throw new Error('Plugin system initialization failed');
      }
    }

    // Create LLM provider
    const provider = await createLLMProvider(profile.provider, profile.baseUrl || undefined);

    // Build context strings (wardrobe rides along so every pass can see what
    // the character already owns and wears)
    const wardrobeItems = await repos.wardrobe.findByCharacterId(characterId);
    const characterContext = buildCharacterContext(character, wardrobeItems);
    const memoryContext = buildMemoryContext(qualifyingMemories);

    // Call LLM for analysis
    const analysisStartedAt = Date.now();
    const analysisRaw = await callOptimizerLLM(
      provider,
      apiKey,
      profile.modelName,
      characterContext,
      memoryContext,
      getAnalysisPrompt(),
      { temperature: 0.5, maxTokens: 8000 },
      characterId,
      profileParams(profile)
    );
    const analysisDurationMs = Date.now() - analysisStartedAt;

    let analysis: OptimizerAnalysis;
    try {
      analysis = parseLLMJson<OptimizerAnalysis>(analysisRaw);
    } catch (parseError) {
      logger.error('[CharacterOptimizer] Failed to parse analysis JSON', {
        characterId,
        rawLength: analysisRaw.length,
        rawTail: analysisRaw.slice(-200),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }

    // Log the LLM call
    await logLLMCall({
      userId,
      type: 'CHARACTER_OPTIMIZER',
      characterId,
      provider: profile.provider,
      modelName: profile.modelName,
      connectionProfileId: profile.id,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: `[character context + memory context + analysis instruction]` },
        ],
        temperature: 0.5,
        maxTokens: 8000,
      },
      response: {
        content: analysisRaw.substring(0, 500),
        error: undefined,
      },
      durationMs: analysisDurationMs,
    }).catch(err => {
      logger.warn('[CharacterOptimizer] Failed to log analysis LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    onProgress({
      type: 'step_complete',
      step: 'analyzing',
      analysis,
    });

    // Step 3: Generate suggestions, one focused pass per sub-step. Each pass
    // runs the same character+memory context through the LLM but with a
    // prompt that constrains it to a single concern (general fields, a
    // specific scenario, a specific system prompt, or proposing new items),
    // so per-item patterns don't get averaged out across siblings.
    onProgress({ type: 'step_start', step: 'generating' });

    const existingScenarios: CharacterScenario[] = character.scenarios ?? [];
    const existingPrompts: CharacterSystemPrompt[] = character.systemPrompts ?? [];

    const subSteps: Array<{ kind: OptimizerSubStepKind; label: string }> = [
      { kind: 'general', label: 'General fields' },
      ...existingScenarios.map((s) => ({
        kind: 'scenario' as OptimizerSubStepKind,
        label: `Scenario: ${s.title}`,
      })),
      ...existingPrompts.map((p) => ({
        kind: 'systemPrompt' as OptimizerSubStepKind,
        label: `System prompt: ${p.name}`,
      })),
      { kind: 'physicalDescription', label: 'Physical description' },
      { kind: 'wardrobe', label: 'Wardrobe' },
      { kind: 'properties', label: 'Aliases' },
      { kind: 'newSystemPrompts', label: 'Proposed new system prompts' },
    ];
    const totalSubSteps = subSteps.length;
    let subStepIndex = 0;
    const allSuggestions: OptimizerSuggestion[] = [];

    const runSubStepCore = async (
      kind: OptimizerSubStepKind,
      label: string,
      instruction: string,
    ): Promise<void> => {
      const index = ++subStepIndex;
      const subStep: OptimizerSubStep = { kind, label, index, total: totalSubSteps };
      onProgress({ type: 'substep_start', step: 'generating', subStep });

      let raw: string;
      let subStepDurationMs = 0;
      const subStepStartedAt = Date.now();
      try {
        raw = await callOptimizerLLM(
          provider,
          apiKey,
          profile.modelName,
          characterContext,
          memoryContext,
          instruction,
          { temperature: 0.7, maxTokens: 6000 },
          characterId,
          profileParams(profile),
        );
        subStepDurationMs = Date.now() - subStepStartedAt;
      } catch (callError) {
        logger.warn('[CharacterOptimizer] Sub-step LLM call failed; continuing', {
          characterId,
          subStep: label,
          error: callError instanceof Error ? callError.message : String(callError),
        });
        onProgress({ type: 'substep_complete', step: 'generating', subStep, partialSuggestions: [] });
        return;
      }

      let parsed: OptimizerSuggestion[] = [];
      try {
        const rawParsed = parseLLMJson<unknown>(raw);
        parsed = coerceSuggestionArray(rawParsed);
        if (!Array.isArray(rawParsed)) {
          logger.warn('[CharacterOptimizer] Sub-step answered with a non-array; coerced', {
            characterId,
            subStep: label,
            parsedType: Array.isArray(rawParsed) ? 'array' : typeof rawParsed,
            recovered: parsed.length,
          });
        }
      } catch (parseError) {
        logger.warn('[CharacterOptimizer] Sub-step produced unparseable JSON; skipping', {
          characterId,
          subStep: label,
          rawTail: raw.slice(-200),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        parsed = [];
      }

      const filtered = parsed
        .filter((s) => s && typeof s.significance === 'number' && s.significance >= MIN_SIGNIFICANCE_THRESHOLD)
        .map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          // The LLM occasionally serializes scenario/prompt bodies that contain
          // `{{user}}` / `{{char}}` template placeholders as JSON objects
          // instead of leaving them as literal strings, which then crashes
          // React when SuggestionCard tries to render them as children.
          // Coerce every text-bearing field defensively so a malformed
          // sub-call response can't take down the modal.
          currentValue: coerceSuggestionText(s.currentValue),
          proposedValue: coerceSuggestionText(s.proposedValue),
          rationale: coerceSuggestionText(s.rationale),
          memoryExcerpts: Array.isArray(s.memoryExcerpts)
            ? s.memoryExcerpts.map(coerceSuggestionText)
            : [],
          // A brand-new wardrobe item must carry a valid structured payload;
          // sanitize it (slot types, coerced flags) and let the filter below
          // drop the suggestion if nothing survives.
          wardrobeItem:
            s.field === 'wardrobeItems' && !s.subId && s.wardrobeItem
              ? sanitizeGeneratedWardrobeItems([s.wardrobeItem])[0]
              : undefined,
        }))
        .filter((s) => !(s.field === 'wardrobeItems' && !s.subId && !s.wardrobeItem));

      allSuggestions.push(...filtered);

      await logLLMCall({
        userId,
        type: 'CHARACTER_OPTIMIZER',
        characterId,
        provider: profile.provider,
        modelName: profile.modelName,
        connectionProfileId: profile.id,
        request: {
          messages: [
            { role: 'system', content: SYSTEM_MESSAGE },
            { role: 'user', content: `[character context + memory context + ${label} instruction]` },
          ],
          temperature: 0.7,
          maxTokens: 6000,
        },
        response: {
          content: raw.substring(0, 500),
          error: undefined,
        },
        durationMs: subStepDurationMs,
      }).catch((err) => {
        logger.warn('[CharacterOptimizer] Failed to log sub-step LLM call', {
          subStep: label,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      onProgress({
        type: 'substep_complete',
        step: 'generating',
        subStep,
        partialSuggestions: filtered,
      });
    };

    /**
     * One misbehaving sub-step must never cost the run. Every sub-step is a
     * self-contained pass whose only output is appended to `allSuggestions`,
     * so an unexpected throw is logged and skipped rather than aborting the
     * whole optimization and discarding the suggestions already gathered
     * (bug 119).
     */
    const runSubStep = async (
      kind: OptimizerSubStepKind,
      label: string,
      instruction: string,
    ): Promise<void> => {
      try {
        await runSubStepCore(kind, label, instruction);
      } catch (subStepError) {
        logger.error(
          '[CharacterOptimizer] Sub-step failed unexpectedly; continuing',
          { characterId, subStep: label },
          subStepError instanceof Error ? subStepError : undefined,
        );
        onProgress({ type: 'substep_complete', step: 'generating', partialSuggestions: [] });
      }
    };

    await runSubStep(
      'general',
      'General fields',
      getGeneralFieldsSuggestionsPrompt(analysis),
    );

    for (const scenario of existingScenarios) {
      await runSubStep(
        'scenario',
        `Scenario: ${scenario.title}`,
        getScenarioSuggestionPrompt(analysis, scenario),
      );
    }

    for (const prompt of existingPrompts) {
      await runSubStep(
        'systemPrompt',
        `System prompt: ${prompt.name}`,
        getSystemPromptSuggestionPrompt(analysis, prompt),
      );
    }

    await runSubStep(
      'physicalDescription',
      'Physical description',
      getPhysicalDescriptionSuggestionPrompt(analysis, character.physicalDescription ?? null),
    );

    await runSubStep(
      'wardrobe',
      'Wardrobe',
      getWardrobeSuggestionPrompt(analysis, wardrobeItems),
    );

    await runSubStep(
      'properties',
      'Aliases',
      getPropertiesSuggestionPrompt(analysis, character),
    );

    await runSubStep(
      'newSystemPrompts',
      'Proposed new system prompts',
      getNewSystemPromptsSuggestionPrompt(analysis),
    );

    const suggestions = allSuggestions;

    onProgress({
      type: 'step_complete',
      step: 'generating',
      suggestions,
    });

    // Optional: write the aggregated suggestions into the character's vault
    // as a markdown document so the user (or the character, in-chat) can
    // review and discuss them without applying anything to the live config.
    const outputMode: OptimizerOutputMode = options?.outputMode ?? 'apply';
    let suggestionsFilePath: string | undefined;
    if (outputMode === 'suggestions-file') {
      if (!character.characterDocumentMountPointId) {
        throw new Error('Suggestions-file mode requires the character to be linked to a document-store vault.');
      }
      suggestionsFilePath = await writeSuggestionsFileToVault(
        character.characterDocumentMountPointId,
        character,
        analysis,
        suggestions,
        qualifyingMemories.length,
        profile.modelName,
      );
      onProgress({
        type: 'suggestions_file_written',
        suggestionsFilePath,
      });
    }

    // Done
    logger.info('[CharacterOptimizer] Character optimization complete', {
      characterId,
      characterName: character.name,
      patternCount: analysis.behavioralPatterns.length,
      suggestionCount: suggestions.length,
      outputMode,
      suggestionsFilePath,
    });

    onProgress({
      type: 'done',
      analysis,
      suggestions,
      suggestionsFilePath,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Character optimization failed';
    logger.error('[CharacterOptimizer] Optimization failed', {
      characterId,
      userId,
      error: errorMessage,
    });

    onProgress({
      type: 'error',
      error: errorMessage,
    });
  }
}

// ============================================================================
// Suggestions-file writer
// ============================================================================

const SUGGESTIONS_FOLDER = 'Suggestions';

/**
 * Render the optimizer's analysis + suggestions as a human-reviewable markdown
 * document and write it into the character's vault under
 * `Suggestions/refinement-<timestamp>.md`. Each suggestion becomes its own
 * section so a reader can work through them one at a time with the character
 * in-chat before anything is applied.
 */
async function writeSuggestionsFileToVault(
  mountPointId: string,
  character: Character,
  analysis: OptimizerAnalysis,
  suggestions: OptimizerSuggestion[],
  memoryCount: number,
  modelName: string,
): Promise<string> {
  const now = new Date();
  const stampIso = now.toISOString();
  const stampFile = stampIso.replace(/[:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const relativePath = `${SUGGESTIONS_FOLDER}/refinement-${stampFile}.md`;

  const content = renderSuggestionsMarkdown(
    character,
    analysis,
    suggestions,
    memoryCount,
    modelName,
    stampIso,
  );

  await writeDatabaseDocument(mountPointId, relativePath, content);

  logger.info('[CharacterOptimizer] Wrote suggestions file to vault', {
    characterId: character.id,
    mountPointId,
    relativePath,
    suggestionCount: suggestions.length,
  });

  return relativePath;
}

function renderSuggestionsMarkdown(
  character: Character,
  analysis: OptimizerAnalysis,
  suggestions: OptimizerSuggestion[],
  memoryCount: number,
  modelName: string,
  generatedAt: string,
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: character-suggestions');
  lines.push(`generatedAt: ${generatedAt}`);
  lines.push(`characterId: ${character.id}`);
  lines.push(`characterName: ${yamlString(character.name)}`);
  lines.push(`model: ${yamlString(modelName)}`);
  lines.push(`memoryCount: ${memoryCount}`);
  lines.push(`suggestionCount: ${suggestions.length}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Refinement Suggestions — ${generatedAt.slice(0, 10)}`);
  lines.push('');
  lines.push(
    `The automata have consulted ${memoryCount} memoir${memoryCount === 1 ? '' : 's'} from ${character.name}'s Commonplace Book and offer the following proposals for the consideration of author and character alike. Nothing herein has been applied — treat this as an itinerary of possible refinements, to be debated, amended, rejected, or commissioned at your leisure.`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(analysis.summary || '_(no summary provided)_');
  lines.push('');

  if (analysis.behavioralPatterns.length > 0) {
    lines.push('## Behavioural Patterns Observed');
    lines.push('');
    for (let i = 0; i < analysis.behavioralPatterns.length; i++) {
      const bp = analysis.behavioralPatterns[i];
      lines.push(`### ${i + 1}. ${bp.pattern}`);
      lines.push('');
      lines.push(`**Evidence:** ${bp.evidence}`);
      lines.push('');
      lines.push(`**Frequency:** ${bp.frequency}`);
      lines.push('');
    }
  }

  lines.push('## Proposed Changes');
  lines.push('');
  if (suggestions.length === 0) {
    lines.push('_No changes of sufficient significance were proposed._');
    lines.push('');
  } else {
    const grouped = groupSuggestionsForReport(suggestions);
    for (const group of grouped) {
      lines.push(`### ${group.heading}`);
      lines.push('');
      for (const s of group.items) {
        lines.push(`#### ${describeSuggestion(s)}`);
        lines.push('');
        lines.push(`- **Significance:** ${(s.significance ?? 0).toFixed(2)}`);
        if (s.rationale) {
          lines.push(`- **Rationale:** ${s.rationale}`);
        }
        lines.push('');
        lines.push('**Current:**');
        lines.push('');
        lines.push(fenceOrEmpty(s.currentValue));
        lines.push('');
        lines.push('**Proposed:**');
        lines.push('');
        lines.push(fenceOrEmpty(s.proposedValue));
        lines.push('');
        if (s.memoryExcerpts && s.memoryExcerpts.length > 0) {
          lines.push('**Supporting memoirs:**');
          lines.push('');
          for (const excerpt of s.memoryExcerpts) {
            lines.push(`> ${excerpt.replace(/\n/g, '\n> ')}`);
            lines.push('');
          }
        }
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_Generated by Quilltap\'s Character Optimizer in suggestions-file mode. Discuss at leisure; apply only what rings true._',
  );
  lines.push('');

  return lines.join('\n');
}

interface SuggestionGroup {
  heading: string;
  items: OptimizerSuggestion[];
}

function groupSuggestionsForReport(suggestions: OptimizerSuggestion[]): SuggestionGroup[] {
  const general: OptimizerSuggestion[] = [];
  const scenarioUpdates: OptimizerSuggestion[] = [];
  const promptUpdates: OptimizerSuggestion[] = [];
  const promptNew: OptimizerSuggestion[] = [];
  const physical: OptimizerSuggestion[] = [];
  const wardrobe: OptimizerSuggestion[] = [];
  const aliases: OptimizerSuggestion[] = [];
  const other: OptimizerSuggestion[] = [];

  for (const s of suggestions) {
    if (s.field === 'scenarios') {
      // New scenarios are no longer proposed; every scenario suggestion is a refinement.
      scenarioUpdates.push(s);
    } else if (s.field === 'systemPrompt') {
      (s.subId ? promptUpdates : promptNew).push(s);
    } else if (s.field === 'physicalDescription') {
      physical.push(s);
    } else if (s.field === 'wardrobeItems') {
      wardrobe.push(s);
    } else if (s.field === 'aliases') {
      aliases.push(s);
    } else if (
      s.field === 'identity' ||
      s.field === 'description' ||
      s.field === 'manifesto' ||
      s.field === 'personality' ||
      s.field === 'exampleDialogues' ||
      s.field === 'talkativeness'
    ) {
      general.push(s);
    } else {
      other.push(s);
    }
  }

  const groups: SuggestionGroup[] = [];
  if (general.length > 0) groups.push({ heading: 'General Fields', items: general });
  if (scenarioUpdates.length > 0) groups.push({ heading: 'Scenario Refinements', items: scenarioUpdates });
  if (physical.length > 0) groups.push({ heading: 'Physical Description', items: physical });
  if (wardrobe.length > 0) groups.push({ heading: 'Wardrobe', items: wardrobe });
  if (aliases.length > 0) groups.push({ heading: 'Aliases', items: aliases });
  if (promptUpdates.length > 0) groups.push({ heading: 'System Prompt Refinements', items: promptUpdates });
  if (promptNew.length > 0) groups.push({ heading: 'Proposed New System Prompts', items: promptNew });
  if (other.length > 0) groups.push({ heading: 'Other', items: other });
  return groups;
}

function describeSuggestion(s: OptimizerSuggestion): string {
  if (s.field === 'scenarios') {
    return `Scenario: ${s.subName ?? s.title ?? s.subId ?? ''}`.trimEnd();
  }
  if (s.field === 'systemPrompt') {
    if (s.subId) return `System prompt: ${s.subName ?? s.subId}`;
    return `New system prompt${s.name ? `: ${s.name}` : ''}`;
  }
  if (s.field === 'physicalDescription') {
    return `Physical description${s.subName ? `: ${s.subName}` : ''}`;
  }
  if (s.field === 'wardrobeItems') {
    if (s.subId) return `Wardrobe item: ${s.subName ?? s.subId}`;
    return `New wardrobe item${s.name ? `: ${s.name}` : ''}`;
  }
  if (s.field === 'aliases') {
    return `New alias${s.proposedValue ? `: ${s.proposedValue}` : ''}`;
  }
  switch (s.field) {
    case 'identity':
      return 'Identity';
    case 'description':
      return 'Description';
    case 'manifesto':
      return 'Manifesto';
    case 'personality':
      return 'Personality';
    case 'exampleDialogues':
      return 'Example dialogues';
    case 'talkativeness':
      return 'Talkativeness';
    default:
      return s.field;
  }
}

function fenceOrEmpty(value: string): string {
  if (!value || value.trim() === '') return '_(empty)_';
  return ['```', value, '```'].join('\n');
}

function yamlString(value: string): string {
  // Quote-safe single-line YAML string. Any multi-line input is collapsed
  // (the rendered body contains the full text anyway; this is just the
  // frontmatter summary).
  const single = value.replace(/[\r\n]+/g, ' ').trim();
  return `"${single.replace(/"/g, '\\"')}"`;
}
