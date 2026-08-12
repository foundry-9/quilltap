/**
 * Pascal's Workbench — server-side helpers behind `/api/v1/custom-tools`.
 *
 * The Workbench is the authoring surface for custom tools: a library of every
 * definition in every enabled store (no shadowing, no per-invoker perspective —
 * the whole table, face up), and a destination list for saving a definition
 * anywhere a tool can live. The chat-facing roster logic stays in
 * `./custom-tools`; this module only adds the authoring-time views over the
 * same loaders.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import { displayTitle, type Visibility } from './custom-tool.types';
import { listAllCustomTools } from './custom-tools';

const CONTEXT = 'pascal.workbench';

/** What a store is attached to. One store can carry several of these. */
export interface MountAttachment {
  kind: 'general' | 'project' | 'group' | 'character' | 'unattached';
  /** The attached entity's id — absent for `general` and `unattached`. */
  id?: string;
  /** Human-readable badge text: the project/group/character name, etc. */
  label: string;
}

/** A valid definition, as the library lists it. */
export interface CustomToolLibraryEntry {
  valid: true;
  name: string;
  title: string;
  description: string;
  disabled: boolean;
  /** Which availability clause this tool declares, if any. */
  gate: 'available' | 'withheld' | null;
  defaultVisibility: Visibility;
  rollForm: 'range' | 'dice';
  /** Whether the tool consults an LLM mid-run. */
  llm: boolean;
  parameterCount: number;
  outcomeCount: number;
  mountPointId: string;
  mountName: string;
  definitionPath: string;
  attachments: MountAttachment[];
}

/** A broken definition file, listed rather than hidden. */
export interface CustomToolLibraryError {
  valid: false;
  definitionPath: string;
  mountPointId: string;
  mountName: string;
  reason: string;
  attachments: MountAttachment[];
}

export interface CustomToolLibraryResponse {
  tools: CustomToolLibraryEntry[];
  errors: CustomToolLibraryError[];
}

/** A save target, with the names already on that store's table. */
export interface DestinationStore {
  mountPointId: string;
  mountName: string;
  /** Names already defined in this store — a duplicate would be a load-time rejection. */
  existingToolNames: string[];
}

export interface CustomToolDestinations {
  /** The General store, or null when unprovisioned. */
  general: DestinationStore | null;
  projects: Array<{ projectId: string; projectName: string; stores: DestinationStore[] }>;
  groups: Array<{ groupId: string; groupName: string; stores: Array<DestinationStore & { official: boolean }> }>;
  characters: Array<{ characterId: string; characterName: string } & DestinationStore>;
  /** Enabled stores attached to nothing — inert until linked. */
  other: DestinationStore[];
}

/**
 * The raw attachment survey the library and the destination list both read:
 * who claims which mount, resolved once per request, never cached.
 */
interface AttachmentSurvey {
  generalId: string | null;
  /** projectId → { name, mountPointIds } for every project with links. */
  projects: Map<string, { name: string; mountPointIds: string[] }>;
  /** groupId → { name, officialMountPointId, linked mountPointIds }. */
  groups: Map<string, { name: string; officialMountPointId: string | null; mountPointIds: string[] }>;
  /** mountPointId → owning character, for characters WITH a vault. */
  characterByMount: Map<string, { characterId: string; characterName: string }>;
}

async function surveyAttachments(): Promise<AttachmentSurvey> {
  const repos = getRepositories();

  const generalId = await getGeneralMountPointId();

  const projects = new Map<string, { name: string; mountPointIds: string[] }>();
  for (const project of await repos.projects.findAll()) {
    const links = await repos.projectDocMountLinks.findByProjectId(project.id);
    if (links.length === 0) continue;
    projects.set(project.id, { name: project.name, mountPointIds: links.map((l) => l.mountPointId) });
  }

  const groups = new Map<string, { name: string; officialMountPointId: string | null; mountPointIds: string[] }>();
  for (const group of await repos.groups.findAll()) {
    const links = await repos.groupDocMountLinks.findByGroupId(group.id);
    const officialMountPointId = group.officialMountPointId ?? null;
    if (links.length === 0 && !officialMountPointId) continue;
    groups.set(group.id, {
      name: group.name,
      officialMountPointId,
      mountPointIds: links.map((l) => l.mountPointId),
    });
  }

  // Raw read: only `characterDocumentMountPointId` and `name` are needed, and
  // the hydrating overlay would drop characters whose vault is briefly broken —
  // exactly the stores an author may be trying to repair.
  const characterByMount = new Map<string, { characterId: string; characterName: string }>();
  for (const character of await repos.characters.findAllRaw()) {
    const mountId = character.characterDocumentMountPointId;
    if (mountId) characterByMount.set(mountId, { characterId: character.id, characterName: character.name });
  }

  return { generalId, projects, groups, characterByMount };
}

/** Every attachment one mount carries, in a stable display order. */
function attachmentsForMount(mountPointId: string, survey: AttachmentSurvey): MountAttachment[] {
  const attachments: MountAttachment[] = [];

  if (survey.generalId === mountPointId) {
    attachments.push({ kind: 'general', label: 'General' });
  }

  const character = survey.characterByMount.get(mountPointId);
  if (character) {
    attachments.push({ kind: 'character', id: character.characterId, label: character.characterName });
  }

  for (const [groupId, group] of survey.groups) {
    if (group.officialMountPointId === mountPointId || group.mountPointIds.includes(mountPointId)) {
      attachments.push({ kind: 'group', id: groupId, label: group.name });
    }
  }

  for (const [projectId, project] of survey.projects) {
    if (project.mountPointIds.includes(mountPointId)) {
      attachments.push({ kind: 'project', id: projectId, label: project.name });
    }
  }

  if (attachments.length === 0) {
    attachments.push({ kind: 'unattached', label: 'Unattached' });
  }

  return attachments;
}

/**
 * The library: every definition in every enabled store, valid or broken, with
 * attachment badges resolved per mount.
 */
export async function buildCustomToolLibrary(): Promise<CustomToolLibraryResponse> {
  const [{ entries, errors }, survey] = await Promise.all([listAllCustomTools(), surveyAttachments()]);

  const attachmentCache = new Map<string, MountAttachment[]>();
  const attachmentsOf = (mountPointId: string): MountAttachment[] => {
    let cached = attachmentCache.get(mountPointId);
    if (!cached) {
      cached = attachmentsForMount(mountPointId, survey);
      attachmentCache.set(mountPointId, cached);
    }
    return cached;
  };

  const tools: CustomToolLibraryEntry[] = entries.map((entry) => ({
    valid: true,
    name: entry.definition.name,
    title: displayTitle(entry.definition),
    description: entry.definition.description,
    disabled: entry.definition.disabled ?? false,
    gate: entry.definition.availableWhen ? 'available' : entry.definition.withheldWhen ? 'withheld' : null,
    defaultVisibility: entry.definition.defaultVisibility ?? 'public',
    rollForm: typeof entry.definition.roll === 'string' ? 'dice' : 'range',
    llm: entry.definition.llm !== undefined,
    parameterCount: Object.keys(entry.definition.parameters ?? {}).length,
    outcomeCount: entry.definition.outcomes.length,
    mountPointId: entry.mountPointId,
    mountName: entry.mountName,
    definitionPath: entry.definitionPath,
    attachments: attachmentsOf(entry.mountPointId),
  }));

  const brokenFiles: CustomToolLibraryError[] = errors.map((error) => ({
    valid: false,
    definitionPath: error.definitionPath,
    mountPointId: error.mountPointId,
    mountName: error.mountName,
    reason: error.reason,
    attachments: attachmentsOf(error.mountPointId),
  }));

  return { tools, errors: brokenFiles };
}

/**
 * The save-target list: every enabled store a definition can be written to,
 * grouped by what the store is attached to, with the tool names each already
 * carries (a same-store duplicate `name` is a load-time rejection, so the
 * picker warns before the write rather than after).
 */
export async function listCustomToolDestinations(): Promise<CustomToolDestinations> {
  const repos = getRepositories();
  const [mounts, survey, library] = await Promise.all([
    repos.docMountPoints.findEnabled(),
    surveyAttachments(),
    listAllCustomTools(),
  ]);

  const namesByMount = new Map<string, string[]>();
  for (const entry of library.entries) {
    const names = namesByMount.get(entry.mountPointId) ?? [];
    names.push(entry.definition.name);
    namesByMount.set(entry.mountPointId, names);
  }

  const mountById = new Map(mounts.map((m) => [m.id, m] as const));
  const store = (mount: DocMountPoint): DestinationStore => ({
    mountPointId: mount.id,
    mountName: mount.name,
    existingToolNames: namesByMount.get(mount.id) ?? [],
  });

  const claimed = new Set<string>();

  let general: DestinationStore | null = null;
  if (survey.generalId) {
    const mount = mountById.get(survey.generalId);
    if (mount) {
      general = store(mount);
      claimed.add(mount.id);
    }
  }

  const characters: CustomToolDestinations['characters'] = [];
  for (const [mountPointId, owner] of survey.characterByMount) {
    const mount = mountById.get(mountPointId);
    if (!mount) continue;
    characters.push({ characterId: owner.characterId, characterName: owner.characterName, ...store(mount) });
    claimed.add(mountPointId);
  }
  characters.sort((a, b) => a.characterName.localeCompare(b.characterName));

  const groups: CustomToolDestinations['groups'] = [];
  for (const [groupId, group] of survey.groups) {
    const stores: Array<DestinationStore & { official: boolean }> = [];
    const seen = new Set<string>();
    for (const mountPointId of [group.officialMountPointId, ...group.mountPointIds]) {
      if (!mountPointId || seen.has(mountPointId)) continue;
      seen.add(mountPointId);
      const mount = mountById.get(mountPointId);
      if (!mount) continue;
      stores.push({ ...store(mount), official: mountPointId === group.officialMountPointId });
      claimed.add(mountPointId);
    }
    if (stores.length > 0) groups.push({ groupId, groupName: group.name, stores });
  }
  groups.sort((a, b) => a.groupName.localeCompare(b.groupName));

  const projects: CustomToolDestinations['projects'] = [];
  for (const [projectId, project] of survey.projects) {
    const stores: DestinationStore[] = [];
    for (const mountPointId of project.mountPointIds) {
      const mount = mountById.get(mountPointId);
      if (!mount) continue;
      stores.push(store(mount));
      claimed.add(mountPointId);
    }
    if (stores.length > 0) projects.push({ projectId, projectName: project.name, stores });
  }
  projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

  const other = mounts
    .filter((mount) => !claimed.has(mount.id))
    .map(store)
    .sort((a, b) => a.mountName.localeCompare(b.mountName));

  return { general, projects, groups, characters, other };
}
