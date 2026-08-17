/**
 * Regression net for "unreported-if-blank" wardrobe slots.
 *
 * A slot whose `reportWhenEmpty` is false (today: `hair`) must vanish from
 * EVERY report when it is empty — prose summaries, image prompts, Aurora
 * whispers, and the per-slot dumps in wardrobe tool results. Emptiness there
 * does not mean absence: a character with no hair item has ordinary hair, and
 * an image model told "hair: (empty)" or "no hairdo" will happily render
 * someone bald.
 *
 * These tests exist to fail loudly if a future slot list, prompt, or dump
 * starts announcing the blank.
 */

import { describe, expect, it, jest } from '@jest/globals'

import {
  WARDROBE_SLOT_TYPES,
  WARDROBE_SLOT_META,
  UNREPORTED_IF_BLANK_SLOT_TYPES,
  isSlotReportedWhenEmpty,
  makeEmptyEquippedSlots,
} from '@/lib/schemas/wardrobe.types'
import { describeOutfit, buildOutfitSlotValues } from '@/lib/wardrobe/outfit-description'
import { formatWardrobeMutationResults } from '@/lib/tools/handlers/wardrobe-handler-shared'
import {
  buildOpeningOutfitContent,
  buildOpeningOutfitOpaqueContent,
  buildOutfitChangeContent,
  buildOutfitChangeOpaqueContent,
} from '@/lib/services/aurora-notifications/writer'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

/** Words that would tell a reader or an image model the character has no hair. */
const BALDNESS_TELLS = [
  'hair',
  'bald',
  'hairless',
  'unstyled',
  'no hairdo',
  'no hairstyle',
]

function expectNoHairMention(text: string, label: string): void {
  const lowered = text.toLowerCase()
  for (const tell of BALDNESS_TELLS) {
    if (lowered.includes(tell)) {
      throw new Error(`[${label}] leaked "${tell}" into a report with a blank hair slot:\n${text}`)
    }
  }
}

describe('the slot registry', () => {
  it('marks hair as unreported-if-blank and every garment slot as reported', () => {
    expect(isSlotReportedWhenEmpty('hair')).toBe(false)
    expect(UNREPORTED_IF_BLANK_SLOT_TYPES).toEqual(['hair'])
    for (const slot of ['top', 'bottom', 'footwear', 'accessories'] as const) {
      expect(isSlotReportedWhenEmpty(slot)).toBe(true)
    }
  })

  it('keeps emptyFallback non-null exactly for reported slots', () => {
    for (const slot of WARDROBE_SLOT_TYPES) {
      const meta = WARDROBE_SLOT_META[slot]
      expect(meta.emptyFallback === null).toBe(!meta.reportWhenEmpty)
    }
  })
})

describe('describeOutfit never announces a blank hair slot', () => {
  it('says nothing about hair for a fully dressed character wearing no hairdo', () => {
    const out = describeOutfit(
      buildOutfitSlotValues((slot) =>
        slot === 'top'
          ? ['linen shirt']
          : slot === 'bottom'
            ? ['wool trousers']
            : slot === 'footwear'
              ? ['oxfords']
              : slot === 'accessories'
                ? ['pocket watch']
                : [],
      ),
    )
    expectNoHairMention(out, 'dressed, no hairdo')
  })

  it('says nothing about hair for a partly dressed character wearing no hairdo', () => {
    const out = describeOutfit(
      buildOutfitSlotValues((slot) => (slot === 'bottom' ? ['wool trousers'] : [])),
    )
    // The garment negatives are still there — those ARE information.
    expect(out).toContain('topless')
    expect(out).toContain('barefoot')
    expectNoHairMention(out, 'partly dressed, no hairdo')
  })

  it('says nothing about hair for a fully undressed character', () => {
    const out = describeOutfit(makeEmptyEquippedSlots() as never)
    expect(out).toBe('- completely naked and unadorned\n')
    expectNoHairMention(out, 'fully undressed')
  })

  it('still renders the hairdo when one IS set', () => {
    const out = describeOutfit(
      buildOutfitSlotValues((slot) => (slot === 'hair' ? ['marcel waves'] : [])),
    )
    expect(out).toContain('- **hair:** marcel waves')
  })
})

describe("Aurora's whispers never announce a blank hair slot", () => {
  const outfit = buildOutfitSlotValues((slot) =>
    slot === 'top' ? ['linen shirt'] : slot === 'bottom' ? ['wool trousers'] : [],
  )

  const builders: [string, (p: { characterName: string; outfit: typeof outfit }) => string][] = [
    ['opening', buildOpeningOutfitContent],
    ['opening (opaque)', buildOpeningOutfitOpaqueContent],
    ['change', buildOutfitChangeContent],
    ['change (opaque)', buildOutfitChangeOpaqueContent],
  ]

  for (const [label, build] of builders) {
    it(`${label} whisper omits hair entirely when the slot is blank`, () => {
      expectNoHairMention(build({ characterName: 'Bertie', outfit }), label)
    })
  }
})

describe('wardrobe tool results never announce a blank hair slot', () => {
  it('omits the hair row from the per-slot dump when hair is empty', () => {
    const text = formatWardrobeMutationResults({
      success: true,
      operations: [{ effect_summary: 'Wore the linen shirt.' }],
      current_state: { ...makeEmptyEquippedSlots(), top: ['shirt-1'] },
      coverage_summary: '- **top:** linen shirt\n',
    })
    expect(text).toContain('top: shirt-1')
    expect(text).toContain('accessories: (empty)')
    expect(text).not.toContain('hair')
  })

  it('still lists the hair row when a hairdo IS worn', () => {
    const text = formatWardrobeMutationResults({
      success: true,
      operations: [{ effect_summary: 'Put the hair up.' }],
      current_state: { ...makeEmptyEquippedSlots(), hair: ['braid-1'] },
      coverage_summary: '- **hair:** braided crown\n',
    })
    expect(text).toContain('hair: braid-1')
  })
})
