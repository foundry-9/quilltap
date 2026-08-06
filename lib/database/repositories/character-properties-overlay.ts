/**
 * Character Vault-Managed Fields
 *
 * Every character with a linked vault has selected content fields served
 * out of vault files rather than DB columns (those columns no longer exist
 * post-4.6 cutover). Nine vault targets participate, each independently:
 *
 *   - properties.json          — pronouns, aliases, title, firstMessage, talkativeness, canChooseOutfit
 *   - identity.md              — character.identity
 *   - description.md           — character.description
 *   - manifesto.md             — character.manifesto
 *   - personality.md           — character.personality
 *   - example-dialogues.md     — character.exampleDialogues
 *   - physical-description.md  — physicalDescription.fullDescription
 *   - physical-prompts.json    — physicalDescription.{short,medium,long,complete}Prompt
 *   - Wardrobe/*.md            — wardrobe items (one file per item, frontmatter
 *                                 carries id/title/types/appropriateness/
 *                                 componentItems/etc.; body is the freeform
 *                                 description). Applied by the wardrobe
 *                                 repository. Composite items reference their
 *                                 components via the `componentItems:` slug
 *                                 array (slug-first, UUID fallback). The
 *                                 retired `Outfits/` folder is tolerated on
 *                                 read but no longer parsed.
 *   - Prompts/*.md             — character.systemPrompts (one file per variant,
 *                                 YAML frontmatter carries {name, isDefault})
 *   - Scenarios/*.md           — character.scenarios (one file per scenario,
 *                                 first `# heading` is the title)
 *
 * `systemTransparency` is intentionally NOT a managed field — it is access-
 * control application state and lives only as a DB column.
 *
 * Each file's read is all-or-nothing for the fields it owns. If the file is
 * missing, malformed, or fails schema validation, that file's fields fall
 * back to whatever the parent code path expects (typically null/empty).
 * Empty markdown files map `''` → null so nullable fields retain their
 * "unset" semantics.
 *
 * Prompts/ and Scenarios/ enumerate top-level `.md` files only; nested
 * paths are ignored. The vault folder is authoritative — parseable files
 * become the array, and an empty/all-unparseable folder yields an empty
 * array.
 *
 * IDs for synthesized systemPrompts/scenarios entries are derived
 * deterministically from (mountPointId, relativePath) via SHA-256 so chat
 * references to `selectedSystemPromptId` / `defaultScenarioId` survive
 * across reads as long as the filename doesn't change.
 *
 * The physical-description.md and physical-prompts.json files populate the
 * singular `physicalDescription`; a synthetic record is created when vault
 * files exist but the character had no prior physical record.
 *
 * Vault routing is applied at the CharactersRepository layer so every read
 * path (findById/findAll/findByUserId/findByIds/findByFilter/etc.) sees
 * vault values transparently. Exports and the vault populator bypass via
 * the repository's `Raw` helpers.
 *
 * --------------------------------------------------------------------------
 * This file is a barrel: the implementation lives in `vault-overlay/`,
 * grouped by responsibility. Import sites continue to reach everything
 * through this module path.
 *
 *   - schema.ts          — schemas, types, path constants, descriptor table
 *   - parsers.ts         — pure parse/validate helpers (no DB access)
 *   - vault-projection.ts — generic vault-folder projection helper
 *   - vault-readers.ts   — per-field readers + readVaultTextFile
 *   - read-overlay.ts    — batched read overlay (apply* functions)
 *   - wardrobe-sync.ts   — wardrobe read overlay + write-back sync
 *   - managed-fields.ts  — consolidated read/write + write overlay
 *
 * @module database/repositories/character-properties-overlay
 */

export {
  CharacterVaultPropertiesSchema,
  type CharacterVaultProperties,
  CharacterVaultMetadataSchema,
  type CharacterVaultMetadata,
  CharacterVaultPhysicalPromptsSchema,
  type CharacterVaultPhysicalPrompts,
  type CharacterVaultWardrobe,
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
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
  CHARACTER_WARDROBE_FOLDER,
  type CharacterVaultDescriptor,
  CHARACTER_VAULT_DESCRIPTORS,
  MANAGED_FIELDS,
  CharacterVaultUnavailableError,
} from './vault-overlay/schema';

export {
  applyDocumentStoreOverlay,
  applyDocumentStoreOverlayOne,
} from './vault-overlay/read-overlay';

export {
  readVaultTextFile,
  readCharacterVaultProperties,
  readCharacterVaultPropertiesForWrite,
  readCharacterVaultMetadata,
  readCharacterVaultIdentity,
  readCharacterVaultDescription,
  readCharacterVaultManifesto,
  readCharacterVaultPersonality,
  readCharacterVaultExampleDialogues,
  readCharacterVaultPhysicalDescription,
  readCharacterVaultPhysicalPrompts,
  readCharacterVaultSystemPrompts,
  readCharacterVaultScenarios,
  readCharacterVaultWardrobe,
} from './vault-overlay/vault-readers';

export {
  type WardrobeOverlayOptions,
  getOverlaidWardrobeItems,
  projectVaultWardrobe,
} from './vault-overlay/wardrobe-sync';

export {
  type VaultManagedFieldsSnapshot,
  readCharacterVaultManagedFields,
  type VaultManagedFieldsWriteInput,
  type VaultManagedFieldsWriteResult,
  writeCharacterVaultManagedFields,
  applyDocumentStoreWriteOverlay,
} from './vault-overlay/managed-fields';
