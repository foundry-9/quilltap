/**
 * Custom tools — the side-effect applier: tier resolution ("write where it
 * lives", chat default, ambiguous-group shadowing), one batched write per
 * touched store, the apply-time underscore guard, metadata read-modify-write,
 * the no-character and no-cascade skips, and per-store fail-soft.
 */

import { applyCustomToolEffects } from '@/lib/pascal/side-effects'
import type { ResolvedEffect } from '@/lib/pascal/custom-tools'
import type { StateCascadeResult } from '@/lib/state/state-cascade'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/mount-index/general-state', () => ({
  writeGeneralState: jest.fn(),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { writeGeneralState } from '@/lib/mount-index/general-state'

const mockGetRepositories = getRepositories as jest.Mock
const mockWriteGeneralState = writeGeneralState as jest.Mock

function repos() {
  return {
    chats: { update: jest.fn() },
    projects: { update: jest.fn() },
    groups: { update: jest.fn() },
    characters: { update: jest.fn() },
  }
}

let db: ReturnType<typeof repos>

beforeEach(() => {
  jest.clearAllMocks()
  db = repos()
  mockGetRepositories.mockReturnValue(db)
})

function cascade(overrides: Partial<StateCascadeResult> = {}): StateCascadeResult {
  return {
    chatState: {},
    projectState: {},
    groupState: {},
    generalState: {},
    merged: {},
    groupTier: { status: 'none', candidates: [] },
    ...overrides,
  }
}

/** Shorthand for an applicable state-target resolution. */
function stateEffect(index: number, path: Array<string | number>, value: number | string | boolean): ResolvedEffect {
  return { index, target: { kind: 'state', path, raw: `state.${path.join('.')}` }, value }
}

function metadataEffect(index: number, key: string, value: number | string | boolean): ResolvedEffect {
  return { index, target: { kind: 'metadata', key, raw: `metadata.${key}` }, value }
}

function apply(
  effects: ResolvedEffect[],
  overrides: Partial<Parameters<typeof applyCustomToolEffects>[0]> = {},
) {
  return applyCustomToolEffects({
    chatId: 'chat-1',
    toolName: 'unlock',
    effects,
    cascade: cascade(),
    characterId: 'char-1',
    metadataSnapshot: {},
    ...overrides,
  })
}

describe('tier resolution — write where it lives', () => {
  it('writes a key already at the chat tier back to the chat', async () => {
    const applied = await apply([stateEffect(0, ['encounter', 'count'], 3)], {
      cascade: cascade({ chatState: { encounter: { count: 1 } } }),
    })
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { encounter: { count: 3 } } })
    expect(applied).toEqual([{ target: 'state.encounter.count', previous: 1, next: 3, tier: 'chat' }])
  })

  it('writes a key living at the project tier to the project', async () => {
    await apply([stateEffect(0, ['campaign', 'act'], 2)], {
      cascade: cascade({ projectId: 'proj-1', projectState: { campaign: { act: 1 } } }),
    })
    expect(db.projects.update).toHaveBeenCalledWith('proj-1', { state: { campaign: { act: 2 } } })
    expect(db.chats.update).not.toHaveBeenCalled()
  })

  it('writes a key living at the group tier to the single applicable group', async () => {
    await apply([stateEffect(0, ['fleet'], 'scattered')], {
      cascade: cascade({
        groupState: { fleet: 'massed' },
        groupTier: { status: 'single', candidates: [{ id: 'grp-1', name: 'Armada' }], appliedGroupId: 'grp-1' },
      }),
    })
    expect(db.groups.update).toHaveBeenCalledWith('grp-1', { state: { fleet: 'scattered' } })
  })

  it('writes a key living at the general tier to general state', async () => {
    await apply([stateEffect(0, ['weather'], 'rain')], {
      cascade: cascade({ generalState: { weather: 'fog' } }),
    })
    expect(mockWriteGeneralState).toHaveBeenCalledWith({ weather: 'rain' })
    expect(db.chats.update).not.toHaveBeenCalled()
  })

  it('defaults a key found nowhere to the chat tier', async () => {
    const applied = await apply([stateEffect(0, ['fresh'], true)])
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { fresh: true } })
    expect(applied[0].tier).toBe('chat')
  })

  it('never searches the project tier without a projectId', async () => {
    await apply([stateEffect(0, ['campaign'], 2)], {
      cascade: cascade({ projectState: { campaign: 1 } }),
    })
    expect(db.projects.update).not.toHaveBeenCalled()
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { campaign: 2 } })
  })

  it('shadows a group-only key at the chat tier when groups are ambiguous', async () => {
    // The exactly-one rule: with 2+ applicable groups the cascade's group tier
    // contributed nothing, so the key is invisible here — consistent with the
    // read side, documented rather than "fixed".
    await apply([stateEffect(0, ['fleet'], 'scattered')], {
      cascade: cascade({
        groupTier: {
          status: 'ambiguous',
          candidates: [
            { id: 'grp-1', name: 'Armada' },
            { id: 'grp-2', name: 'Flotilla' },
          ],
        },
      }),
    })
    expect(db.groups.update).not.toHaveBeenCalled()
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { fleet: 'scattered' } })
  })

  it('prefers the chat tier when a key lives at several tiers', async () => {
    await apply([stateEffect(0, ['count'], 9)], {
      cascade: cascade({ chatState: { count: 1 }, projectId: 'proj-1', projectState: { count: 2 } }),
    })
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { count: 9 } })
    expect(db.projects.update).not.toHaveBeenCalled()
  })
})

describe('batching and in-run ordering', () => {
  it('issues ONE write per touched store, whatever the effect count', async () => {
    await apply(
      [
        stateEffect(0, ['a'], 1),
        stateEffect(1, ['b'], 2),
        stateEffect(2, ['campaign', 'act'], 3),
      ],
      { cascade: cascade({ projectId: 'proj-1', projectState: { campaign: {} } }) },
    )
    expect(db.chats.update).toHaveBeenCalledTimes(1)
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { a: 1, b: 2 } })
    expect(db.projects.update).toHaveBeenCalledTimes(1)
  })

  it('lets sequential effects see each other through the local copies', async () => {
    const applied = await apply([stateEffect(0, ['tally'], 5), stateEffect(1, ['tally'], 6)])
    // The second write found the first one's key at the chat tier and its value
    // as `previous` — deterministic in-run ordering, never a store re-read.
    expect(applied).toEqual([
      { target: 'state.tally', next: 5, tier: 'chat' },
      { target: 'state.tally', previous: 5, next: 6, tier: 'chat' },
    ])
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { tally: 6 } })
  })
})

describe('the underscore guard, re-checked at apply time', () => {
  it('refuses a user-only first segment and writes nothing for it', async () => {
    const applied = await apply([
      { index: 0, target: { kind: 'state', path: ['_secrets', 'combo'], raw: 'state._secrets.combo' }, value: 1 },
      stateEffect(1, ['open'], true),
    ])
    expect(applied).toEqual([{ target: 'state.open', next: true, tier: 'chat' }])
    expect(db.chats.update).toHaveBeenCalledWith('chat-1', { state: { open: true } })
  })
})

describe('metadata effects', () => {
  it('read-modify-writes the snapshot as one whole-object update', async () => {
    const applied = await apply(
      [metadataEffect(0, 'lockpick', 'broken pick'), metadataEffect(1, 'attempts', 3)],
      { metadataSnapshot: { lockpick: 'good pick', unrelated: true } },
    )
    expect(db.characters.update).toHaveBeenCalledTimes(1)
    expect(db.characters.update).toHaveBeenCalledWith('char-1', {
      metadata: { lockpick: 'broken pick', unrelated: true, attempts: 3 },
    })
    expect(applied).toEqual([
      { target: 'metadata.lockpick', previous: 'good pick', next: 'broken pick' },
      { target: 'metadata.attempts', next: 3 },
    ])
  })

  it('skips metadata effects when no character rolled', async () => {
    const applied = await apply([metadataEffect(0, 'lockpick', 'broken'), stateEffect(1, ['x'], 1)], {
      characterId: null,
    })
    expect(db.characters.update).not.toHaveBeenCalled()
    expect(applied).toEqual([{ target: 'state.x', next: 1, tier: 'chat' }])
  })
})

describe('fail-soft behaviour', () => {
  it('skips state effects when the cascade could not be read, keeping metadata', async () => {
    const applied = await apply([stateEffect(0, ['x'], 1), metadataEffect(1, 'k', 'v')], { cascade: null })
    expect(db.chats.update).not.toHaveBeenCalled()
    expect(applied).toEqual([{ target: 'metadata.k', next: 'v' }])
  })

  it('drops one store\'s effects when its write fails, keeping the others', async () => {
    db.chats.update.mockRejectedValue(new Error('disk on fire'))
    const applied = await apply([stateEffect(0, ['x'], 1), metadataEffect(1, 'k', 'v')])
    expect(applied).toEqual([{ target: 'metadata.k', next: 'v' }])
  })

  it('survives a vault that disappeared mid-run', async () => {
    db.characters.update.mockRejectedValue(new Error('CharacterVaultUnavailableError: gone'))
    const applied = await apply([metadataEffect(0, 'k', 'v'), stateEffect(1, ['x'], 1)])
    expect(applied).toEqual([{ target: 'state.x', next: 1, tier: 'chat' }])
  })

  it('ignores skipped resolutions and writes nothing when nothing applies', async () => {
    const applied = await apply([{ index: 0, skipped: 'condition did not hold' }])
    expect(applied).toEqual([])
    expect(db.chats.update).not.toHaveBeenCalled()
    expect(db.characters.update).not.toHaveBeenCalled()
    expect(mockWriteGeneralState).not.toHaveBeenCalled()
  })
})
