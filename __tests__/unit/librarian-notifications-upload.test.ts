/**
 * Unit tests for postLibrarianUploadAnnouncement — the Librarian whisper that
 * exposes the UUID of every image attached to a user-uploaded chat message,
 * giving the LLM the handle it needs to call `describe_image` / `keep_image` /
 * `attach_image`.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { getRepositories } from '@/lib/repositories/factory'
import {
  buildUploadContent,
  postLibrarianUploadAnnouncement,
} from '@/lib/services/librarian-notifications/writer'

jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockGetRepositories = jest.mocked(getRepositories)

function makeRepos(opts: {
  chat?: Record<string, unknown> | null
  addMessage?: jest.Mock
}) {
  return {
    chats: {
      findById: jest.fn().mockResolvedValue(opts.chat ?? { id: 'c1' }),
      addMessage: opts.addMessage ?? jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as ReturnType<typeof getRepositories>
}

describe('buildUploadContent', () => {
  it('embeds the UUID inline for a single upload', () => {
    const content = buildUploadContent({
      chatId: 'c1',
      uploads: [{ fileId: 'photo-uuid-xyz', filename: 'sunset.png' }],
    })
    expect(content).toContain('photo-uuid-xyz')
    expect(content).toContain('sunset.png')
    // photo-album tool hints so the LLM knows what the UUID is for.
    expect(content).toContain('keep_image')
    // Bug 92: the looking verb must be named, and named FIRST — the old copy
    // offered only the two custodial verbs, so models reached for attach_image
    // when what they wanted was to see the picture.
    expect(content).toContain('describe_image')
    expect(content.indexOf('describe_image')).toBeLessThan(content.indexOf('attach_image'))
    // ...and attach_image must be disclaimed rather than merely mentioned.
    expect(content).toContain('neither of those shows it to you')
  })

  it('lists every UUID for a multi-upload', () => {
    const content = buildUploadContent({
      chatId: 'c1',
      uploads: [
        { fileId: 'uuid-1', filename: 'a.png' },
        { fileId: 'uuid-2', filename: 'b.png' },
      ],
    })
    expect(content).toContain('uuid-1')
    expect(content).toContain('uuid-2')
    expect(content).toContain('a.png')
    expect(content).toContain('b.png')
  })

  it('returns empty string when there are no uploads', () => {
    expect(buildUploadContent({ chatId: 'c1', uploads: [] })).toBe('')
  })
})

describe('postLibrarianUploadAnnouncement', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does nothing when the upload list is empty', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({ addMessage }))
    await postLibrarianUploadAnnouncement({ chatId: 'c1', uploads: [] })
    expect(addMessage).not.toHaveBeenCalled()
  })

  it('posts an ASSISTANT message authored by the Librarian with the UUID inline', async () => {
    const addMessage = jest.fn()
    mockGetRepositories.mockReturnValue(makeRepos({
      chat: { id: 'c1' },
      addMessage,
    }))

    await postLibrarianUploadAnnouncement({
      chatId: 'c1',
      uploads: [{ fileId: 'photo-uuid-xyz', filename: 'sunset.png' }],
    })

    expect(addMessage).toHaveBeenCalledTimes(1)
    const [chatIdArg, message] = addMessage.mock.calls[0] as [string, Record<string, unknown>]
    expect(chatIdArg).toBe('c1')
    expect(message.role).toBe('ASSISTANT')
    expect(message.systemSender).toBe('librarian')
    expect(message.systemKind).toBe('uploaded')
    expect(message.content as string).toContain('photo-uuid-xyz')
    // Bytes ride on the user's own message — the announcement itself
    // should not re-attach them.
    expect(message.attachments).toEqual([])
  })

  it('does not throw when addMessage fails', async () => {
    const addMessage = jest.fn().mockRejectedValue(new Error('DB offline'))
    mockGetRepositories.mockReturnValue(makeRepos({ addMessage }))
    await expect(
      postLibrarianUploadAnnouncement({
        chatId: 'c1',
        uploads: [{ fileId: 'f1', filename: 'x.png' }],
      })
    ).resolves.toBeNull()
  })
})
