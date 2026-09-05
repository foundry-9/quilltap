/**
 * The Almanack — Phase 6, "Reading the wire records".
 *
 * The llm-logs database: what was asked of which model, how long it took, what
 * it cost in tokens, and how much of the prompt the provider served from cache.
 *
 * Two honesty constraints shape this whole phase:
 *
 *  1. **Attribution.** Before 4.9 no row recorded which profile served it, so
 *     older rows can only be grouped by `(provider, modelName)` — which cannot
 *     separate two profiles sharing a pair. The section says "approximate" when
 *     that fallback is in use rather than presenting a guess as a fact.
 *  2. **Denominators.** `durationMs` is null on a great many historical rows,
 *     so every latency figure carries the count it was averaged over.
 *
 * @module lib/tools/almanack/phase6-wire-records
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getErrorMessage } from '@/lib/error-utils';
import { mainRows, num } from './db';
import type { CacheRow, ProfileLifetimeRow, ProfileWindowRow, WireRecordsInfo } from './types';

const moduleLogger = logger.child({ module: 'almanack:wire-records' });

/** How many profiles each windowed table lists. */
const PROFILE_ROW_LIMIT = 20;

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Lifetime counters carried on the `connection_profiles` rows themselves. */
async function collectProfileLifetime(userId: string): Promise<ProfileLifetimeRow[]> {
  const rows = await mainRows<{
    id: string;
    name: string;
    provider: string;
    modelName: string;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    messageCount: number;
    updatedAt: string | null;
  }>(
    `SELECT "id", "name", "provider", "modelName",
            COALESCE("totalTokens", 0)           AS totalTokens,
            COALESCE("totalPromptTokens", 0)     AS totalPromptTokens,
            COALESCE("totalCompletionTokens", 0) AS totalCompletionTokens,
            COALESCE("messageCount", 0)          AS messageCount,
            "updatedAt"
     FROM "connection_profiles"
     WHERE "userId" = ?
     ORDER BY totalTokens DESC`,
    [userId],
    'wire.profileLifetime',
  );

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelName: r.modelName,
    totalTokens: num(r.totalTokens),
    totalPromptTokens: num(r.totalPromptTokens),
    totalCompletionTokens: num(r.totalCompletionTokens),
    messageCount: num(r.messageCount),
    // There is no `lastUsedAt` column; `updatedAt` moves whenever the counters
    // are bumped, so it is the closest available proxy — and labelled as one.
    lastTouchedAt: r.updatedAt ?? null,
  }));
}

/**
 * Wire records with no logs at all, under the default logging settings
 * (enabled, 30-day retention) — what the section reads as when the collector
 * fails.
 */
export function emptyWireRecords(): WireRecordsInfo {
  return {
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
  };
}

/** The whole wire-records phase. */
export async function collectWireRecords(userId: string): Promise<WireRecordsInfo> {
  const repos = getUserRepositories(userId).llmLogs;
  const globalRepos = getRepositories();

  let loggingEnabled = true;
  let verboseMode = false;
  let retentionDays = 30;
  try {
    const chatSettings = await globalRepos.chatSettings.findByUserId(userId);
    loggingEnabled = chatSettings?.llmLoggingSettings?.enabled ?? true;
    verboseMode = chatSettings?.llmLoggingSettings?.verboseMode ?? false;
    retentionDays = chatSettings?.llmLoggingSettings?.retentionDays ?? 30;
  } catch (error) {
    moduleLogger.debug('Failed to read LLM logging settings', { error: getErrorMessage(error) });
  }

  const exactAttribution = repos.hasProfileAttributionColumns();
  const connectionGroupBy = exactAttribution ? 'connectionProfileId' : 'providerModel';
  const imageGroupBy = exactAttribution ? 'imageProfileId' : 'providerModel';

  const [
    totalEntries,
    tokenUsage,
    byType,
    lifetime,
    connectionStats,
    connectionMedians,
    imageStats,
    imageMedians,
    cacheByProviderRows,
    cacheByProfileRows,
    profileNames,
    imageProfileNames,
  ] = await Promise.all([
    repos.countByUserId(),
    repos.getTotalTokenUsage(),
    repos.getStatsByType(),
    collectProfileLifetime(userId),
    repos.getStatsByProfile(connectionGroupBy),
    repos.getMedianDurationByProfile(connectionGroupBy),
    repos.getStatsByProfile(imageGroupBy, { type: 'IMAGE_GENERATION' }),
    repos.getMedianDurationByProfile(imageGroupBy),
    repos.getCacheStats('provider'),
    exactAttribution
      ? repos.getCacheStats('connectionProfileId')
      : Promise.resolve([]),
    mainRows<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "connection_profiles" WHERE "userId" = ?`,
      [userId],
      'wire.connectionProfileNames',
    ),
    mainRows<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "image_profiles" WHERE "userId" = ?`,
      [userId],
      'wire.imageProfileNames',
    ),
  ]);

  const connectionNameById = new Map(profileNames.map(p => [p.id, p.name]));
  const imageNameById = new Map(imageProfileNames.map(p => [p.id, p.name]));

  /** Turn an attribution key into something a reader recognises. */
  const labelFor = (key: string, names: Map<string, string>): string => {
    if (!exactAttribution) return key; // already `provider/model`
    return names.get(key) ?? `(deleted profile ${key.slice(0, 8)}…)`;
  };

  const toWindowRows = (
    stats: Awaited<ReturnType<typeof repos.getStatsByProfile>>,
    medians: Awaited<ReturnType<typeof repos.getMedianDurationByProfile>>,
    names: Map<string, string>,
  ): ProfileWindowRow[] => {
    const medianByKey = new Map(medians.map(m => [m.key, num(m.medianDurationMs)]));
    return stats.slice(0, PROFILE_ROW_LIMIT).map(row => ({
      label: labelFor(row.key, names),
      provider: row.provider,
      modelName: row.modelName,
      requests: num(row.requests),
      promptTokens: num(row.promptTokens),
      completionTokens: num(row.completionTokens),
      totalTokens: num(row.totalTokens),
      measuredRequests: num(row.measuredRequests),
      avgDurationMs: row.avgDurationMs === null ? null : num(row.avgDurationMs),
      medianDurationMs: medianByKey.get(row.key) ?? null,
      failures: num(row.failures),
    }));
  };

  const toCacheRows = (
    rows: Awaited<ReturnType<typeof repos.getCacheStats>>,
    names?: Map<string, string>,
  ): CacheRow[] =>
    rows.map(row => {
      const cacheRead = num(row.cacheReadTokens);
      const cacheCreation = num(row.cacheCreationTokens);
      const promptTokens = num(row.promptTokens);
      // Provider plugins strip cache-read tokens out of `usage.promptTokens`
      // (see the plugin cache-accounting contract), so what remains there is
      // the uncached half and the three add up to the full prompt.
      const totalPrompt = promptTokens + cacheRead;
      return {
        label: names ? labelFor(row.key, names) : row.key,
        rowsWithCacheUsage: num(row.rowsWithCacheUsage),
        rowsWithCacheRead: num(row.rowsWithCacheRead),
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
        uncachedPromptTokens: promptTokens,
        requestHitRatio: ratio(num(row.rowsWithCacheRead), num(row.rowsWithCacheUsage)),
        tokenHitRatio: ratio(cacheRead, totalPrompt),
      };
    });

  return {
    totalEntries,
    tokenUsage,
    loggingEnabled,
    verboseMode,
    retentionDays,
    exactProfileAttribution: exactAttribution,
    byType: byType.map(row => ({
      type: row.type,
      requests: num(row.requests),
      promptTokens: num(row.promptTokens),
      completionTokens: num(row.completionTokens),
      totalTokens: num(row.totalTokens),
      measuredRequests: num(row.measuredRequests),
      avgDurationMs: row.avgDurationMs === null ? null : num(row.avgDurationMs),
      failures: num(row.failures),
    })),
    connectionProfileLifetime: lifetime,
    connectionProfileWindow: toWindowRows(connectionStats, connectionMedians, connectionNameById),
    imageProfileWindow: toWindowRows(imageStats, imageMedians, imageNameById),
    cacheByProvider: toCacheRows(cacheByProviderRows),
    cacheByProfile: toCacheRows(cacheByProfileRows, connectionNameById),
  };
}
