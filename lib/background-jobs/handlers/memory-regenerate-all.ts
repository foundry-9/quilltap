/**
 * Memory Regenerate All — Fan-Out Job Handler
 *
 * The HTTP endpoint POST /api/v1/memories?action=regenerate-all enqueues
 * exactly one of these and returns immediately. The actual chat
 * enumeration and per-chat enqueues happen here, in the background, so
 * the operator never blocks waiting on a 2-minute request.
 *
 * Steps:
 * 1. List every chat the user owns; build a Set of valid chatIds.
 * 2. Run one DISTINCT query against the memories table to find orphan
 *    chatIds (memory rows whose chat has been deleted).
 * 3. Snapshot the in-flight job set ONCE (rather than per-call inside
 *    enqueueMemoryRegenerateChat) so the per-chat enqueues skip their
 *    own dedup queries.
 * 4. Enqueue MEMORY_REGENERATE_CHAT per chat (route dangerous chats
 *    through the dangerous-compatible cheap profile when one's set) and
 *    per orphan chatId.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import {
  enqueueMemoryRegenerateChat,
  type MemoryRegenerateAllPayload,
  type MemoryRegenerateChatPayload,
} from '../queue-service';
import { logger } from '@/lib/logger';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';

export async function handleMemoryRegenerateAll(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as MemoryRegenerateAllPayload;
  const repos = getRepositories();

  const userChats = await repos.chats.findByUserId(job.userId);
  const validChatIds = new Set<string>(userChats.map((c: { id: string }) => c.id));

  // Snapshot in-flight regenerate-chat jobs once so the per-chat enqueues
  // can short-circuit their dedup scans (which previously hit the DB twice
  // per call, turning N enqueues into 2N queries).
  const pending = await repos.backgroundJobs.findByUserId(job.userId, 'PENDING');
  const processing = await repos.backgroundJobs.findByUserId(job.userId, 'PROCESSING');
  const inFlightChatIds = new Set<string>();
  for (const j of [...pending, ...processing]) {
    if (j.type !== 'MEMORY_REGENERATE_CHAT') continue;
    const p = j.payload as unknown as MemoryRegenerateChatPayload;
    if (p?.chatId) inFlightChatIds.add(p.chatId);
  }

  let chatsQueued = 0;
  let dangerousRouted = 0;
  let chatsSkippedDuplicate = 0;
  for (const chat of userChats) {
    if (inFlightChatIds.has(chat.id)) {
      chatsSkippedDuplicate++;
      continue;
    }
    // Off-duty chats forfeit the dangerous profile — the operator has
    // explicitly opted them out of any uncensored routing for the chat.
    const effectivelyDangerous = shouldUseUncensoredRoute(chat);
    const profileId =
      effectivelyDangerous ? payload.dangerousProfileId : payload.standardProfileId;
    if (effectivelyDangerous && profileId !== payload.standardProfileId) {
      dangerousRouted++;
    }
    try {
      await enqueueMemoryRegenerateChat(job.userId, {
        chatId: chat.id,
        connectionProfileId: profileId,
      });
      chatsQueued++;
    } catch (error) {
      logger.error('[MemoryRegenerateAll] Failed to enqueue per-chat wipe', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Orphan detection via a single SELECT DISTINCT — the previous
  // implementation walked every character's memories, which on a 32k-memory
  // instance was the dominant cost.
  const distinctChatIds = await repos.memories.findDistinctChatIds();
  const orphanChatIds: string[] = [];
  for (const chatId of distinctChatIds) {
    if (validChatIds.has(chatId)) continue;
    if (inFlightChatIds.has(chatId)) continue;
    orphanChatIds.push(chatId);
  }

  let orphansQueued = 0;
  for (const orphanChatId of orphanChatIds) {
    try {
      await enqueueMemoryRegenerateChat(job.userId, {
        chatId: orphanChatId,
        connectionProfileId: payload.standardProfileId,
      });
      orphansQueued++;
    } catch (error) {
      logger.error('[MemoryRegenerateAll] Failed to enqueue orphan wipe', {
        orphanChatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('[MemoryRegenerateAll] Fan-out complete', {
    jobId: job.id,
    chatsQueued,
    chatsSkippedDuplicate,
    dangerousRouted,
    orphansQueued,
    standardProfileId: payload.standardProfileId,
    dangerousProfileId: payload.dangerousProfileId,
  });
}
