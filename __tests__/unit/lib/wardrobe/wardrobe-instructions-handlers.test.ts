/**
 * The `?action=instructions` GET/POST pair shared by all four wardrobe tiers.
 *
 * Four routes (general, character, group, project) used to carry four copies of
 * this body, and the copy that matters is the *clearing* rule: an instructions
 * field the user has blanked must come back as `null`, not as `"   "`. A tier
 * that got that wrong would go on feeding a whitespace paragraph into the
 * outfit-choosing prompt forever, and nothing would ever error.
 *
 * The write path is deliberately asymmetric to the read path — `handleWrite`
 * hands `writeWardrobeInstructionsFile` the RAW body (the file layer owns
 * clearing) but answers the caller with the trimmed content. Both halves are
 * asserted here.
 */

import {
  handleReadWardrobeInstructions,
  handleWriteWardrobeInstructions,
  parseWardrobeInstructionsBody,
  wardrobeInstructionsBodySchema,
} from '@/lib/wardrobe/wardrobe-instructions-handlers'
import {
  readWardrobeInstructionsFile,
  writeWardrobeInstructionsFile,
} from '@/lib/wardrobe/wardrobe-instructions'

jest.mock('@/lib/wardrobe/wardrobe-instructions', () => ({
  readWardrobeInstructionsFile: jest.fn(),
  writeWardrobeInstructionsFile: jest.fn(),
}))

const mockRead = jest.mocked(readWardrobeInstructionsFile)
const mockWrite = jest.mocked(writeWardrobeInstructionsFile)

/** A request whose body is `json`, which is all the parser touches. */
function req(json: unknown): Request {
  return { json: async () => json } as Request
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWrite.mockResolvedValue(undefined as never)
})

describe('parseWardrobeInstructionsBody', () => {
  it('reads a real instructions string and does not call it cleared', async () => {
    const body = await parseWardrobeInstructionsBody(req({ instructions: 'Dress for the season.' }))
    expect(body).toEqual({ instructions: 'Dress for the season.', cleared: false })
  })

  it('treats an explicit null as clearing', async () => {
    expect(await parseWardrobeInstructionsBody(req({ instructions: null }))).toEqual({
      instructions: null,
      cleared: true,
    })
  })

  it('treats an empty string as clearing', async () => {
    expect(await parseWardrobeInstructionsBody(req({ instructions: '' }))).toEqual({
      instructions: '',
      cleared: true,
    })
  })

  it('treats a whitespace-only string as clearing', async () => {
    expect(await parseWardrobeInstructionsBody(req({ instructions: '  \n\t ' }))).toEqual({
      instructions: '  \n\t ',
      cleared: true,
    })
  })

  it('rejects a missing or non-string, non-null field', async () => {
    await expect(parseWardrobeInstructionsBody(req({}))).rejects.toThrow()
    await expect(parseWardrobeInstructionsBody(req({ instructions: 42 }))).rejects.toThrow()
  })

  it('exposes the schema the routes validate against', () => {
    expect(wardrobeInstructionsBodySchema.safeParse({ instructions: null }).success).toBe(true)
    expect(wardrobeInstructionsBodySchema.safeParse({ instructions: undefined }).success).toBe(false)
  })
})

describe('handleReadWardrobeInstructions', () => {
  it('answers the tier\'s own file', async () => {
    mockRead.mockResolvedValue('Dress for the season.')

    const response = await handleReadWardrobeInstructions('mount-1')

    expect(mockRead).toHaveBeenCalledWith('mount-1')
    await expect(response.json()).resolves.toEqual({ instructions: 'Dress for the season.' })
  })

  it('answers null without reading when the tier has no mount yet', async () => {
    const response = await handleReadWardrobeInstructions(null)

    expect(mockRead).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ instructions: null })
  })

  it('reports presence to the route\'s own log line', async () => {
    const log = jest.fn()

    mockRead.mockResolvedValue('something')
    await handleReadWardrobeInstructions('mount-1', log)
    expect(log).toHaveBeenCalledWith({ present: true })

    mockRead.mockResolvedValue(null)
    await handleReadWardrobeInstructions('mount-1', log)
    expect(log).toHaveBeenLastCalledWith({ present: false })
  })
})

describe('handleWriteWardrobeInstructions', () => {
  it('writes the content and answers it trimmed', async () => {
    const response = await handleWriteWardrobeInstructions('mount-1', {
      instructions: '  Dress for the season.  ',
      cleared: false,
    })

    expect(mockWrite).toHaveBeenCalledWith('mount-1', '  Dress for the season.  ')
    await expect(response.json()).resolves.toEqual({ instructions: 'Dress for the season.' })
  })

  it('answers null when clearing, whatever whitespace the body carried', async () => {
    const response = await handleWriteWardrobeInstructions('mount-1', {
      instructions: '   ',
      cleared: true,
    })

    expect(mockWrite).toHaveBeenCalledWith('mount-1', '   ')
    await expect(response.json()).resolves.toEqual({ instructions: null })
  })

  it('answers null for an explicit null without dereferencing it', async () => {
    const response = await handleWriteWardrobeInstructions('mount-1', {
      instructions: null,
      cleared: true,
    })

    expect(mockWrite).toHaveBeenCalledWith('mount-1', null)
    await expect(response.json()).resolves.toEqual({ instructions: null })
  })

  it('reports the clearing flag to the route\'s own log line', async () => {
    const log = jest.fn()

    await handleWriteWardrobeInstructions('mount-1', { instructions: 'x', cleared: false }, log)
    expect(log).toHaveBeenCalledWith({ cleared: false })

    await handleWriteWardrobeInstructions('mount-1', { instructions: null, cleared: true }, log)
    expect(log).toHaveBeenLastCalledWith({ cleared: true })
  })

  it('propagates a write failure rather than answering success', async () => {
    mockWrite.mockRejectedValue(new Error('mount is read-only'))

    await expect(
      handleWriteWardrobeInstructions('mount-1', { instructions: 'x', cleared: false })
    ).rejects.toThrow('mount is read-only')
  })
})

describe('the pair round-trips', () => {
  it('a write followed by a read answers the same content', async () => {
    let stored: string | null = null
    mockWrite.mockImplementation(async (_mount, value) => {
      stored = value && value.trim().length > 0 ? value.trim() : null
    })
    mockRead.mockImplementation(async () => stored)

    const body = await parseWardrobeInstructionsBody(req({ instructions: ' Wear the greatcoat. ' }))
    await handleWriteWardrobeInstructions('mount-1', body)

    const response = await handleReadWardrobeInstructions('mount-1')
    await expect(response.json()).resolves.toEqual({ instructions: 'Wear the greatcoat.' })
  })

  it('clearing then reading answers null', async () => {
    let stored: string | null = 'Wear the greatcoat.'
    mockWrite.mockImplementation(async (_mount, value) => {
      stored = value && value.trim().length > 0 ? value.trim() : null
    })
    mockRead.mockImplementation(async () => stored)

    const body = await parseWardrobeInstructionsBody(req({ instructions: '   ' }))
    await handleWriteWardrobeInstructions('mount-1', body)

    const response = await handleReadWardrobeInstructions('mount-1')
    await expect(response.json()).resolves.toEqual({ instructions: null })
  })
})
