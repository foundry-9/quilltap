/**
 * Unit tests for the realtime topic → query-key mapping.
 *
 * The behaviour that matters most is the one that looks like a non-feature:
 * an unrecognised topic must map to nothing at all. An older tab meeting a
 * newer server is the normal case after an upgrade, and a throw inside a
 * socket message handler would take the whole hub down.
 */

import { ALL_REALTIME_PREFIXES, queryKeysForTopic } from '@/lib/realtime/topic-map';
import { queryKeys } from '@/lib/query/keys';
import { REALTIME_TOPICS } from '@/lib/schemas/realtime.types';

describe('queryKeysForTopic', () => {
  it('maps every canonical topic to at least one query key', () => {
    for (const topic of REALTIME_TOPICS) {
      expect(queryKeysForTopic(topic).length).toBeGreaterThan(0);
    }
  });

  it('ignores an unknown topic instead of throwing', () => {
    expect(queryKeysForTopic('somethingTheServerLearnedLater')).toEqual([]);
    expect(queryKeysForTopic('')).toEqual([]);
  });

  it('drives both queue readouts from the jobs topic', () => {
    const keys = queryKeysForTopic('jobs');
    expect(keys).toContainEqual(queryKeys.system.jobs);
    expect(keys).toContainEqual(queryKeys.system.tasksQueue);
  });

  it('narrows to one row when the event carries an id', () => {
    expect(queryKeysForTopic('chats', 'chat-1')).toEqual([
      queryKeys.chats.detail('chat-1'),
      queryKeys.chats.state('chat-1'),
      queryKeys.chats.background('chat-1'),
    ]);
  });

  it('sweeps the namespace when the event carries no id', () => {
    expect(queryKeysForTopic('chats')).toEqual([queryKeys.chats.all]);
    expect(queryKeysForTopic('characters')).toEqual([queryKeys.characters.all]);
  });

  it('scopes character events to that character', () => {
    expect(queryKeysForTopic('characters', 'char-1')).toEqual([
      queryKeys.characters.detail('char-1'),
      queryKeys.characters.prompts('char-1'),
      queryKeys.characters.photos('char-1'),
    ]);
  });
});

describe('ALL_REALTIME_PREFIXES', () => {
  it('covers every topic, so a reconnect catch-up misses nothing', () => {
    const serialized = ALL_REALTIME_PREFIXES.map((key) => JSON.stringify(key));
    for (const topic of REALTIME_TOPICS) {
      // Each topic's collection-wide keys must be reachable from a prefix in
      // the sweep list.
      const covered = queryKeysForTopic(topic).every((key) =>
        serialized.some((prefix) => JSON.stringify(key).startsWith(prefix.slice(0, -1))),
      );
      expect(covered).toBe(true);
    }
  });
});
