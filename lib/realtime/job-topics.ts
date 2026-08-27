/**
 * Background-job type → realtime topics
 *
 * A completed job is the moment a lot of server state stops being what the
 * open tabs think it is. The dispatcher knows the job's type and payload the
 * instant its write batch commits, which makes that one place a better
 * publisher than a dozen scattered handlers — and the handlers run in the
 * forked child, where publishing is a no-op anyway.
 *
 * This table is deliberately partial. A job type absent from it still moves
 * the `jobs` topic (the queue itself changed); it just has no *entity* worth
 * announcing, or its entity is covered by the write-batch mapping in
 * `job-dispatcher`'s `dispatchInvalidations`.
 *
 * @module lib/realtime/job-topics
 */

import type { RealtimeTopic } from '@/lib/schemas/realtime.types';

export interface TopicHint {
  topic: RealtimeTopic;
  id?: string;
}

function str(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The entity topics a finished job of `jobType` should announce.
 *
 * @param jobType The background-job type, or undefined when the dispatcher
 *   never saw the row (a result arriving for a job it no longer tracks).
 * @param payload The job's payload, read for the ids to scope hints to.
 */
export function topicsForCompletedJob(
  jobType: string | undefined,
  payload?: Record<string, unknown>,
): TopicHint[] {
  switch (jobType) {
    case 'AUTONOMOUS_ROOM_TURN':
    case 'AUTONOMOUS_ROOM_SCHEDULE_TICK':
      // Budgets consumed, run state possibly ended — the toolbar's room badges
      // read all of it.
      return [{ topic: 'autonomousRooms' }, { topic: 'chats', id: str(payload, 'chatId') }];

    case 'STORY_BACKGROUND_GENERATION': {
      // Either a chat or a project owns the background; the payload says which.
      const chatId = str(payload, 'chatId');
      if (chatId) return [{ topic: 'chats', id: chatId }];
      const projectId = str(payload, 'projectId');
      if (projectId) return [{ topic: 'projects', id: projectId }];
      return [];
    }

    case 'CHARACTER_AVATAR_GENERATION':
      return [
        { topic: 'chats', id: str(payload, 'chatId') },
        { topic: 'characters', id: str(payload, 'characterId') },
      ];

    case 'CHARACTER_HEADSHOULDERS_BACKFILL':
      return [{ topic: 'characters', id: str(payload, 'characterId') }];

    case 'TITLE_UPDATE':
    case 'CONTEXT_SUMMARY':
    case 'CHAT_DANGER_CLASSIFICATION':
    case 'SCENE_STATE_TRACKING':
    case 'WARDROBE_OUTFIT_ANNOUNCEMENT':
      return [{ topic: 'chats', id: str(payload, 'chatId') }];

    case 'CONVERSATION_RENDER':
      // A rendered conversation lands in a document store; the Scriptorium and
      // the character conversations tab both watch that.
      return [{ topic: 'mountPoints' }, { topic: 'chats', id: str(payload, 'chatId') }];

    default:
      return [];
  }
}

/**
 * Repository namespace → the realtime topic its rows belong to.
 *
 * Keyed on the part of a buffered write's `method` before the first dot, which
 * is precise in a way that probing argument shapes is not: `chats.update` is a
 * chat write no matter what its arguments look like. Namespaces absent from
 * this table have no client-visible topic yet and are simply skipped.
 */
const REPOSITORY_TOPICS: Record<string, RealtimeTopic> = {
  characters: 'characters',
  chats: 'chats',
  projects: 'projects',
  docMountPoints: 'mountPoints',
  docMountFiles: 'mountPoints',
  docMountFileLinks: 'mountPoints',
  docMountFolders: 'mountPoints',
  docMountDocuments: 'mountPoints',
};

/**
 * Which argument on a write carries the id the topic is scoped by. A write
 * whose first argument is the id string (`chats.update(chatId, patch)`) is the
 * common shape; object-shaped payloads name it instead.
 */
const TOPIC_ID_FIELDS: Record<RealtimeTopic, readonly string[]> = {
  characters: ['characterId', 'id'],
  chats: ['chatId', 'id'],
  projects: ['projectId', 'id'],
  mountPoints: ['mountPointId', 'id'],
  autonomousRooms: [],
  jobs: [],
};

/**
 * Read an entity id off a repository call's first argument. Handles the two
 * shapes a write takes: the id as the first positional arg
 * (`chats.update(chatId, patch)`), or an object payload naming it in one of
 * `fields`.
 */
export function firstIdArg(args: readonly unknown[] | undefined, ...fields: string[]): string | undefined {
  const first = args?.[0];
  if (typeof first === 'string' && first.length > 0) return first;
  if (first && typeof first === 'object') {
    const obj = first as Record<string, unknown>;
    for (const field of fields) {
      const value = obj[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return undefined;
}

function extractTopicId(topic: RealtimeTopic, args: readonly unknown[] | undefined): string | undefined {
  return firstIdArg(args, ...TOPIC_ID_FIELDS[topic]);
}

/**
 * Entity hints for a committed write batch, deduplicated.
 *
 * Called from the dispatcher's post-commit `dispatchInvalidations`, which is
 * the one place in the codebase that sees *every* background-job write after
 * it has actually landed. One hook there covers every job handler that will
 * ever be written.
 *
 * A write whose id can't be read still yields a collection-wide hint for its
 * topic — coarser than ideal, never wrong.
 */
export function topicsForWriteBatch(
  writes: readonly { method: string; args?: readonly unknown[] }[],
): TopicHint[] {
  const seen = new Set<string>();
  const hints: TopicHint[] = [];

  for (const write of writes) {
    const namespace = write.method.split('.')[0];
    const topic = REPOSITORY_TOPICS[namespace];
    if (!topic) continue;

    const id = extractTopicId(topic, write.args);
    const key = id ? `${topic}:${id}` : topic;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(id ? { topic, id } : { topic });
  }

  return hints;
}
