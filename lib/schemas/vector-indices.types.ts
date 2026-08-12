/**
 * Vector Indices Type Definitions
 *
 * Contains schemas for vector indices (embeddings for semantic search).
 * Each index represents a complete set of embeddings for a single character.
 *
 * @module schemas/vector-indices.types
 */

import { z } from 'zod';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// VECTOR METADATA
// ============================================================================

export const VectorMetadataSchema = z.looseObject({
  memoryId: UUIDSchema,
  characterId: UUIDSchema,
  content: z.string().optional(),
});

export type VectorMetadata = z.infer<typeof VectorMetadataSchema>;

// ============================================================================
// VECTOR ENTRY
// ============================================================================

export const VectorEntrySchema = z.object({
  id: UUIDSchema,
  embedding: z.union([
    z.instanceof(Float32Array),
    z.array(z.number()).transform((arr): Float32Array => new Float32Array(arr)),
  ]),
  metadata: VectorMetadataSchema,
  createdAt: TimestampSchema,
});

export type VectorEntry = z.infer<typeof VectorEntrySchema>;

// ============================================================================
// VECTOR INDEX
// ============================================================================

export const VectorIndexSchema = z.object({
  id: UUIDSchema, // characterId
  characterId: UUIDSchema,
  version: z.number(),
  dimensions: z.number(),
  entries: z.array(VectorEntrySchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type VectorIndex = z.infer<typeof VectorIndexSchema>;

// ============================================================================
// NORMALIZED VECTOR STORAGE (v2 — BLOB-backed)
// ============================================================================

/**
 * Per-character metadata row in `vector_indices` table (no entries column).
 */
export const VectorIndexMetaSchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  version: z.number(),
  dimensions: z.number(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type VectorIndexMeta = z.infer<typeof VectorIndexMetaSchema>;

/**
 * Per-embedding row in `vector_entries` table.
 * The embedding is stored as a Float32 BLOB in SQLite and
 * hydrated as Float32Array at the application layer.
 * Accepts Float32Array, number[], Buffer, or JSON string (legacy) for
 * transparent storage support.
 */
export const VectorEntryRowSchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  embedding: z.union([
    z.instanceof(Float32Array),
    z.array(z.number()).transform((arr): Float32Array => new Float32Array(arr)),
    // Header-aware decode: handles both legacy raw Float32 blobs and the
    // self-describing quantized format (see lib/embedding/float32-conversion.ts).
    z.instanceof(Buffer).transform((buf): Float32Array => blobToFloat32(buf)),
    z.string().transform((s): Float32Array => {
      const parsed = JSON.parse(s);
      if (!Array.isArray(parsed)) throw new Error('Embedding string is not a JSON array');
      return new Float32Array(parsed);
    }),
  ]),
  createdAt: TimestampSchema,
});

export type VectorEntryRow = z.infer<typeof VectorEntryRowSchema>;
