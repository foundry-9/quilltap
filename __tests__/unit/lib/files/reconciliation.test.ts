/**
 * Unit tests for lib/file-storage/reconciliation.ts
 *
 * Tests the filesystem reconciliation logic that runs at startup to sync
 * the database with what is actually on disk. Covers safety around orphaned
 * file cleanup: character-referenced files and linkedTo files must not be
 * deleted, SHA-256 cross-matching detects moves rather than orphans, and
 * edge cases like empty scans and missing files are handled gracefully.
 */

// ---------------------------------------------------------------------------
// Mocks — jest.mock calls are hoisted, so we use inline jest.fn() references
// and access them via the imported modules after mocking.
// ---------------------------------------------------------------------------

jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

jest.mock('@/lib/paths', () => ({
  getFilesDir: jest.fn().mockReturnValue('/mock/files'),
}))

jest.mock('@/lib/files/folder-utils', () => ({
  deriveFolderPathFromStorageKey: jest.fn().mockImplementation((key: string) => {
    const parts = key.split('/')
    if (parts.length <= 2) return '/'
    return '/' + parts.slice(1, -1).join('/')
  }),
}))

jest.mock('@/lib/file-storage/scanner', () => ({
  scanDirectory: jest.fn(),
  computeSha256: jest.fn(),
  detectMimeType: jest.fn().mockReturnValue('image/png'),
}))

// These repo mocks are set up in beforeEach and configured on the
// getRepositories mock return value. We store references here for assertions.
let mockFilesRepo: {
  findByUserId: jest.Mock
  create: jest.Mock
  update: jest.Mock
  delete: jest.Mock
}

let mockCharactersRepo: {
  findAllRaw: jest.Mock
}

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/auth/single-user', () => ({
  getOrCreateSingleUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
}))

// ---------------------------------------------------------------------------
// Import under test + mocked modules
// ---------------------------------------------------------------------------

import { reconcileFilesystem } from '@/lib/file-storage/reconciliation'
import { getFilesDir } from '@/lib/paths'
import { deriveFolderPathFromStorageKey } from '@/lib/files/folder-utils'
import { scanDirectory, computeSha256, detectMimeType } from '@/lib/file-storage/scanner'
import { getRepositories } from '@/lib/database/repositories'

const mockGetFilesDir = getFilesDir as jest.MockedFunction<typeof getFilesDir>
const mockDeriveFolder = deriveFolderPathFromStorageKey as jest.MockedFunction<typeof deriveFolderPathFromStorageKey>
const mockScanDirectory = scanDirectory as jest.MockedFunction<typeof scanDirectory>
const mockComputeSha256 = computeSha256 as jest.MockedFunction<typeof computeSha256>
const mockDetectMimeType = detectMimeType as jest.MockedFunction<typeof detectMimeType>
const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScannedFile(relativePath: string, size = 1024) {
  const name = relativePath.split('/').pop()!
  return {
    relativePath,
    name,
    size,
    mtime: new Date(),
    isDirectory: false,
  }
}

function makeDbRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-' + Math.random().toString(36).substring(2, 8),
    userId: 'user-1',
    storageKey: 'project-1/image.png',
    originalFilename: 'image.png',
    mimeType: 'image/png',
    size: 1024,
    sha256: 'abc123def456',
    linkedTo: [],
    folderPath: '/',
    projectId: 'project-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()

  mockFilesRepo = {
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }

  mockCharactersRepo = {
    findAllRaw: jest.fn().mockResolvedValue([]),
  }

  mockGetRepositories.mockReturnValue({
    files: mockFilesRepo,
    characters: mockCharactersRepo,
  } as any)

  mockGetFilesDir.mockReturnValue('/mock/files')
})

describe('reconcileFilesystem', () => {
  // =========================================================================
  // 1. Files referenced by characters are NOT deleted during cleanup
  // =========================================================================

  describe('character-referenced file safety', () => {
    it('preserves files referenced as character defaultImageId even when missing from disk', async () => {
      const dbRecord = makeDbRecord({
        id: 'avatar-file-1',
        storageKey: 'project-1/avatar.png',
      })

      // DB has one record, disk has nothing
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockScanDirectory.mockResolvedValue([])

      // Character references this file as default avatar
      mockCharactersRepo.findAllRaw.mockResolvedValue([
        {
          id: 'char-1',
          defaultImageId: 'avatar-file-1',
          avatarOverrides: [],
        },
      ])

      await reconcileFilesystem()

      // The file record should NOT be deleted
      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('preserves files referenced in character avatarOverrides even when missing from disk', async () => {
      const dbRecord = makeDbRecord({
        id: 'override-file-1',
        storageKey: 'project-1/override-avatar.png',
      })

      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockScanDirectory.mockResolvedValue([])

      mockCharactersRepo.findAllRaw.mockResolvedValue([
        {
          id: 'char-1',
          defaultImageId: null,
          avatarOverrides: [{ imageId: 'override-file-1', mood: 'happy' }],
        },
      ])

      await reconcileFilesystem()

      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('preserves an archived character\'s bundle (archiveFileId) even when missing from disk', async () => {
      // The bundle row stores the PLAINTEXT sha256 while disk bytes are
      // encrypted, so the sha256 cross-match can never rescue it — only the
      // reference set keeps it alive when the bytes are absent at boot.
      const bundleRow = makeDbRecord({
        id: 'archive-file-1',
        storageKey: 'archive-file-1/character-archive.qtap',
        category: 'ARCHIVE',
        folderPath: '/archives',
      })

      mockFilesRepo.findByUserId.mockResolvedValue([bundleRow])
      mockScanDirectory.mockResolvedValue([])

      mockCharactersRepo.findAllRaw.mockResolvedValue([
        {
          id: 'char-1',
          defaultImageId: null,
          avatarOverrides: [],
          archivedAt: '2026-08-10T00:00:00.000Z',
          archiveFileId: 'archive-file-1',
        },
      ])

      await reconcileFilesystem()

      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('preserves files referenced by multiple characters', async () => {
      const sharedFile = makeDbRecord({
        id: 'shared-file-1',
        storageKey: 'project-1/shared.png',
      })

      mockFilesRepo.findByUserId.mockResolvedValue([sharedFile])
      mockScanDirectory.mockResolvedValue([])

      mockCharactersRepo.findAllRaw.mockResolvedValue([
        { id: 'char-1', defaultImageId: 'shared-file-1', avatarOverrides: [] },
        {
          id: 'char-2',
          defaultImageId: null,
          avatarOverrides: [{ imageId: 'shared-file-1', mood: 'default' }],
        },
      ])

      await reconcileFilesystem()

      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // 2. Files with linkedTo references are preserved
  // =========================================================================

  describe('linkedTo reference safety', () => {
    it('preserves DB records with non-empty linkedTo even when file is missing from disk', async () => {
      const dbRecord = makeDbRecord({
        id: 'linked-file-1',
        storageKey: 'project-1/linked.png',
        linkedTo: ['chat-1', 'message-5'],
      })

      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockScanDirectory.mockResolvedValue([])

      await reconcileFilesystem()

      // Should not delete because linkedTo is not empty
      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('deletes DB records with empty linkedTo when file is missing from disk and not character-referenced', async () => {
      const dbRecord = makeDbRecord({
        id: 'orphan-file-1',
        storageKey: 'project-1/orphan.png',
        linkedTo: [],
      })

      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockScanDirectory.mockResolvedValue([])

      await reconcileFilesystem()

      expect(mockFilesRepo.delete).toHaveBeenCalledWith('orphan-file-1')
    })
  })

  // =========================================================================
  // 3. Orphaned files (on disk but not in DB) are detected correctly
  // =========================================================================

  describe('orphaned file detection', () => {
    it('creates DB records for files on disk with no matching DB entry', async () => {
      const scannedFile = makeScannedFile('project-1/new-image.png', 2048)

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-new-image')
      mockDetectMimeType.mockReturnValue('image/png')

      await reconcileFilesystem()

      expect(mockFilesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sha256: 'sha256-new-image',
          originalFilename: 'new-image.png',
          mimeType: 'image/png',
          size: 2048,
          storageKey: 'project-1/new-image.png',
          fileStatus: 'orphaned',
        })
      )
    })

    it('detects multiple orphaned files in a single scan', async () => {
      const files = [
        makeScannedFile('project-1/file-a.png', 1000),
        makeScannedFile('project-1/file-b.jpg', 2000),
        makeScannedFile('_general/file-c.txt', 3000),
      ]

      mockScanDirectory.mockResolvedValue(files)
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-generic')
      mockDetectMimeType.mockReturnValue('application/octet-stream')

      await reconcileFilesystem()

      expect(mockFilesRepo.create).toHaveBeenCalledTimes(3)
    })

    it('sets projectId to null for files in _general directory', async () => {
      const scannedFile = makeScannedFile('_general/document.txt', 500)

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-general')
      mockDetectMimeType.mockReturnValue('text/plain')

      await reconcileFilesystem()

      expect(mockFilesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          storageKey: '_general/document.txt',
        })
      )
    })

    it('sets projectId to the directory name for project files when it is a valid UUID', async () => {
      const projectId = 'b2e1f0d9-6c4a-4f2b-8a3d-1e2f3a4b5c6d'
      const scannedFile = makeScannedFile(`${projectId}/photo.jpg`, 4000)

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-project')
      mockDetectMimeType.mockReturnValue('image/jpeg')

      await reconcileFilesystem()

      expect(mockFilesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
        })
      )
    })

    it('collapses non-UUID top-level segments (e.g. migration archives) to projectId=null', async () => {
      const scannedFile = makeScannedFile(
        'b2e1f0d9-6c4a-4f2b-8a3d-1e2f3a4b5c6d_doc_store_archive/leftover.jpg',
        4000
      )

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-archive')
      mockDetectMimeType.mockReturnValue('image/jpeg')

      await reconcileFilesystem()

      expect(mockFilesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
        })
      )
    })
  })

  // =========================================================================
  // 4. Files matched by SHA-256 are treated as moves, not orphans
  // =========================================================================

  describe('SHA-256 cross-matching (file move detection)', () => {
    it('updates storage key when SHA-256 matches an unmatched DB record', async () => {
      const sha256 = 'deadbeefcafebabe0123456789abcdef'

      // File on disk has a new path
      const scannedFile = makeScannedFile('project-1/subfolder/moved-image.png', 1024)

      // DB record has the old path but same SHA-256
      const dbRecord = makeDbRecord({
        id: 'moved-file-1',
        storageKey: 'project-1/old-path/image.png',
        sha256,
        size: 1024,
      })

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockComputeSha256.mockResolvedValue(sha256)

      await reconcileFilesystem()

      // Should update the existing record, not create a new one
      expect(mockFilesRepo.update).toHaveBeenCalledWith(
        'moved-file-1',
        expect.objectContaining({
          storageKey: 'project-1/subfolder/moved-image.png',
          originalFilename: 'moved-image.png',
        })
      )
      expect(mockFilesRepo.create).not.toHaveBeenCalled()
      // Should NOT delete the matched record
      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('does not match the same DB record to multiple disk files', async () => {
      const sha256 = 'samesha256forduplicates'

      // Two files on disk with same content but different paths, neither in DB by storageKey
      const file1 = makeScannedFile('project-1/copy1.png', 1024)
      const file2 = makeScannedFile('project-1/copy2.png', 1024)

      // One DB record with matching SHA-256
      const dbRecord = makeDbRecord({
        id: 'original-file',
        storageKey: 'project-1/original.png',
        sha256,
      })

      mockScanDirectory.mockResolvedValue([file1, file2])
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockComputeSha256.mockResolvedValue(sha256)

      await reconcileFilesystem()

      // First file should be matched as a move (update)
      expect(mockFilesRepo.update).toHaveBeenCalledTimes(1)
      // Second file should be created as a new orphaned record
      expect(mockFilesRepo.create).toHaveBeenCalledTimes(1)
    })
  })

  // =========================================================================
  // 5. Empty filesystem scan returns without errors
  // =========================================================================

  describe('empty filesystem handling', () => {
    it('completes without errors when disk is empty and DB is empty', async () => {
      mockScanDirectory.mockResolvedValue([])
      mockFilesRepo.findByUserId.mockResolvedValue([])

      await reconcileFilesystem()

      expect(mockFilesRepo.create).not.toHaveBeenCalled()
      expect(mockFilesRepo.update).not.toHaveBeenCalled()
      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('completes without errors when disk is empty but DB has records', async () => {
      const dbRecord = makeDbRecord({
        id: 'stale-file',
        storageKey: 'project-1/gone.png',
        linkedTo: [],
      })

      mockScanDirectory.mockResolvedValue([])
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])

      await reconcileFilesystem()

      // Should delete the stale record since it is not referenced
      expect(mockFilesRepo.delete).toHaveBeenCalledWith('stale-file')
    })

    it('completes without errors when disk has files but DB is empty', async () => {
      const scannedFile = makeScannedFile('project-1/lonely.png', 512)

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-lonely')

      await reconcileFilesystem()

      // Should create a new orphaned record
      expect(mockFilesRepo.create).toHaveBeenCalledTimes(1)
    })

    it('filters out directory entries from scanned results', async () => {
      const dirEntry = {
        relativePath: 'project-1',
        name: 'project-1',
        size: 0,
        mtime: new Date(),
        isDirectory: true,
      }
      const fileEntry = makeScannedFile('project-1/file.png', 1024)

      mockScanDirectory.mockResolvedValue([dirEntry, fileEntry])
      mockFilesRepo.findByUserId.mockResolvedValue([])
      mockComputeSha256.mockResolvedValue('sha256-file')

      await reconcileFilesystem()

      // Only one file record should be created (directory entry is skipped)
      expect(mockFilesRepo.create).toHaveBeenCalledTimes(1)
    })
  })

  // =========================================================================
  // 6. DB records without matching files are handled
  // =========================================================================

  describe('stale DB record cleanup', () => {
    it('deletes unreferenced DB records when their file is missing from disk', async () => {
      const staleRecord = makeDbRecord({
        id: 'stale-1',
        storageKey: 'project-1/deleted.png',
        linkedTo: [],
      })

      mockScanDirectory.mockResolvedValue([])
      mockFilesRepo.findByUserId.mockResolvedValue([staleRecord])

      await reconcileFilesystem()

      expect(mockFilesRepo.delete).toHaveBeenCalledWith('stale-1')
    })

    it('handles deletion errors gracefully without crashing', async () => {
      const staleRecord = makeDbRecord({
        id: 'stale-error',
        storageKey: 'project-1/error-file.png',
        linkedTo: [],
      })

      mockScanDirectory.mockResolvedValue([])
      mockFilesRepo.findByUserId.mockResolvedValue([staleRecord])
      mockFilesRepo.delete.mockRejectedValue(new Error('DB write error'))

      // Should not throw
      await reconcileFilesystem()

      expect(mockFilesRepo.delete).toHaveBeenCalledWith('stale-error')
    })

    it('does not delete records that match disk files by storageKey', async () => {
      const scannedFile = makeScannedFile('project-1/existing.png', 1024)
      const dbRecord = makeDbRecord({
        id: 'existing-file',
        storageKey: 'project-1/existing.png',
        size: 1024,
        folderPath: '/',
      })

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockDeriveFolder.mockReturnValue('/')

      await reconcileFilesystem()

      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
      expect(mockFilesRepo.create).not.toHaveBeenCalled()
    })

    it('leaves ARCHIVE and BACKUP rows\' curated folderPath alone when it differs from the derived path', async () => {
      // '/archives' and '/backups' deliberately do NOT mirror the physical
      // storage key ('<fileId>/character-archive.qtap' derives to '/'), so
      // the folderPath "fix" must not strip them out of their shelf folder.
      const archiveOnDisk = makeScannedFile('archive-1/character-archive.qtap', 4096)
      const archiveRow = makeDbRecord({
        id: 'archive-1',
        storageKey: 'archive-1/character-archive.qtap',
        category: 'ARCHIVE',
        folderPath: '/archives',
        size: 4096,
      })

      mockScanDirectory.mockResolvedValue([archiveOnDisk])
      mockFilesRepo.findByUserId.mockResolvedValue([archiveRow])
      mockDeriveFolder.mockReturnValue('/')

      await reconcileFilesystem()

      expect(mockFilesRepo.update).not.toHaveBeenCalled()
      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('still corrects folderPath drift for ordinary files', async () => {
      const scannedFile = makeScannedFile('project-1/docs/moved.png', 1024)
      const dbRecord = makeDbRecord({
        id: 'drifted-file',
        storageKey: 'project-1/docs/moved.png',
        category: 'IMAGE',
        folderPath: '/',
        size: 1024,
      })

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockDeriveFolder.mockReturnValue('/docs/')

      await reconcileFilesystem()

      expect(mockFilesRepo.update).toHaveBeenCalledWith(
        'drifted-file',
        expect.objectContaining({ folderPath: '/docs/' })
      )
    })

    it('updates size and sha256 when disk file size differs from DB record', async () => {
      const scannedFile = makeScannedFile('project-1/resized.png', 2048)
      const dbRecord = makeDbRecord({
        id: 'resized-file',
        storageKey: 'project-1/resized.png',
        size: 1024, // Different from scanned size
        folderPath: '/',
      })

      mockScanDirectory.mockResolvedValue([scannedFile])
      mockFilesRepo.findByUserId.mockResolvedValue([dbRecord])
      mockComputeSha256.mockResolvedValue('sha256-resized-new')
      mockDeriveFolder.mockReturnValue('/')

      await reconcileFilesystem()

      expect(mockFilesRepo.update).toHaveBeenCalledWith(
        'resized-file',
        expect.objectContaining({
          sha256: 'sha256-resized-new',
          size: 2048,
        })
      )
      expect(mockFilesRepo.delete).not.toHaveBeenCalled()
    })

    it('continues processing remaining records when character lookup fails', async () => {
      const staleRecord1 = makeDbRecord({
        id: 'stale-a',
        storageKey: 'project-1/a.png',
        linkedTo: [],
      })
      const staleRecord2 = makeDbRecord({
        id: 'stale-b',
        storageKey: 'project-1/b.png',
        linkedTo: [],
      })

      mockScanDirectory.mockResolvedValue([])
      mockFilesRepo.findByUserId.mockResolvedValue([staleRecord1, staleRecord2])

      // Character lookup throws but reconciliation should proceed cautiously
      mockCharactersRepo.findAllRaw.mockRejectedValue(new Error('Characters DB error'))

      await reconcileFilesystem()

      // Both records should still be processed for deletion
      // (the code catches the character lookup error and proceeds)
      expect(mockFilesRepo.delete).toHaveBeenCalledTimes(2)
    })

    it('handles records with null storageKey gracefully', async () => {
      const nullKeyRecord = makeDbRecord({
        id: 'null-key',
        storageKey: null,
        linkedTo: [],
      })

      const normalRecord = makeDbRecord({
        id: 'normal-file',
        storageKey: 'project-1/normal.png',
        linkedTo: [],
      })

      mockScanDirectory.mockResolvedValue([])
      mockFilesRepo.findByUserId.mockResolvedValue([nullKeyRecord, normalRecord])

      await reconcileFilesystem()

      // null storageKey record should be skipped (won't be in unmatched since it's filtered)
      // normal record should be deleted as it's not on disk
      expect(mockFilesRepo.delete).toHaveBeenCalledWith('normal-file')
      // null-key record should not be deleted (it's filtered out of unmatchedDbRecords)
      expect(mockFilesRepo.delete).not.toHaveBeenCalledWith('null-key')
    })
  })
})
