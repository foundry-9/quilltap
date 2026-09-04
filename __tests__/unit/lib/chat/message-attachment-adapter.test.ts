/**
 * Re-deciding the attachment question after the model changes underneath a
 * message array.
 *
 * A formatted array bakes in one profile's answer to "raw bytes, or a
 * description?". Every mid-turn swap inherits that answer, and the uncensored
 * reroute is where it bit: a vision profile's array, bytes and all, handed to a
 * text-only substitute, refused by the gateway with a 400 before the remedy
 * could run (bug 106). The failure is structural, not unlucky — the answer was
 * computed for a model that is no longer the one being called.
 *
 * Three contracts here, and all three are load-bearing:
 *   1. a profile that CAN take the bytes gets the array back by reference — no
 *      copy, no describer spent, which is the overwhelmingly common case;
 *   2. a profile that cannot gets the description in the bytes' place, exactly
 *      as if it had been the primary all along;
 *   3. a describer that fails still yields a sendable array — a degraded turn
 *      beats the 400 that skipping this step guarantees.
 */

import {
  adaptMessagesForProfile,
  collectAttachmentMimeTypes,
} from '@/lib/chat/message-attachment-adapter'
import {
  formatFallbackAsMessagePrefix,
  needsFallbackProcessing,
  processFileAttachmentFallback,
} from '@/lib/chat/file-attachment-fallback'
import type { ConnectionProfile } from '@/lib/schemas/types'

jest.mock('@/lib/chat/file-attachment-fallback', () => ({
  needsFallbackProcessing: jest.fn(),
  processFileAttachmentFallback: jest.fn(),
  formatFallbackAsMessagePrefix: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockNeedsFallback = jest.mocked(needsFallbackProcessing)
const mockProcessFallback = jest.mocked(processFileAttachmentFallback)
const mockFormatPrefix = jest.mocked(formatFallbackAsMessagePrefix)

const PROFILE = {
  id: 'profile-1',
  name: 'Text-only stand-in',
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
} as unknown as ConnectionProfile

function image(id: string, mimeType = 'image/png') {
  return { id, filename: `${id}.png`, mimeType, size: 1024, data: 'AAAA' }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFormatPrefix.mockImplementation(
    result => `[described ${(result as { id?: string }).id ?? '?'}]\n\n`
  )
  mockProcessFallback.mockImplementation(async file => ({ id: file.id }) as never)
})

describe('collectAttachmentMimeTypes', () => {
  it('is empty when nothing is attached', () => {
    expect(
      collectAttachmentMimeTypes([{ role: 'user', content: 'hello' }])
    ).toEqual([])
  })

  it('de-duplicates across messages', () => {
    const types = collectAttachmentMimeTypes([
      { role: 'user', content: 'a', attachments: [image('a'), image('b')] },
      { role: 'user', content: 'b', attachments: [image('c', 'image/webp')] },
    ])
    expect(types.sort()).toEqual(['image/png', 'image/webp'])
  })

  it('ignores entries that are not loaded attachments', () => {
    expect(
      collectAttachmentMimeTypes([
        { role: 'user', content: 'a', attachments: [{ some: 'other shape' }, image('a')] },
      ])
    ).toEqual(['image/png'])
  })
})

describe('adaptMessagesForProfile — nothing to do', () => {
  it('returns the same array reference when there are no attachments', async () => {
    mockNeedsFallback.mockReturnValue(false)
    const messages = [{ role: 'user', content: 'hello' }]

    await expect(adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')).resolves.toBe(messages)
    expect(mockProcessFallback).not.toHaveBeenCalled()
  })

  it('returns the same array reference when the substitute reads the bytes too', async () => {
    mockNeedsFallback.mockReturnValue(false)
    const messages = [{ role: 'user', content: 'look', attachments: [image('a')] }]

    await expect(adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')).resolves.toBe(messages)
    expect(mockProcessFallback).not.toHaveBeenCalled()
  })
})

describe('adaptMessagesForProfile — bug 106: the bytes a substitute cannot read', () => {
  it('replaces the bytes with a description and drops the attachments key', async () => {
    mockNeedsFallback.mockReturnValue(true)
    const messages = [{ role: 'user', content: 'What is this?', attachments: [image('a')] }]

    const [adapted] = await adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')

    expect(adapted.content).toBe('[described a]\n\nWhat is this?')
    expect(adapted).not.toHaveProperty('attachments')
    expect(mockProcessFallback).toHaveBeenCalledTimes(1)
  })

  it('leaves the caller\'s array untouched — the adaptation is a copy', async () => {
    mockNeedsFallback.mockReturnValue(true)
    const original = { role: 'user', content: 'What is this?', attachments: [image('a')] }

    const adapted = await adaptMessagesForProfile([original], PROFILE, {}, 'user-1')

    expect(adapted[0]).not.toBe(original)
    expect(original.content).toBe('What is this?')
    expect(original.attachments).toHaveLength(1)
  })

  it('keeps the attachments the substitute CAN read alongside the described ones', async () => {
    mockNeedsFallback.mockImplementation((_profile, mimeType) => mimeType === 'image/png')
    const messages = [
      {
        role: 'user',
        content: 'two files',
        attachments: [image('png-one'), image('doc-one', 'text/plain')],
      },
    ]

    const [adapted] = await adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')

    expect(adapted.content).toBe('[described png-one]\n\ntwo files')
    expect(adapted.attachments).toEqual([image('doc-one', 'text/plain')])
  })

  it('passes through an entry that is not a loaded attachment', async () => {
    mockNeedsFallback.mockReturnValue(true)
    const foreign = { some: 'other shape' }
    const messages = [
      { role: 'user', content: 'x', attachments: [foreign, image('a')] },
    ]

    const [adapted] = await adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')

    expect(adapted.attachments).toEqual([foreign])
  })

  it('carries every other field of a message through untouched', async () => {
    mockNeedsFallback.mockReturnValue(true)
    const messages = [
      { role: 'user', content: 'x', name: 'Aurelia', toolCalls: [], attachments: [image('a')] },
    ]

    const [adapted] = await adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')

    expect(adapted.name).toBe('Aurelia')
    expect(adapted.toolCalls).toEqual([])
  })

  it('leaves attachment-free messages in the array alone', async () => {
    mockNeedsFallback.mockReturnValue(true)
    const plain = { role: 'assistant', content: 'earlier reply' }
    const messages = [plain, { role: 'user', content: 'x', attachments: [image('a')] }]

    const adapted = await adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')

    expect(adapted[0]).toBe(plain)
  })
})

describe('adaptMessagesForProfile — a describer that fails', () => {
  it('notes the loss in the content and still returns a sendable array', async () => {
    mockNeedsFallback.mockReturnValue(true)
    mockProcessFallback.mockRejectedValue(new Error('describer unreachable'))
    const messages = [{ role: 'user', content: 'What is this?', attachments: [image('a')] }]

    const [adapted] = await adaptMessagesForProfile(messages, PROFILE, {}, 'user-1')

    expect(adapted.content).toContain('⚠️ Attachment Processing Failed: a.png')
    expect(adapted.content).toContain('describer unreachable')
    expect(adapted.content).toContain('What is this?')
    expect(adapted).not.toHaveProperty('attachments')
  })

  it('never throws — a degraded turn beats the gateway\'s 400', async () => {
    mockNeedsFallback.mockReturnValue(true)
    mockProcessFallback.mockRejectedValue(new Error('boom'))

    await expect(
      adaptMessagesForProfile(
        [{ role: 'user', content: 'x', attachments: [image('a')] }],
        PROFILE,
        {},
        'user-1'
      )
    ).resolves.toHaveLength(1)
  })
})
