/**
 * Story Background Generation Job Handler
 *
 * Handles STORY_BACKGROUND_GENERATION background jobs by generating
 * atmospheric landscape images based on chat context and characters.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import {
  getLanternBackgroundsStore,
  writeLanternBackgroundToMountStore,
} from '@/lib/file-storage/lantern-store-bridge';

import { createImageProvider } from '@/lib/llm/plugin-factory';
import { craftStoryBackgroundPrompt, deriveSceneContext, extractVisibleConversation, type ChatMessage } from '@/lib/memory/cheap-llm-tasks';
import { SceneStateSchema } from '@/lib/schemas/chat.types';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig, type CheapLLMSelection, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { StoryBackgroundGenerationPayload } from '../queue-service';
import type { FileCategory, FileSource } from '@/lib/schemas/types';
import {
  resolveCharacterAppearances,
  sanitizeAppearancesIfNeeded,
  type AppearanceResolutionInput,
  type AppearanceResolutionResult,
} from '@/lib/image-gen/appearance-resolution';
import {
  resolveAesthetic,
  resolveDepictionGuidelines,
  getProjectOfficialMountPointId,
} from '@/lib/image-gen/aesthetic';
import {
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service';
import {
  isImageModerationError as isImageModerationErrorShared,
  resolveUncensoredImageProfileForReroute,
} from '@/lib/services/dangerous-content/provider-routing.service';
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override';
import { convertToWebP } from '@/lib/files/webp-conversion';
import { resolveOrientation } from '@/lib/image-gen/orientation';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { sharedWardrobeTiersForCharacter } from '@/lib/wardrobe/shared-tiers';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import { genderPrefixFromPronouns } from '@/lib/characters/pronoun-gender';
import type { Character } from '@/lib/schemas/types';

// Detection helper lives in the shared dangerous-content service so the
// character-avatar and inline `generate_image` handlers can reuse it.
const isImageModerationError = isImageModerationErrorShared;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBasicEnumeration(char: Character): string {
  const primary = char.physicalDescription;
  const desc =
    primary?.mediumPrompt ||
    primary?.shortPrompt ||
    primary?.longPrompt ||
    primary?.fullDescription ||
    char.name;
  return `${genderPrefixFromPronouns(char.pronouns)}${desc}`.trim();
}

/**
 * Scan a story-background image prompt for any user-workspace character names
 * that are mentioned but lack a matching `Name: ...` enumeration entry, and
 * append canonical enumerations for them. Image providers otherwise hallucinate
 * appearances for characters named in the scene description but not enumerated
 * — typically off-scene-state characters who never made the participant list.
 *
 * Always uses the compact `buildBasicEnumeration` form (gender prefix +
 * mediumPrompt/shortPrompt). The richer participant-resolved description
 * carries the equipped wardrobe with full prose, which dwarfs the image
 * prompt and confuses providers; a back-fill on a name the crafter dropped
 * doesn't earn the wardrobe injection.
 */
function appendMissingCharacterEnumerations(
  prompt: string,
  userCharacters: Character[],
): { prompt: string; added: Array<{ name: string }> } {
  const added: Array<{ name: string }> = [];
  // Process longest names first so "Lady Catherine" wins over "Catherine"
  const ordered = [...userCharacters].sort((a, b) => b.name.length - a.name.length);

  let result = prompt;
  for (const char of ordered) {
    if (!char.name || char.name.length < 2) continue;
    const escaped = escapeRegex(char.name);
    const nameRe = new RegExp(`\\b${escaped}\\b`, 'i');
    if (!nameRe.test(result)) continue;
    // Already enumerated as "Name:" somewhere in the prompt — leave it alone.
    const enumRe = new RegExp(`(?:^|[.!?]\\s+)${escaped}\\s*:\\s`, 'i');
    if (enumRe.test(result)) continue;

    const desc = buildBasicEnumeration(char);
    if (!desc) continue;
    const trailing = /[.!?]\s*$/.test(result) ? ' ' : '. ';
    result = `${result.trimEnd()}${trailing}${char.name}: ${desc.replace(/\s*\.?\s*$/, '')}.`;
    added.push({ name: char.name });
  }
  return { prompt: result, added };
}

/**
 * Handle a story background generation job
 */
export async function handleStoryBackgroundGeneration(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as StoryBackgroundGenerationPayload;
  const repos = getRepositories();

  logger.info('[StoryBackground] Starting background generation', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    chatId: payload.chatId,
    characterCount: payload.characterIds.length,
  });

  // 1. Get the chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // 2. Get the image profile
  const imageProfile = await repos.imageProfiles.findById(payload.imageProfileId);
  if (!imageProfile) {
    throw new Error(`Image profile not found: ${payload.imageProfileId}`);
  }

  // 3. Validate profile has an API key
  if (!imageProfile.apiKeyId) {
    logger.warn('[StoryBackground] Image profile has no API key, skipping generation', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      profileId: imageProfile.id,
    });
    return;
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, job.userId);
  if (!apiKey?.key_value) {
    logger.warn('[StoryBackground] API key not found or invalid, skipping generation', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }

  // 4. Load character data for descriptions
  const characters = await Promise.all(
    payload.characterIds.map(id => repos.characters.findById(id))
  );
  const validCharacters = characters.filter(c => c !== null);

  // Check if we have a fresh scene state to use
  let sceneStateData: import('@/lib/schemas/chat.types').SceneState | null = null;
  if (chat.sceneState) {
    try {
      const parsed = typeof chat.sceneState === 'string' ? JSON.parse(chat.sceneState as string) : chat.sceneState;
      const validated = SceneStateSchema.safeParse(parsed);
      if (validated.success) {
        // Consider scene state "fresh" if within 5 messages of current count
        const messageGap = (chat.messageCount ?? 0) - validated.data.updatedAtMessageCount;
        if (messageGap <= 5) {
          sceneStateData = validated.data;
          logger.info('[StoryBackground] Using fresh scene state for context', {
            context: 'background-jobs.story-background',
            jobId: job.id,
            chatId: payload.chatId,
            sceneStateAge: messageGap,
          });
        }
      }
    } catch {
      // Failed to parse scene state, fall back to normal derivation
    }
  }

  // 5. Get user's chat settings for cheap LLM configuration
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);

  // 6. Get cheap LLM selection for prompt crafting
  // Prioritize the Image Prompt Expansion LLM if configured
  const allProfiles = await repos.connections.findByUserId(job.userId);
  const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];

  if (!defaultProfile) {
    logger.warn('[StoryBackground] No connection profiles available for prompt crafting', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }

  // Use the standard cheap LLM for the initial attempt at story backgrounds
  // (imagePromptProfileId is used as a retry fallback if the safe provider returns empty)
  let cheapLLMSelection: CheapLLMSelection | null = null;
  {
    const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings ? {
      strategy: chatSettings.cheapLLMSettings.strategy,
      userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
      defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
      fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
    } : DEFAULT_CHEAP_LLM_CONFIG;

    cheapLLMSelection = getCheapLLMProvider(
      defaultProfile,
      cheapLLMConfig,
      allProfiles,
      false
    );
  }

  // Resolve the Concierge settings early (needed for uncensored routing and appearance sanitization)
  const dangerousContentResolved = resolveDangerousContentSettings(chatSettings ?? null, chat);
  const dangerSettings = dangerousContentResolved.settings;
  const isDangerousChat = isChatActiveDangerous(chat);
  const hasUncensoredImageProvider = Boolean(dangerSettings.uncensoredImageProfileId);

  // For dangerous chats, use uncensored provider for all cheap LLM tasks
  if (isDangerousChat) {
    cheapLLMSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection!,
      true,
      dangerSettings,
      allProfiles
    );
  }

  // 7. Fetch recent messages (needed for both scene context and appearance resolution)
  const chatEvents = await repos.chats.getMessages(payload.chatId);
  const recentMessages: ChatMessage[] = extractVisibleConversation(chatEvents).slice(-20);

  // 8. Derive scene context AND resolve character appearances in parallel
  let sceneContext = payload.sceneContext || chat.title;

  // Build appearance inputs from loaded characters, enriched with equipped
  // wardrobe items. Equipped slots are arrays-per-slot; composites are
  // expanded via resolveEquippedOutfitForCharacter before flattening for
  // the appearance-resolution input.
  const appearanceInputs: AppearanceResolutionInput[] = [];
  const projectMountPointIds = await resolveProjectMountPointIds(chat.projectId);
  for (const char of validCharacters) {
    let equippedWardrobeItems: Array<{ slot: string; title: string; description?: string | null; imagePrompt?: string | null }> | undefined;
    try {
      const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(payload.chatId, char!.id);
      if (equippedSlots) {
        const resolved = await resolveEquippedOutfitForCharacter(
          repos,
          char!.id,
          equippedSlots,
          await sharedWardrobeTiersForCharacter(char!.id, projectMountPointIds),
        );
        const flat: Array<{ slot: string; title: string; description?: string | null; imagePrompt?: string | null }> = [];
        for (const slot of WARDROBE_SLOT_TYPES) {
          for (const item of resolved.leafItemsBySlot[slot]) {
            flat.push({ slot, title: item.title, description: item.description, imagePrompt: item.imagePrompt });
          }
        }
        if (flat.length > 0) {
          equippedWardrobeItems = flat;
        }
      }
    } catch (err) {
      logger.warn('[StoryBackground] Failed to load equipped wardrobe items for character', {
        characterId: char!.id,
        chatId: payload.chatId,
        error: getErrorMessage(err),
      });
    }
    appearanceInputs.push({
      characterId: char!.id,
      characterName: char!.name,
      physicalDescription: char!.physicalDescription ?? null,
      equippedWardrobeItems,
    });
  }

  // Scene context prompt for appearance resolution
  const scenePromptForAppearance = payload.sceneContext || chat.title;

  // Build uncensored LLM selection once (used for appearance resolution and prompt crafting)
  let uncensoredLLMSelection: CheapLLMSelection | null = null;
  const uncensoredProfileId = chatSettings?.cheapLLMSettings?.imagePromptProfileId;
  if (uncensoredProfileId) {
    const uncensoredProfile = allProfiles.find(p => p.id === uncensoredProfileId);
    if (uncensoredProfile) {
      const isLocal = uncensoredProfile.provider === 'OLLAMA';
      uncensoredLLMSelection = {
        provider: uncensoredProfile.provider,
        modelName: uncensoredProfile.modelName,
        connectionProfileId: uncensoredProfile.id,
        baseUrl: isLocal ? (uncensoredProfile.baseUrl || 'http://localhost:11434') : undefined,
        isLocal,
      };
    }
  }

  // For appearance resolution: if the chat is already marked dangerous and we have an
  // uncensored provider, skip the safe provider entirely (it'll likely refuse anyway)
  const appearanceLLMSelection = (isDangerousChat && uncensoredLLMSelection)
    ? uncensoredLLMSelection
    : cheapLLMSelection;

  if (isDangerousChat && uncensoredLLMSelection) {
  }

  // Run scene context derivation and appearance resolution in parallel
  const [sceneResult, appearanceResolutionResult] = await Promise.all([
    // Scene context derivation
    recentMessages.length > 0 && !sceneStateData
      ? deriveSceneContext(
          {
            chatTitle: chat.title,
            contextSummary: chat.contextSummary,
            recentMessages,
            characterNames: validCharacters.map(c => c!.name),
          },
          cheapLLMSelection,
          job.userId,
          payload.chatId
        )
      : Promise.resolve(null),
    // Appearance resolution
    appearanceInputs.length > 0
      ? resolveCharacterAppearances(
          appearanceInputs,
          recentMessages,
          scenePromptForAppearance,
          appearanceLLMSelection,
          job.userId,
          payload.chatId,
          sceneStateData
        ).catch(error => {
          logger.warn('[StoryBackground] Appearance resolution failed, using defaults', {
            context: 'background-jobs.story-background',
            jobId: job.id,
            error: getErrorMessage(error),
          });
          return null;
        })
      : Promise.resolve(null),
  ]);

  // If we used scene state, set context directly
  if (sceneStateData) {
    const charActions = sceneStateData.characters
      .map(c => `${c.characterName}: ${c.action}`)
      .join('; ');
    sceneContext = `${sceneStateData.location}. ${charActions}`;

    logger.info('[StoryBackground] Used scene state for scene context', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      location: sceneStateData.location,
    });
  } else if (sceneResult?.success && sceneResult.result) {
    // Process scene context result from LLM derivation
    sceneContext = sceneResult.result;
  } else if (recentMessages.length > 0) {
    logger.warn('[StoryBackground] Failed to derive scene context, using fallback', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      error: sceneResult?.error,
      fallback: sceneContext,
    });
  }

  // Process appearance resolution result
  // If the safe LLM failed/refused (likely content refusal) and we haven't already
  // used the uncensored provider, retry with it
  let appearanceResult = appearanceResolutionResult;

  if (appearanceResult && !appearanceResult.llmResolved
      && appearanceInputs.length > 0
      && appearanceLLMSelection === cheapLLMSelection  // Only retry if we used the safe provider
      && uncensoredLLMSelection) {
    logger.info('[StoryBackground] Appearance resolution fell back to defaults (likely content refusal), retrying with uncensored profile', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });

    try {
      const retryResult = await resolveCharacterAppearances(
        appearanceInputs,
        recentMessages,
        scenePromptForAppearance,
        uncensoredLLMSelection,
        job.userId,
        payload.chatId,
        sceneStateData
      );

      if (retryResult.llmResolved) {
        appearanceResult = retryResult;
        logger.info('[StoryBackground] Appearance resolution retry with uncensored profile succeeded', {
          context: 'background-jobs.story-background',
          jobId: job.id,
        });
      } else {
        logger.warn('[StoryBackground] Appearance resolution retry also fell back to defaults', {
          context: 'background-jobs.story-background',
          jobId: job.id,
        });
      }
    } catch (error) {
      logger.warn('[StoryBackground] Appearance resolution retry with uncensored profile failed', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        error: getErrorMessage(error),
      });
    }
  } else if (appearanceResult && !appearanceResult.llmResolved && !uncensoredLLMSelection) {
  }

  // Extract appearances and apply the Concierge sanitization
  let resolvedAppearances = appearanceResult?.appearances ?? null;
  if (resolvedAppearances && resolvedAppearances.length > 0) {
    try {
      resolvedAppearances = await sanitizeAppearancesIfNeeded(
        resolvedAppearances,
        dangerSettings,
        isDangerousChat,
        hasUncensoredImageProvider,
        cheapLLMSelection,
        job.userId,
        payload.chatId
      );
    } catch (error) {
      logger.warn('[StoryBackground] Appearance sanitization failed, using unsanitized', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        error: getErrorMessage(error),
      });
    }
  }

  // Build character descriptions from resolved appearances (or fall back to simple logic)
  const characterDescriptions = validCharacters.map(char => {
    const resolved = resolvedAppearances?.find(a => a.characterId === char!.id);

    // Derive a gender prefix from standard pronouns so image generators know the character's sex
    const genderPrefix = genderPrefixFromPronouns(char!.pronouns);

    if (resolved) {
      const descParts = [genderPrefix + resolved.physicalDescription];
      if (resolved.clothingDescription) {
        descParts.push(`Wearing: ${resolved.clothingDescription}`);
      }
      return {
        name: char!.name,
        description: descParts.join('. '),
      };
    }

    // Fallback: simple first-description logic
    const primary = char!.physicalDescription;
    const descParts = [genderPrefix + (primary?.mediumPrompt || primary?.shortPrompt || char!.name)];
    return {
      name: char!.name,
      description: descParts.join('. '),
    };
  });


  // 9. Resolve default aesthetics (lantern=scene, aurora=figures) and the Ariel
  // Clause (per-character depiction guidelines). Both aesthetics resolve
  // project-over-global; the Ariel Clause reads each character's own vault.
  const projectOfficialMountPointId = await getProjectOfficialMountPointId(chat.projectId);
  const [sceneAesthetic, characterAesthetic] = await Promise.all([
    resolveAesthetic({ kind: 'lantern', projectOfficialMountPointId }),
    resolveAesthetic({ kind: 'aurora', projectOfficialMountPointId }),
  ]);
  const depictionGuidelines = await resolveDepictionGuidelines(validCharacters);

  // 10. Craft the background prompt using cheap LLM

  const craftResult = await craftStoryBackgroundPrompt(
    {
      sceneContext,
      characters: characterDescriptions,
      provider: imageProfile.provider,
      sceneAesthetic,
      characterAesthetic,
      depictionGuidelines,
    },
    cheapLLMSelection,
    job.userId,
    payload.chatId
  );

  let finalPrompt: string | undefined = craftResult.result;

  if (!craftResult.success) {
    // Actual error from the cheap LLM
    logger.warn('[StoryBackground] Failed to craft background prompt', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      error: craftResult.error,
    });
    return;
  }

  if (!finalPrompt) {
    // Success but empty result — treat as a silent content refusal
    logger.warn('[StoryBackground] Empty response from safe provider, treating as content refusal', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      sceneContext,
    });

    if (uncensoredLLMSelection) {
      logger.info('[StoryBackground] Retrying prompt crafting with uncensored profile', {
        context: 'background-jobs.story-background',
        jobId: job.id,
      });

      const retryResult = await craftStoryBackgroundPrompt(
        {
          sceneContext,
          characters: characterDescriptions,
          provider: imageProfile.provider,
          sceneAesthetic,
          characterAesthetic,
          depictionGuidelines,
        },
        uncensoredLLMSelection,
        job.userId,
        payload.chatId
      );

      if (retryResult.success && retryResult.result) {
        finalPrompt = retryResult.result;
        logger.info('[StoryBackground] Retry with uncensored profile succeeded', {
          context: 'background-jobs.story-background',
          jobId: job.id,
          promptLength: finalPrompt.length,
        });
      } else {
        logger.warn('[StoryBackground] Retry with uncensored profile also failed', {
          context: 'background-jobs.story-background',
          jobId: job.id,
          error: retryResult.error,
        });
        return;
      }
    } else {
      logger.warn('[StoryBackground] No uncensored image prompt profile configured, cannot retry', {
        context: 'background-jobs.story-background',
        jobId: job.id,
      });
      return;
    }
  }

  // 9b. Ensure every workspace character mentioned in the prompt is enumerated.
  // The cheap LLM is given the participant list, but the scene context (chat
  // title, derived scene, or SceneState character actions) can name additional
  // characters who aren't current participants. Without a matching
  // `Name: appearance` entry the image provider invents an appearance for them.
  //
  // Participants are excluded: the crafter already received their full
  // descriptions and wove them into the scene (e.g. "On the left, Friday, a
  // woman with…"). Re-appending canonical `Friday: A woman. …` portraits on
  // top of that produces a divided/triptych image as the provider tries to
  // render both the integrated scene AND the portrait sidecards.
  try {
    const participantIdSet = new Set(payload.characterIds);
    const userCharacters = await repos.characters.findByUserId(job.userId);
    const nonParticipantCharacters = userCharacters.filter(c => !participantIdSet.has(c.id));
    const enrichResult = appendMissingCharacterEnumerations(
      finalPrompt!,
      nonParticipantCharacters,
    );
    if (enrichResult.added.length > 0) {
      logger.info('[StoryBackground] Appended missing character enumerations to prompt', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        chatId: payload.chatId,
        added: enrichResult.added,
        promptLengthBefore: finalPrompt!.length,
        promptLengthAfter: enrichResult.prompt.length,
      });
      finalPrompt = enrichResult.prompt;
    } else {
      logger.debug('[StoryBackground] No missing character enumerations to append', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        chatId: payload.chatId,
        promptLength: finalPrompt!.length,
      });
    }
  } catch (err) {
    logger.warn('[StoryBackground] Failed to scan prompt for missing character enumerations', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      chatId: payload.chatId,
      error: getErrorMessage(err),
    });
  }


  // 10. Generate the image
  const provider = createImageProvider(imageProfile.provider);

  const decryptedKey = apiKey.key_value;

  // Tracks which profile actually produced the final image — updated if we
  // reroute through the Concierge's uncensored fallback after a moderation
  // rejection. Used downstream for file metadata (`generationModel`).
  let activeImageProfile = imageProfile;

  let generationResponse;
  const genStartTime = Date.now();
  // Backgrounds default to landscape; the resolver maps that onto the provider's
  // own size / aspect ratio / prompt wording.
  const resolved = resolveOrientation(imageProfile.provider, imageProfile.modelName, 'landscape');
  const genPrompt = resolved.promptHint ? `${finalPrompt}\n\n${resolved.promptHint}` : finalPrompt;
  try {
    generationResponse = await provider.generateImage({
      prompt: genPrompt,
      model: imageProfile.modelName,
      n: 1,
      ...resolved.params,
      quality: (imageProfile.parameters as Record<string, unknown>)?.quality as 'standard' | 'hd' | undefined,
      style: 'natural', // Natural style works better for ambient backgrounds
    }, decryptedKey);

    const genDurationMs = Date.now() - genStartTime;
    const revisedPrompt = generationResponse.images?.[0]?.revisedPrompt || '';

    await logLLMCall({
      userId: job.userId,
      type: 'IMAGE_GENERATION',
      chatId: payload.chatId,
      provider: imageProfile.provider,
      modelName: imageProfile.modelName,
      imageProfileId: imageProfile.id,
      request: {
        messages: [{ role: 'user', content: finalPrompt }],
      },
      response: {
        content: revisedPrompt || `Generated ${generationResponse.images?.length ?? 0} image(s)`,
      },
      durationMs: genDurationMs,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const genDurationMs = Date.now() - genStartTime;

    await logLLMCall({
      userId: job.userId,
      type: 'IMAGE_GENERATION',
      chatId: payload.chatId,
      provider: imageProfile.provider,
      modelName: imageProfile.modelName,
      imageProfileId: imageProfile.id,
      request: {
        messages: [{ role: 'user', content: finalPrompt }],
      },
      response: {
        content: '',
        error: errorMessage,
      },
      durationMs: genDurationMs,
    });

    // If the provider post-hoc rejected the generated image for content
    // moderation, the Concierge has a second door: retry with the configured
    // uncensored image profile. Mirrors the appearance-resolution and
    // prompt-crafting fallbacks above.
    const reroute = isImageModerationError(error)
      ? await resolveUncensoredImageProfileForReroute(imageProfile.id, dangerSettings, job.userId)
      : null;

    if (!reroute) {
      logger.error('[StoryBackground] Image generation failed', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        error: errorMessage,
        moderationRejection: isImageModerationError(error),
        hasUncensoredImageProvider,
      }, error as Error);
      throw new Error(`Image generation failed: ${errorMessage}`);
    }

    logger.info('[StoryBackground] Image provider rejected for content moderation, rerouting through Concierge uncensored profile', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      originalProfileId: imageProfile.id,
      originalProvider: imageProfile.provider,
      fallbackProfileId: reroute.profile.id,
      fallbackProvider: reroute.profile.provider,
      originalError: errorMessage,
    });

    const rerouteProvider = createImageProvider(reroute.profile.provider);
    const rerouteStartTime = Date.now();
    // Re-resolve for the reroute provider/model — its shape mechanism may differ.
    const rerouteResolved = resolveOrientation(reroute.profile.provider, reroute.profile.modelName, 'landscape');
    const reroutePrompt = rerouteResolved.promptHint ? `${finalPrompt}\n\n${rerouteResolved.promptHint}` : finalPrompt;
    try {
      generationResponse = await rerouteProvider.generateImage({
        prompt: reroutePrompt,
        model: reroute.profile.modelName,
        n: 1,
        ...rerouteResolved.params,
        quality: (reroute.profile.parameters as Record<string, unknown>)?.quality as 'standard' | 'hd' | undefined,
        style: 'natural',
      }, reroute.apiKey);

      const rerouteDurationMs = Date.now() - rerouteStartTime;
      const rerouteRevisedPrompt = generationResponse.images?.[0]?.revisedPrompt || '';

      await logLLMCall({
        userId: job.userId,
        type: 'IMAGE_GENERATION',
        chatId: payload.chatId,
        provider: reroute.profile.provider,
        modelName: reroute.profile.modelName,
        imageProfileId: reroute.profile.id,
        request: {
          messages: [{ role: 'user', content: finalPrompt }],
        },
        response: {
          content: rerouteRevisedPrompt || `Generated ${generationResponse.images?.length ?? 0} image(s) (Concierge reroute)`,
        },
        durationMs: rerouteDurationMs,
      });

      activeImageProfile = reroute.profile;

      logger.info('[StoryBackground] Concierge uncensored reroute succeeded', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        fallbackProvider: reroute.profile.provider,
        fallbackModel: reroute.profile.modelName,
        rerouteDurationMs,
      });
    } catch (rerouteError) {
      const rerouteErrorMessage = getErrorMessage(rerouteError);
      const rerouteDurationMs = Date.now() - rerouteStartTime;

      await logLLMCall({
        userId: job.userId,
        type: 'IMAGE_GENERATION',
        chatId: payload.chatId,
        provider: reroute.profile.provider,
        modelName: reroute.profile.modelName,
        imageProfileId: reroute.profile.id,
        request: {
          messages: [{ role: 'user', content: finalPrompt }],
        },
        response: {
          content: '',
          error: rerouteErrorMessage,
        },
        durationMs: rerouteDurationMs,
      });

      logger.error('[StoryBackground] Image generation failed (Concierge reroute also failed)', {
        context: 'background-jobs.story-background',
        jobId: job.id,
        originalError: errorMessage,
        rerouteError: rerouteErrorMessage,
      }, rerouteError as Error);
      throw new Error(`Image generation failed after Concierge reroute: ${rerouteErrorMessage}`);
    }
  }

  // 11. Save the generated image
  if (!generationResponse.images || generationResponse.images.length === 0) {
    logger.warn('[StoryBackground] No images returned from provider', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }

  const imageData = generationResponse.images[0];
  const rawData = imageData.data || imageData.b64Json;
  if (!rawData) {
    logger.warn('[StoryBackground] Generated image has no data', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    });
    return;
  }
  const rawBuffer = Buffer.from(rawData, 'base64');
  const providerMimeType = imageData.mimeType || 'image/png';
  const providerExt = providerMimeType.split('/')[1] || 'png';
  const providerFilename = `story_background_${Date.now()}.${providerExt}`;

  // Convert to WebP for consistent storage
  const converted = await convertToWebP(rawBuffer, providerMimeType, providerFilename);
  const buffer = converted.buffer;
  const mimeType = converted.mimeType;
  const originalFilename = converted.filename;

  const sha256 = sha256OfBuffer(buffer);
  const fileId = crypto.randomUUID();

  // Build linkedTo array with chat and character IDs
  const linkedTo = [payload.chatId, ...payload.characterIds];

  try {
    const folderProjectId = payload.projectId ?? null;

    // Project-scoped backgrounds keep landing in the project's official mount
    // (handled by fileStorageManager → project-store-bridge). Project-less
    // backgrounds must land in the global Lantern Backgrounds mount; no disk
    // fallback — fail rather than leak generated bytes into _general/.
    let storageKey: string;
    let fileFolderPath: string | null;
    let usedLantern = false;
    // The bridges transcode bitmap uploads to WebP; the FileEntry must
    // record the post-transcode mime/size, not the input.
    let storedMimeType: string;
    let storedSize: number;

    if (folderProjectId) {
      const uploadResult = await fileStorageManager.uploadFile({
        filename: originalFilename,
        content: buffer,
        contentType: mimeType,
        projectId: folderProjectId,
        folderPath: '/story-backgrounds/',
      });
      storageKey = uploadResult.storageKey;
      storedMimeType = uploadResult.storedMimeType;
      storedSize = uploadResult.sizeBytes;
      fileFolderPath = '/story-backgrounds/';
    } else {
      const lantern = await getLanternBackgroundsStore();
      if (!lantern) {
        throw new Error(
          'Lantern Backgrounds mount is not provisioned; cannot persist project-less story background.',
        );
      }
      const written = await writeLanternBackgroundToMountStore({
        filename: originalFilename,
        content: buffer,
        contentType: mimeType,
        subfolder: 'generated',
        description: `Story background for: ${payload.sceneContext || chat.title}`,
      });
      storageKey = written.storageKey;
      storedMimeType = written.storedMimeType;
      storedSize = written.sizeBytes;
      fileFolderPath = null;
      usedLantern = true;
    }

    // Legacy folder records only matter for the project-mount tree; the
    // Lantern mount manages its own folder hierarchy in doc_mount_folders.
    if (!usedLantern) {
      const existingFolder = await repos.folders.findByPath(
        job.userId,
        '/story-backgrounds/',
        folderProjectId
      );
      if (!existingFolder) {
        await repos.folders.create({
          userId: job.userId,
          path: '/story-backgrounds/',
          name: 'story-backgrounds',
          parentFolderId: null,
          projectId: folderProjectId,
        });
      }
    }

    const category: FileCategory = 'IMAGE';
    const source: FileSource = 'GENERATED';

    await repos.files.create({
      userId: job.userId,
      sha256,
      originalFilename,
      mimeType: storedMimeType,
      size: storedSize,
      // Actual dimensions measured from the stored bytes (see
      // image-orientation-gating) — providers may return a different shape.
      width: converted.width ?? null,
      height: converted.height ?? null,
      linkedTo,
      source,
      category,
      generationPrompt: finalPrompt,
      generationModel: activeImageProfile.modelName,
      generationRevisedPrompt: imageData.revisedPrompt || null,
      description: `Story background for: ${payload.sceneContext || chat.title}`,
      tags: [],
      storageKey,
      projectId: folderProjectId,
      folderPath: fileFolderPath,
    }, { id: fileId });

    logger.info('[StoryBackground] Image saved successfully', {
      context: 'background-jobs.story-background',
      jobId: job.id,
      fileId,
    });
  } catch (error) {
    logger.error('[StoryBackground] Failed to save image', {
      context: 'background-jobs.story-background',
      jobId: job.id,
    }, error as Error);
    throw new Error(`Failed to save generated image: ${getErrorMessage(error)}`);
  }

  // 12. Update chat with the new background image ID
  await repos.chats.update(payload.chatId, {
    storyBackgroundImageId: fileId,
    lastBackgroundGeneratedAt: new Date().toISOString(),
  });

  // 13. If chat belongs to a project with 'latest_chat' display mode, update project reference
  if (payload.projectId) {
    const project = await repos.projects.findById(payload.projectId);
    if (project && project.backgroundDisplayMode === 'latest_chat') {
      await repos.projects.update(payload.projectId, {
        storyBackgroundImageId: fileId,
      });

    }
  }

  logger.info('[StoryBackground] Story background generation completed', {
    context: 'background-jobs.story-background',
    jobId: job.id,
    chatId: payload.chatId,
    fileId,
  });

  await postLanternImageNotification({
    chatId: payload.chatId,
    fileId,
    kind: { kind: 'background' },
    prompt: finalPrompt,
  });
}
