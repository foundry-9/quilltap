/**
 * @jest-environment node
 *
 * Regression tests for `getFileFromExtractedBackup`'s format gate.
 *
 * The storageKey layout landed in backupFormat 2 and the lookup tested for it
 * with `=== 2`. Manifests have since moved on to 4, so every modern archive
 * fell through to the pre-format-2 layout it does not use and no user file was
 * ever found. The gate is a floor now.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { getFileFromExtractedBackup } from '@/lib/backup/restore/archive'

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

const STORAGE_KEY = 'projects/proj-1/notes.md'
const STORAGE_KEY_BYTES = 'stored under the storageKey layout'
const LEGACY_BYTES = 'stored under the pre-format-2 layout'

let rootPath: string

const fileEntry = {
  id: 'file-1',
  category: 'DOCUMENT',
  originalFilename: 'notes.md',
  storageKey: STORAGE_KEY,
} as Parameters<typeof getFileFromExtractedBackup>[1]

beforeAll(async () => {
  rootPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qtap-archive-test-'))

  const newFormatPath = path.join(rootPath, 'files', STORAGE_KEY)
  await fs.promises.mkdir(path.dirname(newFormatPath), { recursive: true })
  await fs.promises.writeFile(newFormatPath, STORAGE_KEY_BYTES)

  const oldFormatPath = path.join(rootPath, 'files', 'DOCUMENT', 'file-1_notes.md')
  await fs.promises.mkdir(path.dirname(oldFormatPath), { recursive: true })
  await fs.promises.writeFile(oldFormatPath, LEGACY_BYTES)
})

afterAll(async () => {
  await fs.promises.rm(rootPath, { recursive: true, force: true })
})

describe('getFileFromExtractedBackup', () => {
  it.each([2, 3, 4, 5])('reads the storageKey layout for backupFormat %i', async (format) => {
    const bytes = await getFileFromExtractedBackup(rootPath, fileEntry, format)
    expect(bytes?.toString()).toBe(STORAGE_KEY_BYTES)
  })

  it('reads the legacy layout for backupFormat 1', async () => {
    const bytes = await getFileFromExtractedBackup(rootPath, fileEntry, 1)
    expect(bytes?.toString()).toBe(LEGACY_BYTES)
  })

  it('reads the legacy layout when the manifest declares no format', async () => {
    const bytes = await getFileFromExtractedBackup(rootPath, fileEntry, undefined)
    expect(bytes?.toString()).toBe(LEGACY_BYTES)
  })

  it('falls back to the legacy layout when the storageKey path is absent', async () => {
    const bytes = await getFileFromExtractedBackup(
      rootPath,
      { ...fileEntry, storageKey: 'projects/proj-1/missing.md' },
      4
    )
    expect(bytes?.toString()).toBe(LEGACY_BYTES)
  })

  it('returns null when neither layout holds the file', async () => {
    const bytes = await getFileFromExtractedBackup(
      rootPath,
      { ...fileEntry, id: 'file-2', storageKey: 'projects/proj-1/absent.md', originalFilename: 'absent.md' },
      4
    )
    expect(bytes).toBeNull()
  })
})
