/**
 * One sentence about the `hair` slot, in one place.
 *
 * The slot holds a *hairdo*, not hair — and a model that reads two different
 * versions of that rule files hair colour as a garment. The failure is
 * completely silent: the wardrobe grows an "auburn, shoulder-length" item that
 * the character can take off, and the physical description loses the hair it
 * should have kept.
 *
 * So this suite asserts the boundary is drawn once and drawn the same way
 * everywhere: the four wardrobe tools reach for the constant rather than
 * paraphrasing it, and the two prose halves — the wardrobe's claim on styling
 * and the physical description's claim on the hair itself — are complements
 * rather than two independent sentences free to drift apart.
 */

import fs from 'fs'
import path from 'path'

import {
  HAIR_PHYSICAL_BOUNDARY,
  HAIR_PHYSICAL_DESCRIPTION_NOTE,
  HAIR_SLOT_GUIDANCE,
} from '@/lib/wardrobe/slot-guidance'
import {
  PHYSICAL_DESCRIPTION_SEMANTICS,
  WARDROBE_SEMANTICS,
} from '@/lib/services/character-field-semantics'

/** Every wardrobe tool whose slot parameter must carry the guidance. */
const SLOT_BEARING_TOOLS = [
  'lib/tools/wardrobe-create-tool.ts',
  'lib/tools/wardrobe-update-tool.ts',
  'lib/tools/wardrobe-wear-tool.ts',
  'lib/tools/wardrobe-take-off-tool.ts',
]

describe('the guidance says what it must', () => {
  it('names the slot, the styling, and the exception', () => {
    expect(HAIR_SLOT_GUIDANCE).toContain('"hair" slot')
    expect(HAIR_SLOT_GUIDANCE).toMatch(/styling, not the hair itself/)
    expect(HAIR_SLOT_GUIDANCE).toMatch(/physical description/i)
  })

  it('explains what an EMPTY hair slot means — the case a model otherwise guesses at', () => {
    expect(HAIR_SLOT_GUIDANCE).toMatch(/empty hair slot/i)
  })

  it('draws the boundary in both directions', () => {
    // The wardrobe's half claims the styling.
    expect(HAIR_PHYSICAL_BOUNDARY).toMatch(/hairSTYLE/)
    expect(HAIR_PHYSICAL_BOUNDARY).toMatch(/wardrobe's "hair" slot/)
    // The physical description's half claims the hair.
    expect(HAIR_PHYSICAL_DESCRIPTION_NOTE).toMatch(/colour, length, texture/)
    expect(HAIR_PHYSICAL_DESCRIPTION_NOTE).toMatch(/wardrobe's "hair" slot/i)
  })

  it('keeps British "colour" consistent across both prose halves', () => {
    // Mixed spelling in one prompt reads as two authors, and two authors is
    // exactly the drift this module exists to stop.
    expect(HAIR_PHYSICAL_BOUNDARY).toContain('colour')
    expect(HAIR_PHYSICAL_DESCRIPTION_NOTE).toContain('colour')
  })
})

describe('every consumer reaches for the constant', () => {
  it.each(SLOT_BEARING_TOOLS)('%s imports it rather than paraphrasing', file => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(source).toMatch(/import \{ HAIR_SLOT_GUIDANCE \} from '@\/lib\/wardrobe\/slot-guidance'/)
    expect(source).toContain('HAIR_SLOT_GUIDANCE')
  })

  it.each(SLOT_BEARING_TOOLS)('%s spells out no rival hair sentence', file => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // A literal describing the slot's contents would be a second copy of the
    // rule, free to drift from the one above.
    expect(withoutComments).not.toMatch(/hairdo|hairstyle/i)
  })

  it('the field semantics embed both prose halves verbatim', () => {
    expect(WARDROBE_SEMANTICS).toContain(HAIR_PHYSICAL_BOUNDARY)
    expect(PHYSICAL_DESCRIPTION_SEMANTICS).toContain(HAIR_PHYSICAL_DESCRIPTION_NOTE)
  })
})
