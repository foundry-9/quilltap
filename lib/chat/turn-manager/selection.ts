/**
 * Turn Selection Algorithm
 *
 * Implements the weighted random selection algorithm for choosing
 * the next speaker in multi-character chats.
 */

import { turnManagerLogger as logger } from './logger';
import type { TurnState, TurnSelectionResult } from './types';
import type { ChatEvent, ChatParticipantBase, Character } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/types';
import { isUserDrivenSeat } from './utils';
import { computeSpokenThisCycleAfterMessage } from './state';

/**
 * Selects the next speaker based on turn state and talkativeness weights.
 *
 * Both LLM-controlled and user-controlled CHARACTER participants are in the
 * rotation, each weighted by their character's `talkativeness`. The orchestrator
 * stops the chain when the selection lands on a user-controlled participant
 * (the chat then waits for the human to type or click Skip).
 *
 * Algorithm:
 * 1. If the manual queue is not empty, pop and return its head.
 * 2. Otherwise, weighted-random pick from { active CHARACTER participants } minus
 *    { last speaker, anyone in spokenThisCycle }.
 * 3. If no candidates remain (cycle complete), wrap: weighted-random pick from
 *    { active - last speaker }. The orchestrator clears spokenThisCycle on wrap.
 */
export function selectNextSpeaker(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  turnState: TurnState,
  _userParticipantId: string | null,
  impersonatingParticipantIds?: readonly string[] | null
): TurnSelectionResult {
  // Step 1: Check queue first
  if (turnState.queue.length > 0) {
    const nextFromQueue = turnState.queue[0];
    return {
      nextSpeakerId: nextFromQueue,
      reason: 'queue',
      cycleComplete: false,
    };
  }

  // All present CHARACTER participants are in the rotation — including
  // user-controlled ones. Their talkativeness biases ordering; when picked, the
  // orchestrator pauses the chain so the human can type or skip.
  const activeCharacterParticipants = participants.filter(
    p => p.type === 'CHARACTER' && isParticipantPresent(p.status) && p.characterId,
  );

  if (activeCharacterParticipants.length === 0) {
    return {
      nextSpeakerId: null,
      reason: 'user_turn',
      cycleComplete: true,
    };
  }

  // Special case: only one CHARACTER participant. If they just spoke, let them
  // continue (monologue / single-speaker chat); the no-back-to-back guard is
  // pointless with nobody else to alternate with.
  if (activeCharacterParticipants.length === 1) {
    const onlyCharacter = activeCharacterParticipants[0];
    return buildResult(onlyCharacter, 'only_character', false, impersonatingParticipantIds);
  }

  // Step 2: Weighted-random pick from eligible (not last speaker, not yet
  // spoken this cycle).
  const eligibleParticipants = activeCharacterParticipants.filter(p => {
    if (p.id === turnState.lastSpeakerId) return false;
    if (turnState.spokenSinceUserTurn.includes(p.id)) return false;
    return true;
  });

  if (eligibleParticipants.length > 0) {
    const pick = pickWeighted(eligibleParticipants, characters);
    return buildResult(pick.participant, 'weighted_selection', false, impersonatingParticipantIds, {
      eligibleSpeakers: eligibleParticipants.map(p => p.id),
      weights: pick.weights,
      randomValue: pick.randomValue,
    });
  }

  // Step 3: Cycle wrapped. Weighted-random pick from { all - last speaker }.
  // The orchestrator clears spokenThisCycle when it observes cycleComplete=true.
  const newCycleParticipants = activeCharacterParticipants.filter(
    p => p.id !== turnState.lastSpeakerId,
  );

  if (newCycleParticipants.length === 0) {
    // Only the last speaker is left (shouldn't happen with >=2 participants),
    // but be defensive.
    return {
      nextSpeakerId: null,
      reason: 'cycle_complete',
      cycleComplete: true,
    };
  }

  const wrapPick = pickWeighted(newCycleParticipants, characters);
  return buildResult(wrapPick.participant, 'weighted_selection', true, impersonatingParticipantIds, {
    eligibleSpeakers: newCycleParticipants.map(p => p.id),
    weights: wrapPick.weights,
    randomValue: wrapPick.randomValue,
    allLLMNewCycle: true,
  });
}

/**
 * Who speaks next *after* a user's just-typed message — projected one step past
 * a post that has NOT been persisted yet.
 *
 * The first-responder decision on a fresh user send happens before the message
 * is written to history, so `calculateTurnStateFromHistory` would still resolve
 * to the poster (whose turn it currently is), not the seat that follows them.
 * This helper advances the persisted cycle exactly the way the message write will
 * (via {@link computeSpokenThisCycleAfterMessage}, so the projection and the
 * eventual persisted state agree), sets the poster as `lastSpeakerId`, then runs
 * the normal full-rotation {@link selectNextSpeaker} over ALL participants.
 *
 * The caller uses this to detect when the floor after a human's post belongs to
 * ANOTHER seat the human drives — in which case the chat pauses for that seat
 * instead of forcing an LLM to answer every human turn (the fair-rotation fix for
 * rooms where the human drives two or more seats alongside a single LLM).
 */
export function selectNextSpeakerAfterUserMessage(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  posterParticipantId: string,
  persistedSpokenThisCycleJson: string | null | undefined,
  turnQueueJson: string | null | undefined,
  userParticipantId: string | null,
  impersonatingParticipantIds?: readonly string[] | null,
): TurnSelectionResult {
  const syntheticPost = {
    type: 'message',
    role: 'USER',
    participantId: posterParticipantId,
  } as unknown as ChatEvent;

  const advancedJson = computeSpokenThisCycleAfterMessage(
    syntheticPost,
    participants,
    persistedSpokenThisCycleJson ?? null,
  );

  const parseIds = (json: string | null | undefined): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };

  // `advancedJson === null` means the write is a no-op (poster already recorded,
  // no wrap) — keep the persisted set as-is.
  const spokenSinceUserTurn = advancedJson !== null
    ? parseIds(advancedJson)
    : parseIds(persistedSpokenThisCycleJson);

  const turnState: TurnState = {
    spokenSinceUserTurn,
    lastSpeakerId: posterParticipantId,
    queue: parseIds(turnQueueJson),
    currentTurnParticipantId: null,
  };

  return selectNextSpeaker(
    participants,
    characters,
    turnState,
    userParticipantId,
    impersonatingParticipantIds,
  );
}

function buildResult(
  participant: ChatParticipantBase,
  reason: TurnSelectionResult['reason'],
  cycleComplete: boolean,
  impersonatingParticipantIds?: readonly string[] | null,
  debug?: TurnSelectionResult['debug'],
): TurnSelectionResult {
  // A seat the human owns OR is impersonating this session takes a *user* turn —
  // the orchestrator pauses the chain so the human types or skips. Impersonation
  // is an overlay (Bug 44): `controlledBy` stays `'llm'`, so consult the overlay
  // rather than the bare column, otherwise a weighted pick would try to generate
  // an LLM response as the character the human is speaking for.
  const isUserDriven = isUserDrivenSeat(participant, impersonatingParticipantIds);
  return {
    nextSpeakerId: participant.id,
    reason: isUserDriven ? 'user_turn' : reason,
    cycleComplete,
    debug,
  };
}

function pickWeighted(
  candidates: ChatParticipantBase[],
  characters: Map<string, Character>,
): { participant: ChatParticipantBase; weights: Record<string, number>; randomValue: number } {
  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const p of candidates) {
    const character = characters.get(p.characterId!);
    // Per-chat override (participant.talkativeness) wins; fall back to the
    // character's value; final default is 0.5.
    const talkativeness = p.talkativeness ?? character?.talkativeness ?? 0.5;
    weights[p.id] = talkativeness;
    totalWeight += talkativeness;
  }
  if (totalWeight === 0) {
    logger.warn('[Turn Manager] Total talkativeness is 0, using equal weights');
    for (const p of candidates) {
      weights[p.id] = 1;
      totalWeight += 1;
    }
  }
  const randomValue = Math.random() * totalWeight;
  let cumulative = 0;
  for (const p of candidates) {
    cumulative += weights[p.id];
    if (randomValue < cumulative) {
      return { participant: p, weights, randomValue };
    }
  }
  return { participant: candidates[candidates.length - 1], weights, randomValue };
}
