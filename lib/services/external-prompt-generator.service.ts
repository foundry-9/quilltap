/**
 * External Prompt Generator Service
 *
 * Generates standalone system prompts for characters, suitable for use
 * in external tools like Claude Desktop, ChatGPT Custom Instructions, etc.
 * Synthesizes character fields into a single self-contained second-person
 * Markdown prompt using an LLM.
 */

import { createLLMProvider } from '@/lib/llm';
import { profileParams } from '@/lib/llm/cheap-llm';
import { buildCharacterCacheKey } from '@/lib/llm/cache-key';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup';
import { getSafeInputLimit } from '@/lib/llm/model-context-data';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';

const log = logger.child({ module: 'external-prompt-generator' });

// ============================================================================
// Types
// ============================================================================

export interface ExternalPromptRequest {
  connectionProfileId: string;
  systemPromptId: string;
  scenarioId?: string;
  maxTokens: number;
}

export interface ExternalPromptResult {
  success: boolean;
  prompt: string;
  tokensUsed: number;
  error?: string;
}

// ============================================================================
// Meta-Prompt
// ============================================================================

const META_SYSTEM_PROMPT = `You are a prompt engineering expert. Your task is to generate a standalone system prompt for an AI character, suitable for pasting into external tools like Claude Desktop, ChatGPT Custom Instructions, or similar hosted environments.

**Requirements:**
- Write the entire prompt in second person ("You are [Name]. You always...", etc.)
- Output in Markdown format with clear sections
- The prompt must be completely self-contained — it should include all personality, behavioral, speech pattern, and contextual information needed for an AI to portray this character without any additional context
- Capture the character's voice, mannerisms, and personality authentically
- Include guidance on how the character responds to different types of interactions
- If a scenario is provided, weave the setting naturally into the prompt
- If physical appearance or clothing details are provided, include them so the character can reference their own appearance
- Do NOT include meta-instructions about being an AI or breaking character
- Do NOT reference Quilltap or any external system
- The prompt should read as a coherent, well-structured character brief

Stay within the token budget specified by the user. Be thorough but concise.`;

// ============================================================================
// Service
// ============================================================================

export async function generateExternalPrompt(
  characterId: string,
  request: ExternalPromptRequest,
  userId: string,
  repos: RepositoryContainer
): Promise<ExternalPromptResult> {
  log.info('Starting external prompt generation', {
    characterId,
    connectionProfileId: request.connectionProfileId,
    systemPromptId: request.systemPromptId,
    scenarioId: request.scenarioId || '(none)',
    maxTokens: request.maxTokens,
  });

  // Ensure plugins are initialized
  if (!isPluginSystemInitialized()) {
    await initializePlugins();
  }

  // Resolve connection profile and API key
  const profile = await repos.connections.findById(request.connectionProfileId);
  if (!profile) {
    log.warn('Connection profile not found', { connectionProfileId: request.connectionProfileId });
    return { success: false, prompt: '', tokensUsed: 0, error: 'Connection profile not found' };
  }

  let apiKey = '';
  if (profile.apiKeyId) {
    const keyRecord = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
    if (keyRecord) {
      apiKey = keyRecord.key_value;
    }
  }

  // Fetch character data
  const character = await repos.characters.findById(characterId);
  if (!character) {
    log.warn('Character not found', { characterId });
    return { success: false, prompt: '', tokensUsed: 0, error: 'Character not found' };
  }

  // Find selected system prompt
  const systemPrompt = character.systemPrompts?.find(sp => sp.id === request.systemPromptId);
  if (!systemPrompt) {
    log.warn('System prompt not found', { systemPromptId: request.systemPromptId });
    return { success: false, prompt: '', tokensUsed: 0, error: 'System prompt not found' };
  }

  // Resolve optional data
  let scenarioContent: string | undefined;
  if (request.scenarioId) {
    const scenario = character.scenarios?.find(s => s.id === request.scenarioId);
    if (scenario) {
      scenarioContent = scenario.content;
    }
  }

  let descriptionContent: string | undefined;
  const desc = character.physicalDescription;
  if (desc) {
    // Use the most detailed available description
    descriptionContent = desc.fullDescription || desc.completePrompt || desc.longPrompt || desc.mediumPrompt || desc.shortPrompt || undefined;
  }

  // Build the user message with all character data
  const userMessage = buildUserMessage(character, systemPrompt, scenarioContent, descriptionContent, undefined, request.maxTokens);

  // Estimate input tokens (rough: 1 token ≈ 4 characters)
  const estimatedInputTokens = Math.ceil((META_SYSTEM_PROMPT.length + userMessage.length) / 4);
  const safeInputLimit = getSafeInputLimit(profile.provider, profile.modelName, request.maxTokens);

  if (estimatedInputTokens > safeInputLimit) {
    const errorMsg = `Character data is too large for the selected model's context window at the requested output size. Estimated input: ~${estimatedInputTokens} tokens, safe limit: ~${safeInputLimit} tokens. Try reducing the token limit or selecting a model with a larger context window.`;
    log.warn('Input exceeds safe context limit', {
      characterId,
      estimatedInputTokens,
      safeInputLimit,
      maxTokens: request.maxTokens,
    });
    return { success: false, prompt: '', tokensUsed: 0, error: errorMsg };
  }

  // Create LLM provider and generate
  try {
    const provider = await createLLMProvider(profile.provider, profile.baseUrl ?? undefined);
    const messages = [
      { role: 'system' as const, content: META_SYSTEM_PROMPT },
      { role: 'user' as const, content: userMessage },
    ];

    const startTime = Date.now();

    const response = await provider.sendMessage(
      {
        model: profile.modelName,
        messages,
        maxTokens: request.maxTokens,
        temperature: 0.7,
        cacheKey: buildCharacterCacheKey(characterId),
        profileParameters: profileParams(profile),
      },
      apiKey
    );

    const durationMs = Date.now() - startTime;

    if (!response?.content) {
      log.error('No response content from LLM');
      return { success: false, prompt: '', tokensUsed: 0, error: 'No response from model' };
    }

    const tokensUsed = response.usage?.totalTokens || 0;

    log.info('External prompt generated successfully', {
      characterId,
      durationMs,
      tokensUsed,
      outputLength: response.content.length,
    });

    // Log the LLM call (fire and forget)
    logLLMCall({
      userId,
      type: 'EXTERNAL_PROMPT',
      characterId,
      provider: profile.provider,
      modelName: profile.modelName,
      request: {
        messages: [
          { role: 'system', content: META_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        maxTokens: request.maxTokens,
      },
      response: {
        content: response.content,
        error: undefined,
      },
      usage: response.usage,
      durationMs,
    }).catch(err => {
      log.warn('Failed to log external prompt LLM call', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return { success: true, prompt: response.content, tokensUsed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Generation failed';
    log.error('External prompt generation failed', { characterId, error: errorMessage });
    return { success: false, prompt: '', tokensUsed: 0, error: errorMessage };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function buildUserMessage(
  character: any,
  systemPrompt: { name: string; content: string },
  scenarioContent?: string,
  descriptionContent?: string,
  clothingContent?: string,
  maxTokens?: number
): string {
  const parts: string[] = [];

  parts.push(`Generate a standalone system prompt for the following character. Target approximately ${maxTokens || 4000} tokens for the output.`);
  parts.push('');

  parts.push(`# Character: ${character.name}`);
  if (character.title) {
    parts.push(`**Title:** ${character.title}`);
  }
  if (character.aliases?.length > 0) {
    parts.push(`**Also known as:** ${character.aliases.join(', ')}`);
  }
  if (character.pronouns) {
    const p = character.pronouns;
    parts.push(`**Pronouns:** ${p.subject}/${p.object}/${p.possessive}`);
  }
  parts.push('');

  if (character.description) {
    parts.push('## Description');
    parts.push(character.description);
    parts.push('');
  }

  if (character.manifesto) {
    parts.push('## Manifesto');
    parts.push(character.manifesto);
    parts.push('');
  }

  if (character.personality) {
    parts.push('## Personality');
    parts.push(character.personality);
    parts.push('');
  }

  parts.push('## System Prompt');
  parts.push(`**Prompt name:** ${systemPrompt.name}`);
  parts.push(systemPrompt.content);
  parts.push('');

  if (scenarioContent) {
    parts.push('## Scenario / Setting');
    parts.push(scenarioContent);
    parts.push('');
  }

  if (descriptionContent) {
    parts.push('## Physical Appearance');
    parts.push(descriptionContent);
    parts.push('');
  }

  if (clothingContent) {
    parts.push('## Clothing / Attire');
    parts.push(clothingContent);
    parts.push('');
  }

  if (character.firstMessage) {
    parts.push('## Typical First Message');
    parts.push('(This shows how the character typically opens a conversation:)');
    parts.push(character.firstMessage);
    parts.push('');
  }

  if (character.exampleDialogues) {
    parts.push('## Example Dialogues');
    parts.push('(These show the character\'s typical voice and interaction style:)');
    parts.push(character.exampleDialogues);
    parts.push('');
  }

  return parts.join('\n');
}
