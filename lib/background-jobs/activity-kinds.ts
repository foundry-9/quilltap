/**
 * Activity kinds — the single source of truth behind the toolbar chips.
 *
 * The chips in the page toolbar ("Mem", "Emb", "Sum", "Dgr", "Img") report
 * how much work of each kind is in flight. Two very different things feed
 * them:
 *
 *   1. Rows in `background_jobs` with status PENDING/PROCESSING, mapped to a
 *      kind by {@link JOB_TYPE_ACTIVITY}.
 *   2. Non-job work registered with the in-process activity registry
 *      (`lib/background-jobs/activity-registry`) — the inline image tool, the
 *      Concierge classifier, embedding calls made straight from a request.
 *
 * `JOB_TYPE_ACTIVITY` is a **total** `Record<BackgroundJobType, …>` on
 * purpose: adding a member to `BackgroundJobTypeEnum` without deciding which
 * chip it belongs to is a type error rather than a silently invisible queue.
 * Deliberate omissions are spelled `null`, not left out.
 *
 * Client-safe — imports nothing but types.
 *
 * @module lib/background-jobs/activity-kinds
 */

import type { BackgroundJobType } from '@/lib/schemas/job.types';

/** The kinds of work a toolbar chip can report. */
export const ACTIVITY_KINDS = ['memory', 'embedding', 'summary', 'danger', 'image'] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * Which chip each background-job type counts toward.
 *
 * `null` means "deliberately uncounted here": either the work is pure
 * maintenance the user never waits on, or it already has a richer readout of
 * its own (autonomous rooms have their own badges).
 */
export const JOB_TYPE_ACTIVITY: Record<BackgroundJobType, ActivityKind | null> = {
  // ── Mem ──────────────────────────────────────────────────────────────────
  MEMORY_EXTRACTION: 'memory',
  INTER_CHARACTER_MEMORY: 'memory',
  MEMORY_REGENERATE_CHAT: 'memory',
  MEMORY_REGENERATE_ALL: 'memory',
  MEMORY_HOUSEKEEPING: 'memory',
  CARINA_MEMORY_EXTRACTION: 'memory',

  // ── Emb ──────────────────────────────────────────────────────────────────
  EMBEDDING_GENERATE: 'embedding',
  EMBEDDING_REFIT: 'embedding',
  EMBEDDING_REINDEX_ALL: 'embedding',
  EMBEDDING_REAPPLY_PROFILE: 'embedding',

  // ── Sum ──────────────────────────────────────────────────────────────────
  CONTEXT_SUMMARY: 'summary',
  TITLE_UPDATE: 'summary',
  SCENE_STATE_TRACKING: 'summary',
  CONVERSATION_RENDER: 'summary',
  REGENERATE_CONVERSATION_SUMMARIES: 'summary',
  WARDROBE_OUTFIT_ANNOUNCEMENT: 'summary',

  // ── Dgr ──────────────────────────────────────────────────────────────────
  CHAT_DANGER_CLASSIFICATION: 'danger',

  // ── Img ──────────────────────────────────────────────────────────────────
  STORY_BACKGROUND_GENERATION: 'image',
  CHARACTER_AVATAR_GENERATION: 'image',
  CHARACTER_HEADSHOULDERS_BACKFILL: 'image',

  // ── Deliberately uncounted ───────────────────────────────────────────────
  /** Housekeeping the user never waits on. */
  LLM_LOG_CLEANUP: null,
  /** Autonomous rooms report through their own toolbar badges. */
  AUTONOMOUS_ROOM_TURN: null,
  AUTONOMOUS_ROOM_SCHEDULE_TICK: null,
};

/** Display metadata for the toolbar chips, in render order. */
export const ACTIVITY_CHIPS: readonly {
  readonly kind: ActivityKind;
  readonly label: string;
  readonly title: string;
  readonly badgeClass: string;
}[] = [
  {
    kind: 'memory',
    label: 'Mem',
    title: 'Memory work (extraction, regeneration, housekeeping)',
    badgeClass: 'qt-queue-badge-memory',
  },
  {
    kind: 'embedding',
    label: 'Emb',
    title: 'Embedding work (indexing, refits, live query embeddings)',
    badgeClass: 'qt-queue-badge-embedding',
  },
  {
    kind: 'summary',
    label: 'Sum',
    title: 'Summarization and post-turn processing (summaries, titles, scene state, rendering)',
    badgeClass: 'qt-queue-badge-summary',
  },
  {
    kind: 'danger',
    label: 'Dgr',
    title: 'the Concierge classification (per-message and chat-level)',
    badgeClass: 'qt-queue-badge-danger',
  },
  {
    kind: 'image',
    label: 'Img',
    title: 'Image work, end to end (prompt crafting, generation, landing)',
    badgeClass: 'qt-queue-badge-story',
  },
] as const;

/** Empty counter map, one zeroed entry per kind. */
export function emptyActivityCounts(): Record<ActivityKind, number> {
  return { memory: 0, embedding: 0, summary: 0, danger: 0, image: 0 };
}

/**
 * Which chip a job type counts toward, tolerant of unknown strings (a row
 * written by a newer build than the one reading it).
 */
export function activityKindForJobType(type: string): ActivityKind | null {
  return JOB_TYPE_ACTIVITY[type as BackgroundJobType] ?? null;
}
