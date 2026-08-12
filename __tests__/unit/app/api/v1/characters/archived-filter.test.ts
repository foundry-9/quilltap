/**
 * Archived-character surface guards (character-archive spec §5.1–§5.2).
 *
 * - GET /api/v1/characters: `archived=exclude(default)|include|only` is the
 *   single chokepoint every picker relies on — the default must hide
 *   tombstones, and rows must carry `archivedAt` for badges.
 * - Project roster / group membership: adding an archived character refuses;
 *   nothing here ever removes existing edges.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api/middleware', () => ({
  enrichWithDefaultImage: jest.fn().mockResolvedValue(null),
  exists: (entity: unknown) => entity != null,
}));

import { handleGet } from '@/app/api/v1/characters/handlers/get';
import { handleAddCharacter } from '@/app/api/v1/projects/[id]/actions/roster';
import type { RequestContext } from '@/lib/api/middleware';

const LIVE = {
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'Bertie',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  tags: [],
  systemPrompts: [],
  scenarios: [],
};
const ARCHIVED = {
  id: 'a0000000-0000-4000-8000-000000000002',
  name: 'Ghost',
  archivedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-02-01T00:00:00.000Z',
  tags: [],
  systemPrompts: [],
  scenarios: [],
};

function listCtx(): RequestContext {
  return {
    user: { id: 'user-1' },
    repos: {
      characters: {
        findByUserId: jest.fn().mockResolvedValue([LIVE, ARCHIVED]),
        findById: jest.fn().mockResolvedValue(null),
      },
      chats: { findByCharacterId: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as RequestContext;
}

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/characters${query}`);
}

describe('GET /api/v1/characters archived filter', () => {
  it('excludes archived characters by default', async () => {
    const res = await handleGet(listRequest(), listCtx());
    const body = await res.json();
    expect(body.characters.map((c: { id: string }) => c.id)).toEqual([LIVE.id]);
    expect(body.count).toBe(1);
  });

  it('archived=include returns both, rows carrying archivedAt', async () => {
    const res = await handleGet(listRequest('?archived=include'), listCtx());
    const body = await res.json();
    expect(body.count).toBe(2);
    const byId = Object.fromEntries(body.characters.map((c: { id: string; archivedAt: string | null }) => [c.id, c.archivedAt]));
    expect(byId[LIVE.id]).toBeNull();
    expect(byId[ARCHIVED.id]).toBe(ARCHIVED.archivedAt);
  });

  it('archived=only returns tombstones alone', async () => {
    const res = await handleGet(listRequest('?archived=only'), listCtx());
    const body = await res.json();
    expect(body.characters.map((c: { id: string }) => c.id)).toEqual([ARCHIVED.id]);
  });
});

describe('project roster add-guard', () => {
  let projectUpdate: jest.Mock;

  function rosterCtx(character: unknown): RequestContext {
    projectUpdate = jest.fn();
    return {
      user: { id: 'user-1' },
      repos: {
        projects: {
          findById: jest.fn().mockResolvedValue({ id: 'proj-1', characterRoster: [] }),
          update: projectUpdate,
        },
        characters: { findById: jest.fn().mockResolvedValue(character) },
      },
    } as unknown as RequestContext;
  }

  function addRequest(characterId: string): NextRequest {
    return new NextRequest('http://localhost:3000/api/v1/projects/proj-1?action=add-character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId }),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to add an archived character and writes nothing', async () => {
    const res = await handleAddCharacter(addRequest(ARCHIVED.id), 'proj-1', rosterCtx(ARCHIVED));
    expect(res.status).toBe(400);
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it('still adds a live character', async () => {
    const res = await handleAddCharacter(addRequest(LIVE.id), 'proj-1', rosterCtx(LIVE));
    expect(res.status).toBe(200);
    expect(projectUpdate).toHaveBeenCalledWith('proj-1', { characterRoster: [LIVE.id] });
  });
});
