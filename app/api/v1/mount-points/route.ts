/**
 * Mount Points API v1 - Collection Endpoint
 *
 * GET /api/v1/mount-points - List all mount points
 * POST /api/v1/mount-points - Create a new mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { created, serverError, badRequest, conflict, successResponse } from '@/lib/api/responses';
import { attachMountPoint } from '@/lib/mount-index/watcher';
import { checkBasePathAvailability } from '@/lib/mount-index/base-path-availability';
import { scaffoldCharacterMount } from '@/lib/mount-index/character-scaffold';
import { searchDocumentChunks } from '@/lib/mount-index/document-search';
import {
  generateEmbeddingForUser,
  EmbeddingDimensionMismatchError,
  EmbeddingError,
} from '@/lib/embedding/embedding-service';

// ============================================================================
// Schemas
// ============================================================================

const createMountPointSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  // basePath is only meaningful for filesystem/obsidian mounts. Database-backed
  // stores (mountType === 'database') persist everything inside
  // quilltap-mount-index.db and ignore this value.
  basePath: z.string().optional().default(''),
  mountType: z.enum(['filesystem', 'obsidian', 'database']).optional().default('filesystem'),
  storeType: z.enum(['documents', 'character']).optional().default('documents'),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  enabled: z.boolean().optional().default(true),
}).refine(
  (data) => data.mountType === 'database' || (data.basePath && data.basePath.length > 0),
  { message: 'Base path is required for filesystem and obsidian mount types', path: ['basePath'] }
);

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  try {

    const mountPoints = await repos.docMountPoints.findAll();

    // Sort by createdAt descending
    mountPoints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Compute embedded chunk counts per mount point via a cheap GROUP BY —
    // no BLOBs hydrated.
    const mountPointIds = mountPoints.map(mp => mp.id);
    const embeddedCountMap = mountPointIds.length > 0
      ? await repos.docMountChunks.countEmbeddedByMountPointIds(mountPointIds)
      : new Map<string, number>();

    // Enrich mount points with embedded chunk count
    const enriched = mountPoints.map(mp => ({
      ...mp,
      embeddedChunkCount: embeddedCountMap.get(mp.id) || 0,
    }));

    return successResponse({ mountPoints: enriched });
  } catch (error) {
    logger.error('[Mount Points v1] Error fetching mount points', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch mount points');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

const semanticSearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  mountPointIds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  pathPrefix: z.string().optional(),
  top: z.number().int().positive().max(500).optional().default(20),
  threshold: z.number().min(0).max(1).optional().default(0.5),
});

async function handleSemanticSearch(req: NextRequest, userId: string) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = semanticSearchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body');
  }
  const { query, mountPointIds, projectId, pathPrefix, top, threshold } = parsed.data;

  let embedding;
  try {
    embedding = await generateEmbeddingForUser(query, userId, undefined, { priority: 'interactive' });
  } catch (err) {
    if (err instanceof EmbeddingError) {
      logger.warn('[Mount Points v1] Embedding failed for semantic search', { userId, message: err.message });
      return NextResponse.json(
        { error: err.message, code: 'EMBEDDING_FAILED' },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const results = await searchDocumentChunks(embedding.embedding, {
      mountPointIds,
      projectId,
      pathPrefix,
      limit: top,
      minScore: threshold,
      query,
      // Operator Document-Mode search: the human sees every document, including
      // those flagged character_read:false. The per-character retrieval paths
      // (knowledge injector, search tool, etc.) keep the default filtering.
      includeBlocked: true,
    });
    return successResponse({
      results,
      count: results.length,
      query,
      embeddingModel: embedding.model,
      embeddingDimensions: embedding.dimensions,
    });
  } catch (err) {
    if (err instanceof EmbeddingDimensionMismatchError) {
      return NextResponse.json(
        {
          error: err.message,
          code: 'EMBEDDING_DIMENSION_MISMATCH',
          queryDimensions: err.queryLength,
          storedDimensions: err.storedLength,
        },
        { status: 400 },
      );
    }
    throw err;
  }
}

export const POST = createContextHandler(async (req: NextRequest, { user, repos }) => {
  const action = getActionParam(req);

  if (action === 'semantic-search') {
    return handleSemanticSearch(req, user.id);
  }

  const body = await req.json();
  const validatedData = createMountPointSchema.parse(body);

  // Document-store names form one case-insensitive namespace: no store may
  // share a name with a peer, even in a different casing.
  const allStores = await repos.docMountPoints.findAll();
  const desiredLower = validatedData.name.trim().toLowerCase();
  const clash = allStores.find(mp => mp.name.trim().toLowerCase() === desiredLower);
  if (clash) {
    logger.warn('[Mount Points v1] Rejected duplicate mount point name', {
      name: validatedData.name,
      clashesWith: clash.id,
      userId: user.id,
    });
    return conflict(
      `A document store named "${clash.name}" already exists. Names are matched without regard to case — please choose a different name.`
    );
  }

  const mountPoint = await repos.docMountPoints.create({
    name: validatedData.name,
    basePath: validatedData.basePath,
    mountType: validatedData.mountType,
    storeType: validatedData.storeType,
    includePatterns: validatedData.includePatterns ?? ['*.md', '*.txt', '*.pdf', '*.docx'],
    excludePatterns: validatedData.excludePatterns ?? ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: validatedData.enabled,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  // Database-backed stores have no basePath to verify — SQLCipher has already
  // persisted the mount point row, and documents are added via the doc_* tools
  // or the blob API once the user starts writing.
  let warning: string | undefined;
  if (validatedData.mountType !== 'database') {
    const availability = await checkBasePathAvailability(validatedData.basePath);
    if (!availability.available) {
      warning = `${availability.message} The store was created, but scanning will fail until the path is reachable.`;
      logger.warn('[Mount Points v1] Base path not accessible', {
        basePath: validatedData.basePath,
        mountPointId: mountPoint.id,
        reason: availability.reason,
        containerized: availability.containerized,
      });
    }
  }

  logger.info('[Mount Points v1] Mount point created', {
    mountPointId: mountPoint.id,
    name: mountPoint.name,
    basePath: mountPoint.basePath,
    userId: user.id,
  });

  // Scaffold after creation so the mount ID exists.
  if (mountPoint.storeType === 'character' && mountPoint.mountType === 'database') {
    await scaffoldCharacterMount(mountPoint.id).catch((err) => {
      logger.warn('[Mount Points v1] Character scaffold failed', {
        mountPointId: mountPoint.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Attach a real-time watcher if the mount point is enabled and accessible
  attachMountPoint(mountPoint).catch((err) => {
    logger.warn('[Mount Points v1] Failed to attach watcher for new mount point', {
      mountPointId: mountPoint.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (warning) {
    return created({ mountPoint, warning });
  }

  return created({ mountPoint });
});
