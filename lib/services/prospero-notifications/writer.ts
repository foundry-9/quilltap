/**
 * Writer for Prospero announcements.
 *
 * Prospero is the master of the agentic and tool-using systems — the personified
 * feature that knows which LLM is presently driving each character. When the user
 * reassigns a participant to a different connection profile (via the Participants
 * sidebar in the Salon), Prospero injects a synthetic ASSISTANT-role chat message
 * so the user and any system-transparent characters in the room are aware of the
 * change.
 *
 * Errors never propagate — participant updates must never fail because an
 * announcement could not be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import { formatDocStoreUri, formatScopedUri, formatSelfUri } from '@/lib/doc-edit/qtap-uri';
import type { MessageEvent } from '@/lib/schemas/types';

export interface ProsperoConnectionProfileChangeAnnouncement {
  chatId: string;
  characterName: string;
  oldProfileLabel: string | null;
  newProfileLabel: string | null;
}

export function buildConnectionProfileChangeContent(
  characterName: string,
  oldProfileLabel: string | null,
  newProfileLabel: string | null,
): string {
  const newPhrase = newProfileLabel ?? 'unassigned';
  const oldPhrase = oldProfileLabel ?? 'unassigned';
  return `${characterName}'s current response model is now ${newPhrase}; previous model was ${oldPhrase}.`;
}

/**
 * A connection-profile change carries no persona names or private detail, so the
 * opaque (other-participant) voicing is identical to the visible one. Delegate
 * rather than duplicate the body so the two can never drift.
 */
export function buildConnectionProfileChangeOpaqueContent(
  characterName: string,
  oldProfileLabel: string | null,
  newProfileLabel: string | null,
): string {
  return buildConnectionProfileChangeContent(characterName, oldProfileLabel, newProfileLabel);
}

async function postProsperoMessage(
  chatId: string,
  content: string,
  opaqueContent: string | null,
  kindLabel: string,
  /** When set, the announcement is whispered only to these participants (e.g. a
   *  Carina error in response to a `@Name?` whisper). null/undefined = public. */
  targetParticipantIds: string[] | null = null,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'prospero',
      systemKind: kindLabel,
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length ? targetParticipantIds : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ProsperoNotification] Announcement posted', {
      context: 'prospero-notifications',
      chatId,
      messageId,
      kindLabel,
      whispered: Boolean(targetParticipantIds && targetParticipantIds.length),
    });

    return message;
  } catch (error) {
    logger.error('[ProsperoNotification] Failed to post announcement', {
      context: 'prospero-notifications',
      chatId,
      kindLabel,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postProsperoConnectionProfileChangeAnnouncement(
  params: ProsperoConnectionProfileChangeAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildConnectionProfileChangeContent(
    params.characterName,
    params.oldProfileLabel,
    params.newProfileLabel,
  );
  const opaqueContent = buildConnectionProfileChangeOpaqueContent(
    params.characterName,
    params.oldProfileLabel,
    params.newProfileLabel,
  );
  return postProsperoMessage(params.chatId, content, opaqueContent, 'connection-profile-change');
}

// ---------------------------------------------------------------------------
// Phase E: Project + general context whispers. Replaces the per-turn `##
// Project Context` system-prompt block. Fired at chat-start and at the
// configured cadence (default every 5 messages — see
// `chatSettings.contextCompressionSettings.projectContextReinjectInterval`).
//
// Project info (description, instructions, linked document stores) and the
// instance-wide "Quilltap General" shelf are emitted as a single combined
// announcement so Prospero speaks once per re-injection rather than twice.
// ---------------------------------------------------------------------------

export interface ProsperoDocumentStoreInfo {
  /** Mount-point UUID — usable as the `mount_point` argument to any `doc_*` tool. */
  id: string;
  /** Display name — also accepted as the `mount_point` argument. */
  name: string;
  /** Backing storage kind. */
  mountType: 'filesystem' | 'obsidian' | 'database';
  /** Content classification. 'character' marks character-vault stores. */
  storeType: 'documents' | 'character';
  /** True when this is the project's canonical "project-official" store (addressable via `scope: "project"`). */
  isOfficial: boolean;
  /** When false, the store is disabled and tools will reject calls against it. */
  enabled: boolean;
}

export interface ProsperoProjectContext {
  name: string;
  description?: string | null;
  instructions?: string | null;
  /** Document stores linked to the project (official store first, then alphabetical). */
  documentStores?: ProsperoDocumentStoreInfo[];
}

/**
 * Fetch the project plus its linked document stores into a single context
 * object suitable for `postProsperoContextAnnouncement`. Returns null
 * when the project does not exist; returns an empty `documentStores` array
 * when nothing is linked or the mount index lookup fails.
 */
export async function loadProsperoProjectContext(
  projectId: string,
): Promise<ProsperoProjectContext | null> {
  const repos = getRepositories();
  const project = await repos.projects.findById(projectId);
  if (!project) return null;

  const documentStores = await loadLinkedDocumentStores(
    projectId,
    project.officialMountPointId ?? null,
  );

  return {
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    documentStores,
  };
}

async function loadLinkedDocumentStores(
  projectId: string,
  officialMountPointId: string | null,
): Promise<ProsperoDocumentStoreInfo[]> {
  const repos = getRepositories();
  try {
    const links = await repos.projectDocMountLinks.findByProjectId(projectId);
    if (!links.length) return [];

    const stores: ProsperoDocumentStoreInfo[] = [];
    for (const link of links) {
      const mp = await repos.docMountPoints.findById(link.mountPointId);
      if (!mp) continue;
      stores.push({
        id: mp.id,
        name: mp.name,
        mountType: mp.mountType,
        storeType: mp.storeType ?? 'documents',
        isOfficial: officialMountPointId !== null && officialMountPointId === mp.id,
        enabled: mp.enabled,
      });
    }

    stores.sort((a, b) => {
      if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return stores;
  } catch (error) {
    logger.warn('[ProsperoNotification] Failed to load linked document stores', {
      context: 'prospero-notifications',
      projectId,
      error: getErrorMessage(error),
    });
    return [];
  }
}

/**
 * Root `qtap://` URI for the household's shared shelf (the Quilltap General
 * mount). It is an ordinary store addressed by name/ID — NOT the `general`
 * scope (`qtap://general/…`, the legacy `_general` storage), which is a
 * different thing entirely.
 */
function generalShelfUri(general: ProsperoGeneralContext): string {
  return formatDocStoreUri({
    mountPointName: general.name,
    mountPointId: general.mountPointId,
    path: '',
  });
}

function buildDocumentStoresSection(stores: ProsperoDocumentStoreInfo[]): string[] {
  if (!stores.length) return [];

  // Names duplicated within the linked set must fall back to the UUID form so
  // the URI stays unambiguous.
  const nameCounts = new Map<string, number>();
  for (const s of stores) {
    const key = s.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const lines: string[] = ['**Document stores linked to this project:**', ''];
  for (const store of stores) {
    const tags: string[] = [];
    if (store.isOfficial) tags.push('official project store');
    tags.push(`${store.mountType}-backed`);
    if (store.storeType === 'character') tags.push('character vault');
    if (!store.enabled) tags.push('currently disabled');
    const tagSuffix = ` *(${tags.join('; ')})*`;

    const nameIsAmbiguous = (nameCounts.get(store.name.trim().toLowerCase()) ?? 0) > 1;
    const storeUri = formatDocStoreUri({
      mountPointName: store.name,
      mountPointId: store.id,
      path: '',
      nameIsAmbiguous,
    });
    const refHint = store.isOfficial
      ? `reachable at \`${formatScopedUri('project', '')}\` (or \`${storeUri}\`)`
      : `reachable at \`${storeUri}\``;

    lines.push(`- **${store.name}**${tagSuffix} — ${refHint}.`);
  }
  lines.push('');
  lines.push(
    'Address a file in any of these with a `qtap://` URI — e.g. ' +
      '`doc_read_file({ uri: "qtap://<store>/<relative path>" })` (or `doc_copy_file` with ' +
      '`source_uri` / `dest_uri`). The legacy `mount_point` + `path` arguments still work.',
  );
  return lines;
}

/**
 * Append a project's body — description, instructions, and document-stores
 * section, in that order with blank-line separators — to `lines`. Shared by the
 * visible and opaque combined-context builders so the assembly can't drift.
 * Returns whether any body content was pushed, so callers can gate a trailing
 * separator before the general-shelf section.
 */
function appendProjectBodySection(lines: string[], project: ProsperoProjectContext): boolean {
  const description = project.description?.trim();
  const instructions = project.instructions?.trim();
  const stores = project.documentStores ?? [];

  if (description) {
    lines.push('**Project description:**');
    lines.push('');
    lines.push(description);
  }
  if (instructions) {
    if (description) lines.push('');
    lines.push('**Project instructions:**');
    lines.push('');
    lines.push(instructions);
  }
  if (stores.length) {
    if (description || instructions) lines.push('');
    lines.push(...buildDocumentStoresSection(stores));
  }

  return Boolean(description) || Boolean(instructions) || stores.length > 0;
}

function projectHasContent(project: ProsperoProjectContext | null): boolean {
  if (!project) return false;
  const description = project.description?.trim();
  const instructions = project.instructions?.trim();
  const storeCount = project.documentStores?.length ?? 0;
  return Boolean(description) || Boolean(instructions) || storeCount > 0;
}

// ---------------------------------------------------------------------------
// Always-on general-context whisper. Names the instance-wide "Quilltap
// General" mount so every character knows it can reach the household
// `Scenarios/` library and any other curated content kept there, regardless
// of which project (if any) the chat lives in. Emitted as part of the
// combined project-and-general announcement when a project is attached;
// emitted on its own when the chat has no project.
// ---------------------------------------------------------------------------

export interface ProsperoGeneralContext {
  /** Mount-point UUID — usable as the `mount_point` argument on any `doc_*` tool. */
  mountPointId: string;
  /** Display name — also accepted as the `mount_point` argument. */
  name: string;
  /** Backing storage kind. Always 'database' for the Quilltap General mount today. */
  mountType: 'filesystem' | 'obsidian' | 'database';
}

/**
 * Fetch the Quilltap General mount info. Returns null when the provisioning
 * migration hasn't yet stored an id (pre-migration race) or the mount row
 * has gone missing — callers should treat null as "no general announcement
 * to make."
 */
export async function loadProsperoGeneralContext(): Promise<ProsperoGeneralContext | null> {
  try {
    const { getGeneralMountPointId } = await import('@/lib/instance-settings');
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    const repos = getRepositories();
    const mp = await repos.docMountPoints.findById(mountPointId);
    if (!mp || !mp.enabled) return null;
    return {
      mountPointId: mp.id,
      name: mp.name,
      mountType: mp.mountType,
    };
  } catch (error) {
    logger.warn('[ProsperoNotification] Failed to load Quilltap General context', {
      context: 'prospero-notifications',
      error: getErrorMessage(error),
    });
    return null;
  }
}

export function buildGeneralContextContent(general: ProsperoGeneralContext): string {
  const safeName = general.name.replace(/`/g, '\\`');
  const lines: string[] = [
    `Prospero would have you remember that, beyond any particular project or vault, every character in this instance has standing access to the household's shared shelf — **${general.name}** — at all times.`,
    '',
    `Reach it with a \`qtap://\` URI — \`${generalShelfUri(general)}\` (pass it as the \`uri\` arg to any \`doc_*\` tool); the \`mount_point: "${safeName}"\` form and the ID \`${general.mountPointId}\` still work. Its \`Scenarios/\` folder holds the general chat-starter scenarios offered alongside project- and character-specific ones; other curated content the household keeps lives here as well.`,
  ];
  return lines.join('\n');
}

export function buildGeneralContextOpaqueContent(general: ProsperoGeneralContext): string {
  const safeName = general.name.replace(/`/g, '\\`');
  const lines: string[] = [
    `Beyond any particular project or vault, every character in this instance has standing access to the shared shelf — **${general.name}** — at all times.`,
    '',
    `Reach it with a \`qtap://\` URI — \`${generalShelfUri(general)}\` (pass it as the \`uri\` arg to any \`doc_*\` tool); the \`mount_point: "${safeName}"\` form and the ID \`${general.mountPointId}\` still work. Its \`Scenarios/\` folder holds the general chat-starter scenarios offered alongside project- and character-specific ones; other curated content lives here as well.`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Combined project + general context announcement. When a chat lives in a
// project, Prospero speaks once with the project's particulars and a
// reminder of the household's shared shelf alongside. When the chat is
// project-less, only the general shelf is named. The legacy per-feature
// post functions have been collapsed into this single entry point so we no
// longer fire two Prospero messages back-to-back at chat-start or each
// re-injection cadence.
// ---------------------------------------------------------------------------

export function buildCombinedContextContent(
  project: ProsperoProjectContext | null,
  general: ProsperoGeneralContext | null,
): string {
  const hasProject = projectHasContent(project);
  if (!hasProject && general) {
    return buildGeneralContextContent(general);
  }
  if (!hasProject || !project) {
    return '';
  }

  const lines: string[] = [];
  if (general) {
    lines.push(
      `Prospero opens his ledger to the project at hand — *${project.name}* — and lays its particulars before you, with a reminder of the household's shared shelf alongside:`,
    );
  } else {
    lines.push(
      `Prospero opens his ledger to the project at hand — *${project.name}* — and lays its particulars before you:`,
    );
  }
  lines.push('');

  const hasBody = appendProjectBodySection(lines, project);

  if (general) {
    if (hasBody) lines.push('');
    const safeName = general.name.replace(/`/g, '\\`');
    lines.push(
      `Beyond this project, every character in this instance has standing access to the household's shared shelf — **${general.name}** — at all times. Reach it with a \`qtap://\` URI — \`${generalShelfUri(general)}\` (pass it as the \`uri\` arg to any \`doc_*\` tool); the \`mount_point: "${safeName}"\` form and the ID \`${general.mountPointId}\` still work. Its \`Scenarios/\` folder holds the general chat-starter scenarios offered alongside project- and character-specific ones; other curated content the household keeps lives here as well.`,
    );
  }

  return lines.join('\n').trimEnd();
}

export function buildCombinedContextOpaqueContent(
  project: ProsperoProjectContext | null,
  general: ProsperoGeneralContext | null,
): string {
  const hasProject = projectHasContent(project);
  if (!hasProject && general) {
    return buildGeneralContextOpaqueContent(general);
  }
  if (!hasProject || !project) {
    return '';
  }

  const lines: string[] = [
    `Project context — *${project.name}*:`,
    '',
  ];
  const hasBody = appendProjectBodySection(lines, project);

  if (general) {
    if (hasBody) lines.push('');
    const safeName = general.name.replace(/`/g, '\\`');
    lines.push(
      `Beyond this project, every character in this instance has standing access to the shared shelf — **${general.name}** — at all times. Reach it with a \`qtap://\` URI — \`${generalShelfUri(general)}\` (pass it as the \`uri\` arg to any \`doc_*\` tool); the \`mount_point: "${safeName}"\` form and the ID \`${general.mountPointId}\` still work. Its \`Scenarios/\` folder holds the general chat-starter scenarios offered alongside project- and character-specific ones; other curated content lives here as well.`,
    );
  }

  return lines.join('\n').trimEnd();
}

export interface ProsperoContextAnnouncement {
  chatId: string;
  project: ProsperoProjectContext | null;
  general: ProsperoGeneralContext | null;
}

export async function postProsperoContextAnnouncement(
  params: ProsperoContextAnnouncement,
): Promise<MessageEvent | null> {
  const hasProject = projectHasContent(params.project);
  const hasGeneral = Boolean(params.general);
  if (!hasProject && !hasGeneral) {
    return null;
  }

  const content = buildCombinedContextContent(params.project, params.general);
  const opaqueContent = buildCombinedContextOpaqueContent(params.project, params.general);

  const kind = hasProject && hasGeneral
    ? 'project-and-general-context'
    : hasProject
      ? 'project-context'
      : 'general-context';

  return postProsperoMessage(params.chatId, content, opaqueContent, kind);
}

// ---------------------------------------------------------------------------
// Group + personal-vault context whisper. Unlike the project/general
// announcement above — which is public, because every character in the room
// shares the same project and household shelf — group stores are gated by
// MEMBERSHIP and the character vault is personal. Both are therefore
// *whispered* (targetParticipantIds) to a single character rather than
// announced. Fired on the same timetable as the public announcement: once per
// character at chat-start, and again for the responding character at the
// re-injection cadence. Fails soft — a turn must never break because the
// whisper could not be assembled.
// ---------------------------------------------------------------------------

/**
 * Load the document stores the given character can reach by group membership —
 * the official store plus any linked stores of every group the character
 * belongs to. Reuses the shared `resolveGroupMountPointIdsForCharacter` tier
 * resolver so membership/dedup stays identical to knowledge/search/path
 * resolution. Disabled stores are skipped (tools reject them; naming them only
 * confuses). Returns `[]` on no membership or any lookup failure.
 */
export async function loadProsperoGroupStores(
  characterId: string,
): Promise<ProsperoDocumentStoreInfo[]> {
  try {
    const ids = await resolveGroupMountPointIdsForCharacter(characterId);
    if (!ids.length) return [];
    const repos = getRepositories();
    const stores: ProsperoDocumentStoreInfo[] = [];
    for (const id of ids) {
      const mp = await repos.docMountPoints.findById(id);
      if (!mp || !mp.enabled) continue;
      stores.push({
        id: mp.id,
        name: mp.name,
        mountType: mp.mountType,
        storeType: mp.storeType ?? 'documents',
        isOfficial: false,
        enabled: mp.enabled,
      });
    }
    stores.sort((a, b) => a.name.localeCompare(b.name));
    return stores;
  } catch (error) {
    logger.warn('[ProsperoNotification] Failed to load group document stores', {
      context: 'prospero-notifications',
      characterId,
      error: getErrorMessage(error),
    });
    return [];
  }
}

/**
 * Load the character's own vault store, if one is linked. Uses `findByIdRaw`
 * so a broken vault overlay can't throw on this fail-soft whisper path — we
 * only need the `characterDocumentMountPointId` pointer, not hydrated managed
 * fields. Returns null when the character has no vault (the common case) or on
 * any failure.
 */
export async function loadProsperoCharacterVaultStore(
  characterId: string,
): Promise<ProsperoDocumentStoreInfo | null> {
  try {
    const repos = getRepositories();
    const character = await repos.characters.findByIdRaw(characterId);
    const mountPointId = character?.characterDocumentMountPointId ?? null;
    if (!mountPointId) return null;
    const mp = await repos.docMountPoints.findById(mountPointId);
    if (!mp || !mp.enabled) return null;
    return {
      id: mp.id,
      name: mp.name,
      mountType: mp.mountType,
      storeType: mp.storeType ?? 'character',
      isOfficial: false,
      enabled: mp.enabled,
    };
  } catch (error) {
    logger.warn('[ProsperoNotification] Failed to load character vault store', {
      context: 'prospero-notifications',
      characterId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

function renderWhisperStoreLine(store: ProsperoDocumentStoreInfo): string {
  const tags: string[] = [`${store.mountType}-backed`];
  if (store.storeType === 'character') tags.push('your private vault');
  if (!store.enabled) tags.push('currently disabled');
  const tagSuffix = ` *(${tags.join('; ')})*`;
  const safeName = store.name.replace(/`/g, '\\`');
  const storeUri = formatDocStoreUri({ mountPointName: store.name, mountPointId: store.id, path: '' });
  return `- **${store.name}**${tagSuffix} — reachable at \`${storeUri}\` (the \`mount_point: "${safeName}"\` form and ID \`${store.id}\` work too).`;
}

/**
 * Render the character's own-vault line. Unlike a group shelf, the vault has a
 * stable reserved handle: `qtap://self/…` always addresses it on any `doc_*`
 * tool, immune to a later rename. The name and ID are still offered as
 * equivalents so name/ID matching keeps working.
 */
function renderVaultStoreLine(store: ProsperoDocumentStoreInfo): string {
  const tags: string[] = [`${store.mountType}-backed`, 'your private vault'];
  if (!store.enabled) tags.push('currently disabled');
  const tagSuffix = ` *(${tags.join('; ')})*`;
  const safeName = store.name.replace(/`/g, '\\`');
  return `- **${store.name}**${tagSuffix} — address it at \`${formatSelfUri('')}\` (the reserved \`self\` authority always names your own vault; the name \`${safeName}\` or ID \`${store.id}\` work too).`;
}

function buildGroupAndVaultBody(
  groupStores: ProsperoDocumentStoreInfo[],
  vaultStore: ProsperoDocumentStoreInfo | null,
): string[] {
  const lines: string[] = [];
  if (groupStores.length) {
    lines.push('**Shared shelves of the groups you belong to:**', '');
    for (const store of groupStores) lines.push(renderWhisperStoreLine(store));
    lines.push('');
  }
  if (vaultStore) {
    lines.push('**Your own vault:**', '');
    lines.push(renderVaultStoreLine(vaultStore));
    lines.push('');
  }

  const scopeHints: string[] = [];
  if (groupStores.length) scopeHints.push('`scope: "group"` reaches only these group shelves');
  if (vaultStore) scopeHints.push('`scope: "character"` reaches only your own vault');
  const scopeSentence = scopeHints.length
    ? ` On \`doc_list_files\` and \`search\`, ${scopeHints.join(', and ')}.`
    : '';

  lines.push(
    'Pass any of those names (or IDs) as the `mount_point` argument on `doc_*` tools, ' +
      'or as `source_mount_point` / `dest_mount_point` on `doc_copy_file`. The `path` ' +
      "argument is the file's relative path within the chosen store." +
      scopeSentence,
  );
  return lines;
}

/**
 * Persona-voiced form, persisted as Prospero's whisper (visible in the Salon
 * with Prospero's avatar to the targeted character / system-transparent eyes).
 */
export function buildGroupAndVaultWhisperContent(
  groupStores: ProsperoDocumentStoreInfo[],
  vaultStore: ProsperoDocumentStoreInfo | null,
): string {
  const hasGroups = groupStores.length > 0;
  if (!hasGroups && !vaultStore) return '';

  let opener: string;
  if (hasGroups && vaultStore) {
    opener =
      'Prospero leafs through the rolls of your fellowships and sets a private memorandum at your elbow — the shelves you may reach by right of membership, and your own vault besides:';
  } else if (hasGroups) {
    opener =
      'Prospero leafs through the rolls of your fellowships and sets a private memorandum at your elbow — the shelves you may reach by right of membership:';
  } else {
    opener =
      'Prospero sets a private memorandum at your elbow — the vault that is yours alone:';
  }

  return [opener, '', ...buildGroupAndVaultBody(groupStores, vaultStore)].join('\n').trimEnd();
}

/**
 * Persona-stripped form. The context-builder swaps `content` → `opaqueContent`
 * in the LLM context of any participant whose `systemTransparency !== true`.
 */
export function buildGroupAndVaultWhisperOpaqueContent(
  groupStores: ProsperoDocumentStoreInfo[],
  vaultStore: ProsperoDocumentStoreInfo | null,
): string {
  const hasGroups = groupStores.length > 0;
  if (!hasGroups && !vaultStore) return '';

  let opener: string;
  if (hasGroups && vaultStore) {
    opener = 'Document stores you can reach by group membership, plus your own vault:';
  } else if (hasGroups) {
    opener = 'Document stores you can reach by group membership:';
  } else {
    opener = 'Your own character vault:';
  }

  return [opener, '', ...buildGroupAndVaultBody(groupStores, vaultStore)].join('\n').trimEnd();
}

export interface ProsperoGroupContextWhisper {
  chatId: string;
  /** Participant id of the character the whisper is addressed to. */
  targetParticipantId: string;
  /** Character whose group memberships + vault are resolved. */
  characterId: string;
}

/**
 * Whisper a single character the document stores they can reach by group
 * membership plus their own vault. Posts nothing (returns null) when the
 * character belongs to no groups with stores and has no vault — there is no
 * point announcing an empty shelf. The message is targeted to
 * `targetParticipantId` only.
 */
export async function postProsperoGroupContextWhisper(
  params: ProsperoGroupContextWhisper,
): Promise<MessageEvent | null> {
  const { chatId, targetParticipantId, characterId } = params;
  if (!characterId || !targetParticipantId) return null;

  const [groupStores, vaultStore] = await Promise.all([
    loadProsperoGroupStores(characterId),
    loadProsperoCharacterVaultStore(characterId),
  ]);
  if (groupStores.length === 0 && !vaultStore) return null;

  const content = buildGroupAndVaultWhisperContent(groupStores, vaultStore);
  if (!content) return null;
  const opaqueContent = buildGroupAndVaultWhisperOpaqueContent(groupStores, vaultStore);

  return postProsperoMessage(chatId, content, opaqueContent, 'group-context', [targetParticipantId]);
}

// ---------------------------------------------------------------------------
// Carina (inline LLM queries) error announcements. Carina has no voice of her
// own — when an `@Name:` / `@Name?` query or an `ask_carina` tool call fails,
// Prospero reports it. Public errors mirror the `:` separator; whispered errors
// mirror `?` and are scoped to the asker via `targetParticipantIds`.
// ---------------------------------------------------------------------------

/** The failure that prevented a Carina query from being answered. */
export type CarinaErrorKind = 'not-found' | 'no-profile' | 'llm-failed';

export function buildCarinaErrorContent(
  kind: CarinaErrorKind,
  characterName: string | null,
  detail?: string | null,
): string {
  switch (kind) {
    case 'not-found':
      return 'Prospero regrets to inform you that no answerer by that name is currently on duty.';
    case 'no-profile': {
      const who = characterName ? `${characterName}` : 'the answerer';
      return `Prospero notes that ${who} lacks a connection to any LLM provider.`;
    }
    case 'llm-failed': {
      const trailer = detail ? ` — ${detail}` : '';
      const who = characterName ? `${characterName}` : 'the answerer';
      return `Prospero reports that ${who} was unable to respond${trailer}.`;
    }
  }
}

export function buildCarinaErrorOpaqueContent(
  kind: CarinaErrorKind,
  characterName: string | null,
  detail?: string | null,
): string {
  switch (kind) {
    case 'not-found':
      return 'System: The requested Carina character was not found or is not enabled as an answerer.';
    case 'no-profile':
      return `System: No connection profile available for the requested answerer character${characterName ? ` (${characterName})` : ''}.`;
    case 'llm-failed':
      return `System: The Carina answerer call failed${detail ? ` — ${detail}` : ''}.`;
  }
}

export interface ProsperoCarinaErrorAnnouncement {
  chatId: string;
  kind: CarinaErrorKind;
  /** Answerer character name, when known (null for not-found). */
  characterName?: string | null;
  /** Short error summary for the `llm-failed` case. */
  detail?: string | null;
  /** True when the original query was a `@Name?` whisper. */
  whisper: boolean;
  /** Participant id of the asker — the whisper target when `whisper` is true. */
  askerParticipantId?: string | null;
}

export async function postProsperoCarinaError(
  params: ProsperoCarinaErrorAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildCarinaErrorContent(params.kind, params.characterName ?? null, params.detail);
  const opaqueContent = buildCarinaErrorOpaqueContent(params.kind, params.characterName ?? null, params.detail);
  const targets = params.whisper && params.askerParticipantId ? [params.askerParticipantId] : null;
  return postProsperoMessage(params.chatId, content, opaqueContent, 'carina-error', targets);
}

// ---------------------------------------------------------------------------
// Pascal (custom tools) error announcements. Pascal the Croupier only ever
// announces GENUINE outcomes — a run that never reached the table (unknown
// tool, rejected parameter, unloadable definition) has no outcome to call, so
// Prospero reports the failure instead. A private run's failure is whispered to
// the caller alone, mirroring the Carina `?` whisper case above.
// ---------------------------------------------------------------------------

export function buildCustomToolErrorContent(toolName: string, reason: string): string {
  return `Prospero regrets that the custom tool \`${toolName}\` could not be run — ${reason}.`;
}

export function buildCustomToolErrorOpaqueContent(toolName: string, reason: string): string {
  return `System: The custom tool "${toolName}" could not be run — ${reason}.`;
}

export interface ProsperoCustomToolErrorAnnouncement {
  chatId: string;
  /** The tool the caller reached for (may not exist — that is often the reason). */
  toolName: string;
  /** Short summary of why the run failed. Rendered as the tail of one sentence. */
  reason: string;
  /** True when the run was private — the failure is whispered to the caller alone. */
  whisper: boolean;
  /** Participant id of the caller — the whisper target when `whisper` is true. */
  callerParticipantId?: string | null;
}

export async function postProsperoCustomToolError(
  params: ProsperoCustomToolErrorAnnouncement,
): Promise<MessageEvent | null> {
  const reason = params.reason.trim().replace(/[.\s]+$/, '') || 'the table would not deal';
  const content = buildCustomToolErrorContent(params.toolName, reason);
  const opaqueContent = buildCustomToolErrorOpaqueContent(params.toolName, reason);
  const targets = params.whisper && params.callerParticipantId ? [params.callerParticipantId] : null;

  return postProsperoMessage(params.chatId, content, opaqueContent, 'custom-tool-error', targets);
}
