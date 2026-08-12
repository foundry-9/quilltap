/**
 * Self-Inventory Tool Definition
 *
 * Lets a character introspect their own configuration during a chat: the files
 * in their character vault, memory statistics, conversation statistics, the
 * static system prompt that goes into every turn, the memories that were
 * loaded into this turn's prompt, who has access to this character's vault
 * right now, and token usage from the most recent LLM call.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

export const SELF_INVENTORY_SECTIONS = [
  'vault',
  'vault.character',
  'vault.groups',
  'vaultAccess',
  'vaultAccess.character',
  'vaultAccess.groups',
  'memory',
  'loadedMemories',
  'chats',
  'prompt',
  'lastTurn',
  'carina',
  'quilltap',
  'quilltap.version',
  'quilltap.releaseNotes',
  'quilltap.changelog',
  'context',
  'context.chat',
  'context.project',
  'context.groups',
  'context.characters',
  'context.files',
] as const;

export type SelfInventorySection = typeof SELF_INVENTORY_SECTIONS[number];

export const QUILLTAP_SUB_SECTIONS = [
  'quilltap.version',
  'quilltap.releaseNotes',
  'quilltap.changelog',
] as const satisfies readonly SelfInventorySection[];

export type QuilltapSubSection = typeof QUILLTAP_SUB_SECTIONS[number];

export const VAULT_SUB_SECTIONS = [
  'vault.character',
  'vault.groups',
] as const satisfies readonly SelfInventorySection[];

export type VaultSubSection = typeof VAULT_SUB_SECTIONS[number];

export const VAULT_ACCESS_SUB_SECTIONS = [
  'vaultAccess.character',
  'vaultAccess.groups',
] as const satisfies readonly SelfInventorySection[];

export type VaultAccessSubSection = typeof VAULT_ACCESS_SUB_SECTIONS[number];

export const CONTEXT_SUB_SECTIONS = [
  'context.chat',
  'context.project',
  'context.groups',
  'context.characters',
  'context.files',
] as const satisfies readonly SelfInventorySection[];

export type ContextSubSection = typeof CONTEXT_SUB_SECTIONS[number];

/**
 * Zod schema for the self inventory tool's input.
 */
export const selfInventoryToolInputSchema = z.object({
  sections: z.array(
    z.enum(SELF_INVENTORY_SECTIONS)
      .describe(
        'Which section(s) to include. Options: ' +
        '"vault" (files in your own character vault AND your group vaults), with finer-grained dotted variants ' +
        '"vault.character" (just your own vault) and "vault.groups" (just the vaults of the groups you belong to); ' +
        '"vaultAccess" (who can read/write your character vault in this chat AND who can read/write your group vaults), ' +
        'with dotted variants "vaultAccess.character" (this chat only) and "vaultAccess.groups" (group members, in any chat); ' +
        '"memory" (total and high-importance memory counts), ' +
        '"loadedMemories" (memories actually loaded into this turn\'s prompt), ' +
        '"chats" (conversation count and date range), ' +
        '"prompt" (the static system prompt assembled for every turn), ' +
        '"lastTurn" (provider/model/token usage from the most recent LLM call), ' +
        '"carina" (whether you yourself are a Carina answerer, plus everyone you can reach via Carina — every other character if you are an answerer, with the ones who are also answerers noted; only the Carina answerers if you are not), ' +
        '"quilltap" (Quilltap version, runtime environment, client shell, release notes, and changelog — all three parts). ' +
        'For finer-grained quilltap queries, ask for one or more of the dotted sub-sections: ' +
        '"quilltap.version" (version + runtime + client shell only), ' +
        '"quilltap.releaseNotes" (release notes for the current or most recent release only), ' +
        '"quilltap.changelog" (the changelog only); ' +
        '"context" (where you are right now: this chat, the current project, your groups, the characters present with you, ' +
        'and the files attached to this chat with instructions for reaching each via the doc_* tools), with dotted variants ' +
        '"context.chat", "context.project", "context.groups", "context.characters", and "context.files".'
      )
  ).optional()
    .describe(
      'Optional list of section names to return. If omitted or empty, all top-level sections are returned ' +
      '(equivalent to passing "vault", "vaultAccess", "memory", "loadedMemories", "chats", "prompt", "lastTurn", "carina", "quilltap", "context"). ' +
      'Pass one or more section names to receive only those sections — useful for saving tokens when ' +
      'you only need specific information. The "quilltap.*", "vault.*", "vaultAccess.*", and "context.*" sub-sections let you ' +
      'fetch one piece of a section without pulling the rest (e.g. the changelog, which can be large).'
    ),
  includeAutomaticImages: z.boolean().optional()
    .describe(
      'When listing vault files (the "vault", "vault.character", or "vault.groups" sections), include auto-generated images ' +
      '— character avatars and story backgrounds. Defaults to false: these are hidden to keep the listing focused on ' +
      'authored content. OS junk files (.DS_Store, Thumbs.db, dot-files) are always hidden regardless of this flag.'
    ),
});

export type SelfInventoryToolInput = z.infer<typeof selfInventoryToolInputSchema>;

export interface SelfInventoryVaultFile {
  mountPointName: string;
  relativePath: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  lastModified: string;
  /** Canonical qtap:// URI for reaching this file. */
  uri?: string;
}

/** Which vault parts a `vault` request resolved to. Mirrors the quilltap pattern. */
export interface SelfInventoryVaultIncludedParts {
  character: boolean;
  groups: boolean;
}

/** The character's own vault (auto-generated files filtered out by default). */
export type SelfInventoryVaultCharacterSection =
  | {
      available: true;
      mountPointName: string;
      mountPointId: string;
      fileCount: number;
      files: SelfInventoryVaultFile[];
    }
  | {
      available: false;
      reason: 'no_vault' | 'mount_index_degraded' | 'error';
      message: string;
    };

/** One group's vault file listing (one entry per group store). */
export interface SelfInventoryVaultGroup {
  groupId: string;
  groupName: string;
  mountPointId: string;
  mountPointName: string;
  fileCount: number;
  files: SelfInventoryVaultFile[];
}

export type SelfInventoryVaultGroupsSection =
  | {
      available: true;
      groups: SelfInventoryVaultGroup[];
    }
  | {
      available: false;
      reason: 'no_groups' | 'mount_index_degraded' | 'error';
      message: string;
    };

/**
 * The `vault` section is a wrapper carrying whichever of the two parts the
 * caller asked for. Bare `vault` resolves both; `vault.character` /
 * `vault.groups` resolve just one.
 */
export interface SelfInventoryVaultSection {
  includedParts: SelfInventoryVaultIncludedParts;
  character?: SelfInventoryVaultCharacterSection;
  groups?: SelfInventoryVaultGroupsSection;
}

export interface SelfInventoryMemorySection {
  available: boolean;
  totalCount: number;
  highImportanceCount: number;
  highImportancePercent: number;
  threshold: 0.7;
  message?: string;
}

export interface SelfInventoryChatSection {
  available: boolean;
  chatCount: number;
  earliestCreatedAt: string | null;
  latestActivityAt: string | null;
  message?: string;
}

export interface SelfInventoryPromptSection {
  available: boolean;
  systemPrompt: string | null;
  characterCount: number;
  approxTokens: number | null;
  message?: string;
}

export interface SelfInventorySemanticMemoryItem {
  summary: string;
  importance: number;
  score: number;
  effectiveWeight: number;
}

export interface SelfInventoryInterCharacterMemoryItem {
  aboutCharacterName: string;
  summary: string;
  importance: number;
}

export type SelfInventoryLoadedMemoriesSection =
  | {
      available: true;
      semanticMemories: SelfInventorySemanticMemoryItem[];
      interCharacterMemories: SelfInventoryInterCharacterMemoryItem[];
      recap: string | null;
    }
  | {
      available: false;
      message: string;
    };

export type SelfInventoryVaultAccessLevel = 'read_write' | 'read_only';

export interface SelfInventoryVaultAccessParticipant {
  participantId: string;
  characterId: string;
  characterName: string;
  controlledBy: 'llm' | 'user';
  status: 'active' | 'silent' | 'absent' | 'removed';
  isSelf: boolean;
  access: SelfInventoryVaultAccessLevel;
}

/** Who can read/write the character's own vault in THIS chat. */
export type SelfInventoryVaultAccessCharacterSection =
  | {
      available: true;
      mountPointName: string;
      sharedVaultsEnabled: boolean;
      participants: SelfInventoryVaultAccessParticipant[];
    }
  | {
      available: false;
      sharedVaultsEnabled: boolean;
      message: string;
    };

/** A member of a group the character belongs to; all members read/write the group vault. */
export interface SelfInventoryGroupVaultMember {
  characterId: string;
  characterName: string;
  isSelf: boolean;
  access: 'read_write';
}

/** Who can read/write one group's vault. Membership-based; chat-independent. */
export interface SelfInventoryGroupVaultAccess {
  groupId: string;
  groupName: string;
  members: SelfInventoryGroupVaultMember[];
}

export type SelfInventoryVaultAccessGroupsSection =
  | {
      available: true;
      groups: SelfInventoryGroupVaultAccess[];
    }
  | {
      available: false;
      reason: 'no_groups' | 'error';
      message: string;
    };

/**
 * The `vaultAccess` section is a wrapper carrying whichever parts the caller
 * asked for. Bare `vaultAccess` resolves both; the dotted variants resolve one.
 */
export interface SelfInventoryVaultAccessSection {
  includedParts: SelfInventoryVaultIncludedParts;
  character?: SelfInventoryVaultAccessCharacterSection;
  groups?: SelfInventoryVaultAccessGroupsSection;
}

export type SelfInventoryLastTurnSource = 'llm_log' | 'profile_fallback';

export type SelfInventoryRuntimeMode =
  | 'local-dev'
  | 'local-production'
  | 'docker'
  | 'vm'
  | 'electron'
  | 'electron-docker'
  | 'electron-vm';

export type SelfInventoryClientShell =
  | { type: 'electron'; shellVersion: string }
  | { type: 'browser' }
  | { type: 'unknown' };

export interface SelfInventoryQuilltapIncludedParts {
  version: boolean;
  releaseNotes: boolean;
  changelog: boolean;
}

export interface SelfInventoryQuilltapSection {
  available: boolean;
  /**
   * Which sub-parts the caller asked for. The formatter only renders the
   * parts flagged true, so a request for just `quilltap.changelog` doesn't
   * print version or "(no release notes found)" boilerplate.
   */
  includedParts: SelfInventoryQuilltapIncludedParts;
  version: string;
  runtimeMode: SelfInventoryRuntimeMode;
  clientShell: SelfInventoryClientShell;
  releaseNotes: string | null;
  releaseNotesVersion: string | null;
  changelog: string | null;
  message?: string;
}

export interface SelfInventoryLastTurnSection {
  available: boolean;
  source: SelfInventoryLastTurnSource | null;
  provider: string | null;
  modelName: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  contextWindow: number | null;
  utilizationPercent: number | null;
  loggedAt: string | null;
  message?: string;
}

/** One character this character can reach via Carina. */
export interface SelfInventoryCarinaReachable {
  /** The reachable character's name. */
  name: string;
  /** Whether they are themselves a Carina answerer (`canBeCarina === true`). */
  isAnswerer: boolean;
}

/**
 * Carina (inline LLM queries): whether this character may answer `@Name:` /
 * `@Name?` queries and `ask_carina` calls, plus everyone this character can
 * reach via Carina. A line opens when EITHER side is `canBeCarina`, so:
 *  - when `selfEnabled`, `reachable` lists EVERY other character (an enabled
 *    asker can reach anyone), each flagged `isAnswerer` if they are also an
 *    answerer themselves;
 *  - when not enabled, `reachable` lists ONLY the Carina answerers — the only
 *    characters this one can reach (the answerer side opens the line).
 * `canBeCarina` is a DB column (not a vault field), so this is resolved from the
 * overlay-free raw character read.
 */
export type SelfInventoryCarinaSection =
  | {
      available: true;
      /** Whether THIS character is a Carina answerer (`canBeCarina === true`). */
      selfEnabled: boolean;
      /**
       * Characters this character can reach via Carina, sorted by name, excluding
       * self. Everyone when `selfEnabled`; only the answerers otherwise.
       */
      reachable: SelfInventoryCarinaReachable[];
    }
  | {
      available: false;
      message: string;
    };

// ============================================================================
// CONTEXT SECTION — where the character is right now
// ============================================================================

/** A document store reachable from a project or group. */
export interface SelfInventoryContextMount {
  mountPointId: string;
  name: string;
}

export interface SelfInventoryContextChat {
  available: boolean;
  chatId: string;
  title: string | null;
  message?: string;
}

export type SelfInventoryContextProject =
  | { available: true; present: true; id: string; name: string; mountPoints: SelfInventoryContextMount[] }
  | { available: true; present: false }
  | { available: false; message: string };

export interface SelfInventoryContextGroup {
  id: string;
  name: string;
  mountPoints: SelfInventoryContextMount[];
}

export type SelfInventoryContextGroups =
  | { available: true; groups: SelfInventoryContextGroup[] }
  | { available: false; message: string };

export interface SelfInventoryContextCharacter {
  id: string;
  name: string;
  aliases: string[];
  identity: string | null;
  /** True for the human user's controlled persona character. */
  isUserPersona: boolean;
}

export type SelfInventoryContextCharacters =
  | { available: true; characters: SelfInventoryContextCharacter[] }
  | { available: false; message: string };

export interface SelfInventoryContextFile {
  scope: 'project' | 'document_store' | 'general';
  mountPoint: string | null;
  filePath: string;
  displayTitle: string | null;
  /** Canonical qtap:// URI for reaching this file. */
  uri: string;
  /** A copy-pasteable doc_read_file(...) invocation for reaching this file. */
  howToReach: string;
}

export type SelfInventoryContextFiles =
  | { available: true; files: SelfInventoryContextFile[] }
  | { available: false; message: string };

/** Which context parts a `context` request resolved to. */
export interface SelfInventoryContextIncludedParts {
  chat: boolean;
  project: boolean;
  groups: boolean;
  characters: boolean;
  files: boolean;
}

/**
 * The `context` section is a wrapper carrying whichever parts the caller asked
 * for. Bare `context` resolves all five; the dotted variants resolve a subset.
 */
export interface SelfInventoryContextSection {
  includedParts: SelfInventoryContextIncludedParts;
  chat?: SelfInventoryContextChat;
  project?: SelfInventoryContextProject;
  groups?: SelfInventoryContextGroups;
  characters?: SelfInventoryContextCharacters;
  files?: SelfInventoryContextFiles;
}

export interface SelfInventoryToolOutput {
  success: boolean;
  quilltapVersion: string;
  characterId: string;
  characterName: string;
  vault?: SelfInventoryVaultSection;
  vaultAccess?: SelfInventoryVaultAccessSection;
  memory?: SelfInventoryMemorySection;
  loadedMemories?: SelfInventoryLoadedMemoriesSection;
  chats?: SelfInventoryChatSection;
  prompt?: SelfInventoryPromptSection;
  lastTurn?: SelfInventoryLastTurnSection;
  carina?: SelfInventoryCarinaSection;
  quilltap?: SelfInventoryQuilltapSection;
  context?: SelfInventoryContextSection;
  error?: string;
}

export const selfInventoryToolDefinition = {
  type: 'function',
  function: {
    name: 'self_inventory',
    description:
      'Return an introspection report about yourself in this chat. Ten top-level sections are available: ' +
      '"vault" (every file in your own character vault AND the vaults of the groups you belong to, with metadata for ' +
      'doc_read_file; auto-generated avatars/backgrounds are hidden unless includeAutomaticImages is true) — request just ' +
      '"vault.character" or "vault.groups" for one half; ' +
      '"vaultAccess" (who can read or write your character vault in this chat, plus who can read/write your group vaults) — ' +
      'request "vaultAccess.character" (this chat) or "vaultAccess.groups" (group members, regardless of chat) for one half; ' +
      '"memory" (total and high-importance memory counts), ' +
      '"loadedMemories" (the actual memories loaded into this turn\'s prompt), ' +
      '"chats" (conversation count and date range), ' +
      '"prompt" (the static system prompt assembled for every turn), ' +
      '"lastTurn" (provider/model/token usage from the most recent LLM call), ' +
      '"carina" (whether you are a Carina answerer for inline @-queries, plus everyone you can reach via Carina — because a line opens when either side is an answerer, this is every other character when you are an answerer (the ones who are also answerers are noted), or only the Carina answerers when you are not), ' +
      '"quilltap" (Quilltap version, runtime environment, client shell, release notes for the current or most recent ' +
      'release, and the current changelog — all three parts). The "quilltap" section can also be requested in three ' +
      'finer-grained pieces: "quilltap.version" (version + runtime + client shell only), "quilltap.releaseNotes" ' +
      '(release notes only), and "quilltap.changelog" (changelog only) — use these to save tokens when the changelog ' +
      'is large and you only need part of the Quilltap section. ' +
      '"context" tells you where you are right now: this chat (id and name), the current project (id, name, linked stores), ' +
      'your groups (ids, names, linked stores), the other characters present with you (names, aliases, identities), and the ' +
      'files attached to this chat with a copy-pasteable doc_read_file(...) call for each — request "context.chat", ' +
      '"context.project", "context.groups", "context.characters", or "context.files" for one part. ' +
      'Pass a "sections" array to request only specific sections; omit it to receive all ten top-level sections. ' +
      'Use this when you need to know what source material you have access to, who is around you, how you are currently ' +
      'configured, or how close the last turn was to the context window limit.',
    parameters: zodToOpenAISchema(selfInventoryToolInputSchema),
  },
};

export function validateSelfInventoryInput(
  input: unknown
): SelfInventoryToolInput | null {
  const parsed = selfInventoryToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
