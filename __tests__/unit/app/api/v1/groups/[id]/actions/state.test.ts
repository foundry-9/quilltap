/**
 * Tests for the group state action handlers
 * (get-state / set-state / reset-state on /api/v1/groups/[id]).
 *
 * Groups are instance-global: state mutations use an existence-only check (the
 * chat pattern), and `handleGetState` returns the group's own state with no
 * parent tier.
 */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/api/middleware', () => ({
  exists: (entity: unknown) => !!entity,
}));

import { handleGetState, handleSetState, handleResetState } from '@/app/api/v1/groups/[id]/actions/state';

function makeCtx(group: Record<string, unknown> | null) {
  const update = jest.fn(async (_id: string, data: { state: Record<string, unknown> }) => ({
    ...(group ?? {}),
    state: data.state,
  }));
  const ctx = {
    user: { id: 'user-1' },
    repos: {
      groups: {
        findById: jest.fn(async () => group),
        update,
      },
    },
  } as never;
  return { ctx, update };
}

function req(body?: unknown) {
  return { json: async () => body } as never;
}

describe('group handleGetState', () => {
  it('returns the group state', async () => {
    const { ctx } = makeCtx({ id: 'g1', name: 'Alpha', state: { score: 3 } });
    const res = await handleGetState('g1', ctx);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.state).toEqual({ score: 3 });
  });

  it('defaults missing state to {}', async () => {
    const { ctx } = makeCtx({ id: 'g1', name: 'Alpha' });
    const res = await handleGetState('g1', ctx);
    const body = await res.json();
    expect(body.state).toEqual({});
  });

  it('404 when the group is missing', async () => {
    const { ctx } = makeCtx(null);
    const res = await handleGetState('g1', ctx);
    expect(res.status).toBe(404);
  });
});

describe('group handleSetState', () => {
  it('replaces state (existence-only check)', async () => {
    const { ctx, update } = makeCtx({ id: 'g1', name: 'Alpha', state: {} });
    const res = await handleSetState(req({ state: { score: 9 } }), 'g1', ctx);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(update).toHaveBeenCalledWith('g1', { state: { score: 9 } });
  });

  it('404 when the group is missing', async () => {
    const { ctx } = makeCtx(null);
    const res = await handleSetState(req({ state: {} }), 'g1', ctx);
    expect(res.status).toBe(404);
  });
});

describe('group handleResetState', () => {
  it('clears state and returns the previous value', async () => {
    const { ctx, update } = makeCtx({ id: 'g1', name: 'Alpha', state: { score: 9 } });
    const res = await handleResetState('g1', ctx);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.previousState).toEqual({ score: 9 });
    expect(update).toHaveBeenCalledWith('g1', { state: {} });
  });
});
