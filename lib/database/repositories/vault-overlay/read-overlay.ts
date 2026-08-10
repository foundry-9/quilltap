/**
 * Read overlay: apply the vault file overlay to characters so every repository
 * read path sees vault values transparently. Has its own inlined fetch path
 * (one IN(...) query per vault path plus two directory listings) rather than
 * calling the per-field readers, for performance.
 *
 * Failure is asymmetric and store-only (no DB-column fallback — the cutover
 * dropped those columns):
 *   - {@link applyDocumentStoreOverlayOne} (single, behind `findById`) THROWS
 *     `CharacterVaultUnavailableError`. The caller asked for that one character.
 *   - {@link applyDocumentStoreOverlay} (batched, behind `findAll`/`findByIds`)
 *     logs at `error` and DROPS the offending character so one corrupt vault
 *     can't take down the whole roster. The startup backfill heals it.
 *
 * Mirrors the project/group store read overlays.
 *
 * @module database/repositories/vault-overlay/read-overlay
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  PhysicalDescription,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';

import {
  SINGLE_FILE_OVERLAY_PATHS,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
  CharacterVaultUnavailableError,
} from './schema';
import {
  hasLinkedVault,
  parseVaultProperties,
  parseVaultMetadata,
  parseVaultPhysicalPrompts,
  markdownToNullable,
  stableUuidFromString,
  parsePromptFile,
  parseScenarioFile,
} from './parsers';

/** The loaded vault files for a set of mount points, keyed for hydration. */
interface VaultFileMaps {
  /** path → (mountPointId → file content) for each single-file overlay path. */
  contentByMountByPath: Map<string, Map<string, string>>;
  /** mountPointId → Prompts/*.md docs */
  promptsByMount: Map<string, DocMountDocument[]>;
  /** mountPointId → Scenarios/*.md docs */
  scenariosByMount: Map<string, DocMountDocument[]>;
}

/**
 * Load every vault file the overlay needs for the given mount points. Does NOT
 * swallow read failures — a store-read exception propagates so the caller fails
 * loudly rather than silently returning hollow characters (there is no DB
 * fallback post-cutover).
 */
async function loadVaultFileMaps(mountPointIds: string[]): Promise<VaultFileMaps> {
  const repos = getRepositories();

  const contentByMountByPath = new Map<string, Map<string, string>>();
  for (const path of SINGLE_FILE_OVERLAY_PATHS) {
    contentByMountByPath.set(path, new Map<string, string>());
  }
  const promptsByMount = new Map<string, DocMountDocument[]>();
  const scenariosByMount = new Map<string, DocMountDocument[]>();

  const singleFileResults = await Promise.all(
    SINGLE_FILE_OVERLAY_PATHS.map((path) =>
      repos.docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path),
    ),
  );
  for (let i = 0; i < SINGLE_FILE_OVERLAY_PATHS.length; i++) {
    const path = SINGLE_FILE_OVERLAY_PATHS[i];
    const byMount = contentByMountByPath.get(path)!;
    for (const doc of singleFileResults[i]) {
      byMount.set(doc.mountPointId, doc.content);
    }
  }

  const [promptDocs, scenarioDocs] = await Promise.all([
    repos.docMountDocuments.findManyByMountPointsInFolder(
      mountPointIds,
      CHARACTER_PROMPTS_FOLDER,
      '.md',
    ),
    repos.docMountDocuments.findManyByMountPointsInFolder(
      mountPointIds,
      CHARACTER_SCENARIOS_FOLDER,
      '.md',
    ),
  ]);
  for (const doc of promptDocs) {
    let list = promptsByMount.get(doc.mountPointId);
    if (!list) {
      list = [];
      promptsByMount.set(doc.mountPointId, list);
    }
    list.push(doc);
  }
  for (const doc of scenarioDocs) {
    let list = scenariosByMount.get(doc.mountPointId);
    if (!list) {
      list = [];
      scenariosByMount.set(doc.mountPointId, list);
    }
    list.push(doc);
  }

  return { contentByMountByPath, promptsByMount, scenariosByMount };
}

/**
 * Hydrate one character from the loaded vault files.
 *
 * - A character not flagged for overlay (no linked vault) is returned unchanged.
 * - A character WITH a linked vault whose `properties.json` keystone is absent
 *   has a broken vault: throws {@link CharacterVaultUnavailableError}. The batched
 *   caller catches and drops; the single caller lets it propagate.
 */
function hydrateOne(character: Character, maps: VaultFileMaps): Character {
  // No archivedAt short-circuit here, deliberately (§4.2a): archiving prunes
  // the vault but keeps every managed-field document, so an archived character
  // hydrates exactly like a live one. Skipping would hand back a hollow row —
  // the very outcome the prune-in-place revision exists to avoid. A *broken*
  // archived vault is a real fault and surfaces as one, like any other.
  if (!hasLinkedVault(character)) {
    return character;
  }
  const mountId = character.characterDocumentMountPointId as string;

  const propsByMount = maps.contentByMountByPath.get(CHARACTER_PROPERTIES_JSON_PATH)!;
  const metadataByMount = maps.contentByMountByPath.get(CHARACTER_METADATA_JSON_PATH)!;
  const idByMount = maps.contentByMountByPath.get(CHARACTER_IDENTITY_MD_PATH)!;
  const descByMount = maps.contentByMountByPath.get(CHARACTER_DESCRIPTION_MD_PATH)!;
  const manifestoByMount = maps.contentByMountByPath.get(CHARACTER_MANIFESTO_MD_PATH)!;
  const persByMount = maps.contentByMountByPath.get(CHARACTER_PERSONALITY_MD_PATH)!;
  const dialoguesByMount = maps.contentByMountByPath.get(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)!;
  const physDescByMount = maps.contentByMountByPath.get(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)!;
  const physPromptsByMount = maps.contentByMountByPath.get(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!;

  // Keystone: a provisioned vault always carries properties.json (see
  // writeCharacterVaultManagedFields). Its absence means the vault is missing
  // or unpopulated — fail loudly rather than return a hollow character.
  const propsRaw = propsByMount.get(mountId);
  if (propsRaw === undefined) {
    throw new CharacterVaultUnavailableError(character.id, mountId, 'properties.json missing');
  }

  let out: Character = character;

  // properties.json: pronouns, aliases, title, firstMessage, talkativeness,
  // canChooseOutfit
  // (systemTransparency is access-control state — DB column only, not vault-mirrored)
  const parsed = parseVaultProperties(propsRaw, character.id);
  if (parsed) {
    out = {
      ...out,
      pronouns: parsed.pronouns,
      aliases: parsed.aliases,
      title: parsed.title,
      firstMessage: parsed.firstMessage,
      talkativeness: parsed.talkativeness,
      canChooseOutfit: parsed.canChooseOutfit,
    };
  }

  // metadata.json: the user's freeform fact sheet. Explicitly NOT a keystone —
  // vaults predating the feature have no such file, and the absence is the
  // normal state rather than a broken vault, so it hydrates as {} instead of
  // throwing. An unparseable file lands on {} too (parseVaultMetadata warns);
  // a stray comma in a fact sheet must not hollow the character.
  const metadataRaw = metadataByMount.get(mountId);
  const metadata =
    metadataRaw === undefined ? {} : (parseVaultMetadata(metadataRaw, character.id, mountId) ?? {});
  if (metadataRaw === undefined) {
    logger.debug('Character vault has no metadata.json; hydrating empty metadata', {
      characterId: character.id,
      mountPointId: mountId,
    });
  }
  out = { ...out, metadata };

  // identity.md
  const idRaw = idByMount.get(mountId);
  if (idRaw !== undefined) {
    out = { ...out, identity: markdownToNullable(idRaw) };
  }

  // description.md
  const descRaw = descByMount.get(mountId);
  if (descRaw !== undefined) {
    out = { ...out, description: markdownToNullable(descRaw) };
  }

  // manifesto.md
  const manifestoRaw = manifestoByMount.get(mountId);
  if (manifestoRaw !== undefined) {
    out = { ...out, manifesto: markdownToNullable(manifestoRaw) };
  }

  // personality.md
  const persRaw = persByMount.get(mountId);
  if (persRaw !== undefined) {
    out = { ...out, personality: markdownToNullable(persRaw) };
  }

  // example-dialogues.md
  const dialoguesRaw = dialoguesByMount.get(mountId);
  if (dialoguesRaw !== undefined) {
    out = { ...out, exampleDialogues: markdownToNullable(dialoguesRaw) };
  }

  // physical-description.md + physical-prompts.json populate the singular
  // physicalDescription. Vault is authoritative post-cutover: any vault
  // file present replaces the (now nonexistent) DB column.
  const physDescRaw = physDescByMount.get(mountId);
  const physPromptsRaw = physPromptsByMount.get(mountId);
  const hasPhysicalOverlayInput = physDescRaw !== undefined || physPromptsRaw !== undefined;

  if (hasPhysicalOverlayInput) {
    const base = out.physicalDescription ?? null;
    const patched: PhysicalDescription = base
      ? { ...base }
      : {
          id: stableUuidFromString(`physical:${mountId}`),
          name: 'default',
          usageContext: null,
          headAndShouldersPrompt: null,
          shortPrompt: null,
          mediumPrompt: null,
          longPrompt: null,
          completePrompt: null,
          fullDescription: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

    if (physDescRaw !== undefined) {
      patched.fullDescription = markdownToNullable(physDescRaw);
    }

    if (physPromptsRaw !== undefined) {
      const parsedPrompts = parseVaultPhysicalPrompts(physPromptsRaw, character.id);
      if (parsedPrompts) {
        patched.headAndShouldersPrompt = parsedPrompts.headAndShoulders ?? null;
        patched.shortPrompt = parsedPrompts.short;
        patched.mediumPrompt = parsedPrompts.medium;
        patched.longPrompt = parsedPrompts.long;
        patched.completePrompt = parsedPrompts.complete;
      }
    }

    out = { ...out, physicalDescription: patched };
  }

  // Prompts/*.md → systemPrompts. Vault-authoritative: an empty or
  // all-unparseable folder yields an empty array, never the DB column.
  const promptDocs = maps.promptsByMount.get(mountId) ?? [];
  const parsedPrompts = promptDocs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parsePromptFile(doc, character.id))
    .filter((p): p is CharacterSystemPrompt => p !== null);
  let normalizedPrompts: CharacterSystemPrompt[] = parsedPrompts;
  if (parsedPrompts.length > 0) {
    // Ensure exactly one isDefault. If the frontmatter declares multiple
    // defaults, keep only the first; if none are marked default, promote
    // the first alphabetically so downstream consumers can always pick a
    // default without falling through to the empty-array branch.
    let seenDefault = false;
    normalizedPrompts = parsedPrompts.map((p) => {
      if (p.isDefault) {
        if (seenDefault) {
          return { ...p, isDefault: false };
        }
        seenDefault = true;
        return p;
      }
      return p;
    });
    if (!seenDefault) {
      normalizedPrompts[0] = { ...normalizedPrompts[0], isDefault: true };
    }
  }
  out = { ...out, systemPrompts: normalizedPrompts };

  // Scenarios/*.md → scenarios. Vault-authoritative: an empty or
  // all-unparseable folder yields an empty array, never the DB column.
  const scenarioDocs = maps.scenariosByMount.get(mountId) ?? [];
  const parsedScenarios = scenarioDocs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((doc) => parseScenarioFile(doc, character.id))
    .filter((s): s is CharacterScenario => s !== null);
  out = { ...out, scenarios: parsedScenarios };

  return out;
}

/**
 * Apply the vault file overlay to a list of characters. Characters not flagged
 * for overlay (no linked vault) are returned unchanged. A character whose vault
 * is unavailable (missing `properties.json`) is logged at `error` and DROPPED so
 * one corrupt vault can't take down the whole roster. Batched: performs one
 * IN(...) query per vault path plus two directory listings.
 */
export async function applyDocumentStoreOverlay(
  characters: Character[],
): Promise<Character[]> {
  if (characters.length === 0) {
    return characters;
  }

  const candidates = characters.filter(hasLinkedVault);
  if (candidates.length === 0) {
    return characters;
  }

  const mountPointIds = Array.from(
    new Set(candidates.map((c) => c.characterDocumentMountPointId as string)),
  );

  const maps = await loadVaultFileMaps(mountPointIds);

  const out: Character[] = [];
  let dropped = 0;
  for (const character of characters) {
    try {
      out.push(hydrateOne(character, maps));
    } catch (err) {
      if (err instanceof CharacterVaultUnavailableError) {
        dropped++;
        logger.error('Dropping character from list — vault unavailable', {
          characterId: err.characterId,
          characterDocumentMountPointId: err.characterDocumentMountPointId,
          detail: err.message,
        });
        continue;
      }
      throw err;
    }
  }
  if (dropped > 0) {
    logger.warn('applyDocumentStoreOverlay dropped characters with unavailable vaults', {
      dropped,
      total: characters.length,
    });
  }
  return out;
}

/**
 * Single-character overlay. Throws `CharacterVaultUnavailableError` when the
 * vault is unavailable — the caller asked for this specific character, so fail
 * loudly (mapped to a 503 by the route handler). Existence-only callers that
 * must tolerate a broken vault use `findByIdRaw` instead.
 */
export async function applyDocumentStoreOverlayOne(
  character: Character | null,
): Promise<Character | null> {
  if (!character) {
    return character;
  }
  // Archived characters are NOT short-circuited (§4.2a): their vault survives
  // the prune and must be overlaid like any other. Pre-revision tombstones
  // (vault deleted, pointer nulled) fall through hasLinkedVault unhollowed.
  if (!hasLinkedVault(character)) {
    return character;
  }
  const mountId = character.characterDocumentMountPointId as string;
  const maps = await loadVaultFileMaps([mountId]);
  return hydrateOne(character, maps);
}
