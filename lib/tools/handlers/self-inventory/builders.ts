/**
 * Self-Inventory — section builders (the GATHER half).
 *
 * Each `build*Section` collects one slice of the introspection report into a
 * structured `SelfInventory*Section` object; the `resolve*IncludedParts` helpers
 * decide which sub-parts a request asks for. Rendering those objects to markdown
 * is `formatters.ts`'s job — nothing here touches presentation. The orchestrator
 * in `../self-inventory-handler.ts` wires the two together.
 */

import fs from 'fs';
import path from 'path';
import packageJson from '@/package.json';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { buildSystemPrompt, buildOtherParticipantsInfo, type OtherParticipantInfo } from '@/lib/chat/context/system-prompt-builder';
import { resolveConnectionProfile } from '@/lib/chat/connection-resolver';
import { getModelContextLimit } from '@/lib/llm/model-context-data';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import type { Character, ChatParticipantBase } from '@/lib/schemas/types';
import type { LoadedMemoriesContext } from '@/lib/chat/tool-executor';
import { formatSelfUri, formatScopedUri, formatDocStoreUri } from '@/lib/doc-edit/qtap-uri';
import { isDockerEnvironment, isElectronShell, isLimaEnvironment, getElectronShellVersion } from '@/lib/paths';
import { isDevelopment } from '@/lib/env';
import type { SelfInventoryVaultSection, SelfInventoryVaultCharacterSection, SelfInventoryVaultGroupsSection, SelfInventoryVaultGroup, SelfInventoryVaultIncludedParts, SelfInventoryVaultAccessSection, SelfInventoryVaultAccessCharacterSection, SelfInventoryVaultAccessGroupsSection, SelfInventoryGroupVaultAccess, SelfInventoryGroupVaultMember, SelfInventoryVaultAccessParticipant, SelfInventoryVaultAccessLevel, SelfInventoryMemorySection, SelfInventoryLoadedMemoriesSection, SelfInventoryChatSection, SelfInventoryPromptSection, SelfInventoryLastTurnSection, SelfInventoryCarinaSection, SelfInventoryQuilltapSection, SelfInventoryQuilltapIncludedParts, SelfInventoryRuntimeMode, SelfInventoryClientShell, SelfInventoryContextSection, SelfInventoryContextIncludedParts, SelfInventoryContextChat, SelfInventoryContextProject, SelfInventoryContextGroups, SelfInventoryContextGroup, SelfInventoryContextCharacters, SelfInventoryContextCharacter, SelfInventoryContextFiles, SelfInventoryContextFile, SelfInventoryContextMount, SelfInventorySection } from '../../self-inventory-tool';
import { getErrorMessage, roundPercent, mapVaultFiles, HIGH_IMPORTANCE_THRESHOLD, type SelfInventoryToolContext } from './helpers';

async function buildVaultCharacterSection(
  character: Character,
  includeAutomaticImages: boolean
): Promise<SelfInventoryVaultCharacterSection> {
  if (isMountIndexDegraded()) {
    return {
      available: false,
      reason: 'mount_index_degraded',
      message: 'Mount index database is in degraded mode.',
    };
  }

  const mountPointId = character.characterDocumentMountPointId;
  if (!mountPointId) {
    return {
      available: false,
      reason: 'no_vault',
      message: 'Character has no vault mount point.',
    };
  }

  const repos = getRepositories();
  const mountPoint = await repos.docMountPoints.findById(mountPointId);
  if (!mountPoint) {
    return {
      available: false,
      reason: 'no_vault',
      message: `Mount point ${mountPointId} not found.`,
    };
  }

  const rows = await repos.docMountFiles.findByMountPointId(mountPointId);
  // The character's own vault → the stable, readable self form.
  const files = mapVaultFiles(rows, mountPoint.name, includeAutomaticImages, true, (rel) =>
    formatSelfUri(rel)
  );

  return {
    available: true,
    mountPointName: mountPoint.name,
    mountPointId: mountPoint.id,
    fileCount: files.length,
    files,
  };
}

/** A group the calling character belongs to, with its resolved store ids. */
interface ResolvedGroup {
  groupId: string;
  groupName: string;
  /** Official store + any linked stores, de-duplicated. */
  mountPointIds: string[];
}

/**
 * Resolve the groups the character belongs to and each group's document
 * stores. Shared by `vault.groups`, `vaultAccess.groups`, and `context.groups`.
 * A group whose store is unavailable (throws) is skipped, not fatal.
 */
async function resolveMyGroups(characterId: string): Promise<ResolvedGroup[]> {
  const repos = getRepositories();
  const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId);
  const resolved: ResolvedGroup[] = [];

  for (const membership of memberships) {
    let group;
    try {
      group = await repos.groups.findById(membership.groupId);
    } catch (err) {
      logger.debug('self_inventory: skipping group with unavailable store', {
        context: 'self-inventory-handler',
        groupId: membership.groupId,
        error: getErrorMessage(err),
      });
      continue;
    }
    if (!group) continue;

    const mountPointIds = new Set<string>();
    if (group.officialMountPointId) mountPointIds.add(group.officialMountPointId);
    const links = await repos.groupDocMountLinks.findByGroupId(membership.groupId);
    for (const link of links) mountPointIds.add(link.mountPointId);

    resolved.push({
      groupId: group.id,
      groupName: group.name,
      mountPointIds: [...mountPointIds],
    });
  }

  resolved.sort((a, b) => a.groupName.localeCompare(b.groupName));
  return resolved;
}

async function buildVaultGroupsSection(
  characterId: string,
  includeAutomaticImages: boolean
): Promise<SelfInventoryVaultGroupsSection> {
  if (isMountIndexDegraded()) {
    return {
      available: false,
      reason: 'mount_index_degraded',
      message: 'Mount index database is in degraded mode.',
    };
  }

  const repos = getRepositories();
  const groups = await resolveMyGroups(characterId);
  if (groups.length === 0) {
    return {
      available: false,
      reason: 'no_groups',
      message: 'You are not a member of any groups.',
    };
  }

  const out: SelfInventoryVaultGroup[] = [];
  for (const group of groups) {
    for (const mountPointId of group.mountPointIds) {
      const mountPoint = await repos.docMountPoints.findById(mountPointId);
      if (!mountPoint) continue;
      const rows = await repos.docMountFiles.findByMountPointId(mountPointId);
      // A group store, not the acting character's own vault → address by name.
      const files = mapVaultFiles(rows, mountPoint.name, includeAutomaticImages, false, (rel) =>
        formatDocStoreUri({ mountPointName: mountPoint.name, mountPointId: mountPoint.id, path: rel })
      );
      out.push({
        groupId: group.groupId,
        groupName: group.groupName,
        mountPointId: mountPoint.id,
        mountPointName: mountPoint.name,
        fileCount: files.length,
        files,
      });
    }
  }

  return { available: true, groups: out };
}

async function buildVaultAccessGroupsSection(
  characterId: string
): Promise<SelfInventoryVaultAccessGroupsSection> {
  const repos = getRepositories();
  const groups = await resolveMyGroups(characterId);
  if (groups.length === 0) {
    return {
      available: false,
      reason: 'no_groups',
      message: 'You are not a member of any groups.',
    };
  }

  const out: SelfInventoryGroupVaultAccess[] = [];
  for (const group of groups) {
    const members = await repos.groupCharacterMembers.findByGroupId(group.groupId);
    const memberInfos: SelfInventoryGroupVaultMember[] = [];
    const seen = new Set<string>();

    for (const member of members) {
      if (seen.has(member.characterId)) continue;
      seen.add(member.characterId);

      let characterName = 'Unknown';
      try {
        const c = await repos.characters.findById(member.characterId);
        if (c) characterName = c.name;
      } catch {
        // Member's vault is broken — still list them by id, name unknown.
      }

      memberInfos.push({
        characterId: member.characterId,
        characterName,
        isSelf: member.characterId === characterId,
        access: 'read_write',
      });
    }

    memberInfos.sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.characterName.localeCompare(b.characterName);
    });

    out.push({ groupId: group.groupId, groupName: group.groupName, members: memberInfos });
  }

  return { available: true, groups: out };
}

async function buildVaultAccessCharacterSection(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryVaultAccessCharacterSection> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(context.chatId);
  const sharedVaultsEnabled = Boolean(chat?.allowCrossCharacterVaultReads);

  if (!character.characterDocumentMountPointId) {
    return {
      available: false,
      sharedVaultsEnabled,
      message: 'Character has no vault mount point.',
    };
  }
  if (!chat) {
    return {
      available: false,
      sharedVaultsEnabled,
      message: 'Chat not found.',
    };
  }

  const mountPoint = await repos.docMountPoints.findById(character.characterDocumentMountPointId);
  if (!mountPoint) {
    return {
      available: false,
      sharedVaultsEnabled,
      message: `Mount point ${character.characterDocumentMountPointId} not found.`,
    };
  }

  const participants: SelfInventoryVaultAccessParticipant[] = [];
  const seenCharacterIds = new Set<string>();

  for (const p of chat.participants) {
    if (p.type !== 'CHARACTER') continue;
    if (!p.characterId) continue;
    if (!isParticipantPresent(p.status)) continue;
    if (seenCharacterIds.has(p.characterId)) continue;
    seenCharacterIds.add(p.characterId);

    const isSelf = p.characterId === character.id;
    const isUser = p.controlledBy === 'user';

    // Self and the user persona always have read/write; the user reaches peer
    // vaults via document mode even when tool-level cross-character reads are
    // off. Other peer characters only get read access when shared vaults is on.
    let access: SelfInventoryVaultAccessLevel | null = null;
    if (isSelf || isUser) {
      access = 'read_write';
    } else if (sharedVaultsEnabled) {
      access = 'read_only';
    }
    if (!access) continue;

    let characterName = 'Unknown';
    const c = await repos.characters.findById(p.characterId);
    if (c) characterName = c.name;

    participants.push({
      participantId: p.id,
      characterId: p.characterId,
      characterName,
      controlledBy: p.controlledBy,
      status: p.status,
      isSelf,
      access,
    });
  }

  // Sort: self first, then user persona, then others alphabetically.
  participants.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const aUser = a.controlledBy === 'user' ? 0 : 1;
    const bUser = b.controlledBy === 'user' ? 0 : 1;
    if (aUser !== bUser) return aUser - bUser;
    return a.characterName.localeCompare(b.characterName);
  });

  return {
    available: true,
    mountPointName: mountPoint.name,
    sharedVaultsEnabled,
    participants,
  };
}

export function buildLoadedMemoriesSection(
  loaded: LoadedMemoriesContext | undefined
): SelfInventoryLoadedMemoriesSection {
  if (!loaded) {
    return {
      available: false,
      message: 'No loaded-memory data available for this turn (tool was invoked outside of a prompt-building flow).',
    };
  }
  return {
    available: true,
    semanticMemories: (loaded.semantic ?? []).map((m) => ({
      summary: m.summary,
      importance: m.importance,
      score: m.score,
      effectiveWeight: m.effectiveWeight,
    })),
    interCharacterMemories: (loaded.interCharacter ?? []).map((m) => ({
      aboutCharacterName: m.aboutCharacterName,
      summary: m.summary,
      importance: m.importance,
    })),
    recap: loaded.recap ?? null,
  };
}

export async function buildMemorySection(
  characterId: string
): Promise<SelfInventoryMemorySection> {
  const repos = getRepositories();
  const totalCount = await repos.memories.countByCharacterId(characterId);
  const highMemories = await repos.memories.findByImportance(
    characterId,
    HIGH_IMPORTANCE_THRESHOLD
  );
  const highImportanceCount = highMemories.length;
  const highImportancePercent =
    totalCount === 0 ? 0 : roundPercent((highImportanceCount / totalCount) * 100);

  return {
    available: true,
    totalCount,
    highImportanceCount,
    highImportancePercent,
    threshold: HIGH_IMPORTANCE_THRESHOLD,
  };
}

export async function buildChatsSection(
  characterId: string
): Promise<SelfInventoryChatSection> {
  const repos = getRepositories();
  const chats = await repos.chats.findByCharacterId(characterId);
  if (chats.length === 0) {
    return {
      available: true,
      chatCount: 0,
      earliestCreatedAt: null,
      latestActivityAt: null,
    };
  }

  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let earliestIso: string | null = null;
  let latestIso: string | null = null;

  for (const chat of chats) {
    const createdMs = Date.parse(chat.createdAt);
    if (Number.isFinite(createdMs) && createdMs < earliestMs) {
      earliestMs = createdMs;
      earliestIso = chat.createdAt;
    }

    const activityIso =
      chat.lastMessageAt ?? chat.updatedAt ?? chat.createdAt;
    const activityMs = Date.parse(activityIso);
    if (Number.isFinite(activityMs) && activityMs > latestMs) {
      latestMs = activityMs;
      latestIso = activityIso;
    }
  }

  return {
    available: true,
    chatCount: chats.length,
    earliestCreatedAt: earliestIso,
    latestActivityAt: latestIso,
  };
}

interface ResolvedRespondingContext {
  respondingParticipant: ChatParticipantBase;
  otherParticipants: OtherParticipantInfo[] | undefined;
  userCharacter: { name: string; description: string } | null;
}

async function resolveRespondingContext(
  chat: { participants: ChatParticipantBase[] },
  context: SelfInventoryToolContext
): Promise<ResolvedRespondingContext | null> {
  const repos = getRepositories();

  const respondingParticipant =
    chat.participants.find((p) => p.id === context.callingParticipantId) ??
    chat.participants.find(
      (p) =>
        p.type === 'CHARACTER' &&
        p.characterId === context.characterId &&
        p.controlledBy !== 'user'
    ) ??
    chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === context.characterId
    );

  if (!respondingParticipant) {
    return null;
  }

  // User persona: a CHARACTER participant that is controlled by the user.
  let userCharacter: { name: string; description: string } | null = null;
  const userParticipant = chat.participants.find(
    (p) => p.type === 'CHARACTER' && p.controlledBy === 'user'
  );
  if (userParticipant?.characterId) {
    const uc = await repos.characters.findById(userParticipant.characterId);
    if (uc) {
      userCharacter = {
        name: uc.name,
        description: uc.description ?? '',
      };
    }
  }

  // Other participants for multi-character chats.
  let otherParticipants: OtherParticipantInfo[] | undefined;
  const otherCharacterParticipants = chat.participants.filter(
    (p) =>
      p.type === 'CHARACTER' &&
      p.id !== respondingParticipant.id &&
      p.controlledBy !== 'user'
  );
  if (otherCharacterParticipants.length > 0) {
    const characterMap = new Map<string, Character>();
    for (const p of otherCharacterParticipants) {
      if (!p.characterId) continue;
      const c = await repos.characters.findById(p.characterId);
      if (c) {
        characterMap.set(p.characterId, c);
      }
    }
    otherParticipants = buildOtherParticipantsInfo(
      respondingParticipant.id,
      chat.participants,
      characterMap
    );
    if (otherParticipants.length === 0) {
      otherParticipants = undefined;
    }
  }

  return { respondingParticipant, otherParticipants, userCharacter };
}

export async function buildPromptSection(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryPromptSection> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(context.chatId);
  if (!chat) {
    return {
      available: false,
      systemPrompt: null,
      characterCount: 0,
      approxTokens: null,
      message: 'Chat not found.',
    };
  }

  const resolved = await resolveRespondingContext(chat, context);
  if (!resolved) {
    return {
      available: false,
      systemPrompt: null,
      characterCount: 0,
      approxTokens: null,
      message: 'Responding participant not found for character in this chat.',
    };
  }

  const { respondingParticipant, userCharacter } = resolved;

  let roleplayTemplate: { systemPrompt: string } | null = null;
  if (chat.roleplayTemplateId) {
    try {
      const tpl = await repos.roleplayTemplates.findById(chat.roleplayTemplateId);
      if (tpl && typeof (tpl as { systemPrompt?: unknown }).systemPrompt === 'string') {
        roleplayTemplate = { systemPrompt: (tpl as { systemPrompt: string }).systemPrompt };
      }
    } catch (err) {
    }
  }

  // Deliberately omits `tabooPhrases`: this is introspection, not a live turn,
  // and the async instance-settings read isn't worth threading through for a
  // reporting path. The reconstructed prompt is therefore missing the Taboo
  // section a real turn would carry — a known, accepted fidelity gap.
  const systemPrompt = buildSystemPrompt({
    character,
    userCharacter,
    roleplayTemplate,
    selectedSystemPromptId: respondingParticipant.selectedSystemPromptId ?? null,
    timestampConfig: chat.timestampConfig ?? null,
    isInitialMessage: false,
    scenarioText: chat.scenarioText ?? null,
  });

  const characterCount = systemPrompt.length;
  const approxTokens = Math.round(characterCount / 4);

  return {
    available: true,
    systemPrompt,
    characterCount,
    approxTokens,
  };
}

export async function buildLastTurnSection(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryLastTurnSection> {
  const repos = getRepositories();
  const logs = await repos.llmLogs.findByChatId(context.chatId);
  const lastLog = logs[0];

  if (lastLog) {
    const provider = lastLog.provider;
    const modelName = lastLog.modelName;
    const usage = lastLog.usage ?? null;
    const promptTokens = usage?.promptTokens ?? null;
    const completionTokens = usage?.completionTokens ?? null;
    const totalTokens = usage?.totalTokens ?? null;

    let contextWindow: number | null = null;
    try {
      contextWindow = getModelContextLimit(provider, modelName);
    } catch (err) {
    }

    const utilizationPercent =
      totalTokens !== null && contextWindow && contextWindow > 0
        ? roundPercent((totalTokens / contextWindow) * 100)
        : null;

    return {
      available: true,
      source: 'llm_log',
      provider,
      modelName,
      promptTokens,
      completionTokens,
      totalTokens,
      contextWindow,
      utilizationPercent,
      loggedAt: lastLog.createdAt,
    };
  }

  // Fallback: resolve the profile that *would* run and report its shape.
  const chat = await repos.chats.findById(context.chatId);
  if (!chat) {
    return {
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: 'Chat not found.',
    };
  }

  const participant =
    chat.participants.find((p) => p.id === context.callingParticipantId) ??
    chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === context.characterId
    );
  if (!participant) {
    return {
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: 'No LLM log and responding participant not found.',
    };
  }

  try {
    const profileId = resolveConnectionProfile(participant, character);
    const profile = await repos.connections.findById(profileId);
    if (!profile) {
      return {
        available: false,
        source: null,
        provider: null,
        modelName: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        contextWindow: null,
        utilizationPercent: null,
        loggedAt: null,
        message: `No LLM log and connection profile ${profileId} not found.`,
      };
    }

    const contextWindow =
      profile.maxContext ?? getModelContextLimit(profile.provider, profile.modelName);

    return {
      available: true,
      source: 'profile_fallback',
      provider: profile.provider,
      modelName: profile.modelName,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      contextWindow,
      utilizationPercent: 0,
      loggedAt: null,
    };
  } catch (err) {
    return {
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: `No LLM log and profile resolution failed: ${getErrorMessage(err)}`,
    };
  }
}

export async function buildCarinaSection(
  characterId: string
): Promise<SelfInventoryCarinaSection> {
  const repos = getRepositories();

  // canBeCarina is a DB column, not a vault field — use the overlay-free raw
  // read so a single broken character vault can't sink the whole listing. This
  // mirrors the orchestrator's per-turn Carina-answerer probe.
  const rawCharacters = await repos.characters.findAllRaw();

  const selfEnabled = rawCharacters.some(
    (c) => c.id === characterId && c.canBeCarina === true
  );

  // A Carina line opens when EITHER side is an answerer. So an enabled self can
  // reach EVERY other character; a non-enabled self can reach only the answerers.
  const others = rawCharacters.filter((c) => c.id !== characterId);
  const pool = selfEnabled ? others : others.filter((c) => c.canBeCarina === true);

  const reachable = pool
    .map((c) => ({ name: c.name, isAnswerer: c.canBeCarina === true }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { available: true, selfEnabled, reachable };
}

function resolveRuntimeMode(): SelfInventoryRuntimeMode {
  const shell = isElectronShell();
  const docker = isDockerEnvironment();
  const vm = isLimaEnvironment();

  if (shell && vm) return 'electron-vm';
  if (shell && docker) return 'electron-docker';
  if (shell) return 'electron';
  if (vm) return 'vm';
  if (docker) return 'docker';
  if (isDevelopment) return 'local-dev';
  return 'local-production';
}

function resolveClientShell(): SelfInventoryClientShell {
  const shellVersion = getElectronShellVersion();
  if (shellVersion) return { type: 'electron', shellVersion };
  if (isElectronShell()) return { type: 'electron', shellVersion: 'unknown' };
  return { type: 'browser' };
}

function parseSemanticVersion(version: string): [number, number, number] {
  const base = version.split('-')[0];
  const parts = base.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function findReleaseNotesFile(version: string): { filePath: string; version: string } | null {
  const releasesDir = path.join(process.cwd(), 'docs', 'releases');

  let files: string[];
  try {
    files = fs.readdirSync(releasesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return null;
  }

  const [targetMajor, targetMinor, targetPatch] = parseSemanticVersion(version);

  const candidates: { file: string; version: string; major: number; minor: number; patch: number }[] = [];
  for (const file of files) {
    const stem = file.replace(/\.md$/, '');
    const parts = stem.split('.').map(Number);
    if (parts.some(isNaN)) continue;

    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;

    if (
      major < targetMajor ||
      (major === targetMajor && minor < targetMinor) ||
      (major === targetMajor && minor === targetMinor && patch <= targetPatch)
    ) {
      candidates.push({ file, version: stem, major, minor, patch });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  });

  return {
    filePath: path.join(releasesDir, candidates[0].file),
    version: candidates[0].version,
  };
}

export function buildQuilltapSection(
  includedParts: SelfInventoryQuilltapIncludedParts
): SelfInventoryQuilltapSection {
  // The top-level identity (version + runtime + clientShell) is always cheap
  // to compute and lives at the top of the section header in the formatter,
  // so we resolve it unconditionally. The two file reads (release notes,
  // changelog) are skipped when not requested — saves an fs.readFileSync on
  // a potentially large changelog when the caller only asked for the version.
  const version = packageJson.version;
  const runtimeMode = resolveRuntimeMode();
  const clientShell = resolveClientShell();

  let releaseNotes: string | null = null;
  let releaseNotesVersion: string | null = null;
  if (includedParts.releaseNotes) {
    const found = findReleaseNotesFile(version);
    if (found) {
      try {
        releaseNotes = fs.readFileSync(found.filePath, 'utf-8');
        releaseNotesVersion = found.version;
      } catch {
        // File disappeared between readdir and readFile
      }
    }
  }

  let changelog: string | null = null;
  if (includedParts.changelog) {
    try {
      changelog = fs.readFileSync(path.join(process.cwd(), 'docs', 'CHANGELOG.md'), 'utf-8');
    } catch {
      // Changelog not available (e.g. standalone/Docker build without docs)
    }
  }

  return {
    available: true,
    includedParts,
    version,
    runtimeMode,
    clientShell,
    releaseNotes,
    releaseNotesVersion,
    changelog,
  };
}

export function resolveQuilltapIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryQuilltapIncludedParts | null {
  const wantsAll = requested.has('quilltap');
  const wantsVersion = wantsAll || requested.has('quilltap.version');
  const wantsReleaseNotes = wantsAll || requested.has('quilltap.releaseNotes');
  const wantsChangelog = wantsAll || requested.has('quilltap.changelog');

  if (!wantsVersion && !wantsReleaseNotes && !wantsChangelog) {
    return null;
  }

  return {
    version: wantsVersion,
    releaseNotes: wantsReleaseNotes,
    changelog: wantsChangelog,
  };
}

export async function buildVaultWrapper(
  character: Character,
  parts: SelfInventoryVaultIncludedParts,
  includeAutomaticImages: boolean
): Promise<SelfInventoryVaultSection> {
  const out: SelfInventoryVaultSection = { includedParts: parts };
  if (parts.character) {
    out.character = await buildVaultCharacterSection(character, includeAutomaticImages).catch(
      (err) => ({
        available: false as const,
        reason: 'error' as const,
        message: getErrorMessage(err),
      })
    );
  }
  if (parts.groups) {
    out.groups = await buildVaultGroupsSection(character.id, includeAutomaticImages).catch(
      (err) => ({
        available: false as const,
        reason: 'error' as const,
        message: getErrorMessage(err),
      })
    );
  }
  return out;
}

export async function buildVaultAccessWrapper(
  character: Character,
  context: SelfInventoryToolContext,
  parts: SelfInventoryVaultIncludedParts
): Promise<SelfInventoryVaultAccessSection> {
  const out: SelfInventoryVaultAccessSection = { includedParts: parts };
  if (parts.character) {
    out.character = await buildVaultAccessCharacterSection(character, context).catch((err) => ({
      available: false as const,
      sharedVaultsEnabled: false,
      message: getErrorMessage(err),
    }));
  }
  if (parts.groups) {
    out.groups = await buildVaultAccessGroupsSection(character.id).catch((err) => ({
      available: false as const,
      reason: 'error' as const,
      message: getErrorMessage(err),
    }));
  }
  return out;
}

async function resolveMountNames(
  mountPointIds: string[]
): Promise<SelfInventoryContextMount[]> {
  const repos = getRepositories();
  const mounts: SelfInventoryContextMount[] = [];
  for (const id of mountPointIds) {
    const mp = await repos.docMountPoints.findById(id);
    if (mp) mounts.push({ mountPointId: mp.id, name: mp.name });
  }
  return mounts;
}

async function buildContextProject(
  projectId: string | null | undefined
): Promise<SelfInventoryContextProject> {
  if (!projectId) return { available: true, present: false };

  const repos = getRepositories();
  const project = await repos.projects.findById(projectId);
  if (!project) return { available: true, present: false };

  const mountPointIds = new Set<string>();
  if (project.officialMountPointId) mountPointIds.add(project.officialMountPointId);
  try {
    const links = await repos.projectDocMountLinks.findByProjectId(projectId);
    for (const link of links) mountPointIds.add(link.mountPointId);
  } catch {
    // Mount index unavailable — report the project with whatever stores we have.
  }

  const mountPoints = await resolveMountNames([...mountPointIds]);
  return { available: true, present: true, id: project.id, name: project.name, mountPoints };
}

async function buildContextGroups(characterId: string): Promise<SelfInventoryContextGroups> {
  const groups = await resolveMyGroups(characterId);
  const out: SelfInventoryContextGroup[] = [];
  for (const group of groups) {
    const mountPoints = await resolveMountNames(group.mountPointIds);
    out.push({ id: group.groupId, name: group.groupName, mountPoints });
  }
  return { available: true, groups: out };
}

async function buildContextCharacters(
  self: Character,
  chat: { participants: ChatParticipantBase[] } | null
): Promise<SelfInventoryContextCharacters> {
  if (!chat) return { available: false, message: 'Chat not found.' };

  const repos = getRepositories();
  const out: SelfInventoryContextCharacter[] = [];
  const seen = new Set<string>();

  for (const p of chat.participants) {
    if (p.type !== 'CHARACTER') continue;
    if (!p.characterId) continue;
    if (!isParticipantPresent(p.status)) continue;
    if (p.characterId === self.id) continue; // others present with you, not yourself
    if (seen.has(p.characterId)) continue;
    seen.add(p.characterId);

    let c: Character | null = null;
    try {
      c = await repos.characters.findById(p.characterId);
    } catch (err) {
      logger.debug('self_inventory: context.characters skipping unavailable character', {
        context: 'self-inventory-handler',
        characterId: p.characterId,
        error: getErrorMessage(err),
      });
      continue;
    }
    if (!c) continue;

    out.push({
      id: c.id,
      name: c.name,
      aliases: c.aliases ?? [],
      identity: c.identity ?? null,
      isUserPersona: p.controlledBy === 'user',
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { available: true, characters: out };
}

/**
 * Build the canonical qtap:// URI for a chat-context document from the triple
 * stored on the chat_documents row. The row carries only the mount-point
 * *name* (or the reserved 'self' literal, or null), so document-store URIs use
 * the name form; that is enough for a copy-pasteable hint.
 */
function buildContextFileUri(
  scope: 'project' | 'document_store' | 'general',
  mountPoint: string | null,
  filePath: string
): string {
  if (scope === 'project' || scope === 'general') {
    return formatScopedUri(scope, filePath);
  }
  if (!mountPoint || mountPoint.toLowerCase() === 'self') {
    return formatSelfUri(filePath);
  }
  return formatDocStoreUri({ mountPointName: mountPoint, mountPointId: '', path: filePath });
}

function buildHowToReach(uri: string): string {
  return `doc_read_file({ uri: "${uri}" })`;
}

async function buildContextFiles(chatId: string): Promise<SelfInventoryContextFiles> {
  const repos = getRepositories();
  const docs = await repos.chatDocuments.findByChatId(chatId);
  const files: SelfInventoryContextFile[] = docs
    .map((d) => {
      const uri = buildContextFileUri(d.scope, d.mountPoint ?? null, d.filePath);
      return {
        scope: d.scope,
        mountPoint: d.mountPoint ?? null,
        filePath: d.filePath,
        displayTitle: d.displayTitle ?? null,
        uri,
        howToReach: buildHowToReach(uri),
      };
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  return { available: true, files };
}

export async function buildContextSection(
  character: Character,
  context: SelfInventoryToolContext,
  parts: SelfInventoryContextIncludedParts
): Promise<SelfInventoryContextSection> {
  const repos = getRepositories();
  const out: SelfInventoryContextSection = { includedParts: parts };
  const chat = await repos.chats.findById(context.chatId);

  if (parts.chat) {
    const chatSection: SelfInventoryContextChat = chat
      ? { available: true, chatId: chat.id, title: chat.title ?? null }
      : { available: false, chatId: context.chatId, title: null, message: 'Chat not found.' };
    out.chat = chatSection;
  }

  if (parts.project) {
    out.project = await buildContextProject(context.projectId ?? chat?.projectId ?? null).catch(
      (err) => ({ available: false as const, message: getErrorMessage(err) })
    );
  }

  if (parts.groups) {
    out.groups = await buildContextGroups(character.id).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  if (parts.characters) {
    out.characters = await buildContextCharacters(character, chat).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  if (parts.files) {
    out.files = await buildContextFiles(context.chatId).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  return out;
}

export function resolveVaultIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryVaultIncludedParts | null {
  const wantsAll = requested.has('vault');
  const character = wantsAll || requested.has('vault.character');
  const groups = wantsAll || requested.has('vault.groups');
  if (!character && !groups) return null;
  return { character, groups };
}

export function resolveVaultAccessIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryVaultIncludedParts | null {
  const wantsAll = requested.has('vaultAccess');
  const character = wantsAll || requested.has('vaultAccess.character');
  const groups = wantsAll || requested.has('vaultAccess.groups');
  if (!character && !groups) return null;
  return { character, groups };
}

export function resolveContextIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryContextIncludedParts | null {
  const wantsAll = requested.has('context');
  const chat = wantsAll || requested.has('context.chat');
  const project = wantsAll || requested.has('context.project');
  const groups = wantsAll || requested.has('context.groups');
  const characters = wantsAll || requested.has('context.characters');
  const files = wantsAll || requested.has('context.files');
  if (!chat && !project && !groups && !characters && !files) return null;
  return { chat, project, groups, characters, files };
}
