/**
 * Unit tests for the job → topic and write-batch → topic mappings.
 */

import { topicsForCompletedJob, topicsForWriteBatch } from '@/lib/realtime/job-topics';

describe('topicsForCompletedJob', () => {
  it('announces both the room list and the chat for an autonomous turn', () => {
    expect(topicsForCompletedJob('AUTONOMOUS_ROOM_TURN', { chatId: 'chat-1' })).toEqual([
      { topic: 'autonomousRooms' },
      { topic: 'chats', id: 'chat-1' },
    ]);
  });

  it('routes a story background to whichever owner the payload names', () => {
    expect(topicsForCompletedJob('STORY_BACKGROUND_GENERATION', { chatId: 'chat-1' })).toEqual([
      { topic: 'chats', id: 'chat-1' },
    ]);
    expect(topicsForCompletedJob('STORY_BACKGROUND_GENERATION', { projectId: 'proj-1' })).toEqual([
      { topic: 'projects', id: 'proj-1' },
    ]);
    expect(topicsForCompletedJob('STORY_BACKGROUND_GENERATION', {})).toEqual([]);
  });

  it('leaves the id off when the payload does not carry one', () => {
    expect(topicsForCompletedJob('TITLE_UPDATE', {})).toEqual([{ topic: 'chats' }]);
  });

  it('returns nothing for a job type with no entity worth announcing', () => {
    expect(topicsForCompletedJob('LLM_LOG_CLEANUP', {})).toEqual([]);
    expect(topicsForCompletedJob(undefined)).toEqual([]);
  });
});

describe('topicsForWriteBatch', () => {
  it('derives the topic from the repository namespace', () => {
    expect(topicsForWriteBatch([{ method: 'chats.update', args: ['chat-1', {}] }])).toEqual([
      { topic: 'chats', id: 'chat-1' },
    ]);
  });

  it('reads an id out of an object-shaped payload', () => {
    expect(
      topicsForWriteBatch([{ method: 'docMountFiles.create', args: [{ mountPointId: 'mp-1' }] }]),
    ).toEqual([{ topic: 'mountPoints', id: 'mp-1' }]);
  });

  it('falls back to a collection-wide hint when no id is readable', () => {
    expect(topicsForWriteBatch([{ method: 'characters.updateMany', args: [42] }])).toEqual([
      { topic: 'characters' },
    ]);
  });

  it('deduplicates a batch that touches one row many times', () => {
    const writes = Array.from({ length: 200 }, () => ({
      method: 'chats.update',
      args: ['chat-1', {}],
    }));
    expect(topicsForWriteBatch(writes)).toEqual([{ topic: 'chats', id: 'chat-1' }]);
  });

  it('skips repository namespaces with no client-visible topic', () => {
    expect(topicsForWriteBatch([{ method: 'llmLogs.create', args: [{}] }])).toEqual([]);
  });
});
