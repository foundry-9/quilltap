/**
 * @jest-environment node
 *
 * Regression tests for multi-chunk blob reassembly in the NDJSON importer.
 *
 * The chunk accumulator is a pre-sized sparse array, and `every` skips holes —
 * so the old completion test answered true the moment the first chunk landed.
 * v4 pushed a truncated blob, dropped the accumulator, and threw
 * "doc_mount_blob_chunk received without preceding doc_mount_blob" when the
 * second chunk arrived. Any store blob over BLOB_CHUNK_BYTES (3 MB) tripped it,
 * which meant v4 could not re-read its own export.
 *
 * Node environment (not jsdom): the module under test runs server-side.
 */

import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream'

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

const MOUNT_POINT_ID = 'mp-blob-1'
const SHA = 'a'.repeat(64)

const ENVELOPE = {
  kind: '__envelope__',
  format: 'qtap-ndjson',
  version: 1,
  manifest: {
    format: 'quilltap-export',
    version: '1.0',
    exportType: 'document-stores',
    createdAt: '2026-07-26T00:00:00.000Z',
    appVersion: '4.8.0',
    settings: {},
    counts: {},
  },
}

function blobRecord(chunkCount: number, sha = SHA) {
  return {
    kind: 'doc_mount_blob',
    data: {
      mountPointId: MOUNT_POINT_ID,
      relativePath: 'Assets/plate.webp',
      originalFileName: 'plate.webp',
      originalMimeType: 'image/webp',
      storedMimeType: 'image/webp',
      sizeBytes: 9,
      sha256: sha,
      description: '',
      chunkCount,
    },
  }
}

function chunkRecord(index: number, total: number, dataBase64: string, sha = SHA) {
  return {
    kind: 'doc_mount_blob_chunk',
    mountPointId: MOUNT_POINT_ID,
    sha256: sha,
    index,
    total,
    dataBase64,
  }
}

/** Feed a list of records to the assembler as the async iterable it expects. */
function stream(records: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const r of records) yield r
  })()
}

/**
 * Split a buffer the way the writer does — each chunk base64-encoded
 * separately, so only the last may carry padding.
 */
function encodeChunks(data: Buffer, chunkBytes: number): string[] {
  const out: string[] = []
  for (let start = 0; start < data.length; start += chunkBytes) {
    out.push(data.subarray(start, Math.min(start + chunkBytes, data.length)).toString('base64'))
  }
  return out.length > 0 ? out : ['']
}

describe('assembleExportFromStream — blob chunk reassembly', () => {
  it('reassembles a single-chunk blob', async () => {
    const payload = Buffer.from('one chunk only')
    const result = await assembleExportFromStream(
      stream([ENVELOPE, blobRecord(1), chunkRecord(0, 1, payload.toString('base64'))])
    )

    expect(result.data.blobs).toHaveLength(1)
    expect(
      Buffer.from(result.data.blobs![0].dataBase64, 'base64').toString()
    ).toBe('one chunk only')
  })

  it('waits for every chunk before finalizing a multi-chunk blob', async () => {
    // 9 bytes in 3-byte chunks: a multiple of 3, so no interior padding —
    // exactly the invariant BLOB_CHUNK_BYTES upholds at 3 MB.
    const payload = Buffer.from('abcdefghi')
    const encoded = encodeChunks(payload, 3)
    expect(encoded).toHaveLength(3)

    const result = await assembleExportFromStream(
      stream([
        ENVELOPE,
        blobRecord(3),
        ...encoded.map((data, i) => chunkRecord(i, 3, data)),
      ])
    )

    expect(result.data.blobs).toHaveLength(1)
    const restored = Buffer.from(result.data.blobs![0].dataBase64, 'base64')
    expect(restored.equals(payload)).toBe(true)
  })

  it('does not throw "without preceding doc_mount_blob" on the second chunk', async () => {
    const encoded = encodeChunks(Buffer.from('abcdef'), 3)

    await expect(
      assembleExportFromStream(
        stream([ENVELOPE, blobRecord(2), ...encoded.map((d, i) => chunkRecord(i, 2, d))])
      )
    ).resolves.toBeDefined()
  })

  it('reports truncation when a blob never receives all of its chunks', async () => {
    const encoded = encodeChunks(Buffer.from('abcdefghi'), 3)

    await expect(
      assembleExportFromStream(
        stream([ENVELOPE, blobRecord(3), chunkRecord(0, 3, encoded[0])])
      )
    ).rejects.toThrow(/NDJSON export truncated/)
  })

  it('still rejects a chunk that has no preceding blob record', async () => {
    await expect(
      assembleExportFromStream(stream([ENVELOPE, chunkRecord(0, 1, '')]))
    ).rejects.toThrow(/without preceding doc_mount_blob/)
  })

  it('rejects a duplicate chunk index', async () => {
    const encoded = encodeChunks(Buffer.from('abcdef'), 3)

    await expect(
      assembleExportFromStream(
        stream([ENVELOPE, blobRecord(2), chunkRecord(0, 2, encoded[0]), chunkRecord(0, 2, encoded[0])])
      )
    ).rejects.toThrow(/Duplicate doc_mount_blob_chunk/)
  })

  it('keeps two interleaved blobs apart', async () => {
    const shaB = 'b'.repeat(64)
    const first = encodeChunks(Buffer.from('abcdef'), 3)
    const second = encodeChunks(Buffer.from('ghijkl'), 3)

    const result = await assembleExportFromStream(
      stream([
        ENVELOPE,
        blobRecord(2),
        blobRecord(2, shaB),
        chunkRecord(0, 2, first[0]),
        chunkRecord(0, 2, second[0], shaB),
        chunkRecord(1, 2, first[1]),
        chunkRecord(1, 2, second[1], shaB),
      ])
    )

    expect(result.data.blobs).toHaveLength(2)
    const bySha = new Map(
      result.data.blobs!.map((b) => [b.sha256, Buffer.from(b.dataBase64, 'base64').toString()])
    )
    expect(bySha.get(SHA)).toBe('abcdef')
    expect(bySha.get(shaB)).toBe('ghijkl')
  })
})
