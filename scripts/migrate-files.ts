#!/usr/bin/env tsx

/**
 * File Migration Utility
 *
 * Migrates all files from the old structure to the new centralized file system.
 *
 * Old structure:
 * - public/uploads/images/{userId}/{filename}
 * - public/uploads/generated/{userId}/{filename}
 * - public/uploads/chat-files/{chatId}/{filename}
 * - data/binaries/index.jsonl
 *
 * New structure:
 * - data/files/storage/{uuid}.{ext}
 * - data/files/files.jsonl
 *
 * Usage:
 *   npm run migrate-files [--dry-run]
 */

import { promises as fs } from 'fs';
import { join, dirname, extname } from 'path';
import { createHash } from 'crypto';
import type { BinaryIndexEntry, FileEntry, FileSource, FileCategory } from '../lib/json-store/schemas/types';
import { BinaryIndexEntrySchema, FileEntrySchema } from '../lib/json-store/schemas/types';

const DRY_RUN = process.argv.includes('--dry-run');

const OLD_INDEX_FILE = 'data/binaries/index.jsonl';
const NEW_INDEX_FILE = 'public/data/files/files.jsonl';
const NEW_STORAGE_DIR = 'public/data/files/storage';

interface MigrationStats {
  totalFiles: number;
  migratedFiles: number;
  skippedFiles: number;
  errors: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
}

const stats: MigrationStats = {
  totalFiles: 0,
  migratedFiles: 0,
  skippedFiles: 0,
  errors: 0,
  byCategory: {},
  bySource: {},
};

/**
 * Read old binary index entries
 */
async function readOldEntries(): Promise<BinaryIndexEntry[]> {
  try {
    const content = await fs.readFile(OLD_INDEX_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    return lines.map(line => BinaryIndexEntrySchema.parse(JSON.parse(line)));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('No old index file found. Nothing to migrate.');
      return [];
    }
    throw error;
  }
}

/**
 * Map old type to new category
 */
function mapTypeToCategory(type: string): FileCategory {
  switch (type) {
    case 'image':
      return 'IMAGE';
    case 'chat_file':
      return 'ATTACHMENT';
    case 'avatar':
      return 'AVATAR';
    default:
      return 'ATTACHMENT';
  }
}

/**
 * Map old source to new source
 */
function mapSource(source: string): FileSource {
  switch (source) {
    case 'upload':
      return 'UPLOADED';
    case 'import':
      return 'IMPORTED';
    case 'generated':
      return 'GENERATED';
    default:
      return 'UPLOADED';
  }
}

/**
 * Build linkedTo array from old entry
 */
function buildLinkedTo(oldEntry: BinaryIndexEntry): string[] {
  const linkedTo: string[] = [];

  if (oldEntry.messageId) {
    linkedTo.push(oldEntry.messageId);
  }
  if (oldEntry.chatId) {
    linkedTo.push(oldEntry.chatId);
  }
  if (oldEntry.characterId) {
    linkedTo.push(oldEntry.characterId);
  }

  return linkedTo;
}

/**
 * Calculate SHA256 hash of file buffer
 */
function calculateHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Migrate a single file
 */
async function migrateFile(oldEntry: BinaryIndexEntry): Promise<FileEntry | null> {
  try {
    // Construct old file path
    const oldPath = join(process.cwd(), 'public', oldEntry.relativePath);

    // Check if file exists
    try {
      await fs.access(oldPath);
    } catch {
      console.warn(`⚠️  File not found: ${oldPath}`);
      stats.skippedFiles++;
      return null;
    }

    // Read the file
    const buffer = await fs.readFile(oldPath);

    // Verify hash matches (if we have it)
    const actualHash = calculateHash(buffer);
    if (oldEntry.sha256 && actualHash !== oldEntry.sha256) {
      console.warn(`⚠️  Hash mismatch for ${oldEntry.filename}: expected ${oldEntry.sha256}, got ${actualHash}`);
    }

    // Create new file entry
    const ext = extname(oldEntry.filename);
    const newFilename = `${oldEntry.id}${ext}`;
    const newPath = join(process.cwd(), NEW_STORAGE_DIR, newFilename);

    const newEntry: FileEntry = {
      userId: oldEntry.userId,
      id: oldEntry.id,
      sha256: actualHash,
      originalFilename: oldEntry.filename,
      mimeType: oldEntry.mimeType,
      size: oldEntry.size,
      width: oldEntry.width || null,
      height: oldEntry.height || null,
      linkedTo: buildLinkedTo(oldEntry),
      source: mapSource(oldEntry.source),
      category: mapTypeToCategory(oldEntry.type),
      generationPrompt: oldEntry.generationPrompt || null,
      generationModel: oldEntry.generationModel || null,
      generationRevisedPrompt: null,
      description: null,
      tags: oldEntry.tags,
      createdAt: oldEntry.createdAt,
      updatedAt: oldEntry.updatedAt,
    };

    // Validate
    const validated = FileEntrySchema.parse(newEntry);

    if (!DRY_RUN) {
      // Ensure new storage directory exists
      await fs.mkdir(dirname(newPath), { recursive: true });

      // Copy file to new location
      await fs.copyFile(oldPath, newPath);

      // Append to new index
      await fs.appendFile(NEW_INDEX_FILE, JSON.stringify(validated) + '\n', 'utf-8');
    }

    console.log(`✓ Migrated: ${oldEntry.filename} -> ${newFilename}`);
    stats.migratedFiles++;

    // Update category stats
    stats.byCategory[validated.category] = (stats.byCategory[validated.category] || 0) + 1;
    stats.bySource[validated.source] = (stats.bySource[validated.source] || 0) + 1;

    return validated;
  } catch (error) {
    console.error(`✗ Error migrating ${oldEntry.filename}:`, error);
    stats.errors++;
    return null;
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(80));
  console.log('File Migration Utility');
  console.log('='.repeat(80));
  console.log();

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No files will be modified\n');
  }

  // Read old entries
  console.log('Reading old file index...');
  const oldEntries = await readOldEntries();
  stats.totalFiles = oldEntries.length;

  if (oldEntries.length === 0) {
    console.log('No files to migrate.');
    return;
  }

  console.log(`Found ${oldEntries.length} files to migrate.\n`);

  // Check if new index already exists
  if (!DRY_RUN) {
    try {
      await fs.access(NEW_INDEX_FILE);
      console.error(`❌ New index file already exists: ${NEW_INDEX_FILE}`);
      console.error('Migration has already been run. Please delete or backup the new index first.');
      process.exit(1);
    } catch {
      // File doesn't exist, we're good to proceed
    }

    // Ensure new storage directory exists
    await fs.mkdir(NEW_STORAGE_DIR, { recursive: true });
  }

  // Migrate each file
  console.log('Migrating files...\n');
  for (const oldEntry of oldEntries) {
    await migrateFile(oldEntry);
  }

  // Print summary
  console.log();
  console.log('='.repeat(80));
  console.log('Migration Summary');
  console.log('='.repeat(80));
  console.log(`Total files:     ${stats.totalFiles}`);
  console.log(`Migrated:        ${stats.migratedFiles}`);
  console.log(`Skipped:         ${stats.skippedFiles}`);
  console.log(`Errors:          ${stats.errors}`);
  console.log();
  console.log('By Category:');
  for (const [category, count] of Object.entries(stats.byCategory)) {
    console.log(`  ${category.padEnd(15)} ${count}`);
  }
  console.log();
  console.log('By Source:');
  for (const [source, count] of Object.entries(stats.bySource)) {
    console.log(`  ${source.padEnd(15)} ${count}`);
  }
  console.log('='.repeat(80));

  if (DRY_RUN) {
    console.log('\n🔍 This was a DRY RUN. No files were actually migrated.');
    console.log('Run without --dry-run to perform the actual migration.');
  } else {
    console.log('\n✅ Migration complete!');
    console.log('\nNext steps:');
    console.log('1. Verify the migrated files in data/files/storage/');
    console.log('2. Update your code to use the new file manager');
    console.log('3. After testing, you can remove public/uploads/ and data/binaries/');
  }
}

// Run migration
migrate().catch(error => {
  console.error('Fatal error during migration:', error);
  process.exit(1);
});
