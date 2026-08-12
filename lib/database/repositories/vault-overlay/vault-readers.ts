/**
 * Standalone vault-file readers — one per managed field — plus the low-level
 * `readVaultTextFile` they share. These are used by the sync-back action and
 * the consolidated `readCharacterVaultManagedFields` reader; the batched read
 * overlay has its own inlined fetch path for performance.
 *
 * @module database/repositories/vault-overlay/vault-readers
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  readDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import { slugifyWardrobeTitle } from '@/lib/mount-index/character-vault';

import {
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_WARDROBE_JSON_PATH,
  CHARACTER_WARDROBE_FOLDER,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
  CharacterVaultPropertiesSchema,
  CharacterVaultUnavailableError,
  type CharacterVaultProperties,
  type CharacterVaultMetadata,
  type CharacterVaultPhysicalPrompts,
  type CharacterVaultWardrobe,
} from './schema';
import {
  parseVaultProperties,
  parseVaultMetadata,
  parseVaultPhysicalPrompts,
  parseLegacyWardrobeJson,
  parsePromptFile,
  parseScenarioFile,
  parseWardrobeItemFile,
  resolveAndCheckComponentItems,
} from './parsers';

export async function readVaultTextFile(
  mountPointId: string,
  path: string,
  characterId?: string,
): Promise<string | null> {
  try {
    const doc = await readDatabaseDocument(mountPointId, path);
    return doc.content;
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      return null;
    }
    logger.warn('Failed to read vault file', {
      mountPointId,
      path,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Read a character's vault properties.json and return a validated snapshot,
 * or null if the file is missing/malformed/invalid. Used by the sync-back
 * action to copy vault values into the DB.
 */
export async function readCharacterVaultProperties(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultProperties | null> {
  const content = await readVaultTextFile(mountPointId, CHARACTER_PROPERTIES_JSON_PATH, characterId);
  if (content === null) return null;
  return parseVaultProperties(content, characterId ?? mountPointId);
}

/**
 * Read `properties.json` for the WRITE path, distinguishing a genuinely absent
 * file from a present-but-corrupt one.
 *
 * Returns `null` **only** when the file is genuinely absent (the read overlay's
 * keystone `NOT_FOUND`); the caller then seeds fresh defaults, which is correct
 * for a vault that has none yet. Every other failure — an unreadable store, a
 * transient error, malformed JSON, a body the schema rejects — **throws**
 * {@link CharacterVaultUnavailableError}.
 *
 * That distinction is load-bearing. The six fields this file owns (`pronouns`,
 * `aliases`, `title`, `firstMessage`, `talkativeness`, `canChooseOutfit`) live
 * ONLY here post-4.6 — the DB row carries none of them. The fail-soft
 * {@link readCharacterVaultProperties} collapses "absent" and "corrupt" into
 * `null`; a read-modify-write seed that treated a *corrupt* file as absent
 * would seed empty defaults and permanently clobber all six. So the write path
 * must refuse rather than seed. Mirrors `readProperties` in the project/group
 * document-store overlay (commit `dcd9440a`), which fixed the identical shape.
 */
export async function readCharacterVaultPropertiesForWrite(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultProperties | null> {
  const charId = characterId ?? mountPointId;

  let content: string;
  try {
    ({ content } = await readDatabaseDocument(mountPointId, CHARACTER_PROPERTIES_JSON_PATH));
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      // Genuinely absent — the caller may seed fresh defaults.
      return null;
    }
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('Vault properties.json unreadable — refusing to seed defaults over it', {
      mountPointId,
      characterId: charId,
      error: detail,
    });
    throw new CharacterVaultUnavailableError(
      charId,
      mountPointId,
      `${CHARACTER_PROPERTIES_JSON_PATH} unparseable: ${detail}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('Vault properties.json unparseable — refusing to seed defaults over it', {
      mountPointId,
      characterId: charId,
      error: detail,
    });
    throw new CharacterVaultUnavailableError(
      charId,
      mountPointId,
      `${CHARACTER_PROPERTIES_JSON_PATH} unparseable: ${detail}`,
    );
  }

  const parsed = CharacterVaultPropertiesSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    logger.error('Vault properties.json failed schema validation — refusing to seed defaults over it', {
      mountPointId,
      characterId: charId,
      issues,
    });
    throw new CharacterVaultUnavailableError(
      charId,
      mountPointId,
      `${CHARACTER_PROPERTIES_JSON_PATH} unparseable: schema validation failed (${issues})`,
    );
  }

  return parsed.data;
}

/**
 * Read a character's vault metadata.json — the freeform fact sheet — or null
 * when the file is missing or isn't a JSON object. Callers substitute `{}`:
 * "no metadata" and "an empty sheet" mean the same thing to every reader.
 */
export async function readCharacterVaultMetadata(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultMetadata | null> {
  const content = await readVaultTextFile(mountPointId, CHARACTER_METADATA_JSON_PATH, characterId);
  if (content === null) return null;
  return parseVaultMetadata(content, characterId ?? mountPointId, mountPointId);
}

/**
 * Read the raw markdown content of identity.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultIdentity(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_IDENTITY_MD_PATH, characterId);
}

/**
 * Read the raw markdown content of description.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultDescription(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_DESCRIPTION_MD_PATH, characterId);
}

/**
 * Read the raw markdown content of manifesto.md. Returns null if missing or
 * if the read fails; returns the empty string if the file exists but is empty.
 */
export async function readCharacterVaultManifesto(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_MANIFESTO_MD_PATH, characterId);
}

export async function readCharacterVaultPersonality(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_PERSONALITY_MD_PATH, characterId);
}

export async function readCharacterVaultExampleDialogues(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, characterId);
}

export async function readCharacterVaultPhysicalDescription(
  mountPointId: string,
  characterId?: string,
): Promise<string | null> {
  return readVaultTextFile(mountPointId, CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH, characterId);
}

export async function readCharacterVaultPhysicalPrompts(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultPhysicalPrompts | null> {
  const content = await readVaultTextFile(
    mountPointId,
    CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
    characterId,
  );
  if (content === null) return null;
  return parseVaultPhysicalPrompts(content, characterId ?? mountPointId);
}

/**
 * Enumerate Prompts/*.md inside a vault and return the parsed prompt array.
 * Returns an empty array if the folder is missing or empty. Invalid files are
 * skipped with a warning. Used by the sync-back action.
 */
export async function readCharacterVaultSystemPrompts(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterSystemPrompt[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_PROMPTS_FOLDER,
    '.md',
  );
  const parsed = docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parsePromptFile(doc, characterId ?? mountPointId))
    .filter((p): p is CharacterSystemPrompt => p !== null);
  if (parsed.length === 0) return [];
  let seenDefault = false;
  const normalized: CharacterSystemPrompt[] = parsed.map((p) => {
    if (p.isDefault) {
      if (seenDefault) return { ...p, isDefault: false };
      seenDefault = true;
      return p;
    }
    return p;
  });
  if (!seenDefault) {
    normalized[0] = { ...normalized[0], isDefault: true };
  }
  return normalized;
}

/**
 * Enumerate Scenarios/*.md inside a vault and return the parsed scenario array.
 * Returns an empty array if the folder is missing or empty. Used by the
 * sync-back action.
 */
export async function readCharacterVaultScenarios(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterScenario[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_SCENARIOS_FOLDER,
    '.md',
  );
  return docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parseScenarioFile(doc, characterId ?? mountPointId))
    .filter((s): s is CharacterScenario => s !== null);
}

/**
 * Read a character's vault wardrobe and return a validated snapshot, or null
 * if neither the new folder layout nor the legacy `wardrobe.json` is usable.
 *
 * Read order:
 *   1. `Wardrobe/*.md` (current format). Composite items reference their
 *      components via the `componentItems:` slug array, resolved here against
 *      the in-vault slug map (slug-first, UUID fallback).
 *   2. legacy `wardrobe.json` (still honored so existing vaults don't lose
 *      hand-edits between this change shipping and the migration running).
 *
 * The retired `Outfits/` folder is intentionally not read — pre-rework
 * presets are handled by a separate database-side migration that folds them
 * into composite wardrobe items, so re-parsing them here would double-write.
 * Stale `Outfits/*.md` files left on disk are tolerated; cleanup happens via
 * the migration.
 *
 * Cycle and unknown-ref handling: cycles in the declared component graph
 * wipe the offending item's `componentItemIds` (logged) but leave the item
 * itself intact so vault hand-edits aren't silently destructive. Unknown
 * refs (slug or UUID that doesn't match anything in this vault) are dropped
 * from that item's component list with a warning.
 */
export async function readCharacterVaultWardrobe(
  mountPointId: string,
  characterId?: string,
  options?: { seedArchetypes?: boolean },
): Promise<CharacterVaultWardrobe | null> {
  const repos = getRepositories();
  const charId = characterId ?? mountPointId;
  // The Quilltap General Wardrobe/ folder IS the archetype set, so reading it
  // must NOT seed archetypes — that would recurse back through findArchetypes.
  const seedArchetypes = options?.seedArchetypes ?? true;

  const itemDocs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_WARDROBE_FOLDER,
    '.md',
  );

  if (itemDocs.length > 0) {
    const items = itemDocs
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((doc) => parseWardrobeItemFile(doc, charId))
      .filter((item): item is WardrobeItem => item !== null);

    const itemById = new Map<string, WardrobeItem>();
    const itemBySlug = new Map<string, WardrobeItem>();
    const claimedSlugs = new Set<string>();
    for (const item of items) {
      itemById.set(item.id, item);
      const slug = slugifyWardrobeTitle(item.title);
      if (slug.length === 0 || claimedSlugs.has(slug)) {
        if (slug.length > 0) {
          logger.warn('Wardrobe items share a slug; later item only addressable by UUID', {
            characterId: charId,
            mountPointId,
            slug,
            itemId: item.id,
            title: item.title,
          });
        }
        continue;
      }
      claimedSlugs.add(slug);
      itemBySlug.set(slug, item);
    }

    // Seed shared archetypes into the lookup maps so bundles in this vault can
    // reference them. Without this, refs to shared items (Fitbit, Apple Watch,
    // etc.) get stripped on every read of any outfit that bundles them, since
    // archetypes don't live in the character's vault folder. Personal items
    // win slug collisions; archetypes are pure fallback.
    const hasComponentRefs = items.some((item) => item.componentItemIds.length > 0);
    if (hasComponentRefs && seedArchetypes) {
      const archetypes = await repos.wardrobe.findArchetypes(true);
      for (const arche of archetypes) {
        if (!itemById.has(arche.id)) {
          itemById.set(arche.id, arche);
        }
        const slug = slugifyWardrobeTitle(arche.title);
        if (slug.length > 0 && !claimedSlugs.has(slug)) {
          claimedSlugs.add(slug);
          itemBySlug.set(slug, arche);
        }
      }
    }

    resolveAndCheckComponentItems(items, itemBySlug, itemById, charId, mountPointId);

    return { items };
  }

  // Folder empty (or missing) — fall through to legacy wardrobe.json so
  // pre-migration vaults still surface their items.
  const legacyContent = await readVaultTextFile(
    mountPointId,
    CHARACTER_WARDROBE_JSON_PATH,
    characterId,
  );
  if (legacyContent === null) return null;
  return parseLegacyWardrobeJson(legacyContent, charId);
}
