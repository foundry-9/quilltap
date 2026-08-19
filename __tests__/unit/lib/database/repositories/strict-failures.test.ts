/**
 * Bug 79 — the import path cannot afford `safeQuery`'s fallback mode.
 *
 * A repository read that THROWS and a row that is ABSENT both arrive at the
 * caller as `null` once a fallback is supplied. Render paths want that; the
 * importers do not, because they commit writes on the strength of the answer.
 * These tests pin the one bit that tells the two situations apart.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const { safeQuery } =
  require('@/lib/database/repositories/safe-query') as typeof import('@/lib/database/repositories/safe-query')
const {
  withStrictRepositoryFailures,
  withRepositoryFallbacks,
  strictRepositoryFailuresActive,
} = require('@/lib/database/repositories/strict-failures') as typeof import('@/lib/database/repositories/strict-failures')

const boom = async (): Promise<string | null> => {
  throw new Error('database disk image is malformed')
}

describe('strict repository failures', () => {
  it('is inactive by default', () => {
    expect(strictRepositoryFailuresActive()).toBe(false)
  })

  it('leaves the fallback in place outside the scope', async () => {
    await expect(safeQuery(boom, 'Failed to read', {}, null)).resolves.toBeNull()
  })

  it('re-throws instead of answering with the fallback inside the scope', async () => {
    await expect(
      withStrictRepositoryFailures(() => safeQuery(boom, 'Failed to read', {}, null))
    ).rejects.toThrow('database disk image is malformed')
  })

  it('suppresses an undefined fallback too — silent mode is the same hazard', async () => {
    await expect(
      withStrictRepositoryFailures(() =>
        safeQuery(async () => {
          throw new Error('no such table: chats')
        }, 'Failed to read', {}, undefined)
      )
    ).rejects.toThrow('no such table: chats')
  })

  it('does not disturb the success path', async () => {
    await expect(
      withStrictRepositoryFailures(() => safeQuery(async () => 'row', 'Failed to read', {}, null))
    ).resolves.toBe('row')
  })

  it('leaves rethrow mode exactly as it was', async () => {
    await expect(safeQuery(boom, 'Failed to read')).rejects.toThrow('database disk image is malformed')
    await expect(withStrictRepositoryFailures(() => safeQuery(boom, 'Failed to read'))).rejects.toThrow(
      'database disk image is malformed'
    )
  })

  it('restores the fallback for a nested opt-out', async () => {
    const result = await withStrictRepositoryFailures(async () => {
      expect(strictRepositoryFailuresActive()).toBe(true)
      const relaxed = await withRepositoryFallbacks(() => safeQuery(boom, 'Failed to read', {}, null))
      // Leaving the nested scope puts the strictness back.
      expect(strictRepositoryFailuresActive()).toBe(true)
      return relaxed
    })
    expect(result).toBeNull()
  })

  it('does not leak out of the scope', async () => {
    await withStrictRepositoryFailures(async () => {
      expect(strictRepositoryFailuresActive()).toBe(true)
    })
    expect(strictRepositoryFailuresActive()).toBe(false)
    await expect(safeQuery(boom, 'Failed to read', {}, null)).resolves.toBeNull()
  })

  it('does not leak when the scope throws', async () => {
    await expect(
      withStrictRepositoryFailures(() => safeQuery(boom, 'Failed to read', {}, null))
    ).rejects.toThrow()
    expect(strictRepositoryFailuresActive()).toBe(false)
  })
})
