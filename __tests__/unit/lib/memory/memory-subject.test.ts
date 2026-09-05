/**
 * Bug 122 — subject resolution for the self-facing memory blocks.
 *
 * A character's store mixes their own memories with what they remember about
 * other people. `buildMemorySubjectContext` is the one place that works out
 * who those other people are, so the formatters can name them instead of
 * handing the character someone else's life in the first person.
 */

import { buildMemorySubjectContext } from '@/lib/memory/memory-subject'
import type { Memory } from '@/lib/schemas/types'

const findNamesByIds = jest.fn()

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ characters: { findNamesByIds } }),
}))

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const SELF = 'char-self'
const MARION = 'char-marion'
const CHARLIE = 'char-charlie'

function memory(aboutCharacterId: string | null): Pick<Memory, 'aboutCharacterId'> {
  return { aboutCharacterId } as Pick<Memory, 'aboutCharacterId'>
}

describe('buildMemorySubjectContext', () => {
  beforeEach(() => {
    findNamesByIds.mockReset()
    findNamesByIds.mockResolvedValue(
      new Map([
        [MARION, 'Marion'],
        [CHARLIE, 'Charlie'],
      ]),
    )
  })

  it('resolves every other character the pool is about, deduped', async () => {
    const ctx = await buildMemorySubjectContext(SELF, [
      memory(MARION),
      memory(MARION),
      memory(CHARLIE),
      memory(SELF),
      memory(null),
    ])

    expect(findNamesByIds).toHaveBeenCalledTimes(1)
    const requested = findNamesByIds.mock.calls[0][0] as string[]
    expect([...requested].sort()).toEqual([CHARLIE, MARION])
    expect(ctx.selfCharacterId).toBe(SELF)
    expect(ctx.characterNames.get(MARION)).toBe('Marion')
  })

  it('queries nothing when the pool is entirely first-person', async () => {
    const ctx = await buildMemorySubjectContext(SELF, [memory(SELF), memory(null)])

    expect(findNamesByIds).not.toHaveBeenCalled()
    expect(ctx.characterNames.size).toBe(0)
  })

  it('queries nothing for an empty pool', async () => {
    const ctx = await buildMemorySubjectContext(SELF, [])

    expect(findNamesByIds).not.toHaveBeenCalled()
    expect(ctx.selfCharacterId).toBe(SELF)
  })

  it('returns an empty name map when the lookup finds nothing', async () => {
    // A name is a nicety; the formatter still prefixes an unresolved subject,
    // so a barren lookup degrades the line rather than restoring the bug.
    findNamesByIds.mockResolvedValue(new Map())

    const ctx = await buildMemorySubjectContext(SELF, [memory(MARION)])

    expect(ctx.characterNames.size).toBe(0)
  })
})
