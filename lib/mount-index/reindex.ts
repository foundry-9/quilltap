/**
 * Mount-index reindex helper
 *
 * Re-extracts plaintext and re-chunks a scoped set of doc_mount_file_links
 * rows. Synchronous within the request — the existing scanner is also
 * synchronous, so this matches the established pattern and avoids
 * introducing a new background-job type.
 *
 * @module mount-index/reindex
 */

import fs from 'fs/promises';
import path from 'path';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { convertBufferToPlainText, type SupportedFileType } from './converters';
import { chunkDocument } from './chunker';
import type {
  DocMountPoint,
  DocMountFileLinkWithContent,
} from '@/lib/schemas/mount-index.types';
import { isTextDocumentFileType } from '@/lib/schemas/mount-index.types';
import { sha256OfString } from '@/lib/utils/sha256';

const logger = createServiceLogger('MountIndex:Reindex');

const EXTRACTABLE = new Set(['pdf', 'docx', 'markdown', 'txt', 'json', 'jsonl']);

export interface ReindexOptions {
  /**
   * Optional path scope. Matches the link exactly (single file) or — if it
   * names a folder prefix — every link beneath it. Leading and trailing
   * slashes are normalised.
   */
  path?: string;
  /**
   * Without `force`, only links in `none`, `pending`, `failed`, or `skipped`
   * extraction state are processed. Text-native files (already their own
   * plaintext) are skipped unless the link has no chunks yet. With `force`,
   * everything in scope is re-extracted.
   */
  force?: boolean;
}

export interface ReindexResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ relativePath: string; error: string }>;
}

function normalisePathScope(p: string | undefined): string | null {
  if (!p) return null;
  let s = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (s === '' || s === '.') return null;
  return s;
}

function linkMatchesScope(link: DocMountFileLinkWithContent, scope: string | null): boolean {
  if (scope == null) return true;
  if (link.relativePath === scope) return true;
  return link.relativePath.startsWith(scope + '/');
}

function shouldProcess(link: DocMountFileLinkWithContent, force: boolean): boolean {
  if (force) return EXTRACTABLE.has(link.fileType);
  // Text-native: only if no chunks exist yet (rare; usually they're chunked at scan time).
  if (isTextDocumentFileType(link.fileType)) {
    return (link.chunkCount ?? 0) === 0;
  }
  // Non-text-native: only PDFs / DOCX get extraction. Other types are 'blob' and have nothing to extract.
  if (link.fileType !== 'pdf' && link.fileType !== 'docx') return false;
  const status = link.extractionStatus;
  return status === 'none' || status === 'pending' || status === 'failed' || status === 'skipped';
}

async function readSourceBytes(
  mountPoint: DocMountPoint,
  link: DocMountFileLinkWithContent,
): Promise<Buffer> {
  if (link.source === 'filesystem') {
    const abs = path.join(mountPoint.basePath, link.relativePath);
    return fs.readFile(abs);
  }
  // Database-backed: bytes live in doc_mount_blobs or doc_mount_documents.
  const repos = getRepositories();
  if (isTextDocumentFileType(link.fileType)) {
    const doc = await repos.docMountDocuments.findByFileId(link.fileId);
    if (!doc) throw new Error(`No document content for fileId ${link.fileId}`);
    return Buffer.from(doc.content, 'utf8');
  }
  const bytes = await repos.docMountBlobs.readDataByFileId(link.fileId);
  if (!bytes) throw new Error(`No blob bytes for fileId ${link.fileId}`);
  return bytes;
}

export async function reindexLinks(
  mountPoint: DocMountPoint,
  options: ReindexOptions = {},
): Promise<ReindexResult> {
  const repos = getRepositories();
  const scope = normalisePathScope(options.path);
  const force = !!options.force;

  const allLinks = await repos.docMountFileLinks.findByMountPointId(mountPoint.id);
  const inScope = allLinks.filter(l => linkMatchesScope(l, scope));

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const errors: ReindexResult['errors'] = [];

  for (const link of inScope) {
    if (!shouldProcess(link, force)) {
      skipped++;
      continue;
    }
    processed++;
    try {
      const buf = await readSourceBytes(mountPoint, link);
      // shouldProcess already excluded fileType === 'blob'; narrow for the
      // converter dispatch which is typed only over extractable file types.
      const plainText = await convertBufferToPlainText(buf, link.fileType as SupportedFileType);
      const trimmed = plainText ? plainText.trim() : '';

      if (trimmed.length === 0) {
        await repos.docMountFileLinks.update(link.id, {
          extractionStatus: 'failed',
          extractedText: null,
          extractedTextSha256: null,
          extractionError: 'extractor returned empty text',
          chunkCount: 0,
        });
        await repos.docMountChunks.deleteByLinkId(link.id);
        failed++;
        errors.push({ relativePath: link.relativePath, error: 'extractor returned empty text' });
        continue;
      }

      const chunks = chunkDocument(plainText);
      await repos.docMountChunks.deleteByLinkId(link.id);
      if (chunks.length > 0) {
        await repos.docMountChunks.bulkInsert(
          chunks.map(c => ({
            linkId: link.id,
            mountPointId: mountPoint.id,
            chunkIndex: c.chunkIndex,
            content: c.content,
            tokenCount: c.tokenCount,
            headingContext: c.headingContext,
            embedding: null,
          })),
        );
      }
      const isTextNative = isTextDocumentFileType(link.fileType);
      await repos.docMountFileLinks.update(link.id, {
        extractedText: isTextNative ? null : plainText,
        extractedTextSha256: isTextNative ? null : sha256OfString(plainText),
        extractionStatus: isTextNative ? 'none' : 'converted',
        extractionError: null,
        plainTextLength: plainText.length,
        chunkCount: chunks.length,
      });
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Reindex failed for link', {
        mountPointId: mountPoint.id,
        linkId: link.id,
        relativePath: link.relativePath,
        error: msg,
      });
      try {
        await repos.docMountFileLinks.update(link.id, {
          extractionStatus: 'failed',
          extractionError: msg.slice(0, 500),
        });
      } catch {
        // best-effort status update
      }
      failed++;
      errors.push({ relativePath: link.relativePath, error: msg });
    }
  }

  logger.info('Reindex complete', {
    mountPointId: mountPoint.id,
    inScope: inScope.length,
    processed,
    succeeded,
    failed,
    skipped,
  });

  return { processed, succeeded, failed, skipped, errors };
}

/**
 * Scope-aware embedding enqueue: enqueues EMBEDDING_GENERATE jobs for chunks
 * that fall under the path scope. Without `force`, only chunks where
 * `embedding IS NULL` are queued.
 */
export async function enqueueEmbeddingJobsScoped(
  mountPoint: DocMountPoint,
  options: ReindexOptions = {},
): Promise<{ jobs: Array<{ id: string; kind: 'embed'; status: 'queued' }>; queued: number; skipped: number }> {
  const { enqueueEmbeddingGenerate } = await import('@/lib/background-jobs/queue-service');
  const repos = getRepositories();
  const scope = normalisePathScope(options.path);
  const force = !!options.force;

  const allLinks = await repos.docMountFileLinks.findByMountPointId(mountPoint.id);
  const inScopeLinkIds = new Set(
    allLinks.filter(l => linkMatchesScope(l, scope)).map(l => l.id),
  );

  const allChunks = await repos.docMountChunks.findByMountPointId(mountPoint.id);
  const candidates = allChunks.filter(c => inScopeLinkIds.has(c.linkId));
  const needEmbedding = force
    ? candidates
    : candidates.filter(c => !c.embedding || c.embedding.length === 0);

  if (needEmbedding.length === 0) {
    return { jobs: [], queued: 0, skipped: candidates.length };
  }

  // Default profile only — never an arbitrary fallback: every vector in the
  // instance must come from the same profile.
  const profiles = await repos.embeddingProfiles.findAll();
  const defaultProfile = profiles.find(p => p.isDefault);
  if (!defaultProfile) {
    throw new Error('No default embedding profile configured');
  }

  const users = await repos.users.findAll();
  const userId = users[0]?.id;
  if (!userId) throw new Error('No user found');

  const jobs: Array<{ id: string; kind: 'embed'; status: 'queued' }> = [];
  let queued = 0;
  let skipped = candidates.length - needEmbedding.length;

  for (const chunk of needEmbedding) {
    try {
      const result = await enqueueEmbeddingGenerate(userId, {
        entityType: 'MOUNT_CHUNK',
        entityId: chunk.id,
        profileId: defaultProfile.id,
      });
      if (result.isNew) {
        queued++;
        jobs.push({ id: result.jobId, kind: 'embed', status: 'queued' });
      } else {
        skipped++;
      }
    } catch (err) {
      logger.warn('Failed to enqueue embedding job for chunk', {
        chunkId: chunk.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  logger.info('Scoped embedding enqueue complete', {
    mountPointId: mountPoint.id,
    scope,
    queued,
    skipped,
    total: candidates.length,
  });

  return { jobs, queued, skipped };
}
