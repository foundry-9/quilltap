/**
 * The Almanack — markdown renderer.
 *
 * A pure function of {@link AlmanackReportData}: no I/O, no clock, no globals.
 * That is deliberate — it makes the whole rendered volume snapshot-testable
 * from a fixture, and it keeps "what we gathered" separate from "how we say
 * it", which is where the old report's mislabelled sections came from.
 *
 * @module lib/tools/almanack/render
 */

import { formatBytes } from '@/lib/utils/format-bytes';
import { ALMANACK_TITLE } from './phases';
import type { AlmanackReportData, CacheRow, ProfileWindowRow } from './types';

function formatUSD(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Escape a cell so a stray pipe can't shear a markdown table in half. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Small helper for the very common "one row per named count" shape. */
function countList(rows: Array<{ label: string; count: number }>, empty: string): string[] {
  if (rows.length === 0) return [`*${empty}*`];
  return rows.map(r => `- **${r.label}**: ${r.count.toLocaleString()}`);
}

export function renderAlmanackMarkdown(data: AlmanackReportData): string {
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(`# ${ALMANACK_TITLE}`, '');
  push(`Generated: ${formatDateTime(data.generatedAt)}`, '');
  push(
    'A compendium of the establishment as it stands: what is installed, what is configured,',
    'and what has accumulated. Safe to share — see the privacy note in the help page.',
    '',
  );

  // ==========================================================================
  // Phase 1 — Taking the measure of the premises
  // ==========================================================================

  push('## The Premises', '');
  push('### System Information', '');
  push(`- **Version**: ${data.version}`);
  push(`- **Node Environment**: ${data.nodeEnv}`);
  push(`- **Node Version**: ${data.runtimeEnvironment.nodeVersion}`);
  push(
    `- **Platform**: ${data.runtimeEnvironment.platform} (${data.runtimeEnvironment.arch})`,
  );
  push(`- **OS**: ${data.runtimeEnvironment.osType} ${data.runtimeEnvironment.osRelease}`);
  push(`- **Runtime Type**: ${data.runtimeEnvironment.runtimeType}`);
  if (data.runtimeEnvironment.electronShellVersion) {
    push(`- **Electron Shell**: ${data.runtimeEnvironment.electronShellVersion}`);
  }
  if (data.runtimeEnvironment.shellCapabilities.length > 0) {
    push(`- **Shell Capabilities**: ${data.runtimeEnvironment.shellCapabilities.join(', ')}`);
  }
  push(`- **Total Memory**: ${formatBytes(data.runtimeEnvironment.totalMemoryBytes)}`);
  push(`- **Free Memory**: ${formatBytes(data.runtimeEnvironment.freeMemoryBytes)}`);
  push(
    `- **Uptime**: ${Math.floor(data.runtimeEnvironment.uptimeSeconds / 3600)}h ${Math.floor(
      (data.runtimeEnvironment.uptimeSeconds % 3600) / 60,
    )}m`,
  );
  push(`- **Timezone**: ${data.runtimeEnvironment.timezone}`);
  push(`- **Data Directory**: ${data.runtimeEnvironment.dataDirectory}`, '');

  push('### Databases & Security', '');
  push(`- **Passphrase Protected**: ${yesNo(data.databaseSecurity.passphraseProtected)}`);
  if (data.databaseSecurity.highestAppVersion) {
    push(`- **Highest App Version Seen**: ${data.databaseSecurity.highestAppVersion}`);
  }
  push('');
  push('| Database | Size | Present |');
  push('|----------|------|---------|');
  for (const db of data.databaseSecurity.databases) {
    push(`| ${cell(db.label)} | ${formatBytes(db.sizeBytes)} | ${yesNo(db.present)} |`);
  }
  push('');

  push('### Backup Status', '');
  push('| Database | Backups | Newest | Oldest | Total Size |');
  push('|----------|---------|--------|--------|------------|');
  for (const backup of data.backupStatus) {
    push(
      `| ${cell(backup.label)} | ${backup.count} | ${formatDate(backup.newestDate)} | ` +
        `${formatDate(backup.oldestDate)} | ${formatBytes(backup.totalSizeBytes)} |`,
    );
  }
  push('');

  push('### Migration State', '');
  push(`- **Migrations Applied**: ${data.migrationState.appliedCount}`);
  push(`- **Last Migration**: ${data.migrationState.lastMigrationId ?? 'None recorded'}`);
  push(`- **Applied At**: ${formatDateTime(data.migrationState.lastMigrationAt)}`);
  push(`- **Applied By Version**: ${data.migrationState.lastMigrationVersion ?? 'N/A'}`, '');

  // ==========================================================================
  // Phase 2 — Cataloguing the machinery
  // ==========================================================================

  push('## The Machinery', '');

  push('### Plugins', '');
  push(`- **Enabled**: ${data.plugins.enabled.length}`);
  push(`- **Disabled**: ${data.plugins.disabled.length}`);
  push(`- **Installed from npm**: ${data.plugins.npmInstalled}`);
  push(`- **Bundled with the app**: ${data.plugins.bundled}`);
  push(`- **Plugin config rows**: ${data.plugins.pluginConfigRows}`);
  push(`- **Per-character plugin data rows**: ${data.plugins.characterPluginDataRows}`, '');

  if (data.plugins.byCapability.length > 0) {
    push('| Capability | Plugins |');
    push('|------------|---------|');
    for (const row of data.plugins.byCapability) {
      push(`| ${cell(row.capability)} | ${row.count} |`);
    }
    push('');
  }

  for (const [heading, list] of [
    ['Enabled Plugins', data.plugins.enabled],
    ['Disabled Plugins', data.plugins.disabled],
  ] as const) {
    push(`#### ${heading}`, '');
    if (list.length === 0) {
      push(`*None*`, '');
      continue;
    }
    push('| Name | Version | Source | Capabilities |');
    push('|------|---------|--------|--------------|');
    for (const plugin of list) {
      push(
        `| ${cell(plugin.title)} | ${cell(plugin.version)} | ` +
          `${plugin.installedFromNpm ? 'npm' : 'bundled'} | ${cell(plugin.capabilities.join(', '))} |`,
      );
    }
    push('');
  }

  push('### LLM Providers', '');
  push('| Provider | Configured | Capabilities |');
  push('|----------|------------|--------------|');
  for (const provider of data.providers) {
    const caps: string[] = [];
    if (provider.capabilities.chat) caps.push('Chat');
    if (provider.capabilities.imageGeneration) caps.push('Images');
    if (provider.capabilities.embeddings) caps.push('Embeddings');
    if (provider.capabilities.webSearch) caps.push('Web Search');
    push(
      `| ${cell(provider.displayName)} | ${provider.configured ? '✓' : '✗'} | ${cell(caps.join(', '))} |`,
    );
  }
  push('');

  push('### Models by Provider', '');
  if (data.modelsByProvider.length === 0) {
    push('*No configured providers with models*', '');
  }
  for (const providerModels of data.modelsByProvider) {
    push(`#### ${providerModels.provider}`, '');
    if (providerModels.error) {
      push(`*Error fetching models: ${providerModels.error}*`);
    } else if (providerModels.models.length > 0) {
      for (const model of providerModels.models) push(`- ${model}`);
    } else {
      push('*No models available*');
    }
    push('');
  }

  push('### Model Discovery Cache', '');
  push(
    'How fresh the cached model lists are. A cache that has not moved in months is how a',
    'silently broken discovery endpoint presents itself.',
    '',
  );
  if (data.providerModelCache.length === 0) {
    push('*Cache is empty — model lists are being fetched live*', '');
  } else {
    push('| Provider | Total | Chat | Image | Embedding | Last Refreshed |');
    push('|----------|-------|------|-------|-----------|----------------|');
    for (const row of data.providerModelCache) {
      push(
        `| ${cell(row.provider)} | ${row.total} | ${row.chat} | ${row.image} | ${row.embedding} | ` +
          `${formatDateTime(row.newestUpdatedAt)} |`,
      );
    }
    push('');
  }

  push('### API Keys', '');
  if (data.apiKeyUsage.length === 0) {
    push('*No API keys stored*', '');
  } else {
    push('| Provider | Keys | Active | Never Used | Last Used |');
    push('|----------|------|--------|------------|-----------|');
    for (const row of data.apiKeyUsage) {
      push(
        `| ${cell(row.provider)} | ${row.total} | ${row.active} | ${row.neverUsed} | ` +
          `${formatDate(row.lastUsed)} |`,
      );
    }
    push('');
  }
  if (data.apiKeyTypes.length > 0) {
    push('Key types the registered providers can accept:', '');
    for (const type of data.apiKeyTypes) push(`- ${type}`);
    push('');
  }

  push('### Designated Workers', '');
  push(
    data.cheapLLM.provider
      ? `- **Cheap LLM**: ${data.cheapLLM.provider} / ${data.cheapLLM.model} (${data.cheapLLM.profileName})`
      : '- **Cheap LLM**: *Not configured*',
  );
  if (data.imagePromptLLM.provider) {
    push(
      `- **Image Prompt LLM**: ${data.imagePromptLLM.provider} / ${data.imagePromptLLM.model} (${data.imagePromptLLM.profileName})`,
    );
  }
  push(
    data.embeddingProvider.provider
      ? `- **Embedding Provider**: ${data.embeddingProvider.provider} / ${data.embeddingProvider.model} (${data.embeddingProvider.profileName})`
      : '- **Embedding Provider**: *Not configured*',
  );
  push('');

  push('### Image Providers', '');
  if (data.imageProviders.length > 0) {
    push('| Provider | Models |');
    push('|----------|--------|');
    for (const provider of data.imageProviders) {
      push(
        `| ${cell(provider.displayName)} | ${cell(provider.models.join(', ') || '*No models listed*')} |`,
      );
    }
  } else {
    push('*No image providers available*');
  }
  push('');

  push('### Embedding Providers', '');
  if (data.embeddingProviders.length > 0) {
    push('| Provider | Models |');
    push('|----------|--------|');
    for (const provider of data.embeddingProviders) {
      push(
        `| ${cell(provider.displayName)} | ${cell(provider.models.join(', ') || '*No models listed*')} |`,
      );
    }
  } else {
    push('*No embedding providers available*');
  }
  push('');

  push('### MCP Servers', '');
  if (data.mcpServers.configured > 0) {
    push(`- **Configured**: ${data.mcpServers.configured}`);
    push(`- **Enabled**: ${data.mcpServers.enabled}`);
    push(`- **Auto-Reconnect**: ${yesNo(data.mcpServers.autoReconnect)}`);
    push(`- **Max Reconnect Attempts**: ${data.mcpServers.maxReconnectAttempts}`, '');
    push('Server names (URLs and credentials are deliberately omitted):', '');
    for (const name of data.mcpServers.serverNames) push(`- ${name}`);
  } else {
    push('*No MCP servers configured*');
  }
  push('');

  push('### Calliope (Themes)', '');
  push(`- **Active Theme**: ${data.themeInfo.activeThemeId ?? 'Default'}`);
  push(`- **Colour Mode**: ${data.themeInfo.colorMode}`);
  push(`- **Total Themes**: ${data.themeInfo.stats.total}`);
  push(`- **With Dark Mode**: ${data.themeInfo.stats.withDarkMode}`);
  push(`- **With CSS Overrides**: ${data.themeInfo.stats.withCssOverrides}`);
  push(`- **Shipping Icon Overrides**: ${data.themeInfo.themesWithIcons}`);
  push(`- **Total Icon Overrides**: ${data.themeInfo.totalIconOverrides}`);
  if (data.themeInfo.totalUnknownIconOverrides > 0) {
    push(
      `- **Overrides naming an unknown icon**: ${data.themeInfo.totalUnknownIconOverrides} ` +
        '(these take effect on nothing — likely typos in a theme manifest)',
    );
  }
  if (data.themeInfo.stats.errors > 0) {
    push(`- **Load Errors**: ${data.themeInfo.stats.errors}`);
  }
  push('');
  if (data.themeInfo.themes.length > 0) {
    push('| Theme | Version | Source | Icon Overrides | Unknown |');
    push('|-------|---------|--------|----------------|---------|');
    for (const theme of data.themeInfo.themes) {
      push(
        `| ${cell(theme.name)} | ${cell(theme.version)} | ${cell(theme.source)} | ` +
          `${theme.iconOverrides} | ${theme.unknownIconOverrides} |`,
      );
    }
    push('');
  }

  // ==========================================================================
  // Phase 3 — Auditing the ledgers
  // ==========================================================================

  push('## The Ledgers', '');

  push('### Census', '');
  push('| Collection | Count |');
  push('|------------|-------|');
  push(`| Characters | ${data.databaseStats.characters} |`);
  push(`| Favourite Characters | ${data.databaseStats.favoriteCharacters} |`);
  push(`| Chats | ${data.databaseStats.chats} |`);
  push(`| Memories | ${data.databaseStats.memories.toLocaleString()} |`);
  push(`| Tags | ${data.databaseStats.tags} |`);
  push(`| Projects | ${data.databaseStats.projects} |`);
  push(`| Groups | ${data.databaseStats.groups} |`);
  push(
    `| Connection Profiles | ${data.databaseStats.connectionProfiles.total} ` +
      `(${data.databaseStats.connectionProfiles.webSearchEnabled} web search, ` +
      `${data.databaseStats.connectionProfiles.toolUseEnabled} tool use, ` +
      `${data.databaseStats.connectionProfiles.dangerousCompatible} dangerous) |`,
  );
  push(`| Image Profiles | ${data.databaseStats.imageProfiles} |`);
  push(`| Embedding Profiles | ${data.databaseStats.embeddingProfiles} |`);
  push(
    `| Prompt Templates | ${data.databaseStats.promptTemplates.total} ` +
      `(${data.databaseStats.promptTemplates.builtIn} built-in, ${data.databaseStats.promptTemplates.custom} custom) |`,
  );
  push(
    `| Roleplay Templates | ${data.databaseStats.roleplayTemplates.total} ` +
      `(${data.databaseStats.roleplayTemplates.builtIn} built-in, ${data.databaseStats.roleplayTemplates.custom} custom) |`,
  );
  push('');

  push('### Chat Statistics', '');
  push(`- **Total Messages**: ${data.chatStats.totalMessages.toLocaleString()}`);
  push(`- **Total Prompt Tokens**: ${data.chatStats.totalPromptTokens.toLocaleString()}`);
  push(`- **Total Completion Tokens**: ${data.chatStats.totalCompletionTokens.toLocaleString()}`);
  push(`- **Estimated Total Cost**: ${formatUSD(data.chatStats.totalEstimatedCostUSD)}`);
  push(`- **Agent Mode Chats**: ${data.chatStats.agentModeChats}`);
  push(`- **Dangerous Chats**: ${data.chatStats.dangerousChats}`, '');

  push('### The Shape of the Chats', '');
  push(
    ...countList(
      data.chatBreakdown.byType.map(r => ({ label: r.chatType, count: r.count })),
      'No chats',
    ),
  );
  push('');
  push(`- **Paused**: ${data.chatBreakdown.pausedChats}`);
  push(`- **In Document Mode**: ${data.chatBreakdown.documentModeChats}`);
  push(`- **Open document rows**: ${data.chatBreakdown.chatDocumentRows}`);
  push(`- **Chats with several documents open**: ${data.chatBreakdown.multiDocumentChats}`);
  push(`- **With an equipped outfit**: ${data.chatBreakdown.chatsWithEquippedOutfit}`);
  push(
    `- **With pending outfit notifications**: ${data.chatBreakdown.pendingOutfitNotificationChats}`,
  );
  push(`- **On the narrative clock**: ${data.chatBreakdown.narrativeTimelineChats}`);
  push(`- **Carrying chat state**: ${data.chatBreakdown.chatsWithNonEmptyState}`, '');

  if (data.chatBreakdown.participantHistogram.length > 0) {
    push('Cast sizes:', '');
    push('| Participants | Chats |');
    push('|--------------|-------|');
    for (const row of data.chatBreakdown.participantHistogram) {
      push(`| ${row.participants} | ${row.chats} |`);
    }
    push('');
  }

  push('### Autonomous Rooms', '');
  if (data.autonomousRooms.total === 0) {
    push('*No autonomous rooms*', '');
  } else {
    push(`- **Total**: ${data.autonomousRooms.total}`);
    push(`- **Scheduled**: ${data.autonomousRooms.scheduled}`);
    push(`- **Overdue for their next run**: ${data.autonomousRooms.overdue}`);
    push(`- **With a turn budget**: ${data.autonomousRooms.withTurnBudget}`);
    push(`- **With a token budget**: ${data.autonomousRooms.withTokenBudget}`);
    push(`- **With a wall-clock budget**: ${data.autonomousRooms.withWallClockBudget}`);
    push(`- **With a spend cap**: ${data.autonomousRooms.withSpendCap}`);
    push(`- **Permitting destructive tools**: ${data.autonomousRooms.destructiveToolsAllowed}`, '');
    push('| Run State | Rooms |');
    push('|-----------|-------|');
    for (const row of data.autonomousRooms.byRunState) {
      push(`| ${cell(row.runState)} | ${row.count} |`);
    }
    push('');
    push('| Visibility | Rooms |');
    push('|------------|-------|');
    for (const row of data.autonomousRooms.byVisibility) {
      push(`| ${cell(row.visibility)} | ${row.count} |`);
    }
    push('');
  }

  push('### The Commonplace Book', '');
  push(`- **Total memories**: ${data.memoryBreakdown.total.toLocaleString()}`);
  push(`- **Characters holding memories**: ${data.memoryBreakdown.charactersWithMemories}`);
  push(`- **With an event time (\`occurredAt\`)**: ${data.memoryBreakdown.withOccurredAt.toLocaleString()}`);
  push(`- **With a narrative time**: ${data.memoryBreakdown.withNarrativeTime.toLocaleString()}`);
  push(`- **With extracted entities**: ${data.memoryBreakdown.withEntities.toLocaleString()}`);
  push(`- **Embedded**: ${data.memoryBreakdown.withEmbedding.toLocaleString()}`);
  push(`- **Total reinforcements**: ${data.memoryBreakdown.reinforcedTotal.toLocaleString()}`);
  push(`- **Most-reinforced memory**: ${data.memoryBreakdown.maxReinforcementCount} times`, '');
  for (const [heading, rows] of [
    ['By kind', data.memoryBreakdown.byKind.map(r => ({ label: r.kind, count: r.count }))],
    ['By source', data.memoryBreakdown.bySource.map(r => ({ label: r.source, count: r.count }))],
    [
      'By witnessed context',
      data.memoryBreakdown.byWitnessedContext.map(r => ({
        label: r.witnessedContext,
        count: r.count,
      })),
    ],
  ] as const) {
    push(`**${heading}**`, '');
    push(...countList([...rows], 'None'));
    push('');
  }

  push('### Characters', '');
  push(`- **Total**: ${data.characterBreakdown.total}`);
  push(`- **Vault-linked**: ${data.characterBreakdown.vaultLinked}`);
  if (data.characterBreakdown.vaultless > 0) {
    push(`- **Without a vault**: ${data.characterBreakdown.vaultless}`);
  }
  push(`- **NPCs**: ${data.characterBreakdown.npcs}`);
  push(`- **User-controlled personas**: ${data.characterBreakdown.userControlled}`);
  push(`- **Carina answerers**: ${data.characterBreakdown.carinaAnswerers}`);
  push(`- **Permitted to see the Staff**: ${data.characterBreakdown.systemTransparent}`);
  push(`- **May dress themselves**: ${data.characterBreakdown.canDressThemselves}`);
  push(`- **May create outfits**: ${data.characterBreakdown.canCreateOutfits}`);
  push(`- **With a Core-whisper override**: ${data.characterBreakdown.coreWhisperOverrides}`, '');

  push('### Feature Configuration', '');
  const fc = data.featureConfig;
  push('#### The Concierge (Dangerous Content)', '');
  push(`- **Mode**: ${fc.dangerousContent.mode}`);
  push(`- **Threshold**: ${fc.dangerousContent.threshold}`);
  push(`- **Scan Text Chat**: ${yesNo(fc.dangerousContent.scanTextChat)}`);
  push(`- **Scan Image Prompts**: ${yesNo(fc.dangerousContent.scanImagePrompts)}`);
  push(`- **Scan Image Generation**: ${yesNo(fc.dangerousContent.scanImageGeneration)}`, '');

  push('#### Context Compression', '');
  push(`- **Enabled**: ${yesNo(fc.contextCompression.enabled)}`);
  push(`- **Window Size**: ${fc.contextCompression.windowSize}`);
  push(`- **Compression Target Tokens**: ${fc.contextCompression.compressionTargetTokens}`, '');

  push('#### Prospero (Agent Mode)', '');
  push(`- **Max Turns**: ${fc.agentMode.maxTurns}`);
  push(`- **Default Enabled**: ${yesNo(fc.agentMode.defaultEnabled)}`, '');

  push('#### The Lantern (Story Backgrounds)', '');
  push(`- **Enabled**: ${yesNo(fc.storyBackgrounds.enabled)}`);
  push(`- **Has Default Image Profile**: ${yesNo(fc.storyBackgrounds.hasDefaultImageProfile)}`, '');

  push('#### Aurora (Core Whisper)', '');
  push(`- **Enabled**: ${yesNo(fc.coreWhisper.enabled)}`);
  push(`- **Interval**: ${fc.coreWhisper.interval}`);
  push(`- **Silence Threshold**: ${fc.coreWhisper.silenceThreshold}`);
  push(`- **Packet Token Budget**: ${fc.coreWhisper.packetTokenBudget}`);
  push(`- **Fires on Context Transition**: ${yesNo(fc.coreWhisper.fireOnContextTransition)}`, '');

  push('#### Pascal the Croupier (RNG)', '');
  push(`- **Auto-Detect RNG**: ${yesNo(fc.autoDetectRng)}`, '');

  push("#### Pascal's Workbench (Custom Tools)", '');
  push(`- **Custom tools offered to models**: ${yesNo(fc.customTools)}`);
  push(
    '- *(the inventory of definitions lives in the Scriptorium section — they are documents, not settings)*',
    '',
  );

  push('#### Timestamps', '');
  push(`- **Mode**: ${fc.timestamps.mode}`);
  push(`- **Format**: ${fc.timestamps.format}`, '');

  push('#### Saquel Ytzama (Auto-Lock)', '');
  push(`- **Enabled**: ${yesNo(fc.autoLock.enabled)}`);
  push(`- **Idle Minutes**: ${fc.autoLock.idleMinutes}`, '');

  push('#### Memory Cascade & Housekeeping', '');
  push(`- **On Message Delete**: ${fc.memoryCascade.onMessageDelete}`);
  push(`- **On Swipe/Regenerate**: ${fc.memoryCascade.onSwipeRegenerate}`);
  push(`- **Auto Housekeeping**: ${yesNo(fc.autoHousekeeping.enabled)}`);
  push(`- **Per-Character Cap**: ${fc.autoHousekeeping.perCharacterCap}`);
  push(`- **Merge Similar**: ${yesNo(fc.autoHousekeeping.mergeSimilar)}`);
  push(`- **Merge Threshold**: ${fc.autoHousekeeping.autoMergeSimilarThreshold}`, '');

  push('#### Salon Behaviour', '');
  push(`- **Answer Confirmation**: ${yesNo(fc.answerConfirmation.enabled)}`);
  push(`- **Thinking Visible by Default**: ${yesNo(fc.thinkingDisplay.defaultVisible)}`);
  push(`- **Thinking Collapsed by Default**: ${yesNo(fc.thinkingDisplay.defaultCollapsed)}`);
  push(`- **Composer Spellcheck**: ${yesNo(fc.composerSpellcheck)}`);
  push(`- **Auto-Scroll on Response Complete**: ${yesNo(fc.autoScrollOnResponseComplete)}`);
  push(
    `- **Text Replacements**: ${yesNo(fc.textReplacements.enabled)} ` +
      `(${fc.textReplacements.enabledRules} of ${fc.textReplacements.rules} rules enabled)`,
  );
  push(`- **Avatar Display**: ${fc.avatarDisplay.mode} / ${fc.avatarDisplay.style}`, '');

  push('#### Image Description', '');
  push(`- **Primary profile configured**: ${yesNo(fc.imageDescriptionProfileConfigured)}`);
  push(
    `- **Uncensored fallback configured**: ${yesNo(fc.uncensoredImageDescriptionProfileConfigured)}`,
    '',
  );

  push('### Instance Settings', '');
  push(`- **Stale-chat retention**: ${data.instanceSettings.staleChatDays} days`);
  push(
    `- **Chats eligible for the next sweep**: ${data.instanceSettings.chatsEligibleForNextSweep}`,
  );
  push(`- **Max concurrent background jobs**: ${data.instanceSettings.maxConcurrentJobs}`);
  push(
    `- **Memory recall**: scope policy \`${data.instanceSettings.memoryRecall.scopePolicy}\`, ` +
      `related-memory expansion ${yesNo(data.instanceSettings.memoryRecall.expandRelated)}`,
  );
  push(
    `- **Memory extraction limits**: ${yesNo(data.instanceSettings.memoryExtractionLimits.enabled)} ` +
      `(max ${data.instanceSettings.memoryExtractionLimits.maxPerHour}/hour, ` +
      `soft start ${data.instanceSettings.memoryExtractionLimits.softStartFraction}, ` +
      `floor ${data.instanceSettings.memoryExtractionLimits.softFloor})`,
  );
  push(
    `- **Last maintenance sweep**: ${formatDateTime(data.instanceSettings.lastMaintenanceSweepAt)}`,
    '',
  );

  push('### Background Jobs', '');
  push('**By status**', '');
  push(
    ...countList(
      data.backgroundJobs.byStatus.map(r => ({ label: r.status, count: r.count })),
      'No jobs',
    ),
  );
  push('');
  push('**By type**', '');
  push(
    ...countList(
      data.backgroundJobs.byType.map(r => ({ label: r.type, count: r.count })),
      'No jobs',
    ),
  );
  push('');
  push(`- **Attempts exhausted**: ${data.backgroundJobs.attemptsExhausted}`);
  push(
    `- **Oldest pending job scheduled**: ${formatDateTime(data.backgroundJobs.oldestPendingScheduledAt)}`,
    '',
  );
  if (data.backgroundJobs.failed.length > 0) {
    push('| Failed Job Type | Count | Most Recent Error |');
    push('|-----------------|-------|-------------------|');
    for (const row of data.backgroundJobs.failed) {
      push(`| ${cell(row.type)} | ${row.count} | ${cell(row.lastError ?? '—')} |`);
    }
    push('');
  }

  push('### Embedding Pipeline', '');
  push(
    `- **Conversation chunks**: ${data.embeddingPipeline.conversationChunks.total.toLocaleString()} ` +
      `(${data.embeddingPipeline.conversationChunks.unembedded.toLocaleString()} unembedded)`,
  );
  push(
    `- **Help docs**: ${data.embeddingPipeline.helpDocs.total} ` +
      `(${data.embeddingPipeline.helpDocs.unembedded} unembedded)`,
  );
  push(`- **Permanently failed rows**: ${data.embeddingPipeline.permanentlyFailed}`);
  push(
    `- **Active profile dimensions**: ${data.embeddingPipeline.activeProfileDimensions ?? 'Not configured'}`,
  );
  if (data.embeddingPipeline.dimensionMismatch) {
    push(
      '- **⚠ Dimension mismatch**: stored vectors do not all match the active embedding profile. ' +
        'Recall against the mismatched vectors will be wrong until they are reindexed.',
    );
  }
  push('');
  if (data.embeddingPipeline.storedDimensions.length > 0) {
    push('| Table | Dimensions | Vectors |');
    push('|-------|------------|---------|');
    for (const row of data.embeddingPipeline.storedDimensions) {
      push(`| ${cell(row.table)} | ${row.dimensions} | ${row.vectors.toLocaleString()} |`);
    }
    push('');
  }
  if (data.embeddingPipeline.statusByEntityType.length > 0) {
    push('| Entity Type | Status | Rows |');
    push('|-------------|--------|------|');
    for (const row of data.embeddingPipeline.statusByEntityType) {
      push(`| ${cell(row.entityType)} | ${cell(row.status)} | ${row.count.toLocaleString()} |`);
    }
    push('');
  }

  push('### Ariel (Terminal)', '');
  push(`- **Total sessions**: ${data.terminal.totalSessions}`);
  push(`- **Still live**: ${data.terminal.liveSessions}`);
  push(`- **Exited non-zero**: ${data.terminal.nonZeroExits}`);
  push(
    `- **Shells seen**: ${data.terminal.distinctShells.length > 0 ? data.terminal.distinctShells.join(', ') : 'None'}`,
    '',
  );

  push('### Legacy File Ledger', '');
  push(
    'The `files` table. Since the document-store cutovers the bulk of stored bytes lives in the',
    'Scriptorium (below); what remains here is mostly generated-image bookkeeping and residue.',
    '',
  );
  push(`- **Total Files**: ${data.storageStats.totalFiles.toLocaleString()}`);
  push(`- **Total Size**: ${formatBytes(data.storageStats.totalSize)}`);
  push(`- **Files not marked \`ok\`**: ${data.storageStats.notOkFiles}`, '');
  if (data.storageStats.folders.length > 0) {
    push('| Folder | Files | Size |');
    push('|--------|-------|------|');
    for (const folder of data.storageStats.folders) {
      push(`| ${cell(folder.path)} | ${folder.fileCount} | ${formatBytes(folder.totalSize)} |`);
    }
    push('');
  }
  if (data.storageStats.generatedImagesByModel.length > 0) {
    push('Generated images by model:', '');
    push('| Model | Images | Size |');
    push('|-------|--------|------|');
    for (const row of data.storageStats.generatedImagesByModel) {
      push(`| ${cell(row.generationModel)} | ${row.count} | ${formatBytes(row.bytes)} |`);
    }
    push('');
  }

  // ==========================================================================
  // Phase 4 — Touring the Scriptorium
  // ==========================================================================

  push('## The Scriptorium', '');
  const s = data.scriptorium;
  if (!s.available) {
    push(
      '*The mount-index database could not be opened, so this whole section is unavailable.',
      'That is itself worth reporting: character content, wardrobe, photos, mail and every',
      'document byte live there.*',
      '',
    );
  } else {
    push('### Document Stores', '');
    push(`- **Total stores**: ${s.mountPoints.total} (${s.mountPoints.enabled} enabled)`);
    push(`- **Stores with a scan error**: ${s.mountPoints.scanErrors}`);
    push(`- **Stores stuck mid-conversion**: ${s.mountPoints.conversionErrors}`, '');

    if (s.mountPoints.byKind.length > 0) {
      push('| Mount Type | Store Type | Stores | Enabled | Files | Chunks | Size |');
      push('|------------|------------|--------|---------|-------|--------|------|');
      for (const row of s.mountPoints.byKind) {
        push(
          `| ${cell(row.mountType)} | ${cell(row.storeType)} | ${row.count} | ${row.enabled} | ` +
            `${row.fileCount.toLocaleString()} | ${row.chunkCount.toLocaleString()} | ${formatBytes(row.totalSizeBytes)} |`,
        );
      }
      push('');
    }

    push('**Scan status**', '');
    push(...countList(s.mountPoints.scanStatuses.map(r => ({ label: r.status, count: r.count })), 'No stores'));
    push('');
    push('**Conversion status**', '');
    push(
      ...countList(
        s.mountPoints.conversionStatuses.map(r => ({ label: r.status, count: r.count })),
        'No stores',
      ),
    );
    push('');

    if (s.mountPoints.wellKnown.length > 0) {
      push('The three global stores:', '');
      push('| Store | Setting Key | Resolves |');
      push('|-------|-------------|----------|');
      for (const row of s.mountPoints.wellKnown) {
        const name = row.resolved ? (row.name ?? '(unnamed)') : row.mountPointId ? 'Missing row' : 'Not provisioned';
        push(`| ${cell(row.label)} | \`${cell(row.settingKey)}\` | ${cell(name)} |`);
      }
      push('');
    }

    push('### Contents', '');
    push(`- **Content rows** (\`doc_mount_files\`): ${s.content.fileRows.toLocaleString()}`);
    push(`- **Link rows** (visible locations): ${s.content.linkRows.toLocaleString()}`);
    push(
      `- **Text documents**: ${s.content.documentRows.toLocaleString()} (${formatBytes(s.content.documentTextBytes)})`,
    );
    push(
      `- **Binary blobs**: ${s.content.blobRows.toLocaleString()} (${formatBytes(s.content.blobBytes)})`,
    );
    push(
      `- **Chunks**: ${s.content.chunkRows.toLocaleString()} ` +
        `(${s.content.unembeddedChunks.toLocaleString()} unembedded, ${s.content.chunkTokens.toLocaleString()} tokens)`,
    );
    push('');
    if (s.content.blobsByMimeType.length > 0) {
      push('| Stored MIME Type | Blobs | Size |');
      push('|------------------|-------|------|');
      for (const row of s.content.blobsByMimeType) {
        push(`| ${cell(row.storedMimeType)} | ${row.count.toLocaleString()} | ${formatBytes(row.bytes)} |`);
      }
      push('');
    }

    push('### Links & Policy', '');
    push(`- **Links per content row**: ${s.links.dedupRatio.toFixed(2)}`);
    push(
      `- **Hard-link groups**: ${s.links.hardLinkGroups} (${s.links.hardLinkedLinks} links belong to one)`,
    );
    push(`- **Extraction errors**: ${s.links.extractionErrors}`);
    push(`- **Conversion errors**: ${s.links.conversionErrors}`);
    push(`- **Documents withheld from embedding**: ${s.links.policyEmbedDenied}`);
    push(`- **Documents hidden from characters**: ${s.links.policyCharacterReadDenied}`);
    push(`- **Documents characters may not write**: ${s.links.policyCharacterWriteDenied}`, '');

    push('### Character Vaults', '');
    push(`- **Vault-linked characters**: ${s.characterVaults.total}`);
    push(`- **With the \`properties.json\` keystone**: ${s.characterVaults.withKeystone}`);
    if (s.characterVaults.missingKeystone > 0) {
      push(
        `- **⚠ Missing the keystone**: ${s.characterVaults.missingKeystone}. ` +
          'Reading one of these characters raises `CharacterVaultUnavailableError` — a hard failure ' +
          'for that character, not a silently empty one.',
      );
    }
    push(`- **With a \`metadata.json\`**: ${s.characterVaults.withMetadata}`, '');

    push('### Wardrobe', '');
    if (s.wardrobe.every(w => w.items === 0)) {
      push('*No wardrobe items*', '');
    } else {
      push('| Tier | Items | Archived |');
      push('|------|-------|----------|');
      for (const row of s.wardrobe) {
        push(`| ${cell(row.tier)} | ${row.items} | ${row.archived} |`);
      }
      push('');
    }

    push("### Pascal's Workbench (Custom Tools)", '');
    push(`- **Definitions found**: ${s.customTools.total}`);
    push(`- **With saved presets**: ${s.customTools.withPresets} (${s.customTools.presetFiles} preset files)`);
    push(`- **Consulting an LLM**: ${s.customTools.withLlmConsult}`);
    push(`- **With side effects**: ${s.customTools.withEffects}`);
    push(`- **Gated on invoker metadata**: ${s.customTools.metadataGated}`);
    push(`- **Failed to parse**: ${s.customTools.parseFailures}`, '');
    if (s.customTools.byStore.length > 0) {
      push('| Store | Definitions |');
      push('|-------|-------------|');
      for (const row of s.customTools.byStore) {
        push(`| ${cell(row.store)} | ${row.count} |`);
      }
      push('');
    }
    if (s.customTools.parseFailureDetail.length > 0) {
      push('Definitions that would not load:', '');
      push('| Store | Path | Reason |');
      push('|-------|------|--------|');
      for (const row of s.customTools.parseFailureDetail) {
        push(`| ${cell(row.store)} | ${cell(row.path)} | ${cell(row.reason)} |`);
      }
      push('');
    }

    push("### Suparṇā's Post Office", '');
    push(`- **Letters delivered**: ${s.postOffice.letters}`);
    push(`- **Not yet announced**: ${s.postOffice.unannounced}`);
    push(`- **Characters with a mailbox**: ${s.postOffice.mailboxes}`, '');

    push('### Photographs', '');
    push(
      `- **In character vaults**: ${s.photos.characterVaultPhotos} (${formatBytes(s.photos.characterVaultBytes)})`,
    );
    push(
      `- **In your gallery**: ${s.photos.userGalleryPhotos} (${formatBytes(s.photos.userGalleryBytes)})`,
    );
    push('- *Counts and bytes only — never titles, captions or filenames.*', '');

    push('### Scenarios & State', '');
    if (s.scenarios.every(row => row.count === 0)) {
      push('*No scenarios*', '');
    } else {
      push('| Tier | Scenarios |');
      push('|------|-----------|');
      for (const row of s.scenarios) {
        push(`| ${cell(row.tier)} | ${row.count} |`);
      }
      push('');
    }
    push('State cascade coverage (chat → project → group → general):', '');
    push(`- **Chats carrying state**: ${s.stateCascade.chatsWithState}`);
    push(`- **Projects carrying state**: ${s.stateCascade.projectsWithState}`);
    push(`- **Groups carrying state**: ${s.stateCascade.groupsWithState}`);
    push(`- **General state present**: ${yesNo(s.stateCascade.generalStatePresent)}`, '');
  }

  // ==========================================================================
  // Phase 5 — Assembling the dramatis personae
  // ==========================================================================

  push('## Dramatis Personae', '');

  push('### Ten Busiest Characters', '');
  if (data.personae.topCharacters.length === 0) {
    push('*No characters*', '');
  } else {
    push('| Character | Chats | Memories | Vault Size |');
    push('|-----------|-------|----------|------------|');
    for (const row of data.personae.topCharacters) {
      push(
        `| ${cell(row.name)} | ${row.chats} | ${row.memories.toLocaleString()} | ${formatBytes(row.storageBytes)} |`,
      );
    }
    push('');
    push(
      `Ranked by chats, ties broken by memories. Help chats and Brahma Console sessions are excluded. ` +
        `Participants marked \`removed\` ${data.personae.countsRemovedParticipants ? 'still count' : 'are not counted'} ` +
        '— a character written out of a scene was still in it. Vault size is the store\'s cached total as of its ' +
        'last scan; because content is addressed by hash and hard-linkable across vaults, bytes shared between ' +
        'two characters appear in both rows.',
      '',
    );
  }

  push('### Projects', '');
  if (data.personae.projects.length === 0) {
    push('*No projects*', '');
  } else {
    push('| Project | Linked Stores | Chats | Files | Documents | State |');
    push('|---------|---------------|-------|-------|-----------|-------|');
    for (const row of data.personae.projects) {
      push(
        `| ${cell(row.name)} | ${row.linkedStores} | ${row.chats} | ${row.files} | ${row.documents} | ` +
          `${row.hasState ? '✓' : '—'} |`,
      );
    }
    push('');
  }

  push('### Groups', '');
  if (data.personae.groups.length === 0) {
    push('*No groups*', '');
  } else {
    push('| Group | Members | Linked Stores | Official Store |');
    push('|-------|---------|---------------|----------------|');
    for (const row of data.personae.groups) {
      push(
        `| ${cell(row.name)} | ${cell(row.members.join(', ') || '*none*')} | ${row.linkedStores} | ` +
          `${row.hasOfficialStore ? '✓' : '⚠ missing'} |`,
      );
    }
    push('');
    if (data.personae.groups.some(g => !g.hasOfficialStore)) {
      push(
        'A group without an official store never had one provisioned — its description, instructions,',
        'state and scenarios have nowhere to live.',
        '',
      );
    }
  }

  // ==========================================================================
  // Phase 6 — Reading the wire records
  // ==========================================================================

  push('## The Wire Records', '');
  push(
    `> These figures are drawn from the LLM logs. Logging is currently **${data.wireRecords.loggingEnabled ? 'on' : 'off'}**`,
    `> with a retention window of **${data.wireRecords.retentionDays === 0 ? 'forever' : `${data.wireRecords.retentionDays} days`}**.`,
    "> Enable LLM logging and lengthen the retention window (Settings → Chat → LLM Logging) and the Almanack's",
    '> arithmetic grows correspondingly richer.',
    '',
  );
  if (!data.wireRecords.exactProfileAttribution) {
    push(
      '> **Attribution is approximate.** This database predates the per-row profile columns, so requests are',
      '> grouped by provider and model. Two profiles sharing a provider and model appear as one line.',
      '',
    );
  }

  push('### Totals', '');
  push(`- **Log entries**: ${data.wireRecords.totalEntries.toLocaleString()}`);
  push(`- **Prompt tokens**: ${data.wireRecords.tokenUsage.promptTokens.toLocaleString()}`);
  push(`- **Completion tokens**: ${data.wireRecords.tokenUsage.completionTokens.toLocaleString()}`);
  push(`- **Total tokens**: ${data.wireRecords.tokenUsage.totalTokens.toLocaleString()}`);
  push(`- **Verbose mode**: ${yesNo(data.wireRecords.verboseMode)}`, '');

  push('### Requests by Type', '');
  if (data.wireRecords.byType.length === 0) {
    push('*No logged requests*', '');
  } else {
    push('| Type | Requests | Prompt | Completion | Total | Avg Latency | Measured | Errors |');
    push('|------|----------|--------|------------|-------|-------------|----------|--------|');
    for (const row of data.wireRecords.byType) {
      push(
        `| ${cell(row.type)} | ${row.requests.toLocaleString()} | ${row.promptTokens.toLocaleString()} | ` +
          `${row.completionTokens.toLocaleString()} | ${row.totalTokens.toLocaleString()} | ` +
          `${formatMs(row.avgDurationMs)} | ${row.measuredRequests}/${row.requests} | ${row.failures} |`,
      );
    }
    push('');
    push(
      '"Measured" is the denominator behind the average — requests carrying a usable `durationMs`.',
      'Rows written before the timing gaps were closed carry none and are excluded from the average.',
      '',
    );
  }

  push('### Connection Profiles — Lifetime Counters', '');
  if (data.wireRecords.connectionProfileLifetime.length === 0) {
    push('*No connection profiles*', '');
  } else {
    push('| Profile | Provider / Model | Messages | Prompt | Completion | Total | Last Touched |');
    push('|---------|------------------|----------|--------|------------|-------|--------------|');
    for (const row of data.wireRecords.connectionProfileLifetime) {
      push(
        `| ${cell(row.name)} | ${cell(`${row.provider} / ${row.modelName}`)} | ${row.messageCount.toLocaleString()} | ` +
          `${row.totalPromptTokens.toLocaleString()} | ${row.totalCompletionTokens.toLocaleString()} | ` +
          `${row.totalTokens.toLocaleString()} | ${formatDate(row.lastTouchedAt)} |`,
      );
    }
    push('');
    push(
      'These counters live on the profile rows and cover the profile\'s whole life, not the log retention',
      'window. There is no last-used column, so "Last Touched" is the row\'s `updatedAt` — a proxy.',
      '',
    );
  }

  const renderWindow = (heading: string, rows: ProfileWindowRow[], empty: string) => {
    push(`### ${heading}`, '');
    if (rows.length === 0) {
      push(`*${empty}*`, '');
      return;
    }
    push('| Profile | Provider / Model | Requests | Tokens | Avg | Median | Measured | Errors |');
    push('|---------|------------------|----------|--------|-----|--------|----------|--------|');
    for (const row of rows) {
      push(
        `| ${cell(row.label)} | ${cell(`${row.provider} / ${row.modelName}`)} | ${row.requests.toLocaleString()} | ` +
          `${row.totalTokens.toLocaleString()} | ${formatMs(row.avgDurationMs)} | ${formatMs(row.medianDurationMs)} | ` +
          `${row.measuredRequests}/${row.requests} | ${row.failures} |`,
      );
    }
    push('');
  };

  renderWindow(
    'Connection Profiles — Within the Retention Window',
    data.wireRecords.connectionProfileWindow,
    'No logged requests',
  );

  renderWindow(
    'Image Profiles — Within the Retention Window',
    data.wireRecords.imageProfileWindow,
    'No logged image generations',
  );
  if (data.wireRecords.imageProfileWindow.length > 0) {
    push(
      'A Concierge reroute logs a second row under the fallback profile, so a rerouted generation appears',
      'once under the profile that refused it and once under the profile that produced it. Naive totals',
      'therefore double-count rerouted work.',
      '',
    );
  }

  const renderCache = (heading: string, rows: CacheRow[], empty: string) => {
    push(`### ${heading}`, '');
    if (rows.length === 0) {
      push(`*${empty}*`, '');
      return;
    }
    push('| Key | Requests w/ Cache Data | Hits | Hit Rate | Cache Read | Cache Write | Uncached Prompt | Token Hit Rate |');
    push('|-----|------------------------|------|----------|------------|-------------|-----------------|----------------|');
    for (const row of rows) {
      push(
        `| ${cell(row.label)} | ${row.rowsWithCacheUsage.toLocaleString()} | ${row.rowsWithCacheRead.toLocaleString()} | ` +
          `${percent(row.requestHitRatio)} | ${row.cacheReadTokens.toLocaleString()} | ` +
          `${row.cacheCreationTokens.toLocaleString()} | ${row.uncachedPromptTokens.toLocaleString()} | ` +
          `${percent(row.tokenHitRatio)} |`,
      );
    }
    push('');
  };

  renderCache('Prompt Cache by Provider', data.wireRecords.cacheByProvider, 'No cache data recorded');
  renderCache('Prompt Cache by Profile', data.wireRecords.cacheByProfile, 'No per-profile cache data recorded');
  push(
    'Cache figures come from the `cacheUsage` payload, which in practice only chat messages carry — the',
    'streaming path is its sole writer. There is no "was this a hit" flag; a hit is a row reporting more',
    'than zero cache-read tokens. Provider plugins strip cache reads out of the reported prompt tokens, so',
    '"Uncached Prompt" and "Cache Read" together make the whole prompt.',
    '',
  );

  return lines.join('\n');
}
