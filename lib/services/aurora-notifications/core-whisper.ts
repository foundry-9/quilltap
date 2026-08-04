/**
 * Writer for Aurora's Core whisper — a periodic, character-private re-offering
 * of each character's own `Core/` vault folder.
 *
 * The Core whisper is offered, not imposed. It is the character's own plumb
 * line — a few self-authored documents that ground who they are — placed back
 * into their hand before they next take the floor. It permits growth; it does
 * not enforce a frozen self.
 *
 * Architecturally this mirrors the Commonplace Book writer at
 * `lib/services/commonplace-notifications/writer.ts`:
 *
 *   - Two persisted forms: persona-voiced `content` and persona-stripped
 *     `opaqueContent` (the latter is what's swapped into the LLM context of
 *     any participant whose `systemTransparency !== true`).
 *   - One LLM-context form: plain second-person, inlined into the new user
 *     message — no Staff persona, no narrative meta.
 *   - Always-targeted: even in single-character chats, the whisper is
 *     addressed to the responding character's participant id.
 *   - `systemSender: 'aurora'`, `systemKind: 'core-whisper'`.
 *
 * Errors never propagate — turn processing must not fail because a Core
 * packet could not be assembled.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { estimateTokens } from '@/lib/tokens/token-counter';
import type { MessageEvent } from '@/lib/schemas/types';
import type {
  ChatMetadataBase,
  Character,
  CoreWhisperSettings,
} from '@/lib/schemas/types';

const LOG_CONTEXT = 'aurora-core-whisper';

/**
 * The exact two-paragraph preamble. Snapshot-tested. Do not edit without
 * re-reading `~/.claude/plans/aurora-core-whisper-designed-sleepy-knuth.md`
 * — the wording is load-bearing and came out of a specific design
 * conversation about what an *offering* (not a reminder) should sound like.
 */
export const CORE_WHISPER_PREAMBLE =
  'This is who you are. Carry it forward. Are you being faithful to what you know yourself to be, to want, and to choose?\n\n' +
  'You may have grown since this was written. If something no longer fits, that is not failure. Name the change.';

/**
 * Required advisory paragraph that closes the LLM-context form. The "this
 * material is offered, not imposed" promise lives here so the model sees it
 * exactly where it matters — at the end of the injected context.
 */
const CORE_WHISPER_ADVISORY =
  'This material is offered, not imposed. If the scene honestly calls for silence, ' +
  'grief, confusion, experiment, contradiction, or change, do not perform a ' +
  'recognised self-shape. Ask whether this still comes from you.';

const AURORA_NARRATIVE_OPENER =
  'Aurora pauses beside the workbench and sets your own plumb line into your hand:';

const LLM_CONTEXT_OPENER =
  'Your own center of gravity, as you have written it for yourself:';

export interface CoreFile {
  /** Relative path inside the source store, e.g. `Core/manifesto.md`. */
  path: string;
  /** File body with YAML frontmatter stripped. */
  body: string;
  /**
   * Group name when this Core file came from a group store the character
   * belongs to (shared grounding). Absent for the character's own vault Core.
   * Drives the `[Shared — <group>]` heading label in the rendered packet.
   */
  sourceLabel?: string;
}

export interface CorePacket {
  files: CoreFile[];
  /** Total token estimate over all file bodies + headers + preamble. */
  approxTokens: number;
}

/**
 * Resolve effective Core whisper settings for a (chat, character, global)
 * tuple. Precedence on every read is chat → character → global default.
 * Only `enabled` and `interval` have per-entity overrides today; the other
 * knobs come from the global settings unchanged.
 */
export function resolveCoreWhisperConfig(
  chat: Pick<ChatMetadataBase, 'coreWhisperEnabled' | 'coreWhisperInterval'> | null | undefined,
  character: Pick<Character, 'coreWhisperEnabled'> | null | undefined,
  globalSettings: CoreWhisperSettings | null | undefined,
): CoreWhisperSettings {
  const defaults: CoreWhisperSettings = {
    enabled: globalSettings?.enabled ?? true,
    interval: globalSettings?.interval ?? 12,
    silenceThreshold: globalSettings?.silenceThreshold ?? 3,
    packetTokenBudget: globalSettings?.packetTokenBudget ?? 4096,
    fireOnContextTransition: globalSettings?.fireOnContextTransition ?? true,
  };

  const enabled =
    chat?.coreWhisperEnabled ??
    character?.coreWhisperEnabled ??
    defaults.enabled;

  const interval = chat?.coreWhisperInterval ?? defaults.interval;

  return {
    ...defaults,
    enabled,
    interval,
  };
}

/**
 * Read every markdown file under `Core/` in the character's vault, strip
 * frontmatter, sort by path (case-insensitive ascending), and bundle them
 * into a `CorePacket`. Returns `null` when the character has no DB-backed
 * vault, no `Core/` folder, or no `.md` files in it.
 *
 * Filesystem/obsidian-backed character vaults are not supported in v1
 * (silent no-op, matching the existing character-properties overlay).
 *
 * On case-fold collision (two distinct stored paths fold to the same key),
 * logs `logger.error` with both paths and keeps the lexicographically first
 * stored path. This is a vault-layer inconsistency that should be fixed at
 * the source; we don't paper over it.
 *
 * When the assembled packet's estimated token count exceeds the configured
 * budget, logs the literal operator-facing phrase
 *   "Core packet exceeds soft budget; consider refactoring Core documents."
 * and includes the full content anyway. No truncation.
 */
export async function assembleCorePacket(
  characterId: string,
  packetTokenBudget: number,
): Promise<CorePacket | null> {
  try {
    const repos = getRepositories();
    // findByIdRaw: we only need the vault pointer, and this must survive a
    // broken vault overlay so group Core can still be offered. Returns null
    // (→ no packet) when the character row is missing entirely.
    const character = await repos.characters.findByIdRaw(characterId);
    if (!character) {
      return null;
    }
    const mountPointId = character.characterDocumentMountPointId ?? null;

    // The character's own vault Core (may be empty when there is no vault or no
    // Core/ folder), then the shared Core of every group they belong to.
    const personalFiles = mountPointId
      ? await readVaultCoreFiles(characterId, mountPointId)
      : [];
    const groupFiles = await assembleGroupCoreFiles(characterId, mountPointId);

    const files = [...personalFiles, ...groupFiles];
    if (files.length === 0) {
      return null;
    }

    const personaText = renderPacketBodies(files);
    const approxTokens = estimateTokens(`${CORE_WHISPER_PREAMBLE}\n\n${personaText}`);

    if (approxTokens > packetTokenBudget) {
      logger.warn('Core packet exceeds soft budget; consider refactoring Core documents.', {
        context: LOG_CONTEXT,
        characterId,
        mountPointId,
        approxTokens,
        packetTokenBudget,
        fileCount: files.length,
        groupFileCount: groupFiles.length,
      });
    }

    return { files, approxTokens };
  } catch (error) {
    logger.error('[CoreWhisper] Failed to assemble Core packet', {
      context: LOG_CONTEXT,
      characterId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

/**
 * Read every `Core/*.md` file from a single store, de-duplicating on a
 * case-folded path and sorting by path (case-insensitive ascending). On a
 * case-fold collision (two distinct stored paths fold to the same key) logs
 * `logger.error` and keeps the lexicographically first stored path — a
 * vault-layer inconsistency we surface rather than paper over.
 */
async function readVaultCoreFiles(
  characterId: string,
  mountPointId: string,
): Promise<CoreFile[]> {
  const repos = getRepositories();
  const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    'Core',
    '.md',
    { recursive: true },
  );

  if (docs.length === 0) {
    return [];
  }

  const byKey = new Map<string, { path: string; content: string }>();
  for (const doc of docs) {
    const key = doc.relativePath.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      const winner =
        existing.path.localeCompare(doc.relativePath) <= 0
          ? existing.path
          : doc.relativePath;
      logger.error('[CoreWhisper] Two vault paths fold to the same key; keeping the lexicographically first', {
        context: LOG_CONTEXT,
        characterId,
        mountPointId,
        firstStoredPath: existing.path,
        secondStoredPath: doc.relativePath,
        kept: winner,
      });
      if (winner === existing.path) continue;
    }
    byKey.set(key, { path: doc.relativePath, content: doc.content ?? '' });
  }

  const sortedKeys = Array.from(byKey.keys()).sort();
  return sortedKeys.map((key) => {
    const entry = byKey.get(key)!;
    return { path: entry.path, body: stripFrontmatterBody(entry.content) };
  });
}

/**
 * Read the shared `Core/*.md` files from every group the character belongs to,
 * labeled by group name. Mounts already consumed by the character's own vault
 * (or by an earlier group, when two groups link the same store) are skipped so
 * no file is offered twice. Groups are emitted alphabetically by name. Fails
 * soft — group Core is supplementary; a lookup failure never blocks the
 * character's own Core.
 */
async function assembleGroupCoreFiles(
  characterId: string,
  characterMountPointId: string | null,
): Promise<CoreFile[]> {
  try {
    const repos = getRepositories();
    const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId);
    if (memberships.length === 0) {
      return [];
    }

    // Track mounts already accounted for so a store shared across the vault or
    // multiple groups is read once. Seed with the character's own vault.
    const seenMounts = new Set<string>();
    if (characterMountPointId) seenMounts.add(characterMountPointId);

    const groups: Array<{ name: string; mountIds: string[] }> = [];
    for (const membership of memberships) {
      try {
        const group = await repos.groups.findByIdRaw(membership.groupId);
        if (!group) continue;

        const mountIds: string[] = [];
        if (group.officialMountPointId && !seenMounts.has(group.officialMountPointId)) {
          seenMounts.add(group.officialMountPointId);
          mountIds.push(group.officialMountPointId);
        }
        const links = await repos.groupDocMountLinks.findByGroupId(membership.groupId);
        for (const link of links) {
          if (seenMounts.has(link.mountPointId)) continue;
          seenMounts.add(link.mountPointId);
          mountIds.push(link.mountPointId);
        }

        if (mountIds.length > 0) {
          groups.push({ name: group.name, mountIds });
        }
      } catch (error) {
        logger.warn('[CoreWhisper] Failed to resolve group Core mounts', {
          context: LOG_CONTEXT,
          characterId,
          groupId: membership.groupId,
          error: getErrorMessage(error),
        });
      }
    }

    groups.sort((a, b) => a.name.localeCompare(b.name));

    const result: CoreFile[] = [];
    for (const group of groups) {
      const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
        group.mountIds,
        'Core',
        '.md',
        { recursive: true },
      );
      if (docs.length === 0) continue;

      // First-wins dedup on case-folded path within the group, sorted by path.
      const byKey = new Map<string, { path: string; content: string }>();
      for (const doc of docs) {
        const key = doc.relativePath.toLowerCase();
        if (!byKey.has(key)) {
          byKey.set(key, { path: doc.relativePath, content: doc.content ?? '' });
        }
      }
      for (const key of Array.from(byKey.keys()).sort()) {
        const entry = byKey.get(key)!;
        result.push({
          path: entry.path,
          body: stripFrontmatterBody(entry.content),
          sourceLabel: group.name,
        });
      }
    }
    return result;
  } catch (error) {
    logger.warn('[CoreWhisper] Failed to assemble group Core files', {
      context: LOG_CONTEXT,
      characterId,
      error: getErrorMessage(error),
    });
    return [];
  }
}

function stripFrontmatterBody(content: string): string {
  if (!content) return '';
  const parsed = parseFrontmatter(content);
  if (parsed.data === null || parsed.bodyStartOffset === 0) {
    return content.replace(/^\n+/, '').replace(/\s+$/, '');
  }
  return content.slice(parsed.bodyStartOffset).replace(/^\n+/, '').replace(/\s+$/, '');
}

function renderPacketBodies(files: CoreFile[]): string {
  return files
    .map((f) => {
      const heading = f.sourceLabel ? `### [Shared — ${f.sourceLabel}] ${f.path}` : `### ${f.path}`;
      return `${heading}\n\n${f.body}`;
    })
    .join('\n\n');
}

/**
 * Persona-voiced transcript form. Persisted to the chat as Aurora's whisper
 * — visible in the Salon with Aurora's avatar.
 */
export function buildCoreWhisperContent(packet: CorePacket): string {
  const bodies = renderPacketBodies(packet.files);
  return `${AURORA_NARRATIVE_OPENER}\n\n${CORE_WHISPER_PREAMBLE}\n\n${bodies}`;
}

/**
 * Persona-stripped form. The context-builder swaps `content` → `opaqueContent`
 * in the LLM context of any participant whose `systemTransparency !== true`.
 */
export function buildCoreWhisperOpaqueContent(packet: CorePacket): string {
  const bodies = renderPacketBodies(packet.files);
  return `${CORE_WHISPER_PREAMBLE}\n\n${bodies}`;
}

/**
 * Plain second-person form for the LLM context. Inlined into the new user
 * message body — no Staff persona, no narrative meta. Closes with the
 * required advisory paragraph: this material is offered, not imposed.
 */
export function buildCoreWhisperLLMContext(packet: CorePacket): string {
  const bodies = renderPacketBodies(packet.files);
  return `${LLM_CONTEXT_OPENER}\n\n${CORE_WHISPER_PREAMBLE}\n\n${bodies}\n\n${CORE_WHISPER_ADVISORY}`;
}

interface PostCoreWhisperParams {
  chatId: string;
  /** Participant id of the responding character. Always set — single-character chats also target their one participant. */
  targetParticipantId: string;
  content: string;
  opaqueContent: string;
}

export async function postCoreWhisper(
  params: PostCoreWhisperParams,
): Promise<MessageEvent | null> {
  const { chatId, targetParticipantId, content, opaqueContent } = params;

  if (!content || content.trim().length === 0) return null;

  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(chatId);
    if (!chat) return null;

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
      systemSender: 'aurora',
      systemKind: 'core-whisper',
      targetParticipantIds: [targetParticipantId],
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[CoreWhisper] Whisper offered', {
      context: LOG_CONTEXT,
      chatId,
      messageId,
      targetParticipantId,
      contentLength: content.length,
    });

    return message;
  } catch (error) {
    logger.error('[CoreWhisper] Failed to post whisper', {
      context: LOG_CONTEXT,
      chatId,
      targetParticipantId,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}
