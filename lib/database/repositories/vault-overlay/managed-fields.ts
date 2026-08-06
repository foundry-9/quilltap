/**
 * Descriptor-driven managed-field read/write for character vaults:
 *
 *   - readCharacterVaultManagedFields  — consolidated "give me everything the
 *                                         vault has for this character" reader
 *   - writeCharacterVaultManagedFields — full-character projection (every file)
 *   - applyDocumentStoreWriteOverlay    — patch-level write routing
 *
 * @module database/repositories/vault-overlay/managed-fields
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type {
  Character,
  PhysicalDescription,
} from '@/lib/schemas/types';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import {
  buildSystemPromptFile,
  buildScenarioFile,
  sanitizeFileName,
  renderPhysicalPromptsJson,
  ensureCharacterVault,
} from '@/lib/mount-index/character-vault';

import {
  CHARACTER_VAULT_DESCRIPTORS,
  MANAGED_FIELDS,
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
  type CharacterVaultProperties,
} from './schema';
import { hasLinkedVault, stableUuidFromString } from './parsers';
import {
  readVaultTextFile,
  readCharacterVaultProperties,
  readCharacterVaultPropertiesForWrite,
  readCharacterVaultMetadata,
  readCharacterVaultPhysicalPrompts,
  readCharacterVaultSystemPrompts,
  readCharacterVaultScenarios,
} from './vault-readers';
import { projectArrayIntoVaultFolder } from './vault-projection';

// ============================================================================
// CONSOLIDATED VAULT READERS
//
// Single descriptor-driven entry point that the sync-back action and any
// future "give me everything the vault has for this character" caller can use
// instead of stitching together the nine standalone readCharacterVault*
// helpers above.
// ============================================================================

/**
 * Snapshot of all vault-managed fields for a character, in Character-row
 * shape. Fields whose vault file is missing/malformed are omitted (not set to
 * null), so callers can spread this object into a patch without clobbering
 * unrelated DB-only fields.
 *
 * `physicalDescription` is set when any physical-* vault file is present —
 * the singular record is built from the existing one (if any) plus the
 * vault's full text / prompt variants, or synthesized from scratch when the
 * character had no prior physical record.
 */
export interface VaultManagedFieldsSnapshot extends Partial<Character> {}

export async function readCharacterVaultManagedFields(
  mountPointId: string,
  characterId: string,
  existingPhysicalDescription: PhysicalDescription | null = null,
): Promise<VaultManagedFieldsSnapshot> {
  const snapshot: VaultManagedFieldsSnapshot = {};

  for (const descriptor of CHARACTER_VAULT_DESCRIPTORS) {
    switch (descriptor.kind) {
      case 'properties-json': {
        const props = await readCharacterVaultProperties(mountPointId, characterId);
        if (props) {
          snapshot.pronouns = props.pronouns;
          snapshot.aliases = props.aliases;
          snapshot.title = props.title;
          snapshot.firstMessage = props.firstMessage;
          snapshot.talkativeness = props.talkativeness;
          snapshot.canChooseOutfit = props.canChooseOutfit;
        }
        break;
      }
      case 'metadata-json': {
        const metadata = await readCharacterVaultMetadata(mountPointId, characterId);
        if (metadata) {
          snapshot.metadata = metadata;
        }
        break;
      }
      case 'markdown': {
        const md = await readVaultTextFile(mountPointId, descriptor.vaultPath, characterId);
        if (md !== null) {
          // Empty file → null so nullable fields keep their unset semantics.
          (snapshot as Record<string, unknown>)[descriptor.field] = md === '' ? null : md;
        }
        break;
      }
      case 'physical-md':
      case 'physical-json': {
        // Handled together below to keep both files patched onto the same
        // physicalDescription copy. We process physical-md first; the
        // physical-json branch is a no-op the second time around.
        if (descriptor.kind === 'physical-md') {
          const physDescMd = await readVaultTextFile(
            mountPointId,
            CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
            characterId,
          );
          const physPromptsJson = await readCharacterVaultPhysicalPrompts(
            mountPointId,
            characterId,
          );
          if (physDescMd === null && physPromptsJson === null) break;
          const nowIso = new Date().toISOString();
          const patched: PhysicalDescription = existingPhysicalDescription
            ? { ...existingPhysicalDescription }
            : {
                id: stableUuidFromString(`physical:${mountPointId}`),
                name: 'default',
                usageContext: null,
                headAndShouldersPrompt: null,
                shortPrompt: null,
                mediumPrompt: null,
                longPrompt: null,
                completePrompt: null,
                fullDescription: null,
                createdAt: nowIso,
                updatedAt: nowIso,
              };
          if (physDescMd !== null) {
            patched.fullDescription = physDescMd === '' ? null : physDescMd;
          }
          if (physPromptsJson !== null) {
            patched.headAndShouldersPrompt = physPromptsJson.headAndShoulders ?? null;
            patched.shortPrompt = physPromptsJson.short;
            patched.mediumPrompt = physPromptsJson.medium;
            patched.longPrompt = physPromptsJson.long;
            patched.completePrompt = physPromptsJson.complete;
          }
          patched.updatedAt = nowIso;
          snapshot.physicalDescription = patched;
        }
        break;
      }
      case 'prompts-dir': {
        const prompts = await readCharacterVaultSystemPrompts(mountPointId, characterId);
        if (prompts.length > 0) {
          snapshot.systemPrompts = prompts;
        }
        break;
      }
      case 'scenarios-dir': {
        const scenarios = await readCharacterVaultScenarios(mountPointId, characterId);
        if (scenarios.length > 0) {
          snapshot.scenarios = scenarios;
        }
        break;
      }
    }
  }

  return snapshot;
}

// ============================================================================
// FULL-CHARACTER VAULT WRITER
//
// Counterpart to readCharacterVaultManagedFields: given a raw (non-overlaid)
// character, project every vault-managed content field out to the vault's
// files. Used when provisioning or repopulating a character vault. Wardrobe is
// NOT handled here — it lives solely in the vault and is written through the
// wardrobe-writes path; see the note at the end of the function body.
//
// This intentionally writes every managed file (not just a patch), so after a
// successful call the vault is a faithful snapshot of the DB row's content.
// Prompts/ and Scenarios/ folders are reprojected — files that don't correspond
// to a DB entry are deleted so the vault listing matches the DB arrays exactly.
// ============================================================================

export interface VaultManagedFieldsWriteInput {
  character: Character;
}

export interface VaultManagedFieldsWriteResult {
  /** Number of single-file writes performed (not counting Prompts/ or Scenarios/ folder contents). */
  singleFileWriteCount: number;
  systemPromptsWritten: number;
  scenariosWritten: number;
  /** True when the character has no physicalDescription and the physical-* files were skipped. */
  physicalSkippedNoPrimary: boolean;
}

export async function writeCharacterVaultManagedFields(
  mountPointId: string,
  { character }: VaultManagedFieldsWriteInput,
): Promise<VaultManagedFieldsWriteResult> {
  const result: VaultManagedFieldsWriteResult = {
    singleFileWriteCount: 0,
    systemPromptsWritten: 0,
    scenariosWritten: 0,
    physicalSkippedNoPrimary: false,
  };

  await writeDatabaseDocument(
    mountPointId,
    CHARACTER_PROPERTIES_JSON_PATH,
    JSON.stringify(
      {
        pronouns: character.pronouns ?? null,
        aliases: character.aliases ?? [],
        title: character.title ?? null,
        firstMessage: character.firstMessage ?? null,
        talkativeness: character.talkativeness ?? 0.5,
        canChooseOutfit: character.canChooseOutfit ?? false,
      },
      null,
      2,
    ),
  );
  result.singleFileWriteCount++;

  // The fact sheet — projected ONLY when the caller actually has one.
  //
  // `metadata` has no DB column and no schema default: a raw character row
  // simply cannot carry it, so "the caller passed nothing" means "no opinion",
  // NOT "empty". Writing `{}` on its absence would let any caller holding a raw
  // row — the startup backfill's repopulate path does exactly that — silently
  // erase a fact sheet it never saw. So absence here leaves the file alone.
  //
  // (The six properties.json fields written above likewise have no DB column
  // post-4.6 — they live only in that file. This full-projection writer is
  // always handed a fully-overlaid character, so it can write them wholesale.
  // But the *patch* path in applyDocumentStoreWriteOverlay must never seed
  // empty defaults over an unreadable properties.json, since there is nowhere
  // else to recover the six from — see readCharacterVaultPropertiesForWrite,
  // which refuses that write. Bug 8.)
  //
  // Nothing is lost by the skip: a fresh vault's `metadata.json` is seeded by
  // the scaffold, and the startup backfill seeds any older vault still lacking
  // one. Same reasoning as the wardrobe note at the end of this function.
  if (character.metadata != null) {
    await writeDatabaseDocument(
      mountPointId,
      CHARACTER_METADATA_JSON_PATH,
      JSON.stringify(character.metadata, null, 2),
    );
    result.singleFileWriteCount++;
  }

  await writeDatabaseDocument(mountPointId, CHARACTER_IDENTITY_MD_PATH, character.identity ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_DESCRIPTION_MD_PATH, character.description ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_MANIFESTO_MD_PATH, character.manifesto ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(mountPointId, CHARACTER_PERSONALITY_MD_PATH, character.personality ?? '');
  result.singleFileWriteCount++;

  await writeDatabaseDocument(
    mountPointId,
    CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
    character.exampleDialogues ?? '',
  );
  result.singleFileWriteCount++;

  const primaryPhysical = character.physicalDescription ?? null;
  if (primaryPhysical) {
    await writeDatabaseDocument(
      mountPointId,
      CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
      primaryPhysical.fullDescription ?? '',
    );
    result.singleFileWriteCount++;
    await writeDatabaseDocument(
      mountPointId,
      CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
      renderPhysicalPromptsJson(primaryPhysical),
    );
    result.singleFileWriteCount++;
  } else {
    result.physicalSkippedNoPrimary = true;
  }

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_PROMPTS_FOLDER,
    character.systemPrompts ?? [],
    (p) => ({
      fileName: `${sanitizeFileName(p.name)}.md`,
      content: buildSystemPromptFile(p),
    }),
    character.id,
  );
  result.systemPromptsWritten = character.systemPrompts?.length ?? 0;

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_SCENARIOS_FOLDER,
    character.scenarios ?? [],
    (s) => ({
      fileName: `${sanitizeFileName(s.title)}.md`,
      content: buildScenarioFile(s),
    }),
    character.id,
  );
  result.scenariosWritten = character.scenarios?.length ?? 0;

  // Wardrobe is NOT projected here. Wardrobe items live solely in the vault and
  // are written through the vault-first `wardrobe.create()` / wardrobe-writes
  // path (which re-projects the `Wardrobe/` folder itself). Projecting it here
  // would require an authoritative item list; passing an empty one would make
  // the projection sweep delete any existing `Wardrobe/*.md` files.

  return result;
}

// ============================================================================
// WRITE OVERLAY
//
// Symmetric counterpart to applyDocumentStoreOverlay: when an update() patch
// includes managed fields and the character is in vault mode, route those
// fields to vault files instead of the DB row. Returns the unmanaged
// remainder so the caller can still do its DB write for the rest.
//
// Vault-only invariant: the 4.6 cutover dropped the DB columns for every
// managed field, so those fields live exclusively in the vault. There is no
// overlay toggle and no "frozen DB value" to fall back to — routing is
// unconditional. Managed fields are stripped from the DB-bound patch here, and
// `_update` strips MANAGED_FIELDS again defensively; the DB row never carries
// them.
// ============================================================================

/**
 * Decide whether a Character-row update needs to be routed to the vault, and
 * if so, write the managed fields and strip them from the DB-bound patch.
 *
 * Returns the portion of `patch` that should go to the DB (unmanaged fields
 * always; managed fields only when the character is not in vault mode).
 *
 * Throws if a vault write fails — the caller should NOT then proceed with the
 * DB write, so that callers can't end up with a partial commit where DB and
 * vault disagree on which fields are "current."
 */
export async function applyDocumentStoreWriteOverlay(
  characterId: string,
  patch: Partial<Character>,
): Promise<Partial<Character>> {
  const repos = getRepositories();
  let character = await repos.characters.findByIdRaw(characterId);
  if (!character) {
    // Caller will hit the same not-found in _update; let it surface there.
    return patch;
  }

  if (!hasLinkedVault(character)) {
    const wouldRouteManagedField = Array.from(MANAGED_FIELDS).some((f) => (f as string) in patch);
    if (!wouldRouteManagedField) {
      // No managed fields in the patch — nothing to route. Let the unmanaged
      // bits flow to the DB row unchanged.
      return patch;
    }

    // The post-4.6 cutover dropped the DB columns for managed fields, so a
    // character without a vault would silently lose them on the way through
    // `_update`. Every character is supposed to have a vault — the startup
    // backfill provisions one for any that don't — so reaching this branch is
    // a bug elsewhere. Provision a vault now so the write doesn't get
    // dropped, but log loudly so the upstream issue surfaces.
    logger.error(
      'applyDocumentStoreWriteOverlay: character has no linked vault but the patch carries managed fields; provisioning on the fly',
      {
        characterId,
        managedFieldsInPatch: Array.from(MANAGED_FIELDS).filter((f) => (f as string) in patch),
      },
    );
    await ensureCharacterVault(character);
    // Reload — ensureCharacterVault sets characterDocumentMountPointId.
    character = await repos.characters.findByIdRaw(characterId);
    if (!character || !hasLinkedVault(character)) {
      throw new Error(
        `applyDocumentStoreWriteOverlay: failed to provision vault for ${characterId}`,
      );
    }
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const dbPatch: Partial<Character> = { ...patch };

  for (const descriptor of CHARACTER_VAULT_DESCRIPTORS) {
    switch (descriptor.kind) {
      case 'markdown': {
        if (!(descriptor.field in patch)) break;
        const value = patch[descriptor.field] as string | null | undefined;
        await writeDatabaseDocument(mountPointId, descriptor.vaultPath, value ?? '');
        delete dbPatch[descriptor.field];
        break;
      }
      case 'properties-json': {
        const propsKeys = ['pronouns', 'aliases', 'title', 'firstMessage', 'talkativeness', 'canChooseOutfit'] as const;
        const touched = propsKeys.filter((k) => k in patch);
        if (touched.length === 0) break;
        // Read-modify-write so a partial patch doesn't blow away unspecified
        // fields in the same JSON file.
        //
        // `readCharacterVaultPropertiesForWrite` returns null ONLY when
        // properties.json is genuinely absent (a fresh vault — seeding the
        // defaults below is correct); it THROWS when the file exists but is
        // unreadable/unparseable. That refusal is the whole fix for Bug 8: the
        // six fields this file owns (pronouns, aliases, title, firstMessage,
        // talkativeness, canChooseOutfit) live NOWHERE else post-4.6, so
        // seeding empty defaults over a corrupt-but-present file would clobber
        // them permanently and silently. Fail the save loudly instead — the
        // user repairs or deletes the file. (Established vault failure
        // semantics: reads already throw CharacterVaultUnavailableError on a
        // broken vault; there is no "silent hollow" character.)
        const current = (await readCharacterVaultPropertiesForWrite(mountPointId, characterId)) ?? {
          pronouns: character.pronouns ?? null,
          aliases: character.aliases ?? [],
          title: character.title ?? null,
          firstMessage: character.firstMessage ?? null,
          talkativeness: character.talkativeness ?? 0.5,
          canChooseOutfit: character.canChooseOutfit ?? false,
        };
        const next: CharacterVaultProperties = {
          pronouns: 'pronouns' in patch ? (patch.pronouns ?? null) : current.pronouns,
          aliases: 'aliases' in patch ? (patch.aliases ?? []) : current.aliases,
          title: 'title' in patch ? (patch.title ?? null) : current.title,
          firstMessage:
            'firstMessage' in patch ? (patch.firstMessage ?? null) : current.firstMessage,
          talkativeness:
            'talkativeness' in patch ? (patch.talkativeness ?? 0.5) : current.talkativeness,
          canChooseOutfit:
            'canChooseOutfit' in patch ? (patch.canChooseOutfit ?? false) : current.canChooseOutfit,
        };
        await writeDatabaseDocument(
          mountPointId,
          descriptor.vaultPath,
          JSON.stringify(next, null, 2),
        );
        for (const k of touched) delete dbPatch[k];
        break;
      }
      case 'metadata-json': {
        if (!('metadata' in patch)) break;
        // Whole-object REPLACE, not a key-merge: `metadata` is one field owning
        // one file, so the patch's value simply becomes the file. (properties.json
        // read-modify-writes because five Character fields share it — that dance
        // buys nothing here and would make it impossible to delete a key.)
        // Key-level edits are the caller's read-modify-write to do.
        const next = patch.metadata ?? {};
        await writeDatabaseDocument(
          mountPointId,
          descriptor.vaultPath,
          JSON.stringify(next, null, 2),
        );
        delete dbPatch.metadata;
        break;
      }
      case 'physical-md':
      case 'physical-json': {
        // Only routed once, on the physical-md descriptor pass; physical-json
        // is handled in the same write because both target physicalDescription.
        if (descriptor.kind !== 'physical-md') break;
        if (!('physicalDescription' in patch)) break;
        const incoming = patch.physicalDescription ?? null;
        if (!incoming) {
          // Clearing physicalDescription is a DB-side concern; leave vault file alone.
          break;
        }
        await writeDatabaseDocument(
          mountPointId,
          CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
          incoming.fullDescription ?? '',
        );
        await writeDatabaseDocument(
          mountPointId,
          CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
          renderPhysicalPromptsJson(incoming),
        );
        // Vault owns the physicalDescription post-cutover; nothing flows back to
        // the (now nonexistent) DB column.
        delete dbPatch.physicalDescription;
        break;
      }
      case 'prompts-dir': {
        if (!('systemPrompts' in patch)) break;
        const incoming = patch.systemPrompts ?? [];
        await projectArrayIntoVaultFolder(
          mountPointId,
          descriptor.vaultFolder,
          incoming,
          (p) => ({
            fileName: `${sanitizeFileName(p.name)}.md`,
            content: buildSystemPromptFile(p),
          }),
          characterId,
        );
        // Vault owns systemPrompts post-cutover; the DB column was dropped in
        // 4.6, so nothing flows back (and `_update` strips it regardless).
        delete dbPatch.systemPrompts;
        break;
      }
      case 'scenarios-dir': {
        if (!('scenarios' in patch)) break;
        const incoming = patch.scenarios ?? [];
        await projectArrayIntoVaultFolder(
          mountPointId,
          descriptor.vaultFolder,
          incoming,
          (s) => ({
            fileName: `${sanitizeFileName(s.title)}.md`,
            content: buildScenarioFile(s),
          }),
          characterId,
        );
        // Vault owns scenarios post-cutover; the DB column was dropped in 4.6,
        // so nothing flows back (and `_update` strips it regardless).
        delete dbPatch.scenarios;
        break;
      }
    }
  }

  return dbPatch;
}
