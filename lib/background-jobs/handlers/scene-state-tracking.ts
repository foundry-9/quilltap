/**
 * Scene State Tracking Job Handler
 *
 * Handles SCENE_STATE_TRACKING background jobs by deriving a structured
 * summary of the current scene: location, character actions, appearance, and clothing.
 * Uses the cheap LLM (or uncensored fallback for dangerous chats).
 */

import { BackgroundJob, MessageEvent, isParticipantPresent } from '@/lib/schemas/types';
import { SceneStateSchema } from '@/lib/schemas/chat.types';
import { getRepositories } from '@/lib/repositories/factory';
import { getCheapLLMProvider, CheapLLMConfig, type CheapLLMSelection, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import { updateSceneState, extractVisibleConversation, throwIfLostToTimeout } from '@/lib/memory/cheap-llm-tasks';
import { createSystemEvent } from '@/lib/services/system-events.service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override';
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service';
import { createServiceLogger } from '@/lib/logging/create-logger';
import type { SceneStateTrackingPayload } from '../queue-service';
import { describeEquippedOutfitTitleOnly } from '@/lib/wardrobe/resolve-equipped';
import { hashEquippedSlots, hasEquippedItems } from '@/lib/wardrobe/outfit-hash';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';

const logger = createServiceLogger('SceneStateTrackingHandler');

export async function handleSceneStateTracking(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as SceneStateTrackingPayload;
  const repos = getRepositories();

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    logger.warn('[SceneStateTracking] Chat not found, skipping', { jobId: job.id, chatId: payload.chatId });
    return;
  }

  // 2. Load characters
  const characters = await Promise.all(
    payload.characterIds.map(id => repos.characters.findById(id))
  );
  const validCharacters = characters.filter(c => c !== null);

  // 3. Get chat settings for cheap LLM
  const chatSettings = await repos.chatSettings.findByUserId(job.userId);
  const availableProfiles = await repos.connections.findByUserId(job.userId);

  // 4. Get connection profile (with fallback)
  let connectionProfile = await repos.connections.findById(payload.connectionProfileId);
  if (!connectionProfile) {
    logger.warn('[SceneStateTracking] Connection profile not found, trying fallback', {
      jobId: job.id, chatId: payload.chatId, connectionProfileId: payload.connectionProfileId,
    });
    if (availableProfiles.length > 0) {
      connectionProfile = availableProfiles[0];
    } else {
      logger.warn('[SceneStateTracking] No available connection profiles, skipping', { jobId: job.id, chatId: payload.chatId });
      return;
    }
  }

  // 5. Get cheap LLM selection
  const cheapLLMConfig: CheapLLMConfig = {
    strategy: chatSettings?.cheapLLMSettings?.strategy || 'PROVIDER_CHEAPEST',
    userDefinedProfileId: chatSettings?.cheapLLMSettings?.userDefinedProfileId || undefined,
    defaultCheapProfileId: chatSettings?.cheapLLMSettings?.defaultCheapProfileId || undefined,
    fallbackToLocal: chatSettings?.cheapLLMSettings?.fallbackToLocal ?? true,
  };

  const isDangerousChat = isChatActiveDangerous(chat);
  let cheapLLMSelection = getCheapLLMProvider(connectionProfile, cheapLLMConfig, availableProfiles, false);

  // For dangerous chats, use uncensored provider to avoid content refusals.
  // Pass the chat so an Off-duty override collapses dangerSettings to mode='OFF'.
  const { settings: dangerSettings } = resolveDangerousContentSettings(chatSettings, chat);
  if (isDangerousChat) {
    cheapLLMSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      dangerSettings,
      availableProfiles
    );
  }

  // Build uncensored LLM selection for pre-classification fallback and retries
  let uncensoredLLMSelection: CheapLLMSelection | null = null;
  const uncensoredProfileId = chatSettings?.cheapLLMSettings?.imagePromptProfileId;
  if (uncensoredProfileId) {
    const uncensoredProfile = availableProfiles.find(p => p.id === uncensoredProfileId);
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

  // 6. Parse previous scene state if it exists
  let previousSceneState: Record<string, unknown> | null = null;
  let lastUpdateMessageCount = 0;
  if (chat.sceneState) {
    try {
      const parsed = typeof chat.sceneState === 'string' ? JSON.parse(chat.sceneState) : chat.sceneState;
      const validated = SceneStateSchema.safeParse(parsed);
      if (validated.success) {
        previousSceneState = parsed;
        lastUpdateMessageCount = validated.data.updatedAtMessageCount;
      }
    } catch {
    }
  }

  // 7. Get messages since last update (or all messages for first turn)
  const allEvents = await repos.chats.getMessages(payload.chatId);
  const allMessages = extractVisibleConversation(allEvents);

  // For subsequent turns, only get messages since last update
  // We use a simple approach: skip the first N messages where N = messages at last update
  const recentMessages = previousSceneState
    ? allMessages.slice(lastUpdateMessageCount > 0 ? Math.max(0, lastUpdateMessageCount - 2) : 0)
    : allMessages.slice(-20); // First turn: use last 20 messages

  if (recentMessages.length === 0) {
    return;
  }

  // 7b. Pre-classify content through the Concierge gatekeeper
  // The danger classification job runs in parallel and may not have completed yet,
  // so we classify the recent messages ourselves to decide provider routing.
  if (!isDangerousChat && uncensoredLLMSelection && dangerSettings.mode !== 'OFF') {
    try {
      const sampleText = recentMessages.slice(-10)
        .map(m => m.content.substring(0, 300))
        .join('\n');

      if (sampleText.length > 0) {
        const classification = await classifyContent(
          sampleText,
          cheapLLMSelection,
          job.userId,
          dangerSettings,
          payload.chatId
        );

        if (classification.isDangerous) {
          logger.info('[SceneStateTracking] Content pre-classified as dangerous, routing to uncensored provider', {
            jobId: job.id,
            chatId: payload.chatId,
            score: classification.score,
            categories: classification.categories.map(c => c.category),
            provider: uncensoredLLMSelection.provider,
          });
          cheapLLMSelection = uncensoredLLMSelection;
        }
      }
    } catch (error) {
      // Fail open — use standard provider if classification fails
      logger.warn('[SceneStateTracking] Content pre-classification failed, using standard provider', {
        jobId: job.id,
        chatId: payload.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 8. Build character baseline data — only include present (active/silent) participants
  const presentParticipantCharacterIds = new Set(
    chat.participants
      .filter(p => isParticipantPresent(p.status) && p.characterId)
      .map(p => p.characterId)
  );
  const presentCharacters = validCharacters.filter(c => c && presentParticipantCharacterIds.has(c.id));

  // Build character baselines with equipped wardrobe items. Also capture each
  // character's raw equipped slots so we can hash them for the concise-clothing
  // cache below (the wardrobe only changes on an explicit edit, so a matching
  // hash lets us reuse the cached summary instead of re-summarizing).
  const projectMountPointIds = await resolveProjectMountPointIds(chat.projectId);
  const equippedSlotsByCharacterId = new Map<string, EquippedSlots | null>();
  const characterBaselines = await Promise.all(presentCharacters.map(async (char) => {
    let clothingDescription = '';

    // Load equipped wardrobe items for clothing description. Slots are
    // arrays-per-slot; composites are expanded to leaves before describing.
    try {
      const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(payload.chatId, char!.id);
      equippedSlotsByCharacterId.set(char!.id, equippedSlots ?? null);
      if (equippedSlots) {
        clothingDescription = await describeEquippedOutfitTitleOnly(
          repos,
          char!.id,
          equippedSlots,
          projectMountPointIds,
        );
      }
    } catch (error) {
      logger.warn('[SceneStateTracking] Failed to load equipped wardrobe for character', {
        jobId: job.id,
        characterId: char!.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      characterId: char!.id,
      characterName: char!.name,
      physicalDescription: char!.physicalDescription?.mediumPrompt || char!.physicalDescription?.shortPrompt || '',
      clothingDescription,
      scenario: chat.scenarioText || char!.scenarios?.[0]?.content || undefined,
    };
  }));

  // 8b. Extract chat scenario context
  // Also include context summary if available (provides ongoing scene context)
  const chatScenarioParts: string[] = [];
  if (chat.contextSummary) {
    chatScenarioParts.push(`Story so far: ${chat.contextSummary}`);
  }
  const chatScenario = chatScenarioParts.length > 0
    ? chatScenarioParts.join('\n\n')
    : undefined;

  // 9. Call updateSceneState
  const sceneStateInput = {
    previousSceneState,
    characters: characterBaselines,
    recentMessages,
    messageCount: chat.messageCount ?? 0,
    chatScenario,
  };

  // Build uncensored fallback options for the built-in retry in executeCheapLLMTask
  const uncensoredFallback = dangerSettings.mode !== 'OFF' ? {
    dangerSettings,
    availableProfiles,
  } : undefined;

  let result = await updateSceneState(
    sceneStateInput,
    cheapLLMSelection,
    job.userId,
    payload.chatId,
    uncensoredFallback
  );

  // 9b. If the result looks like a content refusal (location "Unknown" or empty),
  // retry with uncensored provider if available and we haven't already used it
  const looksLikeRefusal = result.success && result.result &&
    ((result.result as any).location === 'Unknown' || (result.result as any).location === 'unknown' || !(result.result as any).location);

  if (looksLikeRefusal && uncensoredLLMSelection && cheapLLMSelection !== uncensoredLLMSelection) {
    logger.info('[SceneStateTracking] Result looks like content refusal, retrying with uncensored provider', {
      jobId: job.id,
      chatId: payload.chatId,
      originalLocation: (result.result as any)?.location,
      provider: uncensoredLLMSelection.provider,
    });

    const retryResult = await updateSceneState(
      sceneStateInput,
      uncensoredLLMSelection,
      job.userId,
      payload.chatId
    );

    if (retryResult.success && retryResult.result &&
        (retryResult.result as any).location && (retryResult.result as any).location !== 'Unknown') {
      result = retryResult;
      cheapLLMSelection = uncensoredLLMSelection;
      logger.info('[SceneStateTracking] Retry with uncensored provider succeeded', {
        jobId: job.id, chatId: payload.chatId, location: (retryResult.result as any).location,
      });
    } else {
      logger.warn('[SceneStateTracking] Retry with uncensored provider also produced poor result', {
        jobId: job.id, chatId: payload.chatId,
        location: (retryResult.result as any)?.location,
        error: retryResult.error,
      });
    }
  }

  if (!result.success || !result.result) {
    logger.warn('[SceneStateTracking] Failed to derive scene state', {
      jobId: job.id, chatId: payload.chatId, error: result.error, timedOut: result.timedOut === true,
    });
    // A pass lost to a timeout is not a finished pass. Returning here would
    // mark the job COMPLETED over a scene state that was never derived, which
    // is how 99 SCENE_STATE_TRACKING jobs came back clean over 12 losses
    // (bug 107). Throwing hands it to `markFailed`: backed-off retry, then
    // DEAD with the reason attached. The job writes nothing until it succeeds,
    // so the re-run starts from the same place this one did.
    throwIfLostToTimeout(result, 'scene-state-tracking');
    return;
  }

  // 10. Add timestamp metadata to the result
  const sceneState = {
    ...result.result,
    updatedAt: new Date().toISOString(),
    updatedAtMessageCount: chat.messageCount ?? 0,
  };

  // 10b. Reconcile the concise clothing summary against the equipped wardrobe.
  // The cheap LLM now OWNS a concise, salience-based clothing line (already
  // capped at ~200 chars in updateSceneState). We cache that line keyed by the
  // equipped-outfit hash: while a character's wardrobe is physically unchanged
  // we reuse the cached summary (the outfit only changes on an explicit
  // wardrobe edit), and only re-take the LLM's freshly summarized line when the
  // hash moves. Characters with no equipped wardrobe keep the narrative-driven
  // line every turn (no hash to cache against).
  const prevClothingByCharacterId = new Map<string, { clothing: string | null; clothingHash: string | null }>();
  const prevCharacters = (previousSceneState as { characters?: unknown } | null)?.characters;
  if (Array.isArray(prevCharacters)) {
    for (const pc of prevCharacters) {
      if (pc && typeof pc === 'object' && typeof (pc as { characterId?: unknown }).characterId === 'string') {
        const rec = pc as { characterId: string; clothing?: unknown; clothingHash?: unknown };
        prevClothingByCharacterId.set(rec.characterId, {
          clothing: typeof rec.clothing === 'string' ? rec.clothing : null,
          clothingHash: typeof rec.clothingHash === 'string' ? rec.clothingHash : null,
        });
      }
    }
  }

  const sceneCharacters = (sceneState as { characters?: unknown }).characters as
    | Array<{ characterId: string; clothing?: string | null; clothingHash?: string | null }>
    | undefined;
  if (sceneCharacters) {
    for (const sceneChar of sceneCharacters) {
      const slots = equippedSlotsByCharacterId.get(sceneChar.characterId) ?? null;
      if (hasEquippedItems(slots)) {
        const currentHash = hashEquippedSlots(slots);
        const prev = prevClothingByCharacterId.get(sceneChar.characterId);
        if (prev && prev.clothingHash === currentHash && prev.clothing) {
          // Wardrobe unchanged since the cached summary was derived — reuse it
          // verbatim so the line stays stable and we don't re-summarize.
          sceneChar.clothing = prev.clothing;
        }
        // else: keep the LLM's freshly summarized (and capped) clothing line.
        sceneChar.clothingHash = currentHash;
      } else {
        // No equipped wardrobe — clothing is narrative-driven; do not cache.
        sceneChar.clothingHash = null;
      }
    }
  }

  // 11. Create system event for token tracking
  if (result.usage) {
    await createSystemEvent(payload.chatId, {
      systemEventType: 'SCENE_STATE_TRACKING',
      description: `Scene state updated: ${(sceneState as any).location || 'unknown location'}`,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      provider: cheapLLMSelection.provider,
      modelName: cheapLLMSelection.modelName,
    });
  }

  // 12. Persist scene state to chat
  await repos.chats.update(payload.chatId, {
    sceneState: sceneState as Record<string, unknown>,
  });

  logger.info('[SceneStateTracking] Scene state updated', {
    jobId: job.id,
    chatId: payload.chatId,
    location: (sceneState as any).location,
    characterCount: (sceneState as any).characters?.length ?? 0,
    presentCharacterCount: presentCharacters.length,
    messageCount: chat.messageCount,
    isDangerousChat,
  });
}
