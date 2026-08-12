/**
 * Tests for the child-side repository proxy.
 *
 * Covers the three things that broke production hardest during the
 * background-jobs child-process migration:
 *   1. method classification (read vs write vs unknown)
 *   2. synthetic-ID injection into args[1] (CreateOptions) so the parent's
 *      real `_create()` uses the same ID the caller saw
 *   3. AsyncLocalStorage-backed per-job pending-writes buffer
 *
 * These tests don't need a database — they exercise the proxy against
 * plain-object stand-ins for the repository classes.
 */

// Stub the database getter so importing the proxy doesn't try to spin up
// a real backend during module evaluation.
jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

import { getRepositories as mockedGetRepositories } from '@/lib/database/repositories';
import { logger } from '@/lib/logger';
import {
  runWithJobScope,
  flushPendingWrites,
  getChildRepositoriesProxy,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy';

const mockedFactory = mockedGetRepositories as jest.MockedFunction<typeof mockedGetRepositories>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
});

function makeFakeRepos() {
  // Each "repo" is just a plain object with read+write methods. The proxy
  // wraps these and intercepts based on method-name classification.
  return {
    memories: {
      findById: jest.fn().mockResolvedValue({ id: 'm-existing', content: 'old' }),
      create: jest.fn().mockResolvedValue({ id: 'real-create-id', content: 'real' }),
      update: jest.fn().mockResolvedValue({ id: 'real-update-id' }),
      updateForCharacter: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(true),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({ id: 'c-1' }),
      getMessages: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'c-1' }),
      updateMessage: jest.fn().mockResolvedValue(undefined),
    },
    embeddingStatus: {
      markAsEmbedded: jest.fn().mockResolvedValue(undefined),
      markAsFailed: jest.fn().mockResolvedValue(undefined),
    },
    backgroundJobs: {
      // Forbidden — should throw when called inside the child.
      claimNextJob: jest.fn().mockResolvedValue(null),
    },
    vectorIndices: {
      findEntriesByCharacterId: jest.fn().mockResolvedValue([]),
      addEntries: jest.fn().mockResolvedValue(undefined),
      entryExists: jest.fn().mockResolvedValue(false),
      saveMeta: jest.fn().mockResolvedValue(undefined),
    },
    // Fronts two tables: connection_profiles and api_keys. See
    // TABLE_GROUP_RESOLVERS in the proxy.
    connections: {
      findById: jest.fn().mockResolvedValue({ id: 'p-1' }),
      incrementTokenUsage: jest.fn().mockResolvedValue(undefined),
      findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ id: 'k-1', key: 'sk-x' }),
      findApiKeyById: jest.fn().mockResolvedValue({ id: 'k-1', key: 'sk-x' }),
      updateApiKey: jest.fn().mockResolvedValue(null),
    },
  };
}

describe('child repository proxy — read/write classification', () => {
  it('passes read methods through to the underlying repo', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);

    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-1', async () => {
      const result = await (proxied.memories as unknown as typeof repos.memories).findById('m-existing');
      expect(result).toEqual({ id: 'm-existing', content: 'old' });
      expect(repos.memories.findById).toHaveBeenCalledWith('m-existing');
      return flushPendingWrites();
    });

    expect(writes).toEqual([]); // reads don't buffer
  });

  it('throws on unknown methods so unclassified calls surface loudly', async () => {
    const repos = {
      ...makeFakeRepos(),
      // A method whose name matches neither read nor write prefixes.
      memories: { ...makeFakeRepos().memories, weirdMethod: jest.fn() },
    };
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-2', async () => {
      const fn = (proxied.memories as unknown as { weirdMethod: () => void }).weirdMethod;
      expect(() => fn()).toThrow(/not classified for child execution/);
    });
  });

  it('throws on forbidden methods (backgroundJobs.claimNextJob)', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-3', async () => {
      const fn = (proxied.backgroundJobs as unknown as typeof repos.backgroundJobs).claimNextJob;
      expect(() => fn()).toThrow(/not classified for child execution/);
    });
  });
});

describe('child repository proxy — synthetic-ID injection', () => {
  it('injects a generated UUID into args[1].id for create()', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const { writes, returnedId } = await runWithJobScope('job-create', async () => {
      const result = await (proxied.memories as unknown as typeof repos.memories).create({
        characterId: 'char-1',
        content: 'hello',
      } as never);
      return { writes: flushPendingWrites(), returnedId: (result as { id: string }).id };
    });

    expect(returnedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('memories.create');
    // args[1] should be the CreateOptions slot, populated with the same id.
    expect(writes[0].args[1]).toEqual(expect.objectContaining({ id: returnedId }));
  });

  it('preserves a user-supplied id in CreateOptions', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-preserve', async () => {
      const result = await (proxied.memories as unknown as typeof repos.memories).create(
        { content: 'x' } as never,
        { id: 'caller-supplied-id' } as never,
      );
      expect((result as { id: string }).id).toBe('caller-supplied-id');
      return flushPendingWrites();
    });

    expect(writes[0].args[1]).toEqual(expect.objectContaining({ id: 'caller-supplied-id' }));
  });

  it('chains create-then-update with matching ids inside one job', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-chain', async () => {
      const created = await (proxied.memories as unknown as typeof repos.memories).create(
        { characterId: 'char-1', content: 'a' } as never,
      );
      const newId = (created as { id: string }).id;

      // Caller uses the synthetic id immediately — same pattern as
      // memory-service.ts: `await repos.memories.updateForCharacter(charId, m.id, ...)`
      await (proxied.memories as unknown as typeof repos.memories).updateForCharacter(
        'char-1',
        newId,
        { embedding: new Float32Array([1, 2, 3]) } as never,
      );
      return flushPendingWrites();
    });

    expect(writes).toHaveLength(2);
    expect(writes[0].method).toBe('memories.create');
    expect(writes[1].method).toBe('memories.updateForCharacter');
    // The update's memoryId argument should be the same UUID we generated for
    // the create. This is the failure mode that produced "Memory not found
    // for update" warnings in production before the args[1] fix.
    const createId = (writes[0].args[1] as { id: string }).id;
    // updateForCharacter signature: (characterId, memoryId, data) — memoryId is args[1]
    const updateMemoryId = writes[1].args[1] as string;
    expect(updateMemoryId).toBe(createId);
  });
});

describe('child repository proxy — pending-writes buffer', () => {
  it('isolates pending writes per job scope (concurrent jobs do not cross-contaminate)', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    // Run two job scopes concurrently. Each appends one write; neither
    // should see the other's buffer.
    const job1 = runWithJobScope('job-A', async () => {
      await (proxied.memories as unknown as typeof repos.memories).create(
        { content: 'A' } as never,
      );
      // small delay to interleave with job B
      await new Promise<void>(r => setTimeout(r, 5));
      return flushPendingWrites();
    });

    const job2 = runWithJobScope('job-B', async () => {
      await (proxied.memories as unknown as typeof repos.memories).create(
        { content: 'B' } as never,
      );
      await new Promise<void>(r => setTimeout(r, 5));
      return flushPendingWrites();
    });

    const [w1, w2] = await Promise.all([job1, job2]);
    expect(w1).toHaveLength(1);
    expect(w2).toHaveLength(1);
    // Each batch sees only its own create — the data field disambiguates
    // which scope's write each one is.
    expect((w1[0].args[0] as { content: string }).content).toBe('A');
    expect((w2[0].args[0] as { content: string }).content).toBe('B');
  });

  it('buffers writes for repository methods that match write prefixes by camelCase', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-prefixes', async () => {
      // markAsEmbedded — explicit override
      await (proxied.embeddingStatus as unknown as typeof repos.embeddingStatus).markAsEmbedded('m-1' as never);
      // updateMessage — explicit override (chats.updateMessage doesn't match `update*` prefix in the way the override flags it)
      await (proxied.chats as unknown as typeof repos.chats).updateMessage('msg-1' as never, 'patch' as never);
      // delete — generic prefix match
      await (proxied.memories as unknown as typeof repos.memories).delete('m-1' as never);
      return flushPendingWrites();
    });

    expect(writes.map(w => w.method)).toEqual([
      'embeddingStatus.markAsEmbedded',
      'chats.updateMessage',
      'memories.delete',
    ]);
  });
});

describe('child repository proxy — Float32Array IPC sanitization', () => {
  function makeReposWithEmbeddingWrites() {
    return {
      ...makeFakeRepos(),
      helpDocs: {
        findById: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        updateEmbedding: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('down-converts a top-level Float32Array arg to a plain number[]', async () => {
    const repos = makeReposWithEmbeddingWrites();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-f32-top', async () => {
      await (proxied.helpDocs as unknown as typeof repos.helpDocs).updateEmbedding(
        'doc-1' as never,
        new Float32Array([0.5, 0.25, 0.125]) as never,
      );
      return flushPendingWrites();
    });

    expect(writes).toHaveLength(1);
    const embeddingArg = writes[0].args[1];
    expect(embeddingArg).toBeInstanceOf(Array);
    expect(embeddingArg).not.toBeInstanceOf(Float32Array);
    // Float32 rounds the literals; assert closeness rather than exact equality.
    expect(embeddingArg as number[]).toHaveLength(3);
    expect((embeddingArg as number[])[0]).toBeCloseTo(0.5, 5);
    expect((embeddingArg as number[])[2]).toBeCloseTo(0.125, 5);
  });

  it('down-converts a Float32Array nested inside an object arg', async () => {
    const repos = makeReposWithEmbeddingWrites();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-f32-nested', async () => {
      await (proxied.memories as unknown as typeof repos.memories).create({
        characterId: 'char-1',
        content: 'hello',
        embedding: new Float32Array([1, 2, 3, 4]),
      } as never);
      return flushPendingWrites();
    });

    const data = writes[0].args[0] as { embedding: unknown };
    expect(data.embedding).toBeInstanceOf(Array);
    expect(data.embedding).not.toBeInstanceOf(Float32Array);
    expect(data.embedding as number[]).toEqual([1, 2, 3, 4]);
  });

  it('does not mutate the caller\'s in-memory Float32Array', async () => {
    const repos = makeReposWithEmbeddingWrites();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const original = new Float32Array([1, 2, 3]);
    await runWithJobScope('job-f32-nomutate', async () => {
      await (proxied.helpDocs as unknown as typeof repos.helpDocs).updateEmbedding(
        'doc-1' as never,
        original as never,
      );
      flushPendingWrites();
    });

    // The caller's reference is untouched — still a Float32Array.
    expect(original).toBeInstanceOf(Float32Array);
    expect(Array.from(original)).toEqual([1, 2, 3]);
  });

  it('leaves Buffers intact and does not copy embedding-free args', async () => {
    const repos = makeReposWithEmbeddingWrites();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const blob = Buffer.from([1, 2, 3, 4]);
    const plainArg = { content: 'x', blob };
    const numberArg = [0.1, 0.2, 0.3];

    const writes = await runWithJobScope('job-buffer', async () => {
      // helpDocs.updateEmbedding with a Buffer + a plain number[] arg.
      await (proxied.helpDocs as unknown as typeof repos.helpDocs).updateEmbedding(
        plainArg as never,
        numberArg as never,
      );
      return flushPendingWrites();
    });

    // Buffer preserved inside the object…
    const arg0 = writes[0].args[0] as { blob: unknown };
    expect(Buffer.isBuffer(arg0.blob)).toBe(true);
    // …and embedding-free args are passed by reference (no needless copy).
    expect(writes[0].args[0]).toBe(plainArg);
    expect(writes[0].args[1]).toBe(numberArg);
  });
});

describe('child repository proxy — read-your-writes detector', () => {
  const warn = logger.warn as jest.Mock;

  function readYourWritesWarnings(): Array<Record<string, unknown>> {
    return warn.mock.calls
      .filter(([message]) => typeof message === 'string' && message.includes('read-your-writes'))
      .map(([, context]) => context as Record<string, unknown>);
  }

  it('stays quiet when the read hits a different table on the same repository', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    // The AUTONOMOUS_ROOM_TURN pattern: the turn's LLM call bumps the profile's
    // token counters (connection_profiles), then a later call in the same job
    // re-resolves an API key (api_keys). Two tables — no staleness possible.
    await runWithJobScope('job-rww-crosstable', async () => {
      await (proxied.connections as unknown as typeof repos.connections).incrementTokenUsage(
        'p-1' as never, 100 as never, 50 as never,
      );
      const key = await (proxied.connections as unknown as typeof repos.connections)
        .findApiKeyByIdAndUserId('k-1' as never, 'u-1' as never);
      expect(key).toEqual({ id: 'k-1', key: 'sk-x' });
      flushPendingWrites();
    });

    expect(readYourWritesWarnings()).toEqual([]);
  });

  it('warns when the read hits the same table as a buffered write', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-rww-profiles', async () => {
      await (proxied.connections as unknown as typeof repos.connections).incrementTokenUsage(
        'p-1' as never, 100 as never, 50 as never,
      );
      await (proxied.connections as unknown as typeof repos.connections).findById('p-1' as never);
      flushPendingWrites();
    });

    const warnings = readYourWritesWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(expect.objectContaining({
      jobId: 'job-rww-profiles',
      readMethod: 'connections.findById',
      table: 'connections.connection_profiles',
    }));
  });

  it('still warns within the api_keys table — the split does not blind the detector', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-rww-apikeys', async () => {
      await (proxied.connections as unknown as typeof repos.connections).updateApiKey(
        'k-1' as never, { lastUsedAt: 'now' } as never,
      );
      await (proxied.connections as unknown as typeof repos.connections).findApiKeyById('k-1' as never);
      flushPendingWrites();
    });

    const warnings = readYourWritesWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(expect.objectContaining({
      readMethod: 'connections.findApiKeyById',
      table: 'connections.api_keys',
    }));
  });

  it('treats a repository with no resolver as a single table (unchanged behaviour)', async () => {
    const repos = makeFakeRepos();
    mockedFactory.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-rww-unmapped', async () => {
      await (proxied.memories as unknown as typeof repos.memories).create({ content: 'x' } as never);
      await (proxied.memories as unknown as typeof repos.memories).findById('m-existing');
      // Dedup is per (jobId, readMethod): a second identical read stays quiet.
      await (proxied.memories as unknown as typeof repos.memories).findById('m-existing');
      flushPendingWrites();
    });

    const warnings = readYourWritesWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(expect.objectContaining({
      readMethod: 'memories.findById',
      table: 'memories',
    }));
  });
});
