/**
 * Regression tests for the mount-index storage-type coercion used on restore.
 *
 * A backup archive carries mount-index rows exactly as `SELECT *` gave them up:
 * pattern arrays as JSON text, booleans as INTEGER 0/1. Restoring those rows
 * verbatim got every one of them rejected by the repository schemas, so a
 * restored instance held all the content and none of the stores or links that
 * reach it.
 */

import {
  coerceDocMountPointRow,
  coerceDocMountFileLinkRow,
} from '@/lib/backup/restore/mount-index-coercion'
import {
  DocMountPointSchema,
  DocMountFileLinkSchema,
} from '@/lib/schemas/mount-index.types'

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

describe('coerceDocMountPointRow', () => {
  it('parses JSON-text pattern columns back into string arrays', () => {
    const row = coerceDocMountPointRow({
      id: 'mp-1',
      name: 'Character Vault',
      includePatterns: '["*.md","*.txt"]' as unknown as string[],
      excludePatterns: '[".git"]' as unknown as string[],
    })

    expect(row.includePatterns).toEqual(['*.md', '*.txt'])
    expect(row.excludePatterns).toEqual(['.git'])
  })

  it('coerces the INTEGER 0/1 enabled column to a boolean', () => {
    expect(coerceDocMountPointRow({ enabled: 1 as unknown as boolean }).enabled).toBe(true)
    expect(coerceDocMountPointRow({ enabled: 0 as unknown as boolean }).enabled).toBe(false)
  })

  it('leaves already-correct values untouched', () => {
    const row = coerceDocMountPointRow({
      includePatterns: ['*.md'],
      excludePatterns: [],
      enabled: false,
    })

    expect(row.includePatterns).toEqual(['*.md'])
    expect(row.excludePatterns).toEqual([])
    expect(row.enabled).toBe(false)
  })

  it('falls back to the schema defaults for unparseable or absent columns', () => {
    const row = coerceDocMountPointRow({
      includePatterns: 'not json at all' as unknown as string[],
    })

    expect(row.includePatterns).toEqual(['*.md', '*.txt', '*.pdf', '*.docx'])
    expect(row.excludePatterns).toEqual(['.git', 'node_modules', '.obsidian', '.trash'])
    expect(row.enabled).toBe(true)
  })

  it('preserves every other column verbatim', () => {
    const row = coerceDocMountPointRow({
      id: 'mp-1',
      name: 'Quilltap Uploads',
      basePath: '',
      mountType: 'database' as const,
      storeType: 'documents' as const,
      fileCount: 12,
    })

    expect(row.id).toBe('mp-1')
    expect(row.name).toBe('Quilltap Uploads')
    expect(row.mountType).toBe('database')
    expect(row.fileCount).toBe(12)
  })
})

describe('the shapes a real archive carries', () => {
  // Verbatim shape of a `SELECT * FROM doc_mount_points` row — the archive
  // carries exactly this, and the repository schema refuses it as-is.
  const rawMountPointRow = {
    id: '7b9416db-f9b9-4b6f-abc4-19e34ae6c709',
    name: 'Malory Wave',
    basePath: '/Users/someone/obsidian/Malory Wave',
    mountType: 'obsidian',
    includePatterns: '["*.md","*.txt","*.pdf","*.docx"]',
    excludePatterns: '[".git","node_modules",".obsidian",".trash"]',
    enabled: 1,
    lastScannedAt: '2026-07-25T18:53:39.088Z',
    scanStatus: 'idle',
    lastScanError: null,
    fileCount: 410,
    chunkCount: 1336,
    createdAt: '2026-04-14T00:52:16.111Z',
    updatedAt: '2026-07-26T18:15:32.956Z',
    totalSizeBytes: 4697031,
    conversionStatus: 'idle',
    conversionError: null,
    storeType: 'documents',
  }

  const rawFileLinkRow = {
    id: '2b0b2f4c-6a0e-4d7b-9d09-9c2d5f6c1a11',
    fileId: 'c3c2f2b0-1a11-4f0d-9c53-0e6f1a2b3c4d',
    mountPointId: rawMountPointRow.id,
    relativePath: 'Lore/intro.md',
    fileName: 'intro.md',
    folderId: null,
    originalFileName: null,
    originalMimeType: null,
    description: '',
    descriptionUpdatedAt: null,
    conversionStatus: 'converted',
    conversionError: null,
    plainTextLength: 812,
    extractedText: null,
    extractedTextSha256: null,
    extractionStatus: 'none',
    extractionError: null,
    chunkCount: 3,
    allowEmbed: 1,
    allowCharacterRead: 1,
    allowCharacterWrite: 0,
    lastModified: '2026-07-25T18:53:39.088Z',
    createdAt: '2026-04-14T00:52:16.111Z',
    updatedAt: '2026-07-26T18:15:32.956Z',
  }

  it('rejects an uncoerced mount-point row and accepts the coerced one', () => {
    expect(DocMountPointSchema.safeParse(rawMountPointRow).success).toBe(false)

    const parsed = DocMountPointSchema.safeParse(coerceDocMountPointRow(rawMountPointRow as never))
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.includePatterns).toEqual(['*.md', '*.txt', '*.pdf', '*.docx'])
    expect(parsed.success && parsed.data.enabled).toBe(true)
  })

  it('rejects an uncoerced file-link row and accepts the coerced one', () => {
    expect(DocMountFileLinkSchema.safeParse(rawFileLinkRow).success).toBe(false)

    const parsed = DocMountFileLinkSchema.safeParse(coerceDocMountFileLinkRow(rawFileLinkRow as never))
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.allowEmbed).toBe(true)
    expect(parsed.success && parsed.data.allowCharacterWrite).toBe(false)
  })
})

describe('coerceDocMountFileLinkRow', () => {
  it('coerces the three policy flags from INTEGER to boolean', () => {
    const row = coerceDocMountFileLinkRow({
      allowEmbed: 0 as unknown as boolean,
      allowCharacterRead: 1 as unknown as boolean,
      allowCharacterWrite: 0 as unknown as boolean,
    })

    expect(row.allowEmbed).toBe(false)
    expect(row.allowCharacterRead).toBe(true)
    expect(row.allowCharacterWrite).toBe(false)
  })

  it('defaults missing policy flags to permissive', () => {
    const row = coerceDocMountFileLinkRow({ id: 'link-1' })

    expect(row.allowEmbed).toBe(true)
    expect(row.allowCharacterRead).toBe(true)
    expect(row.allowCharacterWrite).toBe(true)
  })

  it('leaves already-correct booleans untouched and preserves other columns', () => {
    const row = coerceDocMountFileLinkRow({
      id: 'link-1',
      relativePath: 'Lore/intro.md',
      chunkCount: 3,
      allowEmbed: false,
    })

    expect(row.allowEmbed).toBe(false)
    expect(row.relativePath).toBe('Lore/intro.md')
    expect(row.chunkCount).toBe(3)
  })
})
