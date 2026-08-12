import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { Character } from '@/lib/schemas/character.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockResolve = jest.fn<
  (
    repos: unknown,
    characterId: string,
    equipped: EquippedSlots,
  ) => Promise<{
    leafItemsBySlot: {
      top: { title: string; description?: string | null }[]
      bottom: { title: string; description?: string | null }[]
      footwear: { title: string; description?: string | null }[]
      accessories: { title: string; description?: string | null }[]
    }
  }>
>()
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: (...args: unknown[]) =>
    (mockResolve as unknown as (...a: unknown[]) => unknown)(...args),
}))

const { buildCharacterAvatarPrompt } = require('@/lib/wardrobe/avatar-prompt') as {
  buildCharacterAvatarPrompt: typeof import('@/lib/wardrobe/avatar-prompt').buildCharacterAvatarPrompt
}

const repos = {} as never
const baseCharacter: Character = {
  id: 'char-1',
  name: 'Charlie',
  physicalDescription: {
    id: 'pd-1',
    mediumPrompt:
      'Portrait of a middle-aged man with fair skin and short, spiky gray hair. Plain off-white background.',
  },
} as unknown as Character

const equipped: EquippedSlots = {
  top: ['shirt-id'],
  bottom: ['pants-id'],
  footwear: ['shoes-id'],
  accessories: ['ring-id'],
} as unknown as EquippedSlots

describe('buildCharacterAvatarPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolve.mockResolvedValue({
      leafItemsBySlot: {
        top: [{ title: 'Charcoal gray dress shirt', description: 'button-down, sleeves rolled' }],
        bottom: [{ title: 'black Dockers', description: 'Black Dockers-brand khakis' }],
        footwear: [{ title: 'black Nike sneakers', description: 'All-black, no decorations' }],
        accessories: [{ title: 'wedding ring', description: 'gold band, left ring finger' }],
      },
    })
  })

  it('separates the outfit list from surrounding text with blank lines', async () => {
    const { prompt, hasAppearance } = await buildCharacterAvatarPrompt(repos, baseCharacter, {
      equippedSlots: equipped,
    })

    expect(hasAppearance).toBe(true)
    // Blank line precedes the markdown list so renderers recognize it.
    expect(prompt).toMatch(/background\.\n\n- \*\*/)
    // No "..": the trailing period on the physical description is not duplicated.
    expect(prompt).not.toMatch(/background\.\./)
    // Blank line after the list before the closing sentence.
    expect(prompt).toMatch(/\n\nCharacter portrait, detailed/)
  })

  it('omits the outfit block entirely when no equipped slots are passed', async () => {
    const { prompt } = await buildCharacterAvatarPrompt(repos, baseCharacter, {})
    expect(prompt).not.toMatch(/\n\n- /)
    expect(prompt).toMatch(/three-quarter view\. Portrait of a middle-aged man/)
    expect(prompt).toMatch(/background\. Character portrait/)
  })

  it('returns an empty prompt when neither physical description nor outfit is available', async () => {
    const blank: Character = { ...baseCharacter, physicalDescription: null } as Character
    const { prompt, hasAppearance } = await buildCharacterAvatarPrompt(repos, blank, {})
    expect(hasAppearance).toBe(false)
    expect(prompt).toBe('')
  })

  it('handles outfit-only characters by leading the list with a blank line after the intro', async () => {
    const blank: Character = { ...baseCharacter, physicalDescription: null } as Character
    const { prompt } = await buildCharacterAvatarPrompt(repos, blank, { equippedSlots: equipped })
    expect(prompt).toMatch(/three-quarter view\.\n\n- \*\*/)
    expect(prompt).toMatch(/\n\nCharacter portrait, detailed/)
  })

  it('prefers headAndShouldersPrompt over mediumPrompt when both are set', async () => {
    const char: Character = {
      ...baseCharacter,
      physicalDescription: {
        id: 'pd-1',
        headAndShouldersPrompt: 'Head-and-shoulders crop: warm smile, jet-black wavy hair, open collar.',
        mediumPrompt: 'Full body, hourglass figure, full breasts, narrow waist, curved hips.',
      },
    } as unknown as Character
    const { prompt } = await buildCharacterAvatarPrompt(repos, char, {})
    expect(prompt).toMatch(/Head-and-shoulders crop: warm smile/)
    // The full-body medium prompt (with below-crop anatomy) must NOT be used.
    expect(prompt).not.toMatch(/hourglass figure/)
  })

  it('falls back to mediumPrompt when headAndShouldersPrompt is empty', async () => {
    const char: Character = {
      ...baseCharacter,
      physicalDescription: {
        id: 'pd-1',
        headAndShouldersPrompt: '',
        mediumPrompt: 'Portrait of a middle-aged man with fair skin and short, spiky gray hair.',
      },
    } as unknown as Character
    const { prompt } = await buildCharacterAvatarPrompt(repos, char, {})
    expect(prompt).toMatch(/Portrait of a middle-aged man/)
  })

  it('crops at the collarbone and emits no "topless"/"naked" wording for a bare-topped character', async () => {
    mockResolve.mockResolvedValue({
      leafItemsBySlot: {
        top: [],
        bottom: [],
        footwear: [],
        accessories: [{ title: 'silver collar', description: 'thin choker' }],
      },
    })
    const { prompt } = await buildCharacterAvatarPrompt(repos, baseCharacter, { equippedSlots: equipped })
    // Tighter framing that keeps the chest out of frame.
    expect(prompt).toMatch(/cropped at the collarbone/)
    expect(prompt).toMatch(/chest and torso are outside the frame/)
    // The default head-and-shoulders intro is replaced, not appended.
    expect(prompt).not.toMatch(/head-and-shoulders crop, three-quarter view/)
    // None of the nudity-signalling wardrobe language that trips SFW moderation.
    expect(prompt).not.toMatch(/topless/)
    expect(prompt).not.toMatch(/naked/)
    // Above-the-collar accessories are still described.
    expect(prompt).toMatch(/silver collar/)
  })

  it('omits the wardrobe block for a bare-topped character with no accessories (never says "naked")', async () => {
    mockResolve.mockResolvedValue({
      leafItemsBySlot: { top: [], bottom: [], footwear: [], accessories: [] },
    })
    const { prompt } = await buildCharacterAvatarPrompt(repos, baseCharacter, { equippedSlots: equipped })
    expect(prompt).toMatch(/cropped at the collarbone/)
    expect(prompt).not.toMatch(/topless/)
    expect(prompt).not.toMatch(/naked/)
    // No markdown wardrobe list at all.
    expect(prompt).not.toMatch(/\n- \*\*/)
  })
})
