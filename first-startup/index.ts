/**
 * First-Startup Seed Data Loader
 *
 * Loads and exports seed data for initial application setup.
 * This module provides type-safe access to seed characters and
 * embedding profiles that are created when the application starts
 * with an empty database.
 *
 * @module first-startup
 */

import fs from 'fs';
import path from 'path';
import { CharacterInput, EmbeddingProfile } from '@/lib/schemas/types';
import type { QuilltapExport } from '@/lib/export/types';
import { logger } from '@/lib/logger';

/**
 * Seed character data structure (without system-generated fields)
 * This matches the CharacterInput type but excludes id, userId, createdAt, updatedAt
 */
export interface SeedCharacterData {
  name: string;
  title?: string | null;
  description?: string | null;
  personality?: string | null;
  systemPrompts?: Array<{
    name: string;
    content: string;
    isDefault?: boolean;
  }>;
  controlledBy?: 'llm' | 'user';
  talkativeness?: number;
  npc?: boolean;
  isFavorite?: boolean;
}

/**
 * Generate a UUID v4
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get current ISO-8601 timestamp
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Load all seed character JSON files from the characters directory.
 * Characters are loaded in alphabetical order by filename.
 *
 * @returns Array of seed character data loaded from JSON files
 */
export function getSeedCharacters(): SeedCharacterData[] {
  const context = 'first-startup';
  const charactersDir = path.join(process.cwd(), 'first-startup', 'characters');

  try {
    const files = fs.readdirSync(charactersDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    if (files.length === 0) {
      logger.warn('No seed character JSON files found', { context, charactersDir });
      return [];
    }

    const characters: SeedCharacterData[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(charactersDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as SeedCharacterData;
        characters.push(data);
      } catch (fileError) {
        logger.error('Failed to load seed character file', {
          context,
          file,
          error: fileError instanceof Error ? fileError.message : String(fileError),
        });
        // Continue loading other files
      }
    }

    return characters;
  } catch (error) {
    logger.error('Failed to read seed characters directory', {
      context,
      charactersDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Prepare seed character data for insertion into the database
 * Converts seed data to the format expected by the repository
 *
 * @param seedData The seed character data
 * @param userId The user ID to assign to the character
 * @returns Character data ready for repository.create()
 */
export function prepareSeedCharacter(
  seedData: SeedCharacterData,
  userId: string
): Omit<CharacterInput, 'id' | 'createdAt' | 'updatedAt'> {
  const now = getCurrentTimestamp();

  return {
    userId,
    name: seedData.name,
    title: seedData.title ?? null,
    description: seedData.description ?? null,
    personality: seedData.personality ?? null,
    systemPrompts: (seedData.systemPrompts ?? []).map(prompt => ({
      id: generateId(),
      name: prompt.name,
      content: prompt.content,
      isDefault: prompt.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    })),
    controlledBy: seedData.controlledBy ?? 'llm',
    talkativeness: seedData.talkativeness ?? 0.5,
    npc: seedData.npc ?? false,
    isFavorite: seedData.isFavorite ?? false,
  };
}

// ============================================================================
// SEED IMPORTS (.qtap files)
// ============================================================================

/**
 * Load all .qtap seed import files from the imports directory.
 * Files are loaded in alphabetical order by filename.
 *
 * @returns Array of parsed QuilltapExport objects ready for executeImport()
 */
export function getSeedImports(): { filename: string; data: QuilltapExport }[] {
  const context = 'first-startup';
  const importsDir = path.join(process.cwd(), 'first-startup', 'imports');

  try {
    if (!fs.existsSync(importsDir)) {
      return [];
    }

    const files = fs.readdirSync(importsDir)
      .filter(f => f.endsWith('.qtap'))
      .sort();

    if (files.length === 0) {
      return [];
    }

    const imports: { filename: string; data: QuilltapExport }[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(importsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as QuilltapExport;
        imports.push({ filename: file, data });
      } catch (fileError) {
        logger.error('Failed to load seed import file', {
          context,
          file,
          error: fileError instanceof Error ? fileError.message : String(fileError),
        });
        // Continue loading other files
      }
    }

    return imports;
  } catch (error) {
    logger.error('Failed to read seed imports directory', {
      context,
      importsDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ============================================================================
// SEED AVATARS (image files for seed characters)
// ============================================================================

/**
 * Seed avatar data: maps character name to image file content
 */
export interface SeedAvatarData {
  characterName: string;
  filename: string;
  content: Buffer;
  mimeType: string;
}

/**
 * Load avatar image files from the avatars directory.
 * Files are expected to be named after the character (e.g., Lorian.webp).
 *
 * @returns Array of seed avatar data with file contents
 */
export function getSeedAvatars(): SeedAvatarData[] {
  const context = 'first-startup';
  const avatarsDir = path.join(process.cwd(), 'first-startup', 'avatars');

  try {
    if (!fs.existsSync(avatarsDir)) {
      return [];
    }

    const imageExtensions = ['.webp', '.png', '.jpg', '.jpeg'];
    const files = fs.readdirSync(avatarsDir)
      .filter(f => imageExtensions.some(ext => f.toLowerCase().endsWith(ext)))
      .sort();

    if (files.length === 0) {
      return [];
    }

    const mimeMap: Record<string, string> = {
      '.webp': 'image/webp',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };

    const avatars: SeedAvatarData[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(avatarsDir, file);
        const ext = path.extname(file).toLowerCase();
        const characterName = path.basename(file, ext);
        const content = fs.readFileSync(filePath);
        const mimeType = mimeMap[ext] || 'image/webp';

        avatars.push({ characterName, filename: file, content, mimeType });
      } catch (fileError) {
        logger.error('Failed to load seed avatar file', {
          context,
          file,
          error: fileError instanceof Error ? fileError.message : String(fileError),
        });
      }
    }


    return avatars;
  } catch (error) {
    logger.error('Failed to read seed avatars directory', {
      context,
      avatarsDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ============================================================================
// EMBEDDING PROFILES
// ============================================================================

/**
 * Seed embedding profile data structure
 */
export interface SeedEmbeddingProfileData {
  name: string;
  provider: 'OPENAI' | 'OLLAMA' | 'OPENROUTER' | 'NANOGPT' | 'BUILTIN';
  modelName: string;
  dimensions?: number | null;
  isDefault: boolean;
}

/**
 * Default TF-IDF embedding profile for first startup
 * This provides zero-config semantic search without requiring API keys
 */
const defaultEmbeddingProfile: SeedEmbeddingProfileData = {
  name: 'Built-in TF-IDF',
  provider: 'BUILTIN',
  modelName: 'tfidf-bm25-v1',
  dimensions: null, // Determined dynamically based on vocabulary
  isDefault: true,
};

/**
 * Get all seed embedding profiles to be created on first startup
 * @returns Array of seed embedding profile data
 */
export function getSeedEmbeddingProfiles(): SeedEmbeddingProfileData[] {
  return [defaultEmbeddingProfile];
}

/**
 * Prepare seed embedding profile data for insertion into the database
 *
 * @param seedData The seed embedding profile data
 * @param userId The user ID to assign to the profile
 * @returns Embedding profile data ready for repository.create()
 */
export function prepareSeedEmbeddingProfile(
  seedData: SeedEmbeddingProfileData,
  userId: string
): Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    userId,
    name: seedData.name,
    provider: seedData.provider,
    apiKeyId: null,
    baseUrl: null,
    modelName: seedData.modelName,
    dimensions: seedData.dimensions ?? null,
    truncateToDimensions: null,
    normalizeL2: true,
    isDefault: seedData.isDefault,
    tags: [],
  };
}
