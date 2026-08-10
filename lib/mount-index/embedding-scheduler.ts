/**
 * Mount Index Embedding Scheduler
 *
 * Enqueues EMBEDDING_GENERATE background jobs for document mount chunks
 * that don't yet have embeddings. Uses the same embedding infrastructure
 * as memories and conversation chunks.
 *
 * @module mount-index/embedding-scheduler
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { enqueueEmbeddingGenerate } from '@/lib/background-jobs/queue-service';

const logger = createServiceLogger('MountIndex:EmbeddingScheduler');

/**
 * Enqueue embedding jobs for all un-embedded chunks in a mount point.
 *
 * Finds all chunks without embeddings, determines the user's default
 * embedding profile, and enqueues an EMBEDDING_GENERATE job for each.
 *
 * @param mountPointId - The mount point whose chunks need embedding
 */
export async function enqueueEmbeddingJobsForMountPoint(mountPointId: string): Promise<number> {
  const repos = getRepositories();

  // Per-document `embed:false` policy is the single steady-state enforcement
  // point for embeddings: this scheduler both (a) skips enqueueing for blocked
  // links and (b) erases any vectors a blocked link still carries (e.g. the
  // flag flipped after the doc was already embedded). Build the allow map and
  // the blocked-link set up front from the link rows.
  const links = await repos.docMountFileLinks.findByMountPointId(mountPointId);
  const allowEmbedByLink = new Map<string, boolean>();
  const blockedLinkIds: string[] = [];
  for (const link of links) {
    allowEmbedByLink.set(link.id, link.allowEmbed);
    if (!link.allowEmbed) blockedLinkIds.push(link.id);
  }

  // Erase lingering embeddings for blocked links (NULL, don't delete — chunk
  // text survives and re-embedding is possible if the flag flips back). The
  // repository invalidates the mount-chunk cache for any link it actually
  // clears, so freshly-NULLed vectors don't linger in memory.
  for (const linkId of blockedLinkIds) {
    try {
      await repos.docMountChunks.clearEmbeddingsByLinkId(linkId);
    } catch (error) {
      logger.warn('Failed to clear embeddings for embed:false link', {
        mountPointId,
        linkId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Find chunks without embeddings for this mount point, skipping any whose
  // link is `embed:false` (a link absent from the map — e.g. a chunk whose link
  // row was just deleted — defaults to allowed, preserving prior behaviour).
  const allChunks = await repos.docMountChunks.findByMountPointId(mountPointId);
  const unembeddedChunks = allChunks.filter(
    chunk =>
      (!chunk.embedding || chunk.embedding.length === 0) &&
      allowEmbedByLink.get(chunk.linkId) !== false
  );

  if (unembeddedChunks.length === 0) {
    return 0;
  }

  // The **default** embedding profile, and only the default: every vector in
  // the instance — memories, conversation chunks, help docs, mount chunks —
  // must come from the same profile, or semantic search silently compares
  // apples to oranges. No fallback to an arbitrary profile: with no default
  // marked, these chunks wait (the startup reconcile re-enqueues them once
  // one is configured), exactly as memories do.
  const profiles = await repos.embeddingProfiles.findAll();
  const defaultProfile = profiles.find(p => p.isDefault);

  if (!defaultProfile) {
    logger.warn('No default embedding profile configured, skipping mount chunk embedding', {
      mountPointId,
      unembeddedCount: unembeddedChunks.length,
    });
    return 0;
  }

  // Get the user ID (single-user system — use the first user)
  const users = await repos.users.findAll();
  const userId = users[0]?.id;

  if (!userId) {
    logger.warn('No user found, skipping mount chunk embedding', { mountPointId });
    return 0;
  }

  logger.info('Enqueuing embedding jobs for mount chunks', {
    mountPointId,
    chunkCount: unembeddedChunks.length,
    profileId: defaultProfile.id,
    profileName: defaultProfile.name,
  });

  let enqueued = 0;

  for (const chunk of unembeddedChunks) {
    try {
      const result = await enqueueEmbeddingGenerate(userId, {
        entityType: 'MOUNT_CHUNK',
        entityId: chunk.id,
        profileId: defaultProfile.id,
      });

      if (result.isNew) {
        enqueued++;
      }
    } catch (error) {
      logger.warn('Failed to enqueue embedding job for mount chunk', {
        chunkId: chunk.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Embedding job enqueueing complete', {
    mountPointId,
    totalChunks: unembeddedChunks.length,
    enqueued,
  });

  return enqueued;
}
