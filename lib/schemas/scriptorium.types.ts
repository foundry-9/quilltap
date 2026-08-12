/**
 * Scriptorium Type Definitions
 *
 * Schemas for Project Scriptorium's conversation rendering,
 * annotation, and chunk embedding system.
 *
 * @module schemas/scriptorium.types
 */

import { z } from 'zod';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// CONVERSATION ANNOTATION
// ============================================================================

export const ConversationAnnotationSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  messageIndex: z.number().int().min(0),
  sourceMessageId: UUIDSchema.nullable().optional(),
  characterName: z.string(),
  content: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConversationAnnotation = z.infer<typeof ConversationAnnotationSchema>;

// Input type for creating/upserting annotations
export const ConversationAnnotationInputSchema = ConversationAnnotationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ConversationAnnotationInput = z.infer<typeof ConversationAnnotationInputSchema>;

// ============================================================================
// CONVERSATION CHUNK
// ============================================================================

export const ConversationChunkSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  interchangeIndex: z.number().int().min(0),
  content: z.string(),
  participantNames: z.array(z.string()).default([]),
  messageIds: z.array(z.string()).default([]),
  embedding: z.union([
    z.instanceof(Float32Array),
    z.array(z.number()).transform((arr): Float32Array => new Float32Array(arr)),
    // Header-aware decode: handles both legacy raw Float32 blobs and the
    // self-describing quantized format (see lib/embedding/float32-conversion.ts).
    z.instanceof(Buffer).transform((buf): Float32Array => blobToFloat32(buf)),
  ]).nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConversationChunk = z.infer<typeof ConversationChunkSchema>;

// Input type for creating/upserting chunks
export const ConversationChunkInputSchema = ConversationChunkSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ConversationChunkInput = z.infer<typeof ConversationChunkInputSchema>;

// ============================================================================
// RENDERED CONVERSATION (internal types for the renderer)
// ============================================================================

export interface InterchangeInfo {
  /** 0-based interchange index */
  index: number;
  /** Message IDs included in this interchange */
  messageIds: string[];
  /** Character names that participated in this interchange */
  participantNames: string[];
  /** The rendered Markdown content for just this interchange */
  content: string;
}

export interface RenderedConversation {
  /** Full rendered Markdown of the entire conversation */
  markdown: string;
  /** Structured data for each interchange */
  interchanges: InterchangeInfo[];
}

// ============================================================================
// CONVERSATION METADATA (for rendered header)
// ============================================================================

export interface ConversationMetadata {
  /** Chat/conversation ID */
  conversationId: string;
  /** Conversation title */
  title: string;
  /** ISO 8601 timestamp when conversation was created */
  createdAt: string;
  /** ISO 8601 timestamp when conversation was last updated */
  lastUpdatedAt: string;
}
