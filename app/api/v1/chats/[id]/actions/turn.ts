/**
 * Chats API v1 - Turn Actions
 *
 * Handles turn action (nudge/queue/dequeue)
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, badRequest } from '@/lib/api/responses';
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
  getQueuePosition,
  getActiveCharacterParticipants,
  findUserParticipant,
  getSelectionExplanation,
  computeSpokenThisCycleAfterSkip,
  computeSkipEligibility,
  qualifiesForTurnSkipping,
  isUsersTurn,
} from '@/lib/chat/turn-manager';
import { postHostTurnPassAnnouncement } from '@/lib/services/host-notifications/writer';
import { turnActionSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata, MessageEvent, Character } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/chat.types';

/**
 * Process a turn action (nudge, queue, dequeue, or query)
 */
export async function handleTurnAction(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const parsed = turnActionSchema.parse(body);
  const turnAction = parsed.action;
  const participantId = 'participantId' in parsed ? parsed.participantId : undefined;

  // For non-query actions, validate the target participant
  if (turnAction !== 'query') {
    const participant = chat.participants.find((p) => p.id === participantId);
    if (!participant) {
      return notFound('Participant');
    }
    if (!isParticipantPresent(participant.status)) {
      return badRequest('Participant is not active');
    }
    if (turnAction === 'skipUserTurn' && participant.controlledBy !== 'user') {
      return badRequest('Only user-controlled participants can be skipped');
    }
  }

  const userParticipant = findUserParticipant(chat.participants);
  const userParticipantId = userParticipant?.id ?? null;

  const messages = await repos.chats.getMessages(chatId);
  const messageEvents = messages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[];

  let turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: chat.participants,
    userParticipantId,
    spokenThisCycleParticipantIds: chat.spokenThisCycleParticipantIds,
  });

  // Pre-computed cycle update for skipUserTurn — written below alongside
  // the turn queue.
  let skipCycleUpdate: string | null | undefined = undefined;

  switch (turnAction) {
    case 'nudge':
      turnState = nudgeParticipant(turnState, participantId!);
      break;
    case 'queue':
      turnState = addToQueue(turnState, participantId!);
      break;
    case 'dequeue':
      turnState = removeFromQueue(turnState, participantId!);
      break;
    case 'query':
      // Read-only: just compute next speaker from current state
      break;
    case 'skipUserTurn': {
      // Turn-skipping only applies to genuine group scenes; in a one-on-one the
      // Skip button behaves as it always did — no must-speak guard and no Host
      // turn-pass note. (source: shared qualifiesForTurnSkipping.)
      const turnSkippingApplies = qualifiesForTurnSkipping(chat.participants);
      const skipParticipant = chat.participants.find(p => p.id === participantId);
      const skipChar = skipParticipant?.characterId
        ? await repos.characters.findById(skipParticipant.characterId)
        : null;
      // Must-speak guard: when every OTHER active character has already passed
      // since the last substantive message, the floor falls to this participant
      // and the human is refused the skip. Only `all-others-skipped` blocks a
      // human — when the feature is toggled off, `feature-disabled` fires first
      // and the human is never blocked. (source: shared computeSkipEligibility.)
      if (turnSkippingApplies && skipChar) {
        const eligibility = computeSkipEligibility({
          events: messageEvents,
          participants: chat.participants,
          respondingParticipantId: participantId!,
          respondingCharacter: skipChar,
          summoned: false,
          turnSkippingEnabled: chat.turnSkippingEnabled !== false,
        });
        if (eligibility.mustSpeakReason === 'all-others-skipped') {
          return badRequest(`Everyone else has passed — it falls to ${skipChar.name} to say something.`);
        }
      }

      // Record the user-controlled participant as having "taken" their turn,
      // and treat them as the last speaker so the next pick excludes them.
      skipCycleUpdate = computeSpokenThisCycleAfterSkip(
        participantId!,
        chat.participants,
        chat.spokenThisCycleParticipantIds,
      );
      if (skipCycleUpdate !== null) {
        try {
          const parsed = JSON.parse(skipCycleUpdate);
          if (Array.isArray(parsed)) {
            turnState = {
              ...turnState,
              spokenSinceUserTurn: parsed.filter((id): id is string => typeof id === 'string'),
            };
          }
        } catch {
          // Fall back to manual append; cycle wrap won't be observed locally.
          if (!turnState.spokenSinceUserTurn.includes(participantId!)) {
            turnState = {
              ...turnState,
              spokenSinceUserTurn: [...turnState.spokenSinceUserTurn, participantId!],
            };
          }
        }
      }
      turnState = { ...turnState, lastSpeakerId: participantId! };
      // Post a Host turn-pass record so human passes feed the same stall guard
      // as LLM passes — but only in chats where turn-skipping applies. In a
      // one-on-one, skipping the user's turn stays a quiet rotation advance.
      // Errors are swallowed by the writer contract.
      if (turnSkippingApplies) {
        await postHostTurnPassAnnouncement({
          chatId,
          characterName: skipChar?.name ?? 'The player',
          participantId: participantId!,
          source: 'user',
        });
      }
      break;
    }
  }

  const activeCharacterParticipants = getActiveCharacterParticipants(chat.participants);
  const charactersMap = new Map<string, Character>();
  for (const p of activeCharacterParticipants) {
    if (p.characterId) {
      const char = await repos.characters.findById(p.characterId);
      if (char) {
        charactersMap.set(p.characterId, char);
      }
    }
  }

  const nextSpeakerResult = selectNextSpeaker(chat.participants, charactersMap, turnState, userParticipantId);

  // Persist turn queue and last turn participant for state-modifying actions
  if (turnAction !== 'query') {
    const updatePayload: Record<string, unknown> = {
      turnQueue: JSON.stringify(turnState.queue),
      lastTurnParticipantId: nextSpeakerResult.nextSpeakerId ?? null,
    };
    if (turnAction === 'skipUserTurn' && skipCycleUpdate !== null && skipCycleUpdate !== undefined) {
      updatePayload.spokenThisCycleParticipantIds = skipCycleUpdate;
    }
    await repos.chats.update(chatId, updatePayload);
  }

  // Determine the next speaker's character info
  const nextSpeakerParticipant = nextSpeakerResult.nextSpeakerId
    ? chat.participants.find(p => p.id === nextSpeakerResult.nextSpeakerId)
    : null;
  const nextSpeakerCharacter = nextSpeakerParticipant?.characterId
    ? charactersMap.get(nextSpeakerParticipant.characterId)
    : null;

  const response: Record<string, unknown> = {
    success: true,
    action: turnAction,
    turn: {
      nextSpeakerId: nextSpeakerResult.nextSpeakerId,
      nextSpeakerName: nextSpeakerCharacter?.name ?? null,
      nextSpeakerControlledBy: nextSpeakerParticipant?.controlledBy ?? null,
      reason: nextSpeakerResult.reason,
      explanation: getSelectionExplanation(nextSpeakerResult),
      cycleComplete: nextSpeakerResult.cycleComplete,
      isUsersTurn: isUsersTurn(nextSpeakerResult),
    },
    state: {
      queue: turnState.queue,
    },
  };

  // Include affected participant info for non-query actions
  if (participantId) {
    const affectedCharacter = chat.participants.find(p => p.id === participantId);
    const affectedCharacterData = affectedCharacter?.characterId
      ? charactersMap.get(affectedCharacter.characterId)
      : null;
    response.participant = {
      id: participantId,
      name: affectedCharacterData?.name ?? 'Unknown',
      queuePosition: getQueuePosition(turnState, participantId),
    };
  }

  return NextResponse.json(response);
}
