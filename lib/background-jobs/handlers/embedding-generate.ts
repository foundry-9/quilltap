/**
 * Embedding Generate Job Handler
 *
 * Handles EMBEDDING_GENERATE background jobs by generating an embedding
 * for a single entity (memory) using the configured embedding profile.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { EMBEDDING_MAX_CHARS, generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { getVectorStoreManager } from '@/lib/embedding/vector-store';
import { getVectorIndicesRepository } from '@/lib/database/repositories/vector-indices.repository';
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache';
import { helpChunkEmbeddingText } from '@/lib/help/help-doc-chunking';
import { logger } from '@/lib/logger';
import type { EmbeddingGeneratePayload } from '../queue-service';

type EmbeddingEntityType = 'MEMORY' | 'CONVERSATION_CHUNK' | 'HELP_DOC' | 'MOUNT_CHUNK';

/**
 * Whether an embedding failure is deterministic — i.e. retrying the exact same
 * input will fail again. Such jobs should be marked failed and dropped, not
 * retried to DEAD. (Tens of thousands of DEAD EMBEDDING_GENERATE rows had
 * accumulated from exactly this: the same over-context / NaN / dimension-
 * mismatch inputs retried three times each, forever.) Transient errors
 * ("fetch failed", timeouts, connection resets) deliberately do NOT match, so
 * they still retry.
 */
function isPermanentEmbeddingError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('nan') ||
    m.includes('non-finite') ||
    m.includes('exceeds the context length') ||
    m.includes('maximum context length') ||
    m.includes('cannot embed empty input') ||
    m.includes('dimension mismatch')
  );
}

/**
 * Guard against content that can never be embedded successfully — either
 * empty/whitespace-only (which makes some models, notably Ollama's
 * qwen3-embedding, emit NaN vectors and 500) or oversize. Returns true if the
 * entity was skipped (and the caller should bail without throwing — we don't
 * want the queue to retry something deterministically unembeddable, which is
 * how tens of thousands of DEAD jobs accumulate). Returns false if the caller
 * should proceed with embedding.
 */
async function skipIfOversize(
  text: string,
  entityType: EmbeddingEntityType,
  payload: EmbeddingGeneratePayload,
  job: BackgroundJob,
  repos: ReturnType<typeof getRepositories>,
  extraLog: Record<string, unknown> = {}
): Promise<boolean> {
  // Empty/whitespace-only input is deterministically unembeddable and is a
  // known trigger for NaN embeddings on some providers. Skip without retry.
  if (text.trim().length === 0) {
    const reason = 'Empty input — nothing to embed';
    logger.warn('[EmbeddingGenerate] Skipping empty entity', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      entityType,
      entityId: payload.entityId,
      ...extraLog,
    });
    await repos.embeddingStatus.markAsFailed(
      entityType,
      payload.entityId,
      payload.profileId,
      reason,
      job.userId
    );
    return true;
  }

  if (text.length <= EMBEDDING_MAX_CHARS) return false;

  const reason = `Oversize: ${text.length} chars exceeds ${EMBEDDING_MAX_CHARS}-char cap`;
  logger.warn('[EmbeddingGenerate] Skipping oversize entity', {
    context: 'handleEmbeddingGenerate',
    jobId: job.id,
    entityType,
    entityId: payload.entityId,
    textLength: text.length,
    maxChars: EMBEDDING_MAX_CHARS,
    ...extraLog,
  });
  await repos.embeddingStatus.markAsFailed(
    entityType,
    payload.entityId,
    payload.profileId,
    reason,
    job.userId
  );
  return true;
}

/**
 * Handle an embedding generate job
 */
export async function handleEmbeddingGenerate(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as EmbeddingGeneratePayload;
  const repos = getRepositories();

  // Route to entity-specific handler
  if (payload.entityType === 'HELP_DOC') {
    return handleHelpDocEmbedding(job, payload, repos);
  }

  if (payload.entityType === 'CONVERSATION_CHUNK') {
    return handleConversationChunkEmbedding(job, payload, repos);
  }

  if (payload.entityType === 'MOUNT_CHUNK') {
    return handleMountChunkEmbedding(job, payload, repos);
  }

  if (payload.entityType !== 'MEMORY') {
    throw new Error(`Unsupported entity type: ${payload.entityType}`);
  }

  // Get the memory
  const memory = await repos.memories.findById(payload.entityId);
  if (!memory) {
    logger.warn('[EmbeddingGenerate] Memory not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      memoryId: payload.entityId,
    });
    // Mark status as failed
    await repos.embeddingStatus.markAsFailed(
      'MEMORY',
      payload.entityId,
      payload.profileId,
      'Memory not found',
      job.userId
    );
    return;
  }

  try {
    // Generate embedding using the specified profile
    const textToEmbed = `${memory.summary}\n\n${memory.content}`;
    if (await skipIfOversize(textToEmbed, 'MEMORY', payload, job, repos, {
      memoryId: memory.id,
      characterId: memory.characterId,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      textToEmbed,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    // Update memory with embedding
    await repos.memories.updateForCharacter(
      memory.characterId,
      memory.id,
      { embedding: embeddingResult.embedding }
    );

    // Write directly to the database instead of loading the full in-memory
    // vector store. Loading the store for a character with thousands of entries
    // (e.g. 12k+ vectors × 1536 dimensions) would consume hundreds of MB of
    // heap just to insert one row.
    const vectorRepo = getVectorIndicesRepository();
    const exists = await vectorRepo.entryExists(memory.id);
    if (exists) {
      await vectorRepo.updateEntryEmbedding(memory.id, embeddingResult.embedding);
    } else {
      await vectorRepo.addEntry({
        id: memory.id,
        characterId: memory.characterId,
        embedding: embeddingResult.embedding,
      });
    }
    await vectorRepo.saveMeta(memory.characterId, embeddingResult.dimensions);

    // Invalidate the cached in-memory store for this character so the next
    // search operation reloads fresh data from the database.
    getVectorStoreManager().unloadStore(memory.characterId);

    // Mark status as embedded
    await repos.embeddingStatus.markAsEmbedded(
      'MEMORY',
      payload.entityId,
      payload.profileId,
      job.userId
    );

    logger.info('[EmbeddingGenerate] Embedding generated successfully', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      memoryId: memory.id,
      characterId: memory.characterId,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark status as failed
    await repos.embeddingStatus.markAsFailed(
      'MEMORY',
      payload.entityId,
      payload.profileId,
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        memoryId: payload.entityId,
        error: errorMessage,
      });
      return;
    }

    logger.error('[EmbeddingGenerate] Failed to generate embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      memoryId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Handle embedding generation for a conversation chunk (Scriptorium)
 * Uses the same embedding infrastructure as memories but stores
 * the embedding directly on the chunk row (Float32 BLOB, same format).
 */
async function handleConversationChunkEmbedding(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  const chunk = await repos.conversationChunks.findById(payload.entityId);
  if (!chunk) {
    logger.warn('[EmbeddingGenerate] Conversation chunk not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
      chatId: payload.chatId,
    });
    return;
  }

  try {
    if (await skipIfOversize(chunk.content, 'CONVERSATION_CHUNK', payload, job, repos, {
      chunkId: chunk.id,
      chatId: payload.chatId,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      chunk.content,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    // Store embedding directly on the chunk (same Float32 BLOB format as memories)
    await repos.conversationChunks.updateEmbedding(chunk.id, embeddingResult.embedding);

    await repos.embeddingStatus.markAsEmbedded(
      'CONVERSATION_CHUNK',
      payload.entityId,
      payload.profileId,
      job.userId
    );

    logger.info('[EmbeddingGenerate] Conversation chunk embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: chunk.id,
      chatId: payload.chatId,
      interchangeIndex: chunk.interchangeIndex,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'CONVERSATION_CHUNK',
      payload.entityId,
      payload.profileId,
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        chunkId: payload.entityId,
        chatId: payload.chatId,
        error: errorMessage,
      });
      return;
    }

    logger.error('[EmbeddingGenerate] Failed to generate conversation chunk embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
      chatId: payload.chatId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Embed every section chunk of a help document that still lacks a vector.
 *
 * Chunks that already carry an embedding are skipped, which makes a retry of
 * a partially-completed job cheap: the rows are recreated with null embeddings
 * whenever the doc's content changes, and a full reindex clears them, so a
 * populated embedding is always current for its text.
 *
 * A single chunk's failure is logged and skipped rather than thrown. The
 * document's own embedding has already been stored by the caller, so the doc
 * stays findable at whole-document granularity; throwing here would fail a job
 * whose main work succeeded, and the next sync or reindex will retry the
 * stragglers.
 *
 * @returns the number of chunks embedded on this pass
 */
async function embedHelpDocChunks(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>,
  doc: { id: string; title: string }
): Promise<number> {
  let embedded = 0;

  try {
    const chunks = await repos.helpDocChunks.findByDocId(doc.id);

    for (const chunk of chunks) {
      if (chunk.embedding && chunk.embedding.length > 0) {
        continue;
      }

      const text = helpChunkEmbeddingText(doc.title, chunk.heading, chunk.content);
      if (text.trim().length === 0) {
        continue;
      }

      try {
        const result = await generateEmbeddingForUser(
          text,
          job.userId,
          payload.profileId,
          { priority: 'background' }
        );
        await repos.helpDocChunks.updateEmbedding(chunk.id, result.embedding);
        embedded++;
      } catch (error) {
        logger.warn('[EmbeddingGenerate] Help doc chunk embedding failed — skipping chunk', {
          context: 'handleEmbeddingGenerate',
          jobId: job.id,
          docId: doc.id,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.warn('[EmbeddingGenerate] Could not embed help doc chunks', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: doc.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return embedded;
}

/**
 * Handle embedding generation for a help document.
 * Uses the same embedding infrastructure as memories but stores
 * the embedding directly on the help doc row (Float32 BLOB, same format),
 * then fills in the per-section chunk vectors.
 */
async function handleHelpDocEmbedding(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  const doc = await repos.helpDocs.findById(payload.entityId);
  if (!doc) {
    logger.warn('[EmbeddingGenerate] Help doc not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: payload.entityId,
    });
    await repos.embeddingStatus.markAsFailed(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      'Help doc not found',
      job.userId
    );
    return;
  }

  try {
    const textToEmbed = `${doc.title}\n\n${doc.content}`;
    if (await skipIfOversize(textToEmbed, 'HELP_DOC', payload, job, repos, {
      docId: doc.id,
      title: doc.title,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      textToEmbed,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    await repos.helpDocs.updateEmbedding(doc.id, embeddingResult.embedding);

    // Section-level vectors, in the same job as the whole-document one. Doing
    // it here rather than through a HELP_DOC_CHUNK entity type of its own
    // keeps one unit of work per document: the reindex enqueue, the
    // embedding_status bookkeeping, and the dimension reconcile all continue
    // to count help_docs rows, and chunks can never carry a dimension the
    // parent doc doesn't — they are always written together.
    const chunksEmbedded = await embedHelpDocChunks(job, payload, repos, doc);

    await repos.embeddingStatus.markAsEmbedded(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      job.userId
    );

    logger.info('[EmbeddingGenerate] Help doc embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: doc.id,
      title: doc.title,
      dimensions: embeddingResult.dimensions,
      chunksEmbedded,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'HELP_DOC',
      payload.entityId,
      payload.profileId,
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        docId: payload.entityId,
        error: errorMessage,
      });
      return;
    }

    logger.error('[EmbeddingGenerate] Failed to generate help doc embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      docId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Handle embedding generation for a document mount chunk.
 * Uses the same embedding infrastructure as conversation chunks but stores
 * the embedding on the mount chunk row in the mount index database.
 */
async function handleMountChunkEmbedding(
  job: BackgroundJob,
  payload: EmbeddingGeneratePayload,
  repos: ReturnType<typeof getRepositories>
): Promise<void> {
  const chunk = await repos.docMountChunks.findById(payload.entityId);
  if (!chunk) {
    logger.warn('[EmbeddingGenerate] Mount chunk not found', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
    });
    await repos.embeddingStatus.markAsFailed(
      'MOUNT_CHUNK',
      payload.entityId,
      payload.profileId,
      'Mount chunk not found',
      job.userId
    );
    return;
  }

  try {
    if (await skipIfOversize(chunk.content, 'MOUNT_CHUNK', payload, job, repos, {
      chunkId: chunk.id,
      mountPointId: chunk.mountPointId,
    })) {
      return;
    }
    const embeddingResult = await generateEmbeddingForUser(
      chunk.content,
      job.userId,
      payload.profileId,
      { priority: 'background' }
    );

    await repos.docMountChunks.updateEmbedding(chunk.id, embeddingResult.embedding);

    // Invalidate the in-memory cache for this mount point so the next
    // document search reloads fresh chunks.
    invalidateMountPoint(chunk.mountPointId);

    await repos.embeddingStatus.markAsEmbedded(
      'MOUNT_CHUNK',
      payload.entityId,
      payload.profileId,
      job.userId
    );

    logger.info('[EmbeddingGenerate] Mount chunk embedding generated', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: chunk.id,
      mountPointId: chunk.mountPointId,
      dimensions: embeddingResult.dimensions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await repos.embeddingStatus.markAsFailed(
      'MOUNT_CHUNK',
      payload.entityId,
      payload.profileId,
      errorMessage,
      job.userId
    );

    if (isPermanentEmbeddingError(errorMessage)) {
      logger.warn('[EmbeddingGenerate] Permanent embedding error — marked failed, skipping retry', {
        context: 'handleEmbeddingGenerate',
        jobId: job.id,
        chunkId: payload.entityId,
        error: errorMessage,
      });
      return;
    }

    logger.error('[EmbeddingGenerate] Failed to generate mount chunk embedding', {
      context: 'handleEmbeddingGenerate',
      jobId: job.id,
      chunkId: payload.entityId,
      error: errorMessage,
    });

    throw error;
  }
}
