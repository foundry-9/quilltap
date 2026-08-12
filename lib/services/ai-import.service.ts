/**
 * AI Character Import Service
 *
 * Multi-call LLM orchestration service that analyzes source material (wiki pages,
 * story documents, character sheets, freeform notes) and generates a complete
 * character in .qtap export format for import via the existing import system.
 *
 * Each LLM call extracts/generates one aspect of the character. The service
 * assembles the final .qtap structure programmatically (UUIDs, timestamps, manifest).
 */

import { createLLMProvider } from '@/lib/llm';
import { profileParams } from '@/lib/llm/cheap-llm';

import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { extractFileContent } from '@/lib/services/file-content-extractor';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { validateQtapExport } from '@/lib/validation/qtap-schema-validator';
import { FIELD_SEMANTICS_PREAMBLE } from '@/lib/services/character-field-semantics';
import { logger } from '@/lib/logger';
import packageJson from '@/package.json';
import type { ConnectionProfile } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { QuilltapExport } from '@/lib/export/types';

// ============================================================================
// Types
// ============================================================================

export interface AIImportRequest {
  profileId: string;
  sourceFileIds: string[];
  sourceText: string;
  includeMemories: boolean;
  includeChats: boolean;
  existingResult?: Partial<AIImportStepResults>;
  regenerateSteps?: AIImportStepName[];
}

export type AIImportStepName =
  | 'analyzing'
  | 'character_basics'
  | 'first_message'
  | 'system_prompts'
  | 'physical_descriptions'
  | 'wardrobe_items'
  | 'pronouns'
  | 'memories'
  | 'chats'
  | 'assembly'
  | 'validation'
  | 'repair';

export type AIImportProgressEventType =
  | 'start'
  | 'step_start'
  | 'step_complete'
  | 'step_error'
  | 'done';

export interface AIImportProgressEvent {
  type: AIImportProgressEventType;
  step?: AIImportStepName;
  snippet?: string;
  result?: QuilltapExport;
  stepResults?: AIImportStepResults;
  errors?: Record<string, string>;
  error?: string;
}

export type AIImportProgressCallback = (event: AIImportProgressEvent) => void;

/** Results from individual LLM steps, keyed by step name */
export interface AIImportStepResults {
  analyzing?: string;
  character_basics?: {
    name: string;
    title?: string;
    identity?: string;
    description?: string;
    manifesto?: string;
    personality?: string;
    scenario?: string;
  };
  first_message?: {
    firstMessage?: string;
    exampleDialogues?: string;
  };
  system_prompts?: Array<{
    name: string;
    content: string;
    isDefault: boolean;
  }>;
  physical_descriptions?: {
    headAndShouldersPrompt: string;
    shortPrompt: string;
    mediumPrompt: string;
    longPrompt: string;
    completePrompt: string;
    fullDescription: string;
  };
  wardrobe_items?: Array<{
    title: string;
    description: string;
    types: string[];
    appropriateness?: string;
  }>;
  pronouns?: {
    subject: string;
    object: string;
    possessive: string;
  };
  memories?: Array<{
    content: string;
    summary: string;
    keywords: string[];
    importance: number;
  }>;
  chats?: {
    title: string;
    messages: Array<{
      role: 'USER' | 'ASSISTANT';
      content: string;
    }>;
  };
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_MESSAGE = `You are a character extraction assistant for Quilltap, a creative writing and roleplay platform. Your job is to analyze source material about a character and extract or generate structured character data. Always respond with ONLY valid JSON — no markdown code fences, no explanations, no extra text.`;

const SOURCE_ANALYSIS_THRESHOLD = 30000;
const MAX_REPAIR_ATTEMPTS = 2;

// ============================================================================
// Prompt Templates
// ============================================================================

function getAnalyzingPrompt(sourceLength: number): string {
  return `The following source material is ${sourceLength} characters long. Analyze it and provide a structured summary to guide character extraction.

Respond with JSON:
{
  "characterName": "the character's name if found",
  "setting": "the world/setting description",
  "keyTraits": ["trait1", "trait2"],
  "relationships": ["relationship1"],
  "physicalDetails": "any physical appearance details found",
  "backgroundSummary": "brief background summary",
  "speechPatterns": "any speech patterns or dialect noted",
  "sourceCoverage": "what the source material covers well vs what needs generation"
}`;
}

export const CHARACTER_BASICS_PROMPT = `${FIELD_SEMANTICS_PREAMBLE}

Extract or generate the character's basic information from the source material. Use the vantage-point rule above to decide what belongs in IDENTITY vs DESCRIPTION vs PERSONALITY. Do NOT put the same content under two different fields, and do NOT put physical appearance into DESCRIPTION — physical appearance is generated separately and lives in physicalDescription.

Respond with JSON:
{
  "name": "Character's full name",
  "title": "A short epithet or title (2-5 words, like 'The Wandering Scholar')",
  "identity": "1-2 paragraphs of public-knowledge / outside-view facts only — name, station, occupation, public reputation, signifying outward facts a stranger could plausibly know without having spoken to the character. Never internal motivation, never private mannerisms, never physical appearance.",
  "description": "1-2 paragraphs of what someone who has interacted with the character would notice — behaviour, mannerisms, frequent verbal patterns, conversational tics. NOT physical appearance (that lives in physicalDescription). NOT the character's private inner monologue. NOT the public-facing reputation that already lives in identity. Write in third person, present tense.",
  "manifesto": "The basic tenets — the most important facts of the character's existence. The axiomatic core that every other field should remain consistent with. Not a vantage-point field; nobody 'sees' the manifesto, it is the load-bearing truth the character is built on. Short, declarative, foundational. If a fact would be devastating to contradict, it belongs here.",
  "personality": "1-2 paragraphs of the character's own self-knowledge — inner drivers of speech and behaviour, motivations, beliefs, emotional tendencies, things only the character knows about themselves unless they choose to share them. Never put outward behaviour someone else would observe here, and never put public-facing identity facts.",
  "scenario": "1-2 paragraphs setting the default scene for interactions. Present tense, describing environment and relationship context. The scenario is the stage, not the actor — do not restate personality or appearance here."
}

If the source material clearly provides information for a field, extract and adapt it. If not, generate appropriate content that fits the character.`;

const FIRST_MESSAGE_PROMPT = `Generate a first message and example dialogues for this character based on the source material.

Respond with JSON:
{
  "firstMessage": "An engaging opening message from the character (1-3 paragraphs). Include *actions* and dialogue. This is how the character introduces themselves or sets the scene when first meeting someone.",
  "exampleDialogues": "2-3 example dialogue exchanges showing the character's voice.\\nFormat:\\n{{char}}: [dialogue and *actions*]\\n{{user}}: [response]\\n{{char}}: [follow-up]\\n\\nSeparate exchanges with a blank line."
}`;

const SYSTEM_PROMPTS_PROMPT = `Create system prompts that instruct an AI how to roleplay as this character.

Respond with JSON array:
[
  {
    "name": "Main",
    "content": "A comprehensive system prompt (300-500 words) covering identity, speech patterns, behaviors, boundaries, and relationship dynamics. Write in second person ('You are...', 'You always...').",
    "isDefault": true
  }
]

The main prompt should capture the character's essence from the source material. Include specific details about speech patterns, mannerisms, and reactions that make the character unique.`;

const PHYSICAL_DESCRIPTIONS_PROMPT = `Generate physical descriptions of this character at varying detail levels for image generation.
Do NOT include clothing, outfits, or accessories — those are handled separately by the wardrobe system. Focus only on the character's physical traits.

Respond with JSON:
{
  "headAndShouldersPrompt": "Head-and-shoulders portrait description, max 500 chars. ONLY face shape, skin tone, eyes, hair, expression, neckline and visible upper attire. NEVER describe breasts, chest, torso, waist, hips, legs, or anything below the shoulders. No full outfits — only the topmost neckline/collar.",
  "shortPrompt": "Extremely concise visual description, max 350 chars. Comma-separated descriptors: hair, eyes, skin, body type, one distinctive feature. No clothing.",
  "mediumPrompt": "Concise visual description, max 500 chars. Include hair, eyes, skin, body type, facial features. No clothing. Continuous description.",
  "longPrompt": "Detailed visual description, max 750 chars. Complete hair, eye details, skin, facial structure, body type, posture, marks/features. No clothing.",
  "completePrompt": "Comprehensive visual description, max 1000 chars. All physical details optimized for AI image generation. No clothing.",
  "fullDescription": "Complete physical description in markdown format with sections: ## Overview, ## Face & Head, ## Body, ## Distinctive Features. No clothing section."
}`;

const WARDROBE_ITEMS_PROMPT = `Generate wardrobe items for this character based on the source material and their typical clothing and style.
Each item must cover one or more slot types: "top" (shirts, jackets, dresses that cover the torso), "bottom" (pants, skirts, shorts), "footwear" (shoes, boots, sandals), "accessories" (jewelry, hats, belts, scarves, bags).

A single item can cover multiple slots — for example, a full-length dress would have types ["top", "bottom"].

Generate 3-6 items that represent this character's typical wardrobe. Include a mix of everyday and situational items if the source material provides enough detail.

Respond with JSON array:
[
  {
    "title": "Short descriptive name for the item",
    "description": "A sentence or two describing the item's appearance in detail",
    "types": ["top"],
    "appropriateness": "casual, everyday"
  }
]

The "appropriateness" field is a comma-separated list of context tags describing when this item is appropriate (e.g., "casual", "formal", "combat", "sleepwear", "intimate").`;

const PRONOUNS_PROMPT = `Determine the character's pronouns from the source material.

If the source material clearly indicates pronouns, respond with JSON:
{
  "subject": "he/she/they/etc",
  "object": "him/her/them/etc",
  "possessive": "his/her/their/etc"
}

If the source material does NOT indicate pronouns, respond with JSON null (literally: null). Do not invent placeholders like "unknown", "n/a", or empty strings — return null instead.`;

const MEMORIES_PROMPT = `Generate memories that this character would have based on the source material. These are key facts, experiences, and knowledge the character should remember.

Respond with JSON array (5-15 memories):
[
  {
    "content": "Detailed memory content (1-3 sentences describing what happened or what the character knows)",
    "summary": "One-sentence distilled version for quick context injection",
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "importance": 0.7
  }
]

Importance scale: 0.0 (trivial) to 1.0 (core identity). Focus on memories that define the character's history, key relationships, formative events, and critical knowledge.`;

const CHATS_PROMPT = `Generate an example chat conversation featuring this character to demonstrate their personality and conversational style.

Respond with JSON:
{
  "title": "A descriptive title for this conversation",
  "messages": [
    { "role": "ASSISTANT", "content": "Character's opening message with *actions* and dialogue" },
    { "role": "USER", "content": "User's response" },
    { "role": "ASSISTANT", "content": "Character's reply showing personality" },
    { "role": "USER", "content": "Another user message" },
    { "role": "ASSISTANT", "content": "Character's response demonstrating range" }
  ]
}

Create 5-8 messages showing natural conversation flow with the character's unique voice and mannerisms.`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strip markdown code fences from LLM output before JSON parsing
 */
export function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ``` (single source for every cheap-LLM JSON
  // parser; the regex form tolerates both newline- and inline-delimited fences).
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

/**
 * Attempt to repair truncated JSON from LLM output that was cut off
 * by maxTokens limits. Closes unclosed strings, arrays, and objects.
 */
export function repairTruncatedJson(text: string): string {
  let repaired = text.trim();

  // If it already parses, return as-is
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Continue with repair
  }

  // Remove trailing comma (common at truncation point)
  repaired = repaired.replace(/,\s*$/, '');

  // Track bracket/brace depth to close unclosed structures
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of repaired) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  // If we're mid-string, close it
  if (inString) {
    repaired += '"';
  }

  // Remove any trailing key without a value (e.g. `"field":` or `"field": `)
  repaired = repaired.replace(/,?\s*"[^"]*"\s*:\s*$/, '');

  // Remove trailing comma again after cleanup
  repaired = repaired.replace(/,\s*$/, '');

  // Close all unclosed brackets/braces
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  return repaired;
}

/**
 * Escape raw control characters (newlines, tabs, etc.) that appear *inside* a
 * JSON string literal. LLMs routinely emit a literal newline within a string
 * value instead of the `\n` escape sequence, which makes JSON.parse throw
 * "Bad control character in string literal". This walks the text with a small
 * string-aware state machine and escapes only the control characters that fall
 * inside a string, leaving structural whitespace between tokens untouched.
 */
export function escapeControlCharsInStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    const code = text.charCodeAt(i);
    if (inString && code <= 0x1f) {
      switch (ch) {
        case '\n': result += '\\n'; break;
        case '\r': result += '\\r'; break;
        case '\t': result += '\\t'; break;
        case '\b': result += '\\b'; break;
        case '\f': result += '\\f'; break;
        default: result += '\\u' + code.toString(16).padStart(4, '0'); break;
      }
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Parse JSON from LLM output, handling code fences, truncated output,
 * and common formatting issues from LLM responses.
 */
export function parseLLMJson<T>(text: string): T {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // LLMs commonly emit raw control characters inside string literals and/or
    // truncate output at the maxTokens boundary. Escape control chars first,
    // then repair any truncation before a final parse attempt.
    const escaped = escapeControlCharsInStrings(cleaned);
    try {
      return JSON.parse(escaped) as T;
    } catch {
      const repaired = repairTruncatedJson(escaped);
      return JSON.parse(repaired) as T;
    }
  }
}

const PRONOUN_PLACEHOLDERS = new Set([
  '', 'unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not specified', 'not given', 'tbd',
]);

// Validate a parsed pronouns response. Returns the trimmed object if all three
// fields are usable strings; otherwise returns undefined so the assembler stores null.
// PronounsSchema requires non-empty strings ≤20 chars on subject/object/possessive,
// so anything else would explode at character-create time.
function sanitizePronouns(raw: unknown): { subject: string; object: string; possessive: string } | undefined {
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

type LLMProvider = Awaited<ReturnType<typeof createLLMProvider>>;

/**
 * Make an LLM call with structured JSON response expected
 */
async function callLLM(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  sourceContext: string,
  instruction: string,
  options: {
    temperature: number;
    maxTokens: number;
    userId?: string;
    profileProvider?: string;
    profileParameters?: Record<string, unknown>;
  }
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_MESSAGE },
    { role: 'user' as const, content: `${sourceContext}\n\n---\n\n${instruction}` },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: modelName,
      messages,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      profileParameters: options.profileParameters,
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from model');
  }

  // Log the LLM call (fire and forget)
  if (options.userId && options.profileProvider) {
    logLLMCall({
      userId: options.userId,
      type: 'AI_IMPORT',
      provider: options.profileProvider,
      modelName,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: `[source context + instruction - ${instruction.substring(0, 80)}...]` },
        ],
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      },
      response: {
        content: response.content.substring(0, 500),
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('[AIImport] Failed to log LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return response.content.trim();
}

/**
 * Build source context from uploaded files and freeform text
 */
async function buildSourceContext(
  sourceFileIds: string[],
  sourceText: string,
  userId: string,
  repos: RepositoryContainer,
  analysis?: string
): Promise<string> {
  const parts: string[] = [];

  // Extract content from uploaded files
  for (const fileId of sourceFileIds) {
    const file = await repos.files.findById(fileId);
    if (!file || file.userId !== userId) {
      logger.warn('[AIImport] Source file not found or unauthorized', { fileId, userId });
      continue;
    }

    const result = await extractFileContent(file);
    if (result.success && result.content) {
      parts.push(`=== Source File: ${file.originalFilename} ===\n${result.content}`);
    } else {
      logger.warn('[AIImport] Failed to extract file content', {
        fileId,
        filename: file.originalFilename,
        error: result.error,
      });
    }
  }

  // Add freeform text
  if (sourceText.trim()) {
    parts.push(`=== Source Text ===\n${sourceText.trim()}`);
  }

  // Add analysis summary if available
  if (analysis) {
    parts.push(`=== Prior Analysis ===\n${analysis}`);
  }

  const context = parts.join('\n\n');

  return context;
}

/**
 * Get a short snippet for progress display
 */
function getSnippet(content: unknown, maxLength: number = 100): string {
  if (typeof content === 'string') {
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  }
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if ('name' in obj && typeof obj.name === 'string') {
      return obj.name;
    }
  }
  return '';
}

// ============================================================================
// Assembly
// ============================================================================

/**
 * Assemble a QuilltapExport from the generated step results
 */
export function assembleQtapExport(
  stepResults: AIImportStepResults,
  includeMemories: boolean,
  includeChats: boolean,
  appVersion: string
): QuilltapExport {
  const now = new Date().toISOString();
  const characterId = crypto.randomUUID();
  const userId = crypto.randomUUID(); // Placeholder — remapped during import

  const basics = stepResults.character_basics;
  if (!basics?.name) {
    throw new Error('Character basics with name are required for assembly');
  }

  // Build character object
  const character: Record<string, unknown> = {
    id: characterId,
    userId,
    name: basics.name,
    scenarios: basics.scenario ? [{
      id: crypto.randomUUID(),
      title: 'Default',
      content: basics.scenario,
      createdAt: now,
      updatedAt: now,
    }] : [],
    systemPrompts: (stepResults.system_prompts || []).map((sp) => ({
      id: crypto.randomUUID(),
      name: sp.name,
      content: sp.content,
      isDefault: sp.isDefault,
      createdAt: now,
      updatedAt: now,
    })),
    avatarUrl: null,
    defaultImageId: null,
    defaultConnectionProfileId: null,
    defaultPartnerId: null,
    defaultRoleplayTemplateId: null,
    defaultImageProfileId: null,
    sillyTavernData: null,
    isFavorite: false,
    npc: false,
    talkativeness: 0.5,
    controlledBy: 'llm',
    defaultAgentModeEnabled: null,
    partnerLinks: [],
    aliases: [],
    pronouns: stepResults.pronouns || null,
    tags: [],
    avatarOverrides: [],
    physicalDescription: stepResults.physical_descriptions
      ? {
          id: crypto.randomUUID(),
          name: 'AI Generated',
          headAndShouldersPrompt: (stepResults.physical_descriptions.headAndShouldersPrompt || '').substring(0, 500),
          shortPrompt: (stepResults.physical_descriptions.shortPrompt || '').substring(0, 350),
          mediumPrompt: (stepResults.physical_descriptions.mediumPrompt || '').substring(0, 500),
          longPrompt: (stepResults.physical_descriptions.longPrompt || '').substring(0, 750),
          completePrompt: (stepResults.physical_descriptions.completePrompt || '').substring(0, 1000),
          fullDescription: stepResults.physical_descriptions.fullDescription,
          createdAt: now,
          updatedAt: now,
        }
      : null,
    wardrobeItems: stepResults.wardrobe_items
      ? stepResults.wardrobe_items.map((item) => ({
          id: crypto.randomUUID(),
          characterId,
          title: item.title,
          description: item.description || null,
          types: item.types,
          componentItemIds: [],
          appropriateness: item.appropriateness || null,
          isDefault: false,
          replace: false,
          migratedFromClothingRecordId: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        }))
      : [],
    createdAt: now,
    updatedAt: now,
  };

  // Optional text fields are typed as `string` (not nullable) in the qtap export
  // schema, so emitting an explicit null for a field a step omitted (or failed to
  // produce — e.g. a first_message step that returned malformed JSON) fails
  // validation and needlessly trips the LLM repair loop. Include each only when
  // there is a usable string; the DB character schema treats these as
  // `.nullable().optional()`, so omission is equivalent to null at import time.
  const optionalTextFields: Record<string, unknown> = {
    title: basics.title,
    identity: basics.identity,
    description: basics.description,
    manifesto: basics.manifesto,
    personality: basics.personality,
    firstMessage: stepResults.first_message?.firstMessage,
    exampleDialogues: stepResults.first_message?.exampleDialogues,
  };
  for (const [key, value] of Object.entries(optionalTextFields)) {
    if (typeof value === 'string' && value.trim()) {
      character[key] = value;
    }
  }

  // Build memories array
  const memories: Record<string, unknown>[] = [];
  if (includeMemories && stepResults.memories) {
    for (const mem of stepResults.memories) {
      memories.push({
        id: crypto.randomUUID(),
        characterId,
        content: mem.content,
        summary: mem.summary,
        keywords: mem.keywords,
        tags: [],
        importance: Math.max(0, Math.min(1, mem.importance)),
        source: 'MANUAL',
        reinforcementCount: 1,
        relatedMemoryIds: [],
        reinforcedImportance: Math.max(0, Math.min(1, mem.importance)),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Build chats array
  const chats: Record<string, unknown>[] = [];
  if (includeChats && stepResults.chats) {
    const chatId = crypto.randomUUID();
    const chatMessages = stepResults.chats.messages.map((msg, idx) => ({
      type: 'message',
      id: crypto.randomUUID(),
      role: msg.role,
      content: msg.content,
      createdAt: new Date(Date.now() + idx * 1000).toISOString(),
      participantId: msg.role === 'ASSISTANT' ? characterId : undefined,
    }));

    chats.push({
      id: chatId,
      userId,
      title: stepResults.chats.title,
      participants: [{ participantId: characterId, type: 'CHARACTER' }],
      messages: chatMessages,
      contextSummary: null,
      sillyTavernMetadata: null,
      tags: [],
      roleplayTemplateId: null,
      timestampConfig: null,
      lastTurnParticipantId: null,
      messageCount: chatMessages.length,
      lastMessageAt: chatMessages.length > 0
        ? chatMessages[chatMessages.length - 1].createdAt
        : now,
      lastRenameCheckInterchange: 0,
      isPaused: false,
      isManuallyRenamed: false,
      impersonatingParticipantIds: [],
      activeTypingParticipantId: null,
      createdAt: now,
      updatedAt: now,
      _participantInfo: [
        {
          participantId: characterId,
          characterName: basics.name,
          type: 'CHARACTER',
        },
      ],
    });
  }

  // Determine export type based on what we have
  // Characters export is the primary type since we always generate a character
  const counts: Record<string, number> = {
    characters: 1,
  };

  const data: Record<string, unknown> = {
    characters: [character],
  };

  if (memories.length > 0) {
    data.memories = memories;
    counts.memories = memories.length;
  }

  // Note: Chats are included in the character export data when present
  // The import system handles chats embedded in character exports

  const exportData: QuilltapExport = {
    manifest: {
      format: 'quilltap-export',
      version: '1.0',
      exportType: 'characters',
      createdAt: now,
      appVersion: appVersion,
      settings: {
        includeMemories,
        scope: 'selected',
        selectedIds: [characterId],
      },
      counts,
    },
    data: data as unknown as QuilltapExport['data'],
  };

  return exportData;
}

// ============================================================================
// Structural normalization
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isNonEmptyTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Re-apply the structural scaffolding — ids and createdAt/updatedAt — that the
 * assembler owns on the character's nested collections (systemPrompts,
 * scenarios, physicalDescription, wardrobeItems) and on memories.
 *
 * The LLM repair step rewrites whole `data` sections wholesale, and models
 * routinely drop these nested fields. The qtap export schema does not enforce
 * them (so repair revalidation passes), but the character/memory DB schemas
 * require them — meaning a "valid" but repaired export would still be rejected
 * by `repos.characters.create` at import time. Top-level character id/timestamps
 * are intentionally left alone: the qtap schema *does* require those, so repair
 * validation already guards them, and regenerating a character id here would
 * orphan its memories' `characterId` references.
 *
 * Idempotent: when the export came straight from the assembler (no repair),
 * every field is already present and this is a no-op. Returns the number of
 * fields it had to fix, for logging.
 */
export function restampStructuralFields(data: QuilltapExport['data'], now: string): number {
  let fixes = 0;

  const ensureEntryScaffolding = (entry: Record<string, unknown>) => {
    if (!isValidUuid(entry.id)) {
      entry.id = crypto.randomUUID();
      fixes++;
    }
    if (!isNonEmptyTimestamp(entry.createdAt)) {
      entry.createdAt = now;
      fixes++;
    }
    if (!isNonEmptyTimestamp(entry.updatedAt)) {
      entry.updatedAt = now;
      fixes++;
    }
  };

  const dataObj = data as unknown as Record<string, unknown>;

  const characters = dataObj.characters;
  if (Array.isArray(characters)) {
    for (const rawCharacter of characters) {
      if (!rawCharacter || typeof rawCharacter !== 'object') continue;
      const character = rawCharacter as Record<string, unknown>;

      for (const key of ['systemPrompts', 'scenarios'] as const) {
        const collection = character[key];
        if (!Array.isArray(collection)) continue;
        for (const entry of collection) {
          if (entry && typeof entry === 'object') {
            ensureEntryScaffolding(entry as Record<string, unknown>);
          }
        }
      }

      const physicalDescription = character.physicalDescription;
      if (physicalDescription && typeof physicalDescription === 'object') {
        const pd = physicalDescription as Record<string, unknown>;
        ensureEntryScaffolding(pd);
        if (typeof pd.name !== 'string' || !pd.name.trim()) {
          pd.name = 'AI Generated';
          fixes++;
        }
      }

      const wardrobeItems = character.wardrobeItems;
      if (Array.isArray(wardrobeItems)) {
        for (const rawItem of wardrobeItems) {
          if (!rawItem || typeof rawItem !== 'object') continue;
          const item = rawItem as Record<string, unknown>;
          ensureEntryScaffolding(item);
          if (!isValidUuid(item.characterId) && isValidUuid(character.id)) {
            item.characterId = character.id;
            fixes++;
          }
        }
      }
    }
  }

  const memories = dataObj.memories;
  if (Array.isArray(memories)) {
    for (const rawMemory of memories) {
      if (rawMemory && typeof rawMemory === 'object') {
        ensureEntryScaffolding(rawMemory as Record<string, unknown>);
      }
    }
  }

  return fixes;
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Run the AI character import with streaming progress updates.
 * Extracts character data from source material using multiple focused LLM calls,
 * then assembles a .qtap export file.
 */
export async function runAIImportStreaming(
  request: AIImportRequest,
  userId: string,
  repos: RepositoryContainer,
  onProgress: AIImportProgressCallback
): Promise<void> {
  logger.info('[AIImport] Starting AI character import', {
    userId,
    profileId: request.profileId,
    sourceFileCount: request.sourceFileIds.length,
    hasSourceText: !!request.sourceText.trim(),
    includeMemories: request.includeMemories,
    includeChats: request.includeChats,
    hasExistingResult: !!request.existingResult,
    regenerateSteps: request.regenerateSteps,
  });

  onProgress({ type: 'start' });

  const stepResults: AIImportStepResults = { ...(request.existingResult || {}) };
  const errors: Record<string, string> = {};

  try {
    // Get connection profile
    const profile = await repos.connections.findById(request.profileId);
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
    const llmOpts = {
      userId,
      profileProvider: profile.provider,
      profileParameters: profileParams(profile),
    };

    /**
     * Determine if a step should run:
     * - Not in existingResult, OR
     * - Explicitly in regenerateSteps
     */
    function shouldRunStep(step: AIImportStepName): boolean {
      if (request.regenerateSteps?.includes(step)) return true;
      if (request.existingResult && step in request.existingResult) return false;
      return true;
    }

    // Step 0: Analyzing (only for large source material)
    const sourceContext = await buildSourceContext(
      request.sourceFileIds,
      request.sourceText,
      userId,
      repos,
      stepResults.analyzing
    );

    if (!sourceContext.trim()) {
      throw new Error('No source material provided. Upload files or enter text to import from.');
    }

    if (sourceContext.length > SOURCE_ANALYSIS_THRESHOLD && shouldRunStep('analyzing')) {
      onProgress({ type: 'step_start', step: 'analyzing' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          sourceContext,
          getAnalyzingPrompt(sourceContext.length),
          { temperature: 0.3, maxTokens: 2000, ...llmOpts }
        );
        const analysis = parseLLMJson<Record<string, unknown>>(raw);
        stepResults.analyzing = JSON.stringify(analysis, null, 2);
        onProgress({
          type: 'step_complete',
          step: 'analyzing',
          snippet: (analysis.characterName as string) || 'Analysis complete',
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Analysis failed';
        errors.analyzing = msg;
        onProgress({ type: 'step_error', step: 'analyzing', error: msg });
        logger.warn('[AIImport] Analysis step failed (non-fatal)', { error: msg });
      }
    }

    // Rebuild context with analysis if available
    const enrichedContext = stepResults.analyzing
      ? `${sourceContext}\n\n=== Prior Analysis ===\n${stepResults.analyzing}`
      : sourceContext;

    // Step 1: Character Basics (REQUIRED)
    if (shouldRunStep('character_basics')) {
      onProgress({ type: 'step_start', step: 'character_basics' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          enrichedContext,
          CHARACTER_BASICS_PROMPT,
          { temperature: 0.7, maxTokens: 2000, ...llmOpts }
        );
        stepResults.character_basics = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'character_basics',
          snippet: stepResults.character_basics?.name || 'Basics generated',
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Character basics failed';
        errors.character_basics = msg;
        onProgress({ type: 'step_error', step: 'character_basics', error: msg });
        logger.error('[AIImport] Character basics step failed', { error: msg });
      }
    }

    if (!stepResults.character_basics?.name) {
      throw new Error('Failed to generate character basics — cannot proceed without a character name');
    }

    const charName = stepResults.character_basics.name;
    const charContext = `${enrichedContext}\n\nCharacter name: ${charName}`;

    // Step 2: First Message & Example Dialogues
    if (shouldRunStep('first_message')) {
      onProgress({ type: 'step_start', step: 'first_message' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          FIRST_MESSAGE_PROMPT,
          { temperature: 0.8, maxTokens: 1500, ...llmOpts }
        );
        stepResults.first_message = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'first_message',
          snippet: getSnippet(stepResults.first_message?.firstMessage || ''),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'First message failed';
        errors.first_message = msg;
        onProgress({ type: 'step_error', step: 'first_message', error: msg });
        logger.warn('[AIImport] First message step failed (non-fatal)', { error: msg });
      }
    }

    // Step 3: System Prompts
    if (shouldRunStep('system_prompts')) {
      onProgress({ type: 'step_start', step: 'system_prompts' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          SYSTEM_PROMPTS_PROMPT,
          { temperature: 0.7, maxTokens: 1500, ...llmOpts }
        );
        stepResults.system_prompts = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'system_prompts',
          snippet: `${stepResults.system_prompts?.length || 0} prompt(s) generated`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'System prompts failed';
        errors.system_prompts = msg;
        onProgress({ type: 'step_error', step: 'system_prompts', error: msg });
        logger.warn('[AIImport] System prompts step failed (non-fatal)', { error: msg });
      }
    }

    // Step 4: Physical Descriptions
    if (shouldRunStep('physical_descriptions')) {
      onProgress({ type: 'step_start', step: 'physical_descriptions' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          PHYSICAL_DESCRIPTIONS_PROMPT,
          { temperature: 0.7, maxTokens: 2000, ...llmOpts }
        );
        stepResults.physical_descriptions = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'physical_descriptions',
          snippet: getSnippet(stepResults.physical_descriptions?.shortPrompt || ''),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Physical descriptions failed';
        errors.physical_descriptions = msg;
        onProgress({ type: 'step_error', step: 'physical_descriptions', error: msg });
        logger.warn('[AIImport] Physical descriptions step failed (non-fatal)', { error: msg });
      }
    }

    // Step 4b: Wardrobe Items
    if (shouldRunStep('wardrobe_items')) {
      onProgress({ type: 'step_start', step: 'wardrobe_items' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          WARDROBE_ITEMS_PROMPT,
          { temperature: 0.7, maxTokens: 2000, ...llmOpts }
        );
        const items = parseLLMJson<Array<{ title: string; description: string; types: string[]; appropriateness?: string }>>(raw);
        // Validate types
        const validTypes = new Set(['top', 'bottom', 'footwear', 'accessories']);
        stepResults.wardrobe_items = items
          .filter((item) => item.title && item.types?.length > 0)
          .map((item) => ({
            ...item,
            types: item.types.filter((t) => validTypes.has(t)),
          }))
          .filter((item) => item.types.length > 0);
        onProgress({
          type: 'step_complete',
          step: 'wardrobe_items',
          snippet: `${stepResults.wardrobe_items.length} wardrobe item(s) generated`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Wardrobe items failed';
        errors.wardrobe_items = msg;
        onProgress({ type: 'step_error', step: 'wardrobe_items', error: msg });
        logger.warn('[AIImport] Wardrobe items step failed (non-fatal)', { error: msg });
      }
    }

    // Step 5: Pronouns
    if (shouldRunStep('pronouns')) {
      onProgress({ type: 'step_start', step: 'pronouns' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          PRONOUNS_PROMPT,
          { temperature: 0.3, maxTokens: 100, ...llmOpts }
        );
        const parsed = parseLLMJson<unknown>(raw);
        stepResults.pronouns = sanitizePronouns(parsed);
        if (stepResults.pronouns) {
          onProgress({
            type: 'step_complete',
            step: 'pronouns',
            snippet: `${stepResults.pronouns.subject}/${stepResults.pronouns.object}/${stepResults.pronouns.possessive}`,
          });
        } else {
          onProgress({
            type: 'step_complete',
            step: 'pronouns',
            snippet: 'pronouns not derivable — left blank',
          });
          logger.info('[AIImport] Pronouns not derivable from source — leaving null');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Pronouns failed';
        errors.pronouns = msg;
        onProgress({ type: 'step_error', step: 'pronouns', error: msg });
        logger.warn('[AIImport] Pronouns step failed (non-fatal)', { error: msg });
      }
    }

    // Step 6: Memories (if requested)
    if (request.includeMemories && shouldRunStep('memories')) {
      onProgress({ type: 'step_start', step: 'memories' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          MEMORIES_PROMPT,
          { temperature: 0.7, maxTokens: 3000, ...llmOpts }
        );
        stepResults.memories = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'memories',
          snippet: `${stepResults.memories?.length || 0} memories generated`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Memories failed';
        errors.memories = msg;
        onProgress({ type: 'step_error', step: 'memories', error: msg });
        logger.warn('[AIImport] Memories step failed (non-fatal)', { error: msg });
      }
    }

    // Step 7: Example Chats (if requested)
    if (request.includeChats && shouldRunStep('chats')) {
      onProgress({ type: 'step_start', step: 'chats' });
      try {
        const raw = await callLLM(
          provider, apiKey, profile.modelName,
          charContext,
          CHATS_PROMPT,
          { temperature: 0.8, maxTokens: 4000, ...llmOpts }
        );
        stepResults.chats = parseLLMJson(raw);
        onProgress({
          type: 'step_complete',
          step: 'chats',
          snippet: stepResults.chats?.title || 'Chat generated',
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Chat generation failed';
        errors.chats = msg;
        onProgress({ type: 'step_error', step: 'chats', error: msg });
        logger.warn('[AIImport] Chats step failed (non-fatal)', { error: msg });
      }
    }

    // Step 8: Assembly (no LLM call)
    onProgress({ type: 'step_start', step: 'assembly' });
    let exportData: QuilltapExport;
    try {
      // Get app version from package.json
      const appVersion = packageJson.version || '3.0.0';

      exportData = assembleQtapExport(stepResults, request.includeMemories, request.includeChats, appVersion);
      onProgress({
        type: 'step_complete',
        step: 'assembly',
        snippet: `${charName} assembled`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Assembly failed';
      errors.assembly = msg;
      onProgress({ type: 'step_error', step: 'assembly', error: msg });
      logger.error('[AIImport] Assembly step failed', { error: msg });

      // Assembly failure is fatal
      onProgress({
        type: 'done',
        error: msg,
        stepResults,
        errors,
      });
      return;
    }

    // Step 9: Validation (no LLM call)
    onProgress({ type: 'step_start', step: 'validation' });
    const validationResult = validateQtapExport(exportData);

    if (validationResult.valid) {
      onProgress({ type: 'step_complete', step: 'validation', snippet: 'Validation passed' });
    } else {
      logger.warn('[AIImport] Validation failed, attempting repair', {
        errorCount: validationResult.errors.length,
        errors: validationResult.errors.slice(0, 5),
      });
      onProgress({
        type: 'step_error',
        step: 'validation',
        error: `${validationResult.errors.length} validation error(s)`,
      });

      // Step 10: Repair (LLM call to fix validation errors, up to MAX_REPAIR_ATTEMPTS)
      // Determine which data sections have errors based on error paths
      const dataObj = exportData.data as unknown as Record<string, unknown>;
      const errorSections = new Set<string>();
      for (const err of validationResult.errors) {
        // Error paths look like "/data/memories/0/chatId: must be string"
        const match = err.match(/^\/data\/(\w+)\//);
        if (match) errorSections.add(match[1]);
      }

      let repaired = false;
      for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS && !repaired; attempt++) {
        onProgress({ type: 'step_start', step: 'repair' });
        try {
          // Only repair sections that actually have errors
          const sectionsToRepair: Record<string, unknown> = {};
          for (const section of errorSections) {
            if (dataObj[section]) {
              sectionsToRepair[section] = dataObj[section];
            }
          }

          if (Object.keys(sectionsToRepair).length === 0) {
            // No identifiable sections to repair — skip LLM repair
            logger.warn('[AIImport] No repairable sections identified from error paths', {
              errors: validationResult.errors.slice(0, 5),
            });
            break;
          }

          const repairPrompt = `The following .qtap export data has validation errors. Fix the issues and return the corrected data as JSON.

Validation errors:
${validationResult.errors.join('\n')}

Current data (sections with errors only):
${JSON.stringify(sectionsToRepair, null, 2)}

Return ONLY a JSON object with the same section keys (${Object.keys(sectionsToRepair).join(', ')}), containing the corrected arrays. Do not change the structure, only fix the values that cause validation errors. If a field should be absent rather than null, remove it entirely.`;

          const raw = await callLLM(
            provider, apiKey, profile.modelName,
            '',
            repairPrompt,
            { temperature: 0.5, maxTokens: 2000, ...llmOpts }
          );

          const repairedSections = parseLLMJson<Record<string, unknown>>(raw);
          // Only apply repaired sections, don't touch other sections
          for (const section of Object.keys(sectionsToRepair)) {
            if (repairedSections[section]) {
              dataObj[section] = repairedSections[section];
            }
          }

          const revalidation = validateQtapExport(exportData);
          if (revalidation.valid) {
            repaired = true;
            onProgress({ type: 'step_complete', step: 'repair', snippet: 'Repair successful' });
            logger.info('[AIImport] Repair successful on attempt', { attempt: attempt + 1 });
          } else {
            onProgress({
              type: 'step_error',
              step: 'repair',
              error: `Repair attempt ${attempt + 1} still has errors`,
            });
            logger.warn('[AIImport] Repair attempt failed', {
              attempt: attempt + 1,
              remainingErrors: revalidation.errors.length,
            });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Repair failed';
          onProgress({ type: 'step_error', step: 'repair', error: msg });
          logger.warn('[AIImport] Repair attempt error', { attempt: attempt + 1, error: msg });
        }
      }

      if (!repaired) {
        // Validation failed but we still return the data — let the user decide
        errors.validation = `Validation has ${validationResult.errors.length} error(s) that could not be auto-repaired`;
        logger.warn('[AIImport] Could not fully repair validation errors', {
          errorCount: validationResult.errors.length,
        });
      }
    }

    // Guarantee the structural scaffolding the import path requires survived
    // assembly and any LLM repair. Repair rewrites whole sections and models
    // strip nested ids/timestamps that the qtap schema doesn't enforce but the
    // DB schemas do; without this re-stamp those exports fail at create time.
    restampStructuralFields(exportData.data, new Date().toISOString());

    // Done
    logger.info('[AIImport] AI character import complete', {
      characterName: charName,
      stepsCompleted: Object.keys(stepResults).length,
      stepsWithErrors: Object.keys(errors).length,
    });

    onProgress({
      type: 'done',
      result: exportData,
      stepResults,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'AI import failed';
    logger.error('[AIImport] Streaming generation failed', { error: errorMessage });
    onProgress({
      type: 'done',
      error: errorMessage,
      stepResults,
      errors: { ...errors, _fatal: errorMessage },
    });
  }
}
