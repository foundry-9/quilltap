/**
 * Unit tests for chunkArray — the helper behind chunked SQLite `IN (...)`
 * queries, where every element becomes one bind variable.
 */

import { describe, it, expect } from '@jest/globals'
import { chunkArray, SQLITE_VARIABLE_CHUNK_SIZE } from '@/lib/utils/chunk'

describe('chunkArray', () => {
  it('returns no chunks for an empty input', () => {
    expect(chunkArray([], 900)).toEqual([])
  })

  it('returns a single chunk when the input fits', () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]])
  })

  it('splits into consecutive chunks preserving order', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('splits exactly divisible input with no trailing empty chunk', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('rejects non-positive and non-integer sizes', () => {
    expect(() => chunkArray([1], 0)).toThrow()
    expect(() => chunkArray([1], -1)).toThrow()
    expect(() => chunkArray([1], 1.5)).toThrow()
  })

  it('keeps the SQLite chunk constant under the historical 999 variable cap', () => {
    expect(SQLITE_VARIABLE_CHUNK_SIZE).toBeLessThan(999)
  })
})
