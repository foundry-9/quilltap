/**
 * New-account remapping: rewrite every UUID in the parsed backup to a fresh
 * value (and reassign ownership to the target user) so the data can be imported
 * alongside an existing account without id collisions. Cross-references are
 * remapped consistently via the shared {@link UuidRemapper} so the graph stays
 * internally connected.
 *
 * @module backup/restore/uuid-remap
 */

import { UuidRemapper } from '../uuid-remapper';
import type {
  BackupData,
  ChatWithMessages,
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
  ChatParticipantBase,
  PhysicalDescription,
  PromptTemplate,
  RoleplayTemplate,
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
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
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

/**
 * Settings keys whose values are mount-point UUIDs. These need remapping in
 * new-account mode so they keep pointing at the right mount points.
 */
const MOUNT_POINT_SETTING_KEYS = new Set([
  'lanternBackgroundsMountPointId',
  'userUploadsMountPointId',
  'generalMountPointId',
]);

/**
 * Remaps all UUIDs in the backup data for new-account mode
 */
export function remapBackupData(
  data: BackupData,
  targetUserId: string,
  remapper: UuidRemapper
): BackupData {
  // Remap tags
  const remappedTags = data.tags.map((tag) => ({
    ...remapper.remapFields(tag, ['id']),
    userId: targetUserId,
  }));

  // Remap files
  // IMPORTANT: Chain remapFields → remapArrayFields so array spread doesn't overwrite remapped scalar fields
  const remappedFiles = data.files.map((file) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(file, ['id', 'projectId']),
      ['linkedTo', 'tags']
    ),
    userId: targetUserId,
  }));

  // Remap characters
  const remappedCharacters = data.characters.map((char) => {
    const remapped = {
      ...remapper.remapArrayFields(
        remapper.remapFields(char, ['id', 'defaultImageId', 'defaultConnectionProfileId', 'defaultPartnerId', 'defaultImageProfileId']),
        ['tags']
      ),
      userId: targetUserId,
    };
    // Handle partnerLinks array of objects (new format)
    if (remapped.partnerLinks) {
      remapped.partnerLinks = remapped.partnerLinks.map((link: { partnerId: string; isDefault: boolean }) => ({
        ...link,
        partnerId: remapper.remap(link.partnerId),
      }));
    }
    // Handle personaLinks backwards compatibility (old backup format)
    const legacy = remapped as Record<string, unknown>;
    if (legacy.personaLinks && !remapped.partnerLinks) {
      remapped.partnerLinks = (legacy.personaLinks as Array<{ personaId: string; isDefault: boolean }>).map((link) => ({
        partnerId: remapper.remap(link.personaId),
        isDefault: link.isDefault,
      }));
      delete legacy.personaLinks;
    }
    // Handle avatarOverrides
    if (remapped.avatarOverrides) {
      remapped.avatarOverrides = remapped.avatarOverrides.map((override: { chatId: string; imageId: string }) => ({
        chatId: remapper.remap(override.chatId),
        imageId: remapper.remap(override.imageId),
      }));
    }
    // Handle physicalDescription: backups may carry either the legacy plural
    // array (`physicalDescriptions`) or the new singular field
    // (`physicalDescription`). Collapse to the first record either way.
    const legacyRecord = legacy as Record<string, unknown>;
    if (Array.isArray(legacyRecord.physicalDescriptions)) {
      const first = legacyRecord.physicalDescriptions[0] as PhysicalDescription | undefined;
      remapped.physicalDescription = first
        ? { ...first, id: remapper.remap(first.id) }
        : null;
      delete legacyRecord.physicalDescriptions;
    } else if (remapped.physicalDescription) {
      remapped.physicalDescription = {
        ...remapped.physicalDescription,
        id: remapper.remap(remapped.physicalDescription.id),
      };
    }
    // Legacy `clothingRecords` — the table is gone; drop silently so old
    // backups still restore.
    if (legacyRecord.clothingRecords) {
      delete legacyRecord.clothingRecords;
    }
    return remapped as Character;
  });


  // Remap connection profiles.
  //
  // `fallbackProfileId` points at another row in this same table, so it has to
  // be remapped alongside `id` or a restored profile's understudy would name a
  // uuid that no longer exists. The remapper is lazy and consistent — the same
  // old id always yields the same new one — so a profile naming an understudy
  // that appears later in the array is remapped correctly either way.
  const remappedConnectionProfiles = data.connectionProfiles.map((profile) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(profile, ['id', 'apiKeyId', 'fallbackProfileId']),
      ['tags']
    ),
    userId: targetUserId,
  })) as ConnectionProfile[];

  // Remap image profiles
  const remappedImageProfiles = data.imageProfiles.map((profile) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(profile, ['id', 'apiKeyId']),
      ['tags']
    ),
    userId: targetUserId,
  })) as ImageProfile[];

  // Remap embedding profiles
  const remappedEmbeddingProfiles = data.embeddingProfiles.map((profile) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(profile, ['id', 'apiKeyId']),
      ['tags']
    ),
    userId: targetUserId,
  })) as EmbeddingProfile[];

  // Remap chats (complex due to participants and messages)
  const remappedChats = data.chats.map((chat) => {
    const remappedChat = {
      ...remapper.remapArrayFields(
        remapper.remapFields(chat, [
          'id',
          'activeTypingParticipantId',
          'lastTurnParticipantId',
          'projectId',
          'storyBackgroundImageId',
          'imageProfileId',
        ]),
        ['tags', 'impersonatingParticipantIds']
      ),
      userId: targetUserId,
    };

    // Remap participants
    remappedChat.participants = chat.participants.map((participant: ChatParticipantBase) => ({
      ...remapper.remapFields(participant, [
        'id',
        'characterId',
        'connectionProfileId',
        'imageProfileId',
      ]),
    })) as ChatParticipantBase[];

    // Remap messages
    remappedChat.messages = chat.messages.map((msg) => ({
      ...remapper.remapArrayFields(
        remapper.remapFields(msg, ['id', 'swipeGroupId', 'participantId']),
        ['attachments']
      ),
    }));

    return remappedChat as ChatWithMessages;
  });

  // Remap memories
  const remappedMemories = data.memories.map((memory) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(memory, ['id', 'characterId', 'aboutCharacterId', 'chatId', 'sourceMessageId', 'projectId']),
      ['tags', 'relatedMemoryIds']
    ),
  })) as Memory[];

  // Remap prompt templates
  const remappedPromptTemplates = data.promptTemplates.map((template) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(template, ['id']),
      ['tags']
    ),
    userId: targetUserId,
  })) as PromptTemplate[];

  // Remap roleplay templates
  const remappedRoleplayTemplates = data.roleplayTemplates.map((template) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(template, ['id']),
      ['tags']
    ),
    userId: targetUserId,
  })) as RoleplayTemplate[];

  // Provider models are global and don't need remapping, just copy them
  const remappedProviderModels = data.providerModels;

  // Remap projects
  const remappedProjects = data.projects.map((project) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(project, ['id', 'staticBackgroundImageId', 'storyBackgroundImageId', 'defaultImageProfileId', 'defaultRoleplayTemplateId']),
      ['characterRoster']
    ),
    userId: targetUserId,
  })) as Project[];

  // Remap groups. Only the id needs remapping — like projects, the
  // officialMountPointId is discarded and re-provisioned by `groups.create`, so
  // it's intentionally left alone (membership/links carry the group id forward).
  const remappedGroups = (data.groups || []).map((group) => ({
    ...remapper.remapFields(group, ['id']),
  })) as Group[];

  // Remap LLM logs.
  // `connectionProfileId` / `imageProfileId` must be in this list: connection
  // and image profiles are themselves remapped above, so a log row left holding
  // the source instance's profile id would name nothing on the receiving one —
  // and The Almanack's per-profile attribution would read every restored row as
  // a deleted profile. Both are nullable and `remapFields` only touches string
  // fields, so pre-4.9 rows (which carry null) pass through untouched.
  const remappedLLMLogs = data.llmLogs.map((log) => ({
    ...remapper.remapFields(log, [
      'id',
      'messageId',
      'chatId',
      'characterId',
      'connectionProfileId',
      'imageProfileId',
    ]),
    userId: targetUserId,
  })) as LLMLog[];

  // Remap plugin configs
  const remappedPluginConfigs = (data.pluginConfigs || []).map((config) => ({
    ...remapper.remapFields(config, ['id']),
    userId: targetUserId,
  })) as PluginConfig[];

  // Remap chat settings
  const remappedChatSettings = (data.chatSettings || []).map((settings) => {
    const remapped = {
      ...remapper.remapFields(settings, ['id', 'imageDescriptionProfileId', 'uncensoredImageDescriptionProfileId', 'defaultRoleplayTemplateId']),
      userId: targetUserId,
    };
    // Remap nested cheapLLMSettings UUID fields
    if (remapped.cheapLLMSettings) {
      remapped.cheapLLMSettings = {
        ...remapped.cheapLLMSettings,
        ...(remapped.cheapLLMSettings.userDefinedProfileId ? { userDefinedProfileId: remapper.remap(remapped.cheapLLMSettings.userDefinedProfileId) } : {}),
        ...(remapped.cheapLLMSettings.defaultCheapProfileId ? { defaultCheapProfileId: remapper.remap(remapped.cheapLLMSettings.defaultCheapProfileId) } : {}),
        ...(remapped.cheapLLMSettings.imagePromptProfileId ? { imagePromptProfileId: remapper.remap(remapped.cheapLLMSettings.imagePromptProfileId) } : {}),
      };
    }
    // Remap nested dangerousContentSettings UUID fields
    if (remapped.dangerousContentSettings) {
      remapped.dangerousContentSettings = {
        ...remapped.dangerousContentSettings,
        ...(remapped.dangerousContentSettings.uncensoredTextProfileId ? { uncensoredTextProfileId: remapper.remap(remapped.dangerousContentSettings.uncensoredTextProfileId) } : {}),
        ...(remapped.dangerousContentSettings.uncensoredImageProfileId ? { uncensoredImageProfileId: remapper.remap(remapped.dangerousContentSettings.uncensoredImageProfileId) } : {}),
      };
    }
    // Remap nested storyBackgroundsSettings UUID fields
    if (remapped.storyBackgroundsSettings?.defaultImageProfileId) {
      remapped.storyBackgroundsSettings = {
        ...remapped.storyBackgroundsSettings,
        defaultImageProfileId: remapper.remap(remapped.storyBackgroundsSettings.defaultImageProfileId),
      };
    }
    return remapped as ChatSettings;
  });

  // Remap folders
  const remappedFolders = (data.folders || []).map((folder) => ({
    ...remapper.remapFields(folder, ['id', 'parentFolderId', 'projectId']),
    userId: targetUserId,
  })) as Folder[];

  // Remap wardrobe items. componentItemIds reference other wardrobe items, which
  // share the same UUID space; remap them along with id/characterId so cross-refs
  // stay consistent in new-account mode. Legacy outfit presets folded into
  // composites at parse time pass through this same path.
  const remappedWardrobeItems = (data.wardrobeItems || []).map((item) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(item, ['id', 'characterId']),
      ['componentItemIds']
    ),
  })) as WardrobeItem[];

  // Chat documents reference chat IDs that have been remapped above.
  const remappedChatDocuments = (data.chatDocuments || []).map((cd) => ({
    ...remapper.remapFields(cd, ['id', 'chatId']),
  })) as ChatDocument[];

  // Conversation chunks reference chats and individual messages.
  const remappedConversationChunks = (data.conversationChunks || []).map((chunk) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(chunk, ['id', 'chatId']),
      ['messageIds']
    ),
  })) as SerializedConversationChunk[];

  // Vector index meta — id and characterId share the same value by convention.
  const remappedVectorIndexMetas = (data.vectorIndexMetas || []).map((meta) => ({
    ...remapper.remapFields(meta, ['id', 'characterId']),
  })) as VectorIndexMeta[];

  // Vector entries — id is typically the memory id (already remapped through
  // the memory pass). characterId is also remapped.
  const remappedVectorEntries = (data.vectorEntries || []).map((entry) => ({
    ...remapper.remapFields(entry, ['id', 'characterId']),
  })) as SerializedVectorEntry[];

  // TF-IDF vocabularies. profileId is an embedding-profile id; userId moves
  // to the target user.
  const remappedTfidfVocabularies = (data.tfidfVocabularies || []).map((voc) => ({
    ...remapper.remapFields(voc, ['id', 'profileId']),
    userId: targetUserId,
  })) as TfidfVocabulary[];

  // Embedding status — entityId could be a memory/file/help_doc/etc. id, all
  // of which are already in the mapping by the time embeddingStatus is touched.
  const remappedEmbeddingStatus = (data.embeddingStatus || []).map((es) => ({
    ...remapper.remapFields(es, ['id', 'entityId', 'profileId']),
    userId: targetUserId,
  })) as EmbeddingStatus[];

  // Document store tables — remap every FK to keep the graph internally
  // consistent. doc_mount_files row ids are shared by doc_mount_documents and
  // doc_mount_blobs (fileId), so remapping a file id once means everything
  // that points at it gets the same new id.
  const remappedDocMountPoints = (data.docMountPoints || []).map((mp) => ({
    ...remapper.remapFields(mp, ['id']),
  })) as DocMountPoint[];
  const remappedDocMountFolders = (data.docMountFolders || []).map((folder) => ({
    ...remapper.remapFields(folder, ['id', 'mountPointId', 'parentId']),
  })) as DocMountFolder[];
  const remappedDocMountFiles = (data.docMountFiles || []).map((file) => ({
    ...remapper.remapFields(file, ['id']),
  })) as DocMountFile[];
  const remappedDocMountFileLinks = (data.docMountFileLinks || []).map((link) => ({
    ...remapper.remapFields(link, ['id', 'fileId', 'mountPointId', 'folderId']),
  })) as DocMountFileLink[];
  const remappedDocMountChunks = (data.docMountChunks || []).map((chunk) => ({
    ...remapper.remapFields(chunk, ['id', 'linkId', 'mountPointId']),
  })) as SerializedDocMountChunk[];
  const remappedDocMountDocuments = (data.docMountDocuments || []).map((doc) => ({
    ...remapper.remapFields(doc, ['id', 'fileId']),
  })) as DocMountDocument[];
  const remappedDocMountBlobs = (data.docMountBlobs || []).map((blob) => ({
    ...remapper.remapFields(blob, ['id', 'fileId']),
  })) as DocMountBlobMetadata[];
  const remappedProjectDocMountLinks = (data.projectDocMountLinks || []).map((link) => ({
    ...remapper.remapFields(link, ['id', 'projectId', 'mountPointId']),
  })) as ProjectDocMountLink[];
  // Group join tables — direct analogues. groupId/characterId resolve to the
  // same new ids the group/character rows received (remap is consistent by
  // original id, so order within this function doesn't matter).
  const remappedGroupDocMountLinks = (data.groupDocMountLinks || []).map((link) => ({
    ...remapper.remapFields(link, ['id', 'groupId', 'mountPointId']),
  })) as GroupDocMountLink[];
  const remappedGroupCharacterMembers = (data.groupCharacterMembers || []).map((member) => ({
    ...remapper.remapFields(member, ['id', 'groupId', 'characterId']),
  })) as GroupCharacterMember[];

  // Instance settings — only the mount-point keys carry UUIDs we need to
  // remap. Everything else is opaque text (numbers, JSON config blobs).
  const remappedInstanceSettings = (data.instanceSettings || []).map((row) => {
    if (MOUNT_POINT_SETTING_KEYS.has(row.key) && row.value) {
      return { key: row.key, value: remapper.remap(row.value) };
    }
    return row;
  });

  return {
    manifest: data.manifest,
    characters: remappedCharacters,
    chats: remappedChats,
    tags: remappedTags as Tag[],
    connectionProfiles: remappedConnectionProfiles,
    imageProfiles: remappedImageProfiles,
    embeddingProfiles: remappedEmbeddingProfiles,
    memories: remappedMemories,
    files: remappedFiles as FileEntry[],
    promptTemplates: remappedPromptTemplates,
    roleplayTemplates: remappedRoleplayTemplates,
    providerModels: remappedProviderModels,
    projects: remappedProjects,
    groups: remappedGroups,
    llmLogs: remappedLLMLogs,
    pluginConfigs: remappedPluginConfigs,
    chatSettings: remappedChatSettings,
    folders: remappedFolders,
    wardrobeItems: remappedWardrobeItems,
    characterPluginData: (data.characterPluginData || []).map((cpd) => ({
      ...remapper.remapFields(cpd, ['id', 'characterId']),
    })) as CharacterPluginData[],
    conversationAnnotations: (data.conversationAnnotations || []).map((annotation) => ({
      ...remapper.remapFields(annotation, ['id', 'chatId', 'sourceMessageId']),
    })) as ConversationAnnotation[],
    chatDocuments: remappedChatDocuments,
    instanceSettings: remappedInstanceSettings,
    embeddingStatus: remappedEmbeddingStatus,
    conversationChunks: remappedConversationChunks,
    tfidfVocabularies: remappedTfidfVocabularies,
    vectorIndexMetas: remappedVectorIndexMetas,
    vectorEntries: remappedVectorEntries,
    docMountPoints: remappedDocMountPoints,
    docMountFolders: remappedDocMountFolders,
    docMountFiles: remappedDocMountFiles,
    docMountFileLinks: remappedDocMountFileLinks,
    docMountChunks: remappedDocMountChunks,
    docMountDocuments: remappedDocMountDocuments,
    docMountBlobs: remappedDocMountBlobs,
    projectDocMountLinks: remappedProjectDocMountLinks,
    groupDocMountLinks: remappedGroupDocMountLinks,
    groupCharacterMembers: remappedGroupCharacterMembers,
    // Text replacement rules: global config, no userId, no FKs to remapped
    // entities, and nothing references rule IDs — pass through unchanged.
    textReplacementRules: data.textReplacementRules || [],
  };
}
