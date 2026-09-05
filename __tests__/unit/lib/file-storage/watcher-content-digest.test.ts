/**
 * Regression coverage for bug 69 — the filesystem watcher re-derived every
 * changed file's `sha256` from its bytes on disk, including an archived
 * character's bundle. That row records the digest of the DECRYPTED bundle
 * while the disk bytes are encrypted, so the overwrite replaced the content
 * digest with a ciphertext one and every later rehydrate refused the bundle
 * as corrupt — archiving was one-way for as long as the watcher was running.
 */

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
  deriveFolderPathFromStorageKey: jest.fn().mockReturnValue('/'),
}))

jest.mock('@/lib/file-storage/scanner', () => ({
  computeSha256: jest.fn(),
  detectMimeType: jest.fn().mockReturnValue('application/octet-stream'),
}))

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}))

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/auth/single-user', () => ({
  getOrCreateSingleUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
}))

// chokidar is captured so the registered 'change' handler can be invoked
// directly — that is the only door into the module's private handlers.
const chokidarHandlers: Record<string, (filePath: string) => void> = {}
jest.mock('chokidar', () => ({
  __esModule: true,
  default: {
    watch: () => {
      const chain: Record<string, unknown> = {}
      chain.on = (event: string, handler: (filePath: string) => void) => {
        chokidarHandlers[event] = handler
        return chain
      }
      chain.close = async () => {}
      return chain
    },
  },
}))

import { startWatcher, stopWatcher } from '@/lib/file-storage/watcher'
import { computeSha256 } from '@/lib/file-storage/scanner'
import { getRepositories } from '@/lib/database/repositories'
import { stat } from 'fs/promises'

const mockComputeSha256 = computeSha256 as jest.MockedFunction<typeof computeSha256>
const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockStat = stat as unknown as jest.Mock

let filesRepo: { findByStorageKey: jest.Mock; update: jest.Mock }

/** Fire a change event and let the module's 500 ms debounce elapse. */
async function fireChange(relativePath: string): Promise<void> {
  chokidarHandlers.change(`/mock/files/${relativePath}`)
  await jest.advanceTimersByTimeAsync(600)
  // The handler awaits a dynamic import, the repos, stat and the digest —
  // drain the microtask queue until it has run to completion.
  for (let i = 0; i < 25; i++) await Promise.resolve()
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  for (const key of Object.keys(chokidarHandlers)) delete chokidarHandlers[key]

  filesRepo = {
    findByStorageKey: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  }
  mockGetRepositories.mockReturnValue({ files: filesRepo } as never)

  startWatcher()
})

afterEach(async () => {
  await stopWatcher()
  jest.useRealTimers()
})

describe('the watcher on an on-disk change', () => {
  it('refreshes an ordinary file\'s digest and size', async () => {
    filesRepo.findByStorageKey.mockResolvedValue({
      id: 'image-1',
      category: 'IMAGE',
      sha256: 'old-digest',
      size: 1024,
    })
    mockStat.mockResolvedValue({ size: 2048 })
    mockComputeSha256.mockResolvedValue('new-digest')

    await fireChange('project-1/image.png')

    expect(filesRepo.update).toHaveBeenCalledWith('image-1', {
      sha256: 'new-digest',
      size: 2048,
    })
  })

  it('leaves an archive bundle\'s content digest alone', async () => {
    filesRepo.findByStorageKey.mockResolvedValue({
      id: 'archive-1',
      category: 'ARCHIVE',
      sha256: 'plaintext-digest',
      size: 9070,
    })
    mockStat.mockResolvedValue({ size: 9070 })
    // What the encrypted bytes hash to — the value that used to be written.
    mockComputeSha256.mockResolvedValue('ciphertext-digest')

    await fireChange('archive-1/character-archive.qtap')

    expect(filesRepo.update).not.toHaveBeenCalled()
  })

  it('still corrects an archive bundle\'s size, digest untouched', async () => {
    filesRepo.findByStorageKey.mockResolvedValue({
      id: 'archive-1',
      category: 'ARCHIVE',
      sha256: 'plaintext-digest',
      size: 9070,
    })
    mockStat.mockResolvedValue({ size: 9100 })
    mockComputeSha256.mockResolvedValue('ciphertext-digest')

    await fireChange('archive-1/character-archive.qtap')

    expect(filesRepo.update).toHaveBeenCalledWith('archive-1', { size: 9100 })
  })
})
