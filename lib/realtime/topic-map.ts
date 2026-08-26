/**
 * Realtime topic → query-key mapping
 *
 * The one table translating a server topic into the TanStack Query keys it
 * makes stale. Keeping it boring is the whole point of naming topics after
 * `lib/query/keys.ts` namespaces (see the realtime feature doc, decision 8):
 * adding an entity is one row here and one row in `REALTIME_TOPICS`.
 *
 * An unrecognised topic is ignored, deliberately. A tab left open across a
 * server upgrade will be handed topics its build has never heard of, and the
 * correct response is to shrug — never to throw inside a socket message
 * handler.
 *
 * @module lib/realtime/topic-map
 */

import { queryKeys } from '@/lib/query/keys'

/** A query key prefix to invalidate. */
export type QueryKeyPrefix = readonly unknown[]

/**
 * Every prefix this build knows how to invalidate, used for the
 * reconnect catch-up sweep — a client that was offline has no idea what it
 * missed, so it re-reads everything the socket could have told it about.
 */
export const ALL_REALTIME_PREFIXES: readonly QueryKeyPrefix[] = [
  queryKeys.system.jobs,
  queryKeys.system.tasksQueue,
  queryKeys.system.autonomousRooms,
  queryKeys.chats.all,
  queryKeys.projects.all,
  queryKeys.characters.all,
  queryKeys.mountPoints.all,
]

/**
 * Resolve the query-key prefixes a topic invalidates.
 *
 * When `id` is present the change is row-scoped, and we narrow to that row's
 * keys rather than sweeping the whole namespace — an avatar landing in one
 * chat should not refetch every other open Salon tab.
 *
 * @returns The prefixes to invalidate; empty for an unknown topic.
 */
export function queryKeysForTopic(topic: string, id?: string): readonly QueryKeyPrefix[] {
  switch (topic) {
    case 'jobs':
      // The chips and the tasks queue read the same queue through different
      // endpoints, so one topic drives both.
      return [queryKeys.system.jobs, queryKeys.system.tasksQueue]

    case 'autonomousRooms':
      return [queryKeys.system.autonomousRooms]

    case 'chats':
      return id
        ? [
            queryKeys.chats.detail(id),
            queryKeys.chats.state(id),
            queryKeys.chats.background(id),
          ]
        : [queryKeys.chats.all]

    case 'projects':
      return id
        ? [
            queryKeys.projects.detail(id),
            queryKeys.projects.state(id),
            queryKeys.projects.background(id),
          ]
        : [queryKeys.projects.all]

    case 'characters':
      return id
        ? [
            queryKeys.characters.detail(id),
            queryKeys.characters.prompts(id),
            queryKeys.characters.photos(id),
          ]
        : [queryKeys.characters.all]

    case 'mountPoints':
      // No per-store detail key exists yet; the namespace prefix is the
      // narrowest thing there is to invalidate.
      return [queryKeys.mountPoints.all]

    default:
      return []
  }
}
