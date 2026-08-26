/**
 * Document Mount Index Type Definitions
 *
 * Schemas for Project Scriptorium Phase 3.2 document mount points —
 * external document directories that can be indexed and searched
 * alongside conversation data. These are NOT the old file storage
 * mount points that were dropped in v2.9.0.
 *
 * @module schemas/mount-index.types
 */

import { z } from 'zod';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// DOCUMENT MOUNT POINT
// ============================================================================

export const DocMountPointSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),           // Display name for the mount point
  // Absolute filesystem path. Required for filesystem/obsidian; empty string for database-backed stores.
  basePath: z.string().default(''),
  mountType: z.enum(['filesystem', 'obsidian', 'database']).default('filesystem'),
  // Content classification orthogonal to mountType. 'documents' is the default
  // generic store; 'character' flags stores holding character sheets / Aurora
  // material, which downstream features may treat specially.
  storeType: z.enum(['documents', 'character']).default('documents'),
  includePatterns: z.array(z.string()).default(['*.md', '*.txt', '*.pdf', '*.docx']),
  excludePatterns: z.array(z.string()).default(['.git', 'node_modules', '.obsidian', '.trash']),
  enabled: z.boolean().default(true),
  lastScannedAt: TimestampSchema.nullable().optional(),
  scanStatus: z.enum(['idle', 'scanning', 'error']).default('idle'),
  lastScanError: z.string().nullable().optional(),
  // Backend-storage conversion state (filesystem ↔ database). 'converting' means
  // filesystem→database in flight; 'deconverting' means database→filesystem in
  // flight. Distinct from the file-level doc_mount_files.conversionStatus,
  // which tracks pdf/docx→text extraction.
  conversionStatus: z.enum(['idle', 'converting', 'deconverting', 'error']).default('idle'),
  conversionError: z.string().nullable().optional(),
  fileCount: z.number().int().default(0),   // Cached count of active files
  chunkCount: z.number().int().default(0),  // Cached count of chunks
  totalSizeBytes: z.number().int().default(0),  // Cached total size of all files in bytes
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountPoint = z.infer<typeof DocMountPointSchema>;
export type DocMountPointType = DocMountPoint['mountType'];

// ============================================================================
// DOCUMENT MOUNT FOLDER (database-backed stores only)
// ============================================================================

export const DocMountFolderSchema = z.object({
  id: UUIDSchema,
  mountPointId: UUIDSchema,
  parentId: UUIDSchema.nullable().optional(),    // null = mount-point root
  name: z.string().min(1),             // Folder segment only (no slashes)
  path: z.string(),                    // Full relative path; '' for root; denormalised for fast lookup
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountFolder = z.infer<typeof DocMountFolderSchema>;

// ============================================================================
// DOCUMENT MOUNT FILE (content row — content-addressable)
// ============================================================================

// A doc_mount_files row is the content identity for a set of bytes. Writers
// look up by sha256 (indexed, not UNIQUE — existing instances may carry
// duplicate sha rows that pre-date the content/link split) and call
// findOrCreateByContent to reuse the existing row when there's a match,
// preserving its UUID. Location, filename, folder, and per-consumer
// extraction state live on doc_mount_file_links — one file row may be
// hard-linked from many mounts.
export const DocMountFileSchema = z.object({
  id: UUIDSchema,
  sha256: z.string().length(64),     // Content fingerprint; indexed
  fileSizeBytes: z.number().int().min(0),
  // 'blob' is the catch-all for arbitrary binaries with no extracted text
  // representation — the bytes live in doc_mount_blobs and there are no chunks.
  fileType: z.enum(['pdf', 'docx', 'markdown', 'txt', 'json', 'jsonl', 'blob']),
  // Where the file content physically lives: on-disk ('filesystem') or inside
  // doc_mount_documents / doc_mount_blobs ('database'). Filesystem-source rows
  // are constrained to a single link (different basePaths can't share bytes
  // without copy-on-link); database-source rows can be hard-linked freely.
  source: z.enum(['filesystem', 'database']).default('filesystem'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountFile = z.infer<typeof DocMountFileSchema>;

/**
 * The `fileType` values that hold editable plain text — the set the global
 * search bar's Documents chip searches and the set Document Mode can open.
 * `pdf`/`docx` carry extracted text but are not editable documents, and
 * `blob` has no text representation at all.
 */
export const EDITABLE_TEXT_FILE_TYPES = ['markdown', 'txt', 'json', 'jsonl'] as const;

// ============================================================================
// DOCUMENT MOUNT FILE LINK (the hard link — per-(mountPoint, relativePath))
// ============================================================================

// One row per visible location of a file. Multiple link rows may point at the
// same doc_mount_files row (hard linking). Per-link state — display name,
// folder placement, conversion lifecycle, extracted text, embeddings — lives
// here so each consumer can mutate its own view of a shared file without
// disturbing the others.
//
// Cleanup invariant: deleting the last link for a file deletes the file row,
// which cascades to doc_mount_documents / doc_mount_blobs via FK.
export const DocMountFileLinkSchema = z.object({
  id: UUIDSchema,
  fileId: UUIDSchema,                // FK -> doc_mount_files.id
  // Deliberate hard-link group. Links sharing a non-null linkGroupId were
  // explicitly linked (`docs link`) and behave like POSIX hard links: a write
  // through any member repoints EVERY member at the new content row.
  //
  // This is deliberately NOT the same thing as sharing a fileId. File rows are
  // content-addressed by sha256, so two unrelated files with byte-identical
  // content share a fileId by coincidence — writing to one of those must fork,
  // not rewrite the other. Only a non-null group means "these are one file".
  linkGroupId: UUIDSchema.nullable().optional(),
  mountPointId: UUIDSchema,          // FK -> doc_mount_points.id
  relativePath: z.string().min(1),   // Relative to basePath (or virtual for database-backed)
  fileName: z.string().min(1),
  folderId: UUIDSchema.nullable().optional(),
  // Per-link blob metadata (was on doc_mount_blobs before the refactor).
  // null for non-blob files; populated for blob-type files.
  originalFileName: z.string().nullable().optional(),
  originalMimeType: z.string().nullable().optional(),
  description: z.string().default(''),
  descriptionUpdatedAt: TimestampSchema.nullable().optional(),
  // Per-link extraction state for chunkable content (pdf/docx -> text).
  conversionStatus: z.enum(['pending', 'converted', 'failed', 'skipped']).default('pending'),
  conversionError: z.string().nullable().optional(),
  plainTextLength: z.number().int().nullable().optional(),
  // Per-link extracted text (was on doc_mount_blobs.extractedText). Holds the
  // OCR/caption / pdf-extract output that fuels embedding and LLM context.
  extractedText: z.string().nullable().optional(),
  extractedTextSha256: z.string().length(64).nullable().optional(),
  extractionStatus: z
    .enum(['none', 'pending', 'converted', 'failed', 'skipped'])
    .default('none'),
  extractionError: z.string().nullable().optional(),
  chunkCount: z.number().int().default(0),
  // Per-document policy, derived from markdown frontmatter at index time
  // (positive sense: `1`/true == permissive == the frontmatter default).
  //   allowEmbed          — embed for semantic retrieval (frontmatter `embed`)
  //   allowCharacterRead  — visible/readable to LLM characters (`character_read`)
  //   allowCharacterWrite — mutable by LLM characters (`character_write`)
  // Non-markdown links keep the permissive defaults — they carry no frontmatter.
  // The human operator (operatorOverride) is never restricted by these flags.
  allowEmbed: z.boolean().default(true),
  allowCharacterRead: z.boolean().default(true),
  allowCharacterWrite: z.boolean().default(true),
  lastModified: TimestampSchema,     // Per-link mtime (link can be touched independently)
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountFileLink = z.infer<typeof DocMountFileLinkSchema>;

// Convenience joined view: a link row enriched with content fields. This is
// what most consumers want (and what DocMountFileLinksRepository.find*
// methods return) so callers don't need to JOIN manually.
export interface DocMountFileLinkWithContent extends DocMountFileLink {
  sha256: string;
  fileSizeBytes: number;
  fileType: DocMountFile['fileType'];
  source: DocMountFile['source'];
}

// ============================================================================
// DOCUMENT MOUNT CHUNK
// ============================================================================

export const DocMountChunkSchema = z.object({
  id: UUIDSchema,
  linkId: UUIDSchema,                // FK -> doc_mount_file_links.id
  mountPointId: UUIDSchema,          // Denormalized for query efficiency
  chunkIndex: z.number().int().min(0),
  content: z.string(),
  tokenCount: z.number().int().min(0),
  headingContext: z.string().nullable().optional(),  // What section heading this chunk is under
  embedding: z.union([
    z.instanceof(Float32Array),
    z.array(z.number()).transform((arr): Float32Array => new Float32Array(arr)),
    // Header-aware decode: handles both legacy raw Float32 blobs and the
    // self-describing quantized format (see lib/embedding/float32-conversion.ts).
    z.instanceof(Buffer).transform((buf): Float32Array => blobToFloat32(buf)),
  ]).nullable().optional(),  // Unit-length Float32 BLOB on disk
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountChunk = z.infer<typeof DocMountChunkSchema>;

// ============================================================================
// PROJECT ↔ DOCUMENT MOUNT LINK
// ============================================================================

export const ProjectDocMountLinkSchema = z.object({
  id: UUIDSchema,
  projectId: UUIDSchema,
  mountPointId: UUIDSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ProjectDocMountLink = z.infer<typeof ProjectDocMountLinkSchema>;

// ============================================================================
// GROUP ↔ DOCUMENT MOUNT LINK
//
// A group's *additional linked* stores (the official store is recorded on the
// group row as `officialMountPointId`, not here). Direct analogue of
// ProjectDocMountLinkSchema. `groupId` is a cross-db ref to groups.id in the
// MAIN db, exactly as project_doc_mount_links refers to projects.id.
// ============================================================================

export const GroupDocMountLinkSchema = z.object({
  id: UUIDSchema,
  groupId: UUIDSchema,
  mountPointId: UUIDSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GroupDocMountLink = z.infer<typeof GroupDocMountLinkSchema>;

// ============================================================================
// GROUP ↔ CHARACTER MEMBERSHIP
//
// Characters ↔ groups is many-to-many; this join table keeps the character row
// untouched and the relation symmetric. `findByCharacterId` is the hot path for
// tier resolution, so `characterId` is indexed. Both `groupId` and
// `characterId` are cross-db refs to the MAIN db (groups.id / characters.id).
// ============================================================================

export const GroupCharacterMemberSchema = z.object({
  id: UUIDSchema,
  groupId: UUIDSchema,
  characterId: UUIDSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GroupCharacterMember = z.infer<typeof GroupCharacterMemberSchema>;

// ============================================================================
// DOCUMENT MOUNT DOCUMENT (database-backed store content)
// ============================================================================

// Text content for database-backed files. Keyed by fileId (UNIQUE) — one
// document row per doc_mount_files row whose source === 'database'. Identity
// is the content; multiple hard links may reference the same document.
export const DocMountDocumentSchema = z.object({
  id: UUIDSchema,
  fileId: UUIDSchema,                // FK -> doc_mount_files.id (UNIQUE)
  content: z.string(),
  contentSha256: z.string().length(64),  // Mirror of doc_mount_files.sha256
  plainTextLength: z.number().int().min(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountDocument = z.infer<typeof DocMountDocumentSchema>;

// ============================================================================
// DOCUMENT MOUNT BLOB (binary assets — images, etc.)
// ============================================================================

// Metadata for blobs stored in quilltap-mount-index.db. Content-addressable:
// keyed by fileId (UNIQUE), with sha256 mirrored from doc_mount_files for
// sanity. The raw bytes live in the `data` BLOB column of the same SQLite row
// but are deliberately absent from this Zod schema — the blob repository
// exposes dedicated read/write methods so we never accidentally load
// megabytes of binary into generic SQLiteCollection serialisation paths.
//
// Per-link metadata (description, original filename, extracted text) lives
// on doc_mount_file_links so each consumer can override.
export const DocMountBlobMetadataSchema = z.object({
  id: UUIDSchema,
  fileId: UUIDSchema,                  // FK -> doc_mount_files.id (UNIQUE)
  sha256: z.string().length(64),
  sizeBytes: z.number().int().min(0),
  storedMimeType: z.string().min(1),   // Usually 'image/webp' after transcode
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountBlobMetadata = z.infer<typeof DocMountBlobMetadataSchema>;
