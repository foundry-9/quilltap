/**
 * Chats API v1 - Collection Endpoint
 *
 * GET /api/v1/chats - List all chats for current user
 * GET /api/v1/chats?action=has-dangerous - Check if any dangerous chats exist
 * POST /api/v1/chats - Create a new chat
 * POST /api/v1/chats?action=import - Import a SillyTavern chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { buildChatContext, type ChatContext } from '@/lib/chat/initialize';
import { resolveScenarioSelection } from '@/lib/chat/scenario-selection';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import { generateGreetingMessage } from '@/lib/chat/initial-greeting';
import { profileParams } from '@/lib/llm/cheap-llm';
import { resolveSamplingParams } from '@/lib/llm/sampling-params';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';
import { buildFirstMessageContext } from '@/lib/chat/first-message-context';
import { ensureFictionalBaseRealTime } from '@/lib/chat/timestamp-utils';
import { buildRecentConversationsBlock, calculateRecentConversationsLimit } from '@/lib/memory/memory-recap';
import { getModelContextLimit } from '@/lib/llm/model-context-data';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { z } from 'zod';
import type { ChatEvent, ChatParticipantBaseInput, TimestampConfig } from '@/lib/schemas/types';
import { TimestampConfigSchema } from '@/lib/schemas/types';
import { Cron } from 'croner';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  OutfitSelectionSchema,
  allEquippedItemIds,
  type OutfitSelection,
} from '@/lib/schemas/wardrobe.types';
import { buildOutfitSlotValues } from '@/lib/wardrobe/outfit-description';
import {
  applyOutfitSelections,
  buildCheapLLMConfig,
  type OutfitSelectionContext,
} from '@/lib/wardrobe/apply-outfit-selections';
import { sharedWardrobeTiersForCharacter } from '@/lib/wardrobe/shared-tiers';
import { createCreationProgressEmitter } from '@/lib/chat/creation-progress';
import { notFound, badRequest, serverError, successResponse, created } from '@/lib/api/responses';
import {
  enrichParticipantSummary,
  enrichChatsForList,
  filterChatsByExcludedTags,
  cleanEnrichedChats,
} from '@/lib/services/chat-enrichment.service';
import {
  importMultiCharacterChat,
  importLegacyChat,
  type MultiCharacterImportOptions,
  type LegacyImportOptions,
} from '@/lib/import/sillytavern-import-service';
import {
  postHostAddAnnouncement,
  postHostScenarioAnnouncement,
  postHostUserCharacterAnnouncement,
} from '@/lib/services/host-notifications/writer';
import { postOpeningOutfitWhisper } from '@/lib/services/aurora-notifications/writer';
import { triggerAvatarGenerationIfEnabled } from '@/lib/wardrobe/avatar-generation';
import {
  loadProsperoProjectContext,
  loadProsperoGeneralContext,
  postProsperoContextAnnouncement,
  postProsperoGroupContextWhisper,
} from '@/lib/services/prospero-notifications/writer';
import { compileAllIdentityStacks } from '@/lib/services/system-prompt-compiler/compiler';
import { applyChatContinuation } from '@/lib/chat/apply-chat-continuation';
import { startAutonomousRoomManually } from '@/lib/services/chat-message/autonomous-room.service';

type Repos = RepositoryContainer;
const CHAT_GET_ACTIONS = ['has-dangerous'] as const;
type ChatGetAction = typeof CHAT_GET_ACTIONS[number];
const CHAT_POST_ACTIONS = ['import'] as const;
type ChatPostAction = typeof CHAT_POST_ACTIONS[number];

// ============================================================================
// Schemas
// ============================================================================

// Participant schema for chat creation
const createParticipantSchema = z.object({
  type: z.literal('CHARACTER'),
  characterId: z.uuid(),
  connectionProfileId: z.uuid().optional(),
  imageProfileId: z.uuid().optional(), // Legacy: kept for backwards compatibility but ignored
  controlledBy: z.enum(['llm', 'user']).optional(),
  selectedSystemPromptId: z.uuid().optional(),
});

const createChatSchema = z.object({
  participants: z.array(createParticipantSchema).min(1, 'At least one participant is required'),
  title: z.string().optional(),
  scenario: z.string().optional(), // Free-text scenario notes; appended beneath any resolved preset body, or used as the whole scenario when no preset is chosen.
  scenarioId: z.string().uuid().optional(), // ID of a named scenario from the character's scenarios array
  /**
   * Relative path of a project scenario file (`Scenarios/<filename>.md`) inside the
   * project's official document store. Server resolves the body from frontmatter +
   * markdown and bakes it into `chat.scenarioText`. Lower precedence than `scenario`
   * and `scenarioId`. Requires `projectId` to also be set.
   */
  projectScenarioPath: z.string().max(500).optional(),
  /**
   * Relative path of a general scenario file (`Scenarios/<filename>.md`) inside the
   * instance-wide "Quilltap General" mount. Lower precedence than `projectScenarioPath`
   * — only consulted when no higher-precedence scenario field is set. Does NOT require
   * `projectId`: general scenarios apply to project-less chats too.
   */
  generalScenarioPath: z.string().max(500).optional(),
  /**
   * Relative path of a group scenario file (`Scenarios/<filename>.md`) inside a
   * group's official document store, paired with `groupScenarioGroupId` (which
   * group's store to resolve it from). Offered in the New Chat dialog whenever
   * ANY selected participant is a member of the group (the one sanctioned
   * exception to per-responding-character group isolation — a chat-creation menu,
   * not a per-turn access grant). Lower precedence than `projectScenarioPath`,
   * higher than `generalScenarioPath`.
   */
  groupScenarioPath: z.string().max(500).optional(),
  groupScenarioGroupId: z.uuid().optional(),
  timestampConfig: TimestampConfigSchema.optional(),
  projectId: z.uuid().optional(),
  imageProfileId: z.uuid().optional(), // Chat-level image profile (shared by all participants)
  /**
   * Roleplay template for the new chat, chosen in the New Chat dialog. When the
   * key is present it wins outright — including an explicit `null`, which means
   * "no template" — over the project default and the user's global default.
   * Omit the key entirely to fall back to that default chain.
   */
  roleplayTemplateId: z.uuid().nullable().optional(),
  outfitSelections: z.array(OutfitSelectionSchema).optional(), // Per-character outfit selections for chat start
  avatarGenerationEnabled: z.boolean().optional(), // Enable auto-generated character avatars on outfit changes
  /**
   * When set, the new chat is a "change of venue" continuation of an existing
   * chat: the source chat's most recent Librarian summary plus every later
   * message are replayed into the new chat (with participant IDs remapped),
   * turn state is replicated, and Host bubbles linking the two chats are
   * posted in both. The auto-generated first character message is skipped.
   * The source chat must belong to the same user.
   */
  continuationFromChatId: z.uuid().optional(),
  /**
   * Client-generated correlation id for the chat-creation status dialog ("The
   * Green Room"). When present, this handler publishes progress (setup
   * milestones and per-character LLM wardrobe choices) to the in-memory bus
   * keyed by this id; the dialog subscribes via
   * `GET /api/v1/chats/creation-progress?id=…`. Absent → no progress channel.
   */
  progressId: z.uuid().optional(),

  // 4.6 Private Character Rooms — autonomous-room creation fields.
  // All only consulted when chatType === 'autonomous'.
  chatType: z.enum(['salon', 'autonomous']).optional(),
  scheduleCron: z.string().max(120).optional(),
  scheduleFreshnessWindowMs: z.number().int().positive().optional(),
  budgetMaxTurns: z.number().int().positive().optional(),
  budgetMaxTokens: z.number().int().positive().optional(),
  budgetMaxWallClockMs: z.number().int().positive().optional(),
  budgetEstimatedSpendCapUSD: z.number().positive().optional(),
  runVisibility: z.enum(['owner_only', 'household', 'open']).optional(),
  runDestructiveToolsAllowed: z.boolean().optional(),
  /**
   * Per-run token-budget counting mode. true (default) = exclude prompt-cache
   * hits from the budget (count only the billable cache-miss + output tokens);
   * false = count every token, including cache reads.
   */
  budgetExcludeCacheHits: z.boolean().optional(),
});

// ============================================================================
// Result Types
// ============================================================================

type ParticipantBuildSuccess = {
  participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>;
  tags: string[];
  /** Character.talkativeness for non-user-controlled characters; undefined otherwise. */
  talkativeness?: number;
};
type ParticipantBuildError = { error: string };
type ParticipantBuildResult = ParticipantBuildSuccess | ParticipantBuildError;

type BuildParticipantsResult =
  | {
      participants: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>[];
      tags: Set<string>;
      firstCharacter: { characterId: string; userCharacterId?: string; selectedSystemPromptId?: string };
      firstImageProfileId: string | null;
    }
  | { error: string };

// ============================================================================
// Helper Functions
// ============================================================================

async function buildCharacterParticipant(
  data: z.infer<typeof createParticipantSchema>,
  displayOrder: number,
  userId: string,
  repos: Repos
): Promise<ParticipantBuildResult> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants' };
  }

  const character = await repos.characters.findById(data.characterId);
  if (!character) {
    return { error: 'Character not found' };
  }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm';
  const isUserControlled = controlledBy === 'user';

  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants' };
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId);
    if (!profile) {
      return { error: 'Connection profile not found' };
    }
  }

  if (data.imageProfileId) {
    const imgProfile = await repos.imageProfiles.findById(data.imageProfileId);
    if (!imgProfile) {
      return { error: 'Image profile not found' };
    }
  }

  return {
    participant: {
      type: 'CHARACTER',
      characterId: data.characterId,
      controlledBy,
      connectionProfileId: isUserControlled ? null : data.connectionProfileId || null,
      imageProfileId: data.imageProfileId || null,
      selectedSystemPromptId: data.selectedSystemPromptId || null,
      displayOrder,
      isActive: true,
    },
    tags: character.tags || [],
    talkativeness: isUserControlled ? undefined : (character.talkativeness ?? 0.5),
  };
}


async function buildAllParticipants(
  participantsData: z.infer<typeof createParticipantSchema>[],
  userId: string,
  repos: Repos
): Promise<BuildParticipantsResult> {
  const builtParticipants: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  const allTagIds = new Set<string>();
  const llmCandidates: Array<{ characterId: string; selectedSystemPromptId?: string; talkativeness: number }> = [];
  let firstUserCharacterId: string | null = null;
  let firstImageProfileId: string | null = null;

  for (let i = 0; i < participantsData.length; i++) {
    const participantData = participantsData[i];

    const result = await buildCharacterParticipant(participantData, i, userId, repos);
    if ('error' in result) {
      return result;
    }

    builtParticipants.push(result.participant);
    for (const tag of result.tags) {
      allTagIds.add(tag);
    }

    // Collect first imageProfileId from participants (legacy support)
    if (!firstImageProfileId && participantData.imageProfileId) {
      firstImageProfileId = participantData.imageProfileId;
    }

    const isUserControlled = result.participant.controlledBy === 'user';
    if (!isUserControlled && participantData.characterId) {
      llmCandidates.push({
        characterId: participantData.characterId,
        selectedSystemPromptId: participantData.selectedSystemPromptId || undefined,
        talkativeness: result.talkativeness ?? 0.5,
      });
    }

    if (isUserControlled && !firstUserCharacterId && participantData.characterId) {
      firstUserCharacterId = participantData.characterId;
    }
  }

  if (llmCandidates.length === 0) {
    return { error: 'At least one LLM-controlled CHARACTER participant is required' };
  }

  // Pick the opening character by weighted-random on talkativeness, matching the
  // algorithm used by selectNextSpeaker for subsequent turns. Without this the
  // first character in the list always delivered the greeting, which biased
  // multi-character chats toward whichever participant the UI happened to list
  // first.
  const chosen = pickWeightedByTalkativeness(llmCandidates);

  const firstLLMCharacter = {
    characterId: chosen.characterId,
    selectedSystemPromptId: chosen.selectedSystemPromptId,
    userCharacterId: firstUserCharacterId || undefined,
  };

  return { participants: builtParticipants, tags: allTagIds, firstCharacter: firstLLMCharacter, firstImageProfileId };
}

function pickWeightedByTalkativeness<T extends { talkativeness: number }>(candidates: T[]): T {
  let totalWeight = 0;
  for (const c of candidates) totalWeight += c.talkativeness;
  if (totalWeight <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  const r = Math.random() * totalWeight;
  let cumulative = 0;
  for (const c of candidates) {
    cumulative += c.talkativeness;
    if (r < cumulative) return c;
  }
  return candidates[candidates.length - 1];
}

/**
 * Write the SYSTEM prompt message at the head of a freshly-created chat.
 * Split out from `createInitialMessages` so the continuation flow can
 * interleave the carryover backfill between this and the scenario-and-staff
 * phase.
 */
async function writeSystemPromptMessage(
  chatId: string,
  context: ChatContext,
  repos: Repos,
): Promise<void> {
  const systemMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'SYSTEM',
    content: context.systemPrompt,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  await repos.chats.addMessage(chatId, systemMessage);
}

interface ScenarioAndStaffOptions {
  /**
   * Skip the auto-generated first character message. Set true on the
   * continuation flow — a chat that's "picking up where the last one left
   * off" should not open with a fresh "Hello, ${userName}!" greeting.
   */
  skipFirstMessage?: boolean;
}

async function createInitialMessagesScenarioAndStaff(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos,
  projectId?: string | null,
  scenarioText?: string | null,
  options: ScenarioAndStaffOptions = {},
): Promise<void> {
  // Phase E: emit Prospero project-and-general-context whisper at chat-start.
  // When a project is attached, the project's description / instructions /
  // linked document stores ride along with the always-on Quilltap General
  // shelf reminder in a single Prospero message; without a project, only the
  // general shelf is named. Replaces the per-turn `## Project Context` block
  // previously injected via the system prompt. The cadence-based
  // re-injection (every N messages) is handled by the orchestrator.
  try {
    const projectContext = projectId ? await loadProsperoProjectContext(projectId) : null;
    const generalContext = await loadProsperoGeneralContext();
    if (projectContext || generalContext) {
      await postProsperoContextAnnouncement({
        chatId,
        project: projectContext,
        general: generalContext,
      });
    }
  } catch (error) {
    logger.warn('[Chats v1] Failed to post chat-start Prospero context whisper', {
      chatId,
      projectId,
      error: getErrorMessage(error, 'Unknown error'),
    });
  }

  // Seed each character in the room with a targeted Prospero whisper naming the
  // document stores they can reach by group membership plus their own vault.
  // Unlike the public project/general announcement above, these are gated by
  // membership / are personal, so they are whispered per character (and post
  // nothing for characters with no group stores and no vault). Reload the chat
  // to get persisted participant ids. Fails soft — chat creation must not break.
  try {
    const seededChat = await repos.chats.findById(chatId);
    for (const participant of seededChat?.participants ?? []) {
      if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
      if (participant.status === 'removed') continue;
      await postProsperoGroupContextWhisper({
        chatId,
        targetParticipantId: participant.id,
        characterId: participant.characterId,
      });
    }
  } catch (error) {
    logger.warn('[Chats v1] Failed to post chat-start Prospero group-context whispers', {
      chatId,
      error: getErrorMessage(error, 'Unknown error'),
    });
  }

  // Phase C: emit Host whispers establishing the opening state — scenario,
  // user-character intro, and (in multi-character chats) a welcome for each
  // LLM-controlled character so the others learn about them. These replace
  // the corresponding sections that previously lived in the per-turn system
  // prompt.
  if (scenarioText && scenarioText.trim().length > 0) {
    await postHostScenarioAnnouncement({ chatId, scenarioText });
  }

  const hasUserParticipant = participants.some(
    (p) => p.type === 'CHARACTER' && p.controlledBy === 'user',
  );
  if (context.userCharacter && hasUserParticipant) {
    await postHostUserCharacterAnnouncement({
      chatId,
      userCharacterName: context.userCharacter.name,
      userCharacterDescription: context.userCharacter.description ?? null,
    });
  }

  const llmCharacterParticipants = participants.filter(
    (p) => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.characterId,
  );
  if (llmCharacterParticipants.length > 1) {
    for (const participant of llmCharacterParticipants) {
      const character = await repos.characters.findById(participant.characterId as string);
      if (character) {
        await postHostAddAnnouncement({
          chatId,
          character,
          participantId: participant.id,
          initialStatus: participant.status,
        });
      }
    }
  }

  // Aurora establishes how every character in the chat is dressed at the opening
  // of the chat — including the user-controlled character — and, when avatar
  // generation is enabled for the chat, kicks off avatar (re)generation for each
  // of them. Outfit selection has already been applied for every character by
  // handleCreate before this runs, so equippedOutfit is populated.
  const allCharacterParticipants = participants.filter(
    (p) => p.type === 'CHARACTER' && p.characterId,
  );
  // Project tier for tri-tier wardrobe resolution — shared with every
  // participant's equipped-item lookup below.
  const equippedProjectMountPointIds = await resolveProjectMountPointIds(projectId);
  for (const participant of allCharacterParticipants) {
    try {
      const characterId = participant.characterId as string;
      const character = await repos.characters.findById(characterId);
      if (!character) continue;

      const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
      if (!equippedSlots) continue;

      const equippedItemIds = allEquippedItemIds(equippedSlots)
        .filter((id) => typeof id === 'string' && id.length > 0);
      const equippedItemsData = equippedItemIds.length > 0
        ? await repos.wardrobe.findByIdsForCharacter(
            characterId,
            equippedItemIds,
            await sharedWardrobeTiersForCharacter(characterId, equippedProjectMountPointIds),
          )
        : [];
      const equippedItemsMap = new Map(equippedItemsData.map((item) => [item.id, item]));

      const titlesFor = (slot: keyof typeof equippedSlots): string[] => {
        const ids = equippedSlots[slot];
        if (!ids || ids.length === 0) return [];
        const titles: string[] = [];
        for (const id of ids) {
          const title = equippedItemsMap.get(id)?.title;
          if (title) titles.push(title);
        }
        return titles;
      };

      const outfit = buildOutfitSlotValues((slot) => titlesFor(slot));

      await postOpeningOutfitWhisper({
        chatId,
        characterName: character.name,
        outfit,
      });

      await triggerAvatarGenerationIfEnabled(repos, {
        userId,
        chatId,
        characterId,
        callerContext: '[Chats v1] chat-open',
      });
    } catch (error) {
      logger.warn('[Chats v1] Failed to post opening outfit whisper', {
        chatId,
        characterId: participant.characterId,
        error: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  if (options.skipFirstMessage) {
    return;
  }

  let firstMessageContent = (context.firstMessage || '').trim();
  // Reasoning is only ever captured for a *generated* greeting — a scripted
  // one never touched a model. DISPLAY ONLY, like every other stored turn.
  let firstMessageReasoning = '';

  if (!firstMessageContent) {
    const generated = await autoGenerateFirstMessage(chatId, context, participants, userId, repos, projectId);
    firstMessageContent = generated.content;
    firstMessageReasoning = generated.reasoningContent;
  }

  if (!firstMessageContent) {
    const userName = context.userCharacter?.name;
    firstMessageContent = userName
      ? `Hello, ${userName}! I'm ${context.character.name}. What's on your mind today?`
      : `Hello there! I'm ${context.character.name}. It's great to meet you. What's on your mind today?`;
  }

  const firstCharacterParticipant =
    participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === context.character.id && p.controlledBy !== 'user'
    ) || participants.find((p) => p.type === 'CHARACTER' && p.controlledBy !== 'user');

  const firstMessage: ChatEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: firstMessageContent,
    reasoningContent: firstMessageReasoning || null,
    participantId: firstCharacterParticipant?.id || undefined,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  await repos.chats.addMessage(chatId, firstMessage);
}

/**
 * Backwards-compatible wrapper for the legacy non-continuation call site.
 * Writes the system prompt and then runs the scenario-and-staff phase.
 */
async function createInitialMessages(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos,
  projectId?: string | null,
  scenarioText?: string | null,
): Promise<void> {
  await writeSystemPromptMessage(chatId, context, repos);
  await createInitialMessagesScenarioAndStaff(
    chatId,
    context,
    participants,
    userId,
    repos,
    projectId,
    scenarioText,
  );
}

/**
 * A generated opening greeting. `reasoningContent` is the thinking a
 * reasoning model produced while composing it — DISPLAY ONLY, persisted onto
 * the greeting message so the Salon renders its thinking fold like any other
 * turn. Empty for the give-up paths and for models that produced none.
 */
type GeneratedGreeting = { content: string; reasoningContent: string };

const NO_GREETING: GeneratedGreeting = { content: '', reasoningContent: '' };

async function autoGenerateFirstMessage(
  chatId: string,
  context: ChatContext,
  participants: ChatParticipantBaseInput[],
  userId: string,
  repos: Repos,
  projectId?: string | null
): Promise<GeneratedGreeting> {
  const participant = participants
    .filter((p) => p.type === 'CHARACTER' && p.characterId === context.character.id)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0] ||
    participants.filter((p) => p.type === 'CHARACTER').sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0];

  if (!participant?.connectionProfileId) {
    return NO_GREETING;
  }

  const connectionProfile = await repos.connections.findById(participant.connectionProfileId);
  if (!connectionProfile) {
    return NO_GREETING;
  }

  let apiKey = '';
  if (connectionProfile.apiKeyId) {
    const storedKey = await repos.connections.findApiKeyById(connectionProfile.apiKeyId);
    if (!storedKey) {
      logger.warn('[Chats v1] Connection profile is missing its API key', { context: 'autoGenerateFirstMessage' });
      return NO_GREETING;
    }

    apiKey = storedKey.key_value;
  }

  const rawParameters = connectionProfile.parameters as Record<string, unknown> | undefined;
  const parameters = rawParameters ?? {};

  let participantMemories: { aboutCharacterName: string; summary: string }[] = [];
  let projectContext: { name: string; description?: string | null; instructions?: string | null } | null = null;

  try {
    const firstMessageContext = await buildFirstMessageContext(context.character.id, participants, {
      userId,
      projectId,
    });

    participantMemories = firstMessageContext.participantMemories.map((m) => ({
      aboutCharacterName: m.aboutCharacterName,
      summary: m.summary,
    }));
    projectContext = firstMessageContext.projectContext;
  } catch (error) {
    logger.error('[Chats v1] Failed to build first message context', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Compute the Recent Conversations block once and reuse across retry attempts.
  // The new chat has no contextSummary yet, so excluding it is defensive only.
  let recentConversationsBlock = '';
  try {
    const maxContext =
      connectionProfile.maxContext ??
      getModelContextLimit(connectionProfile.provider, connectionProfile.modelName);
    const limit = calculateRecentConversationsLimit(maxContext);
    recentConversationsBlock = await buildRecentConversationsBlock(
      context.character.id,
      chatId,
      limit
    );
  } catch (error) {
    logger.warn('[Chats v1] Failed to build recent-conversations block for greeting', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const loggingFields = {
    userId,
    chatId,
    characterId: context.character.id,
  };

  const sampling = resolveSamplingParams(parameters);

  const baseParams = {
    systemPrompt: context.systemPrompt,
    characterName: context.character.name,
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    baseUrl: connectionProfile.baseUrl,
    apiKey,
    ...sampling,
    // Forward the character's profile parameters so per-model settings like
    // DeepSeek thinking mode take effect on the greeting too.
    profileParameters: profileParams(connectionProfile),
  };

  // Track whether any attempt hit a content filter so we can try the Concierge fallback
  let contentFilterHit = false;

  // Attempt 1: Full context (memories + project)
  try {
    const result = await generateGreetingMessage({
      ...baseParams,
      ...loggingFields,
      participantMemories: participantMemories.length > 0 ? participantMemories : undefined,
      projectContext,
      recentConversationsBlock: recentConversationsBlock || undefined,
    });

    if (result.content) {
      return { content: result.content, reasoningContent: result.reasoningContent };
    }
    if (result.contentFilterDetected) {
      contentFilterHit = true;
    }
  } catch (error) {
    logger.warn('[Chats v1] Greeting generation attempt failed', {
      characterId: context.character.id,
      attempt: 'full context',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Attempt 2: Strip memories (they may be triggering content filter)
  if (participantMemories.length > 0) {
    try {
      logger.info('[Chats v1] Retrying greeting generation without memories', {
        characterId: context.character.id,
        originalMemoryCount: participantMemories.length,
      });

      const result = await generateGreetingMessage({
        ...baseParams,
        ...loggingFields,
        projectContext,
        recentConversationsBlock: recentConversationsBlock || undefined,
      });

      if (result.content) {
        logger.info('[Chats v1] Greeting generation succeeded on retry without memories', {
          characterId: context.character.id,
        });
        return { content: result.content, reasoningContent: result.reasoningContent };
      }
      if (result.contentFilterDetected) {
        contentFilterHit = true;
      }
    } catch (error) {
      logger.warn('[Chats v1] Greeting generation attempt failed', {
        characterId: context.character.id,
        attempt: 'without memories',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Attempt 3: If content filter was detected, try the Concierge uncensored provider
  if (contentFilterHit) {
    try {
      const chatSettings = await repos.chatSettings.findByUserId(userId);
      const resolved = resolveDangerousContentSettings(chatSettings);

      if (resolved.settings.mode === 'AUTO_ROUTE') {
        const routeResult = await resolveProviderForDangerousContent(
          connectionProfile,
          apiKey,
          resolved.settings,
          userId
        );

        if (routeResult.rerouted) {
          logger.info('[Chats v1] Content filter detected on greeting — falling back to Concierge uncensored provider', {
            characterId: context.character.id,
            uncensoredProfile: routeResult.connectionProfile.name,
            uncensoredProvider: routeResult.connectionProfile.provider,
            uncensoredModel: routeResult.connectionProfile.modelName,
          });

          const uncensoredParams = routeResult.connectionProfile.parameters as Record<string, unknown> | undefined;
          // Each knob falls back to the character's own profile independently,
          // so an uncensored profile that only sets a temperature still borrows
          // the original's Max Tokens and Top P.
          const uncensoredSampling = resolveSamplingParams(uncensoredParams ?? {});

          const result = await generateGreetingMessage({
            ...loggingFields,
            systemPrompt: context.systemPrompt,
            characterName: context.character.name,
            provider: routeResult.connectionProfile.provider,
            modelName: routeResult.connectionProfile.modelName,
            baseUrl: routeResult.connectionProfile.baseUrl,
            apiKey: routeResult.apiKey,
            temperature: uncensoredSampling.temperature ?? sampling.temperature,
            maxTokens: uncensoredSampling.maxTokens ?? sampling.maxTokens,
            topP: uncensoredSampling.topP ?? sampling.topP,
            participantMemories: participantMemories.length > 0 ? participantMemories : undefined,
            projectContext,
            recentConversationsBlock: recentConversationsBlock || undefined,
          });

          if (result.content) {
            logger.info('[Chats v1] Greeting generation succeeded via Concierge uncensored provider', {
              characterId: context.character.id,
              provider: routeResult.connectionProfile.provider,
              model: routeResult.connectionProfile.modelName,
            });
            return { content: result.content, reasoningContent: result.reasoningContent };
          }
        }
      }
    } catch (error) {
      logger.warn('[Chats v1] Concierge fallback for greeting generation failed', {
        characterId: context.character.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Attempt 4: Final plain retry with delay for transient failures
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await generateGreetingMessage({ ...baseParams, ...loggingFields });

    if (result.content) {
      logger.info('[Chats v1] Greeting generation succeeded on final retry', {
        characterId: context.character.id,
      });
      return { content: result.content, reasoningContent: result.reasoningContent };
    }
  } catch (error) {
    logger.warn('[Chats v1] Final greeting generation retry failed', {
      characterId: context.character.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.warn('[Chats v1] All greeting generation attempts exhausted, falling back to static greeting', {
    characterId: context.character.id,
    contentFilterHit,
  });
  return NO_GREETING;
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List chats
 */
async function handleList(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const { searchParams } = req.nextUrl;
    const excludeTagIdsParam = searchParams.get('excludeTagIds');
    const limitParam = searchParams.get('limit');
    const includeAutonomous = searchParams.get('includeAutonomous') === 'true';
    const excludeTagIds = excludeTagIdsParam ? excludeTagIdsParam.split(',').filter(Boolean) : [];
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const allChatMetadata = await repos.chats.findByUserId(user.id);
    // Default Salon listing: salon chats only (no help, no autonomous unless asked).
    // Autonomous rooms with per-room runVisibility = 'household' | 'open' are
    // visible regardless of the includeAutonomous flag (per-room override
    // wins over the user-level visibility default).
    const chatMetadata = allChatMetadata.filter((c: any) => {
      if (!c.chatType || c.chatType === 'salon') return true;
      if (c.chatType === 'autonomous') {
        if (includeAutonomous) return true;
        if (c.runVisibility === 'household' || c.runVisibility === 'open') return true;
        return false;
      }
      return false;
    });
    const enrichedChats = await enrichChatsForList(chatMetadata, repos);
    let filteredChats = filterChatsByExcludedTags(enrichedChats, excludeTagIds);

    if (limit && limit > 0) {
      filteredChats = filteredChats.slice(0, limit);
    }

    const result = cleanEnrichedChats(filteredChats);

    return successResponse({ chats: result });
  } catch (error) {
    logger.error('[Chats v1] Error listing chats', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chats');
  }
}

/**
 * Does the user have anything for "Dangerous Chats" to hide?
 *
 * The toggle hides whatever takes the uncensored route — Flagged (the
 * Concierge's verdict) and Uncensored (the operator's) — so the affordance
 * appears on exactly that set, not on every chat carrying a preserved label.
 */
async function handleHasDangerous(context: RequestContext) {
  const { user, repos } = context;

  try {
    const allChats = await repos.chats.findByUserId(user.id);
    const hasDangerous = allChats.some((c) => shouldUseUncensoredRoute(c));
    return successResponse({ hasDangerous });
  } catch (error) {
    logger.error('[Chats v1] Error checking dangerous chats', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to check dangerous chats');
  }
}

/**
 * Create chat
 */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json();
  const validatedData = createChatSchema.parse(body);
  const isAutonomous = validatedData.chatType === 'autonomous';

  // Status dialog ("The Green Room"): narrate the slow, blocking creation work
  // to the client over a side-channel keyed by the client-supplied progressId.
  // Inert when no progressId was sent.
  const progress = createCreationProgressEmitter(validatedData.progressId);
  progress.status('Assembling the cast…');

  // Permission-check the continuation source up front, before doing any
  // create work. The user-scoped repos.chats.findById returns null for chats
  // that don't belong to the current user, which is exactly the rejection
  // we want.
  if (validatedData.continuationFromChatId) {
    const sourceChat = await repos.chats.findById(validatedData.continuationFromChatId);
    if (!sourceChat) {
      logger.warn('[Chats v1] continuationFromChatId references a chat not owned by current user', {
        userId: user.id,
        continuationFromChatId: validatedData.continuationFromChatId,
      });
      return notFound('Source chat');
    }
  }

  // Autonomous-room preconditions (validated before participant-build to fail fast).
  let autonomousNextRunAt: string | null = null;
  if (isAutonomous) {
    const userParticipants = validatedData.participants.filter((p) => p.controlledBy === 'user');
    if (userParticipants.length > 0) {
      return badRequest('Autonomous rooms cannot include user-controlled participants');
    }
    const llmCharacterParticipants = validatedData.participants.filter(
      (p) => p.type === 'CHARACTER' && (!p.controlledBy || p.controlledBy === 'llm'),
    );
    if (llmCharacterParticipants.length < 2) {
      return badRequest('Autonomous rooms require at least two LLM-controlled characters');
    }
    if (validatedData.scheduleCron) {
      const expr = validatedData.scheduleCron.trim();
      if (expr.length === 0) {
        // Treat all-whitespace as "no schedule" (manual-only).
      } else {
        try {
          const job = new Cron(expr);
          const next = job.nextRun(new Date());
          autonomousNextRunAt = next ? next.toISOString() : null;
        } catch (error) {
          logger.warn('[Chats v1] Invalid cron expression on autonomous-room create', {
            userId: user.id,
            scheduleCron: expr,
            error: error instanceof Error ? error.message : String(error),
          });
          return badRequest(`Invalid cron expression: ${expr}`);
        }
      }
    }
  }

  const buildResult = await buildAllParticipants(validatedData.participants, user.id, repos);
  if ('error' in buildResult) {
    return badRequest(buildResult.error);
  }

  // Fetch the primary character for defaults resolution
  const primaryCharacter = await repos.characters.findById(buildResult.firstCharacter.characterId);

  // Resolve the chosen preset scenario body (if any) and layer the free-text
  // notes beneath it. The precedence chain lives in `resolveScenarioSelection`
  // so the in-chat scenario picker resolves a selection exactly the way the New
  // Chat dialog does.
  const resolvedScenario = await resolveScenarioSelection(
    {
      scenario: validatedData.scenario,
      scenarioId: validatedData.scenarioId,
      projectScenarioPath: validatedData.projectScenarioPath,
      groupScenarioPath: validatedData.groupScenarioPath,
      groupScenarioGroupId: validatedData.groupScenarioGroupId,
      generalScenarioPath: validatedData.generalScenarioPath,
    },
    {
      repos,
      projectId: validatedData.projectId,
      character: primaryCharacter,
      logTag: '[Chats v1]',
    },
  );
  const chatContext = await buildChatContext(
    buildResult.firstCharacter.characterId,
    buildResult.firstCharacter.userCharacterId,
    resolvedScenario,
    buildResult.firstCharacter.selectedSystemPromptId
  );

  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const now = new Date().toISOString();
  const participantsWithTimestamps: ChatParticipantBaseInput[] = buildResult.participants.map((p) => ({
    ...p,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));

  // Default tool settings and avatar generation from project (if creating chat within a project)
  let projectToolDefaults = {
    disabledTools: [] as string[],
    disabledToolGroups: [] as string[],
  };
  let projectAvatarGenerationDefault: boolean | null = null;
  let projectDefaultImageProfileId: string | null = null;
  let projectDefaultRoleplayTemplateId: string | null = null;

  if (validatedData.projectId) {
    const project = await repos.projects.findById(validatedData.projectId);
    if (!project) {
      return notFound('Project');
    }

    // Extract default tool settings from project
    projectToolDefaults = {
      disabledTools: project.defaultDisabledTools || [],
      disabledToolGroups: project.defaultDisabledToolGroups || [],
    };
    projectAvatarGenerationDefault = project.defaultAvatarGenerationEnabled ?? null;
    projectDefaultImageProfileId = project.defaultImageProfileId ?? null;
    projectDefaultRoleplayTemplateId = project.defaultRoleplayTemplateId ?? null;

    if (!project.allowAnyCharacter) {
      const characterIds = participantsWithTimestamps
        .filter((p) => p.type === 'CHARACTER' && p.characterId)
        .map((p) => p.characterId as string);

      const newCharacterIds = characterIds.filter((id) => !project.characterRoster.includes(id));
      if (newCharacterIds.length > 0) {
        await repos.projects.update(validatedData.projectId, {
          characterRoster: [...project.characterRoster, ...newCharacterIds],
        });
      }
    }
  }

  // Resolve timestamp config with fallback chain: request > character default > global default.
  // Anchor a fictional clock to now as it lands on the chat — this is the moment the config stops
  // being a default and starts being a running clock, and without the anchor it never advances.
  const resolvedTimestampConfig = ensureFictionalBaseRealTime(
    validatedData.timestampConfig || primaryCharacter?.defaultTimestampConfig || chatSettings?.defaultTimestampConfig || null
  );

  // Resolve image profile: request > project default > character default > null
  const chatImageProfileId = validatedData.imageProfileId || projectDefaultImageProfileId || buildResult.firstImageProfileId || null;

  // Resolve roleplay template: explicit request (including a deliberate null)
  // > project default > user/global default > null. Baked onto the chat at
  // creation so the choice — or the project's preference — sticks.
  if (validatedData.roleplayTemplateId) {
    const template = await repos.roleplayTemplates.findById(validatedData.roleplayTemplateId);
    if (!template) {
      return badRequest('Roleplay template not found');
    }
  }
  const defaultRoleplayTemplateId =
    typeof validatedData.roleplayTemplateId !== 'undefined'
      ? validatedData.roleplayTemplateId
      : projectDefaultRoleplayTemplateId || chatSettings?.defaultRoleplayTemplateId || null;
  logger.debug('[Chats v1] Resolved roleplay template for new chat', {
    requested: validatedData.roleplayTemplateId ?? null,
    requestedExplicitly: typeof validatedData.roleplayTemplateId !== 'undefined',
    projectDefault: projectDefaultRoleplayTemplateId,
    userDefault: chatSettings?.defaultRoleplayTemplateId ?? null,
    resolved: defaultRoleplayTemplateId,
  });

  const chat = await repos.chats.create({
    userId: user.id,
    participants: participantsWithTimestamps,
    title: validatedData.title || `Chat with ${chatContext.character.name}`,
    contextSummary: resolvedScenario || null,
    tags: Array.from(buildResult.tags),
    roleplayTemplateId: defaultRoleplayTemplateId,
    timestampConfig: resolvedTimestampConfig,
    messageCount: 0,
    lastMessageAt: null,
    lastRenameCheckInterchange: 0,
    projectId: validatedData.projectId || null,
    scenarioText: resolvedScenario || null,
    disabledTools: projectToolDefaults.disabledTools,
    disabledToolGroups: projectToolDefaults.disabledToolGroups,
    imageProfileId: chatImageProfileId,
    avatarGenerationEnabled: isAutonomous
      ? false
      : validatedData.avatarGenerationEnabled ?? projectAvatarGenerationDefault ?? null,
    documentEditingMode: chatSettings?.compositionModeDefault ?? false,
    ...(isAutonomous ? {
      chatType: 'autonomous' as const,
      scheduleCron: validatedData.scheduleCron?.trim() ? validatedData.scheduleCron.trim() : null,
      scheduleFreshnessWindowMs: validatedData.scheduleFreshnessWindowMs ?? null,
      scheduleNextRunAt: autonomousNextRunAt,
      budgetMaxTurns: validatedData.budgetMaxTurns ?? null,
      budgetMaxTokens: validatedData.budgetMaxTokens ?? null,
      budgetMaxWallClockMs: validatedData.budgetMaxWallClockMs ?? null,
      budgetEstimatedSpendCapUSD: validatedData.budgetEstimatedSpendCapUSD ?? null,
      runVisibility: validatedData.runVisibility ?? null,
      runDestructiveToolsAllowed: validatedData.runDestructiveToolsAllowed ? 1 : 0,
      // Default to excluding cache hits (1); only an explicit `false` opts into
      // counting every token (0).
      budgetExcludeCacheHits: validatedData.budgetExcludeCacheHits === false ? 0 : 1,
      runState: 'idle' as const,
      currentRunId: null,
      runTurnsConsumed: 0,
      runTokensConsumed: 0,
    } : {}),
  });

  // Apply outfit selections to the newly created chat
  // If no selections provided, apply 'default' mode for all LLM-controlled participants
  const outfitContext: OutfitSelectionContext = {
    userId: user.id,
    // Shared wardrobe tiers in scope for this chat's project — General is
    // always folded in by the repository; these add the project stores.
    projectMountPointIds: await resolveProjectMountPointIds(validatedData.projectId || null),
    scenarioText: resolvedScenario,
    cheapLLMConfig: buildCheapLLMConfig(chatSettings),
    sourceChatId: validatedData.continuationFromChatId ?? null,
    progress,
  };
  progress.status('Consulting the wardrobe…');
  try {
    if (validatedData.outfitSelections && validatedData.outfitSelections.length > 0) {
      // Apply explicit selections, then backfill defaults for any participants not covered
      const explicitCharacterIds = new Set(validatedData.outfitSelections.map((s) => s.characterId));
      const missingCharacterIds = participantsWithTimestamps
        .filter((p) => p.type === 'CHARACTER' && p.characterId && !explicitCharacterIds.has(p.characterId))
        .map((p) => p.characterId as string);

      const allSelections: OutfitSelection[] = [
        ...validatedData.outfitSelections,
        ...missingCharacterIds.map((characterId) => ({
          characterId,
          mode: 'default' as const,
        })),
      ];

      await applyOutfitSelections(chat.id, allSelections, repos, outfitContext);
    } else {
      // Default behavior: apply default outfits for all character participants (LLM and user-controlled)
      const allCharacterIds = participantsWithTimestamps
        .filter((p) => p.type === 'CHARACTER' && p.characterId)
        .map((p) => p.characterId as string);

      if (allCharacterIds.length > 0) {
        const defaultSelections: OutfitSelection[] = allCharacterIds.map((characterId) => ({
          characterId,
          mode: 'default' as const,
        }));
        await applyOutfitSelections(chat.id, defaultSelections, repos, outfitContext);
      }
    }
  } catch (error) {
    // Outfit selection failure should not prevent chat creation
    logger.error('[Chats v1] Failed to apply outfit selections', {
      chatId: chat.id,
      error: getErrorMessage(error, 'Unknown outfit selection error'),
    });
  }

  // Phase H: precompile the per-participant identity stack for the new chat
  // so the per-turn buildSystemPrompt can hit the cache from the very first
  // user message. Failure to compile is non-fatal — buildSystemPrompt's
  // read-through fallback rebuilds fresh on miss.
  progress.status('Committing everyone’s particulars to memory…');
  try {
    await compileAllIdentityStacks(chat);
  } catch (error) {
    logger.warn('[Chats v1] Failed to compile identity stacks at chat creation', {
      chatId: chat.id,
      error: getErrorMessage(error, 'Unknown error'),
    });
  }

  if (validatedData.continuationFromChatId) {
    // Continuation flow: prelude (system prompt) → backfill from source +
    // turn-state replication + cross-link bubbles → scenario/staff
    // (Prospero, Host scenario, Host adds, Aurora outfits, avatar gen),
    // skipping the auto first message.
    progress.status('Recalling the previous chapter…');
    await writeSystemPromptMessage(chat.id, chatContext, repos);
    try {
      await applyChatContinuation({
        newChatId: chat.id,
        sourceChatId: validatedData.continuationFromChatId,
        userId: user.id,
        repos,
      });
    } catch (error) {
      logger.error('[Chats v1] applyChatContinuation failed', {
        chatId: chat.id,
        sourceChatId: validatedData.continuationFromChatId,
        error: getErrorMessage(error),
      }, error instanceof Error ? error : undefined);
    }
    await createInitialMessagesScenarioAndStaff(
      chat.id,
      chatContext,
      participantsWithTimestamps,
      user.id,
      repos,
      validatedData.projectId || null,
      resolvedScenario || null,
      { skipFirstMessage: true },
    );
  } else if (isAutonomous) {
    // Autonomous rooms: seed system-prompt + scenario/Host whispers (so the
    // participating characters know the scene), but skip the auto first
    // "Hello!" message — there's no user to greet, and the first turn is
    // produced by the per-room procedure when the run starts.
    await writeSystemPromptMessage(chat.id, chatContext, repos);
    await createInitialMessagesScenarioAndStaff(
      chat.id,
      chatContext,
      participantsWithTimestamps,
      user.id,
      repos,
      validatedData.projectId || null,
      resolvedScenario || null,
      { skipFirstMessage: true },
    );
  } else {
    progress.status('Setting the opening scene…');
    await createInitialMessages(
      chat.id,
      chatContext,
      participantsWithTimestamps,
      user.id,
      repos,
      validatedData.projectId || null,
      resolvedScenario || null,
    );
  }

  const enrichedParticipants = await Promise.all(
    chat.participants.map((p) => enrichParticipantSummary(p, repos))
  );

  logger.info('[Chats v1] Chat created', {
    chatId: chat.id,
    continuationFromChatId: validatedData.continuationFromChatId ?? null,
  });

  // Ad-hoc autonomous rooms (no cron schedule) start immediately on create —
  // the user just configured the participants and budget; there's no separate
  // Start step. Cron-scheduled rooms wait for the scheduler instead.
  if (isAutonomous && !chat.scheduleCron) {
    progress.status('Ringing up the room to begin…');
    try {
      const result = await startAutonomousRoomManually(chat.id, user.id);
      if (!result.ok) {
        logger.warn('[Chats v1] Auto-start of ad-hoc autonomous room declined', {
          chatId: chat.id,
          reason: result.reason,
          message: result.message,
        });
      }
    } catch (error) {
      logger.error('[Chats v1] Auto-start of ad-hoc autonomous room threw', {
        chatId: chat.id,
        error: getErrorMessage(error, 'Unknown autonomous-start error'),
      }, error instanceof Error ? error : undefined);
    }
  }

  progress.status('The players are ready.');
  progress.finish();

  return created({ chat: { ...chat, participants: enrichedParticipants } });
}

/**
 * Import chat (SillyTavern format)
 */
async function handleImport(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  try {
    const body = await req.json();

    // Detect which mode we're in based on request body
    if (body.mappings) {
      // Multi-character mode
      if (!body.chatData || !body.mappings || body.mappings.length === 0) {
        return badRequest('Chat data and mappings are required');
      }

      const options: MultiCharacterImportOptions = {
        chatData: body.chatData,
        mappings: body.mappings,
        defaultConnectionProfileId: body.defaultConnectionProfileId,
        triggerTitleGeneration: body.triggerTitleGeneration,
        createMemories: body.createMemories,
        title: body.title,
      };

      try {
        const result = await importMultiCharacterChat(user.id, options, repos);

        return created({
          ...result.chat,
          createdEntities: result.createdEntities,
          triggerTitleGeneration: options.triggerTitleGeneration || false,
          memoryJobCount: result.memoryJobCount,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found') || errorMessage.includes('At least one character')) {
          return badRequest(errorMessage);
        }

        throw error;
      }
    } else {
      // Legacy single-character mode
      if (!body.chatData || !body.characterId || !body.connectionProfileId) {
        return badRequest('Chat data, character ID, and connection profile ID are required');
      }

      const options: LegacyImportOptions = {
        chatData: body.chatData,
        characterId: body.characterId,
        connectionProfileId: body.connectionProfileId,
        title: body.title,
      };

      try {
        const result = await importLegacyChat(user.id, options, repos);

        const character = result.chat.participants.find((p) => p.type === 'CHARACTER')?.character;

        return created({
          ...result.chat,
          character,
          connectionProfile: { id: body.connectionProfileId },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('not found')) {
          return notFound('Resource');
        }

        throw error;
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to import chat');
    logger.error('[Chats v1] Error importing chat', { errorMessage }, error instanceof Error ? error : undefined);
    return serverError(errorMessage);
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/chats - Action dispatch or list
 */
export const GET = createContextHandler(async (req, context) => {
  const action = getActionParam(req);

  if (!action) {
    return handleList(req, context);
  }

  if (!isValidAction(action, CHAT_GET_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHAT_GET_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<ChatGetAction, () => Promise<NextResponse>> = {
    'has-dangerous': () => handleHasDangerous(context),
  };

  return actionHandlers[action]();
});

/**
 * POST /api/v1/chats - Action dispatch or create
 */
export const POST = createContextHandler(async (req, context) => {
  const action = getActionParam(req);

  if (!action) {
    return handleCreate(req, context);
  }

  if (!isValidAction(action, CHAT_POST_ACTIONS)) {
    return badRequest(`Unknown action: ${action}. Available actions: ${CHAT_POST_ACTIONS.join(', ')}`);
  }

  const actionHandlers: Record<ChatPostAction, () => Promise<NextResponse>> = {
    import: () => handleImport(req, context),
  };

  return actionHandlers[action]();
});
