/**
 * The Almanack — Phase 3, "Auditing the ledgers".
 *
 * The main database: the census of every collection, the shape of the chats,
 * the state of the autonomous rooms, the Commonplace Book's contents, every
 * feature dial, the job queue, the embedding pipeline, the terminal and the
 * legacy file ledger.
 *
 * Everything here is a SQL roll-up. The old collector hydrated whole entities
 * to count them — one query per character for memory counts alone — which is
 * what made a report on a large instance take minutes.
 *
 * @module lib/tools/almanack/phase3-ledgers
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  getDataRetentionSettings,
  getMaxConcurrentJobs,
  getMemoryExtractionLimits,
  getMemoryRecallSettings,
  getLastMaintenanceSweepAt,
} from '@/lib/instance-settings';
import { resolveStaleChatDays, retentionCutoff } from '@/lib/background-jobs/maintenance/retention-constants';
import { isStale } from '@/lib/background-jobs/maintenance/collapse-stale-chat-assets';
import { getErrorMessage } from '@/lib/error-utils';
import { mainRow, mainRows, num } from './db';
import type {
  AutonomousRoomInfo,
  BackgroundJobInfo,
  CharacterBreakdownInfo,
  ChatBreakdownInfo,
  ChatStatsInfo,
  EmbeddingPipelineInfo,
  EnhancedDatabaseStats,
  FeatureConfigInfo,
  FolderStats,
  InstanceSettingsInfo,
  MemoryBreakdownInfo,
  StorageStats,
  TerminalInfo,
} from './types';

const moduleLogger = logger.child({ module: 'almanack:ledgers' });

/** `COUNT(*)` for a table, 0 when the table is missing or the query fails. */
async function countRows(table: string, where = '', params: unknown[] = []): Promise<number> {
  const row = await mainRow<{ n: number }>(
    `SELECT COUNT(*) AS n FROM "${table}" ${where}`,
    params,
    `ledgers.count:${table}`,
  );
  return num(row?.n);
}

/** The headline census. */
export async function collectDatabaseStats(userId: string): Promise<EnhancedDatabaseStats> {
  moduleLogger.debug('Collecting database statistics', { userId });

  const globalRepos = getRepositories();

  const [
    characters,
    favouriteCharacters,
    chats,
    memories,
    tags,
    projects,
    groups,
    profileRow,
    imageProfiles,
    embeddingProfiles,
  ] = await Promise.all([
    countRows('characters', 'WHERE "userId" = ?', [userId]),
    countRows('characters', 'WHERE "userId" = ? AND "isFavorite" = 1', [userId]),
    countRows('chats', 'WHERE "userId" = ?', [userId]),
    countRows('memories'),
    countRows('tags', 'WHERE "userId" = ?', [userId]),
    countRows('projects'),
    countRows('groups'),
    mainRow<{
      total: number;
      webSearchEnabled: number;
      toolUseEnabled: number;
      dangerousCompatible: number;
    }>(
      `SELECT COUNT(*)                                                     AS total,
              SUM(CASE WHEN "allowWebSearch" = 1 THEN 1 ELSE 0 END)        AS webSearchEnabled,
              SUM(CASE WHEN "allowToolUse" = 1 THEN 1 ELSE 0 END)          AS toolUseEnabled,
              SUM(CASE WHEN "isDangerousCompatible" = 1 THEN 1 ELSE 0 END) AS dangerousCompatible
       FROM "connection_profiles" WHERE "userId" = ?`,
      [userId],
      'ledgers.connectionProfiles',
    ),
    countRows('image_profiles', 'WHERE "userId" = ?', [userId]),
    countRows('embedding_profiles', 'WHERE "userId" = ?', [userId]),
  ]);

  // Templates come through the repositories — built-ins are synthesized there
  // rather than being rows, so a COUNT(*) would undercount them.
  let promptTemplates = { total: 0, builtIn: 0, custom: 0 };
  try {
    const prompts = await globalRepos.promptTemplates.findAllForUser(userId);
    const builtIn = prompts.filter(p => p.isBuiltIn).length;
    promptTemplates = { total: prompts.length, builtIn, custom: prompts.length - builtIn };
  } catch (error) {
    moduleLogger.debug('Failed to count prompt templates', { error: getErrorMessage(error) });
  }

  let roleplayTemplates = { total: 0, builtIn: 0, custom: 0 };
  try {
    const rts = await globalRepos.roleplayTemplates.findAllForUser(userId);
    const builtIn = rts.filter(r => r.isBuiltIn).length;
    roleplayTemplates = { total: rts.length, builtIn, custom: rts.length - builtIn };
  } catch (error) {
    moduleLogger.debug('Failed to count roleplay templates', { error: getErrorMessage(error) });
  }

  return {
    characters,
    favoriteCharacters: favouriteCharacters,
    chats,
    memories,
    tags,
    projects,
    groups,
    connectionProfiles: {
      total: num(profileRow?.total),
      webSearchEnabled: num(profileRow?.webSearchEnabled),
      toolUseEnabled: num(profileRow?.toolUseEnabled),
      dangerousCompatible: num(profileRow?.dangerousCompatible),
    },
    imageProfiles,
    embeddingProfiles,
    promptTemplates,
    roleplayTemplates,
  };
}

/** Aggregate token/cost figures carried on the chat rows themselves. */
export async function collectChatStats(userId: string): Promise<ChatStatsInfo> {
  const row = await mainRow<{
    cost: number;
    prompt: number;
    completion: number;
    messages: number;
    agentMode: number;
    dangerous: number;
  }>(
    `SELECT COALESCE(SUM("estimatedCostUSD"), 0)                     AS cost,
            COALESCE(SUM("totalPromptTokens"), 0)                    AS prompt,
            COALESCE(SUM("totalCompletionTokens"), 0)                AS completion,
            COALESCE(SUM("messageCount"), 0)                         AS messages,
            SUM(CASE WHEN "agentModeEnabled" = 1 THEN 1 ELSE 0 END)  AS agentMode,
            SUM(CASE WHEN "isDangerousChat" = 1 THEN 1 ELSE 0 END)   AS dangerous
     FROM "chats" WHERE "userId" = ?`,
    [userId],
    'ledgers.chatStats',
  );

  return {
    totalEstimatedCostUSD: num(row?.cost),
    totalPromptTokens: num(row?.prompt),
    totalCompletionTokens: num(row?.completion),
    totalMessages: num(row?.messages),
    agentModeChats: num(row?.agentMode),
    dangerousChats: num(row?.dangerous),
  };
}

/** Shape of the chat collection: kinds, cast sizes, modes and pending work. */
export async function collectChatBreakdown(userId: string): Promise<ChatBreakdownInfo> {
  const [byType, histogram, flags, chatDocumentRows, multiDoc] = await Promise.all([
    mainRows<{ chatType: string; count: number }>(
      `SELECT COALESCE("chatType", 'salon') AS chatType, COUNT(*) AS count
       FROM "chats" WHERE "userId" = ?
       GROUP BY chatType ORDER BY count DESC`,
      [userId],
      'ledgers.chatsByType',
    ),
    mainRows<{ participants: number; chats: number }>(
      `SELECT json_array_length("participants") AS participants, COUNT(*) AS chats
       FROM "chats"
       WHERE "userId" = ? AND "participants" IS NOT NULL AND json_valid("participants")
       GROUP BY participants ORDER BY participants`,
      [userId],
      'ledgers.participantHistogram',
    ),
    mainRow<{
      paused: number;
      documentMode: number;
      equipped: number;
      pendingOutfits: number;
      narrative: number;
      withState: number;
    }>(
      `SELECT SUM(CASE WHEN "isPaused" = 1 THEN 1 ELSE 0 END)                        AS paused,
              SUM(CASE WHEN "documentEditingMode" = 1 THEN 1 ELSE 0 END)             AS documentMode,
              SUM(CASE WHEN "equippedOutfit" IS NOT NULL
                        AND "equippedOutfit" NOT IN ('', '{}') THEN 1 ELSE 0 END)    AS equipped,
              SUM(CASE WHEN "pendingOutfitNotifications" IS NOT NULL
                        AND "pendingOutfitNotifications" NOT IN ('', '{}', '[]') THEN 1 ELSE 0 END)
                                                                                     AS pendingOutfits,
              SUM(CASE WHEN "timelineMode" = 'narrative' THEN 1 ELSE 0 END)          AS narrative,
              SUM(CASE WHEN "state" IS NOT NULL
                        AND "state" NOT IN ('', '{}') THEN 1 ELSE 0 END)             AS withState
       FROM "chats" WHERE "userId" = ?`,
      [userId],
      'ledgers.chatFlags',
    ),
    countRows('chat_documents'),
    mainRow<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT "chatId" FROM "chat_documents" WHERE "isActive" = 1
         GROUP BY "chatId" HAVING COUNT(*) > 1
       )`,
      [],
      'ledgers.multiDocumentChats',
    ),
  ]);

  return {
    byType: byType.map(r => ({ chatType: r.chatType, count: num(r.count) })),
    participantHistogram: histogram.map(r => ({
      participants: num(r.participants),
      chats: num(r.chats),
    })),
    pausedChats: num(flags?.paused),
    documentModeChats: num(flags?.documentMode),
    chatDocumentRows,
    multiDocumentChats: num(multiDoc?.n),
    chatsWithEquippedOutfit: num(flags?.equipped),
    pendingOutfitNotificationChats: num(flags?.pendingOutfits),
    narrativeTimelineChats: num(flags?.narrative),
    chatsWithNonEmptyState: num(flags?.withState),
  };
}

/** The private character rooms: lifecycle, schedule, budgets and visibility. */
export async function collectAutonomousRooms(userId: string): Promise<AutonomousRoomInfo> {
  const nowIso = new Date().toISOString();

  const [total, byRunState, byVisibility, counts] = await Promise.all([
    countRows('chats', `WHERE "userId" = ? AND "chatType" = 'autonomous'`, [userId]),
    mainRows<{ runState: string; count: number }>(
      `SELECT COALESCE("runState", 'idle') AS runState, COUNT(*) AS count
       FROM "chats" WHERE "userId" = ? AND "chatType" = 'autonomous'
       GROUP BY runState ORDER BY count DESC`,
      [userId],
      'ledgers.autonomousRunState',
    ),
    mainRows<{ visibility: string; count: number }>(
      `SELECT COALESCE("runVisibility", 'inherit') AS visibility, COUNT(*) AS count
       FROM "chats" WHERE "userId" = ? AND "chatType" = 'autonomous'
       GROUP BY visibility ORDER BY count DESC`,
      [userId],
      'ledgers.autonomousVisibility',
    ),
    mainRow<{
      scheduled: number;
      overdue: number;
      turns: number;
      tokens: number;
      wallClock: number;
      spend: number;
      destructive: number;
    }>(
      `SELECT SUM(CASE WHEN "scheduleCron" IS NOT NULL THEN 1 ELSE 0 END)               AS scheduled,
              SUM(CASE WHEN "scheduleNextRunAt" IS NOT NULL
                        AND "scheduleNextRunAt" < ? THEN 1 ELSE 0 END)                  AS overdue,
              SUM(CASE WHEN "budgetMaxTurns" IS NOT NULL THEN 1 ELSE 0 END)             AS turns,
              SUM(CASE WHEN "budgetMaxTokens" IS NOT NULL THEN 1 ELSE 0 END)            AS tokens,
              SUM(CASE WHEN "budgetMaxWallClockMs" IS NOT NULL THEN 1 ELSE 0 END)       AS wallClock,
              SUM(CASE WHEN "budgetEstimatedSpendCapUSD" IS NOT NULL THEN 1 ELSE 0 END) AS spend,
              SUM(CASE WHEN "runDestructiveToolsAllowed" = 1 THEN 1 ELSE 0 END)         AS destructive
       FROM "chats" WHERE "userId" = ? AND "chatType" = 'autonomous'`,
      [nowIso, userId],
      'ledgers.autonomousBudgets',
    ),
  ]);

  return {
    total,
    byRunState: byRunState.map(r => ({ runState: r.runState, count: num(r.count) })),
    scheduled: num(counts?.scheduled),
    overdue: num(counts?.overdue),
    withTurnBudget: num(counts?.turns),
    withTokenBudget: num(counts?.tokens),
    withWallClockBudget: num(counts?.wallClock),
    withSpendCap: num(counts?.spend),
    destructiveToolsAllowed: num(counts?.destructive),
    byVisibility: byVisibility.map(r => ({ visibility: r.visibility, count: num(r.count) })),
  };
}

/**
 * The Commonplace Book, in the episodic-recall era.
 *
 * Also returns the per-character memory counts, which Phase 5's top-ten table
 * needs — one GROUP BY instead of one query per character.
 */
export async function collectMemoryBreakdown(): Promise<{
  breakdown: MemoryBreakdownInfo;
  byCharacter: Map<string, number>;
}> {
  const [totals, byKind, bySource, byWitnessed, perCharacter] = await Promise.all([
    mainRow<{
      total: number;
      occurredAt: number;
      narrativeTime: number;
      entities: number;
      embedded: number;
      reinforced: number;
      maxReinforcement: number;
    }>(
      `SELECT COUNT(*)                                                            AS total,
              SUM(CASE WHEN "occurredAt" IS NOT NULL THEN 1 ELSE 0 END)           AS occurredAt,
              SUM(CASE WHEN "narrativeTime" IS NOT NULL
                        AND "narrativeTime" != '' THEN 1 ELSE 0 END)              AS narrativeTime,
              SUM(CASE WHEN "entities" IS NOT NULL
                        AND "entities" NOT IN ('', '[]') THEN 1 ELSE 0 END)       AS entities,
              SUM(CASE WHEN "embedding" IS NOT NULL THEN 1 ELSE 0 END)            AS embedded,
              COALESCE(SUM("reinforcementCount"), 0)                              AS reinforced,
              COALESCE(MAX("reinforcementCount"), 0)                              AS maxReinforcement
       FROM "memories"`,
      [],
      'ledgers.memoryTotals',
    ),
    mainRows<{ kind: string; count: number }>(
      `SELECT COALESCE("kind", 'semantic') AS kind, COUNT(*) AS count
       FROM "memories" GROUP BY kind ORDER BY count DESC`,
      [],
      'ledgers.memoriesByKind',
    ),
    mainRows<{ source: string; count: number }>(
      `SELECT COALESCE("source", 'MANUAL') AS source, COUNT(*) AS count
       FROM "memories" GROUP BY source ORDER BY count DESC`,
      [],
      'ledgers.memoriesBySource',
    ),
    mainRows<{ witnessedContext: string; count: number }>(
      `SELECT COALESCE("witnessedContext", 'unrecorded') AS witnessedContext, COUNT(*) AS count
       FROM "memories" GROUP BY witnessedContext ORDER BY count DESC`,
      [],
      'ledgers.memoriesByWitnessedContext',
    ),
    mainRows<{ characterId: string; count: number }>(
      `SELECT "characterId" AS characterId, COUNT(*) AS count
       FROM "memories" GROUP BY "characterId"`,
      [],
      'ledgers.memoriesByCharacter',
    ),
  ]);

  const byCharacter = new Map<string, number>();
  for (const row of perCharacter) {
    byCharacter.set(row.characterId, num(row.count));
  }

  return {
    breakdown: {
      total: num(totals?.total),
      byKind: byKind.map(r => ({ kind: r.kind, count: num(r.count) })),
      bySource: bySource.map(r => ({ source: r.source, count: num(r.count) })),
      byWitnessedContext: byWitnessed.map(r => ({
        witnessedContext: r.witnessedContext,
        count: num(r.count),
      })),
      withOccurredAt: num(totals?.occurredAt),
      withNarrativeTime: num(totals?.narrativeTime),
      withEntities: num(totals?.entities),
      withEmbedding: num(totals?.embedded),
      reinforcedTotal: num(totals?.reinforced),
      maxReinforcementCount: num(totals?.maxReinforcement),
      charactersWithMemories: byCharacter.size,
    },
    byCharacter,
  };
}

/** Who is in the cast, and what they are allowed to do. */
export async function collectCharacterBreakdown(userId: string): Promise<CharacterBreakdownInfo> {
  const row = await mainRow<{
    total: number;
    vaultLinked: number;
    npcs: number;
    userControlled: number;
    carina: number;
    transparent: number;
    dress: number;
    outfits: number;
    coreWhisper: number;
  }>(
    `SELECT COUNT(*)                                                                     AS total,
            SUM(CASE WHEN "characterDocumentMountPointId" IS NOT NULL THEN 1 ELSE 0 END) AS vaultLinked,
            SUM(CASE WHEN "npc" = 1 THEN 1 ELSE 0 END)                                   AS npcs,
            SUM(CASE WHEN "controlledBy" = 'user' THEN 1 ELSE 0 END)                     AS userControlled,
            SUM(CASE WHEN "canBeCarina" = 1 THEN 1 ELSE 0 END)                           AS carina,
            SUM(CASE WHEN "systemTransparency" = 1 THEN 1 ELSE 0 END)                    AS transparent,
            SUM(CASE WHEN "canDressThemselves" = 1 THEN 1 ELSE 0 END)                    AS dress,
            SUM(CASE WHEN "canCreateOutfits" = 1 THEN 1 ELSE 0 END)                      AS outfits,
            SUM(CASE WHEN "coreWhisperEnabled" IS NOT NULL THEN 1 ELSE 0 END)            AS coreWhisper
     FROM "characters" WHERE "userId" = ?`,
    [userId],
    'ledgers.characterBreakdown',
  );

  const total = num(row?.total);
  const vaultLinked = num(row?.vaultLinked);

  return {
    total,
    vaultLinked,
    vaultless: Math.max(0, total - vaultLinked),
    npcs: num(row?.npcs),
    userControlled: num(row?.userControlled),
    carinaAnswerers: num(row?.carina),
    systemTransparent: num(row?.transparent),
    canDressThemselves: num(row?.dress),
    canCreateOutfits: num(row?.outfits),
    coreWhisperOverrides: num(row?.coreWhisper),
  };
}

/**
 * The feature dials as they read with no settings row at all.
 *
 * Written out in full rather than left as a `null` fallback: if the collector
 * fails, the report should say "everything at its default" — which is what an
 * unconfigured instance genuinely looks like — instead of dropping the section.
 * Values mirror the column defaults in `chat_settings`.
 */
export function defaultFeatureConfig(): FeatureConfigInfo {
  return {
    dangerousContent: {
      mode: 'OFF',
      threshold: 0.7,
      scanTextChat: true,
      scanImagePrompts: true,
      scanImageGeneration: false,
    },
    contextCompression: { enabled: true, windowSize: 5, compressionTargetTokens: 800 },
    agentMode: { maxTurns: 10, defaultEnabled: false },
    storyBackgrounds: { enabled: false, hasDefaultImageProfile: false },
    timestamps: { mode: 'NONE', format: 'FRIENDLY' },
    autoLock: { enabled: false, idleMinutes: 15 },
    memoryCascade: {
      onMessageDelete: 'ASK_EVERY_TIME',
      onSwipeRegenerate: 'DELETE_MEMORIES',
    },
    autoDetectRng: true,
    customTools: true,
    avatarDisplay: { mode: 'ALWAYS', style: 'CIRCULAR' },
    coreWhisper: {
      enabled: true,
      interval: 12,
      silenceThreshold: 3,
      packetTokenBudget: 4096,
      fireOnContextTransition: true,
    },
    thinkingDisplay: { defaultVisible: true, defaultCollapsed: true },
    answerConfirmation: { enabled: false },
    autonomousRoomDefaults: {},
    autoHousekeeping: {
      enabled: false,
      perCharacterCap: 2000,
      mergeSimilar: false,
      autoMergeSimilarThreshold: 0.9,
    },
    textReplacements: { enabled: true, rules: 0, enabledRules: 0 },
    composerSpellcheck: true,
    autoScrollOnResponseComplete: false,
    imageDescriptionProfileConfigured: false,
    uncensoredImageDescriptionProfileConfigured: false,
  };
}

/** Every feature dial on `chat_settings`, with its effective value. */
export async function collectFeatureConfig(userId: string): Promise<FeatureConfigInfo> {
  const chatSettings = await getRepositories().chatSettings.findByUserId(userId);

  const dc = chatSettings?.dangerousContentSettings;
  const cc = chatSettings?.contextCompressionSettings;
  const am = chatSettings?.agentModeSettings;
  const sb = chatSettings?.storyBackgroundsSettings;
  const ts = chatSettings?.defaultTimestampConfig;
  const al = chatSettings?.autoLockSettings;
  const mc = chatSettings?.memoryCascadePreferences;
  const cw = chatSettings?.coreWhisper;
  const td = chatSettings?.thinkingDisplay;
  const ac = chatSettings?.answerConfirmationSettings;
  const ah = chatSettings?.autoHousekeepingSettings;

  const [ruleRow] = await Promise.all([
    mainRow<{ total: number; enabled: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN "enabled" = 1 THEN 1 ELSE 0 END) AS enabled
       FROM "text_replacement_rules"`,
      [],
      'ledgers.textReplacementRules',
    ),
  ]);

  return {
    dangerousContent: {
      mode: dc?.mode ?? 'OFF',
      threshold: dc?.threshold ?? 0.7,
      scanTextChat: dc?.scanTextChat ?? true,
      scanImagePrompts: dc?.scanImagePrompts ?? true,
      scanImageGeneration: dc?.scanImageGeneration ?? false,
    },
    contextCompression: {
      enabled: cc?.enabled ?? true,
      windowSize: cc?.windowSize ?? 5,
      compressionTargetTokens: cc?.compressionTargetTokens ?? 800,
    },
    agentMode: {
      maxTurns: am?.maxTurns ?? 10,
      defaultEnabled: am?.defaultEnabled ?? false,
    },
    storyBackgrounds: {
      enabled: sb?.enabled ?? false,
      hasDefaultImageProfile: !!sb?.defaultImageProfileId,
    },
    timestamps: {
      mode: ts?.mode ?? 'NONE',
      format: ts?.format ?? 'FRIENDLY',
    },
    autoLock: {
      enabled: al?.enabled ?? false,
      idleMinutes: al?.idleMinutes ?? 15,
    },
    memoryCascade: {
      onMessageDelete: mc?.onMessageDelete ?? 'ASK_EVERY_TIME',
      onSwipeRegenerate: mc?.onSwipeRegenerate ?? 'DELETE_MEMORIES',
    },
    autoDetectRng: chatSettings?.autoDetectRng ?? true,
    customTools: chatSettings?.customTools ?? true,
    avatarDisplay: {
      mode: chatSettings?.avatarDisplayMode ?? 'ALWAYS',
      style: chatSettings?.avatarDisplayStyle ?? 'CIRCULAR',
    },
    coreWhisper: {
      enabled: cw?.enabled ?? true,
      interval: cw?.interval ?? 12,
      silenceThreshold: cw?.silenceThreshold ?? 3,
      packetTokenBudget: cw?.packetTokenBudget ?? 4096,
      fireOnContextTransition: cw?.fireOnContextTransition ?? true,
    },
    thinkingDisplay: {
      defaultVisible: td?.defaultVisible ?? true,
      defaultCollapsed: td?.defaultCollapsed ?? true,
    },
    answerConfirmation: { enabled: ac?.enabled ?? false },
    autonomousRoomDefaults: (chatSettings?.autonomousRoomSettings ?? {}) as Record<string, unknown>,
    autoHousekeeping: {
      enabled: ah?.enabled ?? false,
      perCharacterCap: ah?.perCharacterCap ?? 2000,
      mergeSimilar: ah?.mergeSimilar ?? false,
      autoMergeSimilarThreshold: ah?.autoMergeSimilarThreshold ?? 0.9,
    },
    textReplacements: {
      enabled: chatSettings?.textReplacementsEnabled ?? true,
      rules: num(ruleRow?.total),
      enabledRules: num(ruleRow?.enabled),
    },
    composerSpellcheck: chatSettings?.composerSpellcheck ?? true,
    autoScrollOnResponseComplete: chatSettings?.autoScrollOnResponseComplete ?? false,
    imageDescriptionProfileConfigured: !!chatSettings?.imageDescriptionProfileId,
    uncensoredImageDescriptionProfileConfigured:
      !!chatSettings?.uncensoredImageDescriptionProfileId,
  };
}

/**
 * Instance-wide knobs, plus the derived "how many chats does the next sweep
 * actually touch" figure.
 *
 * The eligibility count goes through the same `resolveStaleChatDays` +
 * `isStale` pair the maintenance sweep uses, so the number the report prints
 * and the number the sweep acts on can never disagree.
 */
export async function collectInstanceSettings(userId: string): Promise<InstanceSettingsInfo> {
  const [retention, staleChatDays, maxConcurrentJobs, recall, extraction, lastSweep] =
    await Promise.all([
      getDataRetentionSettings(),
      resolveStaleChatDays(),
      getMaxConcurrentJobs(),
      getMemoryRecallSettings(),
      getMemoryExtractionLimits(),
      getLastMaintenanceSweepAt(),
    ]);
  void retention; // resolveStaleChatDays already folds it in

  let eligible = 0;
  try {
    const cutoffMs = retentionCutoff(staleChatDays).getTime();
    const repos = getRepositories();
    const candidates = await mainRows<{ id: string; updatedAt: string }>(
      `SELECT "id", "updatedAt" FROM "chats"
       WHERE "userId" = ? AND "updatedAt" < ?`,
      [userId, new Date(cutoffMs).toISOString()],
      'ledgers.staleChatCandidates',
    );
    for (const candidate of candidates) {
      if (await isStale(candidate, cutoffMs, repos)) eligible++;
    }
  } catch (error) {
    moduleLogger.debug('Failed to compute stale-chat eligibility', {
      error: getErrorMessage(error),
    });
  }

  return {
    staleChatDays,
    chatsEligibleForNextSweep: eligible,
    maxConcurrentJobs,
    memoryRecall: {
      scopePolicy: recall.scopePolicy,
      expandRelated: recall.expandRelated,
    },
    memoryExtractionLimits: {
      enabled: extraction.enabled,
      maxPerHour: extraction.maxPerHour,
      softStartFraction: extraction.softStartFraction,
      softFloor: extraction.softFloor,
    },
    lastMaintenanceSweepAt: lastSweep ? lastSweep.toISOString() : null,
  };
}

/** The job queue: what is waiting, what is stuck and what gave up. */
export async function collectBackgroundJobs(userId: string): Promise<BackgroundJobInfo> {
  const [byStatus, byType, failed, exhausted, oldestPending] = await Promise.all([
    mainRows<{ status: string; count: number }>(
      `SELECT COALESCE("status", 'PENDING') AS status, COUNT(*) AS count
       FROM "background_jobs" WHERE "userId" = ?
       GROUP BY status ORDER BY count DESC`,
      [userId],
      'ledgers.jobsByStatus',
    ),
    mainRows<{ type: string; count: number }>(
      `SELECT "type" AS type, COUNT(*) AS count
       FROM "background_jobs" WHERE "userId" = ?
       GROUP BY type ORDER BY count DESC`,
      [userId],
      'ledgers.jobsByType',
    ),
    mainRows<{ type: string; count: number; lastError: string | null }>(
      `SELECT "type" AS type, COUNT(*) AS count, MAX("lastError") AS lastError
       FROM "background_jobs"
       WHERE "userId" = ? AND "status" = 'FAILED'
       GROUP BY type ORDER BY count DESC`,
      [userId],
      'ledgers.failedJobs',
    ),
    mainRow<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "background_jobs"
       WHERE "userId" = ? AND "attempts" >= "maxAttempts"`,
      [userId],
      'ledgers.exhaustedJobs',
    ),
    mainRow<{ scheduledAt: string | null }>(
      `SELECT MIN("scheduledAt") AS scheduledAt FROM "background_jobs"
       WHERE "userId" = ? AND "status" = 'PENDING'`,
      [userId],
      'ledgers.oldestPendingJob',
    ),
  ]);

  return {
    byStatus: byStatus.map(r => ({ status: r.status, count: num(r.count) })),
    byType: byType.map(r => ({ type: r.type, count: num(r.count) })),
    failed: failed.map(r => ({
      type: r.type,
      count: num(r.count),
      // Truncated: an error string can be a whole stack trace, and the report
      // is meant to be shareable.
      lastError: r.lastError ? r.lastError.slice(0, 200) : null,
    })),
    attemptsExhausted: num(exhausted?.n),
    oldestPendingScheduledAt: oldestPending?.scheduledAt ?? null,
  };
}

/**
 * The embedding pipeline: what is indexed, what failed, and whether the
 * vectors on disk match the profile that would be used to query them.
 *
 * Stored width is read from the self-describing BLOB header (0xEB = int8
 * quantized, everything else is a legacy float32 buffer), not by decoding
 * every vector.
 */
export async function collectEmbeddingPipeline(userId: string): Promise<EmbeddingPipelineInfo> {
  const [statusRows, chunkRow, helpRow, memoryDims, chunkDims, activeProfile] = await Promise.all([
    mainRows<{ entityType: string; status: string; count: number }>(
      `SELECT "entityType" AS entityType, COALESCE("status", 'PENDING') AS status, COUNT(*) AS count
       FROM "embedding_status" WHERE "userId" = ?
       GROUP BY entityType, status ORDER BY entityType, count DESC`,
      [userId],
      'ledgers.embeddingStatus',
    ),
    mainRow<{ total: number; unembedded: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN "embedding" IS NULL THEN 1 ELSE 0 END) AS unembedded
       FROM "conversation_chunks"`,
      [],
      'ledgers.conversationChunks',
    ),
    mainRow<{ total: number; unembedded: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN "embedding" IS NULL THEN 1 ELSE 0 END) AS unembedded
       FROM "help_docs"`,
      [],
      'ledgers.helpDocs',
    ),
    embeddingWidths('memories'),
    embeddingWidths('conversation_chunks'),
    getRepositories().embeddingProfiles.findDefault(userId),
  ]);

  const activeDims = activeProfile?.truncateToDimensions ?? activeProfile?.dimensions ?? null;
  const storedDimensions = [...memoryDims, ...chunkDims];
  const dimensionMismatch =
    activeDims !== null && storedDimensions.some(d => d.dimensions !== activeDims);

  const permanentlyFailed = statusRows
    .filter(r => r.status === 'PERMANENTLY_FAILED')
    .reduce((sum, r) => sum + num(r.count), 0);

  return {
    statusByEntityType: statusRows.map(r => ({
      entityType: r.entityType,
      status: r.status,
      count: num(r.count),
    })),
    permanentlyFailed,
    conversationChunks: { total: num(chunkRow?.total), unembedded: num(chunkRow?.unembedded) },
    helpDocs: { total: num(helpRow?.total), unembedded: num(helpRow?.unembedded) },
    storedDimensions,
    activeProfileDimensions: activeDims,
    dimensionMismatch,
  };
}

/**
 * Distinct stored vector widths in a table, derived from the BLOB header.
 *
 * Quantized blobs (4.8+) begin with magic `0xEB`; the dtype byte then decides
 * the layout — int8 is an 11-byte header plus one byte per dimension, float16
 * a 7-byte header plus two. Anything without the magic is a legacy raw float32
 * buffer, four bytes per dimension. Branching on the prefix is mandatory: read
 * every blob as float32 and each width comes out a quarter of its real value.
 * Layout constants mirror `lib/embedding/float32-conversion.ts`.
 */
async function embeddingWidths(
  table: string,
): Promise<Array<{ table: string; dimensions: number; vectors: number }>> {
  const rows = await mainRows<{ dimensions: number; vectors: number }>(
    `SELECT CASE
              WHEN hex(substr("embedding", 1, 1)) != 'EB'
                THEN length("embedding") / 4
              WHEN hex(substr("embedding", 3, 1)) = '02'
                THEN (length("embedding") - 7) / 2
              ELSE length("embedding") - 11
            END AS dimensions,
            COUNT(*) AS vectors
     FROM "${table}"
     WHERE "embedding" IS NOT NULL
     GROUP BY dimensions
     ORDER BY vectors DESC`,
    [],
    `ledgers.embeddingWidths:${table}`,
  );
  return rows.map(r => ({ table, dimensions: num(r.dimensions), vectors: num(r.vectors) }));
}

/** Ariel's terminal sessions. */
export async function collectTerminal(): Promise<TerminalInfo> {
  const [row, shells] = await Promise.all([
    mainRow<{ total: number; live: number; nonZero: number }>(
      `SELECT COUNT(*)                                                            AS total,
              SUM(CASE WHEN "exitedAt" IS NULL THEN 1 ELSE 0 END)                 AS live,
              SUM(CASE WHEN "exitCode" IS NOT NULL AND "exitCode" != 0 THEN 1 ELSE 0 END) AS nonZero
       FROM "terminal_sessions"`,
      [],
      'ledgers.terminalSessions',
    ),
    mainRows<{ shell: string }>(
      `SELECT DISTINCT "shell" AS shell FROM "terminal_sessions" ORDER BY shell`,
      [],
      'ledgers.terminalShells',
    ),
  ]);

  return {
    totalSessions: num(row?.total),
    liveSessions: num(row?.live),
    nonZeroExits: num(row?.nonZero),
    distinctShells: shells.map(s => s.shell).filter(Boolean),
  };
}

/**
 * The legacy `files` ledger.
 *
 * Deliberately labelled legacy in the rendered report: since the 4.4–4.9
 * cutovers the real bytes live in the mount index (Phase 4), and this table is
 * mostly the residue of the old file storage plus generated-image bookkeeping.
 */
export async function collectStorageStats(userId: string): Promise<StorageStats> {
  const [folderRows, totals, generated] = await Promise.all([
    mainRows<{ folderPath: string | null; fileCount: number; totalSize: number }>(
      `SELECT COALESCE("folderPath", '/') AS folderPath,
              COUNT(*)                    AS fileCount,
              COALESCE(SUM("size"), 0)    AS totalSize
       FROM "files" WHERE "userId" = ?
       GROUP BY folderPath ORDER BY totalSize DESC`,
      [userId],
      'ledgers.storageFolders',
    ),
    mainRow<{ totalFiles: number; totalSize: number; notOk: number }>(
      `SELECT COUNT(*)                                                          AS totalFiles,
              COALESCE(SUM("size"), 0)                                          AS totalSize,
              SUM(CASE WHEN COALESCE("fileStatus", 'ok') != 'ok' THEN 1 ELSE 0 END) AS notOk
       FROM "files" WHERE "userId" = ?`,
      [userId],
      'ledgers.storageTotals',
    ),
    mainRows<{ generationModel: string; count: number; bytes: number }>(
      `SELECT "generationModel" AS generationModel, COUNT(*) AS count, COALESCE(SUM("size"), 0) AS bytes
       FROM "files"
       WHERE "userId" = ? AND "generationModel" IS NOT NULL AND "generationModel" != ''
       GROUP BY generationModel ORDER BY count DESC`,
      [userId],
      'ledgers.generatedImages',
    ),
  ]);

  const folders: FolderStats[] = folderRows.map(r => ({
    path: r.folderPath ?? '/',
    fileCount: num(r.fileCount),
    totalSize: num(r.totalSize),
  }));

  return {
    totalFiles: num(totals?.totalFiles),
    totalSize: num(totals?.totalSize),
    folders,
    notOkFiles: num(totals?.notOk),
    generatedImagesByModel: generated.map(r => ({
      generationModel: r.generationModel,
      count: num(r.count),
      bytes: num(r.bytes),
    })),
  };
}
