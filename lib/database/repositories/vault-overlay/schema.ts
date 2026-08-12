/**
 * Schemas, types, path constants, and the vault field descriptor table for the
 * character vault overlay.
 *
 * This is the single source of truth for "which character fields live in which
 * vault file." It has no dependencies on the other overlay submodules, so both
 * the read overlay and the write overlay can share it without cycles.
 *
 * @module database/repositories/vault-overlay/schema
 */

import { z } from 'zod';
import type { Character } from '@/lib/schemas/types';
import { PronounsSchema } from '@/lib/schemas/character.types';
import { JsonSchema } from '@/lib/schemas/common.types';
import {
  WardrobeItemSchema,
  type WardrobeItem,
} from '@/lib/schemas/wardrobe.types';
import { CHARACTER_WARDROBE_FOLDER } from '@/lib/mount-index/character-vault';

// Mirrors the nullability of the underlying Character schema so that a vault
// whose properties.json carries null `title` / `firstMessage` (the normal
// state when those fields are unset in the DB) does not silently fail
// validation and fall back to the DB for all five fields.
export const CharacterVaultPropertiesSchema = z.object({
  pronouns: PronounsSchema.nullable(),
  aliases: z.array(z.string()),
  title: z.string().nullable(),
  firstMessage: z.string().nullable(),
  talkativeness: z.number().min(0.1).max(1.0),
  // Optional-with-default so the vaults written before this field existed
  // still parse (their properties.json has no `canChooseOutfit` key) and
  // hydrate as false, rather than failing validation and falling back to the
  // DB for every managed field. "Absent means false" is the intended default.
  canChooseOutfit: z.boolean().optional().default(false),
});

export type CharacterVaultProperties = z.infer<typeof CharacterVaultPropertiesSchema>;

export const CharacterVaultPhysicalPromptsSchema = z.object({
  // Optional: legacy physical-prompts.json files written before this field
  // existed only carry {short,medium,long,complete}. A non-optional key here
  // would make the strict safeParse reject them and wipe ALL prompt tiers.
  headAndShoulders: z.string().nullable().optional(),
  short: z.string().nullable(),
  medium: z.string().nullable(),
  long: z.string().nullable(),
  complete: z.string().nullable(),
});

export type CharacterVaultPhysicalPrompts = z.infer<typeof CharacterVaultPhysicalPromptsSchema>;

/**
 * `metadata.json` — one flat object of user-authored keys, values of any JSON
 * type. Nothing about the contents is constrained: the keys are the user's
 * vocabulary, not ours, so the schema's whole job is to insist the file is a
 * JSON *object* and refuse an array or a bare scalar.
 *
 * `JsonSchema` (record of string → unknown) is exactly that shape, and is
 * already what `sillyTavernData` uses — reused rather than restated so the two
 * can't drift into disagreeing about what "arbitrary JSON" means.
 */
export const CharacterVaultMetadataSchema = JsonSchema;

export type CharacterVaultMetadata = z.infer<typeof CharacterVaultMetadataSchema>;

// Snapshot of a vault's wardrobe state — composite items live alongside leaf
// items in the same list and reference their components via
// `componentItemIds`. Returned from the folder-based reader; the legacy JSON
// parser produces the same shape so callers don't have to care which file
// layout the vault is on.
export interface CharacterVaultWardrobe {
  items: WardrobeItem[];
}

// The legacy JSON shape we still parse on migration. New vaults never write
// this; the folder format is authoritative going forward. Pre-rework vaults
// included a `presets` array that is now ignored — the migration step folds
// those into composite wardrobe items, so honoring it here would double-write.
export const LegacyVaultWardrobeJsonSchema = z.object({
  items: z.array(WardrobeItemSchema),
  outfit: z
    .object({
      top: z.string().nullable().optional(),
      bottom: z.string().nullable().optional(),
      footwear: z.string().nullable().optional(),
      accessories: z.string().nullable().optional(),
    })
    .optional(),
});

/**
 * The relative paths of the overlay documents inside a character vault.
 * Mirrors `writeCharacterVaultManagedFields()` below.
 */
export const CHARACTER_PROPERTIES_JSON_PATH = 'properties.json';
export const CHARACTER_METADATA_JSON_PATH = 'metadata.json';
export const CHARACTER_IDENTITY_MD_PATH = 'identity.md';
export const CHARACTER_DESCRIPTION_MD_PATH = 'description.md';
export const CHARACTER_MANIFESTO_MD_PATH = 'manifesto.md';
export const CHARACTER_PERSONALITY_MD_PATH = 'personality.md';
export const CHARACTER_EXAMPLE_DIALOGUES_MD_PATH = 'example-dialogues.md';
export const CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH = 'physical-description.md';
export const CHARACTER_PHYSICAL_PROMPTS_JSON_PATH = 'physical-prompts.json';
export const CHARACTER_WARDROBE_JSON_PATH = 'wardrobe.json';

export const CHARACTER_PROMPTS_FOLDER = 'Prompts';
export const CHARACTER_SCENARIOS_FOLDER = 'Scenarios';
export { CHARACTER_WARDROBE_FOLDER };

export const SINGLE_FILE_OVERLAY_PATHS = [
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_IDENTITY_MD_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_MANIFESTO_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
] as const;

/**
 * Thrown when a character flagged for vault overlay (`characterDocumentMountPointId`
 * is set) has no usable vault — a null/unreadable mount, or a missing
 * `properties.json` keystone. Post-cutover the vault is the sole source of truth
 * for the managed content fields (identity, description, manifesto, personality,
 * exampleDialogues, title, firstMessage, systemPrompts, scenarios, …); the DB row
 * no longer carries them. A broken vault is therefore a broken invariant, not a
 * routine state, and must fail loudly rather than return a hollowed-out character.
 *
 * The read overlay's single-fetch path (`applyDocumentStoreOverlayOne`, behind
 * `findById`) throws this. The batched list path (`applyDocumentStoreOverlay`,
 * behind `findAll`/`findByIds`) catches it, logs at `error`, and drops the
 * offending character so one bad row cannot take down the whole roster. Mirrors
 * `ProjectStoreUnavailableError` / `GroupStoreUnavailableError`.
 */
export class CharacterVaultUnavailableError extends Error {
  constructor(
    public readonly characterId: string,
    public readonly characterDocumentMountPointId: string | null | undefined,
    detail?: string,
  ) {
    super(
      `Character ${characterId} has no usable vault ` +
        `(characterDocumentMountPointId=${characterDocumentMountPointId ?? 'null'})` +
        (detail ? `: ${detail}` : ''),
    );
    this.name = 'CharacterVaultUnavailableError';
  }
}

// ============================================================================
// VAULT FIELD DESCRIPTORS
//
// Single source of truth for "which character fields live in which vault file."
// Drives both the write overlay (route patches to the right file) and the
// generic vault readers used by the sync-back action. The existing batched
// read overlay still operates on the raw paths above, but its conceptual
// mapping mirrors this table 1:1 — keep them in sync when adding a managed
// field.
// ============================================================================

export type CharacterVaultDescriptor =
  | {
      kind: 'markdown';
      vaultPath: string;
      field: 'identity' | 'description' | 'manifesto' | 'personality' | 'exampleDialogues';
    }
  | { kind: 'physical-md'; vaultPath: string }
  | { kind: 'physical-json'; vaultPath: string }
  | { kind: 'properties-json'; vaultPath: string }
  | { kind: 'metadata-json'; vaultPath: string }
  | { kind: 'prompts-dir'; vaultFolder: string }
  | { kind: 'scenarios-dir'; vaultFolder: string };

export const CHARACTER_VAULT_DESCRIPTORS: readonly CharacterVaultDescriptor[] = [
  { kind: 'properties-json', vaultPath: CHARACTER_PROPERTIES_JSON_PATH },
  { kind: 'metadata-json', vaultPath: CHARACTER_METADATA_JSON_PATH },
  { kind: 'markdown', vaultPath: CHARACTER_IDENTITY_MD_PATH, field: 'identity' },
  { kind: 'markdown', vaultPath: CHARACTER_DESCRIPTION_MD_PATH, field: 'description' },
  { kind: 'markdown', vaultPath: CHARACTER_MANIFESTO_MD_PATH, field: 'manifesto' },
  { kind: 'markdown', vaultPath: CHARACTER_PERSONALITY_MD_PATH, field: 'personality' },
  { kind: 'markdown', vaultPath: CHARACTER_EXAMPLE_DIALOGUES_MD_PATH, field: 'exampleDialogues' },
  { kind: 'physical-md', vaultPath: CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH },
  { kind: 'physical-json', vaultPath: CHARACTER_PHYSICAL_PROMPTS_JSON_PATH },
  { kind: 'prompts-dir', vaultFolder: CHARACTER_PROMPTS_FOLDER },
  { kind: 'scenarios-dir', vaultFolder: CHARACTER_SCENARIOS_FOLDER },
];

// Top-level Character keys whose writes are routed to the vault. Every
// character with a linked vault has its managed-field writes diverted here;
// the corresponding DB columns were dropped in the 4.6 cutover.
// systemTransparency is intentionally absent — it stays as application-state
// access control on the DB row.
export const MANAGED_FIELDS: ReadonlySet<keyof Character> = new Set<keyof Character>([
  'identity',
  'description',
  'manifesto',
  'personality',
  'exampleDialogues',
  'pronouns',
  'aliases',
  'title',
  'firstMessage',
  'talkativeness',
  'canChooseOutfit',
  'physicalDescription',
  'systemPrompts',
  'scenarios',
  'metadata',
]);
