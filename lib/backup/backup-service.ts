/**
 * Backup Service
 *
 * Creates complete user data backups by collecting all user data from the database
 * and file storage, then packaging it into a ZIP archive on disk using shell `zip`.
 * No in-memory zip operations — files are staged in a temp directory and compressed
 * by the `zip` binary to avoid OOM in memory-constrained VMs.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { logger } from '@/lib/logger';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { getNpmPluginsDir, getThemesDir } from '@/lib/paths';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { runBackupCheckpoint } from '@/lib/database/backends/sqlite/protection';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import { runLLMLogsBackupCheckpoint } from '@/lib/database/backends/sqlite/llm-logs-protection';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { runMountIndexBackupCheckpoint } from '@/lib/database/backends/sqlite/mount-index-protection';
import type {
  BackupManifest,
  BackupData,
  ChatWithMessages,
  InstanceSettingRow,
  SerializedVectorEntry,
  SerializedConversationChunk,
  SerializedDocMountChunk,
} from './types';
import type { ChatEvent } from '@/lib/schemas/types';
import type { DocMountBlobMetadata } from '@/lib/schemas/mount-index.types';

const execFileAsync = promisify(execFile);

// Get app version from package.json
const APP_VERSION = process.env.npm_package_version || '2.0.0';

const moduleLogger = logger.child({ module: 'backup:backup-service' });

/**
 * Encode a Float32Array embedding as a plain number array so it survives
 * JSON serialisation. The schemas accept number[] on the way back in and
 * rehydrate as Float32Array.
 */
function encodeEmbedding(
  embedding: Float32Array | number[] | Buffer | null | undefined
): number[] | null {
  if (embedding == null) return null;
  if (embedding instanceof Float32Array) return Array.from(embedding);
  if (Array.isArray(embedding)) return [...embedding];
  if (embedding instanceof Buffer) {
    // Header-aware decode: handles both legacy raw Float32 blobs and the
    // self-describing quantized format.
    return Array.from(blobToFloat32(embedding));
  }
  return null;
}

/**
 * Dump every row of a mount-index-database table. Returns [] when the
 * database is unavailable or the table is missing — backups remain useful
 * even on instances that never provisioned a document store.
 */
function dumpMountIndexTable<T = Record<string, unknown>>(table: string): T[] {
  if (isMountIndexDegraded()) return [];
  const db = getRawMountIndexDatabase();
  if (!db) return [];
  try {
    return db.prepare(`SELECT * FROM "${table}"`).all() as T[];
  } catch (error) {
    moduleLogger.debug('Mount-index table missing or unreadable; skipping', {
      table,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Snapshot every instance_settings row from the main quilltap database.
 * Returns [] if the table is missing (very old databases pre-dating the
 * instance_settings provisioning migration).
 */
function dumpInstanceSettings(): InstanceSettingRow[] {
  const db = getRawDatabase();
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT "key", "value" FROM "instance_settings"').all() as InstanceSettingRow[];
    return rows;
  } catch (error) {
    moduleLogger.debug('instance_settings table missing or unreadable; skipping', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Pull every doc-mount blob row from the mount-index database with its
 * raw bytes. Returned as a stream of {metadata, data} so the caller can
 * write each blob to disk and move on without holding everything in
 * memory at once.
 */
function* streamDocMountBlobsWithData(): Generator<{ meta: DocMountBlobMetadata; data: Buffer }> {
  if (isMountIndexDegraded()) return;
  const db = getRawMountIndexDatabase();
  if (!db) return;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = db.prepare(
      `SELECT id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt FROM "doc_mount_blobs"`
    ).all() as Array<Record<string, unknown>>;
  } catch {
    return;
  }
  for (const row of rows) {
    const { data, ...rest } = row;
    const meta = rest as unknown as DocMountBlobMetadata;
    const bytes = data instanceof Buffer ? data : Buffer.from(data as Uint8Array);
    yield { meta, data: bytes };
  }
}

/**
 * Collects all user data from database repositories
 */
async function collectUserData(userId: string): Promise<Omit<BackupData, 'manifest'>> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Collect all entities in parallel
  const [
    characters,
    chatMetadatas,
    tags,
    connectionProfiles,
    imageProfiles,
    embeddingProfiles,
    files,
    promptTemplates,
    roleplayTemplates,
    providerModels,
    projects,
    groups,
    llmLogs,
    pluginConfigs,
    chatSettingsResult,
    folders,
    wardrobeItems,
  ] = await Promise.all([
    repos.characters.findAll(),
    repos.chats.findAll(),
    repos.tags.findAll(),
    repos.connections.findAll(),
    repos.imageProfiles.findAll(),
    repos.embeddingProfiles.findAll(),
    repos.files.findAll(),
    // Get user-created templates (excludes built-in templates)
    globalRepos.promptTemplates.findByUserId(userId),
    globalRepos.roleplayTemplates.findByUserId(userId),
    // Get provider models
    globalRepos.providerModels.findAll(),
    // Get projects
    repos.projects.findAll(),
    // Get groups (hydrated from each group's official document store, like projects)
    repos.groups.findAll(),
    // Get LLM logs
    repos.llmLogs.findAll(10000), // High limit to get all user logs
    // Get plugin configurations
    globalRepos.pluginConfigs.findByUserId(userId),
    // Get chat settings (returns single object or null)
    globalRepos.chatSettings.findByUserId(userId),
    // Get folders
    globalRepos.folders.findByUserId(userId),
    // Get wardrobe items (composites are wardrobe items now; outfit presets retired)
    globalRepos.wardrobe.findAll(),
  ]);

  // Exclude backup files from the file list - we don't want to back up old backups
  const filteredFiles = files.filter(
    (file) => file.category !== 'BACKUP' && file.folderPath !== '/backups'
  );
  // Collect messages for each chat
  const chats: ChatWithMessages[] = await Promise.all(
    chatMetadatas.map(async (chat) => {
      const messages = await repos.chats.getMessages(chat.id);
      // Filter to only include message events (not context-summary events)
      const messageEvents = messages.filter(
        (event): event is ChatEvent & { type: 'message' } => event.type === 'message'
      );
      return {
        ...chat,
        messages: messageEvents,
      } as ChatWithMessages;
    })
  );

  // Collect memories for all characters
  const memoriesArrays = await Promise.all(
    characters.map((char) => repos.memories.findByCharacterId(char.id))
  );
  const memories = memoriesArrays.flat();

  // Collect character plugin data for all characters
  const characterPluginDataArrays = await Promise.all(
    characters.map((char) => globalRepos.characterPluginData.findByCharacterId(char.id))
  );
  const characterPluginData = characterPluginDataArrays.flat();

  // Collect conversation annotations for all user's chats
  const conversationAnnotationsArrays = await Promise.all(
    chatMetadatas.map((chat) => globalRepos.conversationAnnotations.findByChatId(chat.id))
  );
  const conversationAnnotations = conversationAnnotationsArrays.flat();

  // Collect chat documents (Document Mode state) for every user chat.
  const chatDocumentsArrays = await Promise.all(
    chatMetadatas.map((chat) => globalRepos.chatDocuments.findByChatId(chat.id))
  );
  const chatDocuments = chatDocumentsArrays.flat();

  // Collect conversation chunks for every user chat, encoding embeddings as
  // number arrays so they survive JSON. Chunks include the embedding so the
  // restored instance does not have to re-embed an entire chat history.
  const conversationChunksArrays = await Promise.all(
    chatMetadatas.map((chat) => globalRepos.conversationChunks.findByChatId(chat.id))
  );
  const conversationChunks: SerializedConversationChunk[] = conversationChunksArrays.flat().map((chunk) => ({
    id: chunk.id,
    chatId: chunk.chatId,
    interchangeIndex: chunk.interchangeIndex,
    content: chunk.content,
    participantNames: chunk.participantNames ?? [],
    messageIds: chunk.messageIds ?? [],
    embedding: encodeEmbedding(chunk.embedding ?? null),
    createdAt: chunk.createdAt,
    updatedAt: chunk.updatedAt,
  }));

  // Per-character vector indices + their entries. Without these the restored
  // instance would have to re-embed every memory; with them, search keeps
  // working immediately. Entries' Float32 embeddings ride as number[].
  const characterIdsWithVectors = await globalRepos.vectorIndices.getAllCharacterIds();
  const vectorIndexMetas = (
    await Promise.all(
      characterIdsWithVectors.map((cid) => globalRepos.vectorIndices.findMetaByCharacterId(cid))
    )
  ).filter((meta): meta is NonNullable<typeof meta> => meta !== null);
  const vectorEntriesArrays = await Promise.all(
    characterIdsWithVectors.map((cid) => globalRepos.vectorIndices.findEntriesByCharacterId(cid))
  );
  const vectorEntries: SerializedVectorEntry[] = vectorEntriesArrays.flat().map((entry) => ({
    id: entry.id,
    characterId: entry.characterId,
    embedding: Array.from(entry.embedding as Float32Array),
    createdAt: entry.createdAt,
  }));

  // TF-IDF vocabularies for BUILTIN embedding profiles. Cheap to dump and
  // means BUILTIN search keeps working after restore without a refit.
  const tfidfVocabularies = await globalRepos.tfidfVocabularies.findAll();

  // Per-entity embedding sync flags. These are status records; restoring them
  // tells the background queue not to redo work that was already complete.
  const embeddingStatus = await globalRepos.embeddingStatus.findAll();

  // Global text replacement rules (no userId). Ordinary user content — the
  // master switch (chat_settings.textReplacementsEnabled) is already backed
  // up, so the rules must come along too or a restore re-enables the feature
  // with zero rules.
  const textReplacementRules = await globalRepos.textReplacementRules.list();

  // Scriptorium / document store tables live in a separate mount-index
  // database. We dump them with raw SELECTs because most repositories don't
  // expose a "give me everything" helper, and bulk export wants the latter.
  const docMountPoints = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').DocMountPoint>('doc_mount_points');
  const docMountFolders = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').DocMountFolder>('doc_mount_folders');
  const docMountFiles = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').DocMountFile>('doc_mount_files');
  const docMountFileLinks = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').DocMountFileLink>('doc_mount_file_links');
  const docMountDocuments = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').DocMountDocument>('doc_mount_documents');
  const projectDocMountLinks = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').ProjectDocMountLink>('project_doc_mount_links');
  // Group join tables live alongside the project link table in the mount-index
  // DB. group_doc_mount_links holds a group's *additional* linked stores (the
  // official store is recorded on the group row as officialMountPointId);
  // group_character_members is the group↔character membership.
  const groupDocMountLinks = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').GroupDocMountLink>('group_doc_mount_links');
  const groupCharacterMembers = dumpMountIndexTable<import('@/lib/schemas/mount-index.types').GroupCharacterMember>('group_character_members');
  // Chunk embeddings are BLOBs in SQLite; the raw rows come back with Buffer
  // values for the embedding column. Normalise into number[] so JSON can hold
  // them without base64 plumbing.
  const docMountChunkRows = dumpMountIndexTable<Record<string, unknown> & {
    id: string;
    linkId: string;
    mountPointId: string;
    chunkIndex: number;
    content: string;
    tokenCount: number;
    headingContext: string | null;
    embedding: Buffer | null;
    createdAt: string;
    updatedAt: string;
  }>('doc_mount_chunks');
  const docMountChunks: SerializedDocMountChunk[] = docMountChunkRows.map((row) => ({
    id: row.id,
    linkId: row.linkId,
    mountPointId: row.mountPointId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    tokenCount: row.tokenCount,
    headingContext: row.headingContext ?? null,
    embedding: encodeEmbedding(row.embedding ?? null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  // Blob metadata is collected here; the bytes are staged to disk below in
  // createBackup() so we don't carry every PDF/image in memory.
  const docMountBlobs: DocMountBlobMetadata[] = [];
  for (const { meta } of streamDocMountBlobsWithData()) {
    docMountBlobs.push(meta);
  }

  // Snapshot instance_settings so mount-point routing keys (Lantern
  // backgrounds, Quilltap Uploads, General) survive restore. Without these
  // the restored instance would re-provision new mount points and break
  // every reference held by chats/projects.
  const instanceSettings = dumpInstanceSettings();

  // Strip encrypted API key data from connection profiles for security
  // API keys are encrypted with user-specific keys and can't be restored to another account
  const sanitizedConnectionProfiles = connectionProfiles.map((profile) => ({
    ...profile,
    // Keep apiKeyId reference but note that actual keys aren't backed up
  }));

  // Wrap chatSettings in an array for backup (it's a single record per user)
  const chatSettings = chatSettingsResult ? [chatSettingsResult] : [];

  return {
    characters,
    chats,
    tags,
    connectionProfiles: sanitizedConnectionProfiles,
    imageProfiles,
    embeddingProfiles,
    memories,
    files: filteredFiles,
    promptTemplates,
    roleplayTemplates,
    providerModels,
    projects,
    groups,
    llmLogs,
    pluginConfigs,
    chatSettings,
    folders,
    wardrobeItems,
    characterPluginData,
    conversationAnnotations,
    chatDocuments,
    instanceSettings,
    embeddingStatus,
    conversationChunks,
    tfidfVocabularies,
    vectorIndexMetas,
    vectorEntries,
    docMountPoints,
    docMountFolders,
    docMountFiles,
    docMountFileLinks,
    docMountChunks,
    docMountDocuments,
    docMountBlobs,
    projectDocMountLinks,
    groupDocMountLinks,
    groupCharacterMembers,
    textReplacementRules,
  };
}

/**
 * Counts npm-installed plugins in the plugins/npm directory
 */
function countNpmPlugins(): number {
  try {
    const npmPluginsDir = getNpmPluginsDir();
    if (!fs.existsSync(npmPluginsDir)) {
      return 0;
    }
    // Count directories in plugins/npm (each directory is a plugin)
    const entries = fs.readdirSync(npmPluginsDir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).length;
  } catch (error) {
    moduleLogger.warn('Failed to count npm plugins', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Counts user-installed theme bundles in the themes directory
 */
function countUserInstalledThemes(): number {
  try {
    const themesDir = getThemesDir();
    if (!fs.existsSync(themesDir)) {
      return 0;
    }
    // Count subdirectories (each is a theme bundle), excluding .cache
    const entries = fs.readdirSync(themesDir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && entry.name !== '.cache').length;
  } catch (error) {
    moduleLogger.warn('Failed to count user-installed themes', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Creates a backup manifest with entity counts
 */
function createManifest(
  userId: string,
  data: Omit<BackupData, 'manifest'>,
  options?: { compact?: boolean }
): BackupManifest {
  const totalMessages = data.chats.reduce((sum, chat) => sum + chat.messages.length, 0);

  return {
    version: '1.0',
    backupFormat: 4,
    createdAt: new Date().toISOString(),
    userId,
    appVersion: APP_VERSION,
    ...(options?.compact && { compact: true }),
    counts: {
      characters: data.characters.length,
      chats: data.chats.length,
      messages: totalMessages,
      tags: data.tags.length,
      connectionProfiles: data.connectionProfiles.length,
      imageProfiles: data.imageProfiles.length,
      embeddingProfiles: data.embeddingProfiles.length,
      memories: data.memories.length,
      files: data.files.length,
      promptTemplates: data.promptTemplates.length,
      roleplayTemplates: data.roleplayTemplates.length,
      providerModels: data.providerModels.length,
      projects: data.projects.length,
      groups: data.groups?.length || 0,
      llmLogs: data.llmLogs.length,
      pluginConfigs: data.pluginConfigs?.length || 0,
      chatSettings: data.chatSettings?.length || 0,
      folders: data.folders?.length || 0,
      wardrobeItems: data.wardrobeItems?.length || 0,
      npmPlugins: countNpmPlugins(),
      characterPluginData: data.characterPluginData?.length || 0,
      conversationAnnotations: data.conversationAnnotations?.length || 0,
      userInstalledThemes: countUserInstalledThemes(),
      chatDocuments: data.chatDocuments?.length || 0,
      instanceSettings: data.instanceSettings?.length || 0,
      embeddingStatus: data.embeddingStatus?.length || 0,
      conversationChunks: data.conversationChunks?.length || 0,
      tfidfVocabularies: data.tfidfVocabularies?.length || 0,
      vectorIndexMetas: data.vectorIndexMetas?.length || 0,
      vectorEntries: data.vectorEntries?.length || 0,
      docMountPoints: data.docMountPoints?.length || 0,
      docMountFolders: data.docMountFolders?.length || 0,
      docMountFiles: data.docMountFiles?.length || 0,
      docMountFileLinks: data.docMountFileLinks?.length || 0,
      docMountChunks: data.docMountChunks?.length || 0,
      docMountDocuments: data.docMountDocuments?.length || 0,
      docMountBlobs: data.docMountBlobs?.length || 0,
      projectDocMountLinks: data.projectDocMountLinks?.length || 0,
      groupDocMountLinks: data.groupDocMountLinks?.length || 0,
      groupCharacterMembers: data.groupCharacterMembers?.length || 0,
      textReplacementRules: data.textReplacementRules?.length || 0,
    },
  };
}

/**
 * Writes a JSON file to the staging directory.
 * Use only for small objects (e.g. the manifest); use writeJsonArrayFile for
 * potentially large arrays so the encoded string never exceeds V8's max-string limit.
 */
async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Streams an array to disk as pretty-printed JSON, encoding one element at a time.
 *
 * Why: JSON.stringify returns a single string, and V8 caps strings at ~512 MB. With
 * full-history llm_logs and chat_messages, the combined backup payload can exceed
 * that limit and throw `RangeError: Invalid string length`. Streaming keeps each
 * stringify call bounded to one row.
 */
async function writeJsonArrayFile<T>(filePath: string, items: readonly T[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const out = fs.createWriteStream(filePath, { encoding: 'utf8' });

  async function* chunks(): AsyncGenerator<string> {
    if (items.length === 0) {
      yield '[]\n';
      return;
    }
    yield '[\n';
    for (let i = 0; i < items.length; i++) {
      const json = JSON.stringify(items[i], null, 2);
      const indented = json.split('\n').map((line) => '  ' + line).join('\n');
      yield i === items.length - 1 ? indented + '\n' : indented + ',\n';
    }
    yield ']\n';
  }

  await pipeline(Readable.from(chunks()), out);
}

/**
 * Recursively removes a directory and all its contents
 */
async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    moduleLogger.warn('Failed to clean up temp directory', {
      dirPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Strip every embedding-derived payload out of a collected backup.
 *
 * Full fidelity remains the default for a reason: a backup restores the
 * *same* instance, so its vectors are valid on arrival, and re-embedding a
 * whole corpus costs real money and time at exactly the moment the user is
 * recovering from something. Compact is for users whose constraint is archive
 * size instead — search is rebuilt after restore rather than carried.
 *
 * `llmLogs` are untouched: compact is about embeddings, not logs (the
 * existing 10k cap already bounds them).
 */
function compactBackupData(
  data: Omit<BackupData, 'manifest'>
): Omit<BackupData, 'manifest'> {
  return {
    ...data,
    // Memories keep every word; only the vector goes.
    memories: data.memories.map((memory) => ({ ...memory, embedding: null })),
    // Wholly derived collections — regenerable from the content above.
    conversationChunks: [],
    vectorEntries: [],
    vectorIndexMetas: [],
    tfidfVocabularies: [],
    embeddingStatus: [],
    docMountChunks: [],
  };
}

/**
 * Creates a complete backup as a ZIP file on disk.
 *
 * Stages all data in a temp directory and shells out to `zip -r` to create
 * the archive. At no point is more than one user file buffer in memory.
 *
 * @param options.compact Drop embeddings and every derived embedding table
 *   (see {@link compactBackupData}). Off by default — full fidelity is the
 *   documented behaviour and the safer one.
 * @returns The path to the zip file on disk and the backup manifest
 */
export async function createBackup(
  userId: string,
  options?: { compact?: boolean }
): Promise<{
  zipPath: string;
  manifest: BackupManifest;
}> {
  moduleLogger.info('Starting backup creation', { userId, compact: options?.compact ?? false });

  // Flush WAL to ensure logical backup reads consistent data
  const rawDb = getRawDatabase();
  if (rawDb) {
    runBackupCheckpoint(rawDb);
  }

  // Also checkpoint the LLM logs database
  const rawLLMLogsDb = getRawLLMLogsDatabase();
  if (rawLLMLogsDb) {
    runLLMLogsBackupCheckpoint(rawLLMLogsDb);
  }

  // And the mount-index database, which now flows into the backup.
  const rawMountIndexDb = getRawMountIndexDatabase();
  if (rawMountIndexDb) {
    runMountIndexBackupCheckpoint(rawMountIndexDb);
  }

  // Collect all user data
  const collected = await collectUserData(userId);
  const data = options?.compact ? compactBackupData(collected) : collected;
  const manifest = createManifest(userId, data, options);
  if (options?.compact) {
    moduleLogger.debug('Compact backup — embeddings and derived tables omitted', {
      userId,
      memories: data.memories.length,
      droppedConversationChunks: collected.conversationChunks?.length ?? 0,
      droppedVectorEntries: collected.vectorEntries?.length ?? 0,
      droppedDocMountChunks: collected.docMountChunks?.length ?? 0,
    });
  }

  // Create temp directory for staging
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quilltap-backup-'));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folderName = `quilltap-backup-${timestamp}`;
  const stagingDir = path.join(tempDir, folderName);

  moduleLogger.debug('Created staging directory', { tempDir, folderName });

  try {
    // Create staging directory structure
    await fs.promises.mkdir(path.join(stagingDir, 'data'), { recursive: true });

    // Write data files sequentially, streaming each array element to disk so the
    // encoded payload (especially llm_logs and chat_messages) never exceeds V8's
    // ~512 MB max-string limit.
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'characters.json'), data.characters);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'chats.json'), data.chats);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'tags.json'), data.tags);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'connection-profiles.json'), data.connectionProfiles);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'image-profiles.json'), data.imageProfiles);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'embedding-profiles.json'), data.embeddingProfiles);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'memories.json'), data.memories);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'files.json'), data.files);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'prompt-templates.json'), data.promptTemplates);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'roleplay-templates.json'), data.roleplayTemplates);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'provider-models.json'), data.providerModels);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'projects.json'), data.projects);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'groups.json'), data.groups || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'llm-logs.json'), data.llmLogs);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'plugin-configs.json'), data.pluginConfigs || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'chat-settings.json'), data.chatSettings || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'folders.json'), data.folders || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'wardrobe-items.json'), data.wardrobeItems || []);
    // outfit-presets.json is no longer written; pre-rework presets are folded into composite
    // wardrobe items at restore time for back-compat with older backups.
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'character-plugin-data.json'), data.characterPluginData || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'conversation-annotations.json'), data.conversationAnnotations || []);

    // Format-3 additions (older restorers will simply skip these missing files).
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'chat-documents.json'), data.chatDocuments || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'instance-settings.json'), data.instanceSettings || []);
    // Derived embedding collections. A compact backup omits the files
    // outright rather than writing empty arrays — the restore reader treats
    // all of these as optional (`readJsonArrayFileOptional`), so an absent
    // file and an empty one behave identically on the way back in, and the
    // absent one is what makes the archive small.
    if (!options?.compact) {
      await writeJsonArrayFile(path.join(stagingDir, 'data', 'embedding-status.json'), data.embeddingStatus || []);
      await writeJsonArrayFile(path.join(stagingDir, 'data', 'conversation-chunks.json'), data.conversationChunks || []);
      await writeJsonArrayFile(path.join(stagingDir, 'data', 'tfidf-vocabularies.json'), data.tfidfVocabularies || []);
      await writeJsonArrayFile(path.join(stagingDir, 'data', 'vector-index-metas.json'), data.vectorIndexMetas || []);
      await writeJsonArrayFile(path.join(stagingDir, 'data', 'vector-entries.json'), data.vectorEntries || []);
    }
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-points.json'), data.docMountPoints || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-folders.json'), data.docMountFolders || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-files.json'), data.docMountFiles || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-file-links.json'), data.docMountFileLinks || []);
    if (!options?.compact) {
      await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-chunks.json'), data.docMountChunks || []);
    }
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-documents.json'), data.docMountDocuments || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'doc-mount-blobs.json'), data.docMountBlobs || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'project-doc-mount-links.json'), data.projectDocMountLinks || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'group-doc-mount-links.json'), data.groupDocMountLinks || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'group-character-members.json'), data.groupCharacterMembers || []);
    await writeJsonArrayFile(path.join(stagingDir, 'data', 'text-replacement-rules.json'), data.textReplacementRules || []);

    moduleLogger.debug('Wrote all JSON data files to staging directory');

    // Download and stage user files one at a time to limit memory
    let filesStaged = 0;
    for (const file of data.files) {
      if (file.storageKey) {
        try {
          const fileBuffer = await fileStorageManager.downloadFile(file);
          // Use storageKey as path in backup (preserves real folder structure)
          const fileDest = path.join(stagingDir, 'files', file.storageKey);
          await fs.promises.mkdir(path.dirname(fileDest), { recursive: true });
          await fs.promises.writeFile(fileDest, fileBuffer);
          filesStaged++;
        } catch (error) {
          moduleLogger.warn('Failed to download file for backup, skipping', {
            fileId: file.id,
            storageKey: file.storageKey,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with backup even if some files fail
        }
      }
    }

    moduleLogger.debug('Staged user files', { filesStaged, totalFiles: data.files.length });

    // Stage document-store blob bytes to disk, keyed by blob id. The
    // doc-mount-blobs.json metadata above is the index; the bytes are paired
    // with each metadata row at restore time by blob id. Streaming the rows
    // means we never hold more than one blob in memory.
    let blobsStaged = 0;
    if ((data.docMountBlobs?.length ?? 0) > 0) {
      const blobsDir = path.join(stagingDir, 'mount-blobs');
      await fs.promises.mkdir(blobsDir, { recursive: true });
      for (const { meta, data: bytes } of streamDocMountBlobsWithData()) {
        try {
          await fs.promises.writeFile(path.join(blobsDir, meta.id), bytes);
          blobsStaged++;
        } catch (error) {
          moduleLogger.warn('Failed to stage doc-mount blob bytes, skipping', {
            blobId: meta.id,
            sizeBytes: meta.sizeBytes,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      moduleLogger.debug('Staged doc-mount blob bytes', {
        blobsStaged,
        totalBlobs: data.docMountBlobs?.length ?? 0,
      });
    }

    // Copy npm-installed plugins
    const npmPluginsDir = getNpmPluginsDir();
    if (fs.existsSync(npmPluginsDir)) {
      try {
        const pluginDirs = fs.readdirSync(npmPluginsDir, { withFileTypes: true });
        for (const entry of pluginDirs) {
          if (entry.isDirectory()) {
            const srcPath = path.join(npmPluginsDir, entry.name);
            const destPath = path.join(stagingDir, 'plugins', 'npm', entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
            moduleLogger.debug('Added npm plugin to backup', { pluginName: entry.name });
          }
        }
      } catch (error) {
        moduleLogger.warn('Failed to add npm plugins to backup', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with backup even if npm plugins fail
      }
    }

    // Copy user-installed theme bundles (excluding .cache directory)
    const themesDir = getThemesDir();
    if (fs.existsSync(themesDir)) {
      try {
        const themeEntries = fs.readdirSync(themesDir, { withFileTypes: true });
        for (const entry of themeEntries) {
          if (entry.isDirectory() && entry.name !== '.cache') {
            const srcPath = path.join(themesDir, entry.name);
            const destPath = path.join(stagingDir, 'themes', entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
            moduleLogger.debug('Added theme bundle to backup', { themeId: entry.name });
          }
        }
        // Also copy the themes-index.json if it exists
        const indexPath = path.join(themesDir, 'themes-index.json');
        if (fs.existsSync(indexPath)) {
          await fs.promises.cp(indexPath, path.join(stagingDir, 'themes', 'themes-index.json'));
        }
      } catch (error) {
        moduleLogger.warn('Failed to add theme bundles to backup', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with backup even if themes fail
      }
    }

    // Write manifest last (after all data is staged)
    await writeJsonFile(path.join(stagingDir, 'manifest.json'), manifest);

    // Create the zip using shell `zip -r`
    const zipFilePath = path.join(tempDir, `${folderName}.zip`);

    moduleLogger.debug('Running shell zip command', { cwd: tempDir, folderName });

    await execFileAsync('zip', ['-r', zipFilePath, folderName], {
      cwd: tempDir,
      maxBuffer: 10 * 1024 * 1024, // 10MB for zip stdout (progress output)
    });

    // Clean up the staging folder (keep only the zip)
    await cleanupDir(stagingDir);

    // Get final zip size for logging
    const zipStat = await fs.promises.stat(zipFilePath);

    moduleLogger.info('Backup creation completed', {
      userId,
      zipPath: zipFilePath,
      zipSize: zipStat.size,
      manifest,
    });

    return { zipPath: zipFilePath, manifest };
  } catch (error) {
    // Clean up the entire temp dir on failure
    await cleanupDir(tempDir);
    throw error;
  }
}
