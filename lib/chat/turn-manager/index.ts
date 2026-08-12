/**
 * Turn Manager Module
 * Multi-Character Chat System - Phase 2
 *
 * Provides turn-based dialogue management for multi-character chats.
 * Handles turn selection algorithm, queue management, and turn state tracking.
 *
 * @module lib/chat/turn-manager
 */

// Types
export type {
  TurnState,
  TurnSelectionResult,
  CalculateTurnStateOptions,
} from './types';

// State management
export {
  createInitialTurnState,
  calculateTurnStateFromHistory,
  updateTurnStateAfterMessage,
  computeSpokenThisCycleAfterMessage,
  computeSpokenThisCycleAfterSkip,
} from './state';

// Turn selection
export { selectNextSpeaker, selectNextSpeakerAfterUserMessage } from './selection';

// "Nothing to add" turn-skipping — shared pure logic
export {
  NOTHING_TO_ADD_SENTINEL,
  TURN_PASS_SYSTEM_KIND,
  isTurnPassMessage,
  detectSkipSentinel,
  findSkippedSinceLastSubstantive,
  isFirstCharacterTurn,
  isRecentlyAddressed,
  qualifiesForTurnSkipping,
  computeSkipEligibility,
} from './skip-signal';
export type {
  DetectSkipResult,
  MustSpeakReason,
  ComputeSkipEligibilityOptions,
  SkipEligibility,
} from './skip-signal';

// Queue management
export {
  addToQueue,
  removeFromQueue,
  popFromQueue,
  nudgeParticipant,
  resetCycleForUserSkip,
} from './queue';

// Utilities
export {
  getQueuePosition,
  isParticipantsTurn,
  isUsersTurn,
  getSelectionExplanation,
  findUserParticipant,
  findActiveUserParticipant,
  isUserDrivenSeat,
  findUserControlledParticipants,
  getActiveCharacterParticipants,
  getActiveLLMParticipants,
  isMultiCharacterChat,
  isAllLLMChat,
} from './utils';

// Turn order computation (display-only)
export {
  computePredictedTurnOrder,
} from './turn-order';
export type {
  TurnOrderEntry,
  TurnOrderStatus,
} from './turn-order';

// All-LLM pause logic
export {
  INITIAL_PAUSE_INTERVAL,
  getNextPauseInterval,
  shouldPauseForAllLLM,
  getCurrentPauseThreshold,
  getNextPauseThreshold,
  getTurnsUntilNextPause,
} from './all-llm-pause';
