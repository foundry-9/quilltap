/**
 * The file-library importer, and the two rules that keep it honest.
 *
 *  1. **`storageKey` never transfers.** The exporting instance's key names a
 *     location in *its* storage (commonly `mount-blob:<mountPointId>:<blobId>`,
 *     a row in that instance's mount-index database). Copying it verbatim
 *     produces a row whose bytes live nowhere. The bytes are re-written
 *     through this instance's own bridge and the key it returns is recorded.
 *  2. **Post-bridge mime/size win.** The bridges transcode bitmaps to WebP, so
 *     the archive's `mimeType`/`size` describe bytes that no longer exist once
 *     written. Recording the archive's values re-introduces the "media_type X
 *     but bytes are Y" class of error.
 *
 * Plus the `linkedTo` rule: an attachment pointing at something absent from
 * both the import and this instance is dropped, not kept. A dangling id is not
 * inert — `lib/cascade-delete.ts` reads `linkedTo` to decide whether a file is
 * still referenced, so a ghost reference keeps an orphan alive forever.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { uploadFile: jest.fn() },
}))

jest.mock('@/lib/file-storage/user-uploads-bridge', () => ({
  writeUserUploadToMountStore: jest.fn(),
}))

import { importFiles } from '@/lib/import/quilltap-import/import-files'
import { getRepositories } from '@/lib/repositories/factory'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge'
import type { IdMappingState, ImportOptions } from '@/lib/import/quilltap-import/types'

function emptyIdMaps(): IdMappingState {
  return {
    tags: new Map(),
    characters: new Map(),
    chats: new Map(),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints: new Map(),
  }
}

const OPTIONS: ImportOptions = {
  conflictStrategy: 'duplicate',
  includeMemories: false,
  includeRelatedEntities: true,
}

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    sha256: 'a'.repeat(64),
    originalFilename: 'plate.png',
    mimeType: 'image/png',
    size: 1234,
    linkedTo: [],
    tags: [],
    source: 'UPLOAD',
    category: 'IMAGE',
    projectId: null,
    folderPath: '/plates/',
    dataBase64: Buffer.from('some bytes').toString('base64'),
    _sourceStorageKey: 'mount-blob:mp-elsewhere:blob-elsewhere',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('importFiles', () => {
  let filesCreate: jest.Mock
  let foldersCreate: jest.Mock
  let foldersFindByPath: jest.Mock
  let repos: Record<string, unknown>
  let warnings: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    warnings = []

    filesCreate = jest.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      id: 'file-new',
    }))
    foldersCreate = jest
      .fn()
      .mockImplementation(async (data: Record<string, unknown>) => ({ ...data, id: 'folder-new' }))
    foldersFindByPath = jest.fn().mockResolvedValue(null)

    repos = {
      files: { findById: jest.fn().mockResolvedValue(null), create: filesCreate, delete: jest.fn() },
      chats: { findById: jest.fn().mockResolvedValue(null), getMessages: jest.fn().mockResolvedValue([]) },
      characters: { findById: jest.fn().mockResolvedValue(null) },
      projects: { findById: jest.fn().mockResolvedValue(null) },
    }

    ;(getRepositories as jest.Mock).mockReturnValue({
      folders: { create: foldersCreate, findByPath: foldersFindByPath },
    })

    // The project-less path: this is what the uploads bridge hands back.
    ;(writeUserUploadToMountStore as jest.Mock).mockResolvedValue({
      storageKey: 'mount-blob:mp-here:blob-here',
      storedMimeType: 'image/webp',
      sizeBytes: 999,
    })
    ;(fileStorageManager.uploadFile as jest.Mock).mockResolvedValue({
      storageKey: 'mount-blob:mp-project:blob-project',
      storedMimeType: 'image/webp',
      sizeBytes: 888,
    })
  })

  it('discards the exporting instance storage key and records this instance\'s', async () => {
    const counts = await importFiles(
      'user-1',
      [makeFile()] as never,
      [],
      OPTIONS,
      repos as never,
      emptyIdMaps(),
      warnings
    )

    expect(counts.files).toBe(1)
    const created = filesCreate.mock.calls[0][0] as Record<string, unknown>
    expect(created.storageKey).toBe('mount-blob:mp-here:blob-here')
    // Provenance fields and the raw bytes must not land in the row.
    expect(created).not.toHaveProperty('_sourceStorageKey')
    expect(created).not.toHaveProperty('dataBase64')
    expect(created).not.toHaveProperty('_bytesMissing')
  })

  it('records the post-bridge mime type and size, not the archive\'s', async () => {
    await importFiles('user-1', [makeFile()] as never, [], OPTIONS, repos as never, emptyIdMaps(), warnings)

    const created = filesCreate.mock.calls[0][0] as Record<string, unknown>
    // The archive said image/png at 1234 bytes; the bridge transcoded.
    expect(created.mimeType).toBe('image/webp')
    expect(created.size).toBe(999)
  })

  it('routes a project-bound file through the project store bridge', async () => {
    const idMaps = emptyIdMaps()
    idMaps.projects.set('proj-old', 'proj-new')

    await importFiles(
      'user-1',
      [makeFile({ projectId: 'proj-old' })] as never,
      [],
      OPTIONS,
      repos as never,
      idMaps,
      warnings
    )

    expect(fileStorageManager.uploadFile).toHaveBeenCalledTimes(1)
    expect(writeUserUploadToMountStore).not.toHaveBeenCalled()
    const created = filesCreate.mock.calls[0][0] as Record<string, unknown>
    expect(created.projectId).toBe('proj-new')
    expect(created.storageKey).toBe('mount-blob:mp-project:blob-project')
  })

  it('skips a file whose bytes never made it into the archive', async () => {
    const counts = await importFiles(
      'user-1',
      [makeFile({ dataBase64: undefined, _bytesMissing: true })] as never,
      [],
      OPTIONS,
      repos as never,
      emptyIdMaps(),
      warnings
    )

    expect(counts.files).toBe(0)
    expect(counts.skipped).toBe(1)
    expect(filesCreate).not.toHaveBeenCalled()
    expect(warnings.some((w) => w.includes('without its contents'))).toBe(true)
  })

  it('keeps a link the import remapped, keeps one that already exists here, drops the rest', async () => {
    const idMaps = emptyIdMaps()
    idMaps.characters.set('char-old', 'char-new')
    // A chat that was not part of the import but does exist on this instance.
    ;(repos.chats as { findById: jest.Mock }).findById.mockImplementation(async (id: string) =>
      id === 'chat-already-here' ? { id } : null
    )

    await importFiles(
      'user-1',
      [makeFile({ linkedTo: ['char-old', 'chat-already-here', 'ghost-entity'] })] as never,
      [],
      OPTIONS,
      repos as never,
      idMaps,
      warnings
    )

    const created = filesCreate.mock.calls[0][0] as Record<string, unknown>
    expect(created.linkedTo).toEqual(['char-new', 'chat-already-here'])
    expect(warnings.some((w) => w.includes('were dropped'))).toBe(true)
  })

  it('keeps a message id whose parent chat resolved', async () => {
    // chat-files-v2 writes [chatId, messageId]; dropping the finer link while
    // keeping the chat would quietly detach the attachment from its message.
    ;(repos.chats as { findById: jest.Mock; getMessages: jest.Mock }).findById.mockImplementation(
      async (id: string) => (id === 'chat-1' ? { id } : null)
    )
    ;(repos.chats as { getMessages: jest.Mock }).getMessages.mockResolvedValue([
      { id: 'msg-1', type: 'message' },
    ])

    await importFiles(
      'user-1',
      [makeFile({ linkedTo: ['chat-1', 'msg-1'] })] as never,
      [],
      OPTIONS,
      repos as never,
      emptyIdMaps(),
      warnings
    )

    const created = filesCreate.mock.calls[0][0] as Record<string, unknown>
    expect(created.linkedTo).toEqual(['chat-1', 'msg-1'])
  })

  it('creates folders parents-first and reuses one that already exists', async () => {
    foldersFindByPath.mockImplementation(async (_u: string, path: string) =>
      path === '/plates/' ? { id: 'folder-existing' } : null
    )

    const counts = await importFiles(
      'user-1',
      [],
      [
        { id: 'f-child', path: '/plates/etchings/', name: 'etchings', parentFolderId: 'f-parent' },
        { id: 'f-parent', path: '/plates/', name: 'plates', parentFolderId: null },
      ] as never,
      OPTIONS,
      repos as never,
      emptyIdMaps(),
      warnings
    )

    // The parent already existed and was reused, not duplicated.
    expect(counts.folders).toBe(1)
    expect(foldersCreate).toHaveBeenCalledTimes(1)
    const created = foldersCreate.mock.calls[0][0] as Record<string, unknown>
    expect(created.path).toBe('/plates/etchings/')
    // …and the child points at the folder that was already here.
    expect(created.parentFolderId).toBe('folder-existing')
  })
})
