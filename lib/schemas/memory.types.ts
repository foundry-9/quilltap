/**
 * Memory Type Definitions
 *
 * Contains schemas for memories extracted from conversations
 * for long-term character memory and context.
 *
 * @module schemas/memory.types
 */

import { z } from 'zod';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// MEMORY ENUMS
// ============================================================================

export const MemorySourceEnum = z.enum(['AUTO', 'MANUAL']);
export type MemorySource = z.infer<typeof MemorySourceEnum>;

/**
 * Provenance of the conversational moment that produced the memory.
 *  - 'user_present': extracted from a chat where the user took at least one turn.
 *  - 'autonomous_room': extracted from an autonomous character-to-character room
 *    (no user composer in the room — see 4.6 Private Character Rooms). Memories
 *    here MUST NOT imply the user witnessed, agreed to, or was informed of the
 *    exchange.
 *  - 'manual': record was created outside the chat-extraction path entirely.
 *
 * NULL on legacy rows written before this column existed.
 */
export const WitnessedContextEnum = z.enum(['user_present', 'autonomous_room', 'manual']);
export type WitnessedContext = z.infer<typeof WitnessedContextEnum>;

/**
 * Declared kind of a memory (episodic recall overhaul):
 *  - 'semantic': a standing fact ("Charlie likes lighthouses"). The default,
 *    and what every pre-overhaul row reads as.
 *  - 'episodic': a specific occurrence ("we visited Lighthouse Point on the
 *    14th"). Retrieval, the memory gate, and housekeeping treat episodic rows
 *    differently — keying behavior off a declared kind beats inferring it from
 *    whether `occurredAt` happens to be set.
 */
export const MemoryKindEnum = z.enum(['semantic', 'episodic']);
export type MemoryKind = z.infer<typeof MemoryKindEnum>;

// ============================================================================
// MEMORY
// ============================================================================

export const MemorySchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  /**
   * The character this memory is about (who is being remembered).
   * When a memory is about another character, their ID goes here.
   */
  aboutCharacterId: UUIDSchema.nullable().optional(),
  chatId: UUIDSchema.nullable().optional(),         // Optional: source chat reference
  projectId: UUIDSchema.nullable().optional(),      // Optional: project this memory belongs to
  content: z.string(),                              // The actual memory content
  summary: z.string(),                              // Distilled version for context injection
  keywords: z.array(z.string()).default([]),        // For text-based search
  tags: z.array(UUIDSchema).default([]),            // Derived from character/chat tags
  importance: z.number().min(0).max(1).default(0.5), // 0-1 scale for prioritization
  // Vector embedding for semantic search.
  // Accepts Float32Array, number[], Buffer (Float32 BLOB from SQLite), or JSON string (legacy TEXT storage).
  // All forms are normalised to Float32Array at validation time — unit-length per
  // the normalize-embeddings-unit-vectors migration.
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
  ]).nullable().optional(),
  source: MemorySourceEnum.default('MANUAL'),       // How it was created
  /** Provenance of the conversational moment that produced this memory. Null on legacy rows. */
  witnessedContext: WitnessedContextEnum.nullable().optional(),
  // ── Episodic spine (episodic recall overhaul) ──────────────────────────────
  /**
   * ISO wall-clock time of the EVENT the memory records (not the write clock —
   * that's `createdAt`). Stamped from the source turn's message timestamp for
   * current-turn memories, or resolved server-side from a relative phrase for
   * retold events. Null on legacy rows until the backfill migration runs.
   */
  occurredAt: TimestampSchema.nullable().optional(),
  /**
   * Free-text in-story time ("the third night at sea") for chats running a
   * fictional timeline (`chat.timelineMode === 'narrative'`). Null elsewhere.
   */
  narrativeTime: z.string().nullable().optional(),
  /**
   * Proper nouns of the episode: places, people, named things. Distinct from
   * `keywords`, which carry the targeting tags and free search words.
   */
  entities: z.array(z.string()).default([]),
  /** Declared memory kind — see {@link MemoryKindEnum}. */
  kind: MemoryKindEnum.default('semantic'),
  sourceMessageId: UUIDSchema.nullable().optional(), // If auto-created, which message triggered it
  lastAccessedAt: TimestampSchema.nullable().optional(), // For housekeeping decisions
  // Memory Gate fields — reinforcement tracking
  reinforcementCount: z.number().int().min(1).default(1),  // How many times this memory has been observed
  lastReinforcedAt: TimestampSchema.nullable().optional(),  // Null until first reinforcement
  relatedMemoryIds: z.array(UUIDSchema).default([]),       // Bidirectional links to related memories
  reinforcedImportance: z.number().min(0).max(1).default(0.5), // importance + log2(count+1)*0.05, capped at 1.0
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Memory = z.infer<typeof MemorySchema>;

// ============================================================================
// MEMORIES FILE
// ============================================================================

export const MemoriesFileSchema = z.object({
  version: z.number().default(1),
  memories: z.array(MemorySchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type MemoriesFile = z.infer<typeof MemoriesFileSchema>;
