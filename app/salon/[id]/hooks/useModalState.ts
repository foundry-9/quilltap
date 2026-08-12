'use client'

import { useState, useCallback } from 'react'

export interface ReattributeDialogState {
  isOpen: boolean
  messageId: string
  currentParticipantId: string | null
}

export interface SelectLLMProfileDialogState {
  isOpen: boolean
  participantId: string
  character: {
    id: string
    name: string
    defaultImage?: { id: string; filepath: string; url?: string } | null
    avatarUrl?: string | null
    defaultConnectionProfileId?: string | null
  } | null
}

export function useModalState() {
  // Simple boolean modals
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [chatProjectModalOpen, setChatProjectModalOpen] = useState(false)
  const [continueChatModalOpen, setContinueChatModalOpen] = useState(false)
  const [mergeConversationModalOpen, setMergeConversationModalOpen] = useState(false)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [searchReplaceModalOpen, setSearchReplaceModalOpen] = useState(false)
  const [bulkReplaceModalOpen, setBulkReplaceModalOpen] = useState(false)
  const [toolSettingsModalOpen, setToolSettingsModalOpen] = useState(false)
  const [runToolModalOpen, setRunToolModalOpen] = useState(false)
  const [stateEditorModalOpen, setStateEditorModalOpen] = useState(false)
  const [allLLMPauseModalOpen, setAllLLMPauseModalOpen] = useState(false)
  const [libraryFilePickerOpen, setLibraryFilePickerOpen] = useState(false)
  const [standaloneGenerateImageOpen, setStandaloneGenerateImageOpen] = useState(false)
  const [insertAnnouncementOpen, setInsertAnnouncementOpen] = useState(false)
  const [composeMailOpen, setComposeMailOpen] = useState(false)
  const [editEnclaveModalOpen, setEditEnclaveModalOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)

  // Complex modal states
  const [modalImage, setModalImage] = useState<{ src: string; filename: string; fileId?: string } | null>(null)
  const [reattributeDialogState, setReattributeDialogState] = useState<ReattributeDialogState | null>(null)
  const [selectLLMProfileDialogState, setSelectLLMProfileDialogState] = useState<SelectLLMProfileDialogState | null>(null)


  // Convenience open/close helpers
  const openGallery = useCallback(() => setGalleryOpen(true), [])
  const closeGallery = useCallback(() => setGalleryOpen(false), [])
  const openChatProject = useCallback(() => setChatProjectModalOpen(true), [])
  const closeChatProject = useCallback(() => setChatProjectModalOpen(false), [])
  const openContinueChat = useCallback(() => setContinueChatModalOpen(true), [])
  const closeContinueChat = useCallback(() => setContinueChatModalOpen(false), [])
  const openMergeConversation = useCallback(() => setMergeConversationModalOpen(true), [])
  const closeMergeConversation = useCallback(() => setMergeConversationModalOpen(false), [])
  const openRename = useCallback(() => setRenameModalOpen(true), [])
  const closeRename = useCallback(() => setRenameModalOpen(false), [])
  const openGenerateImage = useCallback(() => setGenerateImageDialogOpen(true), [])
  const closeGenerateImage = useCallback(() => setGenerateImageDialogOpen(false), [])
  const openAddCharacter = useCallback(() => setAddCharacterDialogOpen(true), [])
  const closeAddCharacter = useCallback(() => setAddCharacterDialogOpen(false), [])
  const openSearchReplace = useCallback(() => setSearchReplaceModalOpen(true), [])
  const closeSearchReplace = useCallback(() => setSearchReplaceModalOpen(false), [])
  const openBulkReplace = useCallback(() => setBulkReplaceModalOpen(true), [])
  const closeBulkReplace = useCallback(() => setBulkReplaceModalOpen(false), [])
  const openToolSettings = useCallback(() => setToolSettingsModalOpen(true), [])
  const closeToolSettings = useCallback(() => setToolSettingsModalOpen(false), [])
  const openRunTool = useCallback(() => setRunToolModalOpen(true), [])
  const closeRunTool = useCallback(() => setRunToolModalOpen(false), [])
  const openStateEditor = useCallback(() => setStateEditorModalOpen(true), [])
  const closeStateEditor = useCallback(() => setStateEditorModalOpen(false), [])
  const openLibraryFilePicker = useCallback(() => setLibraryFilePickerOpen(true), [])
  const closeLibraryFilePicker = useCallback(() => setLibraryFilePickerOpen(false), [])
  const openStandaloneGenerateImage = useCallback(() => setStandaloneGenerateImageOpen(true), [])
  const closeStandaloneGenerateImage = useCallback(() => setStandaloneGenerateImageOpen(false), [])
  const openInsertAnnouncement = useCallback(() => setInsertAnnouncementOpen(true), [])
  const closeInsertAnnouncement = useCallback(() => setInsertAnnouncementOpen(false), [])
  const openComposeMail = useCallback(() => setComposeMailOpen(true), [])
  const closeComposeMail = useCallback(() => setComposeMailOpen(false), [])
  const openEditEnclave = useCallback(() => setEditEnclaveModalOpen(true), [])
  const closeEditEnclave = useCallback(() => setEditEnclaveModalOpen(false), [])

  return {
    // Simple boolean modals
    galleryOpen, setGalleryOpen,
    chatProjectModalOpen,
    continueChatModalOpen,
    mergeConversationModalOpen,
    renameModalOpen,
    generateImageDialogOpen,
    addCharacterDialogOpen,
    searchReplaceModalOpen,
    bulkReplaceModalOpen,
    toolSettingsModalOpen,
    runToolModalOpen,
    stateEditorModalOpen,
    allLLMPauseModalOpen, setAllLLMPauseModalOpen,
    showPreview, setShowPreview,
    showParticipantSidebar, setShowParticipantSidebar,

    // Complex modal states
    modalImage, setModalImage,
    reattributeDialogState, setReattributeDialogState,
    selectLLMProfileDialogState, setSelectLLMProfileDialogState,

    // Convenience helpers
    openGallery, closeGallery,
    openChatProject, closeChatProject,
    openContinueChat, closeContinueChat,
    openMergeConversation, closeMergeConversation,
    openRename, closeRename,
    openGenerateImage, closeGenerateImage,
    openAddCharacter, closeAddCharacter,
    openSearchReplace, closeSearchReplace,
    openBulkReplace, closeBulkReplace,
    openToolSettings, closeToolSettings,
    openRunTool, closeRunTool,
    openStateEditor, closeStateEditor,
    libraryFilePickerOpen,
    openLibraryFilePicker, closeLibraryFilePicker,
    standaloneGenerateImageOpen,
    openStandaloneGenerateImage, closeStandaloneGenerateImage,
    insertAnnouncementOpen,
    openInsertAnnouncement, closeInsertAnnouncement,
    composeMailOpen,
    openComposeMail, closeComposeMail,
    editEnclaveModalOpen,
    openEditEnclave, closeEditEnclave,
  }
}
