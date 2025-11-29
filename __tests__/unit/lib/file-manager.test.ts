/**
 * Unit tests for the JSON file manager that powers the new file system.
 * Covers creation, deduplication, metadata updates, and deletion workflows.
 */

import { join } from 'path'

// Mock fs.promises with an in-memory map so no real files are touched.
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs')
  const files = new Map<string, Buffer>()

  const readFile = jest.fn(async (filePath: string, options?: any) => {
    if (!files.has(filePath)) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${filePath}`) as any
      err.code = 'ENOENT'
      throw err
    }
    const buffer = files.get(filePath)!
    if (typeof options === 'string') {
      return buffer.toString(options)
    }
    if (options && typeof options === 'object' && options.encoding) {
      return buffer.toString(options.encoding)
    }
    return buffer
  })

  const writeFile = jest.fn(async (filePath: string, data: any, options?: any) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, typeof options === 'string' ? options : undefined)
    files.set(filePath, buffer)
  })

  const appendFile = jest.fn(async (filePath: string, data: any) => {
    const existing = files.get(filePath) ?? Buffer.alloc(0)
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    files.set(filePath, Buffer.concat([existing, buffer]))
  })

  const unlink = jest.fn(async (filePath: string) => {
    if (!files.delete(filePath)) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${filePath}`) as any
      err.code = 'ENOENT'
      throw err
    }
  })

  const mkdir = jest.fn(async () => {})

  return {
    ...actualFs,
    __mockFiles: files,
    promises: {
      readFile,
      writeFile,
      appendFile,
      unlink,
      mkdir,
    },
  }
})

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto')
  return {
    ...actual,
    randomUUID: jest.fn(),
  }
})

import {
  createFile,
  getAllFiles,
  readFileAsBase64,
  addFileLink,
  removeFileLink,
  addFileTag,
  removeFileTag,
  deleteFile,
} from '@/lib/file-manager'
import { randomUUID } from 'crypto'

const fsMock = jest.requireMock('fs') as { __mockFiles: Map<string, Buffer> }
const getMockFiles = () => fsMock.__mockFiles

const userId = '11111111-1111-1111-1111-111111111111'
const linkedEntityA = '22222222-2222-2222-2222-222222222222'
const linkedEntityB = '33333333-3333-3333-3333-333333333333'

function storagePathFor(fileId: string, filename: string) {
  const ext = filename.split('.').pop()
  return join('public/data/files/storage', `${fileId}.${ext}`)
}

describe('lib/file-manager', () => {
  beforeEach(() => {
    getMockFiles().clear()
    jest.clearAllMocks()
  })

  it('creates a file entry, stores bytes, and exposes base64 reading', async () => {
    const buffer = Buffer.from('sample attachment body')
    ;(randomUUID as jest.MockedFunction<typeof randomUUID>)
      .mockReturnValueOnce('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')

    const entry = await createFile({
      buffer,
      originalFilename: 'note.txt',
      mimeType: 'text/plain',
      source: 'UPLOADED',
      category: 'ATTACHMENT',
      userId,
      linkedTo: [linkedEntityA],
      tags: [],
    })

    expect(entry.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(entry.size).toBe(buffer.length)
    expect(entry.linkedTo).toEqual([linkedEntityA])
    expect(entry.sha256).toHaveLength(64)

    const storedBuffer = getMockFiles().get(storagePathFor(entry.id, entry.originalFilename))
    expect(storedBuffer?.toString()).toBe('sample attachment body')

    const base64 = await readFileAsBase64(entry.id)
    expect(base64).toBe(buffer.toString('base64'))

    const allEntries = await getAllFiles()
    expect(allEntries).toHaveLength(1)
    expect(allEntries[0].id).toBe(entry.id)
  })

  it('deduplicates files by sha256 and merges linked entities', async () => {
    const buffer = Buffer.from('duplicate content')
    ;(randomUUID as jest.MockedFunction<typeof randomUUID>)
      .mockReturnValueOnce('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')

    const first = await createFile({
      buffer,
      originalFilename: 'duplicate.png',
      mimeType: 'image/png',
      source: 'GENERATED',
      category: 'IMAGE',
      userId,
      linkedTo: [linkedEntityA],
      tags: [],
    })
    expect(first.linkedTo).toEqual([linkedEntityA])

    ;(randomUUID as jest.MockedFunction<typeof randomUUID>)
      .mockReturnValueOnce('cccccccc-cccc-cccc-cccc-cccccccccccc')

    const deduped = await createFile({
      buffer,
      originalFilename: 'duplicate.png',
      mimeType: 'image/png',
      source: 'GENERATED',
      category: 'IMAGE',
      userId,
      linkedTo: [linkedEntityB],
      tags: [],
    })

    expect(deduped.id).toBe(first.id)
    expect(deduped.linkedTo.sort()).toEqual([linkedEntityA, linkedEntityB].sort())

    const storedIndex = await getAllFiles()
    expect(storedIndex).toHaveLength(1)
    expect(storedIndex[0].linkedTo.sort()).toEqual([linkedEntityA, linkedEntityB].sort())
  })

  it('manages file links and tags without duplication', async () => {
    const buffer = Buffer.from('link content')
    ;(randomUUID as jest.MockedFunction<typeof randomUUID>)
      .mockReturnValueOnce('dddddddd-dddd-dddd-dddd-dddddddddddd')

    const entry = await createFile({
      buffer,
      originalFilename: 'link.txt',
      mimeType: 'text/plain',
      source: 'UPLOADED',
      category: 'ATTACHMENT',
      userId,
      tags: [],
    })

    const linked = await addFileLink(entry.id, linkedEntityA)
    expect(linked.linkedTo).toEqual([linkedEntityA])

    const notDuplicated = await addFileLink(entry.id, linkedEntityA)
    expect(notDuplicated.linkedTo).toEqual([linkedEntityA])

    const removed = await removeFileLink(entry.id, linkedEntityA)
    expect(removed.linkedTo).toEqual([])

    const tagged = await addFileTag(entry.id, '44444444-4444-4444-4444-444444444444')
    expect(tagged.tags).toEqual(['44444444-4444-4444-4444-444444444444'])

    const removeTagged = await removeFileTag(entry.id, '44444444-4444-4444-4444-444444444444')
    expect(removeTagged.tags).toEqual([])
  })

  it('deletes both index entry and storage file', async () => {
    const buffer = Buffer.from('to delete')
    ;(randomUUID as jest.MockedFunction<typeof randomUUID>)
      .mockReturnValueOnce('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')

    const entry = await createFile({
      buffer,
      originalFilename: 'delete.jpg',
      mimeType: 'image/jpeg',
      source: 'UPLOADED',
      category: 'IMAGE',
      userId,
    })

    expect(getMockFiles().has(storagePathFor(entry.id, entry.originalFilename))).toBe(true)

    const deleted = await deleteFile(entry.id)
    expect(deleted).toBe(true)

    const remainingEntries = await getAllFiles()
    expect(remainingEntries).toHaveLength(0)
    expect(getMockFiles().has(storagePathFor(entry.id, entry.originalFilename))).toBe(false)
  })
})
