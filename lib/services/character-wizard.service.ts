/**
 * Character AI Wizard Service
 *
 * Provides AI-powered character generation capabilities for creating
 * character profiles with LLM assistance.
 */

import { createLLMProvider } from '@/lib/llm';
import { profileParams } from '@/lib/llm/cheap-llm';

import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { extractFileContent } from '@/lib/services/file-content-extractor';
import { logger } from '@/lib/logger';
import { parseLLMJson } from '@/lib/services/ai-import.service';
import { FIELD_SEMANTICS_PREAMBLE } from '@/lib/services/character-field-semantics';
import type { ConnectionProfile, FileEntry } from '@/lib/schemas/types';
import type { FileAttachment } from '@/lib/llm/base';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types';

// ============================================================================
// Types
// ============================================================================

export interface WizardRequest {
  primaryProfileId: string;
  visionProfileId?: string;
  sourceType: 'existing' | 'upload' | 'gallery' | 'document' | 'skip';
  imageId?: string;
  documentId?: string;
  characterName: string;
  existingData?: {
    title?: string;
    identity?: string;
    description?: string;
    manifesto?: string;
    personality?: string;
    scenarios?: Array<{ id: string; title: string; content: string }>;
    exampleDialogues?: string;
    systemPrompt?: string;
  };
  background: string;
  fieldsToGenerate: (
    | 'name'
    | 'title'
    | 'identity'
    | 'description'
    | 'manifesto'
    | 'personality'
    | 'scenarios'
    | 'exampleDialogues'
    | 'systemPrompt'
    | 'physicalDescription'
    | 'wardrobeItems'
  )[];
  characterId?: string;
}

export interface GeneratedPhysicalDescription {
  name: string;
  headAndShouldersPrompt: string;
  shortPrompt: string;
  mediumPrompt: string;
  longPrompt: string;
  completePrompt: string;
  fullDescription: string;
}

export interface GeneratedWardrobeItem {
  title: string;
  description: string;
  types: WardrobeItemType[];
  appropriateness?: string;
}

export interface WizardResult {
  success: boolean;
  generated: Record<string, unknown>;
  errors?: Record<string, string>;
}

// Progress event types for streaming
export type WizardProgressEventType = 'start' | 'field_start' | 'field_complete' | 'field_error' | 'done';

export interface WizardProgressEvent {
  type: WizardProgressEventType;
  field?: string;
  snippet?: string;
  fullContent?: Record<string, unknown>;
  errors?: Record<string, string>;
  error?: string;
}

export type WizardProgressCallback = (event: WizardProgressEvent) => void;

// ============================================================================
// Prompt Templates
// ============================================================================

export const FIELD_PROMPTS: Record<string, string> = {
  name: `Generate a unique, memorable name for this character that fits the world and background context provided.
The name should be:
- Appropriate to the setting (fantasy, modern, sci-fi, etc.)
- Easy to pronounce and remember
- Evocative of the character's nature or background

Respond with ONLY the name, no quotes or explanation.`,

  title: `Generate a short, evocative title or epithet for this character (2-5 words).
Examples: "The Wandering Scholar", "Knight of the Fallen Star", "Last of the Old Guard"

Respond with ONLY the title, no quotes or explanation.`,

  identity: `${FIELD_SEMANTICS_PREAMBLE}

Write the IDENTITY field for this character: 1-2 short paragraphs of public-knowledge / outside-view facts only — name, station, occupation, public reputation, signifying outward facts a stranger could plausibly know without having spoken to the character.

Strict rules:
- Never include internal motivation, beliefs, or self-knowledge (those belong in PERSONALITY).
- Never include private mannerisms, verbal tics, or behaviour someone has to be acquainted with the character to notice (those belong in DESCRIPTION).
- Never include physical appearance — that lives in physicalDescription and is generated separately.

Write in third person, present tense.`,

  description: `${FIELD_SEMANTICS_PREAMBLE}

Write the DESCRIPTION field for this character: 1-2 short paragraphs of what someone who has interacted with the character would notice — behaviour, mannerisms, frequent verbal patterns, conversational tics, the way they handle themselves around others.

Strict rules:
- Do NOT describe physical appearance. Physical appearance lives in physicalDescription and is generated separately. If a visual reference has been provided, ignore it for this field.
- Do NOT restate the public-facing reputation that already belongs in IDENTITY.
- Do NOT write the character's private inner monologue or self-knowledge — that belongs in PERSONALITY.

Write in third person, present tense. Be vivid and specific about behaviour, not appearance.`,

  manifesto: `${FIELD_SEMANTICS_PREAMBLE}

Write the MANIFESTO field for this character: the basic tenets, the axiomatic core that every other field should remain consistent with. Short, declarative, foundational statements. If a fact would be devastating to contradict, it belongs here.

Strict rules:
- Focus on load-bearing truths — the foundational facts that define the character at the deepest level.
- Use clear, contradiction-resistant language.
- Avoid flowery prose; favour declarative statements.
- Not a vantage-point field — nobody "sees" the manifesto, it is the truth the character is built on.
- Every other field (identity, description, personality, physical, dialogues) should remain consistent with this.

Format as a bulleted list of 3-5 core tenets.`,

  personality: `${FIELD_SEMANTICS_PREAMBLE}

Write the PERSONALITY field for this character: 1-2 short paragraphs of the character's own self-knowledge — the inner drivers of speech and behaviour, motivations, beliefs, emotional tendencies, the things only the character knows about themselves unless they choose to share them.

Strict rules:
- Never put outward behaviour someone else would observe here (that belongs in DESCRIPTION).
- Never put public-facing identity facts here (those belong in IDENTITY).
- Never describe physical appearance.

Write as instructions for how the character behaves on the inside, not as a story.`,

  scenarios: `Generate 2-3 distinct scenarios for interactions with this character. Each scenario should have a short title and detailed content. Return as a JSON array: [{"title": "...", "content": "..."}]

A scenario is a setting for a chat — it describes the environment, location, circumstances, and context in which an interaction with this character takes place. Scenarios set the stage but should NOT fundamentally change the character's personality, voice, or core behavior. Think of each scenario as a different "where and when" for encountering the character, not a different version of who they are.

Each scenario should:
- Describe a distinct setting, location, or situation where the character might be encountered
- Include details about the physical environment and atmosphere
- Include the relationship context between the character and the person they're interacting with
- Include any ongoing circumstances or events relevant to that setting
- Be written in present tense, setting the scene for roleplay
- Focus on the environment and situation, not on changing how the character behaves (the character's personality remains consistent across scenarios unless the environment naturally warrants different behavior)`,

  exampleDialogues: `Write 2-3 example dialogue exchanges that demonstrate this character's voice and personality.

Format each exchange as:
{{char}}: [Character's dialogue and actions]
{{user}}: [User's response]
{{char}}: [Character's follow-up]

Show variety in the character's emotional range and speech patterns. Include *actions* and *expressions* in asterisks.`,

  systemPrompt: `Write a system prompt that instructs an AI how to roleplay as this character. This will serve as the default system prompt (characters can have multiple named system prompts for different interaction styles, but this one should be a comprehensive general-purpose default).

Include:
- Core identity and self-perception
- Speech patterns and vocabulary
- Key behaviors and reactions
- Important boundaries or limitations
- Relationship dynamics to maintain

Write as direct instructions to the AI, in second person ("You are...", "You always...").
Keep it under 500 words but comprehensive.`,
};

/**
 * Head-and-shoulders portrait prompt. Exported so the avatar-backfill job
 * (lib/background-jobs/handlers/character-headshoulders-backfill.ts) can reuse
 * the exact same instruction when generating the field for existing characters.
 */
export const HEAD_AND_SHOULDERS_PHYSICAL_PROMPT = `Create a head-and-shoulders portrait description for image generation, maximum 500 characters.
This describes ONLY what is visible in a tight head-and-shoulders crop: face shape, skin tone, eye color/shape, hair color/length/style, facial expression, and the neckline plus any visible collar, shoulders, or upper attire.
Do NOT describe breasts, chest, torso, waist, hips, legs, or ANY anatomy below the shoulders — they are outside the crop and must never appear.
Do NOT describe full outfits; only the topmost visible neckline/collar.
Write as a continuous comma/phrase-style description like the medium prompt, no line breaks.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`;

const PHYSICAL_DESCRIPTION_PROMPTS: Record<string, string> = {
  headAndShoulders: HEAD_AND_SHOULDERS_PHYSICAL_PROMPT,

  short: `Create an extremely concise visual description for image generation, maximum 350 characters.
Focus ONLY on: hair, eyes, skin, body type, and one distinctive feature.
Format: [trait], [trait], [trait]...
No sentences, just comma-separated descriptors.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  medium: `Create a concise visual description for image generation, maximum 500 characters.
Include: hair color/style, eye color, skin tone, body type, facial features.
Do NOT include clothing, outfits, or accessories — those are handled separately by the wardrobe system.
Write as a continuous description, no line breaks.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  long: `Create a detailed visual description for image generation, maximum 750 characters.
Include: complete hair description, eye details, skin, facial structure, body type, posture, any distinctive marks or features.
Do NOT include clothing, outfits, or accessories — those are handled separately by the wardrobe system.
Write as flowing description suitable for stable diffusion or DALL-E.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  complete: `Create a comprehensive visual description for image generation, maximum 1000 characters.
Include all physical details: hair (color, length, style, texture), eyes (color, shape, expression), face (shape, features, expression), body (type, height, build), skin (tone, texture, any marks), posture and body language.
Do NOT include clothing, outfits, or accessories — those are handled separately by the wardrobe system.
Optimized for AI image generation.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  full: `Write a complete, detailed physical description of this character in markdown format.
Do NOT include clothing, outfits, or accessories — those are handled separately by the wardrobe system.
Structure with headers:
## Overview
Brief 1-2 sentence summary

## Face & Head
Hair, eyes, face shape, expressions, any facial features

## Body
Build, height, posture, distinguishing physical traits

## Distinctive Features
Unique marks, mannerisms, or visual traits

Be thorough and specific. This will be used as reference for consistent character portrayal.`,
};

const WARDROBE_ITEMS_PROMPT = `Generate wardrobe items for this character based on their typical clothing and style.
Each item must cover one or more of these slot types: "top" (shirts, jackets, dresses that cover the torso), "bottom" (pants, skirts, shorts), "footwear" (shoes, boots, sandals), "accessories" (jewelry, hats, belts, scarves, bags).

A single item can cover multiple slots — for example, a full-length dress would have types ["top", "bottom"].

Generate 3-6 items that represent this character's typical wardrobe. Include a mix of everyday and situational items.

Respond with ONLY valid JSON, no markdown fences:
[
  {
    "title": "Short descriptive name for the item",
    "description": "A sentence or two describing the item's appearance in detail",
    "types": ["top"],
    "appropriateness": "casual, everyday"
  }
]

The "appropriateness" field is a comma-separated list of context tags describing when this item is appropriate (e.g., "casual", "formal", "combat", "sleepwear", "intimate").`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build the context prompt for field generation
 */
export function buildContextPrompt(
  characterName: string,
  background: string,
  existingData?: WizardRequest['existingData'],
  imageDescription?: string,
  documentContent?: string
): string {
  let context = `You are a character creation assistant for a roleplay/chat application. You are helping create a character profile that will be used by an AI to roleplay as this character.
`;

  if (characterName.trim()) {
    context += `
Character Name: ${characterName}
`;
  } else {
    context += `
Note: The character does not yet have a name. You may be asked to generate one.
`;
  }

  if (background.trim()) {
    context += `
Background/World Context:
${background}
`;
  }

  if (imageDescription) {
    context += `
Visual Reference (from image analysis):
${imageDescription}

Note: this visual reference describes the character's PHYSICAL APPEARANCE only. Use it for the physicalDescription field. Do NOT let it bleed into the identity, description, or personality fields — those fields are about facts, behaviour, and self-knowledge respectively, never appearance.
`;
  }

  if (documentContent) {
    context += `
Character Reference Document:
${documentContent}
`;
  }

  if (existingData) {
    const existingFields = [];
    if (existingData.title?.trim()) existingFields.push(`Title: ${existingData.title}`);
    if (existingData.identity?.trim()) existingFields.push(`Identity: ${existingData.identity}`);
    if (existingData.description?.trim()) existingFields.push(`Description: ${existingData.description}`);
    if (existingData.manifesto?.trim()) existingFields.push(`Manifesto: ${existingData.manifesto}`);
    if (existingData.personality?.trim()) existingFields.push(`Personality: ${existingData.personality}`);
    if (existingData.scenarios && existingData.scenarios.length > 0) {
      const scenarioLines = existingData.scenarios.map(s => `  - ${s.title}: ${s.content}`).join('\n');
      existingFields.push(`Scenarios:\n${scenarioLines}`);
    }

    if (existingFields.length > 0) {
      context += `
Existing Character Information:
${existingFields.join('\n')}
`;
    }
  }

  return context;
}

type LLMProvider = ReturnType<typeof createLLMProvider> extends Promise<infer T> ? T : never;

/**
 * Generate a single field using the LLM
 */
export async function generateField(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  fieldPrompt: string,
  maxTokens: number = 500,
  userId?: string,
  characterId?: string,
  profileProvider?: string,
  profileParameters?: Record<string, unknown>
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: contextPrompt },
    { role: 'user' as const, content: fieldPrompt },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: modelName,
      messages,
      maxTokens,
      temperature: 0.8,
      profileParameters,
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from model');
  }

  // Log the wizard LLM call if userId is available (fire and forget)
  if (userId && profileProvider) {
    logLLMCall({
      userId,
      type: 'CHARACTER_WIZARD',
      characterId: characterId || undefined,
      provider: profileProvider,
      modelName,
      request: {
        messages: [
          { role: 'system', content: contextPrompt },
          { role: 'user', content: fieldPrompt },
        ],
        temperature: 0.8,
        maxTokens,
      },
      response: {
        content: response.content,
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('Failed to log character wizard LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return response.content.trim();
}

const MAX_VISION_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Generate a description of an image using a vision-capable model
 */
export async function generateImageDescription(
  imageFile: FileEntry,
  visionProfile: ConnectionProfile,
  apiKey: string,
  userId?: string,
  characterId?: string
): Promise<string> {
  if (!imageFile.storageKey) {
    throw new Error('Image file has no storage key');
  }
  const imageBuffer = await fileStorageManager.downloadFile(imageFile);

  if (imageBuffer.length > MAX_VISION_IMAGE_SIZE) {
    const sizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Image is too large (${sizeMB}MB). Vision models have a 5MB limit. ` +
        `Please use a smaller image or resize it before uploading.`
    );
  }

  const base64Data = imageBuffer.toString('base64');

  const attachment: FileAttachment = {
    id: imageFile.id,
    filepath: imageFile.storageKey,
    filename: imageFile.originalFilename,
    mimeType: imageFile.mimeType,
    size: imageBuffer.length,
    data: base64Data,
  };

  const provider = await createLLMProvider(visionProfile.provider, visionProfile.baseUrl || undefined);

  const messages = [
    {
      role: 'user' as const,
      content:
        'Please describe this image in great detail. Focus on the physical appearance of any person or character shown. Include: face shape, eye color/shape, hair color/style/length, skin tone, body type/build, clothing, pose, and any distinctive features. Be thorough and specific.',
      attachments: [attachment],
    },
  ];

  const startTime = Date.now();

  const response = await provider.sendMessage(
    {
      model: visionProfile.modelName,
      messages,
      maxTokens: 1000,
      temperature: 0.7,
      profileParameters: profileParams(visionProfile),
    },
    apiKey
  );

  const durationMs = Date.now() - startTime;

  if (!response?.content) {
    throw new Error('No response from vision model');
  }
  // Log the vision LLM call if userId is available (fire and forget)
  if (userId) {
    logLLMCall({
      userId,
      type: 'CHARACTER_WIZARD',
      characterId: characterId || undefined,
      provider: visionProfile.provider,
      modelName: visionProfile.modelName,
      request: {
        messages: [
          {
            role: 'user',
            content:
              'Please describe this image in great detail. Focus on the physical appearance of any person or character shown. Include: face shape, eye color/shape, hair color/style/length, skin tone, body type/build, clothing, pose, and any distinctive features. Be thorough and specific.',
            attachments: [{ id: attachment.id }],
          },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      },
      response: {
        content: response.content,
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      logger.warn('Failed to log character wizard image description LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return response.content.trim();
}

/**
 * Generate all physical description variants
 */
export async function generatePhysicalDescriptions(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  userId?: string,
  characterId?: string,
  profileProvider?: string,
  profileParameters?: Record<string, unknown>
): Promise<GeneratedPhysicalDescription> {
  const results: Partial<GeneratedPhysicalDescription> = {
    name: 'AI Generated',
  };

  for (const [level, prompt] of Object.entries(PHYSICAL_DESCRIPTION_PROMPTS)) {
    const maxTokens = level === 'full' ? 1500 : level === 'complete' ? 400 : 300;
    const content = await generateField(
      provider,
      apiKey,
      modelName,
      contextPrompt,
      prompt,
      maxTokens,
      userId,
      characterId,
      profileProvider,
      profileParameters
    );

    switch (level) {
      case 'headAndShoulders':
        results.headAndShouldersPrompt = content.substring(0, 500);
        break;
      case 'short':
        results.shortPrompt = content.substring(0, 350);
        break;
      case 'medium':
        results.mediumPrompt = content.substring(0, 500);
        break;
      case 'long':
        results.longPrompt = content.substring(0, 750);
        break;
      case 'complete':
        results.completePrompt = content.substring(0, 1000);
        break;
      case 'full':
        results.fullDescription = content;
        break;
    }
  }

  return results as GeneratedPhysicalDescription;
}

/**
 * Generate wardrobe items from LLM
 */
export async function generateWardrobeItems(
  provider: LLMProvider,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  userId?: string,
  characterId?: string,
  profileProvider?: string,
  profileParameters?: Record<string, unknown>
): Promise<GeneratedWardrobeItem[]> {
  const content = await generateField(
    provider,
    apiKey,
    modelName,
    contextPrompt,
    WARDROBE_ITEMS_PROMPT,
    2000,
    userId,
    characterId,
    profileProvider,
    profileParameters
  );

  const items = parseLLMJson<GeneratedWardrobeItem[]>(content);

  // Validate types are valid wardrobe slot types
  const validTypes = new Set(['top', 'bottom', 'footwear', 'accessories']);
  return items
    .filter((item) => item.title && item.types?.length > 0)
    .map((item) => ({
      ...item,
      types: item.types.filter((t) => validTypes.has(t)) as WardrobeItemType[],
    }))
    .filter((item) => item.types.length > 0);
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Run the AI character wizard
 */
export async function runCharacterWizard(
  request: WizardRequest,
  userId: string,
  repos: RepositoryContainer
): Promise<WizardResult> {
  logger.info('[CharacterWizard] Starting', {
    userId,
    characterName: request.characterName,
    fieldsToGenerate: request.fieldsToGenerate,
    sourceType: request.sourceType,
  });

  // Get primary profile
  const primaryProfile = await repos.connections.findById(request.primaryProfileId);
  if (!primaryProfile || primaryProfile.userId !== userId) {
    throw new Error('Primary profile not found');
  }

  // Get primary profile API key
  let primaryApiKey = '';
  if (primaryProfile.apiKeyId) {
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(primaryProfile.apiKeyId, userId);
    if (apiKey) {
      primaryApiKey = apiKey.key_value;
    }
  }

  // Ensure plugin system is initialized
  if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
    const initResult = await initializePlugins();
    if (!initResult.success) {
      throw new Error('Plugin system initialization failed');
    }
  }

  // Create primary provider
  const primaryProvider = await createLLMProvider(primaryProfile.provider, primaryProfile.baseUrl || undefined);

  // Handle image description if needed
  let imageDescription: string | undefined;
  if ((request.sourceType === 'upload' || request.sourceType === 'gallery') && request.imageId) {
    const imageFile = await repos.files.findById(request.imageId);
    if (!imageFile || imageFile.userId !== userId) {
      throw new Error('Image not found');
    }

    let visionProfile = primaryProfile;
    let visionApiKey = primaryApiKey;

    if (!profileSupportsMimeType(primaryProfile, imageFile.mimeType)) {
      if (!request.visionProfileId) {
        throw new Error('Vision profile required for image analysis');
      }

      const secondaryProfile = await repos.connections.findById(request.visionProfileId);
      if (!secondaryProfile || secondaryProfile.userId !== userId) {
        throw new Error('Vision profile not found');
      }

      if (secondaryProfile.apiKeyId) {
        const apiKey = await repos.connections.findApiKeyByIdAndUserId(secondaryProfile.apiKeyId, userId);
        if (apiKey) {
          visionApiKey = apiKey.key_value;
        }
      }

      visionProfile = secondaryProfile;
    }

    imageDescription = await generateImageDescription(
      imageFile,
      visionProfile,
      visionApiKey,
      userId,
      request.characterId
    );
  }

  // Handle document content extraction if needed
  let documentContent: string | undefined;
  if (request.sourceType === 'document' && request.documentId) {
    const documentFile = await repos.files.findById(request.documentId);
    if (!documentFile || documentFile.userId !== userId) {
      throw new Error('Document not found');
    }

    const extractResult = await extractFileContent(documentFile);
    if (!extractResult.success || !extractResult.content) {
      throw new Error(extractResult.error || 'Failed to extract document content');
    }

    documentContent = extractResult.content;
  }

  // Generate requested fields
  const generated: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  // Track the effective character name (may be generated)
  let effectiveCharacterName = request.characterName;

  // If 'name' is in the fields to generate, generate it first
  if (request.fieldsToGenerate.includes('name')) {
    try {
      // Build initial context without a name
      const nameContextPrompt = buildContextPrompt(
        '',
        request.background,
        request.existingData,
        imageDescription,
        documentContent
      );

      const namePrompt = FIELD_PROMPTS.name;
      const generatedName = await generateField(
        primaryProvider,
        primaryApiKey,
        primaryProfile.modelName,
        nameContextPrompt,
        namePrompt,
        100,
        userId,
        request.characterId,
        primaryProfile.provider,
        profileParams(primaryProfile)
      );
      generated.name = generatedName;
      effectiveCharacterName = generatedName;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Generation failed';
      errors.name = errorMessage;
      logger.error('[CharacterWizard] Failed to generate field: name', {
        error: errorMessage,
      });
    }
  }

  // Build context prompt with the effective character name
  const contextPrompt = buildContextPrompt(
    effectiveCharacterName,
    request.background,
    request.existingData,
    imageDescription,
    documentContent
  );

  // Generate remaining fields (excluding 'name' which was already handled)
  for (const field of request.fieldsToGenerate) {
    if (field === 'name') continue; // Already handled above

    try {
      if (field === 'physicalDescription') {
        generated.physicalDescription = await generatePhysicalDescriptions(
          primaryProvider,
          primaryApiKey,
          primaryProfile.modelName,
          contextPrompt,
          userId,
          request.characterId,
          primaryProfile.provider,
          profileParams(primaryProfile)
        );
      } else if (field === 'wardrobeItems') {
        generated.wardrobeItems = await generateWardrobeItems(
          primaryProvider,
          primaryApiKey,
          primaryProfile.modelName,
          contextPrompt,
          userId,
          request.characterId,
          primaryProfile.provider,
          profileParams(primaryProfile)
        );
      } else {
        const fieldPrompt = FIELD_PROMPTS[field];
        const maxTokens = field === 'exampleDialogues' || field === 'systemPrompt' ? 1000 : field === 'scenarios' ? 4000 : 500;
        const rawContent = await generateField(
          primaryProvider,
          primaryApiKey,
          primaryProfile.modelName,
          contextPrompt,
          fieldPrompt,
          maxTokens,
          userId,
          request.characterId,
          primaryProfile.provider,
          profileParams(primaryProfile)
        );
        if (field === 'scenarios') {
          try {
            generated[field] = parseLLMJson<Array<{ title: string; content: string }>>(rawContent);
          } catch {
            logger.warn('[CharacterWizard] Failed to parse scenarios JSON, storing as raw string', { rawContent: rawContent.substring(0, 200) });
            generated[field] = rawContent;
          }
        } else {
          generated[field] = rawContent;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Generation failed';
      errors[field] = errorMessage;
      logger.error(`[CharacterWizard] Failed to generate field: ${field}`, {
        error: errorMessage,
      });
    }
  }

  logger.info('[CharacterWizard] Complete', {
    fieldsGenerated: Object.keys(generated),
    fieldsWithErrors: Object.keys(errors),
  });

  return {
    success: true,
    generated,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
}

/**
 * Get a short snippet from generated content for progress display
 */
function getSnippet(content: unknown, maxLength: number = 100): string {
  if (typeof content === 'string') {
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  }
  if (Array.isArray(content) && content.length > 0) {
    // For scenarios array, use the first scenario's title + content
    const first = content[0] as { title?: string; content?: string };
    const preview = first.title ? `${first.title}: ${first.content ?? ''}` : (first.content ?? '');
    return preview.length > maxLength ? preview.substring(0, maxLength) + '...' : preview;
  }
  if (typeof content === 'object' && content !== null) {
    // For physical description, use the short prompt
    const pd = content as GeneratedPhysicalDescription;
    if (pd.shortPrompt) {
      return pd.shortPrompt.substring(0, maxLength) + (pd.shortPrompt.length > maxLength ? '...' : '');
    }
  }
  return '';
}

/**
 * Run the AI character wizard with streaming progress updates
 */
export async function runCharacterWizardStreaming(
  request: WizardRequest,
  userId: string,
  repos: RepositoryContainer,
  onProgress: WizardProgressCallback
): Promise<void> {
  logger.info('[CharacterWizard] Starting (streaming)', {
    userId,
    characterName: request.characterName,
    fieldsToGenerate: request.fieldsToGenerate,
    sourceType: request.sourceType,
  });

  // Send start event
  onProgress({ type: 'start' });

  try {
    // Get primary profile
    const primaryProfile = await repos.connections.findById(request.primaryProfileId);
    if (!primaryProfile || primaryProfile.userId !== userId) {
      throw new Error('Primary profile not found');
    }

    // Get primary profile API key
    let primaryApiKey = '';
    if (primaryProfile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(primaryProfile.apiKeyId, userId);
      if (apiKey) {
        primaryApiKey = apiKey.key_value;
      }
    }

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins();
      if (!initResult.success) {
        throw new Error('Plugin system initialization failed');
      }
    }

    // Create primary provider
    const primaryProvider = await createLLMProvider(primaryProfile.provider, primaryProfile.baseUrl || undefined);

    // Handle image description if needed
    let imageDescription: string | undefined;
    if ((request.sourceType === 'upload' || request.sourceType === 'gallery') && request.imageId) {
      const imageFile = await repos.files.findById(request.imageId);
      if (!imageFile || imageFile.userId !== userId) {
        throw new Error('Image not found');
      }

      let visionProfile = primaryProfile;
      let visionApiKey = primaryApiKey;

      if (!profileSupportsMimeType(primaryProfile, imageFile.mimeType)) {
        if (!request.visionProfileId) {
          throw new Error('Vision profile required for image analysis');
        }

        const secondaryProfile = await repos.connections.findById(request.visionProfileId);
        if (!secondaryProfile || secondaryProfile.userId !== userId) {
          throw new Error('Vision profile not found');
        }

        if (secondaryProfile.apiKeyId) {
          const apiKey = await repos.connections.findApiKeyByIdAndUserId(secondaryProfile.apiKeyId, userId);
          if (apiKey) {
            visionApiKey = apiKey.key_value;
          }
        }

        visionProfile = secondaryProfile;
      }

      imageDescription = await generateImageDescription(
        imageFile,
        visionProfile,
        visionApiKey,
        userId,
        request.characterId
      );
    }

    // Handle document content extraction if needed
    let documentContent: string | undefined;
    if (request.sourceType === 'document' && request.documentId) {
      const documentFile = await repos.files.findById(request.documentId);
      if (!documentFile || documentFile.userId !== userId) {
        throw new Error('Document not found');
      }

      const extractResult = await extractFileContent(documentFile);
      if (!extractResult.success || !extractResult.content) {
        throw new Error(extractResult.error || 'Failed to extract document content');
      }

      documentContent = extractResult.content;
    }

    // Generate requested fields
    const generated: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    // Track the effective character name (may be generated)
    let effectiveCharacterName = request.characterName;

    // If 'name' is in the fields to generate, generate it first
    if (request.fieldsToGenerate.includes('name')) {
      onProgress({ type: 'field_start', field: 'name' });

      try {
        const nameContextPrompt = buildContextPrompt(
          '',
          request.background,
          request.existingData,
          imageDescription,
          documentContent
        );

        const namePrompt = FIELD_PROMPTS.name;
        const generatedName = await generateField(
          primaryProvider,
          primaryApiKey,
          primaryProfile.modelName,
          nameContextPrompt,
          namePrompt,
          100,
          userId,
          request.characterId,
          primaryProfile.provider,
          profileParams(primaryProfile)
        );
        generated.name = generatedName;
        effectiveCharacterName = generatedName;

        onProgress({ type: 'field_complete', field: 'name', snippet: getSnippet(generatedName) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Generation failed';
        errors.name = errorMessage;
        onProgress({ type: 'field_error', field: 'name', error: errorMessage });
        logger.error('[CharacterWizard] Failed to generate field: name', { error: errorMessage });
      }
    }

    // Build context prompt with the effective character name
    const contextPrompt = buildContextPrompt(
      effectiveCharacterName,
      request.background,
      request.existingData,
      imageDescription,
      documentContent
    );

    // Generate remaining fields (excluding 'name' which was already handled)
    for (const field of request.fieldsToGenerate) {
      if (field === 'name') continue;

      onProgress({ type: 'field_start', field });

      try {
        if (field === 'physicalDescription') {
          const physDesc = await generatePhysicalDescriptions(
            primaryProvider,
            primaryApiKey,
            primaryProfile.modelName,
            contextPrompt,
            userId,
            request.characterId,
            primaryProfile.provider,
            profileParams(primaryProfile)
          );
          generated.physicalDescription = physDesc;
          onProgress({ type: 'field_complete', field, snippet: getSnippet(physDesc) });
        } else if (field === 'wardrobeItems') {
          const items = await generateWardrobeItems(
            primaryProvider,
            primaryApiKey,
            primaryProfile.modelName,
            contextPrompt,
            userId,
            request.characterId,
            primaryProfile.provider,
            profileParams(primaryProfile)
          );
          generated.wardrobeItems = items;
          onProgress({ type: 'field_complete', field, snippet: `${items.length} wardrobe item(s) generated` });
        } else {
          const fieldPrompt = FIELD_PROMPTS[field];
          const maxTokens = field === 'exampleDialogues' || field === 'systemPrompt' ? 1000 : field === 'scenarios' ? 4000 : 500;
          const rawContent = await generateField(
            primaryProvider,
            primaryApiKey,
            primaryProfile.modelName,
            contextPrompt,
            fieldPrompt,
            maxTokens,
            userId,
            request.characterId,
            primaryProfile.provider,
            profileParams(primaryProfile)
          );
          let fieldValue: unknown;
          if (field === 'scenarios') {
            try {
              fieldValue = parseLLMJson<Array<{ title: string; content: string }>>(rawContent);
            } catch {
              logger.warn('[CharacterWizard] Failed to parse scenarios JSON, storing as raw string', { rawContent: rawContent.substring(0, 200) });
              fieldValue = rawContent;
            }
          } else {
            fieldValue = rawContent;
          }
          generated[field] = fieldValue;
          onProgress({ type: 'field_complete', field, snippet: getSnippet(fieldValue) });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Generation failed';
        errors[field] = errorMessage;
        onProgress({ type: 'field_error', field, error: errorMessage });
        logger.error(`[CharacterWizard] Failed to generate field: ${field}`, { error: errorMessage });
      }
    }

    logger.info('[CharacterWizard] Complete (streaming)', {
      fieldsGenerated: Object.keys(generated),
      fieldsWithErrors: Object.keys(errors),
    });

    // Send done event with full content
    onProgress({
      type: 'done',
      fullContent: generated,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Generation failed';
    logger.error('[CharacterWizard] Streaming generation failed', { error: errorMessage });
    onProgress({ type: 'done', error: errorMessage, fullContent: {}, errors: { _fatal: errorMessage } });
  }
}
