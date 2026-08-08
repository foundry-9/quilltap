'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import ChatSidebar from '@/components/chat/ChatSidebar'
import SpeakerSelector from '@/components/chat/SpeakerSelector'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/lib/toast'
import { ChatCostSummary } from '@/components/chat/ChatCostSummary'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useStoryBackground } from '@/hooks/useStoryBackground'
import { useChatContext } from '@/components/providers/chat-context'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { usePageToolbar } from '@/components/providers/page-toolbar-provider'
import { HiddenPlaceholder } from '@/components/quick-hide/hidden-placeholder'
import { getPendingMessageNavigation, scrollToMessage } from '@/lib/chat/message-navigation'
import { isChatActiveDangerous } from '@/lib/services/dangerous-content/chat-override'
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer'
import {
  type TurnState,
  type TurnSelectionResult,
  createInitialTurnState,
  calculateTurnStateFromHistory,
  selectNextSpeaker,
  isAllLLMChat,
  computeSkipEligibility,
  qualifiesForTurnSkipping,
  isUserDrivenSeat,
  findActiveUserParticipant,
} from '@/lib/chat/turn-manager'
import type { ChatEvent, ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { RenderingPattern, DialogueDetection, NarrationDelimiters } from '@/lib/schemas/template.types'

// Import extracted hooks
import {
  useChatData,
  useTurnManagement,
  useMessageActions,
  useFileAttachments,
  useAutoScroll,
  useModalState,
  useDraftPersistence,
  useMemoryActions,
  useLLMLogs,
  useParticipants,
  useImpersonation,
  useChatControls,
  useSSEStreaming,
  type SwipeState,
} from './hooks'
import type { Chat, Message, PendingToolResult, CharacterData } from './types'
import { groupToolMessagesIntoAssistants } from './group-tool-messages'
import { buildRenderItems } from './announcement-render-items'
import { isMessageVisibleToOperator } from './whisper-visibility'
import type { ComposerEditorHandle } from '@/components/chat/lexical/types'
import {
  ChatComposer,
  VirtualizedMessageList,
  ChatModals,
} from './components'
import LLMInspectorPanel from '@/components/chat/LLMInspectorPanel'
import { NewChatModal } from '@/components/new-chat/NewChatModal'
import { MergeConversationModal } from '@/components/chat/MergeConversationModal'
import { EditEnclaveModal } from '@/components/new-chat/EditEnclaveModal'
import { WhisperDialog } from '@/components/chat/WhisperDialog'
import { SalonModePanes } from './components/SalonModePanes'
import { useReportWorkspaceBackdrop } from '@/components/workspace/workspace-backdrop'
import { DocumentPaneBinding } from './components/DocumentPaneBinding'
import DocumentPickerModal from './components/DocumentPickerModal'
import SaveImageDialog from './components/SaveImageDialog'
import { TerminalPane } from './components/TerminalPane'
import TerminalSessionPicker from './components/TerminalSessionPicker'
import { useDocumentMode, type DocFocusTarget } from './hooks/useDocumentMode'
import { useTerminalMode, TerminalModeContext } from './hooks/useTerminalMode'
import { Icon } from '@/components/ui/icon'
import { CopyChatIdButton } from '@/components/chat/CopyChatIdButton'

export interface SalonViewProps {
  /** The conversation this Salon tab renders. */
  chatId: string
}

export function SalonView({ chatId }: SalonViewProps) {
  // Keep the internal name `id` (used pervasively below) bound to the prop so
  // the streaming hooks and the ~1700 lines that follow are untouched.
  const id = chatId
  useAvatarDisplay()

  // --- Core data hook ---
  const chatDataHook = useChatData(id)
  const { chat, messages, loading, error, chatSettings, swipeStates, chatPhotoCount, chatMemoryCount } = chatDataHook
  const { setChat, setMessages, setSwipeStates } = chatDataHook
  const { fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount } = chatDataHook

  // --- Story background ---
  // When the backdrop URL changes (active regeneration poll or passive SWR revalidation), refresh
  // the chat so any Lantern announcement posted alongside the new backdrop lands in the UI without
  // requiring the user to leave and return.
  const {
    backgroundUrl: storyBackgroundUrl,
    backgroundFileId: storyBackgroundFileId,
    backgroundFilename: storyBackgroundFilename,
    startPolling: startBackgroundPolling,
  } = useStoryBackground(
    id,
    chat?.projectId,
    chatSettings?.storyBackgroundsSettings?.enabled ?? false,
    () => { void fetchChat() }
  )

  // In the workspace, surrender the story background to the single arbitrated
  // workspace backdrop — a conversation's background always wins (no-op outside
  // the workspace).
  useReportWorkspaceBackdrop(storyBackgroundUrl || null, true)

  // --- UI state that stays in page ---
  // `input` is the EXTERNAL composer value (draft restore / resend / post-send
  // clear / source-mode textarea), NOT a per-keystroke mirror — the Lexical
  // editor owns the live text. `hasComposerContent` is the lightweight Send-
  // button signal. Decoupling these is what stops every keystroke from
  // re-rendering the whole Salon page. See setInput / handleComposerContentChange.
  const [input, setInputState] = useState('')
  const [hasComposerContent, setHasComposerContent] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [viewSourceMessageIds, setViewSourceMessageIds] = useState<Set<string>>(new Set())
  const [expandedSystemMessageIds, setExpandedSystemMessageIds] = useState<Set<string>>(new Set())
  const toggleSystemMessageExpanded = useCallback((messageId: string) => {
    setExpandedSystemMessageIds(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }, [])
  const [roleplayTemplateName, setRoleplayTemplateName] = useState<string | null>(null)
  const [roleplayRenderingPatterns, setRoleplayRenderingPatterns] = useState<RenderingPattern[] | undefined>(undefined)
  const [roleplayDialogueDetection, setRoleplayDialogueDetection] = useState<DialogueDetection | null | undefined>(undefined)
  const [narrationDelimiters, setNarrationDelimiters] = useState<NarrationDelimiters | undefined>(undefined)
  const [turnState, setTurnState] = useState<TurnState>(createInitialTurnState())
  const [turnSelectionResult, setTurnSelectionResult] = useState<TurnSelectionResult | null>(null)
  const [respondingParticipantId, setRespondingParticipantId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [pendingToolResults, setPendingToolResults] = useState<PendingToolResult[]>([])
  const [showAllWhispers, setShowAllWhispers] = useState(false)
  const [whisperTarget, setWhisperTarget] = useState<{ participantId: string; name: string } | null>(null)
  const [saveImageTarget, setSaveImageTarget] = useState<{ messageId: string; attachmentId: string } | null>(null)

  // --- Refs ---
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<ComposerEditorHandle>(null)
  const hasRestoredTurnStateRef = useRef<boolean>(false)
  const triggerContinueModeRef = useRef<(participantId: string, nudge?: boolean) => Promise<void>>(async () => {})
  const wasGeneratingRef = useRef(false)
  const streamingRef = useRef(false)

  // --- Composer input decoupling ---
  // `setInput` is the external/seed writer (draft restore, resend, source-mode,
  // clear); it updates the content-presence flag too. It is NOT called on every
  // keystroke — the editor reports presence via handleComposerContentChange.
  const setInput = useCallback((value: string) => {
    setInputState(value)
    setHasComposerContent(!!value.trim())
  }, [])
  const handleComposerContentChange = useCallback((has: boolean) => {
    setHasComposerContent(has)
  }, [])
  // Passed to sendMessage so its internal setInput('') also clears the editor —
  // an already-empty → empty value transition can't drive the controlled sync.
  const clearComposerInput = useCallback((value: string) => {
    setInput(value)
    if (value === '') inputRef.current?.setMarkdown('')
  }, [setInput])

  // --- Whisper support ---
  const participantNames = useMemo(() => {
    const names: Record<string, string> = {}
    if (chat?.participants) {
      for (const p of chat.participants) {
        if (p.character?.name) {
          names[p.id] = p.character.name
        } else if (p.character?.name && p.controlledBy === 'user') {
          names[p.id] = p.character.name
        }
      }
    }
    return names
  }, [chat?.participants])

  const handleWhisper = useCallback((participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const name = participant?.character?.name || 'Unknown'
    setWhisperTarget({ participantId, name })
  }, [chat?.participants])

  // --- Avatar generation polling ---
  // After triggering avatar generation, poll fetchChat until the avatar updates
  const avatarPollRef = useRef<NodeJS.Timeout | null>(null)
  const avatarPollCountRef = useRef(0)

  const startAvatarPoll = useCallback((characterId: string) => {
    // Snapshot the current avatar URL for this character to detect when it changes
    const participant = chat?.participants.find(p => p.character?.id === characterId)
    const snapshotAvatarUrl = participant?.character?.avatarUrl ?? null

    // Clear any existing poll
    if (avatarPollRef.current) {
      clearInterval(avatarPollRef.current)
    }
    avatarPollCountRef.current = 0

    avatarPollRef.current = setInterval(async () => {
      avatarPollCountRef.current++
      // Poll for up to 2 minutes (24 polls at 5s intervals)
      if (avatarPollCountRef.current > 24) {
        if (avatarPollRef.current) clearInterval(avatarPollRef.current)
        avatarPollRef.current = null
        return
      }
      try {
        const res = await fetch(`/api/v1/chats/${id}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        // Check the enriched participant avatar URL — this changes when avatarOverrides update
        const updatedParticipant = data.chat?.participants?.find(
          (p: { character?: { id?: string } }) => p.character?.id === characterId
        )
        const newAvatarUrl = updatedParticipant?.character?.avatarUrl ?? null
        if (newAvatarUrl && newAvatarUrl !== snapshotAvatarUrl) {
          // Avatar URL changed — do a full fetchChat to update React state
          if (avatarPollRef.current) clearInterval(avatarPollRef.current)
          avatarPollRef.current = null
          await fetchChat()
          showInfoToast('Avatar updated')
        }
      } catch {
        // Silently continue polling
      }
    }, 5000)
  }, [chat?.participants, id, fetchChat])

  // Cleanup avatar polling on unmount
  useEffect(() => {
    return () => {
      if (avatarPollRef.current) {
        clearInterval(avatarPollRef.current)
      }
    }
  }, [])

  const handleRegenerateAvatar = useCallback(async (participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const characterId = participant?.character?.id
    const name = participant?.character?.name || 'Unknown'
    if (!characterId) return
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=regenerate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })
      if (res.ok) {
        showInfoToast(`Avatar regeneration queued for ${name}`)
        startAvatarPoll(characterId)
      } else {
        const data = await res.json().catch(() => ({}))
        showErrorToast(data.error || 'Failed to regenerate avatar')
      }
    } catch {
      showErrorToast('Failed to regenerate avatar')
    }
  }, [chat?.participants, id, startAvatarPoll])

  const userParticipantIdSet = useMemo(() => {
    if (!chat?.participants) return new Set<string>()
    return new Set(
      chat.participants
        .filter(p => p.controlledBy === 'user')
        .map(p => p.id)
    )
  }, [chat?.participants])

  // Pascal's custom-tool roster, read only to decide whether the composer's
  // custom-tools button exists at all — an empty roster means no definitions are
  // in scope and the button would open onto nothing. The dropdown refetches this
  // key itself on open; this read just gates the gutter slot.
  const customToolsQuery = useQuery({
    queryKey: queryKeys.customTools.byChat(id),
    queryFn: ({ signal }) =>
      apiFetch<{ tools: unknown[]; errors?: unknown[] }>(`/api/v1/chats/${id}/custom-tools`, { signal }),
  })
  // Show the gutter button when there is anything to say — a runnable tool OR a
  // definition that failed to load. Gating on tools alone hides the error badge
  // exactly when it is most needed: a user whose only .tool.json is malformed
  // would otherwise get no button, no badge, and no hint that the file was even
  // seen. A broken tool is not the same as no tool, and must not look like one.
  const customToolsAvailable =
    (customToolsQuery.data?.tools?.length ?? 0) > 0 ||
    (customToolsQuery.data?.errors?.length ?? 0) > 0

  const visibleMessages = useMemo(() => {
    return messages.filter(msg =>
      isMessageVisibleToOperator(msg, {
        showAllWhispers,
        userParticipantIds: userParticipantIdSet,
      }),
    )
  }, [messages, showAllWhispers, userParticipantIdSet])

  // Fold character-initiated tool results into the assistant message that
  // called them, so they render inside the character's bubble rather than as
  // standalone rows in the flow. User/Prospero-initiated runs stay standalone.
  // This grouped list drives virtualization and rendering downstream.
  const renderMessages = useMemo(
    () => groupToolMessagesIntoAssistants(visibleMessages),
    [visibleMessages],
  )

  // Layer render-items on top of renderMessages: runs of consecutive collapsed
  // announcements coalesce into one flex-wrapping chip row, so they pack
  // horizontally instead of each taking a full-width virtualized row. Depends on
  // expandedSystemMessageIds because expanding one announcement breaks it out of
  // its group. This is what the virtualizer indexes over.
  const renderItems = useMemo(
    () => buildRenderItems(renderMessages, expandedSystemMessageIds),
    [renderMessages, expandedSystemMessageIds],
  )

  // --- Modal state hook ---
  const modals = useModalState()

  // --- Document Mode hook (Scriptorium Phase 3.5) ---
  // The Librarian announces document opens and saves as ASSISTANT-role system messages, so the
  // user never loses their turn. The hook hands us the server-persisted message; we just append.
  const appendLibrarianMessage = useCallback((message: Message) => {
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev
      return [...prev, message]
    })
  }, [setMessages])
  const documentModeHook = useDocumentMode({
    chatId: id,
    chat,
    onLibrarianMessage: appendLibrarianMessage,
  })
  const [showDocumentPicker, setShowDocumentPicker] = useState(false)

  // --- Terminal Mode hook ---
  // Mirrors Document Mode: persists layout state on the chat record so the
  // pane comes back on reload. The Ariel session-opened announcement is posted
  // server-side when we spawn, so the hook also calls fetchChat after spawn.
  const terminalModeHook = useTerminalMode({
    chatId: id,
    chat,
    fetchChat: () => fetchChat(),
  })
  const terminalCtxValue = useMemo(
    () => ({
      terminalMode: terminalModeHook.terminalMode,
      activeTerminalSessionId: terminalModeHook.activeTerminalSessionId,
    }),
    [terminalModeHook.terminalMode, terminalModeHook.activeTerminalSessionId],
  )

  // --- File attachments hook ---
  const fileHook = useFileAttachments(id, chat?.projectId)
  const { attachedFiles, setAttachedFiles, uploadingFile } = fileHook
  const { handleFileSelect, removeAttachedFile, uploadFile } = fileHook
  const { conflictInfo, isConflictDialogOpen, resolvingConflict, handleConflictResolution, cancelConflict } = fileHook

  // --- Participants hook ---
  const participants = useParticipants({
    chat,
    messages,
    impersonatingParticipantIds: [], // Will be overwritten below after impersonation hook
    turnState,
    turnSelectionResult,
  })

  // --- Impersonation hook ---
  const impersonation = useImpersonation({
    chatId: id,
    chat,
    participantData: participants.participantData,
    fetchChat,
    setSelectLLMProfileDialogState: modals.setSelectLLMProfileDialogState,
  })

  // Re-derive participants with actual impersonation state
  const participantsWithImpersonation = useParticipants({
    chat,
    messages,
    impersonatingParticipantIds: impersonation.impersonatingParticipantIds,
    turnState,
    turnSelectionResult,
  })

  // --- Draft persistence hook ---
  const { persistDraft } = useDraftPersistence({ chatId: id, setInput })
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(`quilltap-draft-${id}`)
    } catch {
      // Ignore
    }
  }, [id])

  // --- Memory actions hook ---
  const memoryActions = useMemoryActions({
    chatId: id,
    chatMemoryCount,
    setChatMemoryCount: chatDataHook.setChatMemoryCount,
    chat,
  })

  // --- LLM logs hook ---
  const llmLogs = useLLMLogs({
    chatId: id,
    messages,
  })
  // Extract stable references for use in effects
  const { toggleInspector, inspectorOpen } = llmLogs

  // --- Chat controls hook ---
  const chatControls = useChatControls({
    chatId: id,
    chat,
    participantData: participantsWithImpersonation.participantData,
    participantsAsBase: participantsWithImpersonation.participantsAsBase,
    isMultiChar: participantsWithImpersonation.isMultiChar,
    isAllLLM: participantsWithImpersonation.isAllLLM,
    allLLMTurnCount: participantsWithImpersonation.allLLMTurnCount,
    effectiveNextSpeakerId: participantsWithImpersonation.effectiveNextSpeakerId,
    userParticipantId: participantsWithImpersonation.userParticipantId,
    turnState,
    streamingRef,
    isPaused,
    setIsPaused,
    fetchChat,
    setTurnState,
    triggerContinueModeRef,
    setChat: (fn) => setChat(fn as any),
    startBackgroundPolling,
  })

  // --- SSE Streaming hook ---
  const sseStreaming = useSSEStreaming({
    chatId: id,
    chat,
    messages,
    setMessages,
    isMultiChar: participantsWithImpersonation.isMultiChar,
    hasActiveCharacters: participantsWithImpersonation.hasActiveCharacters,
    participantsAsBase: participantsWithImpersonation.participantsAsBase,
    isPaused,
    respondingParticipantId,
    setRespondingParticipantId,
    activeTypingParticipantId: impersonation.activeTypingParticipantId,
    impersonatingParticipantIds: impersonation.impersonatingParticipantIds,
    fetchChat,
    scrollOnUserMessage: () => scrollOnUserMessage(),
    scrollOnStreamComplete: () => scrollOnStreamComplete(),
    setAttachedFiles,
    inputRef: inputRef as React.RefObject<ComposerEditorHandle>,
    getFirstCharacterParticipant: participantsWithImpersonation.getFirstCharacterParticipant,
    setPauseState: chatControls.setPauseState,
    onToolResult: (name, success, result) => {
      // React to LLM opening/closing documents
      if (success && (name === 'doc_open_document' || name === 'doc_close_document')) {
        documentModeHook.reloadFromServer()
      }
      // React to LLM writing/moving/deleting files or folders — any of these can
      // invalidate the editor's cached content, mtime, or path. The server-side
      // move handlers sync chat_documents.filePath so the reload picks up the
      // new path automatically; folder-level renames likewise rewrite the
      // prefix. reloadFromServer re-reads the active document (if still open)
      // and refreshes state, keeping the next autosave from racing on a stale
      // mtime or missing path.
      if (
        success &&
        (name === 'doc_write_file' ||
          name === 'doc_move_file' ||
          name === 'doc_move_folder' ||
          name === 'doc_delete_file' ||
          name === 'doc_delete_folder')
      ) {
        documentModeHook.reloadFromServer()
      }
      // React to LLM focusing on document location (the result carries the
      // target document's identity so the correct pane scrolls).
      if (name === 'doc_focus' && success && result) {
        documentModeHook.handleDocFocus(result as DocFocusTarget)
      }
    },
  })

  // Keep refs in sync with SSE streaming state
  triggerContinueModeRef.current = sseStreaming.triggerContinueMode
  streamingRef.current = sseStreaming.streaming || sseStreaming.waitingForResponse

  // The character the human is currently speaking as — resolved exactly the way
  // the server attributes a typed message (`findActiveUserParticipant`, honouring
  // the impersonation overlay), then hydrated with its avatar for the composer-side
  // cue. Null when the human plays no character (e.g. an all-LLM room).
  const speakingAsSeat = useMemo(() => {
    const resolved = findActiveUserParticipant(
      participantsWithImpersonation.participantsAsBase,
      impersonation.activeTypingParticipantId,
      impersonation.impersonatingParticipantIds,
    )
    const seatId = resolved?.id ?? impersonation.activeTypingParticipantId
    if (!seatId) return null
    const p = participantsWithImpersonation.participantData.find(pp => pp.id === seatId)
    if (!p?.character) return null
    return {
      name: p.character.name,
      title: p.character.title ?? null,
      character: {
        defaultImage: p.character.defaultImage ?? null,
        avatarUrl: p.character.avatarUrl ?? null,
      },
    }
  }, [
    participantsWithImpersonation.participantsAsBase,
    participantsWithImpersonation.participantData,
    impersonation.activeTypingParticipantId,
    impersonation.impersonatingParticipantIds,
  ])

  // Bug 49: the composer's speaking-as follows the current user-driven turn.
  // When the rotation lands on a seat the human drives — their own character OR
  // one they are impersonating (Bug 44 overlay) — and that seat *changes*,
  // default the speaking-as to it, so on the impersonated character's own turn
  // you are speaking as them without a manual switch. Keyed on the turn seat, not
  // on the speaking-as value, so a deliberate SpeakerSelector choice made on the
  // same turn still sticks (it moves `activeTypingParticipantId` without moving
  // the turn, and the ref guard below leaves it alone until the turn moves on).
  // Per-turn presentation default: it sets only the client speaking-as, which the
  // send path forwards as `speakingAsParticipantId`, so a typed message is
  // attributed in turn without persisting a per-turn churn to the record.
  const lastFollowedTurnSeatRef = useRef<string | null>(null)
  const {
    impersonatingParticipantIds: impersonatingIdsForFollow,
    activeTypingParticipantId: activeTypingForFollow,
    setActiveTypingParticipantId: setActiveTypingForFollow,
  } = impersonation
  useEffect(() => {
    const nextId = turnSelectionResult?.nextSpeakerId
    if (!nextId) {
      lastFollowedTurnSeatRef.current = null
      return
    }
    const next = participantsWithImpersonation.participantsAsBase.find(p => p.id === nextId)
    if (!next || !isUserDrivenSeat(next, impersonatingIdsForFollow)) {
      lastFollowedTurnSeatRef.current = null
      return
    }
    // Only react when the user-driven turn seat itself changes — not when the
    // human re-picks the speaking-as on the same turn.
    if (lastFollowedTurnSeatRef.current === nextId) return
    lastFollowedTurnSeatRef.current = nextId
    if (activeTypingForFollow !== nextId) {
      setActiveTypingForFollow(nextId)
    }
  }, [
    turnSelectionResult,
    participantsWithImpersonation.participantsAsBase,
    impersonatingIdsForFollow,
    activeTypingForFollow,
    setActiveTypingForFollow,
  ])

  // Bug 48: starting an impersonation hands the current turn to the newly
  // impersonated seat. Impersonating is an explicit "I'll take this character
  // now", so — unless an LLM is mid-generation — move the current turn to that
  // seat. The turn banner then reads its turn and, via the Bug 49 follow above,
  // the composer speaks as it, so a typed message lands in turn. This is a client
  // presentation of the rotation (the same shape `turnSelectionResult` already
  // holds, recomputed from history once a message is sent); an LLM mid-stream is
  // left undisturbed so we never interrupt a generation in flight.
  const handleImpersonateAndTakeTurn = useCallback(async (participantId: string) => {
    await impersonation.handleStartImpersonation(participantId)
    if (!streamingRef.current) {
      setTurnSelectionResult({ nextSpeakerId: participantId, reason: 'queue', cycleComplete: false })
    }
  }, [impersonation])

  // --- Outfit hook ---
  // Collect all character IDs from participants so we can fetch wardrobe for all of them
  // (including user-controlled characters that may not have equipped outfits yet)
  // --- Virtualizer ---
  const getItemKey = useCallback((index: number) => {
    return renderItems[index]?.id ?? index
  }, [renderItems])

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual exposes hooks the React Compiler can't analyse; safe to opt out of compiler optimisation here
  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: () => 150,
    overscan: 5,
    getItemKey,
  })

  // --- Auto-scroll hook ---
  const {
    scrollOnUserMessage,
    scrollOnStreamComplete,
    isAutoScrollEnabled,
    isSettled,
    isAtBottom,
    scrollToBottom,
  } = useAutoScroll({
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    virtualizer,
    messageCount: renderMessages.length,
    itemCount: renderItems.length,
    isStreaming: sseStreaming.streaming,
    isWaitingForResponse: sseStreaming.waitingForResponse,
    streamingContent: sseStreaming.streamingContent,
    isLoading: loading,
    autoScrollOnComplete: chatSettings?.autoScrollOnResponseComplete ?? false,
  })

  // --- Message actions hook ---
  const messageActions = useMessageActions(
    messages,
    setMessages,
    setEditingMessageId,
    setEditContent,
    setViewSourceMessageIds,
    editingMessageId,
    editContent,
    viewSourceMessageIds,
    setInput,
    setAttachedFiles,
    inputRef as React.RefObject<ComposerEditorHandle>,
    messagesEndRef as React.RefObject<HTMLDivElement>,
    chatSettings,
  )

  // --- Unpause callback for turn management ---
  const unpauseChat = useCallback(async () => {
    setIsPaused(false)
    chatControls.userStoppedStreamRef.current = false
    try {
      const response = await fetch(`/api/v1/chats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { isPaused: false } }),
      })
      if (!response.ok) {
        console.error('[Chat] Failed to persist unpause state', response.status)
      }
    } catch (error) {
      console.error('[Chat] Error persisting unpause state', error)
    }
  }, [id, chatControls.userStoppedStreamRef])

  // Stable callback wrapper using ref
  const stableTriggerContinueMode = useCallback(
    async (participantId: string) => {
      await triggerContinueModeRef.current(participantId)
    },
    []
  )

  // --- Turn management hook ---
  const turnManagement = useTurnManagement(
    id,
    participantsWithImpersonation.participantsAsBase,
    participantsWithImpersonation.charactersMap,
    turnState,
    participantsWithImpersonation.userParticipantId,
    participantsWithImpersonation.participantData,
    setTurnState,
    setTurnSelectionResult,
    stableTriggerContinueMode,
    isPaused,
    unpauseChat,
  )

  // --- Document title ---
  useDocumentTitle(chat?.title ?? null)

  // --- Pending tool results ---
  const handleAddPendingToolResult = useCallback((result: Omit<PendingToolResult, 'id' | 'createdAt'>) => {
    const newResult: PendingToolResult = {
      ...result,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    setPendingToolResults(prev => [...prev, newResult])
  }, [])

  const handleRemovePendingToolResult = useCallback((resultId: string) => {
    setPendingToolResults(prev => prev.filter(r => r.id !== resultId))
  }, [])

  // --- Sync storyBackgroundsEnabled ---
  const storyBackgroundsSettingsEnabled = chatSettings?.storyBackgroundsSettings?.enabled
  const { setStoryBackgroundsEnabled } = chatControls
  useEffect(() => {
    if (chatSettings) {
      setStoryBackgroundsEnabled(storyBackgroundsSettingsEnabled ?? false)
    }
  }, [chatSettings, storyBackgroundsSettingsEnabled, setStoryBackgroundsEnabled])

  // --- Calculate turn state when messages change ---
  useEffect(() => {
    if (participantsWithImpersonation.participantsAsBase.length === 0 || messages.length === 0) return

    const messageEvents = messages.map(m => ({
      type: 'message' as const,
      id: m.id,
      role: m.role as 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
      content: m.content,
      participantId: m.participantId,
      createdAt: m.createdAt,
      attachments: m.attachments?.map(a => a.id) ?? [],
      targetParticipantIds: m.targetParticipantIds ?? null,
      // Staff fields so turn-pass records (systemSender='host', systemKind='turn-pass')
      // are recognized by calculateTurnStateFromHistory / the skip guard.
      systemSender: m.systemSender ?? null,
      systemKind: m.systemKind ?? null,
      hostEvent: m.hostEvent ?? null,
    }))

    const newTurnState = calculateTurnStateFromHistory({
      // Cast: the client Message shape carries nullable hostEvent fields the
      // schema MessageEvent narrows; the turn-state reader only reads them.
      messages: messageEvents as unknown as Parameters<typeof calculateTurnStateFromHistory>[0]['messages'],
      participants: participantsWithImpersonation.participantsAsBase,
      userParticipantId: participantsWithImpersonation.userParticipantId,
      spokenThisCycleParticipantIds: chat?.spokenThisCycleParticipantIds,
    })

    setTurnState(newTurnState)

    let result = selectNextSpeaker(
      participantsWithImpersonation.participantsAsBase,
      participantsWithImpersonation.charactersMap,
      newTurnState,
      participantsWithImpersonation.userParticipantId
    )

    if (!hasRestoredTurnStateRef.current && chat?.lastTurnParticipantId !== undefined) {
      hasRestoredTurnStateRef.current = true
      const persistedParticipantId = chat.lastTurnParticipantId
      const chatIsAllLLM = isAllLLMChat(participantsWithImpersonation.participantsAsBase)

      if (persistedParticipantId === null) {
        if (result.nextSpeakerId !== null && !chatIsAllLLM) {
          result = { ...result, nextSpeakerId: null, reason: 'user_turn' }
        }
      } else {
        const persistedParticipant = participantsWithImpersonation.participantsAsBase.find(
          p => p.id === persistedParticipantId && p.isActive
        )
        if (persistedParticipant && result.nextSpeakerId !== persistedParticipantId) {
          result = { ...result, nextSpeakerId: persistedParticipantId, reason: 'queue' }
        }
      }
    }

    setTurnSelectionResult(result)
  }, [messages, participantsWithImpersonation.participantsAsBase, participantsWithImpersonation.userParticipantId, participantsWithImpersonation.charactersMap, chat?.lastTurnParticipantId, chat?.spokenThisCycleParticipantIds])

  // --- Handle scroll-to-message from memory provenance navigation ---
  useEffect(() => {
    if (loading || messages.length === 0) return
    const pendingNav = getPendingMessageNavigation()
    if (pendingNav.scrollTo) {
      setTimeout(() => {
        scrollToMessage(pendingNav.scrollTo!, {
          behavior: 'smooth',
          highlight: !!pendingNav.highlight,
          highlightDuration: 3000,
        })
      }, 500)
    }
  }, [loading, messages.length])

  // --- Quick-hide logic ---
  const chatContext = useChatContext()
  const { shouldHideByIds, hiddenTagIds } = useQuickHide()
  const quickHideActive = hiddenTagIds.size > 0
  const isCurrentChat = chatContext.chatId === id
  const chatTags = chatContext.tags.map(tag => tag.id)
  const awaitingTagInfo = quickHideActive && isCurrentChat && !chatContext.tagsFetched
  const chatHidden = quickHideActive && isCurrentChat && chatContext.tagsFetched && shouldHideByIds(chatTags)

  // --- Initialization effects ---
  useEffect(() => {
    fetchChat()
    fetchChatSettings()
    fetchChatPhotoCount()
    fetchChatMemoryCount()
  }, [fetchChat, fetchChatSettings, fetchChatPhotoCount, fetchChatMemoryCount])

  // When a TerminalEmbed reports its PTY has exited, refresh the chat so the
  // new Ariel close announcement appears inline.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail
      if (!detail?.chatId || detail.chatId !== id) return
      void fetchChat()
    }
    window.addEventListener('quilltap:terminal-exited', handler)
    return () => window.removeEventListener('quilltap:terminal-exited', handler)
  }, [id, fetchChat])

  // The terminal WebSocket pushes `chat-update` server messages when something
  // (e.g., an Ariel periodic terminal-output summary) gets posted to the chat
  // out-of-band. Refetch so the new message shows up without a manual reload.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail
      if (!detail?.chatId || detail.chatId !== id) return
      void fetchChat()
    }
    window.addEventListener('quilltap:chat-update', handler)
    return () => window.removeEventListener('quilltap:chat-update', handler)
  }, [id, fetchChat])

  useEffect(() => {
    const fetchTemplateData = async () => {
      if (!chat?.roleplayTemplateId) {
        setRoleplayTemplateName(null)
        setRoleplayRenderingPatterns(undefined)
        setRoleplayDialogueDetection(undefined)
        setNarrationDelimiters(undefined)
        return
      }
      try {
        const res = await fetch(`/api/v1/roleplay-templates/${chat.roleplayTemplateId}`)
        if (res.ok) {
          const template = await res.json()
          setRoleplayTemplateName(template.name)
          setRoleplayRenderingPatterns(template.renderingPatterns)
          setRoleplayDialogueDetection(template.dialogueDetection)
          setNarrationDelimiters(template.narrationDelimiters)
        } else {
          setRoleplayTemplateName(null)
          setRoleplayRenderingPatterns(undefined)
          setRoleplayDialogueDetection(undefined)
          setNarrationDelimiters(undefined)
        }
      } catch {
        setRoleplayTemplateName(null)
        setRoleplayRenderingPatterns(undefined)
        setRoleplayDialogueDetection(undefined)
        setNarrationDelimiters(undefined)
      }
    }
    fetchTemplateData()
  }, [chat?.roleplayTemplateId])

  // --- Editor focus effect ---
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Focus textarea when generation completes + refresh LLM logs
  useEffect(() => {
    const isGenerating = sseStreaming.streaming || sseStreaming.waitingForResponse || sseStreaming.sending
    if (wasGeneratingRef.current && !isGenerating) {
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 100)
      // Refresh LLM logs after generation completes
      llmLogs.refreshLogs()
    }
    wasGeneratingRef.current = isGenerating
  // eslint-disable-next-line react-hooks/exhaustive-deps -- llmLogs.refreshLogs is stable (useCallback)
  }, [sseStreaming.streaming, sseStreaming.waitingForResponse, sseStreaming.sending, llmLogs.refreshLogs])

  // Refetch document content after LLM response completes when a document is open.
  // Always refetch rather than trying to detect doc_* edits — reading a file is cheap
  // and this avoids race conditions with pendingToolCalls being cleared.
  const wasGeneratingForDocRef = useRef(false)
  useEffect(() => {
    const isGenerating = sseStreaming.streaming || sseStreaming.waitingForResponse || sseStreaming.sending
    if (wasGeneratingForDocRef.current && !isGenerating && documentModeHook.documentActive) {
      documentModeHook.handleLLMEditEnd()
    }
    wasGeneratingForDocRef.current = isGenerating
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLLMEditEnd is stable (useCallback)
  }, [sseStreaming.streaming, sseStreaming.waitingForResponse, sseStreaming.sending, documentModeHook.documentActive])

  // Keyboard shortcut: Cmd+Shift+L / Ctrl+Shift+L to toggle inspector
  const llmLoggingEnabled = chatSettings?.llmLoggingSettings?.enabled !== false
  useEffect(() => {
    if (!llmLoggingEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        toggleInspector()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [llmLoggingEnabled, toggleInspector])

  // Keyboard shortcuts for Document Mode (Scriptorium Phase 3.5)
  useEffect(() => {
    const handleDocKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+D / Ctrl+Shift+D: Toggle document mode (normal ↔ split)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        if (documentModeHook.documentMode === 'normal') {
          if (documentModeHook.activeDocument) {
            // Re-open existing document in split mode
            documentModeHook.toggleFocusMode()
          } else {
            // No document open — show picker
            setShowDocumentPicker(true)
          }
        } else {
          documentModeHook.closeDocument()
        }
        return
      }

      // Cmd+Shift+F / Ctrl+Shift+F: Toggle focus mode (split ↔ focus)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
        if (documentModeHook.documentMode !== 'normal' && documentModeHook.activeDocument) {
          e.preventDefault()
          documentModeHook.toggleFocusMode()
        }
        return
      }

      // Escape: Exit focus mode to split
      if (e.key === 'Escape' && documentModeHook.documentMode === 'focus') {
        e.preventDefault()
        documentModeHook.toggleFocusMode()
      }
    }

    document.addEventListener('keydown', handleDocKeyDown)
    return () => document.removeEventListener('keydown', handleDocKeyDown)
  }, [documentModeHook])

  // Keyboard shortcuts for Terminal Mode (mirrors Document Mode's pattern).
  useEffect(() => {
    const handleTerminalKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+T / Ctrl+Shift+T: toggle Terminal Mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        if (terminalModeHook.terminalMode === 'normal') {
          void terminalModeHook.requestOpen()
        } else {
          void terminalModeHook.hidePane()
        }
        return
      }

      // Escape exits terminal focus back to split.
      if (e.key === 'Escape' && terminalModeHook.terminalMode === 'focus') {
        e.preventDefault()
        terminalModeHook.toggleFocusMode()
      }
    }

    document.addEventListener('keydown', handleTerminalKeyDown)
    return () => document.removeEventListener('keydown', handleTerminalKeyDown)
  }, [terminalModeHook])

  // --- Toolbar setup ---
  const { setLeftContent, setRightContent } = usePageToolbar()

  // Extract stable setter from modals to avoid unstable object reference in effect deps
  const { setModalImage } = modals

  // Create a stable key for character list to avoid re-running the effect on every render
  // (useParticipants returns a new array reference each time)
  const llmCharacters = participantsWithImpersonation.llmCharacters
  const llmCharacterKey = llmCharacters.map(c => c.id).join(',')

  useEffect(() => {
    if (chat?.title) {
      const getCharacterAvatarUrl = (character: CharacterData): string | null => {
        if (character.defaultImage?.url) return character.defaultImage.url
        if (character.defaultImage?.filepath) return character.defaultImage.filepath.startsWith('/') ? character.defaultImage.filepath : `/${character.defaultImage.filepath}`
        if (character.avatarUrl) return character.avatarUrl.startsWith('/') ? character.avatarUrl : `/${character.avatarUrl}`
        return null
      }

      setLeftContent(
        <div className="hidden md:flex items-center gap-2 text-sm min-w-0">
          {chat.projectId && chat.projectName && (
            <>
              <a
                href={`/projects/${chat.projectId}`}
                className="inline-flex items-center gap-1.5 qt-text-secondary hover:text-foreground transition-colors flex-shrink-0"
              >
                <Icon name="folder" className="w-4 h-4" />
                <span>{chat.projectName}</span>
              </a>
              <span className="qt-text-muted">/</span>
            </>
          )}
          {llmCharacters.map((character) => {
            const avatarUrl = getCharacterAvatarUrl(character)
            return (
              <span key={character.id} className="contents">
                <a
                  href={`/aurora/${character.id}/view?tab=conversations`}
                  className="inline-flex items-center gap-1.5 qt-text-secondary hover:text-foreground transition-colors flex-shrink-0"
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={character.name}
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full qt-bg-muted flex items-center justify-center">
                      <span className="text-xs font-medium qt-text-secondary">
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <span>{character.name}</span>
                </a>
                <span className="qt-text-muted">/</span>
              </span>
            )
          })}
          {storyBackgroundUrl && (
            <button
              type="button"
              onClick={() => setModalImage({
                src: storyBackgroundUrl,
                filename: storyBackgroundFilename || 'story_background.png',
                fileId: storyBackgroundFileId || undefined,
              })}
              className="flex-shrink-0 rounded overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all"
              title="View story background"
            >
              <img
                src={storyBackgroundUrl}
                alt="Story background"
                className="w-8 h-5 object-cover"
              />
            </button>
          )}
          {chat.conciergeOverride === 'OFF' ? (
            <span
              className="qt-danger-badge flex-shrink-0"
              title="The Concierge is off-duty for this chat. No moderation, no rerouting — set from the sidebar's Chat section."
            >
              <Icon name="check-circle" className="w-3 h-3" />
              Off-duty
            </span>
          ) : chat.isDangerousChat ? (
            <span
              className="qt-danger-badge flex-shrink-0"
              title={`The Concierge has flagged this chat${chat.dangerCategories?.length ? `: ${chat.dangerCategories.join(', ')}` : ''}`}
            >
              <Icon name="alert-triangle" className="w-3 h-3" />
              Flagged
            </span>
          ) : null}
          <a
            href={`/salon/${id}`}
            className="qt-text-primary truncate hover:text-foreground transition-colors"
            title={chat.title}
          >
            {chat.title}
          </a>
          <CopyChatIdButton chatId={id} variant="inline" />
        </div>
      )
    } else {
      setLeftContent(null)
    }
    return () => setLeftContent(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- llmCharacterKey is a stable string proxy for the llmCharacters array
  }, [chat?.projectId, chat?.projectName, chat?.title, chat?.isDangerousChat, chat?.dangerCategories, chat?.conciergeOverride, llmCharacterKey, setLeftContent, storyBackgroundUrl, storyBackgroundFileId, storyBackgroundFilename, setModalImage])

  // Set cost summary and inspector button in toolbar right section
  useEffect(() => {
    const showChatTotals = chatSettings?.tokenDisplaySettings?.showChatTotals
    const showInspectorButton = chatSettings?.llmLoggingSettings?.enabled !== false

    if (showChatTotals || showInspectorButton) {
      setRightContent(
        <div className="flex items-center gap-2">
          {showInspectorButton && (
            <button
              type="button"
              onClick={toggleInspector}
              className={`p-1.5 rounded transition-colors ${
                inspectorOpen
                  ? 'qt-bg-primary/15 text-primary'
                  : 'qt-text-secondary hover:text-foreground'
              }`}
              title="LLM Inspector (Cmd+Shift+L)"
              aria-label="Toggle LLM Inspector"
            >
              <Icon name="code" className="w-4 h-4" />
            </button>
          )}
          {showChatTotals && (
            <ChatCostSummary
              chatId={id}
              show={showChatTotals}
              variant="compact"
              refreshKey={messages.length}
            />
          )}
        </div>
      )
    } else {
      setRightContent(null)
    }
    return () => setRightContent(null)
  }, [id, chatSettings?.tokenDisplaySettings?.showChatTotals, chatSettings?.llmLoggingSettings?.enabled, setRightContent, messages.length, toggleInspector, inspectorOpen])

  // --- UI helpers ---
  const shouldShowAvatars = useCallback(() => {
    if (!chatSettings) return true
    return chatSettings.avatarDisplayMode === 'ALWAYS'
  }, [chatSettings])

  const getRespondingCharacter = useCallback(() => {
    if (respondingParticipantId) {
      const participant = chat?.participants.find(p => p.id === respondingParticipantId)
      if (participant?.character) {
        return participant.character
      }
    }
    return participantsWithImpersonation.getFirstCharacter() ?? undefined
  }, [respondingParticipantId, chat?.participants, participantsWithImpersonation])

  const getMessageAvatar = useCallback((message: Message) => {
    // Ad-hoc announcement bubble (Insert Announcement composer button).
    // customAnnouncer takes precedence over systemSender by construction:
    // the writer only sets one or the other per message.
    if (message.customAnnouncer) {
      if (message.customAnnouncer.kind === 'character' && message.customAnnouncer.characterId) {
        const charId = message.customAnnouncer.characterId
        const participant = chat?.participants.find(p => p.character?.id === charId)
        if (participant?.character) {
          return {
            name: participant.character.name,
            title: participant.character.title ?? null,
            avatarUrl: participant.character.avatarUrl ?? null,
            defaultImage: participant.character.defaultImage ?? null,
          }
        }
        const offScene = chat?.offSceneCharacters?.find(c => c.id === charId)
        if (offScene) {
          return {
            name: offScene.name,
            title: offScene.title,
            avatarUrl: offScene.avatarUrl,
            defaultImage: null,
          }
        }
        // Character no longer exists; render with a placeholder name so the
        // bubble is still legible.
        return { name: 'Off-scene character', title: null, avatarUrl: null, defaultImage: null }
      }
      if (message.customAnnouncer.kind === 'custom') {
        return {
          name: message.customAnnouncer.displayName || 'Announcement',
          title: null,
          avatarUrl: null,
          defaultImage: null,
        }
      }
    }
    if (message.systemSender === 'lantern') {
      return { name: 'The Lantern', title: null, avatarUrl: '/images/avatars/lantern-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'aurora') {
      return { name: 'Aurora', title: null, avatarUrl: '/images/avatars/aurora-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'librarian') {
      return { name: 'The Librarian', title: null, avatarUrl: '/images/avatars/librarian-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'concierge') {
      return { name: 'The Concierge', title: null, avatarUrl: '/images/avatars/concierge-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'prospero') {
      return { name: 'Prospero', title: null, avatarUrl: '/images/avatars/prospero-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'host') {
      return { name: 'The Host', title: null, avatarUrl: '/images/avatars/host-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'commonplaceBook') {
      return { name: 'The Commonplace Book', title: null, avatarUrl: '/images/avatars/commonplace-book-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'ariel') {
      return { name: 'Ariel', title: null, avatarUrl: '/images/avatars/ariel-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'suparna') {
      return { name: 'Suparṇā', title: null, avatarUrl: '/images/avatars/suparna-avatar.webp', defaultImage: null }
    }
    if (message.systemSender === 'pascal') {
      return { name: 'Pascal', title: 'the Croupier', avatarUrl: '/images/avatars/pascal-avatar.webp', defaultImage: null }
    }
    // Carina (inline LLM queries): a reference answer renders with the ANSWERER
    // character's own avatar — there is no dedicated Carina staff avatar. Resolve
    // them via carinaMeta.answererId among participants, then off-scene cards,
    // then a legible placeholder.
    if (message.systemSender === 'carina') {
      const answererId = message.carinaMeta?.answererId
      // The Brahma Console pseudocharacter has no character record; render its
      // reference card with the dedicated Brahma name + avatar.
      if (answererId === BRAHMA_CARINA_ANSWERER_ID) {
        return { name: 'Brahma', title: null, avatarUrl: '/images/avatars/brahma-avatar.webp', defaultImage: null }
      }
      if (answererId) {
        const participant = chat?.participants.find(p => p.character?.id === answererId)
        if (participant?.character) {
          return {
            name: participant.character.name,
            title: participant.character.title ?? null,
            avatarUrl: participant.character.avatarUrl ?? null,
            defaultImage: participant.character.defaultImage ?? null,
          }
        }
        const offScene = chat?.offSceneCharacters?.find(c => c.id === answererId)
        if (offScene) {
          return { name: offScene.name, title: offScene.title, avatarUrl: offScene.avatarUrl, defaultImage: null }
        }
      }
      return { name: 'Carina', title: null, avatarUrl: null, defaultImage: null }
    }
    if (message.participantId) {
      const participant = participantsWithImpersonation.getParticipantById(message.participantId)
      if (participant) {
        if (participant.type === 'CHARACTER' && participant.character) {
          return { name: participant.character.name, title: participant.character.title, avatarUrl: participant.character.avatarUrl, defaultImage: participant.character.defaultImage }
        }
      }
    }
    if (message.role === 'USER') {
      const userChar = participantsWithImpersonation.getFirstUserCharacter()
      if (userChar) {
        return { name: userChar.name, title: userChar.title, avatarUrl: userChar.avatarUrl, defaultImage: userChar.defaultImage }
      } else if (chat?.user) {
        return { name: chat.user.name || 'User', title: null, avatarUrl: chat.user.image ?? null, defaultImage: null }
      }
    } else if (message.role === 'ASSISTANT') {
      const character = participantsWithImpersonation.getFirstCharacter()
      if (character) {
        return { name: character.name, title: character.title, avatarUrl: character.avatarUrl, defaultImage: character.defaultImage }
      }
    }
    return null
  }, [participantsWithImpersonation, chat?.user, chat?.participants, chat?.offSceneCharacters])

  // --- Reattribute handler ---
  const handleReattribute = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      modals.setReattributeDialogState({
        isOpen: true,
        messageId,
        currentParticipantId: message.participantId || null,
      })
    }
  }, [messages, modals])

  // Terminal Mode entry: hook decides whether to re-attach a still-live bound
  // session, show the session picker, or spawn-and-enter a fresh one.
  const handleOpenTerminal = useCallback(() => {
    void terminalModeHook.requestOpen()
  }, [terminalModeHook])

  // Handle document open — opens the document; the server posts a Librarian announcement which
  // the hook surfaces via onLibrarianMessage, so the user never loses their turn.
  const handleOpenDocument = useCallback(async (params: Parameters<typeof documentModeHook.openDocument>[0]) => {
    await documentModeHook.openDocument(params)
  }, [documentModeHook])

  const handleReattributed = useCallback(async () => {
    const messageId = modals.reattributeDialogState?.messageId
    modals.setReattributeDialogState(null)
    await fetchChat()
    if (messageId) {
      setTimeout(() => {
        const messageElement = document.getElementById(`message-${messageId}`)
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    }
  }, [fetchChat, modals])

  // Surface the all-LLM pause so it is no longer silent. The pause fires
  // server-side (isPaused set at the turn-count threshold) and the chain-complete
  // SSE event triggers fetchChat, so chat.isPaused flips to true both on a live
  // pause and when loading an already-paused all-LLM room. Keying the opener off
  // that projected field covers both cases without touching the SSE transport.
  // Only fires when the value transitions, so closing the modal (Continue/Stop/
  // Take Over) will not immediately reopen it.
  const { setAllLLMPauseModalOpen } = modals
  useEffect(() => {
    if (chat?.isPaused && participantsWithImpersonation.isAllLLM) {
      setAllLLMPauseModalOpen(true)
    }
  }, [chat?.isPaused, participantsWithImpersonation.isAllLLM, setAllLLMPauseModalOpen])

  // --- All-LLM pause handlers ---
  const handleAllLLMContinue = useCallback(() => {
    modals.setAllLLMPauseModalOpen(false)
  }, [modals])

  const handleAllLLMStop = useCallback(() => {
    modals.setAllLLMPauseModalOpen(false)
    chatControls.setPauseState(true)
  }, [modals, chatControls])

  const handleAllLLMTakeOver = useCallback(async (participantId: string) => {
    modals.setAllLLMPauseModalOpen(false)
    await handleImpersonateAndTakeTurn(participantId)
  }, [modals, handleImpersonateAndTakeTurn])

  // --- Early returns ---
  if (awaitingTagInfo) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg qt-text-secondary">Loading chat...</p>
      </div>
    )
  }

  if (chatHidden) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <HiddenPlaceholder />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading chat...</p>
      </div>
    )
  }

  if (error || !chat) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg qt-text-destructive">Error: {error || 'Chat not found'}</p>
      </div>
    )
  }

  // --- Render ---
  // Combine the two modes for SplitLayout. Focus on either side wins; otherwise
  // either-side split wins; otherwise normal.
  const combinedMode: 'normal' | 'split' | 'focus' =
    documentModeHook.documentMode === 'focus' || terminalModeHook.terminalMode === 'focus'
      ? 'focus'
      : documentModeHook.documentMode === 'split' || terminalModeHook.terminalMode === 'split'
        ? 'split'
        : 'normal'

  const isTerminalModeActive = terminalModeHook.terminalMode !== 'normal'

  return (
    <TerminalModeContext.Provider value={terminalCtxValue}>
    <div
      className="qt-chat-layout"
      style={storyBackgroundUrl ? { '--story-background-url': `url('${storyBackgroundUrl}')` } as React.CSSProperties : undefined}
    >
      <div className="qt-chat-main">
        <SalonModePanes
          parentChatId={id}
          chatTitle={chat?.title}
          mode={combinedMode}
          dividerPosition={documentModeHook.dividerPosition}
          onDividerPositionChange={documentModeHook.setDividerPosition}
          rightPaneVerticalSplit={terminalModeHook.rightPaneVerticalSplit}
          onRightPaneVerticalSplitChange={terminalModeHook.setRightPaneVerticalSplit}
          focusedDocId={documentModeHook.focusedDocId}
          terminalActive={Boolean(terminalModeHook.activeTerminalSessionId && terminalModeHook.terminalMode !== 'normal')}
          onCloseDocument={documentModeHook.closeDocument}
          onCloseTerminal={terminalModeHook.hidePane}
          chatContent={
            <>
        <VirtualizedMessageList
          messages={renderMessages}
          renderItems={renderItems}
          virtualizer={virtualizer}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          editingMessageId={editingMessageId}
          editContent={editContent}
          viewSourceMessageIds={viewSourceMessageIds}
          expandedSystemMessageIds={expandedSystemMessageIds}
          onToggleSystemMessageExpanded={toggleSystemMessageExpanded}
          swipeStates={swipeStates}
          setSwipeStates={setSwipeStates}
          chatSettings={chatSettings}
          roleplayRenderingPatterns={roleplayRenderingPatterns}
          roleplayDialogueDetection={roleplayDialogueDetection}
          isMultiChar={participantsWithImpersonation.isMultiChar}
          participantData={participantsWithImpersonation.participantData}
          turnState={turnState}
          streaming={sseStreaming.streaming}
          streamingContent={sseStreaming.streamingContent}
          waitingForResponse={sseStreaming.waitingForResponse}
          userParticipantId={participantsWithImpersonation.userParticipantId}
          isPaused={isPaused}
          respondingParticipantId={respondingParticipantId}
          chatId={id}
          messageActions={messageActions}
          turnManagement={turnManagement}
          setEditContent={setEditContent}
          onTogglePause={chatControls.togglePause}
          onOverrideDangerFlag={chatControls.handleOverrideDangerFlag}
          onRemoveCharacter={chatControls.handleRemoveCharacter}
          onReattribute={handleReattribute}
          onImageClick={(filepath, filename, fileId) => {
            modals.setModalImage({ src: filepath, filename, fileId })
          }}
          onSaveImage={(messageId, attachmentId) => {
            setSaveImageTarget({ messageId, attachmentId })
          }}
          fetchChat={fetchChat}
          messagesWithLogs={llmLogs.messagesWithLogs}
          onViewLLMLogs={llmLogs.handleViewLLMLogs}
          streamingToolBatches={sseStreaming.streamingToolBatches}
          getRespondingCharacter={getRespondingCharacter}
          shouldShowAvatars={shouldShowAvatars}
          getFirstCharacter={participantsWithImpersonation.getFirstCharacter}
          getMessageAvatar={getMessageAvatar}
          participantNames={participantNames}
          currentUserId={chat?.user?.id ?? null}
          userParticipantIdSet={userParticipantIdSet}
          isDangerousChat={isChatActiveDangerous(chat)}
          showThinking={chat?.showThinking ?? chatSettings?.thinkingDisplay?.defaultVisible ?? true}
          thinkingCollapsedByDefault={chatSettings?.thinkingDisplay?.defaultCollapsed ?? true}
          streamingReasoning={sseStreaming.streamingReasoning}
          showScrollToBottom={isSettled && !isAtBottom}
          onScrollToBottom={scrollToBottom}
        />

        {/* Speaker Selector - shown when controlling multiple characters */}
        {participantsWithImpersonation.controlledCharacters.length >= 2 && (
          <div className="qt-chat-speaker-selector px-4 py-2 border-t qt-border-default">
            <SpeakerSelector
              characters={participantsWithImpersonation.controlledCharacters}
              activeParticipantId={impersonation.activeTypingParticipantId}
              onSelect={impersonation.handleSetActiveSpeaker}
              disabled={sseStreaming.streaming || sseStreaming.waitingForResponse}
            />
          </div>
        )}

        {/* User-turn indicator: shown when the rotation has landed on a seat the
            human drives — a genuine user-controlled character OR a seat they are
            impersonating this session (Bug 46: impersonation is an overlay,
            `controlledBy` stays `'llm'`, so an impersonated seat's own turn must
            be announced via the overlay, not the bare column). The human can type
            as them, or Skip to let the rotation move on to the next LLM character. */}
        {(() => {
          if (sseStreaming.streaming || sseStreaming.waitingForResponse) return null
          const nextId = turnSelectionResult?.nextSpeakerId
          if (!nextId) return null
          const next = participantsWithImpersonation.participantData.find(p => p.id === nextId)
          if (!next || !isUserDrivenSeat({ id: next.id, controlledBy: next.controlledBy ?? 'llm' }, impersonation.impersonatingParticipantIds)) return null
          const name = next.character?.name ?? 'this character'

          // Must-speak guard: when every other active character has passed since
          // the last substantive message, the floor falls to this participant and
          // the Skip button is withheld (the server rejects the POST too). Only
          // `all-others-skipped` blocks — computed via the shared function so the
          // client and server agree. Best-effort: any failure leaves Skip enabled.
          let mustSpeak = false
          try {
            if (next.character) {
              const events = messages.map(m => ({
                type: 'message' as const,
                id: m.id,
                role: m.role,
                content: m.content,
                participantId: m.participantId,
                createdAt: m.createdAt,
                targetParticipantIds: m.targetParticipantIds ?? null,
                systemSender: m.systemSender ?? null,
                systemKind: m.systemKind ?? null,
                hostEvent: m.hostEvent ?? null,
                isSilentMessage: m.isSilentMessage,
              })) as unknown as ChatEvent[]
              const eligibility = computeSkipEligibility({
                events,
                participants: participantsWithImpersonation.participantsAsBase as unknown as ChatParticipantBase[],
                respondingParticipantId: next.id,
                respondingCharacter: next.character as unknown as Character,
                summoned: false,
                turnSkippingEnabled: chat?.turnSkippingEnabled !== false,
              })
              mustSpeak = eligibility.mustSpeakReason === 'all-others-skipped'
            }
          } catch {
            mustSpeak = false
          }

          return (
            <div className="qt-chat-user-turn-banner flex items-center justify-between px-4 py-2 border-t qt-border-default text-sm">
              <span className="qt-text-secondary">
                {mustSpeak
                  ? `Everyone else has passed — it falls to ${name} to say something.`
                  : `${name}'s turn — type as them, or skip to let someone else respond.`}
              </span>
              {!mustSpeak && (
                <button
                  type="button"
                  onClick={() => turnManagement.handleSkipUserTurn(next.id)}
                  className="qt-button-secondary px-3 py-1 rounded text-sm"
                >
                  Skip
                </button>
              )}
            </div>
          )
        })()}

        {/* Chat Composer */}
        <ChatComposer
          id={id}
          speakingAs={speakingAsSeat}
          input={input}
          setInput={setInput}
          hasContent={hasComposerContent}
          onContentChange={handleComposerContentChange}
          onPersistDraft={persistDraft}
          attachedFiles={attachedFiles}
          onRemoveAttachedFile={removeAttachedFile}
          pendingToolResults={pendingToolResults}
          onRemovePendingToolResult={handleRemovePendingToolResult}
          inputRef={inputRef}
          disabled={sseStreaming.sending}
          sending={sseStreaming.sending}
          hasActiveCharacters={participantsWithImpersonation.hasActiveCharacters}
          streaming={sseStreaming.streaming}
          waitingForResponse={sseStreaming.waitingForResponse}
          responseStatus={sseStreaming.responseStatus}
          showSource={modals.showPreview}
          setShowSource={modals.setShowPreview}
          uploadingFile={uploadingFile}
          toolExecutionStatus={sseStreaming.toolExecutionStatus}
          customToolsAvailable={customToolsAvailable}
          onCustomToolRan={fetchChat}
          renderingPatterns={roleplayRenderingPatterns}
          dialogueDetection={roleplayDialogueDetection}
          roleplayTemplateId={chat?.roleplayTemplateId}
          documentEditingMode={chatControls.documentEditingMode}
          onToggleDocumentEditingMode={chatControls.handleToggleDocumentEditingMode}
          onOpenDocumentClick={() => setShowDocumentPicker(true)}
          isDocumentModeActive={documentModeHook.documentMode !== 'normal'}
          onSubmit={(e) => sseStreaming.sendMessage(
            e,
            // Read the live text straight from the editor handle — page `input`
            // intentionally lags while typing (that's the decoupling).
            inputRef.current?.getMarkdown() ?? input,
            clearComposerInput,
            attachedFiles,
            pendingToolResults,
            setPendingToolResults,
            clearDraft,
            chatControls.userStoppedStreamRef,
          )}
          onFileSelect={handleFileSelect}
          onAttachFileClick={() => {}}
          onImagePaste={async (file: File) => {
            try {
              const success = await uploadFile(file)
              if (success) {
                showSuccessToast('Image pasted and attached')
              }
            } catch (err) {
              showErrorToast(err instanceof Error ? err.message : 'Failed to upload pasted image')
            }
          }}
          onLibraryFileClick={modals.openLibraryFilePicker}
          onStandaloneGenerateImageClick={modals.openStandaloneGenerateImage}
          onInsertAnnouncementClick={modals.openInsertAnnouncement}
          onComposeMailClick={modals.openComposeMail}
          onStopStreaming={sseStreaming.stopStreaming}
          hideStopButton={modals.showParticipantSidebar}
          onPendingToolResult={handleAddPendingToolResult}
          narrationDelimiters={narrationDelimiters}
          onOpenTerminalClick={handleOpenTerminal}
          isTerminalModeActive={isTerminalModeActive}
        />
            </>
          }
          documentPanes={documentModeHook.openDocs.map((entry) => ({
            docId: entry.document.id,
            displayTitle: entry.document.displayTitle,
            content: (
              <DocumentPaneBinding
                key={entry.document.id}
                entry={entry}
                mode={documentModeHook.documentMode}
                roleplayTemplateId={chat?.roleplayTemplateId}
                doc={documentModeHook}
              />
            ),
          }))}
          terminalContent={
            terminalModeHook.activeTerminalSessionId && terminalModeHook.terminalMode !== 'normal' ? (
              <TerminalPane
                sessionId={terminalModeHook.activeTerminalSessionId}
                chatId={id}
                mode={terminalModeHook.terminalMode}
                onToggleFocusMode={terminalModeHook.toggleFocusMode}
                onHidePane={terminalModeHook.hidePane}
                onKill={terminalModeHook.killTerminal}
              />
            ) : null
          }
        />

        {/* Terminal Session Picker Modal */}
        <TerminalSessionPicker
          isOpen={terminalModeHook.showTerminalPicker}
          sessions={terminalModeHook.pickerSessions}
          onAttach={(sessionId) => {
            void terminalModeHook.attachExistingSession(sessionId)
          }}
          onSpawnNew={() => {
            void terminalModeHook.spawnNewSession()
          }}
          onClose={terminalModeHook.closeTerminalPicker}
        />

        {/* Document Picker Modal */}
        <DocumentPickerModal
          isOpen={showDocumentPicker}
          onClose={() => setShowDocumentPicker(false)}
          chatId={id}
          projectId={chat?.projectId}
          projectName={chat?.projectName}
          onSelectDocument={(params) => {
            handleOpenDocument(params)
            setShowDocumentPicker(false)
          }}
        />

        {/* Continue Elsewhere — fork this conversation into a new chat with a
            different scenario or project. Reuses the standard new-chat modal
            in continuation mode, which posts continuationFromChatId to the
            create endpoint so the server backfills the new chat with the
            tail of this one. */}
        {chat && (
          <NewChatModal
            isOpen={modals.continueChatModalOpen}
            onClose={modals.closeContinueChat}
            characterId={chat.participants.find((p) => p.controlledBy !== 'user')?.character?.id || ''}
            characterName={chat.participants.find((p) => p.controlledBy !== 'user')?.character?.name || ''}
            projectId={chat.projectId ?? undefined}
            continuationFromChatId={id}
            initialSelectedCharacterIds={chat.participants
              .filter((p) => p.type === 'CHARACTER' && p.controlledBy !== 'user' && !p.removedAt)
              .map((p) => p.character?.id)
              .filter((cid): cid is string => typeof cid === 'string' && cid.length > 0)}
            initialUserCharacterId={chat.participants
              .find((p) => p.type === 'CHARACTER' && p.controlledBy === 'user' && !p.removedAt)
              ?.character?.id ?? null}
            initialImageProfileId={chat.imageProfileId ?? null}
            initialAvatarGenerationEnabled={chat.avatarGenerationEnabled ?? false}
          />
        )}

        {/* Merge In… — fold another conversation's characters and summary into
            this one at the latest point. The inverse of Continue Elsewhere.
            Mounted only while open so its state starts fresh each time. */}
        {chat && modals.mergeConversationModalOpen && (
          <MergeConversationModal
            isOpen={modals.mergeConversationModalOpen}
            onClose={modals.closeMergeConversation}
            targetChatId={id}
            existingCharacterIds={chat.participants
              .filter((p) => p.type === 'CHARACTER' && p.character?.id)
              .map((p) => p.character!.id)}
            onMerged={fetchChat}
          />
        )}

        {/* Modals */}
        <ChatModals
          chatId={id}
          chat={chat}
          messages={messages}
          setMessages={setMessages}
          setChat={(fn) => setChat(fn as any)}
          fetchChat={fetchChat}
          fetchChatPhotoCount={fetchChatPhotoCount}
          setAttachedFiles={setAttachedFiles}
          modalImage={modals.modalImage}
          setModalImage={modals.setModalImage}
          galleryOpen={modals.galleryOpen}
          closeGallery={modals.closeGallery}
          chatProjectModalOpen={modals.chatProjectModalOpen}
          closeChatProject={modals.closeChatProject}
          renameModalOpen={modals.renameModalOpen}
          closeRename={modals.closeRename}
          generateImageDialogOpen={modals.generateImageDialogOpen}
          closeGenerateImage={modals.closeGenerateImage}
          addCharacterDialogOpen={modals.addCharacterDialogOpen}
          closeAddCharacter={modals.closeAddCharacter}
          searchReplaceModalOpen={modals.searchReplaceModalOpen}
          closeSearchReplace={modals.closeSearchReplace}
          bulkReplaceModalOpen={modals.bulkReplaceModalOpen}
          closeBulkReplace={modals.closeBulkReplace}
          toolSettingsModalOpen={modals.toolSettingsModalOpen}
          closeToolSettings={modals.closeToolSettings}
          runToolModalOpen={modals.runToolModalOpen}
          closeRunTool={modals.closeRunTool}
          stateEditorModalOpen={modals.stateEditorModalOpen}
          closeStateEditor={modals.closeStateEditor}
          libraryFilePickerOpen={modals.libraryFilePickerOpen}
          closeLibraryFilePicker={modals.closeLibraryFilePicker}
          standaloneGenerateImageOpen={modals.standaloneGenerateImageOpen}
          closeStandaloneGenerateImage={modals.closeStandaloneGenerateImage}
          insertAnnouncementOpen={modals.insertAnnouncementOpen}
          closeInsertAnnouncement={modals.closeInsertAnnouncement}
          composeMailOpen={modals.composeMailOpen}
          closeComposeMail={modals.closeComposeMail}
          allLLMPauseModalOpen={modals.allLLMPauseModalOpen}
          setAllLLMPauseModalOpen={modals.setAllLLMPauseModalOpen}
          reattributeDialogState={modals.reattributeDialogState}
          setReattributeDialogState={modals.setReattributeDialogState}
          selectLLMProfileDialogState={modals.selectLLMProfileDialogState}
          setSelectLLMProfileDialogState={modals.setSelectLLMProfileDialogState}
          isConflictDialogOpen={isConflictDialogOpen}
          cancelConflict={cancelConflict}
          conflictInfo={conflictInfo}
          handleConflictResolution={handleConflictResolution}
          resolvingConflict={resolvingConflict}
          getFirstCharacter={participantsWithImpersonation.getFirstCharacter}
          getFirstUserCharacter={participantsWithImpersonation.getFirstUserCharacter}
          onCharacterAdded={chatControls.handleCharacterAdded}
          onReattributed={handleReattributed}
          onConfirmStopImpersonation={impersonation.handleConfirmStopImpersonation}
          memoryCascadeConfirmation={messageActions.memoryCascadeConfirmation}
          cancelMemoryCascadeConfirmation={messageActions.cancelMemoryCascadeConfirmation}
          handleMemoryCascadeConfirm={messageActions.handleMemoryCascadeConfirm}
          allLLMPauseTurnCount={impersonation.allLLMPauseTurnCount}
          llmParticipants={participantsWithImpersonation.llmParticipants}
          handleAllLLMContinue={handleAllLLMContinue}
          handleAllLLMStop={handleAllLLMStop}
          handleAllLLMTakeOver={handleAllLLMTakeOver}
        />

        {saveImageTarget && (() => {
          const targetMessage = messages.find((m) => m.id === saveImageTarget.messageId)
          const attachments = targetMessage?.attachments ?? []
          return (
            <SaveImageDialog
              isOpen={!!saveImageTarget}
              onClose={() => setSaveImageTarget(null)}
              chatId={id}
              messageId={saveImageTarget.messageId}
              attachments={attachments}
              initialAttachmentId={saveImageTarget.attachmentId}
              onSaved={(info) => {
                showSuccessToast(`Saved to ${info.mountPoint}`)
                void fetchChatPhotoCount()
              }}
            />
          )
        })()}
      </div>

      <LLMInspectorPanel
        isOpen={llmLogs.inspectorOpen}
        onClose={llmLogs.closeInspector}
        chatId={id}
        logs={llmLogs.allChatLogs}
        loading={llmLogs.loading}
        scrollToMessageId={llmLogs.inspectorScrollToMessageId}
        onRefresh={llmLogs.refreshLogs}
        loggingEnabled={chatSettings?.llmLoggingSettings?.enabled !== false}
      />

      {modals.showParticipantSidebar && (
        <ChatSidebar
          participants={participantsWithImpersonation.participantData}
          turnState={turnState}
          turnSelectionResult={turnSelectionResult}
          isGenerating={sseStreaming.streaming || sseStreaming.waitingForResponse}
          userParticipantId={participantsWithImpersonation.userParticipantId}
          respondingParticipantId={respondingParticipantId}
          waitingForResponse={sseStreaming.waitingForResponse}
          isPaused={isPaused}
          onTogglePause={chatControls.togglePause}
          onNudge={turnManagement.handleNudge}
          onQueue={turnManagement.handleQueue}
          onDequeue={turnManagement.handleDequeue}
          onSkip={turnManagement.handleContinue}
          onStopStreaming={sseStreaming.stopStreaming}
          onTalkativenessChange={chatControls.handleTalkativenessChange}
          onAddCharacter={modals.openAddCharacter}
          onRemoveCharacter={chatControls.handleRemoveCharacter}
          impersonatingParticipantIds={impersonation.impersonatingParticipantIds}
          activeTypingParticipantId={impersonation.activeTypingParticipantId}
          onImpersonate={handleImpersonateAndTakeTurn}
          onStopImpersonate={impersonation.handleStopImpersonation}
          connectionProfiles={chatControls.connectionProfiles}
          onConnectionProfileChange={chatControls.handleConnectionProfileChange}
          onSystemPromptChange={chatControls.handleSystemPromptChange}
          onRebuildSystemPrompt={chatControls.handleRebuildSystemPrompt}
          onParticipantSettingsChange={chatControls.handleParticipantSettingsChange}
          onWhisper={handleWhisper}
          chatId={id}
          onRegenerateAvatar={handleRegenerateAvatar}
          isDangerousChat={chat?.isDangerousChat === true}
          // Chat section
          agentModeEnabled={chatControls.agentModeEnabled}
          onAgentModeToggle={chatControls.handleToggleAgentMode}
          roleplayTemplateId={chat?.roleplayTemplateId}
          onChatUpdated={fetchChat}
          projectName={chat?.projectName}
          onProjectClick={modals.openChatProject}
          imageProfileId={chat?.imageProfileId}
          alertCharactersOfLanternImages={chat?.alertCharactersOfLanternImages}
          avatarGenerationEnabled={chat?.avatarGenerationEnabled}
          timelineMode={chat?.timelineMode}
          conciergeOverride={chat?.conciergeOverride}
          onToolSettingsClick={modals.openToolSettings}
          onRunToolClick={modals.openRunTool}
          storyBackgroundsEnabled={chatControls.storyBackgroundsEnabled}
          onRegenerateBackgroundClick={chatControls.handleRegenerateBackground}
          // Visibility section
          isMultiChar={participantsWithImpersonation.isMultiChar}
          showAllWhispers={showAllWhispers}
          onToggleAllWhispers={() => setShowAllWhispers(!showAllWhispers)}
          allowCrossCharacterVaultReads={chatControls.allowCrossCharacterVaultReads}
          onToggleCrossCharacterVaultReads={chatControls.handleToggleCrossCharacterVaultReads}
          coreWhisperEnabled={chatControls.coreWhisperEnabled}
          onSetCoreWhisperEnabled={chatControls.handleSetCoreWhisperEnabled}
          coreWhisperInterval={chatControls.coreWhisperInterval}
          onSetCoreWhisperInterval={chatControls.handleSetCoreWhisperInterval}
          turnSkippingEnabled={chatControls.turnSkippingEnabled}
          onSetTurnSkippingEnabled={
            qualifiesForTurnSkipping(
              participantsWithImpersonation.participantsAsBase as unknown as ChatParticipantBase[],
            )
              ? chatControls.handleSetTurnSkippingEnabled
              : undefined
          }
          showThinking={chatControls.showThinking}
          onSetShowThinking={chatControls.handleSetShowThinking}
          answerConfirmationOverride={chatControls.answerConfirmationOverride}
          onSetAnswerConfirmationOverride={chatControls.handleSetAnswerConfirmationOverride}
          // Organize section
          onRenameClick={modals.openRename}
          onStateClick={modals.openStateEditor}
          onContinueChatClick={modals.openContinueChat}
          onMergeConversationClick={modals.openMergeConversation}
          chatPhotoCount={chatPhotoCount}
          onGalleryClick={modals.openGallery}
          isAutonomousRoom={chat?.chatType === 'autonomous'}
          onEditEnclaveClick={modals.openEditEnclave}
          // Edit Content section
          onSearchReplaceClick={modals.openSearchReplace}
          onBulkCharacterReplaceClick={modals.openBulkReplace}
          onReextractMemoriesClick={memoryActions.handleReextractMemories}
          onDeleteChatMemoriesClick={memoryActions.handleDeleteChatMemories}
          chatMemoryCount={chatMemoryCount}
        />
      )}

      <EditEnclaveModal
        isOpen={modals.editEnclaveModalOpen}
        onClose={modals.closeEditEnclave}
        chatId={id}
        currentTitle={chat?.title ?? ''}
        onSaved={async () => {
          modals.closeEditEnclave()
          await fetchChat()
        }}
      />

      {whisperTarget && (
        <WhisperDialog
          isOpen={!!whisperTarget}
          targetName={whisperTarget.name}
          targetParticipantId={whisperTarget.participantId}
          chatId={id}
          speakingAsParticipantId={impersonation.activeTypingParticipantId}
          onClose={() => setWhisperTarget(null)}
          onSent={async () => {
            setWhisperTarget(null)
            await fetchChat()
          }}
        />
      )}

    </div>
    </TerminalModeContext.Provider>
  )
}
