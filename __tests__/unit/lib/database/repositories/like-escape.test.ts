/**
 * Unit tests for the LIKE-pattern escaping shared by the mount-index
 * substring searches. A `%` or `_` typed into the search bar must match
 * itself, not act as a wildcard.
 */

import {
  LIKE_ESCAPE_CHAR,
  escapeLikeLiteral,
  likeContainsPattern,
} from '@/lib/database/repositories/like-escape'

describe('escapeLikeLiteral', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLikeLiteral('manifesto')).toBe('manifesto')
  })

  it('escapes the LIKE wildcards', () => {
    expect(escapeLikeLiteral('100%')).toBe(`100${LIKE_ESCAPE_CHAR}%`)
    expect(escapeLikeLiteral('a_b')).toBe(`a${LIKE_ESCAPE_CHAR}_b`)
  })

  it('escapes the escape character itself', () => {
    expect(escapeLikeLiteral('c:\\notes')).toBe(`c:${LIKE_ESCAPE_CHAR}\\notes`)
  })
})

describe('likeContainsPattern', () => {
  it('wraps a lower-cased, escaped needle in %…%', () => {
    expect(likeContainsPattern('Manifesto')).toBe('%manifesto%')
  })

  it('keeps user wildcards literal inside the contains pattern', () => {
    expect(likeContainsPattern('50%_off')).toBe(
      `%50${LIKE_ESCAPE_CHAR}%${LIKE_ESCAPE_CHAR}_off%`
    )
  })
})
