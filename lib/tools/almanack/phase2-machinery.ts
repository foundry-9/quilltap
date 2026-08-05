/**
 * The Almanack — Phase 2, "Cataloguing the machinery".
 *
 * Plugins, providers, models, API keys, MCP servers and themes: everything the
 * establishment has bolted on, and the state of the caches that describe it.
 *
 * @module lib/tools/almanack/phase2-machinery
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { getAllPlugins } from '@/lib/plugins/registry';
import {
  getAllProviders,
  getConfigRequirements,
  getProvidersByCapability,
  providerRegistry,
} from '@/lib/plugins/provider-registry';
import { getNpmPluginsDir } from '@/lib/paths';
import { getAllThemes, getThemeStats } from '@/lib/themes/theme-registry';
import { isIconName } from '@/components/ui/icons/icon-registry';
import { getRepositories } from '@/lib/repositories/factory';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getErrorMessage } from '@/lib/error-utils';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';
import { mainRows, num } from './db';
import type {
  ApiKeyUsageRow,
  DesignatedProfileInfo,
  EmbeddingProviderInfo,
  ImageProviderInfo,
  MCPServersInfo,
  ModelInfo,
  PluginBreakdown,
  PluginInfo,
  ProviderInfo,
  ProviderModelCacheRow,
  ThemeListItem,
  ThemeReportInfo,
} from './types';

const moduleLogger = logger.child({ module: 'almanack:machinery' });

/** package.json is more current than the manifest, so prefer it when readable. */
async function getPluginVersion(plugin: LoadedPlugin): Promise<string> {
  if (plugin.packageVersion) return plugin.packageVersion;
  try {
    const packageJsonPath = path.join(plugin.pluginPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkgJson = JSON.parse(content);
    return pkgJson.version || plugin.manifest.version;
  } catch {
    return plugin.manifest.version;
  }
}

/**
 * Collect plugin information, broken down by capability kind and by where the
 * plugin came from (npm-installed into the data dir vs shipped in the bundle).
 */
export async function collectPluginInfo(userId: string): Promise<PluginBreakdown> {
  moduleLogger.debug('Collecting plugin information');

  const allPlugins = getAllPlugins();
  const npmDir = getNpmPluginsDir();

  const enabled: PluginInfo[] = [];
  const disabled: PluginInfo[] = [];
  const capabilityCounts = new Map<string, number>();

  for (const plugin of allPlugins) {
    const version = await getPluginVersion(plugin);
    const installedFromNpm = plugin.pluginPath.startsWith(npmDir);

    const info: PluginInfo = {
      name: plugin.manifest.name,
      title: plugin.manifest.title,
      version,
      capabilities: plugin.capabilities,
      enabled: plugin.enabled,
      installedFromNpm,
    };

    for (const capability of plugin.capabilities) {
      capabilityCounts.set(capability, (capabilityCounts.get(capability) ?? 0) + 1);
    }

    (plugin.enabled ? enabled : disabled).push(info);
  }

  enabled.sort((a, b) => a.title.localeCompare(b.title));
  disabled.sort((a, b) => a.title.localeCompare(b.title));

  const [configRows, characterDataRows] = await Promise.all([
    mainRows<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "plugin_configs"`,
      [],
      'machinery.pluginConfigs',
    ),
    mainRows<{ n: number }>(
      `SELECT COUNT(*) AS n FROM "character_plugin_data"`,
      [],
      'machinery.characterPluginData',
    ),
  ]);

  void userId; // plugin rows are instance-global in the single-user model

  return {
    enabled,
    disabled,
    byCapability: [...capabilityCounts.entries()]
      .map(([capability, count]) => ({ capability, count }))
      .sort((a, b) => b.count - a.count || a.capability.localeCompare(b.capability)),
    npmInstalled: [...enabled, ...disabled].filter(p => p.installedFromNpm).length,
    bundled: [...enabled, ...disabled].filter(p => !p.installedFromNpm).length,
    pluginConfigRows: num(configRows[0]?.n),
    characterPluginDataRows: num(characterDataRows[0]?.n),
  };
}

/** Every API-key label a registered provider could ask for. */
export function collectApiKeyTypes(): string[] {
  const apiKeyTypes: string[] = [];
  for (const provider of getAllProviders()) {
    const config = getConfigRequirements(provider.metadata.providerName);
    if (config?.requiresApiKey) {
      apiKeyTypes.push(config.apiKeyLabel || `${provider.metadata.displayName} API Key`);
    }
  }
  return apiKeyTypes.sort((a, b) => a.localeCompare(b));
}

/** Provider registry, annotated with whether this instance has it configured. */
export async function collectProviderInfo(userId: string): Promise<ProviderInfo[]> {
  moduleLogger.debug('Collecting provider information', { userId });

  const repos = getUserRepositories(userId);
  const apiKeys = await repos.connections.getAllApiKeys();
  const configuredProviders = new Set(apiKeys.map(k => k.provider));

  const connectionProfiles = await repos.connections.findAll();
  for (const profile of connectionProfiles) {
    configuredProviders.add(profile.provider);
  }

  return getAllProviders()
    .map((provider): ProviderInfo => {
      const config = getConfigRequirements(provider.metadata.providerName);
      return {
        name: provider.metadata.providerName,
        displayName: provider.metadata.displayName,
        configured: configuredProviders.has(provider.metadata.providerName),
        capabilities: {
          chat: provider.capabilities.chat,
          imageGeneration: provider.capabilities.imageGeneration,
          embeddings: provider.capabilities.embeddings,
          webSearch: provider.capabilities.webSearch,
        },
        requiresApiKey: config?.requiresApiKey ?? true,
        requiresBaseUrl: config?.requiresBaseUrl ?? false,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Fetch available models per configured provider.
 *
 * Prefers the `provider_models` cache; only falls back to a live API call when
 * the cache is cold. This is the slowest collector in the whole report when the
 * cache is empty, which is why it sits inside a phase that runs its collectors
 * in parallel.
 */
export async function collectModels(userId: string): Promise<ModelInfo[]> {
  moduleLogger.debug('Collecting models from providers', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();
  const apiKeys = await repos.connections.getAllApiKeys();
  const connectionProfiles = await repos.connections.findAll();
  const modelsByProvider: ModelInfo[] = [];

  const keysByProvider = new Map<string, typeof apiKeys[0]>();
  for (const key of apiKeys) {
    if (key.isActive && !keysByProvider.has(key.provider)) {
      keysByProvider.set(key.provider, key);
    }
  }

  const baseUrlByProvider = new Map<string, string>();
  for (const profile of connectionProfiles) {
    if (profile.baseUrl && !baseUrlByProvider.has(profile.provider)) {
      baseUrlByProvider.set(profile.provider, profile.baseUrl);
    }
  }

  for (const [providerName, apiKeyRecord] of keysByProvider) {
    try {
      const provider = providerRegistry.getProvider(providerName);
      if (!provider) {
        moduleLogger.warn('Provider not found in registry', { providerName });
        continue;
      }

      const cachedModels = await globalRepos.providerModels.findByProvider(providerName, 'chat');
      if (cachedModels.length > 0) {
        modelsByProvider.push({
          provider: providerName,
          models: cachedModels
            .map(m => m.modelId)
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 50),
        });
        continue;
      }

      // Cold cache — go and ask. The registry wrapper applies localhost URL
      // rewriting and returns [] for providers with no discovery endpoint.
      const models = await providerRegistry.getAvailableModels(
        providerName,
        apiKeyRecord.key_value,
        baseUrlByProvider.get(providerName),
      );

      if (models.length > 0) {
        modelsByProvider.push({
          provider: providerName,
          models: [...models].sort((a, b) => a.localeCompare(b)).slice(0, 50),
        });
      } else if (provider.getModelInfo) {
        modelsByProvider.push({
          provider: providerName,
          models: provider
            .getModelInfo()
            .map(m => m.id || m.name)
            .sort((a, b) => a.localeCompare(b)),
        });
      }
    } catch (error) {
      modelsByProvider.push({
        provider: providerName,
        models: [],
        error: getErrorMessage(error),
      });
    }
  }

  return modelsByProvider.sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * Freshness of the model-discovery cache.
 *
 * A stale cache is exactly how the OpenRouter discovery regression presented —
 * the model list looked plausible and was months old — so the newest
 * `updatedAt` per provider is worth a column of its own.
 */
export async function collectProviderModelCache(): Promise<ProviderModelCacheRow[]> {
  const rows = await mainRows<{
    provider: string;
    total: number;
    chat: number;
    image: number;
    embedding: number;
    newestUpdatedAt: string | null;
  }>(
    `SELECT "provider"                                                       AS provider,
            COUNT(*)                                                         AS total,
            SUM(CASE WHEN "modelType" = 'chat' THEN 1 ELSE 0 END)            AS chat,
            SUM(CASE WHEN "modelType" = 'image' THEN 1 ELSE 0 END)           AS image,
            SUM(CASE WHEN "modelType" = 'embedding' THEN 1 ELSE 0 END)       AS embedding,
            MAX("updatedAt")                                                 AS newestUpdatedAt
     FROM "provider_models"
     GROUP BY "provider"
     ORDER BY "provider"`,
    [],
    'machinery.providerModelCache',
  );

  return rows.map(r => ({
    provider: r.provider,
    total: num(r.total),
    chat: num(r.chat),
    image: num(r.image),
    embedding: num(r.embedding),
    newestUpdatedAt: r.newestUpdatedAt ?? null,
  }));
}

/**
 * API keys per provider, with the never-used ones called out.
 *
 * A key that has never once been used is either a spare or a mistake, and the
 * column that tells them apart already exists.
 */
export async function collectApiKeyUsage(userId: string): Promise<ApiKeyUsageRow[]> {
  const rows = await mainRows<{
    provider: string;
    total: number;
    active: number;
    neverUsed: number;
    lastUsed: string | null;
  }>(
    `SELECT "provider"                                            AS provider,
            COUNT(*)                                              AS total,
            SUM(CASE WHEN "isActive" = 1 THEN 1 ELSE 0 END)       AS active,
            SUM(CASE WHEN "lastUsed" IS NULL THEN 1 ELSE 0 END)   AS neverUsed,
            MAX("lastUsed")                                       AS lastUsed
     FROM "api_keys"
     WHERE "userId" = ?
     GROUP BY "provider"
     ORDER BY "provider"`,
    [userId],
    'machinery.apiKeyUsage',
  );

  return rows.map(r => ({
    provider: r.provider,
    total: num(r.total),
    active: num(r.active),
    neverUsed: num(r.neverUsed),
    lastUsed: r.lastUsed ?? null,
  }));
}

/** The profile designated as the cheap background worker. */
export async function collectCheapLLMInfo(userId: string): Promise<DesignatedProfileInfo> {
  const profiles = await getUserRepositories(userId).connections.findAll();
  const cheapProfile = profiles.find(p => p.isCheap);
  if (!cheapProfile) return {};
  return {
    provider: cheapProfile.provider,
    model: cheapProfile.modelName,
    profileName: cheapProfile.name,
  };
}

/** The separate override used for expanding image prompts, if configured. */
export async function collectImagePromptLLMInfo(userId: string): Promise<DesignatedProfileInfo> {
  const globalRepos = getRepositories();
  const repos = getUserRepositories(userId);
  const chatSettings = await globalRepos.chatSettings.findByUserId(userId);

  const profileId = chatSettings?.cheapLLMSettings?.imagePromptProfileId;
  if (!profileId) return {};

  const profile = await repos.connections.findById(profileId);
  if (!profile) return {};
  return { provider: profile.provider, model: profile.modelName, profileName: profile.name };
}

/** The default embedding profile. */
export async function collectEmbeddingInfo(userId: string): Promise<DesignatedProfileInfo> {
  const defaultProfile = await getRepositories().embeddingProfiles.findDefault(userId);
  if (!defaultProfile) return {};
  return {
    provider: defaultProfile.provider,
    model: defaultProfile.modelName,
    profileName: defaultProfile.name,
  };
}

/** Image-capable providers and their models (cache first, static fallback). */
export async function collectImageProviders(): Promise<ImageProviderInfo[]> {
  const globalRepos = getRepositories();
  const result: ImageProviderInfo[] = [];

  for (const provider of getProvidersByCapability('imageGeneration')) {
    let models: string[] = [];
    const cachedModels = await globalRepos.providerModels.findByProvider(
      provider.metadata.providerName,
      'image',
    );
    if (cachedModels.length > 0) {
      models = cachedModels.map(m => m.modelId);
    } else if (provider.getImageGenerationModels) {
      models = provider.getImageGenerationModels().map(m => m.id || m.name);
    }
    result.push({
      provider: provider.metadata.providerName,
      displayName: provider.metadata.displayName,
      models: models.sort((a, b) => a.localeCompare(b)),
    });
  }

  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Embedding-capable providers and their models (cache first, static fallback). */
export async function collectEmbeddingProviders(): Promise<EmbeddingProviderInfo[]> {
  const globalRepos = getRepositories();
  const result: EmbeddingProviderInfo[] = [];

  for (const provider of getProvidersByCapability('embeddings')) {
    let models: string[] = [];
    const cachedModels = await globalRepos.providerModels.findByProvider(
      provider.metadata.providerName,
      'embedding',
    );
    if (cachedModels.length > 0) {
      models = cachedModels.map(m => m.modelId);
    } else if (provider.getEmbeddingModels) {
      models = provider.getEmbeddingModels().map(m => m.id || m.name);
    }
    result.push({
      provider: provider.metadata.providerName,
      displayName: provider.metadata.displayName,
      models: models.sort((a, b) => a.localeCompare(b)),
    });
  }

  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** MCP server configuration — names only, never URLs or auth fields. */
export async function collectMCPServers(userId: string): Promise<MCPServersInfo> {
  const defaults: MCPServersInfo = {
    configured: 0,
    enabled: 0,
    serverNames: [],
    autoReconnect: true,
    maxReconnectAttempts: 5,
  };

  try {
    const mcpConfig = await getRepositories().pluginConfigs.findByUserAndPlugin(
      userId,
      'qtap-plugin-mcp',
    );
    if (!mcpConfig) return defaults;

    const config = mcpConfig.config as Record<string, unknown>;
    let servers: Array<Record<string, unknown>> = [];
    if (config.servers) {
      try {
        servers =
          typeof config.servers === 'string'
            ? JSON.parse(config.servers)
            : Array.isArray(config.servers)
              ? config.servers
              : [];
      } catch {
        moduleLogger.debug('Failed to parse MCP servers config');
      }
    }

    const serverNames: string[] = [];
    let enabledCount = 0;
    for (const server of servers) {
      serverNames.push((server.displayName || server.name || 'Unnamed Server') as string);
      if (server.enabled === true) enabledCount++;
    }

    return {
      configured: servers.length,
      enabled: enabledCount,
      serverNames,
      autoReconnect: (config.autoReconnect as boolean) ?? true,
      maxReconnectAttempts: (config.maxReconnectAttempts as number) ?? 5,
    };
  } catch (error) {
    moduleLogger.warn('Failed to collect MCP server configuration', {
      error: getErrorMessage(error),
    });
    return defaults;
  }
}

/**
 * Theme inventory, including icon-override statistics.
 *
 * An override whose name is not a canonical `IconName` takes effect on exactly
 * nothing — it is a typo the theme author cannot see, so the report counts it.
 */
export async function collectThemeInfo(userId: string): Promise<ThemeReportInfo> {
  const chatSettings = await getRepositories().chatSettings.findByUserId(userId);

  const activeThemeId = chatSettings?.themePreference?.activeThemeId ?? null;
  const colorMode = chatSettings?.themePreference?.colorMode ?? 'system';

  let stats: ThemeReportInfo['stats'] = {
    total: 0,
    withDarkMode: 0,
    withCssOverrides: 0,
    errors: 0,
  };
  try {
    const rawStats = getThemeStats();
    stats = {
      total: rawStats.total,
      withDarkMode: rawStats.withDarkMode,
      withCssOverrides: rawStats.withCssOverrides,
      errors: rawStats.errors,
    };
  } catch (error) {
    moduleLogger.debug('Failed to get theme stats', { error: getErrorMessage(error) });
  }

  let themes: ThemeListItem[] = [];
  try {
    themes = getAllThemes().map((t): ThemeListItem => {
      const icons = t.icons ?? [];
      return {
        name: t.name,
        version: t.version,
        source: t.source,
        iconOverrides: icons.length,
        unknownIconOverrides: icons.filter(icon => !isIconName(icon.name)).length,
      };
    });
  } catch (error) {
    moduleLogger.debug('Failed to get theme list', { error: getErrorMessage(error) });
  }

  return {
    activeThemeId,
    colorMode,
    stats,
    themes,
    themesWithIcons: themes.filter(t => t.iconOverrides > 0).length,
    totalIconOverrides: themes.reduce((sum, t) => sum + t.iconOverrides, 0),
    totalUnknownIconOverrides: themes.reduce((sum, t) => sum + t.unknownIconOverrides, 0),
  };
}
