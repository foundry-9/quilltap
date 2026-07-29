/**
 * Embedding BLOB codec — quantized storage, Float32 in memory.
 *
 * This module is the SINGLE SOURCE OF TRUTH for how embedding vectors are
 * (de)serialized to/from SQLite BLOBs. Every consumer (backend hydration,
 * Zod schema transforms, backups, migrations) must decode through
 * {@link blobToFloat32} and encode through {@link float32ToBlob} so the
 * on-disk format can evolve without touching search/scoring code — all of
 * which consumes the hydrated `Float32Array`/`number[]`.
 *
 * ## On-disk formats
 *
 * **Legacy (pre-quantization):** the raw bytes of a Float32Array. No header.
 *
 * **Quantized (current writes):** a self-describing, versioned layout so
 * legacy Float32, int8 and float16 blobs can coexist during and after the
 * `quantize-embeddings-v1` migration:
 *
 * ```
 * Byte layout (little-endian):
 *   [0]      magic   = 0xEB
 *   [1]      version = 0x01
 *   [2]      dtype   : 0x01 = int8-symmetric, 0x02 = float16
 *   [3..6]   dim     : uint32
 *   dtype==int8: [7..10] scale : float32   (dequant: f = int8 * scale)
 *                [11..11+dim)   int8 body            → total = 11 + dim
 *   dtype==f16 : [7..7+2*dim)   float16 body (no scale) → total = 7 + 2*dim
 * ```
 *
 * A blob is treated as quantized iff the magic+version match AND the declared
 * dim is self-consistent with the byte length; anything else decodes as
 * legacy raw Float32. The combined check makes a false positive on a real
 * Float32 buffer astronomically unlikely.
 *
 * Stored embeddings are unit-normalized (see the
 * normalize-embeddings-unit-vectors migration), so per-vector symmetric int8
 * quantization (`scale = max|v_i| / 127`) is well-conditioned: ~4× smaller
 * than Float32 with mean cosine similarity ≥ 0.999 to the original. If that
 * ever proves too lossy, flip {@link EMBEDDING_STORAGE_DTYPE} to
 * `EMBEDDING_DTYPE_F16` (2× smaller, effectively lossless) — the format and
 * migration already support it.
 *
 * The "to blob" direction takes any ArrayLike<number> (plain arrays or
 * Float32Array). The "from blob" direction always returns a fresh
 * Float32Array — the source Buffer's backing ArrayBuffer may be pooled or
 * reused by Node, so callers must not alias it.
 *
 * The `blobToEmbedding` / `embeddingToBlob` names are the legacy spelling
 * used in the SQLite backend; the `blobToFloat32` / `float32ToBlob` names
 * are the embedding-layer spelling. Both are exported here so call sites
 * read naturally in their own context.
 */

/** First byte of every quantized-format blob. */
export const EMBEDDING_BLOB_MAGIC = 0xeb;
/** Quantized-format version this codec reads and writes. */
export const EMBEDDING_BLOB_VERSION = 0x01;
/** dtype byte: int8 symmetric quantization with a per-vector float32 scale. */
export const EMBEDDING_DTYPE_INT8 = 0x01;
/** dtype byte: IEEE 754 half-precision floats, no scale. */
export const EMBEDDING_DTYPE_F16 = 0x02;

export type EmbeddingStorageDtype = typeof EMBEDDING_DTYPE_INT8 | typeof EMBEDDING_DTYPE_F16;

/**
 * The dtype all NEW embedding writes use. int8-symmetric is the ~4× win;
 * switch to EMBEDDING_DTYPE_F16 if int8 recall regression ever proves
 * material — one constant, no other change.
 */
export const EMBEDDING_STORAGE_DTYPE: EmbeddingStorageDtype = EMBEDDING_DTYPE_INT8;

const INT8_HEADER_BYTES = 11; // magic + version + dtype + dim(4) + scale(4)
const F16_HEADER_BYTES = 7; // magic + version + dtype + dim(4)

/**
 * True iff the blob carries the self-describing quantized format: magic and
 * version match AND the declared dim is self-consistent with the byte
 * length. Anything else must be decoded as legacy raw Float32.
 */
export function isQuantizedEmbeddingBlob(blob: Buffer): boolean {
  if (blob.byteLength < F16_HEADER_BYTES) return false;
  if (blob[0] !== EMBEDDING_BLOB_MAGIC || blob[1] !== EMBEDDING_BLOB_VERSION) return false;
  const dtype = blob[2];
  const dim = blob.readUInt32LE(3);
  if (dtype === EMBEDDING_DTYPE_INT8) {
    return blob.byteLength === INT8_HEADER_BYTES + dim;
  }
  if (dtype === EMBEDDING_DTYPE_F16) {
    return blob.byteLength === F16_HEADER_BYTES + 2 * dim;
  }
  return false;
}

// ---------------------------------------------------------------------------
// float16 helpers (manual bit conversion — no runtime/TS-lib dependency)
// ---------------------------------------------------------------------------

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** Encode one float32 as IEEE 754 half-precision bits (round-to-nearest-even). */
function float32ToHalfBits(value: number): number {
  f32Scratch[0] = value;
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const mantissaAndExp = x & 0x7fffffff;

  if (mantissaAndExp >= 0x47800000) {
    // Overflows half range → ±Infinity (or NaN preserved)
    return mantissaAndExp > 0x7f800000 ? sign | 0x7e00 : sign | 0x7c00;
  }
  if (mantissaAndExp < 0x38800000) {
    // Subnormal in half precision (or zero). A float32 value 1.m × 2^(e-127)
    // maps to the 10-bit subnormal mantissa h = mant24 × 2^(e-126), i.e.
    // mant24 >> (126 - e).
    const shift = 126 - (mantissaAndExp >>> 23);
    if (shift > 24) return sign; // underflows to ±0
    const mant = (mantissaAndExp & 0x7fffff) | 0x800000;
    const half = mant >> shift;
    // round-to-nearest-even on the dropped bits
    const roundBit = (mant >> (shift - 1)) & 1;
    const sticky = (mant & ((1 << (shift - 1)) - 1)) !== 0;
    return sign | (half + (roundBit && (sticky || half & 1) ? 1 : 0));
  }
  // Normal case: rebias exponent, round mantissa
  const bits = (mantissaAndExp >> 13) - 0x1c000;
  const roundBit = (mantissaAndExp >> 12) & 1;
  const sticky = (mantissaAndExp & 0xfff) !== 0;
  return sign | (bits + (roundBit && (sticky || bits & 1) ? 1 : 0));
}

/** Decode IEEE 754 half-precision bits to a float32 number. */
function halfBitsToFloat32(h: number): number {
  const sign = (h & 0x8000) << 16;
  const expMant = h & 0x7fff;
  let bits: number;
  if (expMant >= 0x7c00) {
    // Inf / NaN
    bits = sign | 0x7f800000 | ((expMant & 0x3ff) << 13);
  } else if (expMant >= 0x0400) {
    // Normal
    bits = sign | ((expMant + 0x1c000) << 13);
  } else if (expMant === 0) {
    bits = sign; // ±0
  } else {
    // Subnormal half → normalized float32
    let mant = expMant & 0x3ff;
    let exp = 113;
    while ((mant & 0x400) === 0) {
      mant <<= 1;
      exp--;
    }
    mant &= 0x3ff;
    bits = sign | (exp << 23) | (mant << 13);
  }
  u32Scratch[0] = bits >>> 0;
  return f32Scratch[0];
}

// ---------------------------------------------------------------------------
// Quantized encode / decode
// ---------------------------------------------------------------------------

/**
 * Encode an embedding into the self-describing quantized format.
 * int8-symmetric: `scale = max|v_i| / 127` (guarded to 1 for an all-zero
 * vector), `q_i = clamp(round(v_i / scale), -127, 127)`.
 */
export function float32ToQuantized(
  embedding: ArrayLike<number>,
  dtype: EmbeddingStorageDtype = EMBEDDING_STORAGE_DTYPE,
): Buffer {
  const src =
    embedding instanceof Float32Array
      ? embedding
      : new Float32Array(Array.from(embedding as ArrayLike<number>));
  const dim = src.length;

  if (dtype === EMBEDDING_DTYPE_F16) {
    const buf = Buffer.allocUnsafe(F16_HEADER_BYTES + 2 * dim);
    buf[0] = EMBEDDING_BLOB_MAGIC;
    buf[1] = EMBEDDING_BLOB_VERSION;
    buf[2] = EMBEDDING_DTYPE_F16;
    buf.writeUInt32LE(dim, 3);
    for (let i = 0; i < dim; i++) {
      buf.writeUInt16LE(float32ToHalfBits(src[i]), F16_HEADER_BYTES + 2 * i);
    }
    return buf;
  }

  let maxAbs = 0;
  for (let i = 0; i < dim; i++) {
    const a = Math.abs(src[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 0 && Number.isFinite(maxAbs) ? maxAbs / 127 : 1;

  const buf = Buffer.allocUnsafe(INT8_HEADER_BYTES + dim);
  buf[0] = EMBEDDING_BLOB_MAGIC;
  buf[1] = EMBEDDING_BLOB_VERSION;
  buf[2] = EMBEDDING_DTYPE_INT8;
  buf.writeUInt32LE(dim, 3);
  buf.writeFloatLE(scale, 7);
  for (let i = 0; i < dim; i++) {
    const q = Math.max(-127, Math.min(127, Math.round(src[i] / scale)));
    buf.writeInt8(Number.isFinite(q) ? q : 0, INT8_HEADER_BYTES + i);
  }
  return buf;
}

/**
 * Decode a quantized-format blob (int8 or f16, dispatched on the header) to
 * a fresh Float32Array. Throws if the blob is not quantized-format — callers
 * that may hold legacy blobs should use {@link blobToFloat32} instead.
 */
export function quantizedToFloat32(blob: Buffer): Float32Array {
  if (!isQuantizedEmbeddingBlob(blob)) {
    throw new Error('Not a quantized embedding blob');
  }
  const dtype = blob[2];
  const dim = blob.readUInt32LE(3);
  const out = new Float32Array(dim);

  if (dtype === EMBEDDING_DTYPE_INT8) {
    const scale = blob.readFloatLE(7);
    for (let i = 0; i < dim; i++) {
      out[i] = blob.readInt8(INT8_HEADER_BYTES + i) * scale;
    }
    return out;
  }

  // EMBEDDING_DTYPE_F16 (isQuantizedEmbeddingBlob admits nothing else)
  for (let i = 0; i < dim; i++) {
    out[i] = halfBitsToFloat32(blob.readUInt16LE(F16_HEADER_BYTES + 2 * i));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public codec surface (header-aware read, quantized write)
// ---------------------------------------------------------------------------

/**
 * Convert a stored embedding BLOB back to a Float32Array (fresh copy).
 * Header-aware: quantized-format blobs are dequantized; anything else is
 * interpreted as legacy raw Float32 bytes.
 */
export function blobToFloat32(blob: Buffer): Float32Array {
  if (isQuantizedEmbeddingBlob(blob)) {
    return quantizedToFloat32(blob);
  }
  const view = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return new Float32Array(view);
}

/**
 * Convert any ArrayLike<number> into the storage BLOB format. All new writes
 * are quantized ({@link EMBEDDING_STORAGE_DTYPE}); use
 * {@link float32ToBlobRaw} for an explicit legacy raw-Float32 buffer.
 */
export function float32ToBlob(embedding: ArrayLike<number>): Buffer {
  return float32ToQuantized(embedding, EMBEDDING_STORAGE_DTYPE);
}

/**
 * Encode raw Float32 bytes with no header — the legacy on-disk format. Kept
 * for round-trip tests and any caller that explicitly needs uncompressed
 * Float32 storage.
 */
export function float32ToBlobRaw(embedding: ArrayLike<number>): Buffer {
  const float32 =
    embedding instanceof Float32Array
      ? embedding
      : new Float32Array(Array.from(embedding as ArrayLike<number>));
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

/**
 * SQL expression yielding an embedding blob's dimension regardless of its
 * on-disk format: quantized blobs announce themselves with the magic+version+
 * dtype prefix and encode dim in their byte length (int8: 11-byte header +
 * 1 byte/dim; f16: 7-byte header + 2 bytes/dim); anything else is legacy raw
 * Float32 at 4 bytes/dim. Lives here so SQL-side dimension checks can never
 * drift from the codec's byte layout above.
 */
export const EMBEDDING_DIM_SQL = `CASE
  WHEN substr(embedding, 1, 3) = X'EB0101' THEN length(embedding) - 11
  WHEN substr(embedding, 1, 3) = X'EB0102' THEN (length(embedding) - 7) / 2
  ELSE length(embedding) / 4
END`;

/** Alias for {@link blobToFloat32} — SQLite-backend spelling. */
export const blobToEmbedding = blobToFloat32;

/** Alias for {@link float32ToBlob} — SQLite-backend spelling. */
export const embeddingToBlob = float32ToBlob;

/**
 * Recover an embedding that was persisted as legacy JSON text (before the
 * Float32-BLOB storage format). Two historical shapes exist:
 *
 *   - a JSON array — `"[0.1, 0.2, ...]"`
 *   - a JSON object produced by `JSON.stringify(someFloat32Array)`, which
 *     serialises a typed array as an index-keyed object —
 *     `'{"0":0.1,"1":0.2,...}'`
 *
 * Returns the dense `number[]` in index order, or `undefined` when the text is
 * not a usable embedding (scalar, null, or unparseable). Integer-like object
 * keys iterate in ascending numeric order, so `Object.values` is index-ordered.
 * The caller's schema converts the returned `number[]` into a `Float32Array`.
 */
export function parseLegacyEmbeddingText(value: string): number[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (Array.isArray(parsed)) {
    return parsed as number[];
  }
  if (parsed && typeof parsed === 'object') {
    return Object.values(parsed as Record<string, number>);
  }
  return undefined;
}
