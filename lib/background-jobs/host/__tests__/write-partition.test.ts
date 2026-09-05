/**
 * Unit tests for the pure write-batch partition / classification helpers.
 */

import {
  classifyWriteTarget,
  partitionWrites,
  isMainPrimaryJobType,
  rewriteFolderRefs,
  isUniqueConstraintError,
  DOC_MOUNT_FOLDER_CREATE,
} from '../write-partition';
import type { ChildWritePayload } from '../../ipc-types';

describe('classifyWriteTarget', () => {
  it('routes doc-mount repos to the mount-index database', () => {
    expect(classifyWriteTarget('docMountFolders.create')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountFiles.create')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountFileLinks.update')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountChunks.upsert')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountDocuments.delete')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountBlobs.create')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountPoints.refreshStats')).toBe('mountIndex');
    expect(classifyWriteTarget('projectDocMountLinks.create')).toBe('mountIndex');
  });

  it('routes llmLogs to the llm-logs database', () => {
    expect(classifyWriteTarget('llmLogs.cleanupOldLogs')).toBe('llmLogs');
  });

  it('routes everything else (and __finalizeFile) to the main database', () => {
    expect(classifyWriteTarget('chats.update')).toBe('main');
    expect(classifyWriteTarget('chats.addMessage')).toBe('main');
    expect(classifyWriteTarget('memories.create')).toBe('main');
    expect(classifyWriteTarget('folders.create')).toBe('main'); // main-DB project folders, NOT docMountFolders
    expect(classifyWriteTarget('folders.ensureByPath')).toBe('main');
    expect(classifyWriteTarget('files.create')).toBe('main');
    expect(classifyWriteTarget('embeddingStatus.markAsEmbedded')).toBe('main');
    expect(classifyWriteTarget('backgroundJobs.create')).toBe('main');
    expect(classifyWriteTarget('__finalizeFile')).toBe('main');
  });

  it('does not confuse a repo key that merely starts with a doc-mount prefix string', () => {
    // Only exact repo keys route to mount-index; a hypothetical 'docMounting'
    // repo would fall through to main.
    expect(classifyWriteTarget('docMounting.create')).toBe('main');
  });
});

describe('partitionWrites', () => {
  it('splits a mixed batch by target DB and preserves per-partition order', () => {
    const writes: ChildWritePayload[] = [
      { method: 'chats.addMessage', args: [{ id: 'm1' }] },
      { method: 'docMountFolders.create', args: [{ path: 'a' }, { id: 'f1' }] },
      { method: 'chats.update', args: [{ id: 'c1' }] },
      { method: 'docMountFileLinks.create', args: [{ folderId: 'f1' }] },
      { method: 'llmLogs.cleanupOldLogs', args: [30] },
      { method: '__finalizeFile', args: [{ stagingPath: 's', finalPath: 'f' }] },
    ];

    const parts = partitionWrites(writes);

    expect(parts.main.map(w => w.method)).toEqual([
      'chats.addMessage',
      'chats.update',
      '__finalizeFile',
    ]);
    expect(parts.mountIndex.map(w => w.method)).toEqual([
      'docMountFolders.create',
      'docMountFileLinks.create',
    ]);
    expect(parts.llmLogs.map(w => w.method)).toEqual(['llmLogs.cleanupOldLogs']);
  });

  it('returns empty partitions for an empty batch', () => {
    const parts = partitionWrites([]);
    expect(parts.main).toEqual([]);
    expect(parts.mountIndex).toEqual([]);
    expect(parts.llmLogs).toEqual([]);
  });
});

describe('isMainPrimaryJobType', () => {
  it('treats AUTONOMOUS_ROOM_TURN as main-primary', () => {
    expect(isMainPrimaryJobType('AUTONOMOUS_ROOM_TURN')).toBe(true);
  });

  it('treats every other job type (and undefined) as not main-primary', () => {
    expect(isMainPrimaryJobType('MEMORY_EXTRACTION')).toBe(false);
    expect(isMainPrimaryJobType('EMBEDDING_GENERATE')).toBe(false);
    expect(isMainPrimaryJobType('STORY_BACKGROUND')).toBe(false);
    expect(isMainPrimaryJobType(undefined)).toBe(false);
  });
});

describe('rewriteFolderRefs', () => {
  const remap = new Map<string, string>([['BUF', 'EXIST']]);

  it('rewrites a folderId reference that was remapped', () => {
    const write: ChildWritePayload = {
      method: 'docMountFileLinks.create',
      args: [{ mountPointId: 'MP', folderId: 'BUF', relativePath: 'foo/x.md' }, { id: 'L1' }],
    };
    const out = rewriteFolderRefs(write, remap);
    expect(out).not.toBe(write); // new object when changed
    expect((out.args[0] as Record<string, unknown>).folderId).toBe('EXIST');
    // Untouched fields and trailing args are preserved.
    expect((out.args[0] as Record<string, unknown>).relativePath).toBe('foo/x.md');
    expect(out.args[1]).toBe(write.args[1]);
  });

  it('rewrites a parentId reference that was remapped', () => {
    const write: ChildWritePayload = {
      method: 'docMountFolders.create',
      args: [{ mountPointId: 'MP', parentId: 'BUF', name: 'bar', path: 'foo/bar' }, { id: 'F2' }],
    };
    const out = rewriteFolderRefs(write, remap);
    expect((out.args[0] as Record<string, unknown>).parentId).toBe('EXIST');
  });

  it('returns the same reference when nothing matches the remap', () => {
    const write: ChildWritePayload = {
      method: 'docMountFileLinks.create',
      args: [{ mountPointId: 'MP', folderId: 'OTHER' }],
    };
    expect(rewriteFolderRefs(write, remap)).toBe(write);
  });

  it('returns the same reference for an empty remap without inspecting args', () => {
    const write: ChildWritePayload = {
      method: 'docMountFileLinks.create',
      args: [{ folderId: 'BUF' }],
    };
    expect(rewriteFolderRefs(write, new Map())).toBe(write);
  });

  it('does not mutate the original write', () => {
    const data = { mountPointId: 'MP', folderId: 'BUF' };
    const write: ChildWritePayload = { method: 'docMountFileLinks.create', args: [data] };
    rewriteFolderRefs(write, remap);
    expect(data.folderId).toBe('BUF'); // original untouched
  });
});

describe('isUniqueConstraintError', () => {
  it('matches better-sqlite3 SQLITE_CONSTRAINT_* error codes', () => {
    expect(isUniqueConstraintError(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }))).toBe(true);
    expect(isUniqueConstraintError(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' }))).toBe(true);
  });

  it('matches on the message text when no code is present', () => {
    expect(isUniqueConstraintError(new Error('UNIQUE constraint failed: doc_mount_folders.x'))).toBe(true);
  });

  it('rejects unrelated errors and non-errors', () => {
    expect(isUniqueConstraintError(new Error('disk full'))).toBe(false);
    expect(isUniqueConstraintError(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError('UNIQUE constraint failed')).toBe(false);
  });
});

describe('DOC_MOUNT_FOLDER_CREATE', () => {
  it('is the folders create dotted method', () => {
    expect(DOC_MOUNT_FOLDER_CREATE).toBe('docMountFolders.create');
  });
});
