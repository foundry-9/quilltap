/**
 * Bug 10 — `conversation_annotations` must be cleared by the delete-all /
 * replace-mode path. In v4 it was on no delete path, so "delete all my data"
 * left annotation rows behind (a privacy leak) and a restore into a migrated
 * instance hit `UNIQUE constraint failed: conversation_annotations`.
 *
 * We drive `deleteUserData` with empty repos and assert the bulk truncate
 * includes the table.
 */

jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});

const rawQuery = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/database/manager', () => ({ rawQuery: (...a: unknown[]) => rawQuery(...a) }));

// Keep the mount-index branch of clearFormat3Entities a no-op — the table under
// test lives in the main DB and is cleared via rawQuery before that branch.
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(() => null),
  isMountIndexDegraded: jest.fn(() => true),
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { deleteFile: jest.fn() },
}));

const emptyUserRepos = {
  characters: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  chats: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  tags: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  files: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  connections: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  imageProfiles: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  projects: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  groups: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  llmLogs: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  memories: { findByCharacterId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
};
const globalRepos = {
  promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  chatSettings: { findByUserId: jest.fn().mockResolvedValue(null), delete: jest.fn() },
  folders: { findByUserId: jest.fn().mockResolvedValue([]), delete: jest.fn() },
  wardrobe: { findAll: jest.fn().mockResolvedValue([]), delete: jest.fn() },
};

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(() => emptyUserRepos),
}));
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => globalRepos),
}));

import { deleteUserData } from '../delete-service';

it('truncates conversation_annotations on a replace-mode / delete-all clear', async () => {
  await deleteUserData('user-1');

  const truncated = rawQuery.mock.calls.map((c) => c[0] as string);
  expect(truncated).toContain('DELETE FROM "conversation_annotations"');
});
