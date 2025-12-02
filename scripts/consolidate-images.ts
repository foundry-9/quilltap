#!/usr/bin/env tsx

/**
 * Image Consolidation Migration
 *
 * Consolidates legacy binary image entries into the centralized file system.
 * This script:
 * 1. Reads entries from the old binary index (data/binaries/index.jsonl)
 * 2. Checks if they exist in the new file index (public/data/files/files.jsonl)
 * 3. Creates new FileEntry records for missing entries, mapping old schemas to new
 * 4. Updates character/persona references if IDs changed
 * 5. Reports statistics on the consolidation
 *
 * Old structure:
 * - data/binaries/index.jsonl (BinaryIndexEntry format)
 *
 * New structure:
 * - public/data/files/files.jsonl (FileEntry format)
 *
 * Usage:
 *   npm run consolidate-images [--dry-run]
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type {
  BinaryIndexEntry,
  FileEntry,
  FileSource,
  FileCategory,
  Character,
  Persona,
} from '../lib/json-store/schemas/types';
import {
  BinaryIndexEntrySchema,
  FileEntrySchema,
  CharacterSchema,
  PersonaSchema,
} from '../lib/json-store/schemas/types';

const DRY_RUN = process.argv.includes('--dry-run');

const OLD_BINARY_INDEX = 'data/binaries/index.jsonl';
const NEW_FILE_INDEX = 'public/data/files/files.jsonl';
const CHARACTERS_DIR = 'data/characters';
const PERSONAS_DIR = 'data/personas';

interface ConsolidationStats {
  totalLegacyEntries: number;
  alreadyExist: number;
  created: number;
  duplicatesByHash: number;
  referenceUpdates: number;
  errors: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
}

const stats: ConsolidationStats = {
  totalLegacyEntries: 0,
  alreadyExist: 0,
  created: 0,
  duplicatesByHash: 0,
  referenceUpdates: 0,
  errors: 0,
  byCategory: {},
  bySource: {},
};

/**
 * Read old binary index entries
 */
async function readLegacyEntries(): Promise<BinaryIndexEntry[]> {
  try {
    const content = await fs.readFile(OLD_BINARY_INDEX, 'utf-8');
    const lines = content.trim().split('\n').filter((line) => line.length > 0);
    return lines.map((line) => BinaryIndexEntrySchema.parse(JSON.parse(line)));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('No old binary index file found. Nothing to consolidate.');
      return [];
    }
    throw error;
  }
}

/**
 * Read all existing file entries
 */
async function readExistingFileEntries(): Promise<Map<string, FileEntry>> {
  const entries = new Map<string, FileEntry>();

  try {
    const content = await fs.readFile(NEW_FILE_INDEX, 'utf-8');
    const lines = content.trim().split('\n').filter((line) => line.length > 0);

    for (const line of lines) {
      const entry = FileEntrySchema.parse(JSON.parse(line));
      entries.set(entry.id, entry);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File doesn't exist yet, that's ok
  }

  return entries;
}

/**
 * Create a map of SHA256 hashes to FileEntry IDs for deduplication
 */
function createHashMap(entries: Map<string, FileEntry>): Map<string, string> {
  const hashMap = new Map<string, string>();

  entries.forEach((entry) => {
    hashMap.set(entry.sha256, entry.id);
  });

  return hashMap;
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
 * Check if entry exists by ID
 */
function entryExistsById(
  id: string,
  existingEntries: Map<string, FileEntry>
): boolean {
  return existingEntries.has(id);
}

/**
 * Find existing entry by SHA256 hash
 */
function findEntryByHash(
  sha256: string,
  hashMap: Map<string, string>
): string | null {
  return hashMap.get(sha256) || null;
}

/**
 * Create a new FileEntry from legacy BinaryIndexEntry
 */
function createFileEntry(oldEntry: BinaryIndexEntry): FileEntry {
  return {
    id: oldEntry.id,
    userId: oldEntry.userId,
    sha256: oldEntry.sha256,
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
}

/**
 * Update character reference to use new file ID
 */
async function updateCharacterDefaultImageId(
  oldImageId: string,
  newImageId: string
): Promise<void> {
  try {
    const files = await fs.readdir(CHARACTERS_DIR);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = join(CHARACTERS_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const character = CharacterSchema.parse(JSON.parse(content));

      let updated = false;

      if (character.defaultImageId === oldImageId) {
        console.log(
          `[CHARACTER] Updating ${character.name} defaultImageId: ${oldImageId} -> ${newImageId}`
        );
        character.defaultImageId = newImageId;
        updated = true;
      }

      // Check avatar overrides
      if (character.avatarOverrides) {
        for (const override of character.avatarOverrides) {
          if (override.imageId === oldImageId) {
            console.log(
              `[CHARACTER] Updating ${character.name} avatar override for chat ${override.chatId}: ${oldImageId} -> ${newImageId}`
            );
            override.imageId = newImageId;
            updated = true;
          }
        }
      }

      if (updated && !DRY_RUN) {
        await fs.writeFile(filePath, JSON.stringify(character, null, 2) + '\n');
        stats.referenceUpdates++;
      } else if (updated && DRY_RUN) {
        stats.referenceUpdates++;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Error updating character references:`, error);
  }
}

/**
 * Update persona reference to use new file ID
 */
async function updatePersonaDefaultImageId(
  oldImageId: string,
  newImageId: string
): Promise<void> {
  try {
    const files = await fs.readdir(PERSONAS_DIR);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = join(PERSONAS_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const persona = PersonaSchema.parse(JSON.parse(content));

      let updated = false;

      if (persona.defaultImageId === oldImageId) {
        console.log(
          `[PERSONA] Updating ${persona.name} defaultImageId: ${oldImageId} -> ${newImageId}`
        );
        persona.defaultImageId = newImageId;
        updated = true;
      }

      if (updated && !DRY_RUN) {
        await fs.writeFile(filePath, JSON.stringify(persona, null, 2) + '\n');
        stats.referenceUpdates++;
      } else if (updated && DRY_RUN) {
        stats.referenceUpdates++;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Error updating persona references:`, error);
  }
}

/**
 * Consolidate a single legacy entry
 */
async function consolidateEntry(
  oldEntry: BinaryIndexEntry,
  existingEntries: Map<string, FileEntry>,
  hashMap: Map<string, string>
): Promise<void> {
  try {
    // Check if entry already exists by ID
    if (entryExistsById(oldEntry.id, existingEntries)) {
      console.log(
        `✓ Already exists (by ID): ${oldEntry.filename} (ID: ${oldEntry.id})`
      );
      stats.alreadyExist++;
      return;
    }

    // Check if entry exists by SHA256 hash
    const existingId = findEntryByHash(oldEntry.sha256, hashMap);
    if (existingId) {
      console.log(
        `⚠️  Duplicate by hash: ${oldEntry.filename} (ID: ${oldEntry.id}, existing: ${existingId})`
      );
      stats.duplicatesByHash++;

      // Update character/persona references to point to existing entry
      if (oldEntry.characterId) {
        await updateCharacterDefaultImageId(oldEntry.id, existingId);
      }

      return;
    }

    // Create new file entry
    const newEntry = createFileEntry(oldEntry);

    // Validate
    const validated = FileEntrySchema.parse(newEntry);

    if (!DRY_RUN) {
      // Append to new index
      await fs.appendFile(NEW_FILE_INDEX, JSON.stringify(validated) + '\n');
    }

    console.log(`✓ Created: ${oldEntry.filename} (ID: ${oldEntry.id})`);
    stats.created++;

    // Update category stats
    stats.byCategory[validated.category] =
      (stats.byCategory[validated.category] || 0) + 1;
    stats.bySource[validated.source] =
      (stats.bySource[validated.source] || 0) + 1;
  } catch (error) {
    console.error(`✗ Error consolidating ${oldEntry.filename}:`, error);
    stats.errors++;
  }
}

/**
 * Main consolidation function
 */
async function consolidate() {
  console.log('='.repeat(80));
  console.log('Image Consolidation Migration');
  console.log('='.repeat(80));
  console.log();

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No files will be modified\n');
  }

  // Read legacy entries
  console.log('Reading legacy binary index...');
  const legacyEntries = await readLegacyEntries();
  stats.totalLegacyEntries = legacyEntries.length;

  if (legacyEntries.length === 0) {
    console.log('No legacy entries to consolidate.');
    return;
  }

  console.log(`Found ${legacyEntries.length} legacy entries.\n`);

  // Read existing file entries
  console.log('Reading existing file entries...');
  const existingEntries = await readExistingFileEntries();
  console.log(`Found ${existingEntries.size} existing file entries.\n`);

  // Create hash map for deduplication
  const hashMap = createHashMap(existingEntries);

  // Ensure new index file directory exists
  if (!DRY_RUN) {
    await fs.mkdir(dirname(NEW_FILE_INDEX), { recursive: true });
  }

  // Consolidate each entry
  console.log('Consolidating entries...\n');
  for (const oldEntry of legacyEntries) {
    await consolidateEntry(oldEntry, existingEntries, hashMap);
  }

  // Print summary
  console.log();
  console.log('='.repeat(80));
  console.log('Consolidation Summary');
  console.log('='.repeat(80));
  console.log(`Total legacy entries:    ${stats.totalLegacyEntries}`);
  console.log(`Already exist (by ID):   ${stats.alreadyExist}`);
  console.log(`Created:                 ${stats.created}`);
  console.log(`Duplicates (by hash):    ${stats.duplicatesByHash}`);
  console.log(`Reference updates:       ${stats.referenceUpdates}`);
  console.log(`Errors:                  ${stats.errors}`);
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
    console.log(
      '\n🔍 This was a DRY RUN. No files were actually consolidated.'
    );
    console.log('Run without --dry-run to perform the actual consolidation.');
  } else {
    console.log('\n✅ Consolidation complete!');
    console.log('\nNext steps:');
    console.log('1. Verify the consolidated entries in public/data/files/files.jsonl');
    console.log('2. Check that character/persona references were updated correctly');
    console.log('3. After testing, you can remove data/binaries/');
  }
}

// Run consolidation
consolidate().catch((error) => {
  console.error('Fatal error during consolidation:', error);
  process.exit(1);
});
