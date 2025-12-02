/**
 * Centralized File Manager
 *
 * Single source of truth for all file operations in the application.
 * All files are stored in data/files/storage/ with UUID-based filenames.
 * Metadata is tracked in data/files/files.jsonl.
 */

import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { FileEntry, FileSource, FileCategory } from '../json-store/schemas/types';
import { FileEntrySchema } from '../json-store/schemas/types';

const FILES_DIR = 'public/data/files';
const STORAGE_DIR = join(FILES_DIR, 'storage');
const INDEX_FILE = join(FILES_DIR, 'files.jsonl');

/**
 * Ensure the file storage directories exist
 */
async function ensureDirectories(): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

/**
 * Calculate SHA256 hash of file buffer
 */
function calculateHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Get the storage path for a file ID
 */
function getStoragePath(fileId: string, originalFilename: string): string {
  const ext = extname(originalFilename);
  return join(STORAGE_DIR, `${fileId}${ext}`);
}

/**
 * Get the relative storage path (for API responses)
 */
function getRelativeStoragePath(fileId: string, originalFilename: string): string {
  const ext = extname(originalFilename);
  return `files/storage/${fileId}${ext}`;
}

/**
 * Read all file entries from the JSONL database
 */
async function readAllEntries(): Promise<FileEntry[]> {
  try {
    const content = await fs.readFile(INDEX_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    return lines.map(line => FileEntrySchema.parse(JSON.parse(line)));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Write all entries to the JSONL database
 */
async function writeAllEntries(entries: FileEntry[]): Promise<void> {
  await ensureDirectories();
  const content = entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
  await fs.writeFile(INDEX_FILE, content, 'utf-8');
}

/**
 * Append an entry to the JSONL database
 */
async function appendEntry(entry: FileEntry): Promise<void> {
  await ensureDirectories();
  await fs.appendFile(INDEX_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Find a file entry by ID
 */
export async function findFileById(id: string): Promise<FileEntry | null> {
  const entries = await readAllEntries();
  return entries.find(entry => entry.id === id) || null;
}

/**
 * Find file entries by SHA256 hash
 */
export async function findFileByHash(sha256: string): Promise<FileEntry | null> {
  const entries = await readAllEntries();
  return entries.find(entry => entry.sha256 === sha256) || null;
}

/**
 * Find all file entries linked to a specific entity
 */
export async function findFilesLinkedTo(entityId: string): Promise<FileEntry[]> {
  const entries = await readAllEntries();
  return entries.filter(entry => entry.linkedTo.includes(entityId));
}

/**
 * Find files by category
 */
export async function findFilesByCategory(category: FileCategory): Promise<FileEntry[]> {
  const entries = await readAllEntries();
  return entries.filter(entry => entry.category === category);
}

/**
 * Find files by source
 */
export async function findFilesBySource(source: FileSource): Promise<FileEntry[]> {
  const entries = await readAllEntries();
  return entries.filter(entry => entry.source === source);
}

/**
 * Find files by user ID
 */
export async function findFilesByUserId(userId: string): Promise<FileEntry[]> {
  const entries = await readAllEntries();
  return entries.filter(entry => entry.userId === userId);
}
/**
 * Find files by tag
 */
export async function findFilesByTag(tagId: string): Promise<FileEntry[]> {
  const entries = await readAllEntries();
  return entries.filter(entry => entry.tags.includes(tagId));
}

/**
 * Get all file entries
 */
export async function getAllFiles(): Promise<FileEntry[]> {
  return await readAllEntries();
}

export interface CreateFileParams {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  source: FileSource;
  category: FileCategory;
  userId: string;
  linkedTo?: string[];
  tags?: string[];
  width?: number;
  height?: number;
  generationPrompt?: string;
  generationModel?: string;
  generationRevisedPrompt?: string;
  description?: string;
}

/**
 * Create a new file entry and store the file
 */
export async function createFile(params: CreateFileParams): Promise<FileEntry> {
  const {
    buffer,
    originalFilename,
    mimeType,
    source,
    category,
    userId,
    linkedTo = [],
    tags = [],
    width,
    height,
    generationPrompt,
    generationModel,
    generationRevisedPrompt,
    description,
  } = params;

  await ensureDirectories();

  const id = randomUUID();
  const sha256 = calculateHash(buffer);
  const now = new Date().toISOString();

  // Check for duplicate by hash
  const existing = await findFileByHash(sha256);
  if (existing) {
    // File already exists, just update the linkedTo array if needed
    const updatedLinkedTo = Array.from(new Set([...existing.linkedTo, ...linkedTo]));
    if (updatedLinkedTo.length > existing.linkedTo.length) {
      return await updateFile(existing.id, { linkedTo: updatedLinkedTo });
    }
    return existing;
  }

  const entry: FileEntry = {
    id,
    userId,
    sha256,
    originalFilename,
    mimeType,
    size: buffer.length,
    width: width || null,
    height: height || null,
    linkedTo,
    source,
    category,
    generationPrompt: generationPrompt || null,
    generationModel: generationModel || null,
    generationRevisedPrompt: generationRevisedPrompt || null,
    description: description || null,
    tags,
    createdAt: now,
    updatedAt: now,
  };

  // Validate the entry
  const validated = FileEntrySchema.parse(entry);

  // Write the file to storage
  const storagePath = getStoragePath(id, originalFilename);
  await fs.writeFile(storagePath, buffer);

  // Append to index
  await appendEntry(validated);

  return validated;
}

/**
 * Update a file entry (metadata only, not the file itself)
 */
export async function updateFile(id: string, updates: Partial<FileEntry>): Promise<FileEntry> {
  const entries = await readAllEntries();
  const index = entries.findIndex(entry => entry.id === id);

  if (index === -1) {
    throw new Error(`File not found: ${id}`);
  }

  const existing = entries[index];
  const now = new Date().toISOString();

  const updated: FileEntry = {
    ...existing,
    ...updates,
    id: existing.id, // Preserve ID
    sha256: existing.sha256, // Preserve hash
    createdAt: existing.createdAt, // Preserve creation time
    updatedAt: now,
  };

  const validated = FileEntrySchema.parse(updated);
  entries[index] = validated;

  await writeAllEntries(entries);

  return validated;
}

/**
 * Add a link to a file entry
 */
export async function addFileLink(fileId: string, entityId: string): Promise<FileEntry> {
  const entry = await findFileById(fileId);
  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.linkedTo.includes(entityId)) {
    const updatedLinkedTo = [...entry.linkedTo, entityId];
    return await updateFile(fileId, { linkedTo: updatedLinkedTo });
  }

  return entry;
}

/**
 * Remove a link from a file entry
 */
export async function removeFileLink(fileId: string, entityId: string): Promise<FileEntry> {
  const entry = await findFileById(fileId);
  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  const updatedLinkedTo = entry.linkedTo.filter(id => id !== entityId);
  return await updateFile(fileId, { linkedTo: updatedLinkedTo });
}

/**
 * Add a tag to a file entry
 */
export async function addFileTag(fileId: string, tagId: string): Promise<FileEntry> {
  const entry = await findFileById(fileId);
  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  if (!entry.tags.includes(tagId)) {
    const updatedTags = [...entry.tags, tagId];
    return await updateFile(fileId, { tags: updatedTags });
  }

  return entry;
}

/**
 * Remove a tag from a file entry
 */
export async function removeFileTag(fileId: string, tagId: string): Promise<FileEntry> {
  const entry = await findFileById(fileId);
  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  const updatedTags = entry.tags.filter(id => id !== tagId);
  return await updateFile(fileId, { tags: updatedTags });
}

/**
 * Read a file from storage
 */
export async function readFile(fileId: string): Promise<Buffer> {
  const entry = await findFileById(fileId);
  if (!entry) {
    throw new Error(`File not found: ${fileId}`);
  }

  const storagePath = getStoragePath(fileId, entry.originalFilename);
  return await fs.readFile(storagePath);
}

/**
 * Read a file as base64
 */
export async function readFileAsBase64(fileId: string): Promise<string> {
  const buffer = await readFile(fileId);
  return buffer.toString('base64');
}

/**
 * Delete a file entry and its physical file
 */
export async function deleteFile(id: string): Promise<boolean> {
  const entry = await findFileById(id);
  if (!entry) {
    return false;
  }

  // Delete the physical file
  const storagePath = getStoragePath(id, entry.originalFilename);
  try {
    await fs.unlink(storagePath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File already deleted, continue
  }

  // Remove from index
  const entries = await readAllEntries();
  const filtered = entries.filter(e => e.id !== id);

  if (filtered.length === entries.length) {
    return false; // Entry not found in index
  }

  await writeAllEntries(filtered);

  return true;
}

/**
 * Get the public URL path for a file
 * Returns path WITHOUT leading slash since frontend components add it
 */
export function getFileUrl(fileId: string, originalFilename: string): string {
  const ext = extname(originalFilename);
  return `data/files/storage/${fileId}${ext}`;
}

/**
 * Get the API URL for a file (alternative serving method)
 */
export function getFileApiUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

/**
 * Get the absolute filesystem path for a file
 */
export function getFileSystemPath(fileId: string, originalFilename: string): string {
  const ext = extname(originalFilename);
  return join(process.cwd(), STORAGE_DIR, `${fileId}${ext}`);
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(fileId: string, originalFilename: string): Promise<boolean> {
  try {
    const storagePath = getStoragePath(fileId, originalFilename);
    await fs.access(storagePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file statistics
 */
export interface FileStats {
  totalFiles: number;
  totalSize: number;
  byCategory: Record<FileCategory, number>;
  bySource: Record<FileSource, number>;
}

export async function getFileStats(): Promise<FileStats> {
  const entries = await readAllEntries();

  const stats: FileStats = {
    totalFiles: entries.length,
    totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
    byCategory: {
      IMAGE: 0,
      DOCUMENT: 0,
      AVATAR: 0,
      ATTACHMENT: 0,
      EXPORT: 0,
    },
    bySource: {
      UPLOADED: 0,
      GENERATED: 0,
      IMPORTED: 0,
      SYSTEM: 0,
    },
  };

  for (const entry of entries) {
    stats.byCategory[entry.category]++;
    stats.bySource[entry.source]++;
  }

  return stats;
}
