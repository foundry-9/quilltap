/**
 * Backup archive I/O: extract the ZIP to a temp dir with shell `unzip`, parse
 * every data file off disk (streaming the large arrays), and read individual
 * files/plugin dirs back out of the extracted tree. No in-memory zip handling,
 * so memory-constrained VMs don't OOM on a big archive.
 *
 * @module backup/restore/archive
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { logger } from '@/lib/logger';
import type {
  BackupManifest,
  BackupData,
  ChatWithMessages,
  InstanceSettingRow,
  SerializedVectorEntry,
  SerializedConversationChunk,
  SerializedDocMountChunk,
} from '../types';
import type {
  Character,
  ChatSettings,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  Folder,
  PromptTemplate,
  RoleplayTemplate,
  ProviderModel,
  Project,
  Group,
  LLMLog,
  PluginConfig,
  CharacterPluginData,
  ConversationAnnotation,
  VectorIndexMeta,
  TfidfVocabulary,
  EmbeddingStatus,
} from '@/lib/schemas/types';
import type { WardrobeItem, EquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import type { TextReplacementRule } from '@/lib/schemas/text-replacement.types';
import type {
  DocMountPoint,
  DocMountFolder,
  DocMountFile,
  DocMountFileLink,
  DocMountDocument,
  DocMountBlobMetadata,
  ProjectDocMountLink,
  GroupDocMountLink,
  GroupCharacterMember,
} from '@/lib/schemas/mount-index.types';
import {
  readJsonFile,
  readJsonArrayFile,
  readJsonArrayFileOptional,
} from './json-stream';
import {
  type LegacyOutfitPreset,
  type LegacyEquippedSlots,
  dedupeAndOrderSlotTypes,
  orderedComponentIds,
  upgradeLegacyEquippedSlots,
} from './legacy-migrations';

const execFileAsync = promisify(execFile);

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Recursively removes a directory and all its contents
 */
export async function cleanupDir(dirPath: string): Promise<void> {
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
 * Extracts a backup ZIP to a temp directory using shell `unzip`
 * and finds the root folder name inside.
 *
 * @returns The extract directory path and the root folder name
 */
async function extractZipToTemp(zipPath: string): Promise<{ extractDir: string; rootFolder: string }> {
  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quilltap-restore-'));

  moduleLogger.debug('Extracting backup zip', { zipPath, extractDir });

  await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir], {
    maxBuffer: 10 * 1024 * 1024,
  });

  // Find the root folder (quilltap-backup-{timestamp})
  const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
  const rootEntry = entries.find(
    (e) => e.isDirectory() && e.name.startsWith('quilltap-backup-')
  );

  if (!rootEntry) {
    // Check if manifest.json is directly in the extract dir (flat zip)
    try {
      await fs.promises.access(path.join(extractDir, 'manifest.json'));
      // Flat structure — the extractDir itself is the root
      return { extractDir, rootFolder: '' };
    } catch {
      await cleanupDir(extractDir);
      throw new Error('Invalid backup: no quilltap-backup-* folder or manifest.json found');
    }
  }

  return { extractDir, rootFolder: rootEntry.name };
}

/**
 * Parses a backup ZIP file by extracting to disk and reading JSON data files.
 *
 * @param zipPath - Path to the backup ZIP file on disk
 * @returns The parsed backup data and the extraction directory (caller must clean up)
 */
export async function parseBackupZip(zipPath: string): Promise<{ data: BackupData; extractDir: string; rootFolder: string }> {
  const { extractDir, rootFolder } = await extractZipToTemp(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    // Read all data files from disk. Arrays go through readJsonArrayFile so a
    // multi-hundred-MB llm-logs.json doesn't blow past V8's max-string limit.
    const manifest = await readJsonFile<BackupManifest>(rootPath, 'manifest.json');
    const characters = await readJsonArrayFile<Character>(rootPath, 'data/characters.json');
    const chats = await readJsonArrayFile<ChatWithMessages>(rootPath, 'data/chats.json');
    // Back-compat: pre-rework backups stored each character's equippedOutfit slot
    // values as a single UUID-or-null. Upgrade them to the new array shape so the
    // standard restore path consumes a uniform structure.
    let chatsEquippedOutfitUpgraded = 0;
    for (const chat of chats) {
      const equipped = (chat as unknown as { equippedOutfit?: Record<string, LegacyEquippedSlots | EquippedSlots> | null })
        .equippedOutfit;
      if (equipped && typeof equipped === 'object') {
        let mutated = false;
        for (const [characterId, slots] of Object.entries(equipped)) {
          // If any slot is a string (rather than an array), it's the legacy shape.
          const looksLegacy =
            slots !== null &&
            typeof slots === 'object' &&
            (typeof (slots as Record<string, unknown>).top === 'string' ||
              typeof (slots as Record<string, unknown>).bottom === 'string' ||
              typeof (slots as Record<string, unknown>).footwear === 'string' ||
              typeof (slots as Record<string, unknown>).accessories === 'string' ||
              // Or null in any slot — old shape uses null where new shape uses [].
              (slots as Record<string, unknown>).top === null ||
              (slots as Record<string, unknown>).bottom === null ||
              (slots as Record<string, unknown>).footwear === null ||
              (slots as Record<string, unknown>).accessories === null);
          if (looksLegacy) {
            const upgraded = upgradeLegacyEquippedSlots(slots as LegacyEquippedSlots);
            if (upgraded) {
              equipped[characterId] = upgraded;
              mutated = true;
            }
          }
        }
        if (mutated) chatsEquippedOutfitUpgraded++;
      }
    }
    if (chatsEquippedOutfitUpgraded > 0) {
      moduleLogger.info('Upgraded legacy per-character equippedOutfit slot shape', {
        chatsTouched: chatsEquippedOutfitUpgraded,
      });
    }
    const tags = await readJsonArrayFile<Tag>(rootPath, 'data/tags.json');
    const connectionProfiles = await readJsonArrayFile<ConnectionProfile>(rootPath, 'data/connection-profiles.json');
    const imageProfiles = await readJsonArrayFile<ImageProfile>(rootPath, 'data/image-profiles.json');
    const embeddingProfiles = await readJsonArrayFile<EmbeddingProfile>(rootPath, 'data/embedding-profiles.json');
    const memories = await readJsonArrayFile<Memory>(rootPath, 'data/memories.json');
    const files = await readJsonArrayFile<FileEntry>(rootPath, 'data/files.json');
    // Templates are optional for backwards compatibility with older backups
    const promptTemplates = await readJsonArrayFileOptional<PromptTemplate>(rootPath, 'data/prompt-templates.json', []);
    const roleplayTemplates = await readJsonArrayFileOptional<RoleplayTemplate>(rootPath, 'data/roleplay-templates.json', []);
    // Provider models are optional for backwards compatibility with older backups
    const providerModels = await readJsonArrayFileOptional<ProviderModel>(rootPath, 'data/provider-models.json', []);
    // Projects are optional for backwards compatibility with older backups
    const projects = await readJsonArrayFileOptional<Project>(rootPath, 'data/projects.json', []);
    // Groups (format-4) are optional so older backups still load.
    const groups = await readJsonArrayFileOptional<Group>(rootPath, 'data/groups.json', []);
    // LLM logs are optional for backwards compatibility with older backups
    const llmLogs = await readJsonArrayFileOptional<LLMLog>(rootPath, 'data/llm-logs.json', []);
    // Plugin configs are optional for backwards compatibility with older backups
    const pluginConfigs = await readJsonArrayFileOptional<PluginConfig>(rootPath, 'data/plugin-configs.json', []);
    // Chat settings are optional for backwards compatibility with older backups
    const chatSettings = await readJsonArrayFileOptional<ChatSettings>(rootPath, 'data/chat-settings.json', []);
    // Folders are optional for backwards compatibility with older backups
    const folders = await readJsonArrayFileOptional<Folder>(rootPath, 'data/folders.json', []);
    // Wardrobe items are optional for backwards compatibility
    let wardrobeItems = await readJsonArrayFileOptional<WardrobeItem>(rootPath, 'data/wardrobe-items.json', []);
    // Back-compat: pre-rework backups stored outfit presets as a separate entity in
    // data/outfit-presets.json. New backups never write that file, but we still
    // read it from older archives and fold each preset into a composite WardrobeItem
    // so the standard wardrobe-restore path picks them up. We preserve the
    // original preset id as the new composite's id; any pre-rework reference
    // (chats, exports) stays valid.
    const legacyOutfitPresets = await readJsonArrayFileOptional<LegacyOutfitPreset>(
      rootPath,
      'data/outfit-presets.json',
      []
    );
    if (legacyOutfitPresets.length > 0) {
      const foldedComposites: WardrobeItem[] = legacyOutfitPresets.map((preset) => ({
        id: preset.id,
        characterId: preset.characterId,
        title: preset.name,
        description: preset.description,
        types: dedupeAndOrderSlotTypes(preset.slots),
        componentItemIds: orderedComponentIds(preset.slots),
        appropriateness: null,
        isDefault: false,
        // Legacy presets were worn as a whole outfit, so preserve replace semantics.
        replace: true,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: preset.createdAt,
        updatedAt: preset.updatedAt,
      }));
      moduleLogger.info('Folded legacy outfit presets into composite wardrobe items', {
        legacyPresetCount: legacyOutfitPresets.length,
        existingWardrobeItemCount: wardrobeItems.length,
      });
      wardrobeItems = [...wardrobeItems, ...foldedComposites];
    }
    // Character plugin data and conversation annotations are optional for backwards compatibility
    const characterPluginData = await readJsonArrayFileOptional<CharacterPluginData>(rootPath, 'data/character-plugin-data.json', []);
    const conversationAnnotations = await readJsonArrayFileOptional<ConversationAnnotation>(rootPath, 'data/conversation-annotations.json', []);

    // Format-3 additions (optional so older backups still load).
    const chatDocuments = await readJsonArrayFileOptional<ChatDocument>(rootPath, 'data/chat-documents.json', []);
    const instanceSettings = await readJsonArrayFileOptional<InstanceSettingRow>(rootPath, 'data/instance-settings.json', []);
    const embeddingStatus = await readJsonArrayFileOptional<EmbeddingStatus>(rootPath, 'data/embedding-status.json', []);
    const conversationChunks = await readJsonArrayFileOptional<SerializedConversationChunk>(rootPath, 'data/conversation-chunks.json', []);
    const tfidfVocabularies = await readJsonArrayFileOptional<TfidfVocabulary>(rootPath, 'data/tfidf-vocabularies.json', []);
    const vectorIndexMetas = await readJsonArrayFileOptional<VectorIndexMeta>(rootPath, 'data/vector-index-metas.json', []);
    const vectorEntries = await readJsonArrayFileOptional<SerializedVectorEntry>(rootPath, 'data/vector-entries.json', []);
    const docMountPoints = await readJsonArrayFileOptional<DocMountPoint>(rootPath, 'data/doc-mount-points.json', []);
    const docMountFolders = await readJsonArrayFileOptional<DocMountFolder>(rootPath, 'data/doc-mount-folders.json', []);
    const docMountFiles = await readJsonArrayFileOptional<DocMountFile>(rootPath, 'data/doc-mount-files.json', []);
    const docMountFileLinks = await readJsonArrayFileOptional<DocMountFileLink>(rootPath, 'data/doc-mount-file-links.json', []);
    const docMountChunks = await readJsonArrayFileOptional<SerializedDocMountChunk>(rootPath, 'data/doc-mount-chunks.json', []);
    const docMountDocuments = await readJsonArrayFileOptional<DocMountDocument>(rootPath, 'data/doc-mount-documents.json', []);
    const docMountBlobs = await readJsonArrayFileOptional<DocMountBlobMetadata>(rootPath, 'data/doc-mount-blobs.json', []);
    const projectDocMountLinks = await readJsonArrayFileOptional<ProjectDocMountLink>(rootPath, 'data/project-doc-mount-links.json', []);
    const groupDocMountLinks = await readJsonArrayFileOptional<GroupDocMountLink>(rootPath, 'data/group-doc-mount-links.json', []);
    const groupCharacterMembers = await readJsonArrayFileOptional<GroupCharacterMember>(rootPath, 'data/group-character-members.json', []);
    const textReplacementRules = await readJsonArrayFileOptional<TextReplacementRule>(rootPath, 'data/text-replacement-rules.json', []);

    moduleLogger.info('Parsed backup ZIP', {
      version: manifest.version,
      createdAt: manifest.createdAt,
      counts: manifest.counts,
    });

    const data: BackupData = {
      manifest,
      characters,
      chats,
      tags,
      connectionProfiles,
      imageProfiles,
      embeddingProfiles,
      memories,
      files,
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

    return { data, extractDir, rootFolder };
  } catch (error) {
    // Clean up on parse failure
    await cleanupDir(extractDir);
    throw error;
  }
}

/**
 * Gets a file from the extracted backup directory by its metadata.
 * Returns the file contents as a Buffer, or null if not found.
 * Only one file is in memory at a time.
 */
export async function getFileFromExtractedBackup(
  rootPath: string,
  file: FileEntry,
  backupFormat?: number
): Promise<Buffer | null> {
  // New format (backupFormat 2 and up): files stored by storageKey path.
  // The test is a floor, not an equality — the format number has been bumped
  // several times since this layout landed, and an `=== 2` check quietly
  // excluded every archive newer than the one it was written for, sending each
  // lookup down the pre-format-2 fallback that modern archives don't use.
  const usesStorageKeyLayout = (backupFormat ?? 1) >= 2 && Boolean(file.storageKey);
  const oldFormatRelPath = path.join('files', file.category, `${file.id}_${file.originalFilename}`);

  if (usesStorageKeyLayout) {
    const newFormatPath = path.join(rootPath, 'files', file.storageKey!);
    try {
      await fs.promises.access(newFormatPath);
      return await fs.promises.readFile(newFormatPath);
    } catch {
      // Fall through to old format as fallback
    }
  }

  // Old format (backupFormat: 1 or unset): files/{CATEGORY}/{fileId}_{originalFilename}
  const oldFormatPath = path.join(rootPath, oldFormatRelPath);
  try {
    await fs.promises.access(oldFormatPath);
    return await fs.promises.readFile(oldFormatPath);
  } catch {
    moduleLogger.warn('File not found in extracted backup', {
      fileId: file.id,
      triedPaths: usesStorageKeyLayout
        ? [path.join('files', file.storageKey!), oldFormatRelPath]
        : [oldFormatRelPath],
    });
    return null;
  }
}

/**
 * Counts npm plugin directories in the extracted backup
 */
export async function countNpmPluginsInExtractedBackup(rootPath: string): Promise<number> {
  const pluginsPath = path.join(rootPath, 'plugins', 'npm');

  try {
    const entries = await fs.promises.readdir(pluginsPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}
