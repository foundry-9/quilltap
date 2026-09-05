/**
 * Character Type Definitions
 *
 * Contains schemas for characters, character system prompts,
 * and physical descriptions used for image generation.
 *
 * @module schemas/character.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
} from './common.types';
import { TimestampConfigSchema } from './settings.types';

// ============================================================================
// CHARACTER SYSTEM PROMPTS
// ============================================================================

// Character System Prompt (embedded in Character) - named system prompts for characters
export const CharacterSystemPromptSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type CharacterSystemPrompt = z.infer<typeof CharacterSystemPromptSchema>;

// ============================================================================
// CHARACTER SCENARIOS
// ============================================================================

// Character Scenario (embedded in Character) - named scenarios for roleplay context
export const CharacterScenarioSchema = z.object({
  id: UUIDSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  description: z.string().max(500).optional(),
  /**
   * Hidden from every picker unless the surface asked for archived entries.
   * Backed by `archived: true` in the vault file's frontmatter; the key is
   * omitted entirely when the scenario is active.
   *
   * Vault reads deliberately KEEP archived scenarios in `character.scenarios`
   * — the write overlay projects that array back over `Scenarios/`, sweeping
   * any file it doesn't contain, so dropping them here would delete them.
   * Filtering belongs at the API/UI boundary, never at the vault read.
   */
  archived: z.boolean().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type CharacterScenario = z.infer<typeof CharacterScenarioSchema>;

// ============================================================================
// PHYSICAL DESCRIPTIONS
// ============================================================================

// Physical Description for image generation prompts
export const PhysicalDescriptionSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),
  usageContext: z.string().max(200).nullable().optional(),
  // Tight head-and-shoulders portrait prompt — face/hair/expression/neckline
  // only, never below-shoulder anatomy. Preferred source for avatar generation
  // (avatars are a head-and-shoulders crop); see lib/wardrobe/avatar-prompt.ts.
  headAndShouldersPrompt: z.string().max(500).nullable().optional(),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type PhysicalDescription = z.infer<typeof PhysicalDescriptionSchema>;

// ============================================================================
// CLOTHING RECORDS
// ============================================================================

// Clothing Record for outfit descriptions
export const ClothingRecordSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),
  usageContext: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ClothingRecord = z.infer<typeof ClothingRecordSchema>;

// ============================================================================
// CHARACTER PRONOUNS
// ============================================================================

export const PronounsSchema = z.object({
  subject: z.string().min(1).max(20),
  object: z.string().min(1).max(20),
  possessive: z.string().min(1).max(20),
});

export type Pronouns = z.infer<typeof PronounsSchema>;

// ============================================================================
// CHARACTER
// ============================================================================

// Control mode for characters
export const ControlledByEnum = z.enum(['llm', 'user']);
export type ControlledBy = z.infer<typeof ControlledByEnum>;

export const CharacterSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  /**
   * The user's or character's own private label/framing for this character —
   * a tag like "the love interest", "the rival", "the protagonist". Not visible
   * to other characters and not how strangers refer to them. Distinct from
   * `identity` (public-facing) and `description` (acquaintance-facing).
   */
  title: z.string().nullable().optional(),
  /**
   * The most surface-level knowledge of the character, from outside. What
   * strangers can know on sight or by reputation — name, station, occupation,
   * public reputation. Shallow but useful for someone considering whether to
   * approach. Does NOT include private mannerisms, behaviour, or self-knowledge.
   */
  identity: z.string().nullable().optional(),
  /**
   * What someone talking to (or acquainted with) the character perceives. NOT
   * physical appearance — that lives in `physicalDescription`. Behaviour,
   * mannerisms, frequent verbal patterns. Things an interlocutor notices, but
   * not the character's internal monologue or self-knowledge.
   */
  description: z.string().nullable().optional(),
  /**
   * The basic tenets — the most important facts of the character's existence.
   * The axiomatic core that every other field (identity, description,
   * personality, physical, dialogues) should remain consistent with. Not a
   * vantage-point field; nobody "sees" the manifesto, it is the load-bearing
   * truth the character is built on. Synced as `manifesto.md` in the character
   * vault. Vault lookups are case-insensitive, so `Manifesto.md` matches too.
   */
  manifesto: z.string().nullable().optional(),
  /**
   * What the character knows about themselves. The internal driver of speech
   * and behaviour. Other characters don't see this unless the character shares
   * it. Distinct from `description` (outward-facing behaviour) and `identity`
   * (public-facing surface knowledge).
   */
  personality: z.string().nullable().optional(),
  scenarios: z.array(CharacterScenarioSchema).default([]),  // Named scenarios array
  firstMessage: z.string().nullable().optional(),
  exampleDialogues: z.string().nullable().optional(),
  systemPrompts: z.array(CharacterSystemPromptSchema).default([]),  // Named system prompts array
  defaultImageId: UUIDSchema.nullable().optional(),
  defaultConnectionProfileId: UUIDSchema.nullable().optional(),
  defaultPartnerId: UUIDSchema.nullable().optional(),  // Default user-controlled character to pair with when chatting
  defaultRoleplayTemplateId: UUIDSchema.nullable().optional(),  // Default roleplay template for this character
  defaultImageProfileId: UUIDSchema.nullable().optional(),  // Default image generation profile for this character
  sillyTavernData: JsonSchema.nullable().optional(),
  /**
   * The character's fact sheet: a flat object of user-authored keys with any
   * JSON value — `{ "hasAnsibleAccess": true, "clearanceLevel": 3 }`. Lives in
   * the vault as `metadata.json`, which is its sole source of truth (no DB
   * column). Hydration always yields at least `{}` for a vault-linked
   * character, so `character.metadata?.["key"]` needs no null gymnastics;
   * null/undefined and `{}` mean the same thing to a reader.
   *
   * Driven user-side and user-side only. It is never injected into a prompt,
   * and no generation system (create-character, summon-from-lore, the
   * optimizer) may invent or populate it. Its consumer is Pascal: outcome
   * tables test `when.metadata.<key>`. A transparent character can read and
   * edit the file through the ordinary doc_* tools, like any vault document.
   */
  metadata: JsonSchema.nullable().optional(),
  isFavorite: z.boolean().default(false),
  npc: z.boolean().default(false),  // NPC flag - true for ad-hoc NPCs created in chat
  talkativeness: z.number().min(0.1).max(1.0).default(0.5),
  controlledBy: ControlledByEnum.default('llm'),  // Who controls this character: 'llm' (AI) or 'user' (player)

  /** Default agent mode enabled state for chats with this character (null = inherit from global) */
  defaultAgentModeEnabled: z.boolean().nullable().optional(),

  /** Default help tools enabled state for chats with this character (null = inherit from global, default disabled) */
  defaultHelpToolsEnabled: z.boolean().nullable().optional(),

  /** Default timestamp configuration for chats with this character (null = use global default / disabled) */
  defaultTimestampConfig: TimestampConfigSchema.nullable().optional(),

  /** Default scenario ID for chats with this character (null = no default scenario) */
  defaultScenarioId: UUIDSchema.nullable().optional(),

  /** Default system prompt ID for chats with this character (null = use first/isDefault prompt) */
  defaultSystemPromptId: UUIDSchema.nullable().optional(),

  /** Linked character document store (mountType='database', storeType='character'); null = not linked */
  characterDocumentMountPointId: UUIDSchema.nullable().optional(),

  /** Tombstone marker; when set the character is archived and should not accept writes. */
  archivedAt: TimestampSchema.nullable().optional(),
  /** Archive bundle file row for this character's tombstone export. */
  archiveFileId: UUIDSchema.nullable().optional(),
  /** Thumbnail copy of the archived avatar for tombstone rendering. */
  archivedAvatarFileId: UUIDSchema.nullable().optional(),

  /** Whether this character can change their own outfit using wardrobe tools (null = enabled by default) */
  canDressThemselves: z.boolean().nullable().optional(),

  /** Whether this character can create new wardrobe items mid-conversation (null = enabled by default, requires tool use) */
  canCreateOutfits: z.boolean().nullable().optional(),

  /**
   * When true, a new chat with this character defaults its Starting Outfit to
   * "Let character choose" — the character picks their opening outfit based on
   * the scenario rather than starting in their default wardrobe. Absent/false
   * means the new-chat dialog falls back to defaults (or Compose, when the
   * character has no usable default outfit). Lives in the vault's
   * `properties.json`, not a DB column.
   */
  canChooseOutfit: z.boolean().default(false),

  /**
   * When true, this character may inspect and access "the Staff" of personified
   * features — chat-level toggles for self_inventory, Staff messages
   * (Lantern/Aurora/Librarian/Prospero/Host announcements), and any character
   * vault (their own or peers') still apply. When null/false, the character
   * cannot see Staff messages, the self_inventory tool is withheld, and every
   * character vault (including their own) is hidden from doc_* tools — the
   * character-level setting is a hard override on top of chat/project settings.
   * Default: null (opaque).
   */
  systemTransparency: z.boolean().nullable().optional(),

  /**
   * Aurora Core whisper — per-character override of the global `coreWhisper.enabled`
   * setting. NULL = inherit from global default. When set, applies regardless
   * of per-chat override (chat → character → global precedence). The Core
   * whisper periodically re-offers this character's own `Core/` vault folder
   * before their next turn.
   */
  coreWhisperEnabled: z.boolean().nullable().optional(),

  /**
   * Carina (inline LLM queries) — when true, this character can be invoked as
   * an "answerer" via `@Name:` / `@Name?` markup or the `ask_carina` tool in any
   * chat, producing a minimal isolated reference answer (identity only, no chat
   * history, no memory) without joining the conversation. NULL/false = not an
   * answerer. The character need not be a participant in the chat that invokes
   * them.
   */
  canBeCarina: z.boolean().nullable().optional(),

  // Relationships
  partnerLinks: z.array(z.object({
    partnerId: UUIDSchema,
    isDefault: z.boolean(),
  })).default([]),
  aliases: z.array(z.string()).default([]),
  pronouns: PronounsSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  avatarOverrides: z.array(z.object({
    chatId: UUIDSchema,
    imageId: UUIDSchema,
  })).default([]),
  /**
   * The character's physical description plus token-sized prompt variants
   * (short / medium / long / complete) for image generation. Singular per
   * character — the data model was collapsed in the 4.6 vault cutover from
   * an array, since the vault only ever persisted index 0 and the
   * multi-description shape was a vestige rather than a feature. The vault
   * file shape (`physical-description.md` + `physical-prompts.json`) is
   * unchanged.
   */
  physicalDescription: PhysicalDescriptionSchema.nullable().optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Character = z.infer<typeof CharacterSchema>;

// Input type for creating characters - makes fields with defaults optional
export type CharacterInput = z.input<typeof CharacterSchema>;
