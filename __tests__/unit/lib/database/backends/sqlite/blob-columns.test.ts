/**
 * BLOB Column Utilities Unit Tests
 *
 * Tests embedding BLOB serialization/deserialization for storage. Since the
 * int8 quantization change, `embeddingToBlob` writes the self-describing
 * quantized format (11-byte header + 1 byte per dimension) and
 * `blobToEmbedding` is header-aware: it dequantizes new-format blobs and
 * falls back to raw-Float32 interpretation for legacy ones. Deeper codec
 * accuracy tests live in __tests__/unit/lib/embedding/float32-conversion.test.ts.
 */

import { describe, it, expect } from '@jest/globals'
import { embeddingToBlob, blobToEmbedding, documentToRow, parseLegacyEmbeddingText } from '@/lib/database/backends/sqlite/json-columns'
import { float32ToBlobRaw } from '@/lib/embedding/float32-conversion'

/** int8 quantized layout: magic+version+dtype+dim(4)+scale(4) then 1 byte/dim */
const INT8_HEADER_BYTES = 11

describe('embeddingToBlob', () => {
  it('converts a number array to a quantized Buffer', () => {
    const embedding = [1.0, 2.0, 3.0]
    const blob = embeddingToBlob(embedding)

    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blob.byteLength).toBe(INT8_HEADER_BYTES + 3) // header + 1 byte per dim
    expect(blob[0]).toBe(0xeb) // magic
    expect(blob[1]).toBe(0x01) // version
    expect(blob[2]).toBe(0x01) // dtype int8
  })

  it('handles empty arrays', () => {
    const blob = embeddingToBlob([])
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blobToEmbedding(blob)).toHaveLength(0)
  })

  it('handles large embeddings', () => {
    const embedding = Array.from({ length: 1536 }, () => Math.random())
    const blob = embeddingToBlob(embedding)

    expect(blob.byteLength).toBe(INT8_HEADER_BYTES + 1536)
  })
})

describe('blobToEmbedding', () => {
  it('converts a quantized Buffer back to a Float32Array', () => {
    const original = [1.0, 2.0, 3.0]
    const blob = embeddingToBlob(original)
    const result = blobToEmbedding(blob)

    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(3)
    // int8 symmetric: per-element error is bounded by scale = max|v|/127.
    const scale = 3.0 / 127
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(result[i] - original[i])).toBeLessThanOrEqual(scale)
    }
  })

  it('decodes a LEGACY raw Float32 buffer (header-aware fallback)', () => {
    const original = [0.123456789, -0.987654321, 0.0, 1.0, -1.0]
    const legacyBlob = float32ToBlobRaw(original)
    const result = blobToEmbedding(legacyBlob)

    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(5)
    for (let i = 0; i < original.length; i++) {
      expect(result[i]).toBeCloseTo(original[i], 5) // full Float32 precision
    }
  })

  it('handles empty buffers', () => {
    const blob = Buffer.alloc(0)
    const result = blobToEmbedding(blob)

    expect(result).toBeInstanceOf(Float32Array)
    expect(result).toHaveLength(0)
  })
})

describe('embeddingToBlob/blobToEmbedding round-trip', () => {
  it('preserves values through round-trip within quantization error', () => {
    const original = [0.123456789, -0.987654321, 0.0, 1.0, -1.0]
    const roundTripped = blobToEmbedding(embeddingToBlob(original))

    expect(roundTripped).toHaveLength(original.length)
    const scale = 1.0 / 127 // max|v| = 1.0
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(roundTripped[i] - original[i])).toBeLessThanOrEqual(scale)
    }
  })

  it('preserves typical embedding values through round-trip', () => {
    // Simulated embedding output from an LLM
    const original = Array.from({ length: 768 }, () => (Math.random() - 0.5) * 2)
    const roundTripped = blobToEmbedding(embeddingToBlob(original))

    expect(roundTripped).toHaveLength(768)
    const maxAbs = Math.max(...original.map(Math.abs))
    const scale = maxAbs / 127
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(roundTripped[i] - original[i])).toBeLessThanOrEqual(scale)
    }
  })

  it('is significantly smaller than JSON text and than raw Float32', () => {
    const embedding = Array.from({ length: 1536 }, () => Math.random())
    const jsonSize = Buffer.byteLength(JSON.stringify(embedding), 'utf8')
    const rawSize = float32ToBlobRaw(embedding).byteLength
    const blobSize = embeddingToBlob(embedding).byteLength

    expect(blobSize).toBeLessThan(jsonSize / 10)
    expect(blobSize).toBeLessThan(rawSize / 3) // ~4x smaller than raw Float32
    expect(blobSize).toBe(INT8_HEADER_BYTES + 1536)
  })
})

describe('documentToRow with blobColumns', () => {
  it('converts embedding arrays to Buffers when in blobColumns set', () => {
    const doc = {
      id: 'test',
      embedding: [1.0, 2.0, 3.0],
      name: 'test',
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, [], blobColumns)

    expect(Buffer.isBuffer(row.embedding)).toBe(true)
    expect(typeof row.name).toBe('string')
    expect(typeof row.id).toBe('string')
  })

  it('passes through Buffer values in blobColumns', () => {
    const blob = Buffer.from([1, 2, 3])
    const doc = {
      id: 'test',
      embedding: blob,
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, [], blobColumns)

    expect(row.embedding).toBe(blob)
  })

  it('does not convert arrays outside blobColumns set', () => {
    const doc = {
      id: 'test',
      tags: ['a', 'b'],
      embedding: [1.0, 2.0],
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, ['tags'], blobColumns)

    expect(typeof row.tags).toBe('string') // JSON serialized
    expect(Buffer.isBuffer(row.embedding)).toBe(true) // BLOB
  })

  it('handles null embedding in blobColumns', () => {
    const doc = {
      id: 'test',
      embedding: null,
    }
    const blobColumns = new Set(['embedding'])
    const row = documentToRow(doc, [], blobColumns)

    expect(row.embedding).toBeNull()
  })
})

describe('parseLegacyEmbeddingText', () => {
  it('parses the JSON-array legacy shape', () => {
    const result = parseLegacyEmbeddingText('[0.1, 0.2, 0.3]')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('recovers the index-keyed object shape left by JSON.stringify(Float32Array)', () => {
    // JSON.stringify(new Float32Array([...])) yields {"0":..,"1":..,...}.
    const original = new Float32Array([0.5, -0.25, 0.125, 0.0625])
    const legacyText = JSON.stringify(original)
    expect(legacyText.startsWith('{')).toBe(true) // confirms the object shape

    const result = parseLegacyEmbeddingText(legacyText)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(4)
    // Values come back in index order.
    expect((result as number[])[0]).toBeCloseTo(0.5, 5)
    expect((result as number[])[1]).toBeCloseTo(-0.25, 5)
    expect((result as number[])[3]).toBeCloseTo(0.0625, 5)
  })

  it('preserves index order for a large index-keyed object', () => {
    const dims = 1024
    const original = Array.from({ length: dims }, (_, i) => i / dims)
    const legacyText = JSON.stringify(new Float32Array(original))
    const result = parseLegacyEmbeddingText(legacyText) as number[]

    expect(result).toHaveLength(dims)
    expect(result[0]).toBeCloseTo(0, 5)
    expect(result[512]).toBeCloseTo(512 / dims, 5)
    expect(result[dims - 1]).toBeCloseTo((dims - 1) / dims, 5)
  })

  it('returns undefined for unparseable or non-embedding text', () => {
    expect(parseLegacyEmbeddingText('not json')).toBeUndefined()
    expect(parseLegacyEmbeddingText('42')).toBeUndefined()
    expect(parseLegacyEmbeddingText('"a string"')).toBeUndefined()
    expect(parseLegacyEmbeddingText('null')).toBeUndefined()
  })

  it('round-trips an index-keyed object back into a stored BLOB', () => {
    const original = [0.1, 0.2, 0.3, 0.4]
    const legacyText = JSON.stringify(new Float32Array(original))
    const recovered = parseLegacyEmbeddingText(legacyText) as number[]
    const roundTripped = blobToEmbedding(embeddingToBlob(recovered))

    expect(roundTripped).toHaveLength(4)
    const scale = 0.4 / 127
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(roundTripped[i] - original[i])).toBeLessThanOrEqual(scale)
    }
  })
})
