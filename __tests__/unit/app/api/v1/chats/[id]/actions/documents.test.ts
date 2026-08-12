import { describe, expect, it, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/doc-edit', () => ({
  resolveDocEditPath: jest.fn(),
  readFileWithMtime: jest.fn(),
  writeFileWithMtimeCheck: jest.fn(),
  reindexSingleFile: jest.fn(),
  isTextFile: jest.fn((filePath: string) => /\.(md|markdown|txt|json|jsonl|ndjson|yaml|yml|xml|html|htm|css|js|ts|jsx|tsx|py|rb|sh|bash|zsh|csv|toml|ini|cfg|conf|log|env)$/i.test(filePath) || filePath.endsWith('.gitignore') || filePath.endsWith('.editorconfig')),
}))

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}))

class MockDatabaseStoreError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'DatabaseStoreError'
  }
}

jest.mock('@/lib/mount-index/database-store', () => ({
  moveDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
  DatabaseStoreError: MockDatabaseStoreError,
}))

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianOpenAnnouncement: jest.fn().mockResolvedValue(null),
  postLibrarianSaveAnnouncement: jest.fn().mockResolvedValue(null),
  postLibrarianRenameAnnouncement: jest.fn().mockResolvedValue(null),
  postLibrarianDeleteAnnouncement: jest.fn().mockResolvedValue(null),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
}))

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
  access: jest.fn(),
  rename: jest.fn(),
}))

const {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
} = require('@/lib/doc-edit')

const fsp = require('fs/promises')

const {
  handleRecentDocuments,
  handleActiveDocument,
  handleOpenDocument,
  handleWriteDocument,
  handleResolveDocument,
} = require('@/app/api/v1/chats/[id]/actions/documents')

describe('chats [id] document actions', () => {
  let ctx: any

  beforeEach(() => {
    jest.clearAllMocks()

    ctx = {
      repos: {
        chats: {
          findById: jest.fn(),
          update: jest.fn(),
        },
        chatDocuments: {
          findByChatId: jest.fn(),
          findRecentAcrossChats: jest.fn().mockResolvedValue([]),
          findActiveForChat: jest.fn(),
          openDocument: jest.fn(),
        },
        docMountFileLinks: {
          findByMountPointAndPath: jest.fn(),
        },
        docMountBlobs: {
          findByFileId: jest.fn(),
        },
        docMountPoints: {
          refreshStats: jest.fn(),
        },
      },
    }
  })

  it('returns recent documents sorted by newest first, including active and inactive documents', async () => {
    const chatId = 'chat-1'
    const now = new Date('2026-04-15T10:00:00.000Z')
    const docs = Array.from({ length: 12 }, (_, index) => {
      const isActive = index % 2 === 0
      const updatedAt = new Date(now.getTime() - index * 60000).toISOString()
      return {
        id: `doc-${index}`,
        chatId,
        filePath: `file-${index}.md`,
        scope: index % 3 === 0 ? 'document_store' : 'project',
        mountPoint: index % 3 === 0 ? 'Docs' : null,
        displayTitle: `File ${index}`,
        isActive,
        updatedAt,
        createdAt: updatedAt,
      }
    }).reverse()

    // This chat's own documents lead the list; the cross-chat window adds
    // nothing new here (it returns the same rows, which dedupe away).
    ctx.repos.chatDocuments.findByChatId.mockResolvedValueOnce(docs)
    ctx.repos.chatDocuments.findRecentAcrossChats.mockResolvedValueOnce(docs)

    const response = await handleRecentDocuments(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(ctx.repos.chatDocuments.findByChatId).toHaveBeenCalledWith(chatId)
    expect(body.documents).toHaveLength(10)
    expect(body.documents[0].id).toBe('doc-0')
    expect(body.documents[1].id).toBe('doc-1')
    expect(body.documents.some((doc: any) => doc.isActive === true)).toBe(true)
    expect(body.documents.some((doc: any) => doc.isActive === false)).toBe(true)
    // Every returned row belongs to this chat, so all carry fromCurrentChat.
    expect(body.documents.every((doc: any) => doc.fromCurrentChat === true)).toBe(true)
  })

  it('lists this chat first, then deduped documents from other chats, capped at the max', async () => {
    const chatId = 'chat-1'
    const now = new Date('2026-04-15T10:00:00.000Z')
    // Two docs in this chat (newest), plus an other-chat doc, plus an other-chat
    // duplicate of a this-chat file (same scope+mountPoint+path) that must collapse.
    const mine = [
      { id: 'mine-0', chatId, filePath: 'a.md', scope: 'project', mountPoint: null,
        displayTitle: 'A', isActive: true, updatedAt: now.toISOString(), createdAt: now.toISOString() },
      { id: 'mine-1', chatId, filePath: 'b.md', scope: 'project', mountPoint: null,
        displayTitle: 'B', isActive: false, updatedAt: new Date(now.getTime() - 60000).toISOString(), createdAt: now.toISOString() },
    ]
    const others = [
      // duplicate of mine-0's file but updated more recently in another chat —
      // dedupe must keep the this-chat attribution and drop this one.
      { id: 'other-dup', chatId: 'chat-2', filePath: 'a.md', scope: 'project', mountPoint: null,
        displayTitle: 'A', isActive: true, updatedAt: new Date(now.getTime() + 60000).toISOString(), createdAt: now.toISOString() },
      { id: 'other-new', chatId: 'chat-2', filePath: 'c.md', scope: 'project', mountPoint: null,
        displayTitle: 'C', isActive: true, updatedAt: new Date(now.getTime() - 120000).toISOString(), createdAt: now.toISOString() },
    ]

    ctx.repos.chatDocuments.findByChatId.mockResolvedValueOnce(mine)
    ctx.repos.chatDocuments.findRecentAcrossChats.mockResolvedValueOnce([...others, ...mine])

    const response = await handleRecentDocuments(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    // this chat's two docs first, then the one genuinely-new other-chat doc
    expect(body.documents.map((d: any) => d.id)).toEqual(['mine-0', 'mine-1', 'other-new'])
    expect(body.documents[0].fromCurrentChat).toBe(true)
    expect(body.documents[2].fromCurrentChat).toBe(false)
    // an other-chat row is never reported as the active doc for this chat
    expect(body.documents[2].isActive).toBe(false)
  })

  it('returns active document metadata when one exists', async () => {
    const chatId = 'chat-1'
    ctx.repos.chatDocuments.findActiveForChat.mockResolvedValueOnce({
      id: 'doc-1',
      chatId,
      filePath: 'notes/outline.md',
      scope: 'document_store',
      mountPoint: 'Docs',
      displayTitle: 'outline.md',
      isActive: true,
      createdAt: '2026-04-15T10:00:00.000Z',
      updatedAt: '2026-04-15T10:00:00.000Z',
    })

    const response = await handleActiveDocument(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.document).toEqual({
      id: 'doc-1',
      filePath: 'notes/outline.md',
      scope: 'document_store',
      mountPoint: 'Docs',
      displayTitle: 'outline.md',
    })
  })

  it('returns null active document when no document is open', async () => {
    const chatId = 'chat-1'
    ctx.repos.chatDocuments.findActiveForChat.mockResolvedValueOnce(null)

    const response = await handleActiveDocument(chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.document).toBeNull()
  })

  it('stores blank documents under general scope when the chat has no project', async () => {
    const chatId = 'chat-blank'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: null })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '/tmp/Untitled Document.md',
      scope: 'general',
      relativePath: 'Untitled Document.md',
    })
    // pickUntitledDocumentPath probes existence via fs.access. ENOENT means
    // the candidate name is free, so the first attempt ("Untitled Document.md")
    // wins and we don't need additional resolve/access mocks.
    const fs = require('fs/promises')
    fs.access.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    writeFileWithMtimeCheck.mockResolvedValueOnce({ mtime: 987654321 })
    ctx.repos.chatDocuments.openDocument.mockImplementationOnce(async (_chatId: string, data: any) => ({
      id: 'doc-blank',
      ...data,
    }))

    const request = {
      json: jest.fn().mockResolvedValue({ title: 'Blank draft' }),
    } as any

    const response = await handleOpenDocument(request, chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(ctx.repos.chatDocuments.openDocument).toHaveBeenCalledWith(
      chatId,
      expect.objectContaining({
        scope: 'general',
        displayTitle: 'Blank draft',
      })
    )
    expect(body.document.scope).toBe('general')
  })

  it('writes document content with mtime conflict protection when provided', async () => {
    const chatId = 'chat-write'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'project-1' })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '/tmp/project/doc.md',
      scope: 'project',
      relativePath: 'doc.md',
      mountPointId: null,
    })
    writeFileWithMtimeCheck.mockResolvedValueOnce({ mtime: 123456789 })

    const request = {
      json: jest.fn().mockResolvedValue({
        filePath: 'doc.md',
        scope: 'project',
        content: '# Updated',
        mtime: 111,
      }),
    } as any

    const response = await handleWriteDocument(request, chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(writeFileWithMtimeCheck).toHaveBeenCalledWith(
      expect.objectContaining({ absolutePath: '/tmp/project/doc.md', scope: 'project', relativePath: 'doc.md' }),
      '# Updated',
      111
    )
    expect(body).toMatchObject({ success: true, mtime: 123456789 })
  })

  it('passes participant character IDs into path resolution so character vaults are reachable', async () => {
    const chatId = 'chat-vault'
    ctx.repos.chats.findById.mockResolvedValueOnce({
      id: chatId,
      projectId: 'project-1',
      participants: [
        { characterId: 'char-friday', type: 'CHARACTER', status: 'active' },
        { characterId: 'char-user', type: 'CHARACTER', status: 'active' },
      ],
    })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '',
      scope: 'document_store',
      mountPointId: 'mount-1',
      mountPointName: 'Friday Character Vault',
      mountType: 'database',
      basePath: '',
      relativePath: 'properties.json',
    })
    readFileWithMtime.mockResolvedValueOnce({ content: '{}', mtime: 42, size: 2 })
    ctx.repos.chatDocuments.openDocument.mockImplementationOnce(async (_chatId: string, data: any) => ({
      id: 'doc-vault',
      ...data,
    }))

    const request = {
      json: jest.fn().mockResolvedValue({
        filePath: 'properties.json',
        scope: 'document_store',
        mountPoint: 'Friday Character Vault',
      }),
    } as any

    const response = await handleOpenDocument(request, chatId, ctx)
    expect(response.status).toBe(200)
    expect(resolveDocEditPath).toHaveBeenCalledWith(
      'document_store',
      'properties.json',
      expect.objectContaining({
        projectId: 'project-1',
        characterIds: ['char-friday', 'char-user'],
        mountPoint: 'Friday Character Vault',
      })
    )
  })

  it('returns a conflict when the document changed on disk before saving', async () => {
    const chatId = 'chat-conflict'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'project-1' })
    resolveDocEditPath.mockResolvedValueOnce({
      absolutePath: '/tmp/project/doc.md',
      scope: 'project',
      relativePath: 'doc.md',
      mountPointId: null,
    })
    writeFileWithMtimeCheck.mockRejectedValueOnce(new Error('File was modified by another process (mtime mismatch). Please reload and try again.'))

    const request = {
      json: jest.fn().mockResolvedValue({
        filePath: 'doc.md',
        scope: 'project',
        content: '# Updated again',
        mtime: 222,
      }),
    } as any

    const response = await handleWriteDocument(request, chatId, ctx)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toMatch(/reload/i)
  })

  // --- resolve-document (existence gate for clickable qtap:// links) ---

  function resolveReq(body: Record<string, unknown>) {
    return { json: jest.fn().mockResolvedValue(body) } as any
  }

  it('resolve-document returns { exists: true } for a real file WITHOUT reading bytes', async () => {
    const chatId = 'chat-1'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'p1', participants: [] })
    resolveDocEditPath.mockResolvedValueOnce({
      mountType: 'filesystem',
      absolutePath: '/tmp/store/today.md',
      scope: 'document_store',
      relativePath: 'today.md',
      mountPointId: 'm1',
      mountPointName: 'Notes',
    })
    fsp.access.mockResolvedValueOnce(undefined)

    const response = await handleResolveDocument(
      resolveReq({ filePath: 'today.md', scope: 'document_store', mountPoint: 'Notes' }),
      chatId,
      ctx
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.exists).toBe(true)
    expect(body.kind).toBe('document')
    // The probe must never return the document's bytes.
    expect(readFileWithMtime).not.toHaveBeenCalled()
  })

  it('resolve-document returns { exists: true, kind: image } for image targets', async () => {
    const chatId = 'chat-1'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'p1', participants: [] })
    resolveDocEditPath.mockResolvedValueOnce({
      mountType: 'filesystem',
      absolutePath: '/tmp/store/cover.webp',
      scope: 'document_store',
      relativePath: 'cover.webp',
      mountPointId: 'm1',
      mountPointName: 'Notes',
    })
    fsp.access.mockResolvedValueOnce(undefined)

    const response = await handleResolveDocument(
      resolveReq({ filePath: 'cover.webp', scope: 'document_store', mountPoint: 'Notes' }),
      chatId,
      ctx
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.exists).toBe(true)
    expect(body.kind).toBe('image')
  })

  it('resolve-document returns { exists: false } for a missing file', async () => {
    const chatId = 'chat-1'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'p1', participants: [] })
    resolveDocEditPath.mockResolvedValueOnce({
      mountType: 'filesystem',
      absolutePath: '/tmp/store/missing.md',
      scope: 'document_store',
      relativePath: 'missing.md',
      mountPointId: 'm1',
      mountPointName: 'Notes',
    })
    fsp.access.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }))

    const response = await handleResolveDocument(
      resolveReq({ filePath: 'missing.md', scope: 'document_store', mountPoint: 'Notes' }),
      chatId,
      ctx
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.exists).toBe(false)
    expect(body.kind).toBe('other')
  })

  it('resolve-document returns { exists: false } for an inaccessible / unresolvable store', async () => {
    const chatId = 'chat-1'
    ctx.repos.chats.findById.mockResolvedValueOnce({ id: chatId, projectId: 'p1', participants: [] })
    resolveDocEditPath.mockRejectedValueOnce(new MockDatabaseStoreError('access denied', 'ACCESS_DENIED'))

    const response = await handleResolveDocument(
      resolveReq({ filePath: 'secret.md', scope: 'document_store', mountPoint: 'Forbidden' }),
      chatId,
      ctx
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.exists).toBe(false)
    expect(body.kind).toBe('other')
    expect(readFileWithMtime).not.toHaveBeenCalled()
  })
})
