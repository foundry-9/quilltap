/**
 * Regression tests for EmbeddingStatusRepository.markAsEmbedded / markAsFailed
 * upsert semantics.
 *
 * The old shape was find-then-update: when no status row existed for
 * (entityType, entityId, profileId) both methods silently returned null and
 * wrote NOTHING. After the enqueue-time upsert paths were removed, no code
 * path created status rows any more, so every EMBEDDED/FAILED outcome reported
 * by the embedding-generate handler (buffered in the job child, replayed by
 * the parent applier) vanished without an error — the live symptom was 156
 * "marked failed" log lines and zero FAILED rows. Both methods must now CREATE
 * the row when it is missing and update it when it exists.
 */

jest.mock('@/lib/database/manager', () => ({
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { EmbeddingStatusRepository } from '@/lib/database/repositories/embedding-status.repository';
import type { EmbeddingStatus } from '@/lib/schemas/types';

const { getDatabaseAsync } = jest.requireMock('@/lib/database/manager') as {
  getDatabaseAsync: jest.Mock;
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHUNK_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const ROW_ID = '44444444-4444-4444-8444-444444444444';

/** Minimal in-memory stand-in for the embedding_status collection. */
function makeCollection(rows: EmbeddingStatus[]) {
  const collection = {
    findOne: jest.fn(async (filter: Partial<EmbeddingStatus>) =>
      rows.find(r =>
        Object.entries(filter).every(([k, v]) => r[k as keyof EmbeddingStatus] === v)
      ) ?? null
    ),
    insertOne: jest.fn(async (doc: EmbeddingStatus) => {
      rows.push(doc);
      return { insertedId: doc.id };
    }),
    updateOne: jest.fn(async (filter: { id: string }, update: { $set: Partial<EmbeddingStatus> }) => {
      const row = rows.find(r => r.id === filter.id);
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    }),
  };
  getDatabaseAsync.mockResolvedValue({ getCollection: () => collection });
  return collection;
}

function existingRow(status: EmbeddingStatus['status'] = 'PENDING'): EmbeddingStatus {
  return {
    id: ROW_ID,
    userId: USER_ID,
    entityType: 'CONVERSATION_CHUNK',
    entityId: CHUNK_ID,
    profileId: PROFILE_ID,
    status,
    embeddedAt: null,
    error: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('EmbeddingStatusRepository mark* upsert semantics', () => {
  let repo: EmbeddingStatusRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new EmbeddingStatusRepository();
  });

  it('markAsFailed CREATES a FAILED row when none exists (regression: silent no-op)', async () => {
    const rows: EmbeddingStatus[] = [];
    const collection = makeCollection(rows);

    const result = await repo.markAsFailed(
      'CONVERSATION_CHUNK',
      CHUNK_ID,
      PROFILE_ID,
      'maximum context length exceeded',
      USER_ID
    );

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: USER_ID,
      entityType: 'CONVERSATION_CHUNK',
      entityId: CHUNK_ID,
      profileId: PROFILE_ID,
      status: 'FAILED',
      error: 'maximum context length exceeded',
    });
    expect(result?.status).toBe('FAILED');
  });

  it('markAsEmbedded CREATES an EMBEDDED row with embeddedAt when none exists', async () => {
    const rows: EmbeddingStatus[] = [];
    const collection = makeCollection(rows);

    const result = await repo.markAsEmbedded('CONVERSATION_CHUNK', CHUNK_ID, PROFILE_ID, USER_ID);

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({
      userId: USER_ID,
      entityType: 'CONVERSATION_CHUNK',
      entityId: CHUNK_ID,
      profileId: PROFILE_ID,
      status: 'EMBEDDED',
    });
    expect(typeof rows[0].embeddedAt).toBe('string');
    expect(result?.status).toBe('EMBEDDED');
  });

  it('markAsFailed UPDATES the existing row instead of inserting a duplicate', async () => {
    const rows = [existingRow('PENDING')];
    const collection = makeCollection(rows);

    const result = await repo.markAsFailed(
      'CONVERSATION_CHUNK',
      CHUNK_ID,
      PROFILE_ID,
      'dimension mismatch',
      USER_ID
    );

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('FAILED');
    expect(rows[0].error).toBe('dimension mismatch');
    expect(result?.id).toBe(ROW_ID);
  });

  it('markAsEmbedded UPDATES the existing row and clears any prior error', async () => {
    const rows = [{ ...existingRow('FAILED'), error: 'transient outage' }];
    const collection = makeCollection(rows);

    await repo.markAsEmbedded('CONVERSATION_CHUNK', CHUNK_ID, PROFILE_ID, USER_ID);

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('EMBEDDED');
    expect(rows[0].error).toBeNull();
    expect(typeof rows[0].embeddedAt).toBe('string');
  });

  it('a row created under a DIFFERENT profile does not mask the missing-row create', async () => {
    // Friday's live failure mode: all existing rows referenced deleted
    // profileIds, so lookups scoped to the current default profile found
    // nothing and every outcome was dropped.
    const otherProfileRow = {
      ...existingRow('EMBEDDED'),
      id: '55555555-5555-4555-8555-555555555555',
      profileId: '66666666-6666-4666-8666-666666666666',
    };
    const rows = [otherProfileRow];
    const collection = makeCollection(rows);

    await repo.markAsFailed('CONVERSATION_CHUNK', CHUNK_ID, PROFILE_ID, 'oversize', USER_ID);

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
    const created = rows.find(r => r.profileId === PROFILE_ID);
    expect(created).toMatchObject({ status: 'FAILED', userId: USER_ID });
    // The other profile's row is untouched.
    expect(otherProfileRow.status).toBe('EMBEDDED');
  });
});
