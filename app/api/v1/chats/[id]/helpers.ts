/**
 * Chats API v1 - Helper Functions
 *
 * Shared helper functions for chat route handlers
 */

import { z } from 'zod';
import { enrichWithDefaultImage, enrichWithApiKey } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import type { ChatMetadata, ChatParticipantBase, ParticipantStatus } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  updateParticipantSchema,
  addParticipantSchema,
  chatUpdateRequestSchema,
} from './schemas';
import {
  postHostAddAnnouncement,
  postHostStatusChangeAnnouncement,
  postHostRemoveAnnouncement,
  postHostSilentModeAnnouncement,
  postHostJoinScenarioAnnouncement,
} from '@/lib/services/host-notifications/writer';
import { postProsperoConnectionProfileChangeAnnouncement } from '@/lib/services/prospero-notifications/writer';
import { applyConciergeFlip } from '@/lib/services/dangerous-content/manual-flip';
import {
  compileAllIdentityStacks,
  compileIdentityStackForParticipant,
} from '@/lib/services/system-prompt-compiler/compiler';

type Repos = RepositoryContainer;

/**
 * Resolve a participant's character name for logging/announcements, falling
 * back to `'Unknown'` when the participant is user-controlled (no character) or
 * the character can't be loaded. Shared by every participant action handler.
 */
export async function resolveParticipantCharacterName(
  participant: { characterId?: string | null } | null | undefined,
  repos: Repos,
): Promise<string> {
  if (participant?.characterId) {
    const character = await repos.characters.findById(participant.characterId);
    if (character) return character.name;
  }
  return 'Unknown';
}

/**
 * Get enriched character data with default image
 */
export async function getEnrichedCharacter(characterId: string, repos: Repos) {
  const charData = await repos.characters.findById(characterId);
  if (!charData) return null;

  const defaultImage = await enrichWithDefaultImage(charData.defaultImageId, repos);

  return {
    id: charData.id,
    name: charData.name,
    title: charData.title,
    talkativeness: charData.talkativeness ?? 0.5,
    defaultImageId: charData.defaultImageId,
    defaultImage,
    defaultConnectionProfileId: charData.defaultConnectionProfileId,
  };
}

/**
 * Get enriched connection profile with API key info
 */
export async function getEnrichedConnectionProfile(profileId: string, repos: Repos) {
  const profile = await repos.connections.findById(profileId);
  if (!profile) return null;

  const apiKeyInfo = await enrichWithApiKey(profile.apiKeyId, repos);

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    allowToolUse: profile.allowToolUse ?? true,
    apiKey: apiKeyInfo,
  };
}

/**
 * Enrich a participant with character and connection profile details
 */
export async function enrichParticipant(participant: ChatParticipantBase, repos: Repos) {
  if (participant.type !== 'CHARACTER') {
    throw new Error('Only CHARACTER participants are supported');
  }

  const character = participant.characterId
    ? await getEnrichedCharacter(participant.characterId, repos)
    : null;

  const connectionProfile = participant.connectionProfileId
    ? await getEnrichedConnectionProfile(participant.connectionProfileId, repos)
    : null;

  return {
    id: participant.id,
    type: participant.type,
    controlledBy: participant.controlledBy || 'llm',
    characterId: participant.characterId,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    status: participant.status || 'active',
    removedAt: participant.removedAt ?? null,
    hasHistoryAccess: participant.hasHistoryAccess,
    joinScenario: participant.joinScenario,
    character,
    connectionProfile,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

/**
 * Handle participant update with impersonation sync
 */
export async function handleParticipantUpdate(
  chatId: string,
  data: z.infer<typeof updateParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  const { participantId, ...participantData } = data;

  if (participantData.connectionProfileId) {
    const profile = await repos.connections.findById(participantData.connectionProfileId);
    if (!profile) {
      return { error: 'Connection profile not found', status: 404 };
    }
  }

  if (participantData.imageProfileId) {
    const profile = await repos.imageProfiles.findById(participantData.imageProfileId);
    if (!profile) {
      return { error: 'Image profile not found', status: 404 };
    }
  }

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { error: 'Chat not found', status: 404 };
  }

  const oldParticipant = chat.participants.find((p) => p.id === participantId);
  const oldConnectionProfileId = oldParticipant?.connectionProfileId ?? null;

  const result = await repos.chats.updateParticipant(chatId, participantId, participantData);
  if (!result) {
    return { error: 'Participant not found', status: 404 };
  }

  if (
    participantData.connectionProfileId !== undefined &&
    participantData.connectionProfileId !== oldConnectionProfileId &&
    oldParticipant?.characterId
  ) {
    const character = await repos.characters.findById(oldParticipant.characterId);
    if (character) {
      const oldProfile = oldConnectionProfileId
        ? await repos.connections.findById(oldConnectionProfileId)
        : null;
      const newProfile = await repos.connections.findById(participantData.connectionProfileId);
      await postProsperoConnectionProfileChangeAnnouncement({
        chatId,
        characterName: character.name,
        oldProfileLabel: oldProfile?.name ?? null,
        newProfileLabel: newProfile?.name ?? null,
      });
    }
  }

  if (participantData.controlledBy !== undefined) {
    const currentImpersonating = chat.impersonatingParticipantIds || [];
    const isCurrentlyImpersonating = currentImpersonating.includes(participantId);

    if (participantData.controlledBy === 'user' && !isCurrentlyImpersonating) {
      const newImpersonating = [...currentImpersonating, participantId];
      await repos.chats.update(chatId, {
        impersonatingParticipantIds: newImpersonating,
        ...(result.activeTypingParticipantId ? {} : { activeTypingParticipantId: participantId }),
      });
    } else if (participantData.controlledBy === 'llm' && isCurrentlyImpersonating) {
      const newImpersonating = currentImpersonating.filter((id) => id !== participantId);
      const updateData: Partial<ChatMetadata> = { impersonatingParticipantIds: newImpersonating };

      if (result.activeTypingParticipantId === participantId) {
        updateData.activeTypingParticipantId = newImpersonating[0] || null;
      }

      await repos.chats.update(chatId, updateData);
    }
    // Fall through to the shared tail: the status/isActive back-compat sync and
    // the identity-stack recompile below must run for a controlledBy patch too.
    // The finalChat re-read (further down) picks up the impersonation update.
  }

  // If status was explicitly set, sync isActive and record the change event
  if (participantData.status) {
    const participant = chat.participants.find(p => p.id === participantId);
    const oldStatus = participant?.status || (participant?.isActive ? 'active' : (participant?.removedAt ? 'removed' : 'absent'));
    const newStatus = participantData.status;

    const isActive = newStatus === 'active' || newStatus === 'silent';
    await repos.chats.updateParticipant(chatId, participantId, {
      isActive,
      removedAt: newStatus === 'removed' ? new Date().toISOString() : null,
    });

    // Record status change event so other characters are notified
    if (oldStatus !== newStatus && participant?.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        await recordStatusChangeEvent(chatId, character.name, oldStatus, newStatus, repos);
        if (newStatus === 'removed') {
          await postHostRemoveAnnouncement({ chatId, characterName: character.name, participantId });
        } else if (
          (oldStatus === 'active' || oldStatus === 'silent' || oldStatus === 'absent') &&
          (newStatus === 'active' || newStatus === 'silent' || newStatus === 'absent')
        ) {
          await postHostStatusChangeAnnouncement({
            chatId,
            characterName: character.name,
            participantId,
            oldStatus: oldStatus as ParticipantStatus,
            newStatus,
          });

          // Silent-mode whispers carry the full silent-mode rule directly to
          // the affected character (private). Replaces the per-turn system
          // prompt block.
          if (newStatus === 'silent' && oldStatus !== 'silent') {
            await postHostSilentModeAnnouncement({
              chatId,
              characterName: character.name,
              targetParticipantId: participantId,
              transition: 'enter',
            });
          } else if (oldStatus === 'silent' && newStatus !== 'silent') {
            await postHostSilentModeAnnouncement({
              chatId,
              characterName: character.name,
              targetParticipantId: participantId,
              transition: 'exit',
            });
          }
        }
      }
    }
  }
  // Backward compat: if isActive was set without status, derive status
  if (participantData.isActive !== undefined && !participantData.status) {
    const participant = chat.participants.find(p => p.id === participantId);
    const oldIsActive = participant?.isActive;
    const newStatus = participantData.isActive ? 'active' : 'absent';
    await repos.chats.updateParticipant(chatId, participantId, { status: newStatus });

    // Record status change event
    if (oldIsActive !== participantData.isActive && participant?.characterId) {
      const oldStatus = oldIsActive ? 'active' : 'absent';
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        await recordStatusChangeEvent(chatId, character.name, oldStatus, newStatus, repos);
        await postHostStatusChangeAnnouncement({
          chatId,
          characterName: character.name,
          participantId,
          oldStatus: oldStatus as ParticipantStatus,
          newStatus: newStatus as ParticipantStatus,
        });
      }
    }
  }

  // Re-fetch to get the latest state after all updates
  const finalChat = await repos.chats.findById(chatId);

  // Phase H: invalidate the precompiled identity stack when the participant's
  // selected system prompt changes — that's a direct input to the stack
  // build. Other updates (impersonation, status, etc.) don't change the stack
  // for this participant, but a new user-controlled participant could affect
  // {{user}}/{{persona}} for everyone, so when controlledBy flips we
  // recompile all stacks. Failures are non-fatal (read-through fallback).
  if (finalChat) {
    try {
      if (
        participantData.selectedSystemPromptId !== undefined &&
        oldParticipant?.selectedSystemPromptId !== participantData.selectedSystemPromptId
      ) {
        await compileIdentityStackForParticipant(finalChat, participantId);
      }
      if (participantData.controlledBy !== undefined) {
        await compileAllIdentityStacks(finalChat);
      }
    } catch (error) {
      logger.warn('[Chats v1] Failed to recompile identity stacks after participant update', {
        chatId, participantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { chat: finalChat || result };
}

/**
 * Resolve a fallback connection profile when a character's chosen profile is
 * missing or stale. Prefers the user's marked default, then the first profile
 * the user has. Returns null if the user has no profiles at all.
 */
async function resolveFallbackConnectionProfile(userId: string, repos: Repos) {
  const userDefault = await repos.connections.findDefault(userId);
  if (userDefault) return userDefault;
  const all = await repos.connections.findByUserId(userId);
  return all[0] ?? null;
}

/**
 * Handle adding a new participant to a chat
 */
export async function handleAddParticipant(
  chatId: string,
  data: z.infer<typeof addParticipantSchema>,
  currentParticipantCount: number,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants', status: 400 };
  }

  const character = await repos.characters.findById(data.characterId);
  if (!character) {
    return { error: 'Character not found', status: 404 };
  }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm';
  const isUserControlled = controlledBy === 'user';

  let resolvedConnectionProfileId: string | null = data.connectionProfileId ?? null;

  if (!isUserControlled) {
    if (!resolvedConnectionProfileId) {
      const fallback = await resolveFallbackConnectionProfile(userId, repos);
      if (!fallback) {
        return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants', status: 400 };
      }
      resolvedConnectionProfileId = fallback.id;
      logger.info('[Chats v1] No connectionProfileId provided; using fallback', {
        characterId: data.characterId,
        fallbackProfileId: fallback.id,
        fallbackProfileName: fallback.name,
      });
    } else {
      const profile = await repos.connections.findById(resolvedConnectionProfileId);
      if (!profile) {
        const fallback = await resolveFallbackConnectionProfile(userId, repos);
        if (!fallback) {
          return { error: 'Connection profile not found and no fallback profile available', status: 404 };
        }
        logger.warn('[Chats v1] Stale connectionProfileId; using fallback', {
          requestedProfileId: resolvedConnectionProfileId,
          fallbackProfileId: fallback.id,
          fallbackProfileName: fallback.name,
          characterId: data.characterId,
        });
        resolvedConnectionProfileId = fallback.id;
      }
    }
  } else if (resolvedConnectionProfileId) {
    const profile = await repos.connections.findById(resolvedConnectionProfileId);
    if (!profile) {
      resolvedConnectionProfileId = null;
    }
  }

  let result = await repos.chats.addParticipant(chatId, {
    type: 'CHARACTER',
    characterId: data.characterId,
    controlledBy: controlledBy,
    connectionProfileId: resolvedConnectionProfileId,
    imageProfileId: data.imageProfileId || null,
    displayOrder: data.displayOrder ?? currentParticipantCount,
    isActive: true,
    status: 'active',
    hasHistoryAccess: data.hasHistoryAccess ?? false,
    joinScenario: data.joinScenario || null,
  });

  if (!result) {
    return { error: 'Failed to add participant', status: 500 };
  }

  if (character.tags && character.tags.length > 0) {
    const existingTagIds = new Set(result.tags || []);
    const newTags = character.tags.filter((tagId: string) => !existingTagIds.has(tagId));

    if (newTags.length > 0) {const mergedTags = [...(result.tags || []), ...newTags];
      const updatedChat = await repos.chats.update(chatId, { tags: mergedTags });
      if (updatedChat) {
        return { chat: updatedChat };
      }
    }
  }

  return { chat: result };
}

/**
 * Handle removing a participant from a chat
 */
export async function handleRemoveParticipant(
  chatId: string,
  participantId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  try {
    const result = await repos.chats.removeParticipant(chatId, participantId);
    if (!result) {
      return { error: 'Participant not found', status: 404 };
    }
    return { chat: result };
  } catch (error) {
    if (error instanceof Error && error.message.includes('last participant')) {
      return { error: 'Cannot remove the last participant from a chat', status: 400 };
    }
    throw error;
  }
}

/**
 * Process all chat updates from a request
 */
export async function processChatUpdates(
  chatId: string,
  existingChat: ChatMetadata,
  validatedData: z.infer<typeof chatUpdateRequestSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  let updatedChat = existingChat;

  if (typeof validatedData.roleplayTemplateId !== 'undefined') {
    if (validatedData.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.roleplayTemplateId);
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 };
      }
    }

    const result = await repos.chats.update(chatId, {
      roleplayTemplateId: validatedData.roleplayTemplateId,
    });
    if (result) updatedChat = result;
  }

  // Handle imageProfileId shortcut (same as chat.imageProfileId)
  if (typeof validatedData.imageProfileId !== 'undefined') {
    if (validatedData.imageProfileId !== null) {
      const profile = await repos.imageProfiles.findById(validatedData.imageProfileId);
      if (!profile) {
        return { error: 'Image profile not found', status: 404 };
      }
    }

    const result = await repos.chats.update(chatId, {
      imageProfileId: validatedData.imageProfileId,
    });
    if (result) updatedChat = result;
  }

  if (validatedData.chat) {
    if (validatedData.chat.roleplayTemplateId !== undefined && validatedData.chat.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.chat.roleplayTemplateId);
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 };
      }
    }

    if (validatedData.chat.projectId !== undefined) {
      if (validatedData.chat.projectId !== null) {
        const project = await repos.projects.findById(validatedData.chat.projectId);
        if (!project) {
          return { error: 'Project not found', status: 404 };
        }

        if (!project.allowAnyCharacter) {
          const characterIds = updatedChat.participants
            .filter((p) => p.type === 'CHARACTER' && p.characterId)
            .map((p) => p.characterId as string);

          const newCharacterIds = characterIds.filter((id) => !project.characterRoster.includes(id));
          if (newCharacterIds.length > 0) {
            await repos.projects.update(validatedData.chat.projectId, {
              characterRoster: [...project.characterRoster, ...newCharacterIds],
            });
          }
        }
      }
    }

    const result = await repos.chats.update(chatId, validatedData.chat);
    if (result) updatedChat = result;

    // Phase H note: `chat.scenarioText` feeds the {{scenario}} template
    // variable in the identity stack, so a change to it would normally
    // require recompiling all stacks. The current updateChatSchema does not
    // expose `scenarioText`, so there is no path to mutate it after
    // creation; if one is added, also call `compileAllIdentityStacks` here.
  }

  if (validatedData.updateParticipant) {
    const result = await handleParticipantUpdate(chatId, validatedData.updateParticipant, userId, repos);
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  if (validatedData.addParticipant) {
    const result = await handleAddParticipant(
      chatId,
      validatedData.addParticipant,
      updatedChat.participants.length,
      userId,
      repos
    );
    if ('error' in result) return result;
    updatedChat = result.chat;

    if (validatedData.addParticipant.characterId) {
      const addedCharacter = await repos.characters.findById(validatedData.addParticipant.characterId);
      if (addedCharacter) {
        const newParticipant = updatedChat.participants.find(
          (p) =>
            p.type === 'CHARACTER' &&
            p.characterId === validatedData.addParticipant?.characterId &&
            p.status !== 'removed',
        );

        if (newParticipant) {
          await postHostAddAnnouncement({
            chatId,
            character: addedCharacter,
            participantId: newParticipant.id,
            initialStatus: newParticipant.status,
          });
        }

        // Phase H: compile the identity stack for the new participant.
        if (newParticipant) {
          try {
            await compileIdentityStackForParticipant(updatedChat, newParticipant.id);
          } catch (error) {
            logger.warn('[Chats v1] Failed to compile identity stack for added participant', {
              chatId, participantId: newParticipant.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const joinScenario = validatedData.addParticipant.joinScenario;
        const hasHistoryAccess = validatedData.addParticipant.hasHistoryAccess ?? false;
        if (joinScenario && !hasHistoryAccess && newParticipant) {
          await postHostJoinScenarioAnnouncement({
            chatId,
            characterName: addedCharacter.name,
            targetParticipantId: newParticipant.id,
            joinScenario,
          });
        }
      }
    }
  }

  // Per-chat Concierge tri-state. Routed through the manual-flip helper so
  // each transition does the right combination of DB updates + Concierge
  // announcement in one place.
  if (validatedData.conciergeState) {
    const flipResult = await applyConciergeFlip(chatId, validatedData.conciergeState, updatedChat);
    if (flipResult.changed) {
      const refetched = await repos.chats.findById(chatId);
      if (refetched) updatedChat = refetched;
    }
  }

  if (validatedData.removeParticipantId) {
    const removedParticipant = updatedChat.participants.find((p) => p.id === validatedData.removeParticipantId);
    let removedCharacterName: string | null = null;
    if (removedParticipant?.characterId) {
      const character = await repos.characters.findById(removedParticipant.characterId);
      if (character) removedCharacterName = character.name;
    }

    const result = await handleRemoveParticipant(chatId, validatedData.removeParticipantId, repos);
    if ('error' in result) return result;
    updatedChat = result.chat;

    if (removedCharacterName) {
      await postHostRemoveAnnouncement({
        chatId,
        characterName: removedCharacterName,
        participantId: validatedData.removeParticipantId,
      });
    }
  }

  return { chat: updatedChat };
}

/**
 * Record a status change as a system event in the chat's message history.
 * This allows other characters to be notified in their next prompt.
 */
export async function recordStatusChangeEvent(
  chatId: string,
  characterName: string,
  oldStatus: string,
  newStatus: string,
  repos: Repos
): Promise<void> {
  const statusLabels: Record<string, string> = {
    active: 'active (speaking normally)',
    silent: 'silent (observing, not speaking)',
    absent: 'absent (away from the scene)',
    removed: 'removed (left the conversation)',
  };

  const description = `${characterName} changed from ${statusLabels[oldStatus] || oldStatus} to ${statusLabels[newStatus] || newStatus}`;

  const systemEvent = {
    id: crypto.randomUUID(),
    type: 'system' as const,
    systemEventType: 'STATUS_CHANGE' as const,
    description,
    createdAt: new Date().toISOString(),
  };

  try {
    await repos.chats.addMessage(chatId, systemEvent);
  } catch (error) {
    logger.error('[Chats v1] Failed to record status change event', { chatId, error: error instanceof Error ? error.message : String(error) });
  }
}
