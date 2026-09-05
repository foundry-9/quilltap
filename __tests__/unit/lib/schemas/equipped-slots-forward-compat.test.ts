/**
 * The no-migration guarantee for wardrobe slots.
 *
 * `chats.equippedOutfit` is an unconstrained JSON TEXT column, and every slot
 * on `EquippedSlotsSchema` carries `.default([])`. A row written before a slot
 * existed therefore parses cleanly, with the new slot arriving empty — which is
 * why adding a slot needs no migration and no DDL change.
 *
 * If a future slot is ever added without a default, this test is the thing that
 * catches it before someone's saved outfits stop loading.
 */

import { describe, expect, it } from '@jest/globals'

import {
  EquippedSlotsSchema,
  WARDROBE_SLOT_TYPES,
  makeEmptyEquippedSlots,
  normalizeEquippedSlots,
} from '@/lib/schemas/wardrobe.types'

const UUID_A = '550e8400-e29b-41d4-a716-446655440000'
const UUID_B = '550e8400-e29b-41d4-a716-446655440001'

describe('EquippedSlotsSchema forward compatibility', () => {
  it('parses a pre-hair four-key row and supplies an empty hair slot', () => {
    const legacyRow = {
      top: [UUID_A],
      bottom: [UUID_B],
      footwear: [],
      accessories: [],
    }

    const parsed = EquippedSlotsSchema.parse(legacyRow)

    expect(parsed.hair).toEqual([])
    // Nothing the old row DID say is disturbed.
    expect(parsed.top).toEqual([UUID_A])
    expect(parsed.bottom).toEqual([UUID_B])
  })

  it('parses an empty object into every slot, all empty', () => {
    const parsed = EquippedSlotsSchema.parse({})
    expect(parsed).toEqual(makeEmptyEquippedSlots())
  })

  it('gives every declared slot a default, so any future slot round-trips too', () => {
    const parsed = EquippedSlotsSchema.parse({}) as Record<string, unknown>
    for (const slot of WARDROBE_SLOT_TYPES) {
      expect(parsed[slot]).toEqual([])
    }
    // The schema declares exactly the canonical slot list — no more, no less.
    expect(Object.keys(parsed).sort()).toEqual([...WARDROBE_SLOT_TYPES].sort())
  })
})

/**
 * The guarantee above only holds where the value actually passes through the
 * schema. `normalizeEquippedSlots` is the chokepoint that makes sure it does,
 * on the way out of the raw JSON column (Bug 78).
 */
describe('normalizeEquippedSlots', () => {
  it('fills in a slot a legacy row never had', () => {
    const normalized = normalizeEquippedSlots({
      top: [UUID_A],
      bottom: [],
      footwear: [],
      accessories: [],
    })

    expect(normalized.hair).toEqual([])
    expect(normalized.top).toEqual([UUID_A])
  })

  it('returns all-empty slots for null, undefined, and an empty object', () => {
    expect(normalizeEquippedSlots(null)).toEqual(makeEmptyEquippedSlots())
    expect(normalizeEquippedSlots(undefined)).toEqual(makeEmptyEquippedSlots())
    expect(normalizeEquippedSlots({})).toEqual(makeEmptyEquippedSlots())
  })

  it('salvages the legible slots of a malformed bag rather than discarding it', () => {
    const normalized = normalizeEquippedSlots({
      top: [UUID_A],
      // Not a uuid, so the whole-object parse fails; the salvage keeps strings.
      bottom: ['not-a-uuid'],
      footwear: 'nonsense',
      accessories: [7, UUID_B],
    })

    expect(normalized.top).toEqual([UUID_A])
    expect(normalized.bottom).toEqual(['not-a-uuid'])
    expect(normalized.footwear).toEqual([])
    expect(normalized.accessories).toEqual([UUID_B])
    expect(normalized.hair).toEqual([])
  })

  it('always answers with the full canonical slot list', () => {
    const normalized = normalizeEquippedSlots({ top: [UUID_A], stowaway: ['x'] }) as Record<string, unknown>
    expect(Object.keys(normalized).sort()).toEqual([...WARDROBE_SLOT_TYPES].sort())
  })
})
