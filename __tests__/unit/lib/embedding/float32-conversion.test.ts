/**
 * Embedding codec tests — self-describing quantized format.
 *
 * Covers the spec'd quality bars (db-size-reduction spec §4.4):
 *  - int8 round-trip: per-element error ≤ scale, mean cosine ≥ 0.999
 *  - f16 round-trip: mean cosine ≥ 0.9999
 *  - top-k retrieval overlap on a synthetic corpus ≥ 0.95
 * plus format detection (legacy vs quantized) and edge cases.
 */

import {
  blobToFloat32,
  float32ToBlob,
  float32ToBlobRaw,
  float32ToQuantized,
  quantizedToFloat32,
  isQuantizedEmbeddingBlob,
  blobToEmbedding,
  embeddingToBlob,
  EMBEDDING_DTYPE_INT8,
  EMBEDDING_DTYPE_F16,
} from '@/lib/embedding/float32-conversion'

/** Deterministic pseudo-random generator so failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random unit vector of the given dimension (matches stored embeddings). */
function randomUnitVector(dim: number, rand: () => number): Float32Array {
  const v = new Float32Array(dim)
  let sumSq = 0
  for (let i = 0; i < dim; i++) {
    v[i] = rand() * 2 - 1
    sumSq += v[i] * v[i]
  }
  const inv = 1 / Math.sqrt(sumSq)
  for (let i = 0; i < dim; i++) v[i] *= inv
  return v
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function topK(query: Float32Array, corpus: Float32Array[], k: number): number[] {
  return corpus
    .map((v, i) => ({ i, score: cosine(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.i)
}

describe('format detection', () => {
  it('recognizes int8 and f16 quantized blobs', () => {
    const v = randomUnitVector(64, mulberry32(1))
    expect(isQuantizedEmbeddingBlob(float32ToQuantized(v, EMBEDDING_DTYPE_INT8))).toBe(true)
    expect(isQuantizedEmbeddingBlob(float32ToQuantized(v, EMBEDDING_DTYPE_F16))).toBe(true)
  })

  it('rejects legacy raw Float32 blobs', () => {
    const v = randomUnitVector(64, mulberry32(2))
    expect(isQuantizedEmbeddingBlob(float32ToBlobRaw(v))).toBe(false)
  })

  it('rejects a magic-prefixed blob whose declared dim is inconsistent with its length', () => {
    const blob = float32ToQuantized(randomUnitVector(64, mulberry32(3)))
    const truncated = blob.subarray(0, blob.byteLength - 3)
    expect(isQuantizedEmbeddingBlob(Buffer.from(truncated))).toBe(false)
  })

  it('rejects short and empty buffers', () => {
    expect(isQuantizedEmbeddingBlob(Buffer.alloc(0))).toBe(false)
    expect(isQuantizedEmbeddingBlob(Buffer.from([0xeb, 0x01]))).toBe(false)
  })
})

describe('int8 quantized round-trip', () => {
  it('bounds per-element error by the stored scale', () => {
    const rand = mulberry32(42)
    for (let trial = 0; trial < 10; trial++) {
      const v = randomUnitVector(1536, rand)
      const blob = float32ToQuantized(v, EMBEDDING_DTYPE_INT8)
      const back = quantizedToFloat32(blob)
      const scale = blob.readFloatLE(7)
      expect(back).toHaveLength(v.length)
      for (let i = 0; i < v.length; i++) {
        expect(Math.abs(back[i] - v[i])).toBeLessThanOrEqual(scale)
      }
    }
  })

  it('keeps mean cosine similarity ≥ 0.999 on real-scale unit vectors', () => {
    const rand = mulberry32(7)
    let sum = 0
    const trials = 50
    for (let t = 0; t < trials; t++) {
      const v = randomUnitVector(1024, rand)
      const back = quantizedToFloat32(float32ToQuantized(v, EMBEDDING_DTYPE_INT8))
      sum += cosine(v, back)
    }
    expect(sum / trials).toBeGreaterThanOrEqual(0.999)
  })

  it('is ~4x smaller than raw Float32', () => {
    const v = randomUnitVector(1536, mulberry32(8))
    const raw = float32ToBlobRaw(v).byteLength
    const quant = float32ToQuantized(v, EMBEDDING_DTYPE_INT8).byteLength
    expect(quant).toBe(11 + 1536)
    expect(quant * 3.5).toBeLessThan(raw)
  })

  it('handles the all-zero vector (scale guard)', () => {
    const back = quantizedToFloat32(float32ToQuantized(new Float32Array(16)))
    expect(Array.from(back)).toEqual(new Array(16).fill(0))
  })

  it('handles the empty vector', () => {
    const blob = float32ToQuantized(new Float32Array(0))
    expect(isQuantizedEmbeddingBlob(blob)).toBe(true)
    expect(quantizedToFloat32(blob)).toHaveLength(0)
  })
})

describe('f16 quantized round-trip', () => {
  it('keeps mean cosine similarity ≥ 0.9999 (effectively lossless)', () => {
    const rand = mulberry32(11)
    let sum = 0
    const trials = 50
    for (let t = 0; t < trials; t++) {
      const v = randomUnitVector(1024, rand)
      const back = quantizedToFloat32(float32ToQuantized(v, EMBEDDING_DTYPE_F16))
      sum += cosine(v, back)
    }
    expect(sum / trials).toBeGreaterThanOrEqual(0.9999)
  })

  it('round-trips exact half-precision values losslessly', () => {
    const exact = new Float32Array([0.5, -0.25, 1.0, -1.0, 0.0, 0.125, 2048])
    const back = quantizedToFloat32(float32ToQuantized(exact, EMBEDDING_DTYPE_F16))
    expect(Array.from(back)).toEqual(Array.from(exact))
  })

  it('is 2x smaller than raw Float32 (plus header)', () => {
    const v = randomUnitVector(1536, mulberry32(12))
    expect(float32ToQuantized(v, EMBEDDING_DTYPE_F16).byteLength).toBe(7 + 2 * 1536)
  })
})

describe('header-aware blobToFloat32', () => {
  it('decodes quantized blobs', () => {
    const v = randomUnitVector(256, mulberry32(21))
    const back = blobToFloat32(float32ToQuantized(v))
    expect(cosine(v, back)).toBeGreaterThanOrEqual(0.999)
  })

  it('decodes legacy raw Float32 blobs bit-exactly', () => {
    const v = randomUnitVector(256, mulberry32(22))
    const back = blobToFloat32(float32ToBlobRaw(v))
    expect(Array.from(back)).toEqual(Array.from(v))
  })

  it('the storage aliases write quantized and read both formats', () => {
    const v = randomUnitVector(128, mulberry32(23))
    const stored = embeddingToBlob(v)
    expect(isQuantizedEmbeddingBlob(stored)).toBe(true)
    expect(cosine(v, blobToEmbedding(stored))).toBeGreaterThanOrEqual(0.999)
    expect(cosine(v, blobToEmbedding(float32ToBlobRaw(v)))).toBeCloseTo(1, 12)
    // float32ToBlob is the same writer as embeddingToBlob
    expect(Buffer.compare(float32ToBlob(v), stored)).toBe(0)
  })

  it('accepts plain number[] input', () => {
    const arr = [0.6, -0.8]
    const back = blobToFloat32(float32ToBlob(arr))
    expect(back).toHaveLength(2)
    expect(Math.abs(back[0] - 0.6)).toBeLessThanOrEqual(0.8 / 127)
  })
})

describe('retrieval quality (synthetic top-k overlap)', () => {
  /** center + jitter, renormalized — models embeddings of related texts. */
  function nearbyVector(center: Float32Array, jitter: number, rand: () => number): Float32Array {
    const v = new Float32Array(center.length)
    let sumSq = 0
    for (let i = 0; i < center.length; i++) {
      v[i] = center[i] + (rand() * 2 - 1) * jitter
      sumSq += v[i] * v[i]
    }
    const inv = 1 / Math.sqrt(sumSq)
    for (let i = 0; i < center.length; i++) v[i] *= inv
    return v
  }

  it('keeps top-10 overlap ≥ 0.95 after int8 quantization', () => {
    // Clustered corpus rather than uniform-random: real embedding spaces have
    // topical structure, and uniform-random vectors produce near-tied scores
    // that no lossy codec (nor even reordered float math) could rank stably.
    const rand = mulberry32(1234)
    const dim = 512
    const clusters = 40
    const perCluster = 10
    const queries = 20
    const k = 10

    const centers = Array.from({ length: clusters }, () => randomUnitVector(dim, rand))
    const corpus: Float32Array[] = []
    for (const center of centers) {
      for (let i = 0; i < perCluster; i++) {
        corpus.push(nearbyVector(center, 0.03, rand))
      }
    }
    const quantizedCorpus = corpus.map((v) => blobToFloat32(float32ToQuantized(v)))

    let overlapSum = 0
    for (let q = 0; q < queries; q++) {
      const query = nearbyVector(centers[q % clusters], 0.03, rand)
      const before = new Set(topK(query, corpus, k))
      const after = topK(query, quantizedCorpus, k)
      overlapSum += after.filter((i) => before.has(i)).length / k
    }
    expect(overlapSum / queries).toBeGreaterThanOrEqual(0.95)
  })
})
