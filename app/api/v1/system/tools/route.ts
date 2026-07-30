/**
 * System Tools API v1 - Collection Endpoint
 *
 * POST /api/v1/system/tools?action=delete-data - Delete all user data
 * GET /api/v1/system/tools?action=delete-data-preview - Preview what will be deleted
 * GET /api/v1/system/tools?action=tasks-queue - Get tasks queue status
 * POST /api/v1/system/tools?action=tasks-queue - Control tasks queue (start/stop)
 * GET /api/v1/system/tools?action=job-concurrency - Get global background-job concurrency cap
 * POST /api/v1/system/tools?action=job-concurrency - Set global background-job concurrency cap (1-32)
 * POST /api/v1/system/tools?action=export - Export user data (Quilltap format)
 * GET /api/v1/system/tools?action=export-entities - Get available entities for export
 * GET /api/v1/system/tools?action=export-preview - Preview export contents
 * POST /api/v1/system/tools?action=import-preview - Preview import contents
 * POST /api/v1/system/tools?action=import-execute - Execute the actual import
 * GET /api/v1/system/tools?action=capabilities-report - Get system capabilities report
 * POST /api/v1/system/tools?action=capabilities-report-generate - Generate a new report
 * GET /api/v1/system/tools?action=capabilities-report-list - List saved reports
 * GET /api/v1/system/tools?action=capabilities-report-get - Get a specific report
 * POST /api/v1/system/tools?action=capabilities-report-delete - Delete a specific report
 * GET /api/v1/system/tools?action=memory-dedup-preview - Preview memory deduplication
 * POST /api/v1/system/tools?action=memory-dedup - Execute memory deduplication
 * POST /api/v1/system/tools?action=ai-import-stream - AI character import from source material (SSE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import { createContextHandler } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, validationError } from '@/lib/api/responses';
import { deleteAllUserData, previewDeleteAllUserData } from '@/lib/backup/restore-service';
import { BackgroundJob } from '@/lib/schemas/types';
import { startProcessor, stopProcessor, getProcessorStatus, wakeProcessor } from '@/lib/background-jobs/processor';
import { getMaxConcurrentJobs, setMaxConcurrentJobs } from '@/lib/instance-settings';
import { previewExport } from '@/lib/export/quilltap-export-service';
import { createNdjsonStream, QTAP_NDJSON_CONTENT_TYPE } from '@/lib/export/ndjson-writer';
import { previewImport, executeImport, type QuilltapExport, type ConflictStrategy } from '@/lib/import/quilltap-import-service';
import { peekFormat, readNdjsonLines, collectLegacyJson } from '@/lib/import/ndjson-reader';
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream';
import { generateAndSaveReport } from '@/lib/tools/capabilities-report';
import { deduplicateAllMemories } from '@/lib/tools/memory-dedup';
import { runAIImportStreaming } from '@/lib/services/ai-import.service';
import type { AIImportRequest, AIImportProgressEvent } from '@/lib/services/ai-import.service';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type { ExportEntityType } from '@/lib/export/types';

const TOOLS_GET_ACTIONS = [
  'tasks-queue',
  'job-concurrency',
  'delete-data-preview',
  'export-entities',
  'export-preview',
  'capabilities-report',
  'capabilities-report-list',
  'capabilities-report-get',
  'memory-dedup-preview',
] as const;
type ToolsGetAction = typeof TOOLS_GET_ACTIONS[number];

const TOOLS_POST_ACTIONS = [
  'delete-data',
  'tasks-queue',
  'job-concurrency',
  'export',
  'import-preview',
  'import-execute',
  'capabilities-report-generate',
  'capabilities-report-delete',
  'memory-dedup',
  'ai-import-stream',
] as const;
type ToolsPostAction = typeof TOOLS_POST_ACTIONS[number];

// ============================================================================
// Helper Functions
// ============================================================================

function estimateTokensForJob(job: BackgroundJob): number {
  const baseTokens = 500;

  switch (job.type) {
    case 'MEMORY_EXTRACTION': {
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 300;
    }
    case 'INTER_CHARACTER_MEMORY': {
      const payload = job.payload as { userMessage?: string; assistantMessage?: string };
      const userMsgTokens = Math.ceil((payload.userMessage?.length || 0) / 4);
      const assistantMsgTokens = Math.ceil((payload.assistantMessage?.length || 0) / 4);
      return baseTokens + userMsgTokens + assistantMsgTokens + 400;
    }
    case 'CONTEXT_SUMMARY': {
      return baseTokens + 2000;
    }
    case 'TITLE_UPDATE': {
      return baseTokens + 300;
    }
    case 'CHAT_DANGER_CLASSIFICATION': {
      return baseTokens + 1000;
    }
    case 'SCENE_STATE_TRACKING': {
      return baseTokens + 800;
    }
    case 'LLM_LOG_CLEANUP':
    case 'EMBEDDING_GENERATE':
    case 'EMBEDDING_REFIT':
    case 'EMBEDDING_REINDEX_ALL':
    case 'CHARACTER_AVATAR_GENERATION':
    case 'CONVERSATION_RENDER': {
      // These jobs do not consume LLM text-generation tokens
      return 0;
    }
    case 'STORY_BACKGROUND_GENERATION': {
      // Image generation job — no LLM text tokens
      return 0;
    }
    default:
      return baseTokens;
  }
}

function getJobTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    MEMORY_EXTRACTION: 'Memory Extraction',
    INTER_CHARACTER_MEMORY: 'Character Memory',
    CONTEXT_SUMMARY: 'Context Summary',
    TITLE_UPDATE: 'Title Update',
    LLM_LOG_CLEANUP: 'LLM Log Cleanup',
    EMBEDDING_GENERATE: 'Embedding Generation',
    EMBEDDING_REFIT: 'Vocabulary Refit',
    EMBEDDING_REINDEX_ALL: 'Re-embed All Memories',
    STORY_BACKGROUND_GENERATION: 'Story Background',
    CHAT_DANGER_CLASSIFICATION: 'Danger Classification',
    SCENE_STATE_TRACKING: 'Scene State Tracking',
    CHARACTER_AVATAR_GENERATION: 'Avatar Generation',
    CONVERSATION_RENDER: 'Conversation Render',
  };
  return typeNames[type] || type;
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleDeleteData(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();

    if (body.confirm !== 'DELETE_ALL_MY_DATA') {
      logger.warn('[System Tools v1] Delete all data attempted without confirmation', {
        userId: user.id,
      });
      return badRequest('Confirmation required. Send { "confirm": "DELETE_ALL_MY_DATA" }');
    }

    logger.info('[System Tools v1] Starting complete data deletion', { userId: user.id });

    const summary = await deleteAllUserData(user.id);

    logger.info('[System Tools v1] Complete data deletion finished', { userId: user.id, summary });

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Delete all data failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to delete data');
  }
}

async function handleDeleteDataPreview(req: NextRequest, context: any) {
  const { user } = context;

  try {

    const summary = await previewDeleteAllUserData(user.id);

    logger.info('[System Tools v1] Delete preview generated', { userId: user.id, summary });

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Preview delete failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview data deletion');
  }
}

async function handleTasksQueue(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {

    const repo = repos.backgroundJobs;
    const stats = await repo.getStats(user.id);

    const pendingJobs = await repo.findByUserId(user.id, 'PENDING');
    const processingJobs = await repo.findByUserId(user.id, 'PROCESSING');
    const failedJobs = await repo.findByUserId(user.id, 'FAILED');
    const pausedJobs = await repo.findByUserId(user.id, 'PAUSED');

    const jobMap = new Map<string, BackgroundJob>();
    for (const job of [
      ...processingJobs,
      ...pendingJobs,
      ...failedJobs.filter((j: BackgroundJob) => j.attempts < j.maxAttempts),
      ...pausedJobs,
    ]) {
      if (!jobMap.has(job.id)) {
        jobMap.set(job.id, job);
      }
    }
    const activeJobs = Array.from(jobMap.values());

    activeJobs.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    // Build a character name cache for jobs that only have characterId
    const characterNameCache = new Map<string, string>();
    for (const job of activeJobs) {
      const payload = job.payload as Record<string, unknown>;
      if (payload.characterId && !payload.characterName) {
        const charId = payload.characterId as string;
        if (!characterNameCache.has(charId)) {
          try {
            const character = await repos.characters.findById(charId);
            if (character) {
              characterNameCache.set(charId, character.name);
            }
          } catch {
            // Character lookup failed, skip
          }
        }
      }
    }

    let totalEstimatedTokens = 0;
    const jobDetails = activeJobs.map((job) => {
      const estimatedTokens = estimateTokensForJob(job);
      totalEstimatedTokens += estimatedTokens;

      const payload = job.payload as Record<string, unknown>;

      // Resolve character name from payload or cache
      const characterName = (payload.characterName as string | undefined)
        || characterNameCache.get(payload.characterId as string)
        || undefined;

      return {
        id: job.id,
        type: job.type,
        typeName: getJobTypeName(job.type),
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        scheduledAt: job.scheduledAt,
        startedAt: job.startedAt,
        lastError: job.lastError,
        estimatedTokens,
        chatId: payload.chatId as string | undefined,
        characterName,
      };
    });

    const processorStatus = getProcessorStatus();
    const maxConcurrentJobs = await getMaxConcurrentJobs();
    return NextResponse.json({
      stats: {
        pending: stats.pending,
        processing: stats.processing,
        failed: stats.failed,
        completed: stats.completed,
        dead: stats.dead,
        paused: stats.paused,
        activeTotal: activeJobs.length,
      },
      jobs: jobDetails,
      totalEstimatedTokens,
      processorStatus,
      maxConcurrentJobs,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error fetching tasks queue status',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch queue status');
  }
}

async function handleTasksQueueControl(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();
    const { action } = body;

    if (!action || !['start', 'stop'].includes(action)) {
      return badRequest('Invalid action. Must be "start" or "stop"');
    }

    logger.info('[System Tools v1] Tasks queue control action', {
      userId: user.id,
      action,
    });

    if (action === 'start') {
      startProcessor();
    } else {
      stopProcessor();
    }

    const processorStatus = getProcessorStatus();return NextResponse.json({
      success: true,
      action,
      processorStatus,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error controlling tasks queue',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to control queue');
  }
}

const jobConcurrencySchema = z.object({
  concurrency: z.number().int().min(1).max(32),
});

async function handleJobConcurrency(req: NextRequest, context: any) {
  const { user } = context;
  try {
    const concurrency = await getMaxConcurrentJobs();
    return NextResponse.json({ success: true, concurrency });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error reading job concurrency cap',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to read job concurrency');
  }
}

async function handleJobConcurrencyControl(req: NextRequest, context: any) {
  const { user } = context;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = jobConcurrencySchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await setMaxConcurrentJobs(parsed.data.concurrency);
    // Nudge the dispatcher so the new cap applies immediately rather than on the
    // next 2 s poll.
    wakeProcessor();

    logger.info('[System Tools v1] Background-job concurrency cap updated', {
      userId: user.id,
      concurrency: parsed.data.concurrency,
    });
    return NextResponse.json({ success: true, concurrency: parsed.data.concurrency });
  } catch (error) {
    logger.error(
      '[System Tools v1] Error setting job concurrency cap',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to set job concurrency');
  }
}

async function handleExport(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();
    const { type, scope, selectedIds, includeMemories } = body;

    logger.info('[System Tools v1] Creating export (NDJSON stream)', {
      userId: user.id,
      type,
      scope,
      selectedIdsCount: selectedIds?.length || 0,
      includeMemories: includeMemories || false,
    });

    const stream = createNdjsonStream(user.id, {
      type: type as ExportEntityType,
      scope: scope || 'all',
      selectedIds,
      includeMemories: includeMemories || false,
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedType = (type || 'data').replace(/_/g, '-');
    const filename = `quilltap-${sanitizedType}-${timestamp}.qtap`;

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': QTAP_NDJSON_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Export failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to create export');
  }
}

async function handleExportEntities(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type') as ExportEntityType | null;

    if (!type) {
      return badRequest('Missing type parameter');
    }


    const repos = getUserRepositories(user.id);
    const globalRepos = getRepositories();

    let entities: Array<{ id: string; name: string; memoryCount?: number }> = [];
    let totalMemoryCount = 0;

    switch (type) {
      case 'characters': {
        const characters = await repos.characters.findAll();
        for (const char of characters) {
          const memories = await repos.memories.findByCharacterId(char.id);
          const charMemoryCount = memories.length;
          totalMemoryCount += charMemoryCount;
          entities.push({
            id: char.id,
            name: char.name,
            memoryCount: charMemoryCount,
          });
        }
        break;
      }

      case 'chats': {
        const chats = await repos.chats.findAll();
        const characters = await repos.characters.findAll();
        const allMemoriesArrays = await Promise.all(
          characters.map((char) => repos.memories.findByCharacterId(char.id))
        );
        const allMemories = allMemoriesArrays.flat();

        for (const chat of chats) {
          const chatMemories = allMemories.filter((m) => m.chatId === chat.id);
          const chatMemoryCount = chatMemories.length;
          totalMemoryCount += chatMemoryCount;
          entities.push({
            id: chat.id,
            name: chat.title,
            memoryCount: chatMemoryCount,
          });
        }
        break;
      }

      case 'roleplay-templates': {
        const templates = await globalRepos.roleplayTemplates.findAll();
        const userTemplates = templates.filter(
          (t) => !t.isBuiltIn && t.userId === user.id
        );
        entities = userTemplates.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      case 'connection-profiles': {
        const profiles = await repos.connections.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'image-profiles': {
        const profiles = await repos.imageProfiles.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'embedding-profiles': {
        const profiles = await repos.embeddingProfiles.findAll();
        entities = profiles.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      case 'tags': {
        const tags = await repos.tags.findAll();
        entities = tags.map((t) => ({ id: t.id, name: t.name }));
        break;
      }

      case 'projects': {
        const projects = await repos.projects.findAll();
        entities = projects.map((p) => ({ id: p.id, name: p.name }));
        break;
      }

      default:
        return badRequest(`Unknown entity type: ${type}`);
    }

    logger.info('[System Tools v1] Entities fetched for export', {
      userId: user.id,
      type,
      count: entities.length,
      totalMemoryCount,
    });

    return NextResponse.json({
      entities,
      memoryCount: totalMemoryCount,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to fetch entities for export',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch entities');
  }
}

async function handleExportPreview(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type');
    const scope = searchParams.get('scope') || 'all';
    const selectedIdsParam = searchParams.get('selectedIds');
    const includeMemories = searchParams.get('includeMemories') === 'true';

    const selectedIds = selectedIdsParam ? selectedIdsParam.split(',').filter(Boolean) : [];

    if (!type) {
      logger.warn('[System Tools v1] Export preview missing type parameter', { userId: user.id });
      return badRequest('Missing required parameter: type');
    }

    logger.info('[System Tools v1] Previewing export', {
      userId: user.id,
      type,
      scope,
      selectedIdsCount: selectedIds.length,
      includeMemories,
    });

    const preview = await previewExport(user.id, {
      type: type as ExportEntityType,
      scope: scope as 'all' | 'selected',
      selectedIds,
      includeMemories,
    });return NextResponse.json(preview);
  } catch (error) {
    logger.error(
      '[System Tools v1] Export preview failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview export');
  }
}

/**
 * Legacy monolithic .qtap files still get loaded into a single string for
 * `JSON.parse` — we cap them at ~450 MB because V8's max string length is
 * ~512 MB and we want headroom. Anything bigger must be re-exported from a
 * Quilltap version that writes the streaming NDJSON format. NDJSON files
 * have no whole-file cap (we only cap per-line size in the reader).
 */
const MAX_LEGACY_IMPORT_BYTES = 450 * 1024 * 1024;

/**
 * Load a `.qtap` upload as a `QuilltapExport`, detecting streaming NDJSON vs
 * legacy monolithic JSON transparently. `input` may be either a `File`
 * (multipart upload) or a `NextRequest` whose body is the raw `.qtap` bytes.
 */
async function loadQtapFromUpload(
  input: { stream(): ReadableStream<Uint8Array> } | ReadableStream<Uint8Array>
): Promise<QuilltapExport> {
  const body: ReadableStream<Uint8Array> =
    input instanceof ReadableStream ? input : input.stream();
  const { format, stream } = await peekFormat(body);

  if (format === 'ndjson') {
    return assembleExportFromStream(readNdjsonLines(stream));
  }

  const text = await collectLegacyJson(stream, MAX_LEGACY_IMPORT_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parsed as QuilltapExport;
}

function validateExportFile(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const exported = data as Record<string, unknown>;
  if (!exported.manifest || typeof exported.manifest !== 'object') {
    return false;
  }

  const manifest = exported.manifest as Record<string, unknown>;
  if (manifest.format !== 'quilltap-export' || manifest.version !== '1.0') {
    return false;
  }

  return true;
}

async function handleImportPreview(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const contentType = req.headers.get('content-type') || '';
    let exportData: QuilltapExport;

    logger.info('[System Tools v1] Processing import preview request', {
      userId: user.id,
      contentType,
    });

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        logger.warn('[System Tools v1] Import preview missing file', { userId: user.id });
        return badRequest('No file provided');
      }

      try {
        exportData = await loadQtapFromUpload(file);
      } catch (err) {
        logger.warn('[System Tools v1] Import preview file load failed', {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return badRequest(err instanceof Error ? err.message : 'Failed to read export file');
      }
    } else {
      // Legacy JSON-body path — kept for older clients. The frontend uploads
      // via multipart for anything non-trivial.
      const body = await req.json();
      if (!body.exportData) {
        logger.warn('[System Tools v1] Import preview missing exportData', { userId: user.id });
        return badRequest('Missing required field: exportData');
      }
      exportData = body.exportData as QuilltapExport;
    }

    if (!validateExportFile(exportData)) {
      logger.warn('[System Tools v1] Invalid export file format', { userId: user.id });
      return badRequest('Invalid export file format. Expected quilltap-export v1.0 format.');
    }

    logger.info('[System Tools v1] Export file validated', {
      userId: user.id,
      exportType: exportData.manifest.exportType,
    });

    const preview = await previewImport(user.id, exportData);
    return NextResponse.json(preview);
  } catch (error) {
    logger.error(
      '[System Tools v1] Import preview failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview import');
  }
}

async function handleImportExecute(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const contentType = req.headers.get('content-type') || '';
    let exportData: QuilltapExport | undefined;
    let options: { conflictStrategy?: string; importMemories?: boolean; selectedIds?: Record<string, string[]> } | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const optionsStr = formData.get('options') as string | null;

      if (!file) {
        logger.warn('[System Tools v1] Import execute missing file', { userId: user.id });
        return badRequest('No file provided');
      }

      try {
        exportData = await loadQtapFromUpload(file);
      } catch (err) {
        logger.warn('[System Tools v1] Import execute file load failed', {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return badRequest(err instanceof Error ? err.message : 'Failed to read export file');
      }

      if (optionsStr) {
        try {
          options = JSON.parse(optionsStr);
        } catch {
          return badRequest('Invalid JSON: Failed to parse options');
        }
      }
    } else {
      const body = await req.json();
      exportData = body.exportData as QuilltapExport | undefined;
      options = body.options;
    }

    if (!exportData) {
      logger.warn('[System Tools v1] Import execute missing exportData', { userId: user.id });
      return badRequest('Missing required field: exportData');
    }

    if (!options) {
      logger.warn('[System Tools v1] Import execute missing options', { userId: user.id });
      return badRequest('Missing required field: options');
    }

    const { conflictStrategy, importMemories, selectedIds } = options;

    if (!conflictStrategy || !['skip', 'replace', 'overwrite', 'duplicate'].includes(conflictStrategy)) {
      logger.warn('[System Tools v1] Import execute invalid conflict strategy', {
        userId: user.id,
        conflictStrategy,
      });
      return badRequest('Invalid conflictStrategy. Must be one of: skip, replace, overwrite, duplicate');
    }

    // Map 'replace' to 'overwrite' for the import service (legacy compat)
    const mappedConflictStrategy: ConflictStrategy =
      conflictStrategy === 'replace' ? 'overwrite' : conflictStrategy as ConflictStrategy;

    logger.info('[System Tools v1] Starting import execution', {
      userId: user.id,
      exportType: exportData.manifest.exportType,
      conflictStrategy: mappedConflictStrategy,
      importMemories: importMemories || false,
    });

    const result = await executeImport(user.id, exportData, {
      conflictStrategy: mappedConflictStrategy,
      includeMemories: importMemories || false,
      includeRelatedEntities: false,
      selectedIds,
    });

    logger.info('[System Tools v1] Import completed', {
      userId: user.id,
      success: result.success,
      imported: result.imported,
      skipped: result.skipped,
      warningCount: result.warnings.length,
      importedCharacterIdCount: result.importedCharacterIds.length,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error(
      '[System Tools v1] Import execution failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to execute import');
  }
}

async function handleCapabilitiesReport(req: NextRequest, context: any) {
  try {

    const report = {
      version: '1.0',
      capabilities: {
        maxFileSize: 52428800, // 50MB
        supportedImageFormats: ['jpeg', 'png', 'webp', 'gif'],
        supportedDocumentFormats: ['pdf', 'docx', 'txt'],
        maxStoragePerUser: 5368709120, // 5GB
      },
      features: {
        memorySystem: true,
        imageGeneration: true,
        contextCompression: true,
        fileAttachments: true,
      },
      limits: {
        maxChatsPerCharacter: 1000,
        maxCharactersPerUser: 500,
        maxMemoriesPerCharacter: 5000,
        requestTimeoutMs: 300000,
      },
    };


    return NextResponse.json(report);
  } catch (error) {
    logger.error(
      '[System Tools v1] Error generating capabilities report',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to generate capabilities report');
  }
}

async function handleCapabilitiesReportGenerate(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {
    logger.info('[System Tools v1] Generating capabilities report', { userId: user.id });

    const result = await generateAndSaveReport(user.id);

    // Create a file entry in the database for the report
    const contentBuffer = Buffer.from(result.content, 'utf-8');
    const sha256Hash = createHash('sha256').update(result.content, 'utf-8').digest('hex');
    const fileEntry = await repos.files.create({
      userId: user.id,
      originalFilename: result.filename,
      mimeType: 'text/markdown',
      size: contentBuffer.length,
      storageKey: result.storageKey,
      category: 'DOCUMENT',
      sha256: sha256Hash,
      folderPath: '/reports',
      source: 'SYSTEM',
      projectId: null,
      linkedTo: [],
      generationPrompt: null,
      generationModel: null,
      generationRevisedPrompt: null,
      description: 'System-generated capabilities report',
      tags: [],
    });

    logger.info('[System Tools v1] Capabilities report generated successfully', {
      userId: user.id,
      reportId: result.reportId,
      filename: result.filename,
      size: result.size,
      fileEntryId: fileEntry.id,
    });

    return NextResponse.json({
      success: true,
      reportId: result.reportId,
      filename: result.filename,
      storageKey: result.storageKey,
      size: result.size,
      content: result.content,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to generate capabilities report',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to generate report');
  }
}

async function handleCapabilitiesReportList(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {
    logger.info('[System Tools v1] Listing capabilities reports', { userId: user.id });

    // List all files in the DOCUMENT category from /reports folder
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFiles = allDocuments.filter((f: any) => f.folderPath === '/reports');

    // Convert to ReportInfo format
    const reports = reportFiles.map((file: any) => ({
      id: file.id,
      filename: file.originalFilename,
      storageKey: file.storageKey || '',
      createdAt: file.createdAt,
      size: file.size || 0,
    }));

    // Sort by creation date, newest first
    reports.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    logger.info('[System Tools v1] Listed capabilities reports', {
      userId: user.id,
      count: reports.length,
    });

    return NextResponse.json({ reports });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to list capabilities reports',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to list reports');
  }
}

async function handleCapabilitiesReportGet(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {
    const { searchParams } = req.nextUrl;
    const reportId = searchParams.get('reportId');
    const download = searchParams.get('download') === 'true';

    if (!reportId) {
      return badRequest('Missing reportId parameter');
    }

    logger.info('[System Tools v1] Getting capabilities report', { userId: user.id, reportId });

    // Find the report file in the database from DOCUMENT category
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFile = allDocuments.find((f: any) => f.id === reportId && f.folderPath === '/reports');

    if (!reportFile) {
      return notFound('Report');
    }

    // Download the report content
    const buffer = await fileStorageManager.downloadFile(reportFile);
    const content = buffer.toString('utf-8');

    logger.info('[System Tools v1] Retrieved capabilities report', {
      userId: user.id,
      reportId,
      size: buffer.length,
    });

    if (download) {
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="${reportFile.originalFilename}"`,
          'Content-Length': String(buffer.length),
        },
      });
    }

    return NextResponse.json({
      reportId,
      filename: reportFile.originalFilename,
      content,
      size: buffer.length,
    });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to get capabilities report',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to get report');
  }
}

async function handleCapabilitiesReportDelete(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {
    const body = await req.json();
    const { reportId } = body;

    if (!reportId) {
      return badRequest('Missing reportId');
    }

    logger.info('[System Tools v1] Deleting capabilities report', { userId: user.id, reportId });

    // Find the report file in the database from DOCUMENT category
    const allDocuments = await repos.files.findByCategory('DOCUMENT');
    const reportFile = allDocuments.find((f: any) => f.id === reportId && f.folderPath === '/reports');

    if (!reportFile) {
      return notFound('Report');
    }

    // Delete the report from storage
    await fileStorageManager.deleteFile(reportFile);

    // Delete the file entry from database
    await repos.files.delete(reportFile.id);

    logger.info('[System Tools v1] Deleted capabilities report', { userId: user.id, reportId });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      '[System Tools v1] Failed to delete capabilities report',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to delete report');
  }
}

async function handleMemoryDedupPreview(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const { searchParams } = req.nextUrl;
    const thresholdParam = searchParams.get('threshold');
    const threshold = thresholdParam ? parseFloat(thresholdParam) : 0.80;

    if (isNaN(threshold) || threshold < 0.5 || threshold > 1.0) {
      return badRequest('Invalid threshold. Must be a number between 0.5 and 1.0');
    }

    logger.info('[System Tools v1] Memory dedup preview', { userId: user.id, threshold });

    const result = await deduplicateAllMemories(user.id, threshold, true);

    logger.info('[System Tools v1] Memory dedup preview complete', {
      userId: user.id,
      totalOriginal: result.totalOriginal,
      totalRemoved: result.totalRemoved,
      totalMergedDetails: result.totalMergedDetails,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logger.error(
      '[System Tools v1] Memory dedup preview failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to preview memory deduplication');
  }
}

async function handleMemoryDedup(req: NextRequest, context: any) {
  const { user } = context;

  try {
    const body = await req.json();
    const { threshold: thresholdParam } = body;
    const threshold = typeof thresholdParam === 'number' ? thresholdParam : 0.80;

    if (isNaN(threshold) || threshold < 0.5 || threshold > 1.0) {
      return badRequest('Invalid threshold. Must be a number between 0.5 and 1.0');
    }

    logger.info('[System Tools v1] Starting memory deduplication', { userId: user.id, threshold });

    const result = await deduplicateAllMemories(user.id, threshold, false);

    logger.info('[System Tools v1] Memory deduplication complete', {
      userId: user.id,
      totalOriginal: result.totalOriginal,
      totalRemoved: result.totalRemoved,
      totalMergedDetails: result.totalMergedDetails,
      totalFinal: result.totalFinal,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logger.error(
      '[System Tools v1] Memory deduplication failed',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to deduplicate memories');
  }
}

async function handleAIImportStream(req: NextRequest, context: any) {
  const { user, repos } = context;

  try {
    const body = await req.json();

    const request: AIImportRequest = {
      profileId: body.profileId,
      sourceFileIds: body.sourceFileIds || [],
      sourceText: body.sourceText || '',
      includeMemories: body.includeMemories ?? true,
      includeChats: body.includeChats ?? false,
      existingResult: body.existingResult || undefined,
      regenerateSteps: body.regenerateSteps || undefined,
    };

    if (!request.profileId) {
      return badRequest('Missing required field: profileId');
    }

    if (request.sourceFileIds.length === 0 && !request.sourceText.trim()) {
      return badRequest('Must provide at least one source file or source text');
    }

    logger.info('[System Tools v1] AI Import stream starting', {
      userId: user.id,
      profileId: request.profileId,
      sourceFileCount: request.sourceFileIds.length,
      hasSourceText: !!request.sourceText.trim(),
      includeMemories: request.includeMemories,
      includeChats: request.includeChats,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (event: AIImportProgressEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Stream may be closed
          }
        };

        await runAIImportStreaming(request, user.id, repos, enqueue);

        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'AI import failed';
    logger.error('[System Tools v1] AI Import stream failed', {
      userId: user.id,
      error: errorMessage,
    });
    return serverError(errorMessage);
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

export const GET = createContextHandler(async (req: NextRequest, context) => {
  const action = getActionParam(req);

  if (!isValidAction(action, TOOLS_GET_ACTIONS)) {
    return badRequest(
      `Unknown action: ${action}. Available GET actions: ${TOOLS_GET_ACTIONS.join(', ')}`
    );
  }

  const actionHandlers: Record<ToolsGetAction, () => Promise<NextResponse>> = {
    'tasks-queue': () => handleTasksQueue(req, context),
    'job-concurrency': () => handleJobConcurrency(req, context),
    'delete-data-preview': () => handleDeleteDataPreview(req, context),
    'export-entities': () => handleExportEntities(req, context),
    'export-preview': () => handleExportPreview(req, context),
    'capabilities-report': () => handleCapabilitiesReport(req, context),
    'capabilities-report-list': () => handleCapabilitiesReportList(req, context),
    'capabilities-report-get': () => handleCapabilitiesReportGet(req, context),
    'memory-dedup-preview': () => handleMemoryDedupPreview(req, context),
  };

  return actionHandlers[action]();
});

export const POST = createContextHandler(async (req: NextRequest, context) => {
  const action = getActionParam(req);

  if (!isValidAction(action, TOOLS_POST_ACTIONS)) {
    return badRequest(
      `Unknown action: ${action}. Available POST actions: ${TOOLS_POST_ACTIONS.join(', ')}`
    );
  }

  const actionHandlers: Record<ToolsPostAction, () => Promise<NextResponse>> = {
    'delete-data': () => handleDeleteData(req, context),
    'tasks-queue': () => handleTasksQueueControl(req, context),
    'job-concurrency': () => handleJobConcurrencyControl(req, context),
    'export': () => handleExport(req, context),
    'import-preview': () => handleImportPreview(req, context),
    'import-execute': () => handleImportExecute(req, context),
    'capabilities-report-generate': () => handleCapabilitiesReportGenerate(req, context),
    'capabilities-report-delete': () => handleCapabilitiesReportDelete(req, context),
    'memory-dedup': () => handleMemoryDedup(req, context),
    'ai-import-stream': () => handleAIImportStream(req, context),
  };

  return actionHandlers[action]();
});
