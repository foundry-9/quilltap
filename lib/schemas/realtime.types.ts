/**
 * Realtime Event Type Definitions
 *
 * The wire format for the realtime invalidation socket
 * (`/api/v1/system/realtime/stream`). Deliberately tiny: an event says *which
 * slice of server state changed*, never *what it changed to*. The HTTP API
 * stays the single source of truth for the data itself; the socket only says
 * when to look again.
 *
 * Client-safe — types and Zod only, no server imports.
 *
 * @module schemas/realtime.types
 */

import { z } from 'zod';

/**
 * Canonical topic names.
 *
 * Each one is (or maps 1:1 onto) a namespace in `lib/query/keys.ts`, which is
 * what keeps the client's `topic-map` boring: adding an entity is one row in
 * each of the two files. The wire schema still accepts *any* string, so a
 * server that learns a new topic can't break an older tab — see
 * `lib/realtime/topic-map.ts`, which ignores what it doesn't recognise.
 */
export const REALTIME_TOPICS = [
  /** Background-job lifecycle and inline activity spans — the toolbar chips. */
  'jobs',
  /** Autonomous-room run state and budgets. */
  'autonomousRooms',
  /** Chats: list membership, detail, per-chat background/state. */
  'chats',
  /** Projects, including their story backgrounds. */
  'projects',
  /** Characters and their prompts/photos. */
  'characters',
  /** Document stores and their indexing/embedding status. */
  'mountPoints',
] as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

/**
 * A server→client invalidation hint.
 *
 * `at` is for debugging and log correlation only. Clients must not order,
 * dedupe, or expire on it — the server's clock is not the client's, and the
 * bus coalesces events anyway.
 */
export const RealtimeEventSchema = z.object({
  v: z.literal(1),
  /** A `queryKeys` namespace name, e.g. 'jobs', 'chats', 'autonomousRooms'. */
  topic: z.string(),
  /** Entity id, when the change is row-scoped rather than collection-wide. */
  id: z.string().optional(),
  /** Server ms timestamp — debugging/ordering only; clients must not depend on it. */
  at: z.number(),
});

export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

/** The only client→server message: a keepalive, answered with `pong`. */
export const RealtimeClientMessageSchema = z.object({
  type: z.literal('ping'),
});

export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>;

/** The protocol version this build speaks. */
export const REALTIME_PROTOCOL_VERSION = 1;

/** The upgrade path, shared by the server dispatcher and the client hub. */
export const REALTIME_STREAM_PATH = '/api/v1/system/realtime/stream';
