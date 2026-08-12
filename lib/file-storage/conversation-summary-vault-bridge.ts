/**
 * Conversation Summary Vault Bridge
 *
 * Mirrors a conversation's rolling context summary into every participant
 * character's vault as a managed markdown file under `Conversation Summaries/`.
 * Part A of improving the Commonplace Book retrieval system: because vault
 * documents are chunked and embedded, depositing the summary here makes past
 * conversations retrievable per-character.
 *
 * The file carries YAML frontmatter — most importantly the conversation UUID —
 * so each regeneration can find-and-replace its own prior file even after the
 * conversation has been renamed, and so deletion of the conversation can sweep
 * the matching file out of every vault.
 *
 * Like the avatar / Lantern bridges, the write/delete paths short-circuit to
 * the parent via host-RPC when running inside the forked job child
 * (`QUILLTAP_JOB_CHILD === '1'`): `writeDatabaseDocument` issues real
 * `doc_mount_*` inserts whose server-computed ids the child's buffered-write
 * proxy can't model, and we want the documents committed on the RW connection
 * independently of the job's later buffered writes.
 *
 * @module file-storage/conversation-summary-vault-bridge
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getCharacterVaultStore } from './character-vault-bridge';
import { sanitizeLeafName } from './bridge-path-helpers';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
  listDatabaseFiles,
  readDatabaseDocument,
  databaseDocumentExists,
} from '@/lib/mount-index/database-store';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import type { ChatEvent, MessageEvent } from '@/lib/schemas/types';

/** Folder, inside each character vault, that holds conversation summaries. */
export const SUMMARIES_FOLDER = 'Conversation Summaries';

/** Frontmatter `type` marker stamped on every summary file we author. */
export const SUMMARY_FRONTMATTER_TYPE = 'conversation-summary';

/**
 * Is this a "real" conversational message — authored by an LLM or user
 * character — as opposed to an announcement, whisper, or other synthetic
 * Staff message?
 *
 * Mirrors the filter in `partitionMessagesIntoTurns` (skip non-`message`
 * events, non-USER/ASSISTANT roles, and `systemSender` messages) and, per the
 * summary-file spec, additionally drops whispers (`targetParticipantIds`
 * non-empty) and user-authored announcement bubbles (`customAnnouncer`).
 */
export function isConversationalMessage(event: ChatEvent): event is MessageEvent {
  if (event.type !== 'message') return false;
  const m = event as MessageEvent;
  if (m.role !== 'USER' && m.role !== 'ASSISTANT') return false;
  if (m.systemSender) return false;
  if (m.customAnnouncer) return false;
  if (Array.isArray(m.targetParticipantIds) && m.targetParticipantIds.length > 0) return false;
  return true;
}

export interface SummaryConversationStats {
  /** Count of real (non-announcement, non-whisper) USER/ASSISTANT messages. */
  messageCount: number;
  /** ISO timestamp of the first real message, or null when there are none. */
  firstMessageAt: string | null;
  /** ISO timestamp of the last real message, or null when there are none. */
  lastMessageAt: string | null;
}

/**
 * Derive the real-message count and first/last timestamps from a chat's full
 * event stream. `events` is expected in ascending `createdAt` order (the order
 * `repos.chats.getMessages` returns), so first/last are simply the first and
 * last matches.
 */
export function computeConversationStats(events: ChatEvent[]): SummaryConversationStats {
  let messageCount = 0;
  let firstMessageAt: string | null = null;
  let lastMessageAt: string | null = null;
  for (const event of events) {
    if (!isConversationalMessage(event)) continue;
    messageCount += 1;
    if (firstMessageAt === null) firstMessageAt = event.createdAt;
    lastMessageAt = event.createdAt;
  }
  return { messageCount, firstMessageAt, lastMessageAt };
}

export interface WriteConversationSummaryInput {
  chatId: string;
  chatTitle: string;
  summary: string;
  /** `chat.compactionGeneration` after the fold that produced this summary. */
  summaryGeneration: number;
  /** All participant character ids (both llm- and user-controlled). */
  participantCharacterIds: string[];
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  /** ISO timestamp stamped into frontmatter as `updatedAt`. */
  updatedAt: string;
}

export interface RemoveConversationSummaryInput {
  chatId: string;
  participantCharacterIds: string[];
}

/** Resolve `{ id, name }` for each character via the raw read (survives a broken vault). */
async function resolveCast(
  characterIds: string[]
): Promise<Array<{ id: string; name: string }>> {
  const repos = getRepositories();
  const cast: Array<{ id: string; name: string }> = [];
  for (const id of characterIds) {
    try {
      const character = await repos.characters.findByIdRaw(id);
      if (character) cast.push({ id, name: character.name });
    } catch (error) {
      logger.debug('Skipping character during summary cast resolution', {
        context: 'file-storage.conversation-summary-vault-bridge',
        characterId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return cast;
}

/** Build the full markdown file body (frontmatter + summary). */
function buildSummaryFile(
  input: WriteConversationSummaryInput,
  cast: Array<{ id: string; name: string }>
): string {
  const frontmatter = serializeFrontmatter({
    type: SUMMARY_FRONTMATTER_TYPE,
    conversationId: input.chatId,
    conversationTitle: input.chatTitle,
    characters: cast.map(c => c.name),
    characterIds: cast.map(c => c.id),
    messageCount: input.messageCount,
    firstMessageAt: input.firstMessageAt,
    lastMessageAt: input.lastMessageAt,
    summaryGeneration: input.summaryGeneration,
    updatedAt: input.updatedAt,
  });
  return `${frontmatter}\n${input.summary.trim()}\n`;
}

/** Target filename for a conversation, from its current title. */
function summaryFileName(chatId: string, chatTitle: string): string {
  const stem = sanitizeLeafName(chatTitle);
  return `${stem && stem !== 'unnamed' ? stem : `conversation-${chatId}`}.md`;
}

/**
 * List the `.md` files currently in a vault's `Conversation Summaries/` folder
 * whose frontmatter `conversationId` matches `chatId`. Returns their relative
 * paths.
 */
async function findExistingSummaryPaths(
  mountPointId: string,
  chatId: string
): Promise<string[]> {
  const entries = await listDatabaseFiles(mountPointId, { folder: SUMMARIES_FOLDER });
  const matches: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'folder') continue;
    if (!entry.relativePath.toLowerCase().endsWith('.md')) continue;
    try {
      const { content } = await readDatabaseDocument(mountPointId, entry.relativePath);
      const { data } = parseFrontmatter(content);
      if (data && data.conversationId === chatId) matches.push(entry.relativePath);
    } catch {
      // Unreadable/garbled file — leave it alone.
    }
  }
  return matches;
}

/**
 * Write (or replace) the conversation's summary file in every participant
 * character's vault. Best-effort per character: one bad vault never aborts the
 * rest, and a failure never propagates to the caller (the summary itself is
 * already persisted on the chat row by the time we run).
 */
export async function writeConversationSummaryToVaults(
  input: WriteConversationSummaryInput
): Promise<void> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    await callHost<void>('writeConversationSummaryToVaults', input);
    return;
  }

  const cast = await resolveCast(input.participantCharacterIds);
  const body = buildSummaryFile(input, cast);
  const desiredName = summaryFileName(input.chatId, input.chatTitle);

  for (const characterId of input.participantCharacterIds) {
    try {
      // Archived characters keep a live (pruned) vault, but `Conversation
      // Summaries/` is part of what the archive packed away — writing here
      // would silently resurrect the folder outside the bundle. Skip them;
      // rehydration restores the folder and future summaries resume.
      const raw = await getRepositories().characters.findByIdRaw(characterId);
      if (raw?.archivedAt) {
        logger.debug('Skipping conversation summary write for archived character', {
          context: 'file-storage.conversation-summary-vault-bridge',
          chatId: input.chatId,
          characterId,
        });
        continue;
      }

      const target = await getCharacterVaultStore(characterId);
      if (!target) continue;

      await ensureFolderPath(target.mountPointId, SUMMARIES_FOLDER);

      // Replace-by-UUID: drop any prior file for this conversation, even if it
      // was written under a different (older) title.
      const priorPaths = await findExistingSummaryPaths(target.mountPointId, input.chatId);
      for (const priorPath of priorPaths) {
        await deleteDatabaseDocument(target.mountPointId, priorPath);
      }

      // Cross-conversation collision guard: if the desired name is now taken by
      // a *different* conversation, disambiguate with the short chat id.
      let fileName = desiredName;
      let relativePath = `${SUMMARIES_FOLDER}/${fileName}`;
      if (await databaseDocumentExists(target.mountPointId, relativePath)) {
        const stem = fileName.replace(/\.md$/i, '');
        fileName = `${stem} (${input.chatId.slice(0, 8)}).md`;
        relativePath = `${SUMMARIES_FOLDER}/${fileName}`;
      }

      await writeDatabaseDocument(target.mountPointId, relativePath, body);
    } catch (error) {
      logger.warn('Failed to write conversation summary to a character vault', {
        context: 'file-storage.conversation-summary-vault-bridge',
        chatId: input.chatId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Remove the conversation's summary file from every participant character's
 * vault (matched by frontmatter `conversationId`). Called when the conversation
 * is deleted. Best-effort per character.
 */
export async function removeConversationSummariesFromVaults(
  input: RemoveConversationSummaryInput
): Promise<void> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    await callHost<void>('removeConversationSummariesFromVaults', input);
    return;
  }

  for (const characterId of input.participantCharacterIds) {
    try {
      const target = await getCharacterVaultStore(characterId);
      if (!target) continue;

      const paths = await findExistingSummaryPaths(target.mountPointId, input.chatId);
      for (const path of paths) {
        await deleteDatabaseDocument(target.mountPointId, path);
      }

      if (paths.length > 0) {
        logger.debug('Removed conversation summary from character vault', {
          context: 'file-storage.conversation-summary-vault-bridge',
          chatId: input.chatId,
          characterId,
          mountPointId: target.mountPointId,
          removed: paths.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to remove conversation summary from a character vault', {
        context: 'file-storage.conversation-summary-vault-bridge',
        chatId: input.chatId,
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
