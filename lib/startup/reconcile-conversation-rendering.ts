/**
 * Conversation render/embed reconciliation (startup self-heal)
 *
 * Re-enqueues a CONVERSATION_RENDER job for every chat the Scriptorium pipeline
 * left half-finished:
 *
 *   (A) a chat with real USER/ASSISTANT messages but no rendered Markdown — the
 *       per-turn render trigger never fired or the render job died (e.g. an
 *       interrupted shutdown), so `renderedMarkdown` is still NULL; or
 *   (B) a chat whose interchange chunks were never embedded — the embedding
 *       provider was down when the turn fired (Ollama/cloud outage), or the
 *       render job died before enqueuing the embeds, leaving chunks with a NULL
 *       `embedding` blob ("yellow" in the chat list) and no recovery path.
 *
 * Re-running CONVERSATION_RENDER heals both: the render handler upserts the
 * interchange chunks (preserving any embeddings already present) and re-enqueues
 * EMBEDDING_GENERATE for every chunk still lacking one.
 *
 * Why every startup (not a one-time backfill): the gap recurs. New chats slip
 * through whenever the embedder is unavailable mid-conversation, and a hard
 * shutdown can drop an in-flight render. So this is a recurring safety net. It
 * is a no-op on a healthy instance — one indexed scan that returns nothing and
 * enqueues nothing.
 *
 * Why ENQUEUE rather than render inline: a large backlog must not block the
 * startup loading screen, and `enqueueConversationRender` already dedupes
 * against any render job still pending for the chat, so repeated boots before
 * the queue drains can't pile up duplicate work.
 *
 * Oversized / empty chunks are EXCLUDED from the "needs work" test. A chunk
 * larger than {@link EMBEDDING_MAX_CHARS} (or empty) is deterministically
 * unembeddable today — the embedder marks it FAILED without retry, and oversized
 * interchanges await renderer-side sub-chunking. Counting them would keep their
 * chat perpetually "incomplete" and re-render it on every boot for nothing.
 *
 * STALE chats are EXCLUDED too, via the same shared `isStale` gate the
 * maintenance sweeps use. The stale-chat cache collapse deliberately
 * cold-tiers quiet chats into exactly the state this scan reads as damage —
 * NULL `renderedMarkdown`, NULL chunk embeddings — and expects the Salon
 * reopen path (`lib/scriptorium/cold-chunk-reembed.ts`) to re-embed on
 * demand. Before this exclusion the two subsystems fought: every boot
 * re-rendered and re-embedded the entire cold tier (thousands of paid
 * embedding calls), and the next sweep cleared it all again. A stale chat is
 * healed when it is actually reopened or played, not at startup.
 *
 * Runs in the parent (the sole DB writer), like the other startup self-heals,
 * so the enqueue writes land directly rather than buffering through the job
 * child.
 *
 * @module startup/reconcile-conversation-rendering
 */
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { enqueueConversationRender } from '@/lib/background-jobs/queue-service';
import { EMBEDDING_MAX_CHARS } from '@/lib/embedding/embedding-service';
import { CHUNK_CHAR_BUDGET } from '@/lib/scriptorium/markdown-renderer';
import { getRepositories } from '@/lib/repositories/factory';
import { isStale } from '@/lib/background-jobs/maintenance/collapse-stale-chat-assets';
import {
  resolveStaleChatDays,
  retentionCutoff,
} from '@/lib/background-jobs/maintenance/retention-constants';

const logger = createServiceLogger('Startup:ConversationRenderReconcile');

/**
 * Chats that are not fully rendered + embedded, excluding chunks that can never
 * embed. The first `?` binds {@link EMBEDDING_MAX_CHARS}; the second binds the
 * current default embedding profile's id (or a sentinel matching nothing when
 * no profile exists). `updatedAt` rides along for the staleness gate's
 * no-played-messages fallback.
 *
 * The length guard alone is not enough: a chunk can sit under the 131,072-char
 * transport cap yet exceed the embedding model's token context (e.g. >8,192
 * tokens ≈ ~31k chars for text-embedding-3-large). Those fail deterministically
 * — `isPermanentEmbeddingError` marks them FAILED without retry — so any chunk
 * with a FAILED embedding_status for the profile the re-embed would actually
 * use is excluded from arm (B), or its chat would re-render and re-fail on
 * every boot.
 *
 * Arm (C) is the one exception that DOES pull those oversize chunks back in —
 * but only now that the renderer sub-chunks them (Bug 17). A chunk over the
 * per-chunk budget yet inside the transport cap predates interchange
 * sub-chunking; re-rendering splits it into in-context chunks that embed. This
 * is self-limiting (a re-rendered chat has no over-budget chunk left, so it
 * stops matching) and, like everything here, is gated by the stale-chat check
 * in the loop below — a cold-tiered chat is left for its reopen/next-played
 * heal, never resurrected at boot.
 */
const SELECT_INCOMPLETE_CHATS = `
  SELECT c."id" AS chatId, c."userId" AS userId, c."updatedAt" AS updatedAt
  FROM "chats" c
  WHERE (
    -- (A) Real messages but never rendered to Markdown.
    c."renderedMarkdown" IS NULL
    AND EXISTS (
      SELECT 1 FROM "chat_messages" m
      WHERE m."chatId" = c."id"
        AND m."type" = 'message'
        AND m."role" IN ('USER', 'ASSISTANT')
    )
  ) OR EXISTS (
    -- (B) At least one recoverable un-embedded interchange chunk
    --     (non-empty, within the embedder's size cap, and not already
    --     permanently FAILED for the current default profile).
    SELECT 1 FROM "conversation_chunks" cc
    WHERE cc."chatId" = c."id"
      AND cc."embedding" IS NULL
      AND LENGTH(cc."content") BETWEEN 1 AND ?
      AND NOT EXISTS (
        SELECT 1 FROM "embedding_status" es
        WHERE es."entityType" = 'CONVERSATION_CHUNK'
          AND es."entityId" = cc."id"
          AND es."profileId" = ?
          AND es."status" = 'FAILED'
      )
  ) OR EXISTS (
    -- (C) A sub-chunkable oversize chunk (Bug 17): un-embedded, over the
    --     per-chunk budget but still within the transport cap. Re-rendering now
    --     splits it into in-context chunks. FAILED status is deliberately NOT
    --     excluded — these are exactly the chunks arm (B) skips, and a re-render
    --     (not a re-embed) is what heals them. Self-limiting once split.
    SELECT 1 FROM "conversation_chunks" cc2
    WHERE cc2."chatId" = c."id"
      AND cc2."embedding" IS NULL
      AND LENGTH(cc2."content") > ?
      AND LENGTH(cc2."content") <= ?
  )
`;

export interface ConversationRenderReconcileResult {
  /** Distinct chats found to be incomplete. */
  incompleteChats: number;
  /** New render jobs enqueued. */
  enqueued: number;
  /** Chats that already had a render job pending (deduped). */
  reused: number;
  /** Chats whose enqueue threw (logged, sweep continues). */
  failed: number;
  /** Incomplete-looking chats skipped because they are stale (cold-tiered). */
  skippedStale: number;
}

interface IncompleteChatRow {
  chatId: string;
  userId: string;
  updatedAt: string | null;
}

/**
 * Scan for half-rendered / un-embedded conversations and re-enqueue a render
 * for each. Safe to call on every startup; idempotent and a no-op when every
 * conversation is already fully rendered and embedded.
 */
export async function reconcileConversationRendering(): Promise<ConversationRenderReconcileResult> {
  const result: ConversationRenderReconcileResult = {
    incompleteChats: 0,
    enqueued: 0,
    reused: 0,
    failed: 0,
    skippedStale: 0,
  };

  const db = getRawDatabase();
  if (!db) {
    logger.debug('No SQLite database available; skipping conversation render reconciliation');
    return result;
  }

  // Resolve the profile a re-embed would actually use — same selection the
  // render handler makes (default, else first). FAILED statuses are only
  // meaningful per profile: a chunk that failed under one profile may embed
  // fine under another, so the exclusion is scoped to this id. No profile →
  // bind a sentinel that matches no rows (the exclusion becomes a no-op).
  let defaultProfileId = '';
  try {
    const profiles = await getRepositories().embeddingProfiles.findAll();
    defaultProfileId = (profiles.find(p => p.isDefault) || profiles[0])?.id ?? '';
  } catch (err) {
    logger.warn('Failed to resolve default embedding profile; FAILED-status exclusion disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let rows: IncompleteChatRow[];
  try {
    rows = db
      .prepare(SELECT_INCOMPLETE_CHATS)
      .all(
        EMBEDDING_MAX_CHARS, // arm (B) size cap
        defaultProfileId, // arm (B) FAILED-status profile scope
        CHUNK_CHAR_BUDGET, // arm (C) lower bound (over the per-chunk budget)
        EMBEDDING_MAX_CHARS, // arm (C) upper bound (within the transport cap)
      ) as IncompleteChatRow[];
  } catch (err) {
    logger.warn('Failed to scan for incomplete conversations; skipping reconciliation', {
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  result.incompleteChats = rows.length;
  if (rows.length === 0) {
    return result;
  }

  logger.info('Conversation render reconciliation: found incomplete conversations', {
    count: rows.length,
  });

  // Staleness gate — same shared predicate and window as the maintenance
  // sweeps, so a chat the cache collapse cold-tiered is never "healed" here.
  const repos = getRepositories();
  const cutoffMs = retentionCutoff(await resolveStaleChatDays()).getTime();

  for (const row of rows) {
    try {
      if (await isStale({ id: row.chatId, updatedAt: row.updatedAt ?? '' }, cutoffMs, repos)) {
        result.skippedStale++;
        continue;
      }
    } catch (err) {
      // Unknown staleness → skip, don't heal. Healing a chat that is actually
      // cold-tiered re-enters the boot-time mass re-embed loop, while a
      // skipped chat still has a recovery path: the Salon open path re-embeds
      // any visited chat regardless of staleness.
      result.skippedStale++;
      logger.warn('Staleness check failed during reconciliation; skipping chat', {
        chatId: row.chatId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    try {
      const { isNew } = await enqueueConversationRender(row.userId, { chatId: row.chatId });
      if (isNew) {
        result.enqueued++;
      } else {
        result.reused++;
      }
    } catch (err) {
      result.failed++;
      logger.warn('Failed to enqueue conversation render during reconciliation', {
        chatId: row.chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Yield between enqueues so a large backlog can't hog the event loop while
    // the rest of startup is still settling.
    await new Promise(resolve => setImmediate(resolve));
  }

  logger.info('Conversation render reconciliation complete', {
    incompleteChats: result.incompleteChats,
    enqueued: result.enqueued,
    reused: result.reused,
    failed: result.failed,
    skippedStale: result.skippedStale,
  });

  return result;
}
