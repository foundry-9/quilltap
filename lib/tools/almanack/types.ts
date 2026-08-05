/**
 * The Almanack — report data model.
 *
 * One interface per section, gathered into {@link AlmanackReportData}. The
 * renderer (`render.ts`) is a pure function of this object, which is what makes
 * the markdown snapshot test possible.
 *
 * @module lib/tools/almanack/types
 */

// ============================================================================
// Phase 1 — Taking the measure of the premises
// ============================================================================

export interface RuntimeEnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  osType: string;
  osRelease: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  runtimeType: 'docker' | 'lima' | 'electron' | 'node';
  electronShellVersion: string | null;
  shellCapabilities: string[];
  uptimeSeconds: number;
  dataDirectory: string;
  timezone: string;
}

/** One database's on-disk footprint. */
export interface DatabaseSizeInfo {
  label: string;
  sizeBytes: number;
  /** False when the file isn't there (fresh install, or the DB never opened). */
  present: boolean;
}

export interface DatabaseSecurityInfo {
  passphraseProtected: boolean;
  /** Main, LLM logs, and mount index — three rows since 4.9. */
  databases: DatabaseSizeInfo[];
  highestAppVersion: string | null;
}

export interface BackupInfo {
  label: string;
  count: number;
  newestDate: string | null;
  oldestDate: string | null;
  totalSizeBytes: number;
}

export interface MigrationStateInfo {
  appliedCount: number;
  lastMigrationId: string | null;
  lastMigrationAt: string | null;
  lastMigrationVersion: string | null;
}

// ============================================================================
// Phase 2 — Cataloguing the machinery
// ============================================================================

export interface PluginInfo {
  name: string;
  title: string;
  version: string;
  capabilities: string[];
  enabled: boolean;
  /** Installed from npm into the data dir, vs shipped in the app bundle. */
  installedFromNpm: boolean;
}

export interface PluginBreakdown {
  enabled: PluginInfo[];
  disabled: PluginInfo[];
  /** Count of plugins declaring each capability kind (provider / theme / tool / …). */
  byCapability: Array<{ capability: string; count: number }>;
  npmInstalled: number;
  bundled: number;
  pluginConfigRows: number;
  characterPluginDataRows: number;
}

export interface ProviderInfo {
  name: string;
  displayName: string;
  configured: boolean;
  capabilities: {
    chat: boolean;
    imageGeneration: boolean;
    embeddings: boolean;
    webSearch: boolean;
  };
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
}

export interface ModelInfo {
  provider: string;
  models: string[];
  error?: string;
}

/** Freshness of the `provider_models` discovery cache, per provider. */
export interface ProviderModelCacheRow {
  provider: string;
  total: number;
  chat: number;
  image: number;
  embedding: number;
  newestUpdatedAt: string | null;
}

export interface ApiKeyUsageRow {
  provider: string;
  total: number;
  active: number;
  neverUsed: number;
  lastUsed: string | null;
}

export interface ImageProviderInfo {
  provider: string;
  displayName: string;
  models: string[];
}

export interface EmbeddingProviderInfo {
  provider: string;
  displayName: string;
  models: string[];
}

export interface MCPServersInfo {
  configured: number;
  enabled: number;
  serverNames: string[];
  autoReconnect: boolean;
  maxReconnectAttempts: number;
}

export interface ThemeListItem {
  name: string;
  version: string;
  source: string;
  /** How many canonical icons this theme overrides. */
  iconOverrides: number;
  /** Overrides naming something that is not a canonical `IconName` — dead weight. */
  unknownIconOverrides: number;
}

export interface ThemeReportInfo {
  activeThemeId: string | null;
  colorMode: string;
  stats: { total: number; withDarkMode: number; withCssOverrides: number; errors: number };
  themes: ThemeListItem[];
  themesWithIcons: number;
  totalIconOverrides: number;
  totalUnknownIconOverrides: number;
}

// ============================================================================
// Phase 3 — Auditing the ledgers (main DB)
// ============================================================================

export interface EnhancedDatabaseStats {
  characters: number;
  favoriteCharacters: number;
  chats: number;
  memories: number;
  tags: number;
  projects: number;
  groups: number;
  connectionProfiles: {
    total: number;
    webSearchEnabled: number;
    toolUseEnabled: number;
    dangerousCompatible: number;
  };
  imageProfiles: number;
  embeddingProfiles: number;
  promptTemplates: { total: number; builtIn: number; custom: number };
  roleplayTemplates: { total: number; builtIn: number; custom: number };
}

export interface ChatBreakdownInfo {
  byType: Array<{ chatType: string; count: number }>;
  /** Participant-count histogram: how many chats have N participants. */
  participantHistogram: Array<{ participants: number; chats: number }>;
  pausedChats: number;
  documentModeChats: number;
  chatDocumentRows: number;
  multiDocumentChats: number;
  chatsWithEquippedOutfit: number;
  pendingOutfitNotificationChats: number;
  narrativeTimelineChats: number;
  chatsWithNonEmptyState: number;
}

export interface AutonomousRoomInfo {
  total: number;
  byRunState: Array<{ runState: string; count: number }>;
  scheduled: number;
  overdue: number;
  withTurnBudget: number;
  withTokenBudget: number;
  withWallClockBudget: number;
  withSpendCap: number;
  destructiveToolsAllowed: number;
  byVisibility: Array<{ visibility: string; count: number }>;
}

export interface MemoryBreakdownInfo {
  total: number;
  byKind: Array<{ kind: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
  byWitnessedContext: Array<{ witnessedContext: string; count: number }>;
  withOccurredAt: number;
  withNarrativeTime: number;
  withEntities: number;
  withEmbedding: number;
  reinforcedTotal: number;
  maxReinforcementCount: number;
  charactersWithMemories: number;
}

export interface CharacterBreakdownInfo {
  total: number;
  vaultLinked: number;
  vaultless: number;
  npcs: number;
  userControlled: number;
  carinaAnswerers: number;
  systemTransparent: number;
  canDressThemselves: number;
  canCreateOutfits: number;
  coreWhisperOverrides: number;
}

/** The feature dials, as configured. */
export interface FeatureConfigInfo {
  dangerousContent: {
    mode: string;
    threshold: number;
    scanTextChat: boolean;
    scanImagePrompts: boolean;
    scanImageGeneration: boolean;
  };
  contextCompression: { enabled: boolean; windowSize: number; compressionTargetTokens: number };
  agentMode: { maxTurns: number; defaultEnabled: boolean };
  storyBackgrounds: { enabled: boolean; hasDefaultImageProfile: boolean };
  timestamps: { mode: string; format: string };
  autoLock: { enabled: boolean; idleMinutes: number };
  memoryCascade: { onMessageDelete: string; onSwipeRegenerate: string };
  autoDetectRng: boolean;
  customTools: boolean;
  avatarDisplay: { mode: string; style: string };
  coreWhisper: {
    enabled: boolean;
    interval: number;
    silenceThreshold: number;
    packetTokenBudget: number;
    fireOnContextTransition: boolean;
  };
  thinkingDisplay: { defaultVisible: boolean; defaultCollapsed: boolean };
  answerConfirmation: { enabled: boolean };
  autonomousRoomDefaults: Record<string, unknown>;
  autoHousekeeping: {
    enabled: boolean;
    perCharacterCap: number;
    mergeSimilar: boolean;
    autoMergeSimilarThreshold: number;
  };
  textReplacements: { enabled: boolean; rules: number; enabledRules: number };
  composerSpellcheck: boolean;
  autoScrollOnResponseComplete: boolean;
  imageDescriptionProfileConfigured: boolean;
  uncensoredImageDescriptionProfileConfigured: boolean;
}

export interface InstanceSettingsInfo {
  staleChatDays: number;
  chatsEligibleForNextSweep: number;
  maxConcurrentJobs: number;
  memoryRecall: { scopePolicy: string; expandRelated: boolean };
  memoryExtractionLimits: {
    enabled: boolean;
    maxPerHour: number;
    softStartFraction: number;
    softFloor: number;
  };
  lastMaintenanceSweepAt: string | null;
}

export interface BackgroundJobInfo {
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  failed: Array<{ type: string; count: number; lastError: string | null }>;
  attemptsExhausted: number;
  oldestPendingScheduledAt: string | null;
}

export interface EmbeddingPipelineInfo {
  statusByEntityType: Array<{
    entityType: string;
    status: string;
    count: number;
  }>;
  permanentlyFailed: number;
  conversationChunks: { total: number; unembedded: number };
  helpDocs: { total: number; unembedded: number };
  /** Distinct stored vector widths, decoded from the self-describing BLOB header. */
  storedDimensions: Array<{ table: string; dimensions: number; vectors: number }>;
  activeProfileDimensions: number | null;
  dimensionMismatch: boolean;
}

export interface TerminalInfo {
  totalSessions: number;
  liveSessions: number;
  nonZeroExits: number;
  distinctShells: string[];
}

export interface FolderStats {
  path: string;
  fileCount: number;
  totalSize: number;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  folders: FolderStats[];
  notOkFiles: number;
  generatedImagesByModel: Array<{ generationModel: string; count: number; bytes: number }>;
}

export interface ChatStatsInfo {
  totalEstimatedCostUSD: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalMessages: number;
  agentModeChats: number;
  dangerousChats: number;
}

// ============================================================================
// Phase 4 — Touring the Scriptorium (mount index DB)
// ============================================================================

export interface MountPointSummaryRow {
  mountType: string;
  storeType: string;
  count: number;
  enabled: number;
  fileCount: number;
  chunkCount: number;
  totalSizeBytes: number;
}

export interface WellKnownMountInfo {
  label: string;
  settingKey: string;
  mountPointId: string | null;
  name: string | null;
  resolved: boolean;
}

export interface ScriptoriumInfo {
  available: boolean;
  mountPoints: {
    total: number;
    enabled: number;
    byKind: MountPointSummaryRow[];
    scanErrors: number;
    conversionErrors: number;
    scanStatuses: Array<{ status: string; count: number }>;
    conversionStatuses: Array<{ status: string; count: number }>;
    wellKnown: WellKnownMountInfo[];
  };
  content: {
    fileRows: number;
    linkRows: number;
    documentRows: number;
    documentTextBytes: number;
    blobRows: number;
    blobBytes: number;
    blobsByMimeType: Array<{ storedMimeType: string; count: number; bytes: number }>;
    chunkRows: number;
    unembeddedChunks: number;
    chunkTokens: number;
  };
  links: {
    /** links ÷ files — how much the content-addressed store is deduping. */
    dedupRatio: number;
    hardLinkGroups: number;
    hardLinkedLinks: number;
    extractionErrors: number;
    conversionErrors: number;
    policyEmbedDenied: number;
    policyCharacterReadDenied: number;
    policyCharacterWriteDenied: number;
  };
  characterVaults: {
    total: number;
    withKeystone: number;
    missingKeystone: number;
    withMetadata: number;
  };
  wardrobe: Array<{ tier: string; items: number; archived: number }>;
  customTools: {
    total: number;
    byStore: Array<{ store: string; count: number }>;
    withPresets: number;
    presetFiles: number;
    withLlmConsult: number;
    withEffects: number;
    metadataGated: number;
    parseFailures: number;
    parseFailureDetail: Array<{ store: string; path: string; reason: string }>;
  };
  postOffice: {
    letters: number;
    unannounced: number;
    mailboxes: number;
  };
  photos: {
    characterVaultPhotos: number;
    characterVaultBytes: number;
    userGalleryPhotos: number;
    userGalleryBytes: number;
  };
  scenarios: Array<{ tier: string; count: number }>;
  stateCascade: {
    chatsWithState: number;
    projectsWithState: number;
    groupsWithState: number;
    generalStatePresent: boolean;
  };
}

// ============================================================================
// Phase 5 — Assembling the dramatis personae
// ============================================================================

export interface TopCharacterRow {
  name: string;
  chats: number;
  memories: number;
  /** Vault size as of that store's last scan; content-addressed bytes may be shared. */
  storageBytes: number;
}

export interface ProjectRow {
  name: string;
  linkedStores: number;
  chats: number;
  files: number;
  documents: number;
  hasState: boolean;
}

export interface GroupRow {
  name: string;
  members: string[];
  linkedStores: number;
  hasOfficialStore: boolean;
}

export interface PersonaeInfo {
  topCharacters: TopCharacterRow[];
  /** Whether participants with `status: 'removed'` were counted (see §9.1). */
  countsRemovedParticipants: boolean;
  projects: ProjectRow[];
  groups: GroupRow[];
}

// ============================================================================
// Phase 6 — Reading the wire records (llm-logs DB)
// ============================================================================

export interface WireTypeRow {
  type: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  measuredRequests: number;
  avgDurationMs: number | null;
  failures: number;
}

export interface ProfileLifetimeRow {
  id: string;
  name: string;
  provider: string;
  modelName: string;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  messageCount: number;
  /** `updatedAt` — the closest thing to a last-used stamp the table carries. */
  lastTouchedAt: string | null;
}

export interface ProfileWindowRow {
  label: string;
  provider: string;
  modelName: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  measuredRequests: number;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  failures: number;
}

export interface CacheRow {
  label: string;
  rowsWithCacheUsage: number;
  rowsWithCacheRead: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  uncachedPromptTokens: number;
  requestHitRatio: number;
  tokenHitRatio: number;
}

export interface WireRecordsInfo {
  totalEntries: number;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  loggingEnabled: boolean;
  verboseMode: boolean;
  retentionDays: number;
  /** False when the 4.9 attribution columns aren't present, so joins are approximate. */
  exactProfileAttribution: boolean;
  byType: WireTypeRow[];
  connectionProfileLifetime: ProfileLifetimeRow[];
  connectionProfileWindow: ProfileWindowRow[];
  imageProfileWindow: ProfileWindowRow[];
  cacheByProvider: CacheRow[];
  cacheByProfile: CacheRow[];
}

// ============================================================================
// Cost configuration (the designated background workers)
// ============================================================================

export interface DesignatedProfileInfo {
  provider?: string;
  model?: string;
  profileName?: string;
}

// ============================================================================
// The whole volume
// ============================================================================

export interface AlmanackReportData {
  version: string;
  nodeEnv: string;
  generatedAt: string;

  // Phase 1
  runtimeEnvironment: RuntimeEnvironmentInfo;
  databaseSecurity: DatabaseSecurityInfo;
  backupStatus: BackupInfo[];
  migrationState: MigrationStateInfo;

  // Phase 2
  plugins: PluginBreakdown;
  apiKeyTypes: string[];
  providers: ProviderInfo[];
  modelsByProvider: ModelInfo[];
  providerModelCache: ProviderModelCacheRow[];
  apiKeyUsage: ApiKeyUsageRow[];
  cheapLLM: DesignatedProfileInfo;
  imagePromptLLM: DesignatedProfileInfo;
  embeddingProvider: DesignatedProfileInfo;
  imageProviders: ImageProviderInfo[];
  embeddingProviders: EmbeddingProviderInfo[];
  mcpServers: MCPServersInfo;
  themeInfo: ThemeReportInfo;

  // Phase 3
  databaseStats: EnhancedDatabaseStats;
  chatStats: ChatStatsInfo;
  chatBreakdown: ChatBreakdownInfo;
  autonomousRooms: AutonomousRoomInfo;
  memoryBreakdown: MemoryBreakdownInfo;
  characterBreakdown: CharacterBreakdownInfo;
  featureConfig: FeatureConfigInfo;
  instanceSettings: InstanceSettingsInfo;
  backgroundJobs: BackgroundJobInfo;
  embeddingPipeline: EmbeddingPipelineInfo;
  terminal: TerminalInfo;
  storageStats: StorageStats;

  // Phase 4
  scriptorium: ScriptoriumInfo;

  // Phase 5
  personae: PersonaeInfo;

  // Phase 6
  wireRecords: WireRecordsInfo;
}
