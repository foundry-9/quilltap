/**
 * @jest-environment node
 *
 * Compact backup: opt-in, and it must actually leave the weight behind.
 *
 * Search indexes are the overwhelming majority of a well-used archive. A
 * compact backup nulls memory embeddings and omits every derived embedding
 * collection outright — writing empty files instead would be pointless, since
 * the whole purpose is archive size, and the restore reader treats all of
 * those files as optional anyway.
 *
 * Full fidelity stays the default: a backup restores the *same* instance,
 * where the vectors are still valid on arrival, and re-embedding costs real
 * money and time exactly when the user is recovering from something.
 *
 * The test drives the real `createBackup` and intercepts the shell `zip`
 * call, reading the staging directory at that moment — which is the only
 * point where the archive's contents exist on disk before cleanup.
 */

import fs from 'fs';
import path from 'path';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn() },
}));

jest.mock('@/lib/paths', () => ({
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-compact-test-absent-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-compact-test-absent-themes'),
}));

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(() => null),
}));
jest.mock('@/lib/database/backends/sqlite/protection', () => ({
  runBackupCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  getRawLLMLogsDatabase: jest.fn(() => null),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-protection', () => ({
  runLLMLogsBackupCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(() => null),
  isMountIndexDegraded: jest.fn(() => true),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-protection', () => ({
  runMountIndexBackupCheckpoint: jest.fn(),
}));

// Stand in for the shell `zip`, capturing what was staged before cleanup and
// leaving a file behind so the caller's `fs.stat` succeeds.
const stagedFilesByRun: string[][] = [];
const stagedMemoriesByRun: unknown[][] = [];
jest.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    opts: { cwd: string },
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
  ) => {
    // args are ['-r', <zipPath>, <folderName>]
    const [, zipPath, folderName] = args;
    const dataDir = path.join(opts.cwd, folderName, 'data');
    stagedFilesByRun.push(fs.existsSync(dataDir) ? fs.readdirSync(dataDir).sort() : []);
    const memoriesPath = path.join(dataDir, 'memories.json');
    stagedMemoriesByRun.push(
      fs.existsSync(memoriesPath) ? JSON.parse(fs.readFileSync(memoriesPath, 'utf8')) : []
    );
    fs.writeFileSync(zipPath, 'not really a zip');
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { createBackup } from '@/lib/backup/backup-service';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * A repository-container stand-in: any repository you touch exists, and any
 * method on it resolves to []. `createBackup` reaches into a long tail of
 * repositories that have nothing to do with this test; naming them all would
 * bury the two things being asserted.
 */
function methodStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue([]));
      return cache.get(prop);
    },
  });
}

function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (!cache.has(prop)) cache.set(prop, methodStub());
      return cache.get(prop);
    },
  });
}

const DERIVED_EMBEDDING_FILES = [
  'conversation-chunks.json',
  'vector-entries.json',
  'vector-index-metas.json',
  'tfidf-vocabularies.json',
  'embedding-status.json',
  'doc-mount-chunks.json',
];

describe('createBackup — compact mode', () => {
  const testUserId = 'user-compact';

  const memoryWithVector = {
    id: 'mem-1',
    characterId: 'char-1',
    content: 'A memory worth keeping',
    summary: 'kept',
    embedding: new Float32Array([0.1, 0.2, 0.3]),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    stagedFilesByRun.length = 0;
    stagedMemoriesByRun.length = 0;

    const userRepos = repoStub({
      characters: methodStub({ findAll: jest.fn().mockResolvedValue([{ id: 'char-1', name: 'Wexford' }]) }),
      memories: methodStub({ findByCharacterId: jest.fn().mockResolvedValue([memoryWithVector]) }),
      llmLogs: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
    });
    const globalRepos = repoStub({
      chatSettings: methodStub({ findByUserId: jest.fn().mockResolvedValue(null) }),
      vectorIndices: methodStub({
        getAllCharacterIds: jest.fn().mockResolvedValue([]),
        findMetaByCharacterId: jest.fn().mockResolvedValue(null),
        findEntriesByCharacterId: jest.fn().mockResolvedValue([]),
      }),
      textReplacementRules: methodStub({ list: jest.fn().mockResolvedValue([]) }),
    });

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
  });

  async function runBackup(options?: { compact?: boolean }) {
    const { zipPath, manifest } = await createBackup(testUserId, options);
    const staged = stagedFilesByRun[stagedFilesByRun.length - 1];
    const memories = stagedMemoriesByRun[stagedMemoriesByRun.length - 1] as Array<
      Record<string, unknown>
    >;
    await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true });
    return { manifest, staged, memories };
  }

  it('writes every derived embedding collection by default', async () => {
    const { manifest, staged } = await runBackup();

    expect(manifest.compact).toBeUndefined();
    for (const file of DERIVED_EMBEDDING_FILES) {
      expect(staged).toContain(file);
    }
  });

  it('omits the derived embedding collections entirely when compact', async () => {
    const { manifest, staged } = await runBackup({ compact: true });

    expect(manifest.compact).toBe(true);
    for (const file of DERIVED_EMBEDDING_FILES) {
      expect(staged).not.toContain(file);
    }
    // Everything the user actually wrote is still there.
    expect(staged).toContain('memories.json');
    expect(staged).toContain('characters.json');
    expect(staged).toContain('chats.json');
    expect(staged).toContain('files.json');
  });

  it('keeps memory content but nulls the embedding when compact', async () => {
    const { manifest, memories } = await runBackup({ compact: true });

    // The memory travels in full — only its vector is dropped.
    expect(manifest.counts.memories).toBe(1);
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe('A memory worth keeping');
    expect(memories[0].embedding).toBeNull();
  });

  it('keeps the embedding in a full backup', async () => {
    const { memories } = await runBackup();

    expect(memories).toHaveLength(1);
    expect(memories[0].embedding).not.toBeNull();
  });
});
