/**
 * Stale-chat cache collapse + conversation-chunk cold-tiering
 *
 * When a chat has gone quiet (no *played* message for the configured
 * retention window — see `resolveStaleChatDays`), the regenerable and
 * discardable working data it accumulated is dead weight:
 *
 *  - `chats.compressionCache`      — pre-compression cache; documented as
 *    regenerable with a synchronous-recompute fallback.
 *  - `chats.renderedMarkdown`      — Scriptorium render; rebuilt by any
 *    CONVERSATION_RENDER job.
 *  - `chat_messages.rawResponse`   — byte-exact provider payload; only read
 *    by generation-time services (failover/finalizer/regenerate), never by
 *    the historical read/render path.
 *  - `chat_messages.reasoningContent` / `reasoningSegments` — model thinking
 *    traces; DISPLAY ONLY, never re-fed to models.
 *  - `chat_messages.renderedHtml`  — pre-rendered HTML; the chat GET path
 *    re-renders from `content` live.
 *  - `chat_messages.debugMemoryLogs` — memory-gate debug telemetry.
 *
 * It also cold-tiers the chat's `conversation_chunks` embeddings (NULLs the
 * BLOB, keeps `content` for keyword search); the Salon chat-load path
 * re-embeds on demand (`lib/scriptorium/cold-chunk-reembed.ts`). Embeddings
 * are only cleared when their own `updatedAt` predates the staleness cutoff:
 * a reopen re-embed stamps the rows, so a chat the user merely *reads*
 * (never playing a message, so it stays "stale") keeps its warmth for a full
 * retention window from the reopen instead of being re-embedded (paid) on
 * every open and cleared again by every sweep.
 *
 * NEVER touched: `content` (authoritative display text), `opaqueContent`
 * (real semantic body used in context builds), `thoughtSignature` (provider
 * continuation token, tiny), `attachments`, `contextSummary`, `chats.state`,
 * memories, `summaryAnchor`.
 *
 * Gated on CHAT staleness via the same exported `isStale` the asset collapse
 * uses, so the sweeps can never disagree on "stale". An active chat is never
 * touched. NULLing frees pages inside the file; actual file shrink happens at
 * the periodic manual `npx quilltap db optimize` (VACUUM).
 *
 * Runs on the parent process (the only DB writer), invoked inline by the
 * maintenance scheduler like the asset collapse.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { rawQuery } from '@/lib/database/manager';
import { dropInMemoryCompressionCache } from '@/lib/services/chat-message/compression-cache.service';
import type { ChatMetadata } from '@/lib/schemas/types';
import { isStale } from './collapse-stale-chat-assets';
import { resolveStaleChatDays, retentionCutoff } from './retention-constants';

const moduleLogger = logger.child({ module: 'maintenance.collapse-stale-chat-caches' });

export interface StaleChatCacheCollapseSummary {
  /** Total chats examined. */
  chatsScanned: number;
  /** Chats found stale (eligible for collapse). */
  staleChats: number;
  /** Stale chats where at least one column/row was actually cleared. */
  chatsCollapsed: number;
  /** `chats` rows whose compressionCache/renderedMarkdown were cleared. */
  chatRowsCleared: number;
  /** `chat_messages` rows that had at least one discardable column cleared. */
  messageRowsCleared: number;
  /** `conversation_chunks` rows whose embedding was cold-tiered to NULL. */
  chunkEmbeddingsCleared: number;
}

interface RunResultLike {
  changes?: number | bigint;
}

/**
 * Collapse one stale chat's regenerable caches. Idempotent: every UPDATE is
 * guarded by `IS NOT NULL` checks, so a second pass rewrites nothing.
 */
async function collapseOneChat(
  chat: ChatMetadata,
  repos: ReturnType<typeof getRepositories>,
  cutoffIso: string,
): Promise<{ chatRows: number; messageRows: number; chunkEmbeddings: number }> {
  // 1. `chats` columns. Raw SQL (not repos.chats.update) so the chat's
  //    updatedAt is NOT bumped — a maintenance pass must never make a stale
  //    chat look freshly touched. The in-memory compression cache is dropped
  //    alongside so the service can't serve a stale entry it believes is
  //    still persisted.
  const chatResult = await rawQuery<RunResultLike>(
    `UPDATE chats SET compressionCache = NULL, renderedMarkdown = NULL
      WHERE id = ?
        AND (compressionCache IS NOT NULL OR renderedMarkdown IS NOT NULL)`,
    [chat.id],
  );
  const chatRows = Number(chatResult?.changes ?? 0);
  dropInMemoryCompressionCache(chat.id);

  // 2. `chat_messages` discardable columns, one guarded UPDATE per chat.
  const messageResult = await rawQuery<RunResultLike>(
    `UPDATE chat_messages
        SET rawResponse = NULL, reasoningContent = NULL, reasoningSegments = NULL,
            renderedHtml = NULL, debugMemoryLogs = NULL
      WHERE chatId = ?
        AND (rawResponse IS NOT NULL OR reasoningContent IS NOT NULL
          OR reasoningSegments IS NOT NULL OR renderedHtml IS NOT NULL
          OR debugMemoryLogs IS NOT NULL)`,
    [chat.id],
  );
  const messageRows = Number(messageResult?.changes ?? 0);

  // 3. Cold-tier the chat's conversation-chunk embeddings (keep content).
  //    Only embeddings older than the staleness cutoff: rows the reopen path
  //    re-embedded inside the window are recent warmth, not dead weight.
  const chunkEmbeddings = await repos.conversationChunks.clearEmbeddingsForChat(
    chat.id,
    cutoffIso,
  );

  if (chatRows > 0 || messageRows > 0 || chunkEmbeddings > 0) {
    moduleLogger.info('Collapsed stale chat caches', {
      chatId: chat.id,
      chatRows,
      messageRows,
      chunkEmbeddings,
    });
  }

  return { chatRows, messageRows, chunkEmbeddings };
}

/**
 * Collapse every stale chat's regenerable caches and cold-tier its chunk
 * embeddings. Each chat is processed independently so one failure cannot
 * abort the rest.
 */
export async function collapseStaleChatCaches(
  now: number = Date.now(),
): Promise<StaleChatCacheCollapseSummary> {
  const repos = getRepositories();
  const cutoff = retentionCutoff(await resolveStaleChatDays(), now);
  const cutoffMs = cutoff.getTime();
  const cutoffIso = cutoff.toISOString();

  const allChats = await repos.chats.findAll();
  const summary: StaleChatCacheCollapseSummary = {
    chatsScanned: allChats.length,
    staleChats: 0,
    chatsCollapsed: 0,
    chatRowsCleared: 0,
    messageRowsCleared: 0,
    chunkEmbeddingsCleared: 0,
  };

  for (const chat of allChats) {
    if (!(await isStale(chat, cutoffMs, repos))) continue;
    summary.staleChats++;
    try {
      const { chatRows, messageRows, chunkEmbeddings } = await collapseOneChat(
        chat,
        repos,
        cutoffIso,
      );
      if (chatRows > 0 || messageRows > 0 || chunkEmbeddings > 0) {
        summary.chatsCollapsed++;
        summary.chatRowsCleared += chatRows;
        summary.messageRowsCleared += messageRows;
        summary.chunkEmbeddingsCleared += chunkEmbeddings;
      }
    } catch (error) {
      moduleLogger.warn('Failed to collapse stale chat caches — continuing', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  moduleLogger.info('Stale-chat cache collapse complete', { ...summary });
  return summary;
}
