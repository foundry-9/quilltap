/**
 * The digest-policy chokepoint (bug 69).
 *
 * `preservesContentDigest` is the single question every disk-derived `sha256`
 * write must ask before it overwrites a `files` row. The watcher regression
 * suite exercises it through the real watcher; this suite pins the predicate
 * itself, because the set it guards is what makes archiving reversible.
 */

import { preservesContentDigest } from '@/lib/file-storage/digest-policy'

describe('preservesContentDigest', () => {
  it('protects an ARCHIVE row — its sha256 digests the PLAINTEXT bundle, not the encrypted bytes on disk', () => {
    expect(preservesContentDigest('ARCHIVE')).toBe(true)
  })

  it('leaves ordinary categories alone, since a disk-derived digest is the norm', () => {
    for (const category of ['IMAGE', 'DOCUMENT', 'AVATAR', 'BACKGROUND', 'OTHER']) {
      expect(preservesContentDigest(category)).toBe(false)
    }
  })

  it('treats an absent category as an ordinary row rather than throwing', () => {
    expect(preservesContentDigest(null)).toBe(false)
    expect(preservesContentDigest(undefined)).toBe(false)
    expect(preservesContentDigest('')).toBe(false)
  })

  it('is case-sensitive — only the canonical category spelling is protected', () => {
    expect(preservesContentDigest('archive')).toBe(false)
    expect(preservesContentDigest('Archive')).toBe(false)
  })
})
