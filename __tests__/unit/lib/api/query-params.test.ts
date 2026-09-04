/**
 * The `?includeArchived` opt-in, read in one place.
 *
 * Archiving is a tombstone, not a delete: an archived scenario or wardrobe item
 * is still a live row, and eleven listing endpoints hide it by default. The
 * accepted spelling has to be identical across all eleven or an archived entry
 * reappears at one endpoint and not another — so the *refusals* below matter as
 * much as the acceptances, and the fall-closed behaviour on an unparseable URL
 * is the whole reason this is a function rather than an inline read.
 */

import { readIncludeArchived } from '@/lib/api/query-params'

/** The only property the reader touches. */
function req(url: string): Request {
  return { url } as Request
}

describe('readIncludeArchived — asked', () => {
  it('honours the literal true', () => {
    expect(readIncludeArchived(req('https://x.test/api/v1/wardrobe?includeArchived=true'))).toBe(true)
  })

  it('honours the bare valueless form', () => {
    expect(readIncludeArchived(req('https://x.test/api/v1/wardrobe?includeArchived'))).toBe(true)
  })

  it('honours it alongside other params', () => {
    expect(
      readIncludeArchived(req('https://x.test/api/v1/wardrobe?tier=general&includeArchived=true&q=hat'))
    ).toBe(true)
  })
})

describe('readIncludeArchived — not asked', () => {
  it('is false when the param is absent', () => {
    expect(readIncludeArchived(req('https://x.test/api/v1/wardrobe'))).toBe(false)
  })

  it('is false for anything other than the literal true', () => {
    for (const value of ['1', 'yes', 'True', 'TRUE', 'on', 'false', '0']) {
      expect(
        readIncludeArchived(req(`https://x.test/api/v1/wardrobe?includeArchived=${value}`))
      ).toBe(false)
    }
  })

  it('falls closed on an unparseable URL rather than throwing', () => {
    expect(readIncludeArchived(req('not a url'))).toBe(false)
    expect(readIncludeArchived({} as Request)).toBe(false)
  })
})
