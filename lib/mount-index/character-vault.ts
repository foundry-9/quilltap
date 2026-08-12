/**
 * Character Vault Provisioning
 *
 * Shared helper for creating a database-backed character document store
 * ("vault") for a character and linking it to the character record.
 *
 * Used by both the startup backfill and the character-create API handlers
 * so that every character ends up with a vault whose id is persisted in
 * `characters.characterDocumentMountPointId`.
 *
 * `ensureCharacterVault()` is idempotent: a character that already carries
 * `characterDocumentMountPointId` is returned unchanged.
 *
 * @module mount-index/character-vault
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import { nextUniqueMountPointName } from '@/lib/mount-index/unique-mount-point-name';
import { serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { writeCharacterVaultManagedFields } from '@/lib/database/repositories/character-properties-overlay';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/character.types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

export const CHARACTER_WARDROBE_FOLDER = 'Wardrobe';

const logger = createServiceLogger('MountIndex:CharacterVault');

export interface EnsureCharacterVaultResult {
  mountPointId: string;
  /** True if this call created the vault; false if the character already had one (or we adopted an existing one). */
  created: boolean;
  /** True if we adopted a pre-existing populated same-name vault rather than creating one. */
  adopted?: boolean;
}

/**
 * Files `writeCharacterVaultManagedFields` writes unconditionally (empty string
 * when the field is blank), so a successfully-populated vault always has all of
 * them. Used to decide whether an existing same-name vault is safe to adopt.
 * Mirrors `REQUIRED_VAULT_SINGLE_FILES` in the cutover migration; the physical-*
 * pair is intentionally absent (the writer skips it when there is no physical
 * description, so requiring it would wrongly reject sparse characters).
 */
const REQUIRED_VAULT_FILES = [
  'properties.json',
  'identity.md',
  'description.md',
  'manifesto.md',
  'personality.md',
  'example-dialogues.md',
] as const;

/** True if the given mount point holds every file a populated vault must have. */
async function vaultHasRequiredFiles(mountPointId: string): Promise<boolean> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const present = new Set(links.map((l) => l.relativePath.toLowerCase()));
  return REQUIRED_VAULT_FILES.every((f) => present.has(f));
}

/**
 * Write `characterDocumentMountPointId` onto the character row and CONFIRM it
 * stuck by re-reading the raw row.
 *
 * The write goes through `repos.characters.update`, which can return without
 * persisting if the main DB is unwritable at that instant — most notably while
 * a cloud-synced DB file is still materializing (the partial-download window
 * that yields "file is not a database"). When that happened during the 4.6
 * character cutover, the vault content (a separate mount-index DB) landed fine
 * but the link write silently vanished, and the migration dropped the legacy
 * content columns anyway — leaving every character hollow. Verifying here turns
 * that silent "linked but not linked" state into a loud throw the caller can
 * block on instead of destroying columns out from under good vault content.
 */
async function linkCharacterToVault(characterId: string, mountPointId: string): Promise<void> {
  const repos = getRepositories();
  await repos.characters.update(characterId, { characterDocumentMountPointId: mountPointId });
  const reread = await repos.characters.findByIdRaw(characterId);
  if (!reread || reread.characterDocumentMountPointId !== mountPointId) {
    throw new Error(
      `Failed to persist characterDocumentMountPointId for ${characterId}: wrote ` +
        `${mountPointId} but re-read ${reread?.characterDocumentMountPointId ?? 'null'}. ` +
        `The character row write did not stick (database mid-materialization?).`,
    );
  }
}

/**
 * Ensure the given character has a linked database-backed character vault.
 * Creates, scaffolds, populates, and links if missing. Idempotent.
 *
 * If the character has no link but a populated same-name vault already exists
 * (e.g. a prior run created and populated the vault but its link write was lost
 * mid cloud-materialization), that vault is ADOPTED rather than duplicated —
 * critical post-cutover, where the legacy content columns are gone, so creating
 * a fresh vault here would populate it with empty files and orphan the good one.
 */
export async function ensureCharacterVault(
  character: Character,
): Promise<EnsureCharacterVaultResult> {
  if (character.characterDocumentMountPointId) {
    return { mountPointId: character.characterDocumentMountPointId, created: false };
  }

  const repos = getRepositories();
  const vaultName = `${character.name} Character Vault`;

  // Adopt an existing populated same-name character vault before creating one.
  const sameName = (await repos.docMountPoints.findByName(vaultName)).filter(
    (mp) => mp.storeType === 'character',
  );
  const populated: string[] = [];
  for (const mp of sameName) {
    if (await vaultHasRequiredFiles(mp.id)) populated.push(mp.id);
  }
  if (populated.length === 1) {
    await linkCharacterToVault(character.id, populated[0]);
    logger.warn('Adopted an existing populated character vault for an unlinked character', {
      characterId: character.id,
      mountPointId: populated[0],
      name: vaultName,
    });
    return { mountPointId: populated[0], created: false, adopted: true };
  }
  if (populated.length > 1) {
    // Ambiguous — don't guess which one holds the real content. Fall through to
    // create a fresh vault and leave the existing ones for an operator to
    // reconcile, but log loudly so the duplication surfaces.
    logger.error('Multiple populated same-name character vaults; cannot auto-adopt, creating fresh', {
      characterId: character.id,
      name: vaultName,
      candidateMountPointIds: populated,
    });
  }

  // Vault names live in the one case-insensitive store-name namespace, and
  // characters may share a name — suffix ` (N)` rather than mint a duplicate.
  // Adoption above still keys off the un-suffixed base name, so orphaned
  // vaults from earlier releases stay adoptable.
  const allStoreNames = new Set((await repos.docMountPoints.findAll()).map(mp => mp.name));
  const finalVaultName = nextUniqueMountPointName(allStoreNames, vaultName);

  const mountPoint = await repos.docMountPoints.create({
    name: finalVaultName,
    basePath: '',
    mountType: 'database',
    storeType: 'character',
    includePatterns: ['*.md', '*.txt', '*.pdf', '*.docx'],
    excludePatterns: ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: true,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  await scaffoldCharacterMount(mountPoint.id);

  // Project the character's content fields into the new vault. Wardrobe is not
  // projected here — it lives solely in the vault and is written through the
  // wardrobe-writes path; a brand-new vault has no wardrobe yet.
  await writeCharacterVaultManagedFields(mountPoint.id, { character });

  await linkCharacterToVault(character.id, mountPoint.id);

  logger.info('Character vault created, populated, and linked', {
    characterId: character.id,
    mountPointId: mountPoint.id,
    name: finalVaultName,
  });

  return { mountPointId: mountPoint.id, created: true };
}

export function renderPhysicalPromptsJson(primary: PhysicalDescription | null | undefined): string {
  return JSON.stringify(
    {
      headAndShoulders: primary?.headAndShouldersPrompt ?? null,
      short: primary?.shortPrompt ?? null,
      medium: primary?.mediumPrompt ?? null,
      long: primary?.longPrompt ?? null,
      complete: primary?.completePrompt ?? null,
    },
    null,
    2,
  );
}

export function buildSystemPromptFile(p: CharacterSystemPrompt): string {
  const frontmatter = p.isDefault
    ? `---\nname: ${escapeYaml(p.name)}\nisDefault: true\n---\n\n`
    : `---\nname: ${escapeYaml(p.name)}\n---\n\n`;
  return `${frontmatter}${p.content}`;
}

export function buildScenarioFile(s: CharacterScenario): string {
  return `# ${s.title}\n\n${s.content}`;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 100) || 'untitled';
}

function escapeYaml(value: string): string {
  if (/[:#"'\n]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Kebab-case slug derived from a wardrobe item's title. Used as the in-vault
 * identity for component references — `componentItems: [pearl-earrings, …]`
 * is friendlier to read and edit than a UUID. Two items whose titles slugify
 * to the same string will collide; the read overlay handles that by warning
 * and only registering the first, and the writer falls back to UUID for the
 * losers.
 */
export function slugifyWardrobeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Build a `{ itemId → slug }` map from a list of wardrobe items, taking the
 * first item that slugifies to each slug (skipping later collisions). Mirrors
 * the read-time slug map and lets `buildWardrobeItemFile` translate
 * `componentItemIds` UUIDs to slugs without a separate pass.
 */
export function buildSlugByItemIdMap(
  items: readonly WardrobeItem[],
): Map<string, string> {
  const slugByItemId = new Map<string, string>();
  const claimedSlugs = new Set<string>();
  for (const item of items) {
    const slug = slugifyWardrobeTitle(item.title);
    if (slug.length === 0 || claimedSlugs.has(slug)) continue;
    claimedSlugs.add(slug);
    slugByItemId.set(item.id, slug);
  }
  return slugByItemId;
}

export function buildWardrobeItemFile(
  item: WardrobeItem,
  slugByItemId: ReadonlyMap<string, string>,
): string {
  const data: Record<string, unknown> = {
    id: item.id,
    title: item.title,
    types: item.types,
  };
  if (item.componentItemIds && item.componentItemIds.length > 0) {
    // Slug if we have one, UUID fallback for collisions or unknown items.
    data.componentItems = item.componentItemIds.map((id) => slugByItemId.get(id) ?? id);
  }
  if (item.appropriateness != null && item.appropriateness !== '') {
    data.appropriateness = item.appropriateness;
  }
  if (item.imagePrompt != null && item.imagePrompt !== '') {
    data.imagePrompt = item.imagePrompt;
  }
  if (item.isDefault) {
    data.default = true;
  }
  if (item.replace) {
    data.replace = true;
  }
  if (item.archivedAt) {
    data.archived = true;
    data.archivedAt = item.archivedAt;
  }
  if (item.migratedFromClothingRecordId) {
    data.migratedFromClothingRecordId = item.migratedFromClothingRecordId;
  }
  data.createdAt = item.createdAt;
  data.updatedAt = item.updatedAt;

  const body = item.description ?? '';
  return `${serializeFrontmatter(data)}\n${body}`;
}
