/**
 * Memories API v1 - Collection Endpoint
 *
 * Consolidated REST API for memory operations.
 *
 * GET /api/v1/memories - List memories (requires characterId, chatId, or messageId query param)
 * POST /api/v1/memories - Create memory (characterId in body) OR actions via ?action=
 * DELETE /api/v1/memories - Delete memories by filter (e.g., ?chatId= for bulk delete)
 *
 * Actions (via ?action= query parameter):
 * - POST ?action=search - Semantic/keyword search (characterId in body)
 * - POST ?action=housekeep - Run memory cleanup synchronously (characterId in body)
 * - POST ?action=housekeep-sweep - Enqueue a background sweep across every character owned by the user
 * - POST ?action=embeddings - Generate missing embeddings (characterId in body)
 * - POST ?action=housekeeping-config - Update auto-housekeeping settings
 * - POST ?action=extraction-limits-config - Update per-hour extraction rate limits
 * - POST ?action=recall-config - Update recall relevance settings (cross-project scope policy, related-memory expansion)
 * - POST ?action=backfill-embeddings - Enqueue embedding-generate jobs for memories missing an embedding
 * - POST ?action=regenerate-all - Wipe and rebuild every chat-linked memory in the background
 * - POST ?action=extraction-concurrency - Update the per-user MEMORY_EXTRACTION concurrency cap
 * - PUT ?action=embeddings - Rebuild vector index (characterId in body)
 * - GET ?action=housekeep&characterId= - Get housekeeping preview
 * - GET ?action=embeddings&characterId= - Get embedding status
 * - GET ?action=housekeeping-config - Read current auto-housekeeping settings
 * - GET ?action=extraction-limits-config - Read current extraction rate limits
 * - GET ?action=recall-config - Read current recall relevance settings
 * - GET ?action=backfill-embeddings - Report progress of the embedding backfill
 * - GET ?action=character-memory-counts - List user's characters with memory counts (for housekeeping UI)
 * - GET ?action=extraction-concurrency - Read current MEMORY_EXTRACTION concurrency cap
 * - GET ?action=regenerate-all - Report whether a regenerate sweep is in flight
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createContextHandler,
  getActionParam,
} from '@/lib/api/middleware';
import { createMemoryWithEmbedding, searchMemoriesSemantic, generateMissingEmbeddings, rebuildVectorIndex, deleteMemoriesByChatIdWithVectors } from '@/lib/memory/memory-service';
import { runHousekeeping, getHousekeepingPreview, HousekeepingOptions } from '@/lib/memory/housekeeping';
import { scheduleRefit } from '@/lib/embedding/embedding-job-scheduler';
import { getDefaultEmbeddingProfile } from '@/lib/embedding/embedding-service';
import { enqueueEmbeddingGenerate, enqueueMemoryHousekeeping, enqueueMemoryRegenerateAll } from '@/lib/background-jobs/queue-service';
import { setMemoryExtractionConcurrencyOverride } from '@/lib/background-jobs/processor';
import {
  getMemoryExtractionConcurrency,
  setMemoryExtractionConcurrency,
  getMemoryExtractionLimits,
  setMemoryExtractionLimits,
  getMemoryRecallSettings,
  setMemoryRecallSettings,
} from '@/lib/instance-settings';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses';
import type { ChatEvent, MessageEvent, ChatMetadata } from '@/lib/schemas/types';

// =============================================================================
// Validation Schemas
// =============================================================================

const createMemorySchema = z.object({
  characterId: z.uuid('Character ID is required'),
  content: z.string().min(1, 'Memory content is required'),
  summary: z.string().min(1, 'Memory summary is required'),
  keywords: z.array(z.string()).prefault([]),
  tags: z.array(z.uuid()).prefault([]),
  importance: z.number().min(0).max(1).prefault(0.5),
  aboutCharacterId: z.uuid().nullable().optional(),
  chatId: z.uuid().nullable().optional(),
  source: z.enum(['AUTO', 'MANUAL']).prefault('MANUAL'),
  sourceMessageId: z.uuid().nullable().optional(),
  skipGate: z.boolean().optional(),
});

const searchMemorySchema = z.object({
  characterId: z.uuid('Character ID is required'),
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().min(1).max(100).prefault(20),
  minImportance: z.number().min(0).max(1).optional(),
  minScore: z.number().min(0).max(1).optional(),
  source: z.enum(['AUTO', 'MANUAL']).optional(),
});

const housekeepingOptionsSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  maxMemories: z.number().min(10).max(10000).optional(),
  maxAgeMonths: z.number().min(1).max(120).optional(),
  maxInactiveMonths: z.number().min(1).max(120).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  mergeSimilar: z.boolean().optional(),
  mergeThreshold: z.number().min(0.8).max(1).optional(),
  dryRun: z.boolean().optional(),
});

const generateEmbeddingsSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  batchSize: z.number().min(1).max(50).prefault(10),
});

const rebuildIndexSchema = z.object({
  characterId: z.uuid('Character ID is required'),
  confirm: z.literal(true, {
    error: () => 'Must confirm rebuild with confirm: true',
  }),
});

const housekeepingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  perCharacterCap: z.number().int().min(100).max(100000).optional(),
  perCharacterCapOverrides: z.record(z.string(), z.number().int().positive()).optional(),
  autoMergeSimilarThreshold: z.number().min(0).max(1).optional(),
  mergeSimilar: z.boolean().optional(),
});

const extractionLimitsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxPerHour: z.number().int().min(1).max(10000).optional(),
  softStartFraction: z.number().min(0).max(1).optional(),
  softFloor: z.number().min(0).max(1).optional(),
});

const recallConfigSchema = z.object({
  scopePolicy: z.enum(['down-weight', 'exclude']).optional(),
  expandRelated: z.boolean().optional(),
});

const backfillStartSchema = z.object({
  /** Restrict backfill to one character; omit to backfill all of user's characters. */
  characterId: z.uuid().optional(),
  /** Batch size per call (caller may poll repeatedly for large backlogs). */
  batchSize: z.number().int().min(1).max(2000).prefault(500),
});

const extractionConcurrencySchema = z.object({
  concurrency: z.number().int().min(1).max(32),
});

// =============================================================================
// GET /api/v1/memories - List memories
// =============================================================================

export const GET = createContextHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);
  const { searchParams } = req.nextUrl;
  const characterId = searchParams.get('characterId');
  const chatId = searchParams.get('chatId');
  const messageId = searchParams.get('messageId');

  // Handle action-based GET requests
  if (action === 'housekeep') {
    return handleHousekeepPreview(req, { user, repos }, characterId);
  }

  if (action === 'embeddings') {
    return handleEmbeddingStatus(req, { user, repos }, characterId);
  }

  if (action === 'housekeeping-config') {
    return handleReadHousekeepingConfig(req, { user, repos });
  }

  if (action === 'extraction-limits-config') {
    return handleReadExtractionLimitsConfig(req, { user, repos });
  }

  if (action === 'recall-config') {
    return handleReadRecallConfig(req, { user, repos });
  }

  if (action === 'backfill-embeddings') {
    return handleBackfillProgress(req, { user, repos });
  }

  if (action === 'character-memory-counts') {
    return handleCharacterMemoryCounts(req, { user, repos });
  }

  if (action === 'extraction-concurrency') {
    return handleReadExtractionConcurrency(req, { user, repos });
  }

  if (action === 'regenerate-all') {
    return handleRegenerateAllStatus(req, { user, repos });
  }

  // Standard list operations - require a filter
  if (!characterId && !chatId && !messageId) {
    return badRequest('Query parameter required: characterId, chatId, or messageId');
  }

  try {
    // List by character
    if (characterId) {
      return listMemoriesByCharacter(req, { user, repos }, characterId);
    }

    // Count by chat
    if (chatId) {
      return countMemoriesByChat(req, { user, repos }, chatId);
    }

    // Get by message
    if (messageId) {
      return getMemoriesByMessage(req, { user, repos }, messageId);
    }

    return badRequest('Invalid query parameters');
  } catch (error) {
    logger.error('[Memories API] Error listing memories', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list memories');
  }
});

// =============================================================================
// POST /api/v1/memories - Create memory or perform action
// =============================================================================

export const POST = createContextHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);

  // Action-based operations
  if (action === 'search') {
    return handleSearch(req, { user, repos });
  }

  if (action === 'housekeep') {
    return handleHousekeep(req, { user, repos });
  }

  if (action === 'housekeep-sweep') {
    return handleHousekeepSweep(req, { user });
  }

  if (action === 'embeddings') {
    return handleGenerateEmbeddings(req, { user, repos });
  }

  if (action === 'housekeeping-config') {
    return handleWriteHousekeepingConfig(req, { user, repos });
  }

  if (action === 'extraction-limits-config') {
    return handleWriteExtractionLimitsConfig(req, { user, repos });
  }

  if (action === 'recall-config') {
    return handleWriteRecallConfig(req, { user, repos });
  }

  if (action === 'backfill-embeddings') {
    return handleBackfillStart(req, { user, repos });
  }

  if (action === 'regenerate-all') {
    return handleRegenerateAll(req, { user, repos });
  }

  if (action === 'extraction-concurrency') {
    return handleWriteExtractionConcurrency(req, { user, repos });
  }

  // Default: Create memory
  return handleCreateMemory(req, { user, repos });
});

// =============================================================================
// PUT /api/v1/memories - Bulk operations (action-based only)
// =============================================================================

export const PUT = createContextHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);

  if (action === 'embeddings') {
    return handleRebuildIndex(req, { user, repos });
  }

  return badRequest('PUT requires ?action=embeddings parameter');
});

// =============================================================================
// DELETE /api/v1/memories - Delete memories by filter
// =============================================================================

export const DELETE = createContextHandler(async (req, { user, repos }) => {
  const chatId = req.nextUrl.searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  return handleDeleteByChatId(req, { user, repos }, chatId);
});

// =============================================================================
// Handler Implementations
// =============================================================================

async function listMemoriesByCharacter(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  characterId: string
) {
  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Get query params for filtering and pagination
  const { searchParams } = req.nextUrl;
  const search = searchParams.get('search') || undefined;
  const minImportanceParam = searchParams.get('minImportance');
  const source = searchParams.get('source') as 'AUTO' | 'MANUAL' | null;
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

  // Pagination params (default: no limit = return all for backward compat)
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  const minImportance = minImportanceParam ? parseFloat(minImportanceParam) : undefined;

  // If pagination params provided, use paginated query
  if (limitParam) {
    const limit = Math.max(1, Math.min(200, parseInt(limitParam, 10) || 50));
    const offset = Math.max(0, parseInt(offsetParam || '0', 10) || 0);

    const { memories, totalCount } = await repos.memories.findByCharacterIdPaginated(characterId, {
      limit,
      offset,
      sortBy,
      sortOrder,
      search,
      source: source && (source === 'AUTO' || source === 'MANUAL') ? source : undefined,
      minImportance: minImportance !== undefined && !isNaN(minImportance) ? minImportance : undefined,
    });

    // Enrich with tag names
    const allTags = await repos.tags.findAll();
    const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

    const memoriesWithTags = memories.map((memory: any) => ({
      ...memory,
      tagDetails: memory.tags.map((tagId: string) => tagMap.get(tagId)).filter(Boolean),
    }));

    return NextResponse.json({
      memories: memoriesWithTags,
      count: memoriesWithTags.length,
      totalCount,
    });
  }

  // Legacy unpaginated path (for other callers)
  let memories = await repos.memories.findByCharacterId(characterId);

  // Apply filters
  if (search) {
    const searchLower = search.toLowerCase();
    memories = memories.filter((memory: any) =>
      memory.content.toLowerCase().includes(searchLower) ||
      memory.summary.toLowerCase().includes(searchLower) ||
      memory.keywords.some((k: string) => k.toLowerCase().includes(searchLower))
    );
  }

  if (minImportance !== undefined && !isNaN(minImportance)) {
    memories = memories.filter((m: any) => m.importance >= minImportance);
  }

  if (source && (source === 'AUTO' || source === 'MANUAL')) {
    memories = memories.filter((m: any) => m.source === source);
  }

  // Sort
  memories.sort((a: any, b: any) => {
    let comparison = 0;
    switch (sortBy) {
      case 'importance':
        comparison = a.importance - b.importance;
        break;
      case 'updatedAt':
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case 'createdAt':
      default:
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  // Enrich with tag names
  const allTags = await repos.tags.findAll();
  const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

  const memoriesWithTags = memories.map((memory: any) => ({
    ...memory,
    tagDetails: memory.tags.map((tagId: string) => tagMap.get(tagId)).filter(Boolean),
  }));

  return NextResponse.json({
    memories: memoriesWithTags,
    count: memoriesWithTags.length,
    totalCount: memoriesWithTags.length,
  });
}

async function countMemoriesByChat(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  chatId: string
) {
  // Verify chat ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const count = await repos.memories.countByChatId(chatId);

  return NextResponse.json({
    chatId,
    memoryCount: count,
  });
}

async function getMemoriesByMessage(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  messageId: string
) {
  // Find the message across user's chats
  const userChats = await repos.chats.findByUserId(user.id);
  let foundChat: ChatMetadata | null = null;
  let foundMessage: MessageEvent | null = null;
  let allMessages: ChatEvent[] = [];

  for (const chat of userChats) {
    const messages = await repos.chats.getMessages(chat.id);
    const message = messages.find(
      (m: ChatEvent): m is MessageEvent => m.type === 'message' && m.id === messageId
    );
    if (message) {
      foundChat = chat;
      foundMessage = message;
      allMessages = messages;
      break;
    }
  }

  if (!foundMessage || !foundChat) {
    return notFound('Message');
  }

  // Get all message IDs in swipe group if applicable
  let messageIds: string[] = [messageId];
  if (foundMessage.swipeGroupId) {
    messageIds = allMessages
      .filter(
        (m): m is MessageEvent =>
          m.type === 'message' && m.swipeGroupId === foundMessage!.swipeGroupId
      )
      .map((m) => m.id);
  }

  // Get memory count and details
  const memoryCount = await repos.memories.countBySourceMessageIds(messageIds);
  let memories: Array<{
    id: string;
    summary: string;
    characterId: string;
    importance: number;
  }> = [];

  if (memoryCount > 0) {
    const memoryResults = await Promise.all(
      messageIds.map((mid) => repos.memories.findBySourceMessageId(mid))
    );
    memories = memoryResults.flat().map((m: any) => ({
      id: m.id,
      summary: m.summary,
      characterId: m.characterId,
      importance: m.importance,
    }));
  }

  return NextResponse.json({
    memoryCount,
    isSwipeGroup: !!foundMessage.swipeGroupId,
    swipeCount: messageIds.length,
    memories,
  });
}

async function handleCreateMemory(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const validatedData = createMemorySchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(validatedData.characterId);
  if (!character) {
    return notFound('Character');
  }

  // Create memory with embedding generation
  const memory = await createMemoryWithEmbedding(
    {
      characterId: validatedData.characterId,
      content: validatedData.content,
      summary: validatedData.summary,
      keywords: validatedData.keywords,
      tags: validatedData.tags,
      importance: validatedData.importance,
      aboutCharacterId: validatedData.aboutCharacterId,
      chatId: validatedData.chatId,
      source: validatedData.source,
      sourceMessageId: validatedData.sourceMessageId,
    },
    { userId: user.id, skipGate: validatedData.skipGate }
  );

  if (!memory) {
    // Embedding generation failed after retry; no row was written because a
    // memory without an embedding would be invisible to every future gate
    // check. Surface this to the client so the UI can show the real reason.
    return serverError('Failed to generate embedding for memory — no row was created. Check the configured embedding profile.');
  }

  // Schedule vocabulary refit for BUILTIN profiles (debounced)
  // This runs in the background and doesn't block the response
  scheduleRefit(user.id).catch((error) => {
    logger.warn('[Memories API] Failed to schedule refit', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return NextResponse.json({ memory }, { status: 201 });
}

async function handleSearch(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const { characterId, query, limit, minImportance, minScore, source } = searchMemorySchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Semantic search
  const searchResults = await searchMemoriesSemantic(characterId, query, {
    userId: user.id,
    limit,
    minScore,
    minImportance,
    source,
  });

  // Enrich with tag names
  const allTags = await repos.tags.findAll();
  const tagMap = new Map(allTags.map((t: any) => [t.id, t]));

  const memoriesWithTags = searchResults.map((result: any) => ({
    ...result.memory,
    score: result.score,
    usedEmbedding: result.usedEmbedding,
    tagDetails: result.memory.tags.map((tagId: string) => tagMap.get(tagId)).filter(Boolean),
  }));

  // Access times are bumped inside searchMemoriesSemantic (single source of
  // truth for retrieval-time access updates).

  return NextResponse.json({
    memories: memoriesWithTags,
    count: memoriesWithTags.length,
    query,
    usedEmbedding: searchResults.length > 0 ? searchResults[0].usedEmbedding : false,
  });
}

async function handleHousekeep(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const optionsResult = housekeepingOptionsSchema.safeParse(body);

  if (!optionsResult.success) {
    return validationError(optionsResult.error);
  }

  const { characterId, ...optionData } = optionsResult.data;

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  const options: HousekeepingOptions = {
    ...optionData,
    userId: user.id,
  };

  // Embedding profile is always the system default — no per-chat override

  // Run housekeeping (or preview if dryRun)
  const result = options.dryRun
    ? await getHousekeepingPreview(characterId, options)
    : await runHousekeeping(characterId, options);

  return NextResponse.json({
    success: true,
    dryRun: !!options.dryRun,
    result: {
      deleted: result.deleted,
      merged: result.merged,
      kept: result.kept,
      totalBefore: result.totalBefore,
      totalAfter: result.totalAfter,
      deletedIds: result.deletedIds,
      mergedIds: result.mergedIds,
      details: options.dryRun ? result.details : undefined,
    },
  });
}

async function handleHousekeepSweep(
  _req: NextRequest,
  { user }: { user: { id: string } }
) {
  try {
    const jobId = await enqueueMemoryHousekeeping(user.id, { reason: 'manual' });
    logger.info('[Memories API] Enqueued manual housekeeping sweep', {
      userId: user.id,
      jobId,
    });
    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    logger.error('[Memories API] Failed to enqueue housekeeping sweep', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to enqueue housekeeping sweep');
  }
}

async function handleHousekeepPreview(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  characterId: string | null
) {
  if (!characterId) {
    return badRequest('characterId query parameter required for housekeep preview');
  }

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Parse options from query params
  const { searchParams } = req.nextUrl;
  const options: HousekeepingOptions = { userId: user.id };

  if (searchParams.has('maxMemories')) {
    const val = parseInt(searchParams.get('maxMemories')!, 10);
    if (isNaN(val) || val < 1 || val > 100000) {
      return badRequest('maxMemories must be an integer between 1 and 100000');
    }
    options.maxMemories = val;
  }
  if (searchParams.has('maxAgeMonths')) {
    const val = parseInt(searchParams.get('maxAgeMonths')!, 10);
    if (isNaN(val) || val < 1 || val > 1200) {
      return badRequest('maxAgeMonths must be an integer between 1 and 1200');
    }
    options.maxAgeMonths = val;
  }
  if (searchParams.has('minImportance')) {
    const val = parseFloat(searchParams.get('minImportance')!);
    if (isNaN(val) || val < 0 || val > 1) {
      return badRequest('minImportance must be a number between 0 and 1');
    }
    options.minImportance = val;
  }
  if (searchParams.has('mergeSimilar')) {
    options.mergeSimilar = searchParams.get('mergeSimilar') === 'true';
  }

  // Embedding profile is always the system default — no per-chat override

  const preview = await getHousekeepingPreview(characterId, options);

  return NextResponse.json({
    success: true,
    preview: {
      wouldDelete: preview.deleted,
      wouldMerge: preview.merged,
      wouldKeep: preview.kept,
      totalBefore: preview.totalBefore,
      totalAfter: preview.totalAfter,
      details: preview.details,
    },
  });
}

async function handleReadHousekeepingConfig(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const settings = await repos.chatSettings.findByUserId(user.id);
  const autoHousekeepingSettings = settings?.autoHousekeepingSettings ?? {
    enabled: false,
    perCharacterCap: 2000,
    perCharacterCapOverrides: {},
    autoMergeSimilarThreshold: 0.90,
    mergeSimilar: false,
  };
  return NextResponse.json({ success: true, settings: autoHousekeepingSettings });
}

async function handleWriteHousekeepingConfig(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const parsed = housekeepingConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const existing = await repos.chatSettings.findByUserId(user.id);
  const currentSettings = existing?.autoHousekeepingSettings ?? {
    enabled: false,
    perCharacterCap: 2000,
    perCharacterCapOverrides: {},
    autoMergeSimilarThreshold: 0.90,
    mergeSimilar: false,
  };

  const merged = {
    enabled: parsed.data.enabled ?? currentSettings.enabled,
    perCharacterCap: parsed.data.perCharacterCap ?? currentSettings.perCharacterCap,
    perCharacterCapOverrides: parsed.data.perCharacterCapOverrides ?? currentSettings.perCharacterCapOverrides,
    autoMergeSimilarThreshold: parsed.data.autoMergeSimilarThreshold ?? currentSettings.autoMergeSimilarThreshold,
    mergeSimilar: parsed.data.mergeSimilar ?? currentSettings.mergeSimilar,
  };

  await repos.chatSettings.updateForUser(user.id, {
    autoHousekeepingSettings: merged,
  });

  logger.info('[Memories API] Auto-housekeeping settings updated', {
    userId: user.id,
    enabled: merged.enabled,
    perCharacterCap: merged.perCharacterCap,
  });

  return NextResponse.json({ success: true, settings: merged });
}

async function handleReadExtractionLimitsConfig(
  _req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const memoryExtractionLimits = await getMemoryExtractionLimits();
  return NextResponse.json({ success: true, settings: memoryExtractionLimits });
}

async function handleWriteExtractionLimitsConfig(
  req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const parsed = extractionLimitsConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const currentSettings = await getMemoryExtractionLimits();
  const merged = {
    enabled: parsed.data.enabled ?? currentSettings.enabled,
    maxPerHour: parsed.data.maxPerHour ?? currentSettings.maxPerHour,
    softStartFraction: parsed.data.softStartFraction ?? currentSettings.softStartFraction,
    softFloor: parsed.data.softFloor ?? currentSettings.softFloor,
  };

  await setMemoryExtractionLimits(merged);

  logger.info('[Memories API] Extraction rate limits updated (instance-wide)', {
    enabled: merged.enabled,
    maxPerHour: merged.maxPerHour,
  });

  return NextResponse.json({ success: true, settings: merged });
}

async function handleReadRecallConfig(
  _req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const memoryRecall = await getMemoryRecallSettings();
  return NextResponse.json({ success: true, settings: memoryRecall });
}

async function handleWriteRecallConfig(
  req: NextRequest,
  _ctx: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const parsed = recallConfigSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const currentSettings = await getMemoryRecallSettings();
  const merged = {
    scopePolicy: parsed.data.scopePolicy ?? currentSettings.scopePolicy,
    expandRelated: parsed.data.expandRelated ?? currentSettings.expandRelated,
  };

  await setMemoryRecallSettings(merged);

  logger.info('[Memories API] Recall settings updated (instance-wide)', {
    scopePolicy: merged.scopePolicy,
    expandRelated: merged.expandRelated,
  });

  return NextResponse.json({ success: true, settings: merged });
}

async function handleCharacterMemoryCounts(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const characters = await repos.characters.findByUserId(user.id);
  const results = await Promise.all(
    characters.map(async (c: { id: string; name: string }) => ({
      id: c.id,
      name: c.name,
      memoryCount: await repos.memories.countByCharacterId(c.id),
    }))
  );
  // Sort by memory count descending so busy characters surface first
  results.sort((a, b) => b.memoryCount - a.memoryCount);
  return NextResponse.json({ success: true, characters: results });
}

async function handleBackfillProgress(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  // Count memories still missing embeddings (across this user's characters)
  const remaining = await repos.memories.countWithoutEmbedding();

  // Count in-flight EMBEDDING_GENERATE jobs for this user
  const [pending, processing] = await Promise.all([
    repos.backgroundJobs.findByUserId(user.id, 'PENDING'),
    repos.backgroundJobs.findByUserId(user.id, 'PROCESSING'),
  ]);
  const isEmbeddingMemory = (job: { type: string; payload: unknown }) => {
    if (job.type !== 'EMBEDDING_GENERATE') return false;
    const payload = job.payload as { entityType?: string } | undefined;
    return payload?.entityType === 'MEMORY';
  };
  const inFlight = pending.filter(isEmbeddingMemory).length + processing.filter(isEmbeddingMemory).length;

  return NextResponse.json({
    success: true,
    progress: {
      remaining,
      inFlight,
    },
  });
}

async function handleBackfillStart(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const parsed = backfillStartSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  const { characterId, batchSize } = parsed.data;

  // Verify ownership if targeting a specific character
  if (characterId) {
    const character = await repos.characters.findById(characterId);
    if (!character) {
      return notFound('Character');
    }
  }

  // Find memories missing embeddings (up to batchSize)
  const missing = await repos.memories.findIdsWithoutEmbedding({ characterId, limit: batchSize });
  if (missing.length === 0) {
    return NextResponse.json({
      success: true,
      enqueued: 0,
      remaining: 0,
      message: 'No memories missing embeddings — nothing to backfill.',
    });
  }

  // Resolve the user's active embedding profile — the plan assumes a single
  // profile is in use per instance, so we just use the default.
  const profile = await getDefaultEmbeddingProfile(user.id);
  if (!profile) {
    return badRequest(
      'No default embedding profile is configured. Set one in the Commonplace Book tab before running the backfill.'
    );
  }

  let enqueued = 0;
  for (const memory of missing) {
    try {
      await enqueueEmbeddingGenerate(user.id, {
        entityType: 'MEMORY',
        entityId: memory.id,
        characterId: memory.characterId,
        profileId: profile.id,
      });
      enqueued++;
    } catch (error) {
      logger.warn('[Memories API] Failed to enqueue backfill embedding job', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remaining = await repos.memories.countWithoutEmbedding(characterId);

  logger.info('[Memories API] Embedding backfill batch enqueued', {
    userId: user.id,
    characterId: characterId ?? '(all)',
    enqueued,
    remaining,
  });

  return NextResponse.json({
    success: true,
    enqueued,
    remaining,
    message:
      remaining > 0
        ? `Enqueued ${enqueued} embedding jobs. ${remaining} memories still missing embeddings — run again to continue.`
        : `Enqueued ${enqueued} embedding jobs. All memories are now accounted for.`,
  });
}

async function handleGenerateEmbeddings(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json().catch(() => ({}));
  const { characterId, batchSize } = generateEmbeddingsSchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Check embedding profile
  const defaultProfile = await repos.embeddingProfiles.findDefault(user.id);
  if (!defaultProfile) {
    return badRequest('No embedding profile configured. Please set up an embedding profile in settings.');
  }

  // Get memory stats
  const memories = await repos.memories.findByCharacterId(characterId);
  const memoriesWithoutEmbeddings = memories.filter(
    (m: any) => !m.embedding || m.embedding.length === 0
  );

  if (memoriesWithoutEmbeddings.length === 0) {
    return NextResponse.json({
      message: 'All memories already have embeddings',
      processed: 0,
      failed: 0,
      skipped: 0,
      total: memories.length,
    });
  }

  // Generate embeddings
  const result = await generateMissingEmbeddings(characterId, {
    userId: user.id,
    batchSize,
  });

  return NextResponse.json({
    message: 'Embedding generation complete',
    ...result,
    total: memories.length,
    remaining: memoriesWithoutEmbeddings.length - result.processed - result.failed,
  });
}

async function handleEmbeddingStatus(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  characterId: string | null
) {
  if (!characterId) {
    return badRequest('characterId query parameter required for embedding status');
  }

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Get memory stats
  const memories = await repos.memories.findByCharacterId(characterId);
  const withEmbeddings = memories.filter((m: any) => m.embedding && m.embedding.length > 0);
  const withoutEmbeddings = memories.filter((m: any) => !m.embedding || m.embedding.length === 0);

  // Check if embedding profile is configured
  const defaultProfile = await repos.embeddingProfiles.findDefault(user.id);

  return NextResponse.json({
    total: memories.length,
    withEmbeddings: withEmbeddings.length,
    withoutEmbeddings: withoutEmbeddings.length,
    percentComplete: memories.length > 0
      ? Math.round((withEmbeddings.length / memories.length) * 100)
      : 100,
    embeddingProfileConfigured: defaultProfile !== null,
    embeddingProfileName: defaultProfile?.name || null,
  });
}

async function handleRebuildIndex(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any }
) {
  const body = await req.json();
  const { characterId } = rebuildIndexSchema.parse(body);

  // Verify character ownership
  const character = await repos.characters.findById(characterId);
  if (!character) {
    return notFound('Character');
  }

  // Rebuild the vector index
  const result = await rebuildVectorIndex(characterId, { userId: user.id });

  return NextResponse.json({
    message: 'Vector index rebuilt successfully',
    ...result,
  });
}

async function handleDeleteByChatId(
  req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
  chatId: string
) {
  // Verify chat ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const { deleted } = await deleteMemoriesByChatIdWithVectors(chatId);

  return NextResponse.json({
    success: true,
    chatId,
    deletedCount: deleted,
  });
}

async function handleRegenerateAll(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
) {
  // Pressing the button again is an explicit "kill the previous sweep and
  // start over" gesture — wipe every PENDING/PROCESSING job from the
  // previous run before enqueueing the new fan-out. Currently-executing
  // handlers will finish their LLM call and try to mark themselves
  // complete; those updates become no-ops because the row is gone, and
  // any memories they wrote post-cancel get cleaned up by the next round
  // of MEMORY_REGENERATE_CHAT wipes the fresh sweep enqueues.
  const cleared = await repos.backgroundJobs.deleteByTypesAndStatuses(
    [
      'MEMORY_REGENERATE_ALL',
      'MEMORY_REGENERATE_CHAT',
      'MEMORY_EXTRACTION',
      'INTER_CHARACTER_MEMORY',
    ],
    ['PENDING', 'PROCESSING'],
  );
  if (cleared > 0) {
    logger.info('[Memories API] Cleared in-flight regenerate jobs before fresh sweep', {
      userId: user.id,
      cleared,
    });
  }

  // Resolve the standard + dangerous-compatible cheap profiles up front and
  // hand them to the fan-out job. Resolution is cheap (a single connection
  // lookup) but it has to happen before we enqueue, so the job's payload is
  // self-contained.
  const settings = await repos.chatSettings.findByUserId(user.id);
  const profiles = await repos.connections.findByUserId(user.id);

  const cheapDefaultId = settings?.cheapLLMSettings?.defaultCheapProfileId ?? null;
  const cheapDefault = cheapDefaultId
    ? profiles.find((p: { id: string }) => p.id === cheapDefaultId)
    : null;
  const standardProfileId = cheapDefault?.id ?? profiles[0]?.id ?? null;
  if (!standardProfileId) {
    return badRequest(
      'No connection profiles found. Add at least one provider connection before regenerating memories.',
    );
  }

  const uncensoredTextProfileId =
    settings?.dangerousContentSettings?.uncensoredTextProfileId ?? null;
  const uncensoredCheap = uncensoredTextProfileId
    ? profiles.find(
        (p: { id: string; isCheap?: boolean }) =>
          p.id === uncensoredTextProfileId && p.isCheap === true,
      )
    : null;
  const anyDangerousCheap = profiles.find(
    (p: { isCheap?: boolean; isDangerousCompatible?: boolean }) =>
      p.isCheap === true && p.isDangerousCompatible === true,
  );
  const dangerousProfileId =
    uncensoredCheap?.id ?? anyDangerousCheap?.id ?? standardProfileId;

  // Single fan-out job — the actual chat enumeration, orphan walk, and
  // per-chat enqueues happen in the background processor so this endpoint
  // returns in milliseconds even on instances with tens of thousands of
  // memories. Dedupes on userId so a double-click doesn't produce two
  // fan-outs.
  const { jobId, isNew } = await enqueueMemoryRegenerateAll(user.id, {
    standardProfileId,
    dangerousProfileId,
  });

  logger.info('[Memories API] Regenerate-all fan-out enqueued', {
    userId: user.id,
    jobId,
    isNew,
    standardProfileId,
    dangerousProfileId,
  });

  const clearedSuffix = cleared > 0
    ? ` Cleared ${cleared} in-flight job${cleared === 1 ? '' : 's'} from the previous sweep.`
    : '';

  return NextResponse.json({
    success: true,
    jobId,
    isNew,
    cleared,
    message: isNew
      ? `Regeneration scheduled — building the chat list in the background. The Mem badge will start ticking shortly.${clearedSuffix}`
      : `A regeneration sweep is already in progress. The existing run will continue.${clearedSuffix}`,
  });
}

async function handleRegenerateAllStatus(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
) {
  const [pending, processing] = await Promise.all([
    repos.backgroundJobs.findByUserId(user.id, 'PENDING'),
    repos.backgroundJobs.findByUserId(user.id, 'PROCESSING'),
  ]);
  const all = [...pending, ...processing];
  const inFlightFanOut = all.filter(
    (j: { type: string }) => j.type === 'MEMORY_REGENERATE_ALL',
  ).length;
  const inFlightWipes = all.filter(
    (j: { type: string }) => j.type === 'MEMORY_REGENERATE_CHAT',
  ).length;
  const inFlightExtractions = all.filter(
    (j: { type: string }) => j.type === 'MEMORY_EXTRACTION',
  ).length;
  return NextResponse.json({
    success: true,
    inFlightFanOut,
    inFlightWipes,
    inFlightExtractions,
    inFlight: inFlightFanOut + inFlightWipes + inFlightExtractions,
  });
}

async function handleReadExtractionConcurrency(
  _req: NextRequest,
  _ctx: { user: { id: string }; repos: any },
) {
  const concurrency = await getMemoryExtractionConcurrency();
  return NextResponse.json({ success: true, concurrency });
}

async function handleWriteExtractionConcurrency(
  req: NextRequest,
  _ctx: { user: { id: string }; repos: any },
) {
  const body = await req.json();
  const parsed = extractionConcurrencySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }
  await setMemoryExtractionConcurrency(parsed.data.concurrency);
  // Push the new value into the processor's runtime cache so it takes effect
  // on the next claim tick rather than waiting for the next cache refresh.
  setMemoryExtractionConcurrencyOverride(parsed.data.concurrency);
  logger.info('[Memories API] Memory extraction concurrency updated (instance-wide)', {
    concurrency: parsed.data.concurrency,
  });
  return NextResponse.json({ success: true, concurrency: parsed.data.concurrency });
}
