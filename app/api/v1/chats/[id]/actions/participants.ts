/**
 * Chats API v1 - Participant Actions
 *
 * Handles add-participant, update-participant, remove-participant,
 * impersonate, stop-impersonate, and set-active-speaker actions
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, errorResponse } from '@/lib/api/responses';
import {
  impersonateSchema,
  stopImpersonateSchema,
  setActiveSpeakerSchema,
  addParticipantSchema,
  updateParticipantSchema,
  removeParticipantSchema,
} from '../schemas';
import { enrichParticipant, handleAddParticipant, handleParticipantUpdate, handleRemoveParticipant, resolveParticipantCharacterName } from '../helpers';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/types';
import {
  postHostAddAnnouncement,
  postHostRemoveAnnouncement,
  postHostJoinScenarioAnnouncement,
} from '@/lib/services/host-notifications/writer';
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler';
import {
  applyOutfitSelections,
  buildCheapLLMConfig,
} from '@/lib/wardrobe/apply-outfit-selections';
import type { OutfitSelection } from '@/lib/schemas/wardrobe.types';

/**
 * Start impersonating a participant
 */
export async function handleImpersonate(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { participantId } = impersonateSchema.parse(body);

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) {
    return notFound('Participant');
  }
  if (!isParticipantPresent(participant.status)) {
    return badRequest('Participant is not active or silent');
  }

  const updatedChat = await repos.chats.addImpersonation(chatId, participantId);
  if (!updatedChat) {
    return serverError('Failed to start impersonation');
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  logger.info('[Chats v1] Impersonation started', { chatId, participantId, characterName });

  return NextResponse.json({
    success: true,
    participantId,
    characterName,
    impersonatingParticipantIds: updatedChat.impersonatingParticipantIds,
    activeTypingParticipantId: updatedChat.activeTypingParticipantId,
  });
}

/**
 * Stop impersonating a participant
 */
export async function handleStopImpersonate(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { participantId, newConnectionProfileId } = stopImpersonateSchema.parse(body);

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) {
    return notFound('Participant');
  }

  let updatedChat = await repos.chats.removeImpersonation(chatId, participantId);
  if (!updatedChat) {
    return serverError('Failed to stop impersonation');
  }

  if (newConnectionProfileId) {
    const profile = await repos.connections.findById(newConnectionProfileId);
    if (!profile) {
      return notFound('Connection profile');
    }

    updatedChat = await repos.chats.updateParticipant(chatId, participantId, {
      connectionProfileId: newConnectionProfileId,
      controlledBy: 'llm',
    });
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  logger.info('[Chats v1] Impersonation stopped', { chatId, participantId, characterName });

  return NextResponse.json({
    success: true,
    participantId,
    characterName,
    impersonatingParticipantIds: updatedChat?.impersonatingParticipantIds || [],
    activeTypingParticipantId: updatedChat?.activeTypingParticipantId || null,
    newConnectionProfileId: newConnectionProfileId || null,
  });
}

/**
 * Set the active typing participant
 */
export async function handleSetActiveSpeaker(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const { participantId } = setActiveSpeakerSchema.parse(body);

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) {
    return notFound('Participant');
  }

  let impersonatingIds = chat.impersonatingParticipantIds || [];
  if (!impersonatingIds.includes(participantId)) {
    if (participant.controlledBy === 'user') {
      logger.info('[Chats v1] Auto-adding user-controlled participant to impersonation', {
        chatId,
        participantId,
      });
      impersonatingIds = [...impersonatingIds, participantId];
      await repos.chats.update(chatId, { impersonatingParticipantIds: impersonatingIds });
    } else {
      return badRequest('Participant is not being impersonated');
    }
  }

  const updatedChat = await repos.chats.setActiveTypingParticipant(chatId, participantId);
  if (!updatedChat) {
    return serverError('Failed to set active speaker');
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  logger.info('[Chats v1] Active speaker set', { chatId, participantId, characterName });

  return NextResponse.json({
    success: true,
    activeTypingParticipantId: participantId,
    characterName,
    impersonatingParticipantIds: impersonatingIds,
  });
}

/**
 * Apply the chosen starting outfit for a freshly-added (or reactivated)
 * participant. Falls back to `'default'` mode when the caller didn't send
 * anything — matches the new-chat behavior so the character shows up
 * dressed in their wardrobe defaults rather than undressed by accident.
 *
 * Failures are logged and swallowed: outfit-application should never block
 * a participant from joining the chat.
 */
async function applyOutfitForAddedParticipant(
  chatId: string,
  chat: ChatMetadata,
  characterId: string,
  outfitSelection: OutfitSelection | undefined,
  userId: string,
  repos: RequestContext['repos'],
): Promise<void> {
  const selection: OutfitSelection = outfitSelection ?? {
    characterId,
    mode: 'default',
  };

  try {
    const chatSettings = await repos.chatSettings.findByUserId(userId);
    await applyOutfitSelections(
      chatId,
      [selection],
      repos,
      {
        userId,
        scenarioText: chat.scenarioText ?? null,
        cheapLLMConfig: buildCheapLLMConfig(chatSettings),
      },
    );
    logger.debug('[Chats v1] Outfit applied for added participant', {
      chatId,
      characterId,
      mode: selection.mode,
    });
  } catch (error) {
    logger.error('[Chats v1] Failed to apply outfit for added participant', {
      chatId,
      characterId,
      mode: selection.mode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Add a new participant to the chat
 */
export async function handleAddParticipantAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = addParticipantSchema.parse(body);

  // Check if character is already in the chat
  if (validatedData.type === 'CHARACTER' && validatedData.characterId) {
    const activeParticipant = chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && isParticipantPresent(p.status)
    );
    if (activeParticipant) {
      return badRequest('Character is already in this chat');
    }

    // Check for deactivated (silenced) participant — still in chat, just inactive
    const deactivatedParticipant = chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && p.status === 'absent'
    );
    if (deactivatedParticipant) {
      return badRequest('Character is already in this chat (currently deactivated)');
    }

    // Check for soft-deleted participant — reactivate instead of creating duplicate
    const removedParticipant = chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === validatedData.characterId && p.status === 'removed'
    );
    if (removedParticipant) {
      const controlledBy = validatedData.controlledBy || removedParticipant.controlledBy || 'llm';
      const updatedChat = await repos.chats.updateParticipant(chatId, removedParticipant.id, {
        status: 'active',
        isActive: true,
        removedAt: null,
        controlledBy,
        connectionProfileId: validatedData.connectionProfileId || removedParticipant.connectionProfileId,
        displayOrder: chat.participants.filter(p => isParticipantPresent(p.status)).length,
      });
      if (!updatedChat) {
        return serverError('Failed to reactivate participant');
      }

      const reactivatedParticipant = updatedChat.participants.find(p => p.id === removedParticipant.id);
      const enrichedParticipant = reactivatedParticipant ? await enrichParticipant(reactivatedParticipant, repos) : null;

      let reactivatedCharacter = null;
      if (reactivatedParticipant?.characterId) {
        reactivatedCharacter = await repos.characters.findById(reactivatedParticipant.characterId);
      }
      const reactivatedCharacterName = reactivatedCharacter?.name || 'Unknown';
      logger.info('[Chats v1] Participant reactivated', {
        chatId, participantId: removedParticipant.id, characterName: reactivatedCharacterName,
        controlledBy,
      });

      if (reactivatedCharacter && reactivatedParticipant) {
        await postHostAddAnnouncement({
          chatId,
          character: reactivatedCharacter,
          participantId: reactivatedParticipant.id,
          initialStatus: reactivatedParticipant.status,
        });

        // Phase H: recompile the identity stack for the reactivated
        // participant in case it had been dropped.
        try {
          await compileIdentityStackForParticipant(updatedChat, removedParticipant.id);
        } catch (error) {
          logger.warn('[Chats v1] Failed to compile identity stack for reactivated participant', {
            chatId, participantId: removedParticipant.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Reactivation: only re-apply an outfit when the caller explicitly
      // sent one. Otherwise preserve whatever they had on before they were
      // removed.
      if (validatedData.outfitSelection && reactivatedParticipant?.characterId) {
        await applyOutfitForAddedParticipant(
          chatId,
          updatedChat,
          reactivatedParticipant.characterId,
          validatedData.outfitSelection,
          user.id,
          repos,
        );
      }

      return NextResponse.json({ participant: enrichedParticipant, chat: updatedChat }, { status: 200 });
    }
  }

  const result = await handleAddParticipant(chatId, validatedData, chat.participants.length, user.id, repos);

  if ('error' in result) {
    if (result.status === 404) return errorResponse(result.error, 404);
    if (result.status === 400) return badRequest(result.error);
    return serverError(result.error);
  }

  const newParticipant = result.chat.participants.find(
    (p) => p.characterId === validatedData.characterId
  );

  const enrichedParticipant = newParticipant ? await enrichParticipant(newParticipant, repos) : null;

  const addedCharacter = validatedData.characterId
    ? await repos.characters.findById(validatedData.characterId)
    : null;
  const addedCharacterName = addedCharacter?.name || 'Unknown';
  logger.info('[Chats v1] Participant added', {
    chatId, participantId: newParticipant?.id, characterName: addedCharacterName,
    controlledBy: validatedData.controlledBy || 'llm',
  });

  if (addedCharacter && newParticipant) {
    await postHostAddAnnouncement({
      chatId,
      character: addedCharacter,
      participantId: newParticipant.id,
      initialStatus: newParticipant.status,
    });

    // Phase H: compile the identity stack for the new participant.
    if (newParticipant) {
      try {
        await compileIdentityStackForParticipant(result.chat, newParticipant.id);
      } catch (error) {
        logger.warn('[Chats v1] Failed to compile identity stack for added participant', {
          chatId, participantId: newParticipant.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (
      newParticipant &&
      validatedData.joinScenario &&
      !(validatedData.hasHistoryAccess ?? false)
    ) {
      await postHostJoinScenarioAnnouncement({
        chatId,
        characterName: addedCharacter.name,
        targetParticipantId: newParticipant.id,
        joinScenario: validatedData.joinScenario,
      });
    }
  }

  // Apply the chosen starting outfit for the new participant. Defaults to
  // 'default' mode when the caller didn't supply one, matching the new-chat
  // flow so the character arrives dressed in their wardrobe defaults.
  if (validatedData.characterId) {
    await applyOutfitForAddedParticipant(
      chatId,
      result.chat,
      validatedData.characterId,
      validatedData.outfitSelection,
      user.id,
      repos,
    );
  }

  return NextResponse.json({ participant: enrichedParticipant, chat: result.chat }, { status: 201 });
}

/**
 * Force-rebuild the cached identity stack (system prompt prefix) for a single
 * participant. Used by the Participants sidebar "Rebuild system prompt"
 * button to pick up edits to the underlying character (manifesto, personality,
 * named systemPrompts, etc.) that aren't auto-invalidated by the compiler.
 */
export async function handleRebuildSystemPromptAction(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const participantId = typeof body?.participantId === 'string' ? body.participantId : null;
  if (!participantId) {
    return badRequest('participantId is required');
  }

  const chat = await repos.chats.findById(chatId);
  if (!chat) return notFound('Chat');

  const participant = chat.participants.find((p) => p.id === participantId);
  if (!participant) return notFound('Participant');

  if (participant.type !== 'CHARACTER' || participant.controlledBy === 'user') {
    return badRequest('System prompt rebuild is only available for LLM-controlled characters');
  }

  const characterName = await resolveParticipantCharacterName(participant, repos);

  try {
    await compileIdentityStackForParticipant(chat, participantId);
  } catch (error) {
    logger.error('[Chats v1] Manual system-prompt rebuild failed', {
      chatId, participantId, characterName,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to rebuild system prompt');
  }

  logger.info('[Chats v1] System prompt rebuilt manually', { chatId, participantId, characterName });

  const refreshedChat = await repos.chats.findById(chatId);
  return NextResponse.json({ ok: true, chat: refreshedChat ?? chat });
}

/**
 * Update an existing participant
 */
export async function handleUpdateParticipantAction(
  req: NextRequest,
  chatId: string,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  // Support both wrapped ({ updateParticipant: { ... } }) and unwrapped ({ participantId, ... }) formats
  const rawData = body.updateParticipant ?? body;
  const validatedData = updateParticipantSchema.parse(rawData);

  // Capture pre-update state for logging
  const preChat = await repos.chats.findById(chatId);
  const preParticipant = preChat?.participants.find((p) => p.id === validatedData.participantId);
  const preStatus = preParticipant?.status || (preParticipant?.isActive ? 'active' : 'absent');

  // Resolve character name for logging
  const characterName = await resolveParticipantCharacterName(preParticipant, repos);

  const { participantId, ...updateFields } = validatedData;

  const result = await handleParticipantUpdate(chatId, validatedData, user.id, repos);

  if ('error' in result) {
    logger.warn('[Chats v1] Participant update failed', {
      chatId, participantId, characterName,
      error: result.error, status: result.status,
    });
    if (result.status === 404) return errorResponse(result.error, 404);
    if (result.status === 400) return badRequest(result.error);
    return serverError(result.error);
  }

  const updatedParticipant = result.chat.participants.find((p) => p.id === validatedData.participantId);
  const enrichedParticipant = updatedParticipant ? await enrichParticipant(updatedParticipant, repos) : null;
  const postStatus = updatedParticipant?.status || 'unknown';

  logger.info('[Chats v1] Participant updated', {
    chatId, participantId: validatedData.participantId, characterName,
    statusChange: preStatus !== postStatus ? `${preStatus} → ${postStatus}` : null,
    updatedFields: Object.keys(updateFields),
  });

  return NextResponse.json({ participant: enrichedParticipant, chat: result.chat });
}

/**
 * Remove a participant from the chat
 */
export async function handleRemoveParticipantAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const validatedData = removeParticipantSchema.parse(body);

  const participantToRemove = chat.participants.find((p) => p.id === validatedData.participantId);
  if (!participantToRemove) {
    logger.warn('[Chats v1] Participant removal failed: not found', {
      chatId, participantId: validatedData.participantId,
    });
    return notFound('Participant');
  }

  // Resolve character name for logging
  const characterName = await resolveParticipantCharacterName(participantToRemove, repos);
  const previousStatus = participantToRemove.status || (participantToRemove.isActive ? 'active' : 'absent');

  const activeCharacters = chat.participants.filter((p) => p.type === 'CHARACTER' && isParticipantPresent(p.status));
  if (activeCharacters.length <= 1 && participantToRemove.type === 'CHARACTER') {
    logger.warn('[Chats v1] Participant removal blocked: last character', {
      chatId, participantId: validatedData.participantId, characterName,
      activeCharacterCount: activeCharacters.length,
    });
    return badRequest('Cannot remove the last character from the chat');
  }

  const result = await handleRemoveParticipant(chatId, validatedData.participantId, repos);

  if ('error' in result) {
    logger.warn('[Chats v1] Participant removal failed', {
      chatId, participantId: validatedData.participantId, characterName,
      error: result.error, status: result.status,
    });
    if (result.status === 404) return errorResponse(result.error, 404);
    if (result.status === 400) return badRequest(result.error);
    return serverError(result.error);
  }

  // Clean up impersonation state for removed participant
  const currentImpersonating = result.chat.impersonatingParticipantIds || [];
  if (currentImpersonating.includes(validatedData.participantId)) {
    const cleanedIds = currentImpersonating.filter((id: string) => id !== validatedData.participantId);
    const updateData: Record<string, unknown> = { impersonatingParticipantIds: cleanedIds };
    if (result.chat.activeTypingParticipantId === validatedData.participantId) {
      updateData.activeTypingParticipantId = cleanedIds[0] || null;
    }
    await repos.chats.update(chatId, updateData);
  }

  logger.info('[Chats v1] Participant removed', {
    chatId, participantId: validatedData.participantId, characterName,
    previousStatus,
  });

  if (characterName !== 'Unknown') {
    await postHostRemoveAnnouncement({
      chatId,
      characterName,
      participantId: validatedData.participantId,
    });
  }

  return NextResponse.json({ success: true, chat: result.chat });
}
