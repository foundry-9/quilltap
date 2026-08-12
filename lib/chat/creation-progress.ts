/**
 * Chat-Creation Progress Bus ("The Green Room")
 *
 * `POST /api/v1/chats` does a lot of slow, blocking work before it returns —
 * resolving the cast, running a per-character LLM "choose what to wear" step,
 * compiling identity stacks, backfilling continuation history, seeding the
 * opening scene. None of that is visible to the user today.
 *
 * That request must keep returning JSON (the client's raw fetch and the
 * autonomous/continuation branches all depend on it), so progress travels on a
 * SEPARATE side-channel keyed by a client-generated correlation id (`progressId`).
 * The create handler publishes events here; a standalone SSE route
 * (`/api/v1/chats/creation-progress`) subscribes and streams them to the
 * blocking status dialog.
 *
 * The buffering/fan-out/TTL machinery lives in the shared
 * {@link module:lib/progress/operation-progress} bus — The Almanack's report
 * run needed the identical mechanism, so this module is now the
 * chat-creation-flavoured face of it (wardrobe events on top of the core
 * status/log/done/error vocabulary).
 */

import {
  createOperationProgressEmitter,
  failOperationProgress,
  finishOperationProgress,
  publishOperationProgress,
  subscribeOperationProgress,
  __resetOperationProgressForTests,
  type CoreProgressEvent,
} from '@/lib/progress/operation-progress';

/** One resolved garment in a slot preview. */
export interface OutfitPreviewEntry {
  id: string;
  title: string;
  isComposite: boolean;
}

/** The decided four-slot outfit, rendered read-only in the dialog. */
export interface OutfitPreviewSlots {
  top: OutfitPreviewEntry[];
  bottom: OutfitPreviewEntry[];
  footwear: OutfitPreviewEntry[];
  accessories: OutfitPreviewEntry[];
}

/** Chat creation's own events, on top of the shared core vocabulary. */
export type CreationProgressEvent =
  | Extract<CoreProgressEvent, { kind: 'status' | 'log' | 'done' | 'error' }>
  | { kind: 'wardrobe-start'; characterId: string; characterName: string; ts: number }
  | {
      kind: 'wardrobe-result';
      characterId: string;
      characterName: string;
      slots: OutfitPreviewSlots;
      ts: number;
    };

/**
 * Append an event to a channel and fan it out to live subscribers. No-op after
 * the channel has finished (a terminal event was already published).
 */
export function publishCreationProgress(id: string, event: CreationProgressEvent): void {
  publishOperationProgress(id, event);
}

/**
 * Subscribe to a channel. Returns the buffered backlog to replay immediately
 * (which may already include the terminal `done`/`error`) plus an unsubscribe.
 */
export function subscribeCreationProgress(
  id: string,
  listener: (event: CreationProgressEvent) => void,
): { replay: CreationProgressEvent[]; unsubscribe: () => void } {
  return subscribeOperationProgress<CreationProgressEvent>(id, listener);
}

/** Publish the terminal `done` event and schedule the channel for cleanup. */
export function finishCreationProgress(id: string): void {
  finishOperationProgress(id);
}

/** Publish the terminal `error` event and schedule the channel for cleanup. */
export function failCreationProgress(id: string, message: string): void {
  failOperationProgress(id, message);
}

/**
 * A per-id emitter handed to the creation flow. When `id` is null/undefined it
 * is entirely inert, so callers never have to branch on whether progress is
 * being tracked.
 */
export interface CreationProgressEmitter {
  status(message: string): void;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  wardrobeStart(characterId: string, characterName: string): void;
  wardrobeResult(characterId: string, characterName: string, slots: OutfitPreviewSlots): void;
  finish(): void;
  fail(message: string): void;
}

export function createCreationProgressEmitter(
  id: string | undefined | null,
): CreationProgressEmitter {
  const base = createOperationProgressEmitter(id);
  return {
    status: base.status,
    log: base.log,
    wardrobeStart: (characterId, characterName) =>
      base.publish({ kind: 'wardrobe-start', characterId, characterName, ts: Date.now() }),
    wardrobeResult: (characterId, characterName, slots) =>
      base.publish({ kind: 'wardrobe-result', characterId, characterName, slots, ts: Date.now() }),
    finish: base.finish,
    fail: base.fail,
  };
}

/** Test-only: drop all channels and their pending cleanup timers. */
export function __resetCreationProgressForTests(): void {
  __resetOperationProgressForTests();
}
