/**
 * Migration Registry
 *
 * All migrations should be imported and exported here.
 * They are executed in dependency order as defined in each migration.
 *
 * This file was migrated from the qtap-plugin-upgrade plugin to run
 * during server startup before any requests are served.
 *
 * Only migrations introduced in version 2.7.0+ are included.
 * Legacy migrations from earlier versions have been removed since they
 * are only needed for upgrading from pre-2.7.0 installations.
 */

import type { Migration } from '../types';
// Web search decoupling
import { addUseNativeWebSearchFieldMigration } from './add-use-native-web-search-field';
// Mount points migration
import { createMountPointsMigration } from './create-mount-points';
// Fix missing storage keys
import { fixMissingStorageKeysMigration } from './fix-missing-storage-keys';
// Fix orphan PERSONA participants
import { fixOrphanPersonaParticipantsMigration } from './fix-orphan-persona-participants';
// Cleanup orphan file records
import { cleanupOrphanFileRecordsMigration } from './cleanup-orphan-file-records';
// LLM logs collection
import { addLLMLogsCollectionMigration } from './add-llm-logs-collection';
// SQLite initial schema
import { sqliteInitialSchemaMigration } from './sqlite-initial-schema';
// Centralized data directory migration
import { migrateToCentralizedDataDirMigration } from './migrate-to-centralized-data-dir';
// Per-project mount points
import { perProjectMountPointsMigration } from './per-project-mount-points';
// Folder entities migration
import { createFolderEntitiesMigration } from './create-folder-entities';
// Remove auth tables (single-user mode)
import { removeAuthTablesMigration } from './remove-auth-tables';
// Re-encrypt API keys after single-user migration
import { reencryptApiKeysMigration } from './reencrypt-api-keys';
// Add defaultImageProfileId to characters
import { addDefaultImageProfileFieldMigration } from './add-default-image-profile-field';
// Migrate user plugins to site plugins (single-user mode)
import { migrateUserPluginsToSiteMigration } from './migrate-user-plugins-to-site';
// Migrate site plugins to data directory
import { migrateSitePluginsToDataDirMigration } from './migrate-site-plugins-to-data-dir';
// Drop sync tables (sync functionality removed)
import { dropSyncTablesMigration } from './drop-sync-tables';
// Add tool settings fields to chats
import { addChatToolSettingsFieldsMigration } from './add-chat-tool-settings-fields';
// Add default tool settings fields to projects
import { addProjectToolSettingsFieldsMigration } from './add-project-tool-settings-fields';
// Create embedding tables for built-in TF-IDF provider
import { createEmbeddingTablesMigration } from './create-embedding-tables';
// Add state fields to chats and projects
import { addStateFieldsMigration } from './add-state-fields';
// Add autoDetectRng field to chat_settings
import { addAutoDetectRngFieldMigration } from './add-auto-detect-rng-field';
// Add compressionCache field to chats
import { addCompressionCacheFieldMigration } from './add-compression-cache-field';
// Add agent mode fields to chat_settings, characters, projects, and chats
import { addAgentModeFieldsMigration } from './add-agent-mode-fields';
// Add story backgrounds fields to chat_settings, chats, and projects
import { addStoryBackgroundsFieldsMigration } from './add-story-backgrounds-fields';
// Add imageProfileId field to chats (move from per-participant to per-chat)
import { addChatImageProfileFieldMigration } from './add-chat-image-profile-field';
// Add dangerous content handling fields
import { addDangerousContentFieldsMigration } from './add-dangerous-content-fields';
// Add chat-level danger classification fields
import { addChatDangerClassificationFieldsMigration } from './add-chat-danger-classification-fields';
// Fix chat updatedAt timestamps polluted by background jobs
import { fixChatUpdatedAtTimestampsMigration } from './fix-chat-updated-at-timestamps';
// Add aliases field to characters
import { addCharacterAliasesFieldMigration } from './add-character-aliases-field';
// Add pronouns field to characters
import { addCharacterPronounsFieldMigration } from './add-character-pronouns-field';
// Add clothingRecords field to characters
import { addCharacterClothingRecordsFieldMigration } from './add-character-clothing-records-field';
// Fix chat messageCount to only count visible message bubbles
import { fixChatMessageCountsMigration } from './fix-chat-message-counts';
// Add memory gate fields (reinforcement tracking, related links)
import { addMemoryGateFieldsMigration } from './add-memory-gate-fields';
// Migrate legacy JSONL file entries to SQLite
import { migrateLegacyJsonlFilesMigration } from './migrate-legacy-jsonl-files';
// Add missing columns to chat_messages and fix empty JSON strings
import { addChatMessageMissingColumnsMigration } from './add-chat-message-missing-columns';
// Normalize vector embedding storage to Float32 BLOBs
import { normalizeVectorStorageMigration } from './normalize-vector-storage';
// Add allowToolUse field to connection profiles
import { addProfileAllowToolUseFieldMigration } from './add-profile-allow-tool-use-field';
// Drop mount points system (S3 + mount point abstraction removed)
import { dropMountPointsMigration } from './drop-mount-points';
// Move LLM logs to separate database
import { moveLLMLogsToSeparateDbMigration } from './move-llm-logs-to-separate-db';
// Add fileStatus field to files table
import { addFileStatusFieldMigration } from './add-file-status-field';
// Restructure file storage from old users/{userId}/... layout to new flat layout
import { restructureFileStorageMigration } from './restructure-file-storage';
// Cleanup pass for file storage restructure (category dirs, thumbnails, .DS_Store)
import { restructureFileStorageCleanupMigration } from './restructure-file-storage-cleanup';
// Fix TEXT embeddings written back by update path (should be Float32 BLOBs)
import { fixTextEmbeddingsAfterUpdateMigration } from './fix-text-embeddings-after-update';
// Add sortIndex field to connection profiles for custom ordering
import { addConnectionProfileSortIndexMigration } from './add-connection-profile-sort-index';
// Drop encryption columns from api_keys (ciphertext → key_value, drop iv/authTag)
import { dropApiKeyEncryptionColumnsMigration } from './drop-api-key-encryption-columns';
// Decrypt API key values left as ciphertext after column rename
import { decryptApiKeyValuesMigration } from './decrypt-api-key-values';
// Drop pepper_vault table (encryption simplified)
import { dropPepperVaultMigration } from './drop-pepper-vault';
// Add whisper target field to chat_messages
import { addWhisperTargetFieldMigration } from './add-whisper-target-field';
// Add turn queue field to chats for server-side turn management
import { addTurnQueueFieldMigration } from './add-turn-queue-field';
// Add scene state tracking field to chats
import { addSceneStateFieldMigration } from './add-scene-state-field';
// Add help tools field to characters
import { addHelpToolsFieldMigration } from './add-help-tools-field';
// Add auto-lock settings field to chat_settings
import { addAutoLockSettingsFieldMigration } from './add-auto-lock-settings-field';
// Add chatType field to chats for help chat support
import { addChatTypeFieldMigration } from './add-chat-type-field';
// Create instance_settings table for instance-level configuration
import { createInstanceSettingsTableMigration } from './create-instance-settings-table';
// Migrate participant isActive boolean to status enum
import { migrateParticipantStatusFieldMigration } from './migrate-participant-status-field';
// Add isSilentMessage field to chat_messages
import { addSilentMessageFieldMigration } from './add-silent-message-field';
// Convert character scenario string to scenarios array
import { convertScenarioToScenariosMigration } from './convert-scenario-to-scenarios';
// Add defaultTimestampConfig field to characters
import { addCharacterTimestampConfigFieldMigration } from './add-character-timestamp-config-field';
// Add defaultScenarioId and defaultSystemPromptId fields to characters
import { addCharacterDefaultIdsFieldsMigration } from './add-character-default-ids-fields';
// Add scenarioText field to chats for persisting selected scenario content
import { addChatScenarioTextFieldMigration } from './add-chat-scenario-text-field';
// Add modelClass field to connection profiles for capability tier classification
import { addConnectionProfileModelClassFieldMigration } from './add-connection-profile-model-class-field';
// Add maxTokens field to connection profiles for budget-driven compression
import { addConnectionProfileMaxTokensFieldMigration } from './add-connection-profile-max-tokens-field';
// Fix memory timestamps to match source message timestamps
import { fixMemoryTimestampsFromSourceMigration } from './fix-memory-timestamps-from-source';
// Create wardrobe_items table for modular wardrobe system
import { createWardrobeItemsTableMigration } from './create-wardrobe-items-table';
// Add equippedOutfit field to chats for per-character outfit tracking
import { addEquippedOutfitFieldMigration } from './add-equipped-outfit-field';
// Add canDressThemselves and canCreateOutfits flags to characters
import { addCharacterWardrobeFlagsMigration } from './add-character-wardrobe-flags';
// Migrate existing clothing records to wardrobe_items table
import { migrateClothingRecordsToWardrobeMigration } from './migrate-clothing-records-to-wardrobe';
// Add pendingOutfitNotifications field to chats
import { addPendingOutfitNotificationsFieldMigration } from './add-pending-outfit-notifications-field';
// Add characterAvatars and avatarGenerationEnabled fields to chats
import { addCharacterAvatarsFieldsMigration } from './add-character-avatars-fields';
// Add defaultAvatarGenerationEnabled field to projects
import { addProjectAvatarGenerationDefaultMigration } from './add-project-avatar-generation-default';
// Create outfit_presets table and add archivedAt to wardrobe_items
import { createOutfitPresetsAndArchiveMigration } from './create-outfit-presets-and-archive';
// Convert all non-WebP, non-SVG images to WebP format
import { convertImagesToWebPMigration } from './convert-images-to-webp';
// Rename persona DB columns (personaLinks → partnerLinks, drop memories.personaId)
import { renamePersonaColumnsMigration } from './rename-persona-columns';
// Add narrationDelimiters field to roleplay_templates
import { addNarrationDelimitersFieldMigration } from './add-narration-delimiters-field';
// Migrate plugin roleplay templates to native built-in, rename annotationButtons to delimiters
import { migratePluginTemplatesToNativeMigration } from './migrate-plugin-templates-to-native';
// Add defaultImageProfileId to projects for project-level image profile default
import { addProjectDefaultImageProfileMigration } from './add-project-default-image-profile';
// Create character_plugin_data table for per-character per-plugin metadata
import { createCharacterPluginDataTableMigration } from './create-character-plugin-data-table';
// Add renderedMarkdown field to chats for Scriptorium conversation rendering
import { addRenderedMarkdownFieldMigration } from './add-rendered-markdown-field';
// Create conversation tables for Scriptorium (annotations + chunks)
import { createConversationTablesMigration } from './create-conversation-tables';
// Create help_docs table for runtime-embedded help documentation
import { createHelpDocsTableMigration } from './create-help-docs-table';
// Add document mode fields for Scriptorium Phase 3.5
import { addDocumentModeFieldsMigration } from './add-document-mode-fields';
// Add characterDocumentMountPointId field to characters
import { addCharacterDocumentMountPointFieldMigration } from './add-character-document-mount-point-field';
// Add readPropertiesFromDocumentStore field to characters
import { addReadPropertiesFromDocumentStoreFieldMigration } from './add-read-properties-from-document-store-field';
// Normalise all stored embeddings to unit length for fast cosine similarity
import { normalizeEmbeddingsUnitVectorsMigration } from './normalize-embeddings-unit-vectors';
// Add autoHousekeepingSettings column to chat_settings
import { addAutoHousekeepingSettingsFieldMigration } from './add-auto-housekeeping-settings-field';
// Add memoryExtractionLimits column to chat_settings
import { addMemoryExtractionLimitsFieldMigration } from './add-memory-extraction-limits-field';
// Add memoryExtractionConcurrency column to chat_settings
import { addMemoryExtractionConcurrencyFieldMigration } from './add-memory-extraction-concurrency-field';
// Move memory extraction knobs out of chat_settings into instance_settings
import { migrateExtractionKnobsToInstanceSettingsMigration } from './migrate-extraction-knobs-to-instance-settings';
// Add supportsImageUpload column to connection_profiles (per-profile vision capability)
import { addProfileSupportsImageUploadFieldMigration } from './add-profile-supports-image-upload-field';
// Add Lantern image alert columns to projects and chats
import { addLanternImageAlertFieldsMigration } from './add-lantern-image-alert-fields';
// Convert project file storage into per-project Scriptorium document stores
import { convertProjectFilesToDocumentStoresMigration } from './convert-project-files-to-document-stores';
// Add systemSender column to chat_messages for personified-feature announcements
import { addSystemSenderFieldMigration } from './add-system-sender-field';
// Add allowCrossCharacterVaultReads column to chats
import { addChatCrossCharacterVaultReadsFieldMigration } from './add-chat-cross-character-vault-reads-field';
// Drop file_permissions table (LLM write approval flow retired)
import { dropFilePermissionsMigration } from './drop-file-permissions';
// Add systemTransparency column to characters
import { addCharacterSystemTransparencyFieldMigration } from './add-character-system-transparency-field';
// Add officialMountPointId column to projects + backfill from `Project Files: <name>` stores
import { addProjectOfficialMountPointMigration } from './add-project-official-mount-point';
// Add compositionModeDefault column to chat_settings
import { addCompositionModeDefaultFieldMigration } from './add-composition-mode-default-field';
// Add compiledIdentityStacks column to chats (Phase H system-prompt precompile)
import { addCompiledIdentityStacksFieldMigration } from './add-compiled-identity-stacks-field';
// Add hostEvent column to chat_messages (per-character Librarian summaries)
import { addHostEventFieldMigration } from './add-host-event-field';
// Add systemKind column to chat_messages (Salon collapsed-bar labels)
import { addSystemKindFieldMigration } from './add-system-kind-field';
// Backfill memories.aboutCharacterId via name-presence heuristic
import { alignAboutCharacterIdMigration } from './align-about-character-id';
// Re-run aboutCharacterId alignment with the holder-dominance tiebreaker
import { alignAboutCharacterIdV2Migration } from './align-about-character-id-v2';
// Add identity field to characters table
import { addCharacterIdentityFieldMigration } from './add-character-identity-field';
// Add manifesto field to characters table
import { addCharacterManifestoFieldMigration } from './add-character-manifesto-field';
// Add archive fields to characters for tombstone support
import { addCharacterArchiveFieldsMigration } from './add-character-archive-fields';
// Re-absorb leftover project files into database-backed official store
import { reabsorbLeftoverProjectFilesMigration } from './reabsorb-leftover-project-files';
// Relink legacy files.storageKey rows to mount-blob shims (Stage-1 follow-up)
import { relinkFilesToMountBlobsMigration } from './relink-files-to-mount-blobs';
// Add requestHashes column to llm_logs (cache-stability instrumentation)
import { addLLMLogsRequestHashesColumnMigration } from './add-llm-logs-request-hashes-column';
// Add rawProviderUsage column to llm_logs (Layer-1 raw-usage snapshot)
import { addLLMLogsRawProviderUsageColumnMigration } from './add-llm-logs-raw-provider-usage-column';
import { addLLMLogsAutonomousRunIdColumnMigration } from './add-llm-logs-autonomous-run-id-column';
// Add summarization-gate tracking columns to chats (triple-gate Phase 2)
import { addSummarizationGateFieldsMigration } from './add-summarization-gate-fields';
// Add summaryAnchor column to chat_messages (whisper anchoring Phase 3c)
import { addSummaryAnchorFieldMigration } from './add-summary-anchor-field';
// Add summaryAnchorMessageIds column to chats (edit-aware invalidation Phase 4)
import { addSummaryAnchorMessageIdsFieldMigration } from './add-summary-anchor-message-ids-field';
// Add truncateToDimensions + normalizeL2 columns to embedding_profiles (Matryoshka)
import { addEmbeddingProfileTruncationFieldsMigration } from './add-embedding-profile-truncation-fields';
// Apply Matryoshka truncation to existing stored vectors so they match the active profile
import { applyEmbeddingProfileTruncationMigration } from './apply-embedding-profile-truncation';
// Terminal sessions table for in-chat terminal feature
import { addTerminalSessionsTableMigration } from './add-terminal-sessions-table';
// Terminal Mode fields on chats (split-pane persistence)
import { addTerminalModeFieldsMigration } from './add-terminal-mode-fields';
// Add componentItemIds column to wardrobe_items (composite items)
import { addWardrobeComponentItemIdsMigration } from './add-wardrobe-component-item-ids-v1';
// Migrate outfit_presets rows into composite wardrobe_items
import { migrateOutfitPresetsToCompositesMigration } from './migrate-outfit-presets-to-composites-v1';
// Convert chats.equippedOutfit slot values from UUID|null to UUID[]
import { convertEquippedOutfitToArraysMigration } from './convert-equipped-outfit-to-arrays-v1';
// Drop the outfit_presets table (after backup snapshot)
import { dropOutfitPresetsTableMigration } from './drop-outfit-presets-table-v1';
// Drop the wardrobe_items table (after backup snapshot; gated on vault population)
import { dropWardrobeItemsTableMigration } from './drop-wardrobe-items-table-v1';
// Provision the global Lantern Backgrounds mount point
import { provisionLanternBackgroundsMountMigration } from './provision-lantern-backgrounds-mount';
// Move _general/story-backgrounds/ and root _general/generated_*.webp into Lantern Backgrounds mount
import { migrateGeneralStoryBackgroundsToMountMigration } from './migrate-general-story-backgrounds-to-mount';
// Move character avatars off _general/ into each character's vault under images/
import { migrateCharacterAvatarsToVaultsMigration } from './migrate-character-avatars-to-vaults';
// Provision the global Quilltap Uploads mount point
import { provisionUserUploadsMountMigration } from './provision-user-uploads-mount';
// Sweep any remaining files under _general/ into the Quilltap Uploads mount
import { migrateRemainingGeneralToUploadsMigration } from './migrate-remaining-general-to-uploads';
// Provision the global Quilltap General mount point (houses general Scenarios/)
import { provisionGeneralMountMigration } from './provision-general-mount';
// Add customAnnouncer column to chat_messages (Insert Announcement composer button)
import { addCustomAnnouncerFieldMigration } from './add-custom-announcer-field';
// Add transport column to connection_profiles + pendingExternalPrompt/Attachments columns to chat_messages (The Courier)
import { addCourierTransportFieldsMigration } from './add-courier-transport-fields';
// Add Courier delta-mode column to connection_profiles + courierCheckpoints to chats + pendingExternalPromptFull to chat_messages
import { addCourierDeltaFieldsMigration } from './add-courier-delta-fields';
// Add commonplaceSceneCache column to chats for per-target scene-state diffing
import { addCommonplaceSceneCacheMigration } from './add-commonplace-scene-cache';
// Split doc_mount_files into content + link rows; rekey chunks to linkId
import { addDocMountFileLinksMigration } from './add-doc-mount-file-links';
// Add uncensoredImageDescriptionProfileId column to chat_settings (Phase 2 photos)
import { addUncensoredImageDescriptionProfileFieldMigration } from './add-uncensored-image-description-profile-field';
// Photo gallery Phase 3: mirror CHARACTER-tagged images into each character's vault photos/ folder + atomic cutover
import { migrateCharacterPhotosToVaultMigration } from './migrate-character-photos-to-vault';
// Add opaqueContent column to chat_messages (per-chat opaque-anywhere Staff voicing)
import { addOpaqueContentFieldMigration } from './add-opaque-content-field';
// Repair drifted folderId on doc_mount_file_links rows
import { repairDocMountFileLinkFolderIdsMigration } from './repair-doc-mount-file-link-folderids';
// Add reinforcedImportance index on memories (CLI default sort)
import { addMemoriesReinforcedImportanceIndexMigration } from './add-memories-reinforced-importance-index-v1';
// Scrub dangling relatedMemoryIds left by historical deletion paths
import { repairDanglingRelatedMemoryEdgesV1Migration } from './repair-dangling-related-memory-edges-v1';
// Add pseudoToolMode column to connection_profiles (selects native/simple-json/text-block pseudo-tool surface)
import { addPseudoToolModeFieldMigration } from './add-pseudo-tool-mode-field';
// Reconcile files.mimeType/size with the mount blob (bridges transcode bitmaps to WebP; the FileEntry must reflect what is on disk)
import { repairFilesMimeAndSizeFromMountBlobMigration } from './repair-files-mime-and-size-from-mount-blob';
// Recompute doc_mount_blobs.sha256 from stored bytes; upload paths recorded input-bytes hash instead of stored-bytes hash
import { repairMountBlobSha256FromBytesMigration } from './repair-mount-blob-sha256-from-bytes';
// Per-chat Concierge override (Safe/Flagged/Off-duty tri-state)
import { addChatConciergeOverrideMigration } from './add-chat-concierge-override';
// Add composerSpellcheck column to chat_settings (Composer spellcheck toggle)
import { addComposerSpellcheckFieldMigration } from './add-composer-spellcheck-field';
// Add text_replacement_rules table (Layer 1.5 composer text-replacement rules)
import { addTextReplacementRulesTableMigration } from './add-text-replacement-rules-table';
// Add textReplacementsEnabled column to chat_settings (Layer 1.5 master toggle)
import { addTextReplacementsEnabledFieldMigration } from './add-text-replacements-enabled-field';
// 4.6 character vault cutover: move every content field into the vault and drop the DB columns
import { cutoverCharactersToVaultMigration } from './cutover-characters-to-vault';
// 4.7 project store cutover: move every project field into its official store and drop the DB columns (incl. userId)
import { cutoverProjectsToStoreMigration } from './cutover-projects-to-store';
// Groups: slim groups table (main DB)
import { createGroupsTableMigration } from './create-groups-table';
// Groups: join tables — group_doc_mount_links + group_character_members (mount-index DB)
import { createGroupJoinTablesMigration } from './create-group-join-tables';
// 4.6 private character rooms: schema substrate for autonomous-room runs and scheduling
import { addAutonomousRoomsFieldsMigration } from './add-autonomous-rooms-fields';
// 4.6 turn rotation: persist spokenThisCycle so user characters can join the rotation
import { addSpokenThisCycleFieldMigration } from './add-spoken-this-cycle-field';
// Aurora Core whisper: per-chat + per-character override columns
import { addCoreWhisperFieldsMigration } from './add-core-whisper-fields';
// Aurora Core whisper: global-default column on chat_settings (companion to the override columns above)
import { addCoreWhisperSettingsFieldMigration } from './add-core-whisper-settings-field';
// 4.6 private character rooms: runPausedAt for resume-excludes-paused-time wall-clock accounting
import { addAutonomousRunPausedAtMigration } from './add-autonomous-run-paused-at';
// 4.6 private character rooms: runPausedAccumMs so wall-clock excludes paused time without shifting runStartedAt
import { addAutonomousRunPausedAccumMigration } from './add-autonomous-run-paused-accum';
// Drop the dead singular scenario column from characters (legacy of the scenarios[] array)
import { dropCharacterScenarioColumnMigration } from './drop-character-scenario-column';
// Thinking display: reasoningContent + reasoningSegments columns on chat_messages
import { addChatMessageReasoningColumnsMigration } from './add-chat-message-reasoning-columns';
import { addAnswerConfirmationColumnsMigration } from './add-answer-confirmation-columns';
// Thinking display: showThinking column on chats + thinkingDisplay column on chat_settings
import { addThinkingDisplayFieldsMigration } from './add-thinking-display-fields';
// Add autoScrollOnResponseComplete column to chat_settings (Salon auto-scroll toggle)
import { addAutoScrollOnResponseCompleteFieldMigration } from './add-auto-scroll-on-response-complete-field';
// 4.6 private character rooms: budgetExcludeCacheHits column on chats (optional all-tokens budget mode)
import { addAutonomousBudgetCacheModeMigration } from './add-autonomous-budget-cache-mode';
// 4.6 private character rooms: runMilestonesAnnounced column on chats (per-run pacing-nudge bitmask)
import { addAutonomousRunMilestonesMigration } from './add-autonomous-run-milestones';
// Carina (inline LLM queries): canBeCarina answerer flag on characters
import { addCarinaFlagMigration } from './add-carina-flag-v1';
// Carina (inline LLM queries): carinaMeta provenance column on chat_messages
import { addCarinaMessageMetaMigration } from './add-carina-message-meta-v1';
// Pascal the Croupier (custom pseudo-tools): pascalMeta roll-record column on chat_messages
import { addPascalMessageMetaMigration } from './add-pascal-message-meta-v1';
// RP formatting overhaul: add kind discriminant (wrap/linePrefix) to template delimiters
import { rpDelimiterKindsMigration } from './rp-delimiter-kinds-v1';
// Brahma Console: consoleConnectionProfileId column on chats (per-chat model selection)
import { addConsoleConnectionProfileFieldMigration } from './add-console-connection-profile-field';
// Unique connection-profile names: de-dup + unique index on (userId, lower(trim(name)))
import { addConnectionProfileUniqueNameIndexMigration } from './add-connection-profile-unique-name-index';
// Scriptorium per-document policy: allowEmbed / allowCharacterRead / allowCharacterWrite columns + frontmatter backfill
import { addDocMountFilePolicyFlagsMigration } from './add-doc-mount-file-policy-flags';
// Commonplace recall anti-repetition: commonplaceRecallHistory ring-buffer column on chats
import { addCommonplaceRecallHistoryMigration } from './add-commonplace-recall-history';
// "Nothing to add" turn-skipping: turnSkippingEnabled toggle column on chats
import { addTurnSkippingFieldMigration } from './add-turn-skipping-field';
// DB size reduction: re-pack stored embeddings as int8 (self-describing quantized format)
import { quantizeEmbeddingsMigration } from './quantize-embeddings';
// Pascal's custom pseudo-tools: customTools toggle column on chat_settings
import { addCustomToolsFieldMigration } from './add-custom-tools-field';
// Episodic recall overhaul: occurredAt/narrativeTime/entities/kind on memories + chats.timelineMode
import { addEpisodicMemoryFieldsMigration } from './add-episodic-memory-fields';
// Story clock: backfill timestampConfig.fictionalBaseRealTime so fictional clocks advance
import { anchorFictionalClockBaseMigration } from './anchor-fictional-clock-base';
// Scriptorium hard links: linkGroupId column on doc_mount_file_links + orphaned-content sweep
import { addDocMountLinkGroupsMigration } from './add-doc-mount-link-groups';
// The Almanack: connectionProfileId + imageProfileId attribution columns on llm_logs
import { addLLMLogsProfileColumnsMigration } from './add-llm-logs-profile-columns';

import { addComposerEmojiFieldMigration } from './add-composer-emoji-field';
import { addComposerUnicodeFieldMigration } from './add-composer-unicode-field';
import { addSmartTypographySettingsFieldMigration } from './add-smart-typography-settings-field';
import { createHelpDocChunksTableMigration } from './create-help-doc-chunks-table';
// Per-profile multi-character [Name] turn anchor: multiCharacterPrefill column on connection_profiles
import { addProfileMultiCharacterPrefillFieldMigration } from './add-profile-multi-character-prefill-field';

/**
 * All available migrations.
 * Order here doesn't matter - migrations will be sorted by dependencies.
 *
 * Only includes migrations from v2.7.0 and later.
 */
export const migrations: Migration[] = [
  // Web search decoupling
  addUseNativeWebSearchFieldMigration,
  // Mount points migration
  createMountPointsMigration,
  // Fix missing storage keys
  fixMissingStorageKeysMigration,
  // Fix orphan PERSONA participants
  fixOrphanPersonaParticipantsMigration,
  // Cleanup orphan file records
  cleanupOrphanFileRecordsMigration,
  // LLM logs collection
  addLLMLogsCollectionMigration,
  // SQLite initial schema (only runs on SQLite backend)
  sqliteInitialSchemaMigration,
  // Centralized data directory migration
  migrateToCentralizedDataDirMigration,
  // Per-project mount points
  perProjectMountPointsMigration,
  // Folder entities migration
  createFolderEntitiesMigration,
  // Remove auth tables (single-user mode)
  removeAuthTablesMigration,
  // Re-encrypt API keys after single-user migration
  reencryptApiKeysMigration,
  // Add defaultImageProfileId to characters
  addDefaultImageProfileFieldMigration,
  // Migrate user plugins to site plugins (single-user mode)
  migrateUserPluginsToSiteMigration,
  // Migrate site plugins to data directory
  migrateSitePluginsToDataDirMigration,
  // Drop sync tables (sync functionality removed)
  dropSyncTablesMigration,
  // Add tool settings fields to chats
  addChatToolSettingsFieldsMigration,
  // Add default tool settings fields to projects
  addProjectToolSettingsFieldsMigration,
  // Create embedding tables for built-in TF-IDF provider
  createEmbeddingTablesMigration,
  // Add state fields to chats and projects
  addStateFieldsMigration,
  // Add autoDetectRng field to chat_settings
  addAutoDetectRngFieldMigration,
  // Add compressionCache field to chats
  addCompressionCacheFieldMigration,
  // Add agent mode fields
  addAgentModeFieldsMigration,
  // Add story backgrounds fields
  addStoryBackgroundsFieldsMigration,
  // Add imageProfileId field to chats (per-chat instead of per-participant)
  addChatImageProfileFieldMigration,
  // Add dangerous content handling fields
  addDangerousContentFieldsMigration,
  // Add chat-level danger classification fields
  addChatDangerClassificationFieldsMigration,
  // Fix chat updatedAt timestamps polluted by background jobs
  fixChatUpdatedAtTimestampsMigration,
  // Add aliases field to characters
  addCharacterAliasesFieldMigration,
  // Add pronouns field to characters
  addCharacterPronounsFieldMigration,
  // Add clothingRecords field to characters
  addCharacterClothingRecordsFieldMigration,
  // Fix chat messageCount to only count visible message bubbles
  fixChatMessageCountsMigration,
  // Add memory gate fields (reinforcement tracking, related links)
  addMemoryGateFieldsMigration,
  // Migrate legacy JSONL file entries to SQLite
  migrateLegacyJsonlFilesMigration,
  // Add missing columns to chat_messages and fix empty JSON strings
  addChatMessageMissingColumnsMigration,
  // Normalize vector embedding storage to Float32 BLOBs
  normalizeVectorStorageMigration,
  // Add allowToolUse field to connection profiles
  addProfileAllowToolUseFieldMigration,
  // Drop mount points system (S3 + mount point abstraction removed)
  dropMountPointsMigration,
  // Move LLM logs to separate database
  moveLLMLogsToSeparateDbMigration,
  // Add fileStatus field to files table
  addFileStatusFieldMigration,
  // Restructure file storage from old users/{userId}/... layout to new flat layout
  restructureFileStorageMigration,
  // Cleanup pass for file storage restructure (category dirs, thumbnails, .DS_Store)
  restructureFileStorageCleanupMigration,
  // Fix TEXT embeddings written back by update path (should be Float32 BLOBs)
  fixTextEmbeddingsAfterUpdateMigration,
  // Add sortIndex field to connection profiles for custom ordering
  addConnectionProfileSortIndexMigration,
  // Drop encryption columns from api_keys (ciphertext → key_value, drop iv/authTag)
  dropApiKeyEncryptionColumnsMigration,
  // Decrypt API key values left as ciphertext after column rename
  decryptApiKeyValuesMigration,
  // Drop pepper_vault table (encryption simplified)
  dropPepperVaultMigration,
  // Add whisper target field to chat_messages
  addWhisperTargetFieldMigration,
  // Add turn queue field to chats for server-side turn management
  addTurnQueueFieldMigration,
  // Add scene state tracking field to chats
  addSceneStateFieldMigration,
  // Add help tools field to characters
  addHelpToolsFieldMigration,
  // Add auto-lock settings field to chat_settings
  addAutoLockSettingsFieldMigration,
  // Add chatType field to chats for help chat support
  addChatTypeFieldMigration,
  // Create instance_settings table for instance-level configuration
  createInstanceSettingsTableMigration,
  // Migrate participant isActive boolean to status enum
  migrateParticipantStatusFieldMigration,
  // Add isSilentMessage field to chat_messages
  addSilentMessageFieldMigration,
  // Convert character scenario string to scenarios array
  convertScenarioToScenariosMigration,
  // Add defaultTimestampConfig field to characters
  addCharacterTimestampConfigFieldMigration,
  // Add defaultScenarioId and defaultSystemPromptId fields to characters
  addCharacterDefaultIdsFieldsMigration,
  // Add scenarioText field to chats for persisting selected scenario content
  addChatScenarioTextFieldMigration,
  // Add modelClass field to connection profiles for capability tier classification
  addConnectionProfileModelClassFieldMigration,
  // Add maxTokens field to connection profiles for budget-driven compression
  addConnectionProfileMaxTokensFieldMigration,
  // Fix memory timestamps to match source message timestamps
  fixMemoryTimestampsFromSourceMigration,
  // Create wardrobe_items table for modular wardrobe system
  createWardrobeItemsTableMigration,
  // Add equippedOutfit field to chats for per-character outfit tracking
  addEquippedOutfitFieldMigration,
  // Add canDressThemselves and canCreateOutfits flags to characters
  addCharacterWardrobeFlagsMigration,
  // Migrate existing clothing records to wardrobe_items table
  migrateClothingRecordsToWardrobeMigration,
  // Add pendingOutfitNotifications field to chats
  addPendingOutfitNotificationsFieldMigration,
  // Add characterAvatars and avatarGenerationEnabled fields to chats
  addCharacterAvatarsFieldsMigration,
  // Add defaultAvatarGenerationEnabled field to projects
  addProjectAvatarGenerationDefaultMigration,
  // Create outfit_presets table and add archivedAt to wardrobe_items
  createOutfitPresetsAndArchiveMigration,
  // Convert all non-WebP, non-SVG images to WebP format
  convertImagesToWebPMigration,
  // Rename persona DB columns
  renamePersonaColumnsMigration,
  // Add narrationDelimiters field to roleplay_templates
  addNarrationDelimitersFieldMigration,
  // Migrate plugin roleplay templates to native built-in, rename annotationButtons to delimiters
  migratePluginTemplatesToNativeMigration,
  // Add defaultImageProfileId to projects for project-level image profile default
  addProjectDefaultImageProfileMigration,
  // Create character_plugin_data table for per-character per-plugin metadata
  createCharacterPluginDataTableMigration,
  // Add renderedMarkdown field to chats for Scriptorium conversation rendering
  addRenderedMarkdownFieldMigration,
  // Create conversation tables for Scriptorium (annotations + chunks)
  createConversationTablesMigration,
  // Create help_docs table for runtime-embedded help documentation
  createHelpDocsTableMigration,
  // Add document mode fields for Scriptorium Phase 3.5
  addDocumentModeFieldsMigration,
  // Add characterDocumentMountPointId field to characters
  addCharacterDocumentMountPointFieldMigration,
  // Add readPropertiesFromDocumentStore field to characters
  addReadPropertiesFromDocumentStoreFieldMigration,
  // Normalise all stored embeddings to unit length for fast cosine similarity
  normalizeEmbeddingsUnitVectorsMigration,
  // Add autoHousekeepingSettings column to chat_settings
  addAutoHousekeepingSettingsFieldMigration,
  // Add memoryExtractionLimits column to chat_settings
  addMemoryExtractionLimitsFieldMigration,
  // Add memoryExtractionConcurrency column to chat_settings
  addMemoryExtractionConcurrencyFieldMigration,
  // Move memory extraction knobs out of chat_settings into instance_settings
  migrateExtractionKnobsToInstanceSettingsMigration,
  // Add supportsImageUpload column to connection_profiles
  addProfileSupportsImageUploadFieldMigration,
  // Add Lantern image alert columns to projects and chats
  addLanternImageAlertFieldsMigration,
  // Convert project file storage into per-project Scriptorium document stores
  convertProjectFilesToDocumentStoresMigration,
  // Add systemSender column to chat_messages
  addSystemSenderFieldMigration,
  // Add allowCrossCharacterVaultReads column to chats
  addChatCrossCharacterVaultReadsFieldMigration,
  // Drop file_permissions table (LLM write approval flow retired)
  dropFilePermissionsMigration,
  // Add systemTransparency column to characters
  addCharacterSystemTransparencyFieldMigration,
  // Add officialMountPointId column to projects + backfill from `Project Files: <name>` stores
  addProjectOfficialMountPointMigration,
  // Add compositionModeDefault column to chat_settings
  addCompositionModeDefaultFieldMigration,
  // Add compiledIdentityStacks column to chats (Phase H system-prompt precompile)
  addCompiledIdentityStacksFieldMigration,
  // Add hostEvent column to chat_messages (per-character Librarian summaries)
  addHostEventFieldMigration,
  // Add systemKind column to chat_messages (Salon collapsed-bar labels)
  addSystemKindFieldMigration,
  // Backfill memories.aboutCharacterId via name-presence heuristic
  alignAboutCharacterIdMigration,
  // v2: re-run with the holder-dominance tiebreaker
  alignAboutCharacterIdV2Migration,
  // Add identity field to characters table
  addCharacterIdentityFieldMigration,
  // Add manifesto field to characters table
  addCharacterManifestoFieldMigration,
  // Add archive-tombstone fields to characters table
  addCharacterArchiveFieldsMigration,
  // Re-absorb leftover project files into database-backed official store
  reabsorbLeftoverProjectFilesMigration,
  // Relink legacy files.storageKey rows to mount-blob shims (Stage-1 follow-up)
  relinkFilesToMountBlobsMigration,
  // Add requestHashes column to llm_logs (cache-stability instrumentation)
  addLLMLogsRequestHashesColumnMigration,
  // Add rawProviderUsage column to llm_logs (Layer-1 raw-usage snapshot)
  addLLMLogsRawProviderUsageColumnMigration,
  // Add autonomousRunId column to llm_logs (per-run budget accounting)
  addLLMLogsAutonomousRunIdColumnMigration,
  // Add summarization-gate tracking columns to chats (triple-gate Phase 2)
  addSummarizationGateFieldsMigration,
  // Add summaryAnchor column to chat_messages (whisper anchoring Phase 3c)
  addSummaryAnchorFieldMigration,
  // Add summaryAnchorMessageIds column to chats (edit-aware invalidation Phase 4)
  addSummaryAnchorMessageIdsFieldMigration,
  // Add Matryoshka truncation columns to embedding_profiles
  addEmbeddingProfileTruncationFieldsMigration,
  // Apply Matryoshka truncation to existing stored vectors
  applyEmbeddingProfileTruncationMigration,
  // Terminal sessions table for in-chat terminal feature
  addTerminalSessionsTableMigration,
  // Terminal Mode fields on chats (split-pane persistence)
  addTerminalModeFieldsMigration,
  // Add componentItemIds column to wardrobe_items (composite items)
  addWardrobeComponentItemIdsMigration,
  // Migrate outfit_presets rows into composite wardrobe_items
  migrateOutfitPresetsToCompositesMigration,
  // Convert chats.equippedOutfit slot values from UUID|null to UUID[]
  convertEquippedOutfitToArraysMigration,
  // Drop the outfit_presets table (after backup snapshot)
  dropOutfitPresetsTableMigration,
  // Drop the wardrobe_items table (after backup snapshot; gated on vault population)
  dropWardrobeItemsTableMigration,
  // Provision the global Lantern Backgrounds mount point
  provisionLanternBackgroundsMountMigration,
  // Move _general/story-backgrounds/ and root _general/generated_*.webp into Lantern Backgrounds mount
  migrateGeneralStoryBackgroundsToMountMigration,
  // Move character avatars off _general/ into each character's vault under images/
  migrateCharacterAvatarsToVaultsMigration,
  // Provision the global Quilltap Uploads mount point
  provisionUserUploadsMountMigration,
  // Sweep any remaining files under _general/ into the Quilltap Uploads mount
  migrateRemainingGeneralToUploadsMigration,
  // Provision the global Quilltap General mount point (houses general Scenarios/)
  provisionGeneralMountMigration,
  // Add customAnnouncer column to chat_messages (Insert Announcement composer button)
  addCustomAnnouncerFieldMigration,
  // Add transport column to connection_profiles + pendingExternalPrompt/Attachments to chat_messages (The Courier)
  addCourierTransportFieldsMigration,
  // Add Courier delta-mode column to connection_profiles + courierCheckpoints to chats + pendingExternalPromptFull to chat_messages
  addCourierDeltaFieldsMigration,
  // Add commonplaceSceneCache column to chats for per-target scene-state diffing
  addCommonplaceSceneCacheMigration,
  // Split doc_mount_files into content + link rows; rekey chunks to linkId
  addDocMountFileLinksMigration,
  // Add uncensoredImageDescriptionProfileId column to chat_settings (Phase 2 photos)
  addUncensoredImageDescriptionProfileFieldMigration,
  // Photo gallery Phase 3: mirror CHARACTER-tagged images into vault photos/ + atomic cutover
  migrateCharacterPhotosToVaultMigration,
  // Add opaqueContent column to chat_messages (per-chat opaque-anywhere Staff voicing)
  addOpaqueContentFieldMigration,
  // Repair drifted folderId on doc_mount_file_links rows
  repairDocMountFileLinkFolderIdsMigration,
  // Add reinforcedImportance index on memories (CLI default sort)
  addMemoriesReinforcedImportanceIndexMigration,
  // Scrub dangling relatedMemoryIds left by historical deletion paths
  repairDanglingRelatedMemoryEdgesV1Migration,
  // Add pseudoToolMode column to connection_profiles
  addPseudoToolModeFieldMigration,
  // Reconcile files.mimeType/size with the mount blob (post-transcode metadata was dropped on the floor)
  repairFilesMimeAndSizeFromMountBlobMigration,
  // Recompute doc_mount_blobs.sha256 from stored bytes; correct paired doc_mount_files.sha256
  repairMountBlobSha256FromBytesMigration,
  // Per-chat Concierge override (Safe/Flagged/Off-duty tri-state)
  addChatConciergeOverrideMigration,
  // Add composerSpellcheck column to chat_settings (Composer spellcheck toggle)
  addComposerSpellcheckFieldMigration,
  // Add text_replacement_rules table (Layer 1.5 composer text-replacement rules)
  addTextReplacementRulesTableMigration,
  // Add textReplacementsEnabled column to chat_settings (Layer 1.5 master toggle)
  addTextReplacementsEnabledFieldMigration,
  // 4.6 character vault cutover: settle every character into its vault and drop the legacy content columns
  cutoverCharactersToVaultMigration,
  // 4.6 private character rooms: schema substrate for autonomous-room runs and scheduling
  addAutonomousRoomsFieldsMigration,
  // 4.6 turn rotation: persist spokenThisCycle so user characters can join the rotation
  addSpokenThisCycleFieldMigration,
  // Aurora Core whisper: per-chat + per-character override columns
  addCoreWhisperFieldsMigration,
  // Aurora Core whisper: global-default column on chat_settings
  addCoreWhisperSettingsFieldMigration,
  // 4.6 private character rooms: runPausedAt for resume-excludes-paused-time wall-clock accounting
  addAutonomousRunPausedAtMigration,
  // 4.6 private character rooms: runPausedAccumMs so wall-clock excludes paused time without shifting runStartedAt
  addAutonomousRunPausedAccumMigration,
  // Drop the dead singular scenario column from characters (legacy of the scenarios[] array)
  dropCharacterScenarioColumnMigration,
  // Thinking display: reasoningContent + reasoningSegments columns on chat_messages
  addChatMessageReasoningColumnsMigration,
  // Thinking display: showThinking (chats) + thinkingDisplay (chat_settings) columns
  addThinkingDisplayFieldsMigration,
  // Salon auto-scroll: autoScrollOnResponseComplete column on chat_settings
  addAutoScrollOnResponseCompleteFieldMigration,
  // 4.6 private character rooms: budgetExcludeCacheHits column on chats (optional all-tokens budget mode)
  addAutonomousBudgetCacheModeMigration,
  // 4.6 private character rooms: runMilestonesAnnounced column on chats (per-run pacing-nudge bitmask)
  addAutonomousRunMilestonesMigration,
  // Answer confirmation: confirmed/notes/revised/original columns on chat_messages + answerConfirmationOverride on chats
  addAnswerConfirmationColumnsMigration,
  // Carina (inline LLM queries): canBeCarina answerer flag on characters
  addCarinaFlagMigration,
  // Carina (inline LLM queries): carinaMeta provenance column on chat_messages
  addCarinaMessageMetaMigration,
  // 4.7 project store cutover: fold each project into its official document store and drop the legacy columns (incl. userId)
  cutoverProjectsToStoreMigration,
  // Groups: slim groups table (main DB)
  createGroupsTableMigration,
  // Groups: join tables — group_doc_mount_links + group_character_members (mount-index DB)
  createGroupJoinTablesMigration,
  // RP formatting overhaul: add kind discriminant (wrap/linePrefix) to template delimiters
  rpDelimiterKindsMigration,
  // Brahma Console: consoleConnectionProfileId column on chats (per-chat model selection)
  addConsoleConnectionProfileFieldMigration,
  // Unique connection-profile names: de-dup + unique index on (userId, lower(trim(name)))
  addConnectionProfileUniqueNameIndexMigration,
  // Scriptorium per-document policy flags on doc_mount_file_links + frontmatter backfill
  addDocMountFilePolicyFlagsMigration,
  // Commonplace recall anti-repetition: commonplaceRecallHistory ring-buffer column on chats
  addCommonplaceRecallHistoryMigration,
  // "Nothing to add" turn-skipping: turnSkippingEnabled toggle column on chats
  addTurnSkippingFieldMigration,
  // DB size reduction: re-pack stored embeddings as int8 (self-describing quantized format)
  quantizeEmbeddingsMigration,
  // Pascal the Croupier (custom pseudo-tools): pascalMeta roll-record column on chat_messages
  addPascalMessageMetaMigration,
  // Pascal's custom pseudo-tools: customTools toggle column on chat_settings
  addCustomToolsFieldMigration,
  // Episodic recall overhaul: occurredAt/narrativeTime/entities/kind on memories + chats.timelineMode
  addEpisodicMemoryFieldsMigration,
  // Story clock: backfill timestampConfig.fictionalBaseRealTime so fictional clocks advance
  anchorFictionalClockBaseMigration,
  // Scriptorium hard links: linkGroupId column on doc_mount_file_links + orphaned-content sweep
  addDocMountLinkGroupsMigration,
  // The Almanack: connectionProfileId + imageProfileId attribution columns on llm_logs
  addLLMLogsProfileColumnsMigration,
  // Layer 2.0e composer emoji: composerEmoji toggle column on chat_settings
  addComposerEmojiFieldMigration,
  // Layer 2.0u composer Unicode: composerUnicode toggle column on chat_settings
  addComposerUnicodeFieldMigration,
  // Layer 1.6 smart typography: smartTypographySettings JSON column on chat_settings
  addSmartTypographySettingsFieldMigration,
  // Section-level help search: help_doc_chunks table
  createHelpDocChunksTableMigration,
  // Per-profile multi-character [Name] turn anchor (replaces the Anthropic-only carve-out)
  addProfileMultiCharacterPrefillFieldMigration,
];

export {
  // Web search decoupling
  addUseNativeWebSearchFieldMigration,
  // Mount points migration
  createMountPointsMigration,
  // Fix missing storage keys
  fixMissingStorageKeysMigration,
  // Fix orphan PERSONA participants
  fixOrphanPersonaParticipantsMigration,
  // Cleanup orphan file records
  cleanupOrphanFileRecordsMigration,
  // LLM logs collection
  addLLMLogsCollectionMigration,
  // SQLite initial schema
  sqliteInitialSchemaMigration,
  // Centralized data directory migration
  migrateToCentralizedDataDirMigration,
  // Per-project mount points
  perProjectMountPointsMigration,
  // Folder entities migration
  createFolderEntitiesMigration,
  // Remove auth tables (single-user mode)
  removeAuthTablesMigration,
  // Re-encrypt API keys after single-user migration
  reencryptApiKeysMigration,
  // Add defaultImageProfileId to characters
  addDefaultImageProfileFieldMigration,
  // Migrate user plugins to site plugins (single-user mode)
  migrateUserPluginsToSiteMigration,
  // Migrate site plugins to data directory
  migrateSitePluginsToDataDirMigration,
  // Drop sync tables (sync functionality removed)
  dropSyncTablesMigration,
  // Add tool settings fields to chats
  addChatToolSettingsFieldsMigration,
  // Add default tool settings fields to projects
  addProjectToolSettingsFieldsMigration,
  // Create embedding tables for built-in TF-IDF provider
  createEmbeddingTablesMigration,
  // Add state fields to chats and projects
  addStateFieldsMigration,
  // Add autoDetectRng field to chat_settings
  addAutoDetectRngFieldMigration,
  // Add compressionCache field to chats
  addCompressionCacheFieldMigration,
  // Add agent mode fields
  addAgentModeFieldsMigration,
  // Add story backgrounds fields
  addStoryBackgroundsFieldsMigration,
  // Add imageProfileId field to chats (per-chat instead of per-participant)
  addChatImageProfileFieldMigration,
  // Add dangerous content handling fields
  addDangerousContentFieldsMigration,
  // Add chat-level danger classification fields
  addChatDangerClassificationFieldsMigration,
  // Fix chat updatedAt timestamps polluted by background jobs
  fixChatUpdatedAtTimestampsMigration,
  // Add aliases field to characters
  addCharacterAliasesFieldMigration,
  // Add pronouns field to characters
  addCharacterPronounsFieldMigration,
  // Add clothingRecords field to characters
  addCharacterClothingRecordsFieldMigration,
  // Fix chat messageCount to only count visible message bubbles
  fixChatMessageCountsMigration,
  // Add memory gate fields (reinforcement tracking, related links)
  addMemoryGateFieldsMigration,
  // Migrate legacy JSONL file entries to SQLite
  migrateLegacyJsonlFilesMigration,
  // Add missing columns to chat_messages and fix empty JSON strings
  addChatMessageMissingColumnsMigration,
  // Normalize vector embedding storage to Float32 BLOBs
  normalizeVectorStorageMigration,
  // Add allowToolUse field to connection profiles
  addProfileAllowToolUseFieldMigration,
  // Drop mount points system (S3 + mount point abstraction removed)
  dropMountPointsMigration,
  // Move LLM logs to separate database
  moveLLMLogsToSeparateDbMigration,
  // Add fileStatus field to files table
  addFileStatusFieldMigration,
  // Restructure file storage from old users/{userId}/... layout to new flat layout
  restructureFileStorageMigration,
  // Cleanup pass for file storage restructure
  restructureFileStorageCleanupMigration,
  // Fix TEXT embeddings written back by update path
  fixTextEmbeddingsAfterUpdateMigration,
  // Add sortIndex field to connection profiles for custom ordering
  addConnectionProfileSortIndexMigration,
  // Drop encryption columns from api_keys (ciphertext → key_value, drop iv/authTag)
  dropApiKeyEncryptionColumnsMigration,
  // Decrypt API key values left as ciphertext after column rename
  decryptApiKeyValuesMigration,
  // Drop pepper_vault table (encryption simplified)
  dropPepperVaultMigration,
  // Add whisper target field to chat_messages
  addWhisperTargetFieldMigration,
  // Add turn queue field to chats for server-side turn management
  addTurnQueueFieldMigration,
  // Add scene state tracking field to chats
  addSceneStateFieldMigration,
  // Add help tools field to characters
  addHelpToolsFieldMigration,
  // Add auto-lock settings field to chat_settings
  addAutoLockSettingsFieldMigration,
  // Add chatType field to chats for help chat support
  addChatTypeFieldMigration,
  // Create instance_settings table for instance-level configuration
  createInstanceSettingsTableMigration,
  // Migrate participant isActive boolean to status enum
  migrateParticipantStatusFieldMigration,
  // Add isSilentMessage field to chat_messages
  addSilentMessageFieldMigration,
  // Convert character scenario string to scenarios array
  convertScenarioToScenariosMigration,
  // Add defaultTimestampConfig field to characters
  addCharacterTimestampConfigFieldMigration,
  // Add defaultScenarioId and defaultSystemPromptId fields to characters
  addCharacterDefaultIdsFieldsMigration,
  // Add scenarioText field to chats for persisting selected scenario content
  addChatScenarioTextFieldMigration,
  // Add modelClass field to connection profiles for capability tier classification
  addConnectionProfileModelClassFieldMigration,
  // Add maxTokens field to connection profiles for budget-driven compression
  addConnectionProfileMaxTokensFieldMigration,
  // Fix memory timestamps to match source message timestamps
  fixMemoryTimestampsFromSourceMigration,
  // Add characterAvatars and avatarGenerationEnabled fields to chats
  addCharacterAvatarsFieldsMigration,
  // Add defaultAvatarGenerationEnabled field to projects
  addProjectAvatarGenerationDefaultMigration,
  // Create outfit_presets table and add archivedAt to wardrobe_items
  createOutfitPresetsAndArchiveMigration,
  // Convert all non-WebP, non-SVG images to WebP format
  convertImagesToWebPMigration,
  // Rename persona DB columns
  renamePersonaColumnsMigration,
  // Add narrationDelimiters field to roleplay_templates
  addNarrationDelimitersFieldMigration,
  // Migrate plugin roleplay templates to native built-in
  migratePluginTemplatesToNativeMigration,
  // Add defaultImageProfileId to projects for project-level image profile default
  addProjectDefaultImageProfileMigration,
  // Create character_plugin_data table for per-character per-plugin metadata
  createCharacterPluginDataTableMigration,
  // Add renderedMarkdown field to chats for Scriptorium conversation rendering
  addRenderedMarkdownFieldMigration,
  // Create conversation tables for Scriptorium (annotations + chunks)
  createConversationTablesMigration,
  // Create help_docs table for runtime-embedded help documentation
  createHelpDocsTableMigration,
  // Add document mode fields for Scriptorium Phase 3.5
  addDocumentModeFieldsMigration,
  // Add characterDocumentMountPointId field to characters
  addCharacterDocumentMountPointFieldMigration,
  // Add readPropertiesFromDocumentStore field to characters
  addReadPropertiesFromDocumentStoreFieldMigration,
  // Normalise all stored embeddings to unit length for fast cosine similarity
  normalizeEmbeddingsUnitVectorsMigration,
  // Add autoHousekeepingSettings column to chat_settings
  addAutoHousekeepingSettingsFieldMigration,
  // Add memoryExtractionLimits column to chat_settings
  addMemoryExtractionLimitsFieldMigration,
  // Add memoryExtractionConcurrency column to chat_settings
  addMemoryExtractionConcurrencyFieldMigration,
  // Move memory extraction knobs out of chat_settings into instance_settings
  migrateExtractionKnobsToInstanceSettingsMigration,
  // Add supportsImageUpload column to connection_profiles
  addProfileSupportsImageUploadFieldMigration,
  // Add Lantern image alert columns to projects and chats
  addLanternImageAlertFieldsMigration,
  // Convert project file storage into per-project Scriptorium document stores
  convertProjectFilesToDocumentStoresMigration,
  // Add systemSender column to chat_messages
  addSystemSenderFieldMigration,
  // Add allowCrossCharacterVaultReads column to chats
  addChatCrossCharacterVaultReadsFieldMigration,
  // Drop file_permissions table (LLM write approval flow retired)
  dropFilePermissionsMigration,
  // Add systemTransparency column to characters
  addCharacterSystemTransparencyFieldMigration,
  // Add officialMountPointId column to projects + backfill from `Project Files: <name>` stores
  addProjectOfficialMountPointMigration,
  // Add compositionModeDefault column to chat_settings
  addCompositionModeDefaultFieldMigration,
  // Add compiledIdentityStacks column to chats (Phase H system-prompt precompile)
  addCompiledIdentityStacksFieldMigration,
  // Add hostEvent column to chat_messages (per-character Librarian summaries)
  addHostEventFieldMigration,
  // Add systemKind column to chat_messages (Salon collapsed-bar labels)
  addSystemKindFieldMigration,
  // Backfill memories.aboutCharacterId via name-presence heuristic
  alignAboutCharacterIdMigration,
  // v2: re-run with the holder-dominance tiebreaker
  alignAboutCharacterIdV2Migration,
  // Add identity field to characters table
  addCharacterIdentityFieldMigration,
  // Add manifesto field to characters table
  addCharacterManifestoFieldMigration,
  // Re-absorb leftover project files into database-backed official store
  reabsorbLeftoverProjectFilesMigration,
  // Relink legacy files.storageKey rows to mount-blob shims (Stage-1 follow-up)
  relinkFilesToMountBlobsMigration,
  // Add requestHashes column to llm_logs (cache-stability instrumentation)
  addLLMLogsRequestHashesColumnMigration,
  // Add rawProviderUsage column to llm_logs (Layer-1 raw-usage snapshot)
  addLLMLogsRawProviderUsageColumnMigration,
  // Add autonomousRunId column to llm_logs (per-run budget accounting)
  addLLMLogsAutonomousRunIdColumnMigration,
  // Add summarization-gate tracking columns to chats (triple-gate Phase 2)
  addSummarizationGateFieldsMigration,
  // Add summaryAnchor column to chat_messages (whisper anchoring Phase 3c)
  addSummaryAnchorFieldMigration,
  // Add summaryAnchorMessageIds column to chats (edit-aware invalidation Phase 4)
  addSummaryAnchorMessageIdsFieldMigration,
  // Add Matryoshka truncation columns to embedding_profiles
  addEmbeddingProfileTruncationFieldsMigration,
  // Apply Matryoshka truncation to existing stored vectors
  applyEmbeddingProfileTruncationMigration,
  // Terminal sessions table
  addTerminalSessionsTableMigration,
  // Terminal Mode fields on chats (split-pane persistence)
  addTerminalModeFieldsMigration,
  // Add componentItemIds column to wardrobe_items (composite items)
  addWardrobeComponentItemIdsMigration,
  // Migrate outfit_presets rows into composite wardrobe_items
  migrateOutfitPresetsToCompositesMigration,
  // Convert chats.equippedOutfit slot values from UUID|null to UUID[]
  convertEquippedOutfitToArraysMigration,
  // Drop the outfit_presets table (after backup snapshot)
  dropOutfitPresetsTableMigration,
  // Drop the wardrobe_items table (after backup snapshot; gated on vault population)
  dropWardrobeItemsTableMigration,
  // Provision the global Lantern Backgrounds mount point
  provisionLanternBackgroundsMountMigration,
  // Move _general/story-backgrounds/ and root _general/generated_*.webp into Lantern Backgrounds mount
  migrateGeneralStoryBackgroundsToMountMigration,
  // Move character avatars off _general/ into each character's vault under images/
  migrateCharacterAvatarsToVaultsMigration,
  // Provision the global Quilltap Uploads mount point
  provisionUserUploadsMountMigration,
  // Sweep any remaining files under _general/ into the Quilltap Uploads mount
  migrateRemainingGeneralToUploadsMigration,
  // Provision the global Quilltap General mount point (houses general Scenarios/)
  provisionGeneralMountMigration,
  // Add customAnnouncer column to chat_messages (Insert Announcement composer button)
  addCustomAnnouncerFieldMigration,
  // Add transport column to connection_profiles + pendingExternalPrompt/Attachments to chat_messages (The Courier)
  addCourierTransportFieldsMigration,
  // Add Courier delta-mode column to connection_profiles + courierCheckpoints to chats + pendingExternalPromptFull to chat_messages
  addCourierDeltaFieldsMigration,
  // Add commonplaceSceneCache column to chats for per-target scene-state diffing
  addCommonplaceSceneCacheMigration,
  // Split doc_mount_files into content + link rows; rekey chunks to linkId
  addDocMountFileLinksMigration,
  // Add uncensoredImageDescriptionProfileId column to chat_settings (Phase 2 photos)
  addUncensoredImageDescriptionProfileFieldMigration,
  // Photo gallery Phase 3: mirror CHARACTER-tagged images into vault photos/ + atomic cutover
  migrateCharacterPhotosToVaultMigration,
  // Add opaqueContent column to chat_messages (per-chat opaque-anywhere Staff voicing)
  addOpaqueContentFieldMigration,
  // Repair drifted folderId on doc_mount_file_links rows
  repairDocMountFileLinkFolderIdsMigration,
  // Add reinforcedImportance index on memories (CLI default sort)
  addMemoriesReinforcedImportanceIndexMigration,
  // Scrub dangling relatedMemoryIds left by historical deletion paths
  repairDanglingRelatedMemoryEdgesV1Migration,
  // Add pseudoToolMode column to connection_profiles
  addPseudoToolModeFieldMigration,
  // Reconcile files.mimeType/size with the mount blob
  repairFilesMimeAndSizeFromMountBlobMigration,
  // Recompute doc_mount_blobs.sha256 from stored bytes; correct paired doc_mount_files.sha256
  repairMountBlobSha256FromBytesMigration,
  // Per-chat Concierge override (Safe/Flagged/Off-duty tri-state)
  addChatConciergeOverrideMigration,
  // Add composerSpellcheck column to chat_settings (Composer spellcheck toggle)
  addComposerSpellcheckFieldMigration,
  // Add text_replacement_rules table (Layer 1.5 composer text-replacement rules)
  addTextReplacementRulesTableMigration,
  // Add textReplacementsEnabled column to chat_settings (Layer 1.5 master toggle)
  addTextReplacementsEnabledFieldMigration,
  // 4.6 private character rooms: schema substrate for autonomous-room runs and scheduling
  addAutonomousRoomsFieldsMigration,
  // 4.6 turn rotation: persist spokenThisCycle so user characters can join the rotation
  addSpokenThisCycleFieldMigration,
  // Aurora Core whisper: per-chat + per-character override columns
  addCoreWhisperFieldsMigration,
  // Aurora Core whisper: global-default column on chat_settings
  addCoreWhisperSettingsFieldMigration,
  // 4.6 private character rooms: runPausedAt for resume-excludes-paused-time wall-clock accounting
  addAutonomousRunPausedAtMigration,
  // 4.6 private character rooms: runPausedAccumMs so wall-clock excludes paused time without shifting runStartedAt
  addAutonomousRunPausedAccumMigration,
  // Thinking display: reasoningContent + reasoningSegments columns on chat_messages
  addChatMessageReasoningColumnsMigration,
  // Thinking display: showThinking (chats) + thinkingDisplay (chat_settings) columns
  addThinkingDisplayFieldsMigration,
  // Salon auto-scroll: autoScrollOnResponseComplete column on chat_settings
  addAutoScrollOnResponseCompleteFieldMigration,
  // 4.6 private character rooms: budgetExcludeCacheHits column on chats (optional all-tokens budget mode)
  addAutonomousBudgetCacheModeMigration,
  // 4.6 private character rooms: runMilestonesAnnounced column on chats (per-run pacing-nudge bitmask)
  addAutonomousRunMilestonesMigration,
  // Answer confirmation: confirmed/notes/revised/original columns on chat_messages + answerConfirmationOverride on chats
  addAnswerConfirmationColumnsMigration,
  // Carina (inline LLM queries): canBeCarina answerer flag on characters
  addCarinaFlagMigration,
  // Carina (inline LLM queries): carinaMeta provenance column on chat_messages
  addCarinaMessageMetaMigration,
  // 4.7 project store cutover
  cutoverProjectsToStoreMigration,
  // Groups: slim groups table (main DB)
  createGroupsTableMigration,
  // Groups: join tables — group_doc_mount_links + group_character_members (mount-index DB)
  createGroupJoinTablesMigration,
  // RP formatting overhaul: add kind discriminant (wrap/linePrefix) to template delimiters
  rpDelimiterKindsMigration,
  // Brahma Console: consoleConnectionProfileId column on chats (per-chat model selection)
  addConsoleConnectionProfileFieldMigration,
  // Unique connection-profile names: de-dup + unique index on (userId, lower(trim(name)))
  addConnectionProfileUniqueNameIndexMigration,
  // Scriptorium per-document policy flags on doc_mount_file_links + frontmatter backfill
  addDocMountFilePolicyFlagsMigration,
  // Commonplace recall anti-repetition: commonplaceRecallHistory ring-buffer column on chats
  addCommonplaceRecallHistoryMigration,
  // "Nothing to add" turn-skipping: turnSkippingEnabled toggle column on chats
  addTurnSkippingFieldMigration,
  // DB size reduction: re-pack stored embeddings as int8 (self-describing quantized format)
  quantizeEmbeddingsMigration,
  // Pascal the Croupier (custom pseudo-tools): pascalMeta roll-record column on chat_messages
  addPascalMessageMetaMigration,
  // Pascal's custom pseudo-tools: customTools toggle column on chat_settings
  addCustomToolsFieldMigration,
  // Episodic recall overhaul: occurredAt/narrativeTime/entities/kind on memories + chats.timelineMode
  addEpisodicMemoryFieldsMigration,
  // Story clock: backfill timestampConfig.fictionalBaseRealTime so fictional clocks advance
  anchorFictionalClockBaseMigration,
  // Scriptorium hard links: linkGroupId column on doc_mount_file_links + orphaned-content sweep
  addDocMountLinkGroupsMigration,
  // The Almanack: connectionProfileId + imageProfileId attribution columns on llm_logs
  addLLMLogsProfileColumnsMigration,
  // Layer 2.0e composer emoji: composerEmoji toggle column on chat_settings
  addComposerEmojiFieldMigration,
  // Layer 2.0u composer Unicode: composerUnicode toggle column on chat_settings
  addComposerUnicodeFieldMigration,
  // Layer 1.6 smart typography: smartTypographySettings JSON column on chat_settings
  addSmartTypographySettingsFieldMigration,
  // Section-level help search: help_doc_chunks table
  createHelpDocChunksTableMigration,
  // Per-profile multi-character [Name] turn anchor (replaces the Anthropic-only carve-out)
  addProfileMultiCharacterPrefillFieldMigration,
};

