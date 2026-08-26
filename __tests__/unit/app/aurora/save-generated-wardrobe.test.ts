/**
 * `saveGeneratedWardrobeItems` — the AI Wizard's wardrobe persistence path,
 * shared by the new-character and edit-character views.
 *
 * The interesting property is the two-pass shape: composites name their
 * components by TITLE, and only the API knows the ids. So leaves must be
 * created first, their minted ids collected, and composites sent afterwards
 * with resolved `componentItemIds`. Get the order wrong and every generated
 * outfit lands as an empty shell.
 */

import { saveGeneratedWardrobeItems } from '@/app/aurora/shared/save-generated-wardrobe'
import type { GeneratedWardrobeItem } from '@/components/characters/ai-wizard'

const CHARACTER_ID = 'char-1'

function item(overrides: Partial<GeneratedWardrobeItem> & { title: string }): GeneratedWardrobeItem {
  return {
    description: '',
    imagePrompt: '',
    types: ['top'],
    appropriateness: '',
    ...overrides,
  } as GeneratedWardrobeItem
}

/** Answer every POST with a distinct minted id, and record the bodies sent. */
function mockApi(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = []
  let n = 0
  ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    bodies.push(body)
    n += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({ wardrobeItem: { id: `id-${n}` } }),
    }
  })
  return { bodies }
}

describe('saveGeneratedWardrobeItems', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockReset()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('creates leaves before composites and resolves the components to minted ids', async () => {
    const { bodies } = mockApi()

    const result = await saveGeneratedWardrobeItems(CHARACTER_ID, [
      item({ title: 'Evening Ensemble', components: ['Silk Blouse', 'Velvet Skirt'] }),
      item({ title: 'Silk Blouse' }),
      item({ title: 'Velvet Skirt' }),
    ])

    expect(bodies.map(b => b.title)).toEqual(['Silk Blouse', 'Velvet Skirt', 'Evening Ensemble'])
    expect(bodies[0].componentItemIds).toEqual([])
    expect(bodies[2].componentItemIds).toEqual(['id-1', 'id-2'])
    expect(result).toEqual({ saved: 3, outfits: 1 })
  })

  it('matches component titles case- and whitespace-insensitively', async () => {
    const { bodies } = mockApi()

    await saveGeneratedWardrobeItems(CHARACTER_ID, [
      item({ title: 'Ensemble', components: ['  silk BLOUSE '] }),
      item({ title: 'Silk Blouse' }),
    ])

    expect(bodies[1].componentItemIds).toEqual(['id-1'])
  })

  it('drops a component title nothing was generated for rather than sending a dangling id', async () => {
    const { bodies } = mockApi()

    const result = await saveGeneratedWardrobeItems(CHARACTER_ID, [
      item({ title: 'Ensemble', components: ['Silk Blouse', 'A Hat Nobody Made'] }),
      item({ title: 'Silk Blouse' }),
    ])

    expect(bodies[1].componentItemIds).toEqual(['id-1'])
    expect(result).toEqual({ saved: 2, outfits: 1 })
  })

  it('counts an outfit only when components actually resolved', async () => {
    const { bodies } = mockApi()

    const result = await saveGeneratedWardrobeItems(CHARACTER_ID, [
      item({ title: 'Ensemble', components: ['Nothing Real'] }),
    ])

    expect(bodies[0].componentItemIds).toEqual([])
    expect(result).toEqual({ saved: 1, outfits: 0 })
  })

  it('keeps going after one item is rejected, and does not count it as saved', async () => {
    let n = 0
    ;(global.fetch as jest.Mock).mockImplementation(async () => {
      n += 1
      if (n === 1) return { ok: false, status: 400, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ wardrobeItem: { id: `id-${n}` } }) }
    })

    const result = await saveGeneratedWardrobeItems(CHARACTER_ID, [
      item({ title: 'First' }),
      item({ title: 'Second' }),
    ])

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ saved: 1, outfits: 0 })
  })

  it('survives a thrown request without abandoning the remaining items', async () => {
    let n = 0
    ;(global.fetch as jest.Mock).mockImplementation(async () => {
      n += 1
      if (n === 1) throw new Error('network down')
      return { ok: true, status: 200, json: async () => ({ wardrobeItem: { id: `id-${n}` } }) }
    })

    const result = await saveGeneratedWardrobeItems(CHARACTER_ID, [
      item({ title: 'First' }),
      item({ title: 'Second' }),
    ])

    expect(result).toEqual({ saved: 1, outfits: 0 })
  })

  it('still counts the save when the response carries no id, but resolves no component from it', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }))

    const result = await saveGeneratedWardrobeItems(CHARACTER_ID, [item({ title: 'Orphan' })])
    expect(result).toEqual({ saved: 1, outfits: 0 })
  })

  it('normalises the optional fields the API expects as null rather than empty string', async () => {
    const { bodies } = mockApi()

    await saveGeneratedWardrobeItems(CHARACTER_ID, [item({ title: 'Plain' })])

    expect(bodies[0]).toMatchObject({
      title: 'Plain',
      description: null,
      imagePrompt: null,
      appropriateness: null,
      isDefault: false,
      replace: false,
    })
  })

  it('does nothing at all for an empty list', async () => {
    mockApi()
    await expect(saveGeneratedWardrobeItems(CHARACTER_ID, [])).resolves.toEqual({ saved: 0, outfits: 0 })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
