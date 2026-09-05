/**
 * Chats API v1 - Actions Index
 *
 * Re-exports all action handlers
 */

export { handleAddTag, handleRemoveTag } from './tags';
export { handleRegenerateTitle } from './title';
export {
  handleImpersonate,
  handleStopImpersonate,
  handleSetActiveSpeaker,
  handleAddParticipantAction,
  handleUpdateParticipantAction,
  handleRemoveParticipantAction,
  handleRebuildSystemPromptAction,
} from './participants';
export { handleTurnAction } from './turn';
export { handleGetAvatars, handleSetAvatar, handleRemoveAvatar } from './avatars';
export { handleBulkReattribute } from './bulk';
export { handleAddToolResult, handleUpdateToolSettings } from './tools';
export { handleQueueMemories, handleExtractMemoriesDryRun } from './memories';
export { handleRecallReplay } from './recall-replay';
export { handleRng } from './rng';
export { handleRunTool } from './run-tool';
export { handleGetState, handleSetState, handleResetState } from './state';
export { handleToggleAgentMode } from './agent-mode';
export { handleRegenerateBackground } from './story-background';
export { handleReclassifyDanger } from './danger-classification';
export { handleGetOutfit, handleGetOutfitSummary, handleEquipSlot } from './outfit';
export { handleToggleAvatarGeneration } from './toggle-avatar-generation';
export { handleRegenerateAvatar } from './regenerate-avatar';
export { handleRenderConversation } from './render-conversation';
export {
  handleActiveDocument,
  handleOpenDocuments,
  handleRecentDocuments,
  handleAccessibleStores,
  handleOpenDocument,
  handleCloseDocument,
  handleReadDocument,
  handleResolveDocument,
  handleWriteDocument,
  handleRenameDocument,
  handleDeleteDocument,
} from './documents';
export type { AccessibleStoreOption, AccessibleStoreKind, ProjectLibraryTarget } from './documents';
export { handleInsertAnnouncement } from './announcement';
export { handleAnnouncementPreview } from './announcement-preview';
export { handleSendMail } from './send-mail';
export { handleMergeConversation } from './merge';
export { handleGetMailbox } from './mailbox';
export { handleGetPhotoAlbums } from './photo-albums';
export type { PhotoAlbumOption, PhotoAlbumKind } from './photo-albums';
export { handleGetGroupStores } from './group-stores';
export { handleExportMarkdown } from './export-markdown';
export { handleSetScenario } from './scenario';
