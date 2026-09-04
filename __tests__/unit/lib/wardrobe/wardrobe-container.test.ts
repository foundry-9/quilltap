/**
 * The four places a wardrobe item can live, and the URLs that reach them.
 *
 * The dialog's top selector round-trips a container through a `<select>` value,
 * so the encoding is user-facing state; every scoped mutation then builds its
 * endpoint from the decoded container. Two things must not drift: the encoding
 * (a mangled value that decodes to the *wrong* container edits somebody else's
 * wardrobe) and `includeArchived`, which every wardrobe list endpoint honours
 * and which must be absent unless asked for — archived entries are tombstones,
 * and a caller that simply doesn't ask gets the archived-free list by
 * construction.
 */

import {
  GENERAL_CONTAINER,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  sameWardrobeContainer,
  wardrobeCollectionUrl,
  wardrobeItemUrl,
  withWardrobeArchivedParam,
} from '@/lib/wardrobe/wardrobe-container'

const CHAR = { scope: 'character' as const, id: 'char-1' }
const PROJECT = { scope: 'project' as const, id: 'proj-1' }
const GROUP = { scope: 'group' as const, id: 'group-1' }

describe('encode / decode', () => {
  it('round-trips every scope', () => {
    for (const container of [CHAR, PROJECT, GROUP, GENERAL_CONTAINER]) {
      expect(decodeWardrobeContainer(encodeWardrobeContainer(container))).toEqual(container)
    }
  })

  it('encodes the singleton general container with an empty id', () => {
    expect(encodeWardrobeContainer(GENERAL_CONTAINER)).toBe('general:')
  })

  it('decodes general with no id at all', () => {
    expect(decodeWardrobeContainer('general')).toEqual(GENERAL_CONTAINER)
  })

  it('keeps a UUID id intact', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    expect(decodeWardrobeContainer(`character:${id}`)).toEqual({ scope: 'character', id })
  })

  it('refuses an unknown scope', () => {
    expect(decodeWardrobeContainer('wardrobe:xyz')).toBeNull()
    expect(decodeWardrobeContainer('')).toBeNull()
    expect(decodeWardrobeContainer(':char-1')).toBeNull()
  })

  it('refuses a scoped container with no id — it would address nothing', () => {
    expect(decodeWardrobeContainer('character:')).toBeNull()
    expect(decodeWardrobeContainer('project')).toBeNull()
    expect(decodeWardrobeContainer('group:')).toBeNull()
  })
})

describe('sameWardrobeContainer', () => {
  it('is true for the same place', () => {
    expect(sameWardrobeContainer(CHAR, { scope: 'character', id: 'char-1' })).toBe(true)
    expect(sameWardrobeContainer(GENERAL_CONTAINER, { scope: 'general', id: null })).toBe(true)
  })

  it('is false across scopes even when the ids match', () => {
    expect(sameWardrobeContainer({ scope: 'project', id: 'x' }, { scope: 'group', id: 'x' })).toBe(
      false
    )
  })

  it('is false for a different id in the same scope', () => {
    expect(sameWardrobeContainer(CHAR, { scope: 'character', id: 'char-2' })).toBe(false)
  })

  it('is false when either side is absent', () => {
    expect(sameWardrobeContainer(null, CHAR)).toBe(false)
    expect(sameWardrobeContainer(CHAR, undefined)).toBe(false)
    expect(sameWardrobeContainer(null, null)).toBe(false)
  })
})

describe('collection and item URLs', () => {
  it('addresses each tier', () => {
    expect(wardrobeCollectionUrl(CHAR)).toBe('/api/v1/characters/char-1/wardrobe')
    expect(wardrobeCollectionUrl(PROJECT)).toBe('/api/v1/projects/proj-1/wardrobe')
    expect(wardrobeCollectionUrl(GROUP)).toBe('/api/v1/groups/group-1/wardrobe')
    expect(wardrobeCollectionUrl(GENERAL_CONTAINER)).toBe('/api/v1/wardrobe')
  })

  it('appends an item id', () => {
    expect(wardrobeItemUrl(CHAR, 'item-9')).toBe('/api/v1/characters/char-1/wardrobe/item-9')
    expect(wardrobeItemUrl(GENERAL_CONTAINER, 'item-9')).toBe('/api/v1/wardrobe/item-9')
  })
})

describe('includeArchived', () => {
  it('is absent unless asked for', () => {
    expect(wardrobeCollectionUrl(CHAR)).not.toContain('includeArchived')
    expect(wardrobeCollectionUrl(CHAR, {})).not.toContain('includeArchived')
    expect(wardrobeCollectionUrl(CHAR, { includeArchived: false })).not.toContain('includeArchived')
  })

  it('rides as the literal the reader accepts', () => {
    expect(wardrobeCollectionUrl(CHAR, { includeArchived: true })).toBe(
      '/api/v1/characters/char-1/wardrobe?includeArchived=true'
    )
  })

  it('joins with & when the URL already has a query string', () => {
    expect(withWardrobeArchivedParam('/api/v1/wardrobe?tier=general', true)).toBe(
      '/api/v1/wardrobe?tier=general&includeArchived=true'
    )
  })

  it('joins with ? when it does not', () => {
    expect(withWardrobeArchivedParam('/api/v1/wardrobe', true)).toBe(
      '/api/v1/wardrobe?includeArchived=true'
    )
  })

  it('leaves the URL alone when not asked', () => {
    expect(withWardrobeArchivedParam('/api/v1/wardrobe?tier=general', false)).toBe(
      '/api/v1/wardrobe?tier=general'
    )
  })
})
