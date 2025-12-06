/**
 * Local File Manager for Migration Plugin
 *
 * This is a self-contained copy of the file manager functions needed for
 * migrating files from the legacy JSON-store format to S3.
 *
 * This file reads from the legacy local storage format:
 * - Files stored in public/data/files/storage/ with UUID-based filenames
 * - Metadata tracked in public/data/files/files.jsonl
 */

import { promises as fs } from 'fs';
import { join, extname } from 'path';
import type { FileEntry } from './json-store/schemas/types';
import { FileEntrySchema } from './json-store/schemas/types';

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
 * Get all file entries
 */
export async function getAllFiles(): Promise<FileEntry[]> {
  return await readAllEntries();
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
 * Delete a file entry and its physical file
 */
export async function deleteFile(id: string): Promise<boolean> {
  const entries = await readAllEntries();
  const entry = entries.find(e => e.id === id);

  if (!entry) {
    return false;
  }

  // Delete the physical file
  const ext = extname(entry.originalFilename);
  const storagePath = join(STORAGE_DIR, `${id}${ext}`);
  try {
    await fs.unlink(storagePath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File already deleted, continue
  }

  // Remove from index
  const filtered = entries.filter(e => e.id !== id);

  if (filtered.length === entries.length) {
    return false; // Entry not found in index
  }

  await writeAllEntries(filtered);

  return true;
}
