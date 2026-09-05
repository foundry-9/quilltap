import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

jest.mock('@/lib/doc-edit', () => {
  class PathResolutionError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.name = 'PathResolutionError'
      this.code = code
    }
  }

  return {
    resolveDocEditPath: jest.fn(),
    readFileWithMtime: jest.fn(),
    writeFileWithMtimeCheck: jest.fn(),
    getAccessibleMountPoints: jest.fn().mockResolvedValue([]),
    isTextFile: jest.fn().mockReturnValue(true),
    PathResolutionError,
    findUniqueMatch: jest.fn(),
    findAllMatches: jest.fn(),
    reindexSingleFile: jest.fn(),
    parseFrontmatter: jest.fn(),
    updateFrontmatterInContent: jest.fn(),
    findHeadingSection: jest.fn(),
    readHeadingContent: jest.fn(),
    replaceHeadingContent: jest.fn(),
    generateUnifiedDiff: jest.fn().mockReturnValue('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b'),
  }
})

jest.mock('@/lib/doc-edit/mime-registry', () => ({
  detectMimeFromExtension: jest.fn(),
  isJsonFamily: jest.fn().mockReturnValue(false),
  isJsonMime: jest.fn().mockReturnValue(false),
  isJsonlMime: jest.fn().mockReturnValue(false),
  parseContent: jest.fn(),
  serializeContent: jest.fn(),
  validateJson: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  databaseDocumentExists: jest.fn().mockResolvedValue(true),
  databaseFolderExists: jest.fn().mockResolvedValue(false),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseFolder: jest.fn().mockResolvedValue(undefined),
  listDatabaseFiles: jest.fn(),
}))

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianOpenAnnouncement: jest.fn(),
  postLibrarianDeleteAnnouncement: jest.fn(),
  postLibrarianFolderCreatedAnnouncement: jest.fn(),
  postLibrarianFolderDeletedAnnouncement: jest.fn(),
  postLibrarianWriteAnnouncement: jest.fn(),
  postLibrarianMoveAnnouncement: jest.fn(),
  postLibrarianCopyAnnouncement: jest.fn(),
  postLibrarianBlobWriteAnnouncement: jest.fn(),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}))

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/blob-transcode', () => ({
  transcodeToWebP: jest.fn(),
  normaliseBlobRelativePath: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
}))

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: jest.fn(),
}))

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  readdir: jest.fn(),
  rmdir: jest.fn(),
}))

import { executeDocEditTool } from '@/lib/tools/handlers/doc-edit-handler'
import { resolveDocEditPath } from '@/lib/doc-edit'
import { getRepositories } from '@/lib/repositories/factory'
import {
  databaseDocumentExists,
  moveDatabaseDocument,
  moveDatabaseFolder,
} from '@/lib/mount-index/database-store'

const mockResolveDocEditPath = resolveDocEditPath as jest.Mock
const mockGetRepositories = getRepositories as jest.Mock
const mockDatabaseDocumentExists = databaseDocumentExists as jest.Mock
const mockMoveDatabaseDocument = moveDatabaseDocument as jest.Mock
const mockMoveDatabaseFolder = moveDatabaseFolder as jest.Mock

const mockRepos = {
  chats: { findById: jest.fn().mockResolvedValue(null) },
  characters: { findById: jest.fn().mockResolvedValue(null) },
  chatDocuments: {
    renameFilePathInStore: jest.fn().mockResolvedValue(1),
    renameFolderPathInStore: jest.fn().mockResolvedValue(2),
  },
  // Per-document policy gates look these up; no protected docs in these tests.
  docMountFileLinks: {
    findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    findByMountPointId: jest.fn().mockResolvedValue([]),
  },
}

const context = {
  userId: 'user-1',
  chatId: 'chat-1',
  characterId: 'char-1',
}

describe('doc-edit move handlers sync chat_documents pointers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(mockRepos)
    mockDatabaseDocumentExists.mockImplementation(async (_mountPointId: string, relativePath: string) => relativePath === 'old/name.md')
    mockMoveDatabaseDocument.mockResolvedValue(undefined)
    mockMoveDatabaseFolder.mockResolvedValue(undefined)
    mockRepos.chatDocuments.renameFilePathInStore.mockResolvedValue(1)
    mockRepos.chatDocuments.renameFolderPathInStore.mockResolvedValue(2)
  })

  it('doc_move_file updates chat_documents path in the same store', async () => {
    mockResolveDocEditPath
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'old/name.md',
      })
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'new/title.md',
      })

    const result = await executeDocEditTool(
      'doc_move_file',
      {
        scope: 'document_store',
        mount_point: 'Lore',
        path: 'old/name.md',
        new_path: 'new/title.md',
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockMoveDatabaseDocument).toHaveBeenCalledWith('mp-1', 'old/name.md', 'new/title.md')
    expect(mockRepos.chatDocuments.renameFilePathInStore).toHaveBeenCalledWith(
      'document_store',
      'Lore',
      'old/name.md',
      'new/title.md',
      'title.md',
    )
  })

  it('doc_move_folder updates nested chat_documents paths in the same store', async () => {
    mockResolveDocEditPath
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'old/folder',
      })
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'new/folder',
      })

    const result = await executeDocEditTool(
      'doc_move_folder',
      {
        scope: 'document_store',
        mount_point: 'Lore',
        path: 'old/folder',
        new_path: 'new/folder',
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockMoveDatabaseFolder).toHaveBeenCalledWith('mp-1', 'old/folder', 'new/folder')
    expect(mockRepos.chatDocuments.renameFolderPathInStore).toHaveBeenCalledWith(
      'document_store',
      'Lore',
      'old/folder',
      'new/folder',
    )
  })

  it('move still succeeds when chat_documents sync throws (best-effort behavior)', async () => {
    mockResolveDocEditPath
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'old/name.md',
      })
      .mockResolvedValueOnce({
        mountType: 'database',
        mountPointId: 'mp-1',
        mountPointName: 'Lore',
        relativePath: 'new/name.md',
      })

    mockRepos.chatDocuments.renameFilePathInStore.mockRejectedValue(new Error('db unavailable'))

    const result = await executeDocEditTool(
      'doc_move_file',
      {
        scope: 'document_store',
        mount_point: 'Lore',
        path: 'old/name.md',
        new_path: 'new/name.md',
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(result.formattedText).toContain('Moved: old/name.md')
  })
})
