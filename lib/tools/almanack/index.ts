/**
 * The Almanack — the report pipeline.
 *
 * An annual compendium of the establishment: what is installed, what is
 * configured, and what has accumulated. Formerly "the capabilities report";
 * renamed in 4.9 when its coverage was brought up to date with the document-
 * store cutovers it had never learned about.
 *
 * The pipeline walks the seven phases of {@link ALMANACK_PHASES} in order.
 * Within a phase the collectors run in parallel; the phases themselves run
 * sequentially so the progress bar can name the one that is actually running.
 * That costs a little wall-clock against a flat `Promise.all` — the price of a
 * truthful phase bar, and cheap for a diagnostic run.
 *
 * Every collector is wrapped in {@link collect}, which swallows and logs
 * failures. A report that refuses to render because one section's query threw
 * is worse than a report with one hollow section — usually the section that
 * matters is the one next to the broken one.
 *
 * @module lib/tools/almanack
 */

import { logger } from '@/lib/logger';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import { getErrorMessage } from '@/lib/error-utils';
import {
  createOperationProgressEmitter,
  type OperationProgressEmitter,
} from '@/lib/progress/operation-progress';
import packageJson from '@/package.json';

import { collect } from './db';
import { ALMANACK_PHASES, ALMANACK_PHASE_COUNT, type AlmanackPhaseKey } from './phases';
import {
  collectBackupStatus,
  collectDatabaseSecurity,
  collectMigrationState,
  collectRuntimeEnvironment,
} from './phase1-premises';
import {
  collectApiKeyTypes,
  collectApiKeyUsage,
  collectCheapLLMInfo,
  collectEmbeddingInfo,
  collectEmbeddingProviders,
  collectImagePromptLLMInfo,
  collectImageProviders,
  collectMCPServers,
  collectModels,
  collectPluginInfo,
  collectProviderInfo,
  collectProviderModelCache,
  collectThemeInfo,
} from './phase2-machinery';
import {
  collectAutonomousRooms,
  collectBackgroundJobs,
  collectCharacterBreakdown,
  collectChatBreakdown,
  collectChatStats,
  collectDatabaseStats,
  collectEmbeddingPipeline,
  collectFeatureConfig,
  defaultFeatureConfig,
  collectInstanceSettings,
  collectMemoryBreakdown,
  collectStorageStats,
  collectTerminal,
} from './phase3-ledgers';
import { collectScriptorium, emptyScriptorium } from './phase4-scriptorium';
import { collectPersonae } from './phase5-personae';
import { collectWireRecords } from './phase6-wire-records';
import { renderAlmanackMarkdown } from './render';
import type { AlmanackReportData } from './types';

export { renderAlmanackMarkdown } from './render';
export { ALMANACK_PHASES, ALMANACK_NAME, ALMANACK_TITLE } from './phases';
export type { AlmanackReportData } from './types';

const moduleLogger = logger.child({ module: 'almanack' });

/** Announce entry into a phase on the progress channel (1-based index). */
function announce(progress: OperationProgressEmitter, key: AlmanackPhaseKey): void {
  const index = ALMANACK_PHASES.findIndex(p => p.key === key);
  if (index < 0) return;
  progress.phase(key, index + 1, ALMANACK_PHASE_COUNT, ALMANACK_PHASES[index].label);
}

/**
 * Gather the whole report.
 *
 * `progressId` is optional; without one the emitter is entirely inert and the
 * pipeline behaves exactly as it would have before progress existed.
 */
export async function generateAlmanackData(
  userId: string,
  progressId?: string | null,
): Promise<AlmanackReportData> {
  const startedAt = Date.now();
  moduleLogger.info('Starting Almanack generation', { userId, tracked: !!progressId });

  const progress = createOperationProgressEmitter(progressId);

  // --- Phase 1: Taking the measure of the premises ------------------------
  announce(progress, 'premises');
  // `collectRuntimeEnvironment` is synchronous and reads only `os`/`process`,
  // so it needs no fallback shape of its own.
  const runtimeEnvironment = collectRuntimeEnvironment();
  const [databaseSecurity, backupStatus, migrationState] = await Promise.all([
    collect(
      'databaseSecurity',
      { passphraseProtected: false, databases: [], highestAppVersion: null },
      () => collectDatabaseSecurity(),
    ),
    collect('backupStatus', [], () => collectBackupStatus()),
    collect(
      'migrationState',
      {
        appliedCount: 0,
        lastMigrationId: null,
        lastMigrationAt: null,
        lastMigrationVersion: null,
      },
      () => collectMigrationState(),
    ),
  ]);

  // --- Phase 2: Cataloguing the machinery ---------------------------------
  // Model fetching is the slowest collector here when the discovery cache is
  // cold, so the phase deliberately keeps everything parallel inside itself.
  announce(progress, 'machinery');
  const [
    plugins,
    providers,
    modelsByProvider,
    providerModelCache,
    apiKeyUsage,
    cheapLLM,
    imagePromptLLM,
    embeddingProvider,
    imageProviders,
    embeddingProviders,
    mcpServers,
    themeInfo,
  ] = await Promise.all([
    collect(
      'plugins',
      {
        enabled: [],
        disabled: [],
        byCapability: [],
        npmInstalled: 0,
        bundled: 0,
        pluginConfigRows: 0,
        characterPluginDataRows: 0,
      },
      () => collectPluginInfo(userId),
    ),
    collect('providers', [], () => collectProviderInfo(userId)),
    collect('models', [], () => collectModels(userId)),
    collect('providerModelCache', [], () => collectProviderModelCache()),
    collect('apiKeyUsage', [], () => collectApiKeyUsage(userId)),
    collect('cheapLLM', {}, () => collectCheapLLMInfo(userId)),
    collect('imagePromptLLM', {}, () => collectImagePromptLLMInfo(userId)),
    collect('embeddingProvider', {}, () => collectEmbeddingInfo(userId)),
    collect('imageProviders', [], () => collectImageProviders()),
    collect('embeddingProviders', [], () => collectEmbeddingProviders()),
    collect(
      'mcpServers',
      {
        configured: 0,
        enabled: 0,
        serverNames: [],
        autoReconnect: true,
        maxReconnectAttempts: 5,
      },
      () => collectMCPServers(userId),
    ),
    collect(
      'themeInfo',
      {
        activeThemeId: null,
        colorMode: 'system',
        stats: { total: 0, withDarkMode: 0, withCssOverrides: 0, errors: 0 },
        themes: [],
        themesWithIcons: 0,
        totalIconOverrides: 0,
        totalUnknownIconOverrides: 0,
      },
      () => collectThemeInfo(userId),
    ),
  ]);

  // --- Phase 3: Auditing the ledgers --------------------------------------
  announce(progress, 'ledgers');
  const [
    databaseStats,
    chatStats,
    chatBreakdown,
    autonomousRooms,
    memoryResult,
    characterBreakdown,
    featureConfig,
    instanceSettings,
    backgroundJobs,
    embeddingPipeline,
    terminal,
    storageStats,
  ] = await Promise.all([
    collect(
      'databaseStats',
      {
        characters: 0,
        favoriteCharacters: 0,
        chats: 0,
        memories: 0,
        tags: 0,
        projects: 0,
        groups: 0,
        connectionProfiles: {
          total: 0,
          webSearchEnabled: 0,
          toolUseEnabled: 0,
          dangerousCompatible: 0,
        },
        imageProfiles: 0,
        embeddingProfiles: 0,
        promptTemplates: { total: 0, builtIn: 0, custom: 0 },
        roleplayTemplates: { total: 0, builtIn: 0, custom: 0 },
      },
      () => collectDatabaseStats(userId),
    ),
    collect(
      'chatStats',
      {
        totalEstimatedCostUSD: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalMessages: 0,
        agentModeChats: 0,
        dangerousChats: 0,
      },
      () => collectChatStats(userId),
    ),
    collect(
      'chatBreakdown',
      {
        byType: [],
        participantHistogram: [],
        pausedChats: 0,
        documentModeChats: 0,
        chatDocumentRows: 0,
        multiDocumentChats: 0,
        chatsWithEquippedOutfit: 0,
        pendingOutfitNotificationChats: 0,
        narrativeTimelineChats: 0,
        chatsWithNonEmptyState: 0,
      },
      () => collectChatBreakdown(userId),
    ),
    collect(
      'autonomousRooms',
      {
        total: 0,
        byRunState: [],
        scheduled: 0,
        overdue: 0,
        withTurnBudget: 0,
        withTokenBudget: 0,
        withWallClockBudget: 0,
        withSpendCap: 0,
        destructiveToolsAllowed: 0,
        byVisibility: [],
      },
      () => collectAutonomousRooms(userId),
    ),
    collect(
      'memoryBreakdown',
      {
        breakdown: {
          total: 0,
          byKind: [],
          bySource: [],
          byWitnessedContext: [],
          withOccurredAt: 0,
          withNarrativeTime: 0,
          withEntities: 0,
          withEmbedding: 0,
          reinforcedTotal: 0,
          maxReinforcementCount: 0,
          charactersWithMemories: 0,
        },
        byCharacter: new Map<string, number>(),
      },
      () => collectMemoryBreakdown(),
    ),
    collect(
      'characterBreakdown',
      {
        total: 0,
        vaultLinked: 0,
        vaultless: 0,
        npcs: 0,
        userControlled: 0,
        carinaAnswerers: 0,
        systemTransparent: 0,
        canDressThemselves: 0,
        canCreateOutfits: 0,
        coreWhisperOverrides: 0,
      },
      () => collectCharacterBreakdown(userId),
    ),
    collect('featureConfig', defaultFeatureConfig(), () => collectFeatureConfig(userId)),
    collect(
      'instanceSettings',
      {
        staleChatDays: 30,
        chatsEligibleForNextSweep: 0,
        maxConcurrentJobs: 4,
        memoryRecall: { scopePolicy: 'down-weight', expandRelated: false },
        memoryExtractionLimits: {
          enabled: false,
          maxPerHour: 20,
          softStartFraction: 0.7,
          softFloor: 0.7,
        },
        lastMaintenanceSweepAt: null,
      },
      () => collectInstanceSettings(userId),
    ),
    collect(
      'backgroundJobs',
      {
        byStatus: [],
        byType: [],
        failed: [],
        attemptsExhausted: 0,
        oldestPendingScheduledAt: null,
      },
      () => collectBackgroundJobs(userId),
    ),
    collect(
      'embeddingPipeline',
      {
        statusByEntityType: [],
        permanentlyFailed: 0,
        conversationChunks: { total: 0, unembedded: 0 },
        helpDocs: { total: 0, unembedded: 0 },
        storedDimensions: [],
        activeProfileDimensions: null,
        dimensionMismatch: false,
      },
      () => collectEmbeddingPipeline(userId),
    ),
    collect(
      'terminal',
      { totalSessions: 0, liveSessions: 0, nonZeroExits: 0, distinctShells: [] },
      () => collectTerminal(),
    ),
    collect(
      'storageStats',
      {
        totalFiles: 0,
        totalSize: 0,
        folders: [],
        notOkFiles: 0,
        generatedImagesByModel: [],
      },
      () => collectStorageStats(userId),
    ),
  ]);

  // --- Phase 4: Touring the Scriptorium -----------------------------------
  announce(progress, 'scriptorium');
  const scriptorium = await collect('scriptorium', emptyScriptorium(), () =>
    collectScriptorium(userId, chatBreakdown.chatsWithNonEmptyState),
  );

  // --- Phase 5: Assembling the dramatis personae --------------------------
  announce(progress, 'personae');
  const personae = await collect(
    'personae',
    { topCharacters: [], countsRemovedParticipants: true, projects: [], groups: [] },
    () => collectPersonae(userId, memoryResult.byCharacter),
  );

  // --- Phase 6: Reading the wire records ----------------------------------
  announce(progress, 'wire-records');
  const wireRecords = await collect(
    'wireRecords',
    {
      totalEntries: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      loggingEnabled: true,
      verboseMode: false,
      retentionDays: 30,
      exactProfileAttribution: false,
      byType: [],
      connectionProfileLifetime: [],
      connectionProfileWindow: [],
      imageProfileWindow: [],
      cacheByProvider: [],
      cacheByProfile: [],
    },
    () => collectWireRecords(userId),
  );

  const data: AlmanackReportData = {
    version: packageJson.version,
    nodeEnv: process.env.NODE_ENV || 'development',
    generatedAt: new Date().toISOString(),

    runtimeEnvironment,
    databaseSecurity,
    backupStatus,
    migrationState,

    plugins,
    apiKeyTypes: collectApiKeyTypes(),
    providers,
    modelsByProvider,
    providerModelCache,
    apiKeyUsage,
    cheapLLM,
    imagePromptLLM,
    embeddingProvider,
    imageProviders,
    embeddingProviders,
    mcpServers,
    themeInfo,

    databaseStats,
    chatStats,
    chatBreakdown,
    autonomousRooms,
    memoryBreakdown: memoryResult.breakdown,
    characterBreakdown,
    featureConfig,
    instanceSettings,
    backgroundJobs,
    embeddingPipeline,
    terminal,
    storageStats,

    scriptorium,

    personae,

    wireRecords,
  };

  moduleLogger.info('Almanack generation complete', {
    userId,
    durationMs: Date.now() - startedAt,
  });
  return data;
}

/**
 * Generate, render and file an Almanack.
 *
 * Returns the `files` row id as `reportId`. That is deliberate and load-bearing:
 * list/get/delete all key off the files row, and the pre-4.9 code minted a
 * throwaway UUID here instead, so the dialog opened straight after generating
 * handed a stranger's id to the download link and 404'd.
 */
export async function generateAndSaveAlmanack(
  userId: string,
  options: {
    progressId?: string | null;
    /** Files the rendered markdown and returns the `files` row id. */
    persist: (input: {
      filename: string;
      storageKey: string;
      size: number;
      content: string;
    }) => Promise<string>;
  },
): Promise<{
  reportId: string;
  filename: string;
  storageKey: string;
  size: number;
  content: string;
}> {
  const progress = createOperationProgressEmitter(options.progressId);

  try {
    const data = await generateAlmanackData(userId, options.progressId);

    // --- Phase 7: Binding the volume --------------------------------------
    announce(progress, 'binding');
    const markdown = renderAlmanackMarkdown(data);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `almanack-${timestamp}.md`;

    // Always non-project; routed into the Quilltap Uploads mount under
    // diagnostics/ rather than the catch-all _general/.
    const buffer = Buffer.from(markdown, 'utf-8');
    const uploadResult = await writeUserUploadToMountStore({
      filename,
      content: buffer,
      contentType: 'text/markdown',
      subfolder: 'diagnostics',
    });

    const reportId = await options.persist({
      filename,
      storageKey: uploadResult.storageKey,
      size: buffer.length,
      content: markdown,
    });

    moduleLogger.info('Almanack saved', {
      reportId,
      filename,
      storageKey: uploadResult.storageKey,
      size: buffer.length,
    });

    progress.finish();

    return {
      reportId,
      filename,
      storageKey: uploadResult.storageKey,
      size: buffer.length,
      content: markdown,
    };
  } catch (error) {
    progress.fail(getErrorMessage(error));
    throw error;
  }
}
