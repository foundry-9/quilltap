/**
 * Stale-chat asset collapse
 *
 * When a chat has gone quiet (no activity for STALE_CHAT_RETENTION_DAYS), the
 * generated story-backgrounds and wardrobe avatars it accumulated over its
 * lifetime are mostly dead weight: only the *currently-referenced* ones
 * (`chat.storyBackgroundImageId` and each `chat.characterAvatars[].imageId`)
 * still matter. This sweep deletes every other GENERATED image linked to the
 * stale chat, releasing the orphaned bytes through the existing hard-link GC.
 *
 * It is gated on CHAT staleness, never per-asset age — an active chat is never
 * touched no matter how many backgrounds it has piled up. The collapse is
 * non-destructive to the story: it removes only superseded background/avatar
 * variants, never messages or memories.
 *
 * ## Why this runs on the parent process
 * Deletion bottoms out in `docMountFileLinks.deleteWithGC`, which opens a write
 * transaction on the raw mount-index DB. That is impossible in the forked job
 * child (readonly connection + buffered writes), so this is invoked inline by
 * the parent-side maintenance scheduler, not as a background job.
 *
 * ## What it stores vs. what the spec assumed
 * `chat.storyBackgroundImageId` and `chat.characterAvatars[].imageId` hold
 * **`files.id`** values (freshly minted UUIDs used as the `files`-row PK by the
 * story-background / character-avatar handlers) — NOT `doc_mount_file_links.id`.
 * So we enumerate via `repos.files.findByLinkedTo(chatId)` and delete through
 * the end-to-end `deleteFileCompletely` chokepoint, which internally walks
 * `files.storageKey` → mount blob → `deleteWithGC`. Imports (or a future
 * migration) can still land link ids in those fields, so the keep-set is
 * resolved through `resolveCharacterAvatar` (link-id first, files.id fallback)
 * and matched on both id AND content sha256.
 *
 * ## Safety
 * A generated image the user saved to an album/gallery or promoted to a
 * character default is intentional content and must survive. We skip a
 * candidate when ANY of these holds (when unsure, skip):
 *  - its id is in the keep-set, or its sha256 matches a kept asset's sha256;
 *  - its bytes also surface as a `photos/` album link or a 'character'-vault
 *    link (via the sha256 reverse index); or
 *  - the file is referenced as a character `defaultImageId` or an
 *    `avatarOverrides[].imageId`.
 *
 * And if a chat's keep-set can't be fully resolved (a keep-id resolution
 * throws), the whole chat's collapse is skipped for that run rather than risk
 * deleting a current asset whose protecting sha256 went missing.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { resolveCharacterAvatar } from '@/lib/photos/resolve-character-avatar';
import { getPhotoLinkSummaryBySha256 } from '@/lib/photos/photo-link-summary';
import { deleteFileCompletely } from '@/lib/cascade-delete';
import type { ChatMetadata, FileEntry } from '@/lib/schemas/types';
import { resolveStaleChatDays, retentionCutoff } from './retention-constants';

const moduleLogger = logger.child({ module: 'maintenance.collapse-stale-chat-assets' });

export interface StaleChatCollapseSummary {
  /** Total chats examined. */
  chatsScanned: number;
  /** Chats found stale (eligible for collapse). */
  staleChats: number;
  /** Stale chats from which at least one asset was deleted. */
  chatsCollapsed: number;
  /** Superseded generated `files` rows deleted. */
  filesDeleted: number;
  /**
   * Best-effort upper bound on bytes reclaimed (sum of deleted files' recorded
   * sizes). Actual reclaim is lower when bytes are shared via sha256 dedup and
   * survive the hard-link GC — we don't thread the per-link `fileGC` flag back
   * through the deletion chokepoint, so this is an estimate, not a guarantee.
   */
  bytesReleasedEstimate: number;
}

/**
 * True when the chat's last *played* activity is older than the staleness
 * cutoff. "Played" means a message authored by a participant character or the
 * human user — `getLastPlayedMessageAt` excludes Staff / personified-feature
 * announcements (Lantern, Aurora, Host, Prospero, Carina, Concierge, Commonplace
 * Book, Ariel, Suparṇā, Librarian), which persist as `type: 'message'` rows and
 * therefore bump the chat's `lastMessageAt` even though no character actually
 * spoke. We must NOT let such a whisper keep a quiet chat's images alive.
 *
 * Falls back to `chat.updatedAt` only when the chat has no played messages at
 * all (a brand-new or transcript-less chat), matching the previous "unknown
 * activity — never touch" safety: a null/NaN timestamp is never stale.
 *
 * Exported as THE staleness gate for every stale-gated maintenance sweep
 * (asset collapse, cache collapse, chunk cold-tiering) AND for the startup
 * render/embed reconcile, so they can never disagree on what "stale" means.
 * The reconcile MUST use this gate: cold-tiering deliberately leaves stale
 * chats with NULL `renderedMarkdown` and NULL chunk embeddings, and a
 * reconcile that can't tell "cold-tiered" from "broken" re-embeds the entire
 * cold tier on every boot just for the next sweep to clear it again.
 *
 * Takes only the fields it reads (`id`, `updatedAt`) so callers that scan
 * with raw SQL don't have to hydrate full ChatMetadata rows.
 */
export async function isStale(
  chat: Pick<ChatMetadata, 'id' | 'updatedAt'>,
  cutoffMs: number,
  repos: ReturnType<typeof getRepositories>,
): Promise<boolean> {
  const lastPlayedAt = await repos.chats.getLastPlayedMessageAt(chat.id);
  const lastActivity = lastPlayedAt ?? chat.updatedAt;
  if (!lastActivity) return false; // unknown activity — never touch
  const ms = new Date(lastActivity).getTime();
  if (Number.isNaN(ms)) return false;
  return ms < cutoffMs;
}

/**
 * Walk every chat and apply `collapse` to each one that is stale at
 * `cutoffMs`. Chats are processed independently: a throw is handed to
 * `onFailure` and the walk continues, so one bad chat cannot abort the rest.
 * Staleness is decided one chat at a time through {@link isStale} —
 * deliberately not batched — so every stale-gated sweep asks the identical
 * question.
 *
 * @returns how many chats were scanned and how many of them were stale
 */
export async function forEachStaleChat(
  repos: ReturnType<typeof getRepositories>,
  cutoffMs: number,
  collapse: (chat: ChatMetadata) => Promise<void>,
  onFailure: (chat: ChatMetadata, error: unknown) => void,
): Promise<{ chatsScanned: number; staleChats: number }> {
  const allChats = await repos.chats.findAll();
  let staleChats = 0;
  for (const chat of allChats) {
    if (!(await isStale(chat, cutoffMs, repos))) continue;
    staleChats++;
    try {
      await collapse(chat);
    } catch (error) {
      onFailure(chat, error);
    }
  }
  return { chatsScanned: allChats.length, staleChats };
}

/**
 * Build the keep-set for a chat: the ids it currently references plus their
 * resolved content hashes, so a current asset is protected regardless of
 * whether the field holds a `files.id` or a `doc_mount_file_links.id`.
 */
async function buildKeepSet(
  chat: ChatMetadata,
  repos: ReturnType<typeof getRepositories>,
): Promise<{ keepIds: Set<string>; keepShas: Set<string> }> {
  const keepIds = new Set<string>();
  const keepShas = new Set<string>();

  const candidateIds: string[] = [];
  if (chat.storyBackgroundImageId) candidateIds.push(chat.storyBackgroundImageId);

  // characterAvatars is an object map keyed by characterId:
  //   { [characterId]: { imageId, generatedAt, afterMessageCount } }
  const avatars = chat.characterAvatars;
  if (avatars && typeof avatars === 'object') {
    for (const entry of Object.values(avatars as Record<string, unknown>)) {
      if (entry && typeof entry === 'object') {
        const imageId = (entry as { imageId?: unknown }).imageId;
        if (typeof imageId === 'string' && imageId) candidateIds.push(imageId);
      }
    }
  }

  for (const id of candidateIds) {
    keepIds.add(id);
    // Let resolution errors propagate. An incomplete keep-set is dangerous:
    // in the link-id case the current background/avatar is guarded ONLY by its
    // sha256 (the raw stored link-id won't match a candidate's files.id), so a
    // transient resolve failure that drops the sha could make the *current*
    // asset look deletable. The caller wraps each chat in try/catch, so a throw
    // here aborts this chat's collapse before any deletion ("when unsure,
    // skip") and it retries on the next sweep. A clean `null` (the id resolves
    // to nothing in either table) is safe: there is no live asset to protect.
    const resolved = await resolveCharacterAvatar(id, repos);
    if (resolved?.sha256) keepShas.add(resolved.sha256);
  }

  return { keepIds, keepShas };
}

/**
 * Decide whether a candidate generated image is safe to delete. Returns a
 * reason string when it must be SKIPPED, or null when it is safe to reap.
 */
async function skipReason(
  file: FileEntry,
  keepIds: Set<string>,
  keepShas: Set<string>,
  repos: ReturnType<typeof getRepositories>,
): Promise<string | null> {
  if (keepIds.has(file.id)) return 'current';
  if (file.sha256 && keepShas.has(file.sha256)) return 'current-sha';

  // Saved to a character album / user gallery, or hard-linked into a vault:
  // intentional content the user kept. The bytes are deduped by sha256, so any
  // such save surfaces here regardless of which feature created it.
  if (file.sha256) {
    const summary = await getPhotoLinkSummaryBySha256(file.sha256, repos);
    if (summary.linkers.some((l) => l.isPhotoAlbum || l.mountStoreType === 'character')) {
      return 'album-or-vault-link';
    }
  }

  // Promoted to a character default or used as an avatar override (possibly in
  // another, still-active chat): character-level content, out of scope.
  const [asDefault, asOverride] = await Promise.all([
    repos.characters.findByDefaultImageId(file.id),
    repos.characters.findByAvatarOverrideImageId(file.id),
  ]);
  if (asDefault.length > 0 || asOverride.length > 0) return 'character-reference';

  return null;
}

/** Collapse a single stale chat. Idempotent — a no-op once already collapsed. */
async function collapseOneChat(
  chat: ChatMetadata,
  repos: ReturnType<typeof getRepositories>,
): Promise<{ deleted: number; bytes: number }> {
  const { keepIds, keepShas } = await buildKeepSet(chat, repos);

  // Generated story-backgrounds AND wardrobe avatars both land as files rows
  // with the chatId in linkedTo and source/category = GENERATED/IMAGE. By
  // construction the only chat in a generated asset's linkedTo is this one
  // (the rest are characterIds), so this never reaches another chat's assets.
  const linked = await repos.files.findByLinkedTo(chat.id);
  const candidates = linked.filter((f) => f.source === 'GENERATED' && f.category === 'IMAGE');

  let deleted = 0;
  let bytes = 0;

  for (const file of candidates) {
    const skip = await skipReason(file, keepIds, keepShas, repos);
    if (skip) {
      continue;
    }

    const removed = await deleteFileCompletely(file.id);
    if (removed) {
      deleted++;
      bytes += file.size ?? 0;
    }
  }

  if (deleted > 0) {
    moduleLogger.info('Collapsed stale chat assets', {
      chatId: chat.id,
      deleted,
      bytesReleasedEstimate: bytes,
    });
  }

  return { deleted, bytes };
}

/**
 * Collapse every stale chat's superseded generated assets. Each chat is
 * processed independently so one failure cannot abort the rest.
 */
export async function collapseStaleChatAssets(
  now: number = Date.now(),
): Promise<StaleChatCollapseSummary> {
  const repos = getRepositories();
  const cutoffMs = retentionCutoff(await resolveStaleChatDays(), now).getTime();

  let chatsCollapsed = 0;
  let filesDeleted = 0;
  let bytesReleasedEstimate = 0;

  const { chatsScanned, staleChats } = await forEachStaleChat(
    repos,
    cutoffMs,
    async (chat) => {
      const { deleted, bytes } = await collapseOneChat(chat, repos);
      if (deleted > 0) {
        chatsCollapsed++;
        filesDeleted += deleted;
        bytesReleasedEstimate += bytes;
      }
    },
    (chat, error) => {
      moduleLogger.warn('Failed to collapse stale chat — continuing', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );

  const summary: StaleChatCollapseSummary = {
    chatsScanned,
    staleChats,
    chatsCollapsed,
    filesDeleted,
    bytesReleasedEstimate,
  };
  moduleLogger.info('Stale-chat asset collapse complete', summary);
  return summary;
}
