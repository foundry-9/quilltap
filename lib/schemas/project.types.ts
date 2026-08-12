/**
 * Project Type Definitions
 *
 * Contains schemas for projects that organize files, chats,
 * and provide scoped context for AI conversations.
 *
 * @module schemas/project.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  HexColorSchema,
  JsonSchema,
} from './common.types';

// ============================================================================
// PROJECT
//
// As of the project-store cutover (`cutover-projects-to-store-v1`), a project's
// substantive content no longer lives in `projects` columns. The DB row is the
// slim `ProjectRowSchema` (id/name/officialMountPointId/timestamps); everything
// else lives in the project's official document store as files:
//   - description  → description.md
//   - instructions → instructions.md
//   - state        → state.json
//   - the settings bag (ProjectPropertiesSchema) → properties.json
//
// `ProjectSchema` below is the *hydrated*, app-facing shape — the read overlay
// (`lib/projects/project-store/read-overlay.ts`) re-assembles it from the slim
// row plus the store files so existing call sites keep reading
// `project.defaultImageProfileId` etc. unchanged. Only persistence moved.
// ============================================================================

/**
 * The "everything else" bag persisted as `properties.json` in the project's
 * official document store. All fields optional/defaulted so a partial or absent
 * file still parses. Mirrors the settings fields that used to be columns.
 */
export const ProjectPropertiesSchema = z.object({
  // Character access control
  allowAnyCharacter: z.boolean().default(false), // When true, any character can participate
  characterRoster: z.array(UUIDSchema).default([]), // Explicit character list (when allowAnyCharacter is false)

  // Display customization
  color: HexColorSchema.nullable().optional(), // Accent color for sidebar/UI
  icon: z.string().max(50).nullable().optional(), // Icon identifier (emoji or icon name)

  // Default tool settings for new chats
  /** Default list of tool IDs that are disabled for new chats in this project */
  defaultDisabledTools: z.array(z.string()).default([]),
  /** Default groups of tools that are disabled (e.g., "plugin:mcp") */
  defaultDisabledToolGroups: z.array(z.string()).default([]),

  /** Default agent mode enabled state for chats in this project (null = inherit from character or global) */
  defaultAgentModeEnabled: z.boolean().nullable().optional(),

  /** Default avatar generation enabled state for chats in this project (null = disabled) */
  defaultAvatarGenerationEnabled: z.boolean().nullable().optional(),

  /** Default image generation profile for new chats in this project (null = inherit from character or global) */
  defaultImageProfileId: UUIDSchema.nullable().optional(),

  /** Default roleplay template for new chats in this project (null = inherit from global) */
  defaultRoleplayTemplateId: UUIDSchema.nullable().optional(),

  /** When an image is generated (Lantern background, avatar, or character-invoked), inject an assistant message announcing it to characters (null = inherit from global, default false) */
  defaultAlertCharactersOfLanternImages: z.boolean().nullable().optional(),

  /**
   * Per-project answer-confirmation override for chats in this project.
   * 'ON' = force the consistency check on for the project's chats; 'OFF' =
   * force it off; null/undefined = inherit the global setting. A chat's own
   * `answerConfirmationOverride` still wins over this. See
   * `isAnswerConfirmationActive`.
   */
  answerConfirmationOverride: z.enum(['ON', 'OFF']).nullable().optional(),

  // Story backgrounds
  /** Whether story backgrounds are enabled for this project (null = inherit from global, true/false = override) */
  storyBackgroundsEnabled: z.boolean().nullable().optional(),
  /** Static background image file ID (user-selected, not AI-generated) */
  staticBackgroundImageId: UUIDSchema.nullable().optional(),
  /** AI-generated story background image file ID for the project */
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  /** How to display backgrounds: 'latest_chat' = from most recent chat, 'project' = project-level generated, 'static' = user-uploaded, 'theme' = default theme */
  backgroundDisplayMode: z.enum(['latest_chat', 'project', 'static', 'theme']).default('theme'),
});

export type ProjectProperties = z.infer<typeof ProjectPropertiesSchema>;

/**
 * The slim DB row — the only thing persisted as `projects` columns after the
 * cutover. A composition building block for `ProjectSchema`; the repository
 * validates the full hydrated schema and strips the store-resident fields
 * (`PROJECT_STORE_MANAGED_FIELDS`) before writing the row.
 */
export const ProjectRowSchema = z.object({
  id: UUIDSchema,

  // The one content field that stays a real column.
  name: z.string().min(1).max(100),

  /**
   * The project's canonical "project-official" document store, used by the Files tab,
   * the project_info / project-store-bridge write paths, and the per-project Scenarios
   * folder. Backfilled from the legacy `Project Files: <name>` name-prefix convention
   * by the v4.10 migration; auto-populated for new projects at creation time and on
   * startup. Null only briefly during transitions (creation-internal only — any *read*
   * observing null is a bug). Reads block (throw/drop) when it is null or unreadable.
   */
  officialMountPointId: UUIDSchema.nullable().optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ProjectRow = z.infer<typeof ProjectRowSchema>;

export const ProjectSchema = ProjectRowSchema.extend({
  // Core content (store-resident: description.md / instructions.md / state.json)
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(), // System prompt for project chats
  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  // Settings bag (store-resident: properties.json)
  ...ProjectPropertiesSchema.shape,
});

export type Project = z.infer<typeof ProjectSchema>;

// Input type for creating projects - makes fields with defaults optional
export type ProjectInput = z.input<typeof ProjectSchema>;

/**
 * Top-level Project keys whose persistence is routed to the official document
 * store rather than to DB columns. The repository strips these from the row
 * before INSERT/UPDATE; the read overlay re-populates them from the store
 * files. Mirrors `MANAGED_FIELDS` in the character vault overlay.
 *
 * `officialMountPointId` and `name` are intentionally absent — they stay real
 * columns. `userId` is absent because it is dropped entirely by the cutover.
 */
export const PROJECT_STORE_MANAGED_FIELDS: ReadonlySet<keyof Project> = new Set<keyof Project>([
  // description.md / instructions.md / state.json
  'description',
  'instructions',
  'state',
  // properties.json
  'allowAnyCharacter',
  'characterRoster',
  'color',
  'icon',
  'defaultDisabledTools',
  'defaultDisabledToolGroups',
  'defaultAgentModeEnabled',
  'defaultAvatarGenerationEnabled',
  'defaultImageProfileId',
  'defaultRoleplayTemplateId',
  'defaultAlertCharactersOfLanternImages',
  'answerConfirmationOverride',
  'storyBackgroundsEnabled',
  'staticBackgroundImageId',
  'storyBackgroundImageId',
  'backgroundDisplayMode',
]);

// Background display mode type
export const BackgroundDisplayModeEnum = z.enum(['latest_chat', 'project', 'static', 'theme']);
export type BackgroundDisplayMode = z.infer<typeof BackgroundDisplayModeEnum>;

// ============================================================================
// PROJECT CONTEXT (for system prompt injection)
// ============================================================================

export const ProjectContextSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

export type ProjectContext = z.infer<typeof ProjectContextSchema>;
