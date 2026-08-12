/**
 * Unit tests for the conversation-summary vault bridge's archived guard.
 *
 * `Conversation Summaries/` is part of what archiving prunes out of a
 * character's vault, so the write path must skip archived participants —
 * writing would silently resurrect the folder outside the bundle
 * (character-archive spec §4.6). The removal path stays unguarded: deleting
 * from a pruned vault is a natural no-op.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...noop, child: () => noop } };
});

const mockFindByIdRaw = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    characters: { findByIdRaw: (...args: unknown[]) => mockFindByIdRaw(...args) },
  }),
}));

const mockGetCharacterVaultStore = jest.fn();
jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: (...args: unknown[]) => mockGetCharacterVaultStore(...args),
}));

const mockEnsureFolderPath = jest.fn();
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (...args: unknown[]) => mockEnsureFolderPath(...args),
}));

const mockWriteDatabaseDocument = jest.fn();
const mockDeleteDatabaseDocument = jest.fn();
const mockListDatabaseFiles = jest.fn();
const mockReadDatabaseDocument = jest.fn();
const mockDatabaseDocumentExists = jest.fn();
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: (...args: unknown[]) => mockWriteDatabaseDocument(...args),
  deleteDatabaseDocument: (...args: unknown[]) => mockDeleteDatabaseDocument(...args),
  listDatabaseFiles: (...args: unknown[]) => mockListDatabaseFiles(...args),
  readDatabaseDocument: (...args: unknown[]) => mockReadDatabaseDocument(...args),
  databaseDocumentExists: (...args: unknown[]) => mockDatabaseDocumentExists(...args),
}));

import { writeConversationSummaryToVaults } from '@/lib/file-storage/conversation-summary-vault-bridge';

const LIVE = 'a0000000-0000-4000-8000-000000000001';
const ARCHIVED = 'a0000000-0000-4000-8000-000000000002';

const input = {
  chatId: 'chat-1',
  chatTitle: 'A Quiet Evening',
  summary: 'They talked.',
  summaryGeneration: 1,
  participantCharacterIds: [LIVE, ARCHIVED],
  messageCount: 4,
  firstMessageAt: '2026-08-01T00:00:00.000Z',
  lastMessageAt: '2026-08-01T01:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
};

describe('writeConversationSummaryToVaults archived guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.QUILLTAP_JOB_CHILD;
    mockFindByIdRaw.mockImplementation((id: string) =>
      Promise.resolve(
        id === ARCHIVED
          ? { id, name: 'Ghost', archivedAt: '2026-08-05T00:00:00.000Z' }
          : { id, name: 'Bertie', archivedAt: null },
      ),
    );
    mockGetCharacterVaultStore.mockImplementation((id: string) =>
      Promise.resolve({ mountPointId: `mount-${id}`, mountPointName: `vault-${id}` }),
    );
    mockEnsureFolderPath.mockResolvedValue(undefined);
    mockListDatabaseFiles.mockResolvedValue([]);
    mockDatabaseDocumentExists.mockResolvedValue(false);
    mockWriteDatabaseDocument.mockResolvedValue(undefined);
  });

  it('writes into live vaults and skips archived participants entirely', async () => {
    await writeConversationSummaryToVaults(input);

    // The live participant got the full write path.
    expect(mockWriteDatabaseDocument).toHaveBeenCalledTimes(1);
    expect(mockWriteDatabaseDocument.mock.calls[0][0]).toBe(`mount-${LIVE}`);

    // The archived participant's vault was never resolved, its Summaries
    // folder never (re)created, and nothing was written to it.
    expect(mockGetCharacterVaultStore).not.toHaveBeenCalledWith(ARCHIVED);
    expect(mockEnsureFolderPath).toHaveBeenCalledTimes(1);
    expect(mockEnsureFolderPath.mock.calls[0][0]).toBe(`mount-${LIVE}`);
  });

  it('writes to every vault when nobody is archived', async () => {
    mockFindByIdRaw.mockImplementation((id: string) =>
      Promise.resolve({ id, name: 'Someone', archivedAt: null }),
    );
    await writeConversationSummaryToVaults(input);
    expect(mockWriteDatabaseDocument).toHaveBeenCalledTimes(2);
  });
});
