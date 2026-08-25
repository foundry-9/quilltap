/**
 * buildSlugByItemIdMap — slug ambiguity rules.
 *
 * A slug is the vault's friendly alias for "the one item with this title" in
 * `componentItems:` references. When two items in a container share a title,
 * writer array order and the reader's filename-sorted order can crown
 * different winners, silently rewiring a composite's components on the next
 * read (found while verifying outfit transfers: a moved outfit ended up
 * pointing at a same-titled stranger instead of the component that travelled
 * with it). These tests pin the rule that an ambiguous slug is assigned to
 * NOBODY — every reference to a collider is written as an exact UUID.
 */

import {
  buildSlugByItemIdMap,
  buildWardrobeItemFile,
} from '@/lib/mount-index/character-vault'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

const NOW = '2026-01-01T00:00:00.000Z'

function makeItem(overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id: 'id-default',
    characterId: 'c1',
    title: 'Item',
    description: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

it('maps unique titles to their slugs', () => {
  const map = buildSlugByItemIdMap([
    makeItem({ id: 'a', title: 'Test Coat' }),
    makeItem({ id: 'b', title: 'Test Boots' }),
  ])
  expect(map.get('a')).toBe('test-coat')
  expect(map.get('b')).toBe('test-boots')
})

it('assigns an ambiguous slug to nobody — colliding titles all fall back to UUID', () => {
  const map = buildSlugByItemIdMap([
    makeItem({ id: 'a', title: 'Test Boots' }),
    makeItem({ id: 'b', title: 'Test Boots' }),
    makeItem({ id: 'c', title: 'Test Coat' }),
  ])
  expect(map.has('a')).toBe(false)
  expect(map.has('b')).toBe(false)
  expect(map.get('c')).toBe('test-coat')
})

it('treats titles that slugify identically as colliding even when spelled differently', () => {
  const map = buildSlugByItemIdMap([
    makeItem({ id: 'a', title: 'Test Boots' }),
    makeItem({ id: 'b', title: 'test   BOOTS!' }),
  ])
  expect(map.has('a')).toBe(false)
  expect(map.has('b')).toBe(false)
})

it('writes UUID component references for colliding components', () => {
  const bootsA = makeItem({ id: 'boots-a-uuid', title: 'Test Boots' })
  const bootsB = makeItem({ id: 'boots-b-uuid', title: 'Test Boots' })
  const coat = makeItem({ id: 'coat-uuid', title: 'Test Coat' })
  const outfit = makeItem({
    id: 'outfit-uuid',
    title: 'Test Ensemble',
    componentItemIds: ['coat-uuid', 'boots-a-uuid'],
  })
  const items = [outfit, bootsA, bootsB, coat]

  const file = buildWardrobeItemFile(outfit, buildSlugByItemIdMap(items))

  // The unique coat travels as a slug; the ambiguous boots as an exact UUID.
  expect(file).toContain('test-coat')
  expect(file).toContain('boots-a-uuid')
  expect(file).not.toContain('test-boots')
})
