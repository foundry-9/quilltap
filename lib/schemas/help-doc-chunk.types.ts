/**
 * Help Document Chunk Type Definitions
 *
 * A help document is embedded twice over: once whole (`help_docs.embedding`,
 * a coarse "is this document about the topic at all?" signal) and once per
 * section, as rows here. Whole-document vectors smear across every subsystem a
 * long settings page happens to cover, so a precise question matches them only
 * weakly; the chunks are what let a question about one paragraph find that
 * paragraph.
 *
 * @module schemas/help-doc-chunk.types
 */

import { z } from 'zod';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// HELP DOCUMENT CHUNK
// ============================================================================

export const HelpDocChunkSchema = z.object({
  id: UUIDSchema,
  docId: UUIDSchema,                                  // Owning help_docs row
  chunkIndex: z.number().int().nonnegative(),         // 0-based position within the doc
  heading: z.string().nullable().optional(),          // Nearest Markdown heading above the chunk
  content: z.string(),                                // The chunk text (may overlap its neighbours)
  embedding: z.union([
    z.instanceof(Float32Array),
    z.array(z.number()).transform((arr): Float32Array => new Float32Array(arr)),
    // Header-aware decode: handles both legacy raw Float32 blobs and the
    // self-describing quantized format (see lib/embedding/float32-conversion.ts).
    z.instanceof(Buffer).transform((buf): Float32Array => blobToFloat32(buf)),
  ]).nullable().optional(), // Unit-length Float32 BLOB in DB
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type HelpDocChunk = z.infer<typeof HelpDocChunkSchema>;

export type HelpDocChunkInput = Omit<HelpDocChunk, 'id' | 'createdAt' | 'updatedAt'>;
