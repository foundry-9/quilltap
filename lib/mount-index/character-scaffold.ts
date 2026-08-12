/**
 * Character Mount Scaffold
 *
 * Populates a freshly created (or freshly flipped) database-backed character
 * document store with the conventional preset structure: blank Markdown files,
 * seeded JSON files, and empty top-level folders. Idempotent —
 * pre-existing entries are left untouched, so it can be safely re-run when a
 * store's storeType is flipped to 'character' on an already-populated store.
 *
 * Filesystem/obsidian character stores are left alone; the user is presumed
 * to be pointing at an existing character vault of their own.
 *
 * @module mount-index/character-scaffold
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeDatabaseDocument } from './database-store';
import { ensureFolderPath } from './folder-paths';

const logger = createServiceLogger('MountIndex:CharacterScaffold');

const BLANK_MARKDOWN_FILES = [
  'identity.md',
  'description.md',
  'manifesto.md',
  'personality.md',
  'physical-description.md',
  'example-dialogues.md',
] as const;

const TOP_LEVEL_FOLDERS = [
  'Prompts',
  'Scenarios',
  'Wardrobe',
  'Outfits',
  'lore',
  'images',
  'files',
] as const;

const PROPERTIES_JSON = {
  pronouns: null,
  aliases: [],
  title: '',
  firstMessage: '',
  talkativeness: 0.5,
  canChooseOutfit: false,
};

/**
 * The freeform fact sheet starts empty — the keys are the user's to invent.
 *
 * Seeded rather than left absent purely for discoverability: hydration treats
 * an absent file and `{}` identically, but the file manager is the only place
 * a fact sheet can be edited, and you cannot edit a file that isn't there.
 */
const METADATA_JSON = {};

const METADATA_JSON_PATH = 'metadata.json';

/** The content of a fresh, empty fact sheet. One definition, three callers. */
export const METADATA_JSON_SEED = JSON.stringify(METADATA_JSON, null, 2);

const PHYSICAL_PROMPTS_JSON = {
  short: null,
  medium: null,
  long: null,
  complete: null,
};

export interface CharacterScaffoldResult {
  filesCreated: number;
  filesSkipped: number;
  foldersCreated: number;
}

/**
 * Ensure one vault carries a `metadata.json`, seeding an empty sheet if not.
 *
 * Split out of the full scaffold so the startup backfill can reach for just
 * this: every vault provisioned before the fact sheet existed lacks the file,
 * and since the file manager is the only editing surface, those characters have
 * nothing to open. Re-running the whole scaffold to fix that would cost seven
 * folder checks and nine document checks per character on every boot.
 *
 * Returns true when it created the file. Existence is checked directly rather
 * than by parsing: a sheet the user has fat-fingered into invalid JSON is still
 * their sheet, and must not be "healed" into an empty one.
 */
export async function ensureCharacterMetadataFile(mountPointId: string): Promise<boolean> {
  const repos = getRepositories();
  const existing = await repos.docMountDocuments.findByMountPointAndPath(
    mountPointId,
    METADATA_JSON_PATH,
  );
  if (existing) return false;

  await writeDatabaseDocument(mountPointId, METADATA_JSON_PATH, METADATA_JSON_SEED);
  return true;
}

/**
 * Scaffold the preset structure for a database-backed character store.
 * No-op if the mount point is not database-backed or not classified as
 * a character store. Existing files are never overwritten.
 */
export async function scaffoldCharacterMount(
  mountPointId: string,
): Promise<CharacterScaffoldResult> {
  const repos = getRepositories();
  const mountPoint = await repos.docMountPoints.findById(mountPointId);

  const result: CharacterScaffoldResult = {
    filesCreated: 0,
    filesSkipped: 0,
    foldersCreated: 0,
  };

  if (!mountPoint) {
    logger.warn('Cannot scaffold — mount point not found', { mountPointId });
    return result;
  }
  if (mountPoint.mountType !== 'database' || mountPoint.storeType !== 'character') {
    return result;
  }

  for (const folder of TOP_LEVEL_FOLDERS) {
    const existing = await repos.docMountFolders.findByMountPointAndPath(mountPointId, folder);
    await ensureFolderPath(mountPointId, folder);
    if (!existing) {
      result.foldersCreated++;
    }
  }

  const fileSpecs: Array<{ path: string; content: string }> = [
    ...BLANK_MARKDOWN_FILES.map(path => ({ path, content: '' })),
    { path: 'properties.json', content: JSON.stringify(PROPERTIES_JSON, null, 2) },
    { path: METADATA_JSON_PATH, content: METADATA_JSON_SEED },
    { path: 'physical-prompts.json', content: JSON.stringify(PHYSICAL_PROMPTS_JSON, null, 2) },
  ];

  for (const { path: relPath, content } of fileSpecs) {
    const existing = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, relPath);
    if (existing) {
      result.filesSkipped++;
      continue;
    }
    await writeDatabaseDocument(mountPointId, relPath, content);
    result.filesCreated++;
  }

  logger.info('Character scaffold complete', {
    mountPointId,
    name: mountPoint.name,
    filesCreated: result.filesCreated,
    filesSkipped: result.filesSkipped,
    foldersCreated: result.foldersCreated,
  });

  return result;
}
