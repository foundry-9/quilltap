/**
 * File Type Definitions
 *
 * Contains schemas for file entries and binary index entries
 * used in the centralized file management system.
 *
 * @module schemas/file.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// FILE ENUMS
// ============================================================================

export const FileSourceEnum = z.enum(['UPLOADED', 'GENERATED', 'IMPORTED', 'SYSTEM']);
export type FileSource = z.infer<typeof FileSourceEnum>;

export const FileCategoryEnum = z.enum(['IMAGE', 'DOCUMENT', 'AVATAR', 'ATTACHMENT', 'EXPORT', 'BACKUP', 'ARCHIVE']);
export type FileCategory = z.infer<typeof FileCategoryEnum>;

export const FileStatusEnum = z.enum(['ok', 'orphaned']);
export type FileStatus = z.infer<typeof FileStatusEnum>;

// ============================================================================
// FILE ENTRY
// ============================================================================

export const FileEntrySchema = z.object({
  // Identity & Storage
  id: UUIDSchema,                          // File UUID (also the base filename in storage)
  userId: UUIDSchema,                      // Owner of the file
  sha256: z.string().length(64),           // Content hash for deduplication
  originalFilename: z.string(),            // Original filename from upload/generation
  mimeType: z.string(),                    // Specific MIME type
  size: z.number(),                        // File size in bytes

  // Image metadata (if applicable)
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),

  // Text content detection (populated during upload)
  isPlainText: z.boolean().optional(),

  // Linking - array of IDs this file is associated with
  linkedTo: z.array(UUIDSchema).default([]),  // messageId, chatId, characterId, etc.

  // Classification
  source: FileSourceEnum,                  // Where the file came from
  category: FileCategoryEnum,              // What type of file it is

  // Generation metadata (for AI-generated files)
  generationPrompt: z.string().nullable().optional(),
  generationModel: z.string().nullable().optional(),
  generationRevisedPrompt: z.string().nullable().optional(),
  description: z.string().nullable().optional(),  // AI description or user-provided description

  // Tags
  tags: z.array(UUIDSchema).default([]),

  // Project and folder association
  projectId: UUIDSchema.nullable().optional(),

  // Folder path within project or general files
  // "/" = root (default), "/documents/", "/documents/reports/"
  // Always starts and ends with "/" when non-root
  // Defaults to "/" when not specified
  folderPath: z.string().nullable().optional(),

  // Storage key for local file storage
  storageKey: z.string().nullable().optional(),

  // File status for filesystem sync tracking
  // 'ok' = normal file, 'orphaned' = found on disk with no prior DB record
  fileStatus: FileStatusEnum.default('ok').optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type FileEntry = z.infer<typeof FileEntrySchema>;

// ============================================================================
// LEGACY BINARY INDEX ENTRY (for migration)
// ============================================================================

// Legacy BinaryIndexEntry schema (for migration)
export const BinaryIndexEntrySchema = z.object({
  id: UUIDSchema,
  sha256: z.string().length(64),
  type: z.enum(['image', 'chat_file', 'avatar']),
  userId: UUIDSchema,
  filename: z.string(),
  relativePath: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  source: z.enum(['upload', 'import', 'generated']).default('upload'),
  generationPrompt: z.string().nullable().optional(),
  generationModel: z.string().nullable().optional(),
  chatId: UUIDSchema.nullable().optional(),
  characterId: UUIDSchema.nullable().optional(),  // For avatar overrides
  messageId: UUIDSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type BinaryIndexEntry = z.infer<typeof BinaryIndexEntrySchema>;
