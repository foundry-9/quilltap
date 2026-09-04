'use client'

/**
 * ChatSidebar
 *
 * Right-side panel for the Salon chat page. Replaces the previous
 * ParticipantSidebar (cast-only) and absorbs every control that used to live
 * in the ToolPalette popover and the ChatSettingsModal. Single-open accordion:
 * Participants, Chat, Visibility, Organize, Edit Content.
 *
 * Collapsed mode is unchanged from ParticipantSidebar — a narrow strip with
 * mini avatars that still surfaces the turn order at a glance.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { patchChat } from '@/lib/chat/patch-chat'
import { queryKeys } from '@/lib/query/keys'
import { Icon } from '@/components/ui/icon'
import { ParticipantCard, type ParticipantData, type ConnectionProfileOption } from './ParticipantCard'
import { CopyChatIdButton } from './CopyChatIdButton'
import { ChatScenarioControl } from './ChatScenarioControl'
import { Avatar } from '@/components/ui/Avatar'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { triggerUrlDownload } from '@/lib/download-utils'
import { getConciergeState, shouldShowDangerStyling, type ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import {
  CONCIERGE_STATE_PRESENTATION,
  conciergeToneTextClass,
} from '@/lib/services/dangerous-content/concierge-state-presentation'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'
import { getQueuePosition, computePredictedTurnOrder } from '@/lib/chat/turn-manager'
import type { TurnOrderEntry, TurnOrderStatus } from '@/lib/chat/turn-manager'

const STORAGE_KEY = 'quilltap.chat-sidebar.collapsed'
const WIDTH_STORAGE_KEY = 'quilltap.chat-sidebar.width'

/** Expanded-sidebar width bounds (px). Default mirrors --qt-chat-sidebar-width: 18rem. */
const DEFAULT_WIDTH = 288
const MIN_WIDTH = 240
const MAX_WIDTH = 560
/** Keep at least this much room for the chat pane when dragging. */
const MIN_CHAT_WIDTH = 360
/** Keyboard nudge step (px). */
const WIDTH_KEY_STEP = 16
/**
 * Below this container width (px), an inline expanded sidebar would starve the
 * chat (sidebar ~MIN_WIDTH + chat MIN_CHAT_WIDTH). In a narrow pane the sidebar
 * therefore defaults to the mini strip and expands as a click-away overlay
 * instead of squeezing the chat. In a wide/full pane it behaves exactly as
 * before. See `docs/developer/features/tabbed-workspace.md`.
 */
const NARROW_PANE_WIDTH = 640

type SectionId = 'participants' | 'chat' | 'visibility' | 'organize' | 'edit' | null

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  modelName: string
}

interface ApiKey {
  id: string
  label: string
  provider: string
}

function getInitialCollapsedState(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored !== null ? stored === 'true' : true
}

/** Upper bound for the sidebar width given the current viewport (leaves room for chat). */
function maxWidthForViewport(): number {
  if (typeof window === 'undefined') return MAX_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - MIN_CHAT_WIDTH))
}

function clampWidth(value: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(maxWidthForViewport(), value)))
}

function getInitialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const stored = localStorage.getItem(WIDTH_STORAGE_KEY)
  const parsed = stored !== null ? parseInt(stored, 10) : NaN
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH
}

/**
 * Track the sidebar container's width by observing the parent element (the
 * `.qt-chat-layout`, which both the expanded panel and the collapsed strip
 * share as a parent). Returns a callback ref to attach to whichever root is
 * rendered; the observer persists across collapse/expand toggles because the
 * parent is the same. Falls back to a one-shot measurement where ResizeObserver
 * is unavailable (SSR / jsdom).
 */
function useContainerWidth(): { rootRef: (node: HTMLElement | null) => void; width: number | null } {
  const [width, setWidth] = useState<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const observedParentRef = useRef<HTMLElement | null>(null)

  const rootRef = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const parent = node.parentElement
    if (!parent || parent === observedParentRef.current) return
    observedParentRef.current = parent
    if (typeof ResizeObserver === 'undefined') {
      setWidth(parent.getBoundingClientRect().width || null)
      return
    }
    observerRef.current?.disconnect()
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    ro.observe(parent)
    observerRef.current = ro
    setWidth(parent.getBoundingClientRect().width)
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return { rootRef, width }
}

export interface ChatSidebarProps {
  // --- Participants section ---
  participants: ParticipantData[]
  turnState: TurnState
  turnSelectionResult: TurnSelectionResult | null
  isGenerating: boolean
  userParticipantId: string | null
  respondingParticipantId?: string | null
  waitingForResponse?: boolean
  isPaused?: boolean
  onTogglePause?: () => void
  onNudge: (participantId: string) => void
  onQueue: (participantId: string) => void
  onDequeue: (participantId: string) => void
  onSkip?: () => void
  onTalkativenessChange?: (participantId: string, value: number) => void
  onAddCharacter?: () => void
  onRemoveCharacter?: (participantId: string) => void
  onStopStreaming?: () => void
  onWhisper?: (participantId: string) => void
  impersonatingParticipantIds?: string[]
  activeTypingParticipantId?: string | null
  onImpersonate?: (participantId: string) => void
  onStopImpersonate?: (participantId: string) => void
  connectionProfiles?: ConnectionProfileOption[]
  onConnectionProfileChange?: (participantId: string, profileId: string | null, controlledBy: 'llm' | 'user') => void
  onSystemPromptChange?: (participantId: string, promptId: string | null) => void
  onRebuildSystemPrompt?: (participantId: string) => void
  onParticipantSettingsChange?: (participantId: string, updates: { isActive?: boolean; status?: 'active' | 'silent' | 'absent' | 'removed' }) => void
  chatId: string
  onRegenerateAvatar?: (participantId: string) => void
  isDangerousChat?: boolean

  // --- Chat section ---
  agentModeEnabled?: boolean | null
  onAgentModeToggle?: () => void
  roleplayTemplateId?: string | null
  /** Fired after any chat-record field is mutated from the sidebar (typically fetchChat). */
  onChatUpdated?: () => void
  projectName?: string | null
  /** The chat's project id — gates the project tier of the scenario picker. */
  projectId?: string | null
  /** The scene currently set on the chat, shown and edited by the scenario picker. */
  scenarioText?: string | null
  onProjectClick?: () => void
  imageProfileId?: string | null
  alertCharactersOfLanternImages?: boolean | null
  avatarGenerationEnabled?: boolean | null
  /** Which clock the chat's story keeps for episodic memory (null = realtime default). */
  timelineMode?: 'realtime' | 'narrative' | null
  /** Per-chat Concierge override ('OFF' = vouched safe, 'UNCENSORED' = operator-asserted uncensored, null = follow global). */
  conciergeOverride?: 'OFF' | 'UNCENSORED' | null
  onToolSettingsClick?: () => void
  onRunToolClick?: () => void
  storyBackgroundsEnabled?: boolean
  onRegenerateBackgroundClick?: () => void

  // --- Visibility section ---
  isMultiChar?: boolean
  showAllWhispers?: boolean
  onToggleAllWhispers?: () => void
  allowCrossCharacterVaultReads?: boolean
  onToggleCrossCharacterVaultReads?: () => void
  // Aurora's Core whisper — per-chat overrides (tri-state). null = inherit.
  coreWhisperEnabled?: boolean | null
  onSetCoreWhisperEnabled?: (value: boolean | null) => void
  coreWhisperInterval?: number | null
  onSetCoreWhisperInterval?: (value: number | null) => void
  // "Nothing to add" turn-skipping — per-chat toggle. null = enabled (default); false = disabled.
  turnSkippingEnabled?: boolean | null
  onSetTurnSkippingEnabled?: (value: boolean | null) => void
  // Thinking visibility — per-chat override (tri-state). null = inherit global. DISPLAY ONLY.
  showThinking?: boolean | null
  onSetShowThinking?: (value: boolean | null) => void
  // Answer confirmation — per-chat override (tri-state). null = inherit project/global.
  answerConfirmationOverride?: 'ON' | 'OFF' | null
  onSetAnswerConfirmationOverride?: (value: 'ON' | 'OFF' | null) => void

  // --- Organize section ---
  onRenameClick?: () => void
  onStateClick?: () => void
  onContinueChatClick?: () => void
  onMergeConversationClick?: () => void
  chatPhotoCount?: number
  onGalleryClick?: () => void
  /** True when this chat is an autonomous room ("enclave") — gates the Edit Enclave control. */
  isAutonomousRoom?: boolean
  onEditEnclaveClick?: () => void

  // --- Edit Content section ---
  onSearchReplaceClick?: () => void
  onBulkCharacterReplaceClick?: () => void
  onReextractMemoriesClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  chatMemoryCount?: number

  className?: string
}

export function ChatSidebar(props: ChatSidebarProps) {
  const {
    participants,
    turnState,
    turnSelectionResult,
    isGenerating,
    userParticipantId,
    respondingParticipantId,
    waitingForResponse: _waitingForResponse,
    isPaused = false,
    onTogglePause,
    className = '',
  } = props

  // The LLM-controlled cast, for the scenario picker's group and character
  // tiers. Characters that have left the room can't lend it a scenario.
  const llmCharacterIds = useMemo(
    () =>
      participants
        .filter((p) => p.controlledBy !== 'user' && p.status !== 'removed' && p.character?.id)
        .map((p) => p.character!.id),
    [participants]
  )
  const singleLlmCharacterId = llmCharacterIds.length === 1 ? llmCharacterIds[0] : null

  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsedState)
  const [openSection, setOpenSection] = useState<SectionId>('participants')

  // Resizable width (px), persisted to localStorage. Applies to the expanded
  // panel only; the collapsed strip keeps its own fixed width.
  const [width, setWidth] = useState(getInitialWidth)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Narrow-pane awareness: in a narrow split pane the expanded sidebar would
  // starve the chat, so it defaults to the mini strip and expands as a
  // click-away overlay instead. Wide/full panes are unaffected.
  const { rootRef: measureRootRef, width: containerWidth } = useContainerWidth()
  const [narrowOpen, setNarrowOpen] = useState(false)
  const isNarrow = containerWidth != null && containerWidth < NARROW_PANE_WIDTH

  // Merge the measurement ref onto the expanded root (which already owns sidebarRef).
  const setExpandedRoot = useCallback(
    (node: HTMLDivElement | null) => {
      sidebarRef.current = node
      measureRootRef(node)
    },
    [measureRootRef]
  )

  const persistWidth = useCallback((next: number) => {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(next))
  }, [])

  // Drag-to-resize from the inner (left) edge. Mirrors SplitLayout.handleMouseDown:
  // capture the panel's right edge, then track the cursor against it. Dragging
  // left (toward the chat) widens the sidebar.
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rightEdge = sidebarRef.current?.getBoundingClientRect().right ?? null
    if (rightEdge === null) return

    setIsResizing(true)
    let latest = width

    const onMouseMove = (moveEvent: MouseEvent) => {
      latest = clampWidth(rightEdge - moveEvent.clientX)
      setWidth(latest)
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsResizing(false)
      persistWidth(latest)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width, persistWidth])

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    switch (event.key) {
      case 'ArrowLeft': next = width + WIDTH_KEY_STEP; break   // widen
      case 'ArrowRight': next = width - WIDTH_KEY_STEP; break  // narrow
      case 'Home': next = MIN_WIDTH; break
      case 'End': next = maxWidthForViewport(); break
      default: return
    }
    event.preventDefault()
    const clamped = clampWidth(next)
    setWidth(clamped)
    persistWidth(clamped)
  }, [width, persistWidth])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem(STORAGE_KEY, String(newValue))
      return newValue
    })
  }, [])

  const expandSidebar = useCallback(() => {
    setIsCollapsed(false)
    localStorage.setItem(STORAGE_KEY, 'false')
  }, [])

  const turnOrderEntries = useMemo(() => {
    return computePredictedTurnOrder({
      participants,
      turnState,
      turnSelectionResult,
      isGenerating,
      respondingParticipantId,
      userParticipantId,
    })
  }, [participants, turnState, turnSelectionResult, isGenerating, respondingParticipantId, userParticipantId])

  const turnOrderMap = useMemo(() => {
    const map = new Map<string, TurnOrderEntry>()
    for (const entry of turnOrderEntries) {
      map.set(entry.participantId, entry)
    }
    return map
  }, [turnOrderEntries])

  const sortedParticipants = useMemo(() => {
    const orderIndex = new Map<string, number>()
    turnOrderEntries.forEach((entry, index) => {
      orderIndex.set(entry.participantId, index)
    })
    return [...participants].sort((a, b) => {
      const aIdx = orderIndex.get(a.id) ?? 999
      const bIdx = orderIndex.get(b.id) ?? 999
      return aIdx - bIdx
    })
  }, [participants, turnOrderEntries])

  const currentSpeakerId = useMemo(() => {
    if (isGenerating) {
      if (respondingParticipantId) return respondingParticipantId
      if (turnState.lastSpeakerId) return turnState.lastSpeakerId
    }
    return turnSelectionResult?.nextSpeakerId ?? null
  }, [isGenerating, respondingParticipantId, turnState.lastSpeakerId, turnSelectionResult?.nextSpeakerId])

  const activeCharacterCount = useMemo(() => {
    return participants.filter(p => p.type === 'CHARACTER' && p.isActive && p.controlledBy !== 'user' && p.id !== userParticipantId).length
  }, [participants, userParticipantId])

  // Leaving narrow mode drops any transient overlay state. Adjusting state during
  // render (React's sanctioned pattern) instead of in an effect avoids a wasted
  // commit and the cascading-render lint.
  if (!isNarrow && narrowOpen) setNarrowOpen(false)

  const effectiveCollapsed = isNarrow ? !narrowOpen : isCollapsed
  const isOverlay = isNarrow && narrowOpen

  // Overlay: a click outside the panel, or Escape, collapses it to the strip.
  useEffect(() => {
    if (!isOverlay) return
    const onPointerDown = (e: PointerEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) setNarrowOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNarrowOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOverlay])

  // In a narrow pane, expand/collapse drive the transient overlay instead of the
  // persisted wide-pane preference.
  const handleStripExpand = isNarrow ? () => setNarrowOpen(true) : expandSidebar
  const handleExpandedCollapse = isNarrow ? () => setNarrowOpen(false) : toggleCollapsed

  const baseClasses: string[] = []
  if (className) baseClasses.push(className)

  if (effectiveCollapsed) {
    return (
      <CollapsedStrip
        rootRef={measureRootRef}
        baseClasses={baseClasses}
        sortedParticipants={sortedParticipants}
        turnOrderMap={turnOrderMap}
        currentSpeakerId={currentSpeakerId}
        userParticipantId={userParticipantId}
        turnSelectionResult={turnSelectionResult}
        isGenerating={isGenerating}
        isPaused={isPaused}
        onTogglePause={onTogglePause}
        toggleCollapsed={handleStripExpand}
        expandSidebar={handleStripExpand}
      />
    )
  }

  const openController = (id: Exclude<SectionId, null>) => ({
    isOpen: openSection === id,
    onOpenChange: (next: boolean) => setOpenSection(next ? id : null),
  })

  return (
    <div
      ref={setExpandedRoot}
      className={['qt-chat-sidebar', ...(isOverlay ? ['qt-chat-sidebar-overlay'] : []), ...baseClasses].join(' ')}
      style={{ width }}
    >
      <div
        className={`qt-chat-sidebar-resizer ${isResizing ? 'qt-chat-sidebar-resizer-active' : ''}`}
        onMouseDown={handleResizeMouseDown}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat sidebar"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize"
      >
        <div className="qt-chat-sidebar-resizer-grip">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="qt-chat-sidebar-header">
        <div className="flex items-center justify-between">
          <h3 className="qt-chat-sidebar-heading">Chat</h3>
          <button
            onClick={handleExpandedCollapse}
            className="qt-chat-sidebar-toggle"
            title="Collapse chat sidebar"
            aria-label="Collapse chat sidebar"
          >
            <Icon name="chevron-right" className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="qt-chat-sidebar-list">
        <CollapsibleCard
          title="Participants"
          description={`${activeCharacterCount} character${activeCharacterCount !== 1 ? 's' : ''}`}
          {...openController('participants')}
        >
          <ParticipantsSection
            {...props}
            sortedParticipants={sortedParticipants}
            turnOrderMap={turnOrderMap}
            currentSpeakerId={currentSpeakerId}
            activeCharacterCount={activeCharacterCount}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Chat"
          {...openController('chat')}
        >
          <ChatSection
            chatId={props.chatId}
            agentModeEnabled={props.agentModeEnabled}
            onAgentModeToggle={props.onAgentModeToggle}
            roleplayTemplateId={props.roleplayTemplateId}
            onChatUpdated={props.onChatUpdated}
            projectName={props.projectName}
            projectId={props.projectId}
            scenarioText={props.scenarioText}
            llmCharacterIds={llmCharacterIds}
            singleLlmCharacterId={singleLlmCharacterId}
            onProjectClick={props.onProjectClick}
            imageProfileId={props.imageProfileId}
            alertCharactersOfLanternImages={props.alertCharactersOfLanternImages}
            avatarGenerationEnabled={props.avatarGenerationEnabled}
            timelineMode={props.timelineMode}
            isDangerousChat={props.isDangerousChat}
            conciergeOverride={props.conciergeOverride}
            onToolSettingsClick={props.onToolSettingsClick}
            onRunToolClick={props.onRunToolClick}
            storyBackgroundsEnabled={props.storyBackgroundsEnabled}
            onRegenerateBackgroundClick={props.onRegenerateBackgroundClick}
            sectionOpen={openSection === 'chat'}
          />
        </CollapsibleCard>

        {(props.isMultiChar || props.onSetCoreWhisperEnabled || props.onSetCoreWhisperInterval || props.onSetTurnSkippingEnabled || props.onSetShowThinking || props.onSetAnswerConfirmationOverride) && (
          <CollapsibleCard
            title="Visibility"
            {...openController('visibility')}
          >
            <VisibilitySection
              showAllWhispers={props.showAllWhispers}
              onToggleAllWhispers={props.onToggleAllWhispers}
              allowCrossCharacterVaultReads={props.allowCrossCharacterVaultReads}
              onToggleCrossCharacterVaultReads={props.onToggleCrossCharacterVaultReads}
              coreWhisperEnabled={props.coreWhisperEnabled}
              onSetCoreWhisperEnabled={props.onSetCoreWhisperEnabled}
              coreWhisperInterval={props.coreWhisperInterval}
              onSetCoreWhisperInterval={props.onSetCoreWhisperInterval}
              turnSkippingEnabled={props.turnSkippingEnabled}
              onSetTurnSkippingEnabled={props.onSetTurnSkippingEnabled}
              isMultiChar={props.isMultiChar}
              showThinking={props.showThinking}
              onSetShowThinking={props.onSetShowThinking}
              answerConfirmationOverride={props.answerConfirmationOverride}
              onSetAnswerConfirmationOverride={props.onSetAnswerConfirmationOverride}
            />
          </CollapsibleCard>
        )}

        <CollapsibleCard
          title="Organize"
          {...openController('organize')}
        >
          <OrganizeSection
            chatId={props.chatId}
            onRenameClick={props.onRenameClick}
            onStateClick={props.onStateClick}
            onContinueChatClick={props.onContinueChatClick}
            onMergeConversationClick={props.onMergeConversationClick}
            chatPhotoCount={props.chatPhotoCount}
            onGalleryClick={props.onGalleryClick}
            isAutonomousRoom={props.isAutonomousRoom}
            onEditEnclaveClick={props.onEditEnclaveClick}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="Edit Content"
          {...openController('edit')}
        >
          <EditContentSection
            onSearchReplaceClick={props.onSearchReplaceClick}
            onBulkCharacterReplaceClick={props.onBulkCharacterReplaceClick}
            onReextractMemoriesClick={props.onReextractMemoriesClick}
            onDeleteChatMemoriesClick={props.onDeleteChatMemoriesClick}
            chatMemoryCount={props.chatMemoryCount}
          />
        </CollapsibleCard>
      </div>

      {turnSelectionResult?.debug && (
        <div className="qt-chat-sidebar-debug">
          <details>
            <summary className="cursor-pointer hover:text-foreground">Turn Debug Info</summary>
            <div className="mt-2 space-y-1">
              <div>Reason: {turnSelectionResult.reason}</div>
              <div>Cycle Complete: {turnSelectionResult.cycleComplete ? 'Yes' : 'No'}</div>
              {turnSelectionResult.debug.eligibleSpeakers.length > 0 && (
                <div>Eligible: {turnSelectionResult.debug.eligibleSpeakers.length}</div>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

export default ChatSidebar

// =================================================================
// Collapsed strip (mini avatars) — unchanged from ParticipantSidebar
// =================================================================

interface CollapsedStripProps {
  rootRef?: (node: HTMLElement | null) => void
  baseClasses: string[]
  sortedParticipants: ParticipantData[]
  turnOrderMap: Map<string, TurnOrderEntry>
  currentSpeakerId: string | null
  userParticipantId: string | null
  turnSelectionResult: TurnSelectionResult | null
  isGenerating: boolean
  isPaused: boolean
  onTogglePause?: () => void
  toggleCollapsed: () => void
  expandSidebar: () => void
}

function CollapsedStrip({
  rootRef,
  baseClasses,
  sortedParticipants,
  turnOrderMap,
  currentSpeakerId,
  userParticipantId,
  turnSelectionResult,
  isGenerating,
  isPaused,
  onTogglePause,
  toggleCollapsed,
  expandSidebar,
}: CollapsedStripProps) {
  return (
    <div ref={rootRef} className={['qt-chat-sidebar-collapsed', ...baseClasses].join(' ')}>
      <button
        onClick={toggleCollapsed}
        className="qt-chat-sidebar-toggle"
        title="Expand chat sidebar"
        aria-label="Expand chat sidebar"
      >
        <Icon name="chevron-left" className="w-5 h-5" />
      </button>

      {onTogglePause && (
        <button
          onClick={onTogglePause}
          className={`qt-chat-sidebar-collapsed-pause ${isPaused ? 'qt-chat-sidebar-collapsed-pause-paused' : ''}`}
          title={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
          aria-label={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
        >
          {isPaused ? (
            <Icon name="play" className="w-5 h-5" />
          ) : (
            <Icon name="pause" className="w-5 h-5" />
          )}
        </button>
      )}

      <div className="qt-chat-sidebar-collapsed-avatars">
        {sortedParticipants.map((participant) => {
          const isUserParticipant = participant.id === userParticipantId
          const turnEntry = turnOrderMap.get(participant.id)
          const isInactive = turnEntry?.status === 'inactive'
          const isUserTurn = turnSelectionResult?.nextSpeakerId === null && !isGenerating
          const isCurrentTurn = currentSpeakerId === participant.id || (isUserParticipant && isUserTurn)
          const isActivelyGenerating = currentSpeakerId === participant.id && isGenerating

          const name = participant.character?.name || 'Unknown'
          const avatarUrl = participant.character?.avatarUrl || null
          const defaultImage = participant.character?.defaultImage || null

          const positionBadgeClass = turnEntry ? getCollapsedPositionBadgeClass(turnEntry.status) : ''
          const participantStatus = (participant as ParticipantData & { status?: string }).status || 'active'

          const avatarClasses = ['qt-chat-sidebar-collapsed-avatar']
          if (isInactive) {
            avatarClasses.push('qt-chat-sidebar-collapsed-avatar-inactive')
          } else if (isCurrentTurn || isActivelyGenerating) {
            avatarClasses.push('qt-chat-sidebar-collapsed-avatar-active')
          }
          if (isActivelyGenerating) {
            avatarClasses.push('qt-chat-sidebar-collapsed-avatar-streaming')
          }

          const statusLabel = participantStatus !== 'active' ? ` [${participantStatus}]` : ''

          return (
            <button
              key={participant.id}
              onClick={expandSidebar}
              className={avatarClasses.join(' ')}
              title={`${name}${statusLabel}${isCurrentTurn ? ' (current turn)' : ''}${turnEntry?.position ? ` (#${turnEntry.position})` : ''}`}
              aria-label={`${name}${statusLabel} - click to expand sidebar`}
            >
              <div className="relative">
                <Avatar
                  name={name}
                  src={avatarUrl ? { avatarUrl } : defaultImage ? { defaultImage } : undefined}
                  size="sm"
                />
                {participantStatus === 'silent' && (
                  <div className="qt-participant-status-overlay qt-participant-status-overlay-silent">
                    <Icon name="ban" className="w-2.5 h-2.5" />
                  </div>
                )}
                {participantStatus === 'absent' && (
                  <div className="qt-participant-status-overlay qt-participant-status-overlay-absent">
                    <Icon name="log-out" className="w-2.5 h-2.5" />
                  </div>
                )}
              </div>
              {turnEntry && turnEntry.position != null && turnEntry.position > 0 && (
                <span className={`qt-chat-sidebar-collapsed-position-badge ${positionBadgeClass}`}>
                  {turnEntry.position}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// =================================================================
// Participants section
// =================================================================

interface ParticipantsSectionProps extends ChatSidebarProps {
  sortedParticipants: ParticipantData[]
  turnOrderMap: Map<string, TurnOrderEntry>
  currentSpeakerId: string | null
  activeCharacterCount: number
}

function ParticipantsSection(p: ParticipantsSectionProps) {
  const activeParticipantCount = useMemo(() => {
    return p.participants.filter(part => part.isActive).length
  }, [p.participants])

  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-participants">
      {p.turnSelectionResult && (
        <div className="qt-chat-sidebar-meta">
          {p.activeCharacterCount === 0 ? (
            <span style={{ color: 'var(--qt-status-warning-fg)' }}>No characters available</span>
          ) : p.turnSelectionResult.nextSpeakerId === null ? (
            p.turnSelectionResult.cycleComplete ? (
              <span style={{ color: 'var(--qt-status-success-fg)' }}>All characters have spoken - your turn</span>
            ) : (
              <span style={{ color: 'var(--qt-status-success-fg)' }}>Your turn to speak</span>
            )
          ) : p.isGenerating ? (
            <span style={{ color: 'var(--qt-status-info-fg)' }}>Generating response...</span>
          ) : (
            <span>Waiting for next turn...</span>
          )}
        </div>
      )}

      {p.turnState.queue.length > 0 && (
        <div className="mt-1 qt-chat-sidebar-meta qt-chat-sidebar-queue">
          {p.turnState.queue.length} in queue
        </div>
      )}

      {p.onTogglePause && (
        <button
          onClick={p.onTogglePause}
          className={`qt-chat-pause-button mt-3 ${p.isPaused ? 'qt-chat-pause-button-paused' : ''}`}
          title={p.isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
        >
          {p.isPaused ? (
            <>
              <Icon name="play" className="w-4 h-4" />
              <span>Resume</span>
            </>
          ) : (
            <>
              <Icon name="pause" className="w-4 h-4" />
              <span>Pause</span>
            </>
          )}
        </button>
      )}

      <div className="qt-chat-sidebar-cards mt-3">
        {p.sortedParticipants.length === 0 && (
          <div className="qt-empty-state py-8">
            <Icon name="users" className="qt-empty-state-icon" />
            <p className="qt-empty-state-title">No participants</p>
            <p className="qt-empty-state-description">Add a character to get started</p>
          </div>
        )}
        {p.sortedParticipants.map((participant) => {
          const isUserParticipant = participant.id === p.userParticipantId
          const isCurrentTurn = p.currentSpeakerId === participant.id
          const queuePos = getQueuePosition(p.turnState, participant.id)
          const canSkip = p.turnSelectionResult?.nextSpeakerId === null && !p.isGenerating
          const isImpersonating = (p.impersonatingParticipantIds ?? []).includes(participant.id)
          const isActiveTyping = p.activeTypingParticipantId === participant.id
          const canRemove = p.activeCharacterCount > 1
          const turnEntry = p.turnOrderMap.get(participant.id)

          return (
            <ParticipantCard
              key={participant.id}
              participant={participant}
              isCurrentTurn={isCurrentTurn}
              queuePosition={queuePos}
              isGenerating={p.isGenerating && isCurrentTurn}
              isUserParticipant={isUserParticipant}
              turnPosition={turnEntry?.position ?? null}
              turnStatus={turnEntry?.status}
              onStopStreaming={turnEntry?.status === 'generating' ? p.onStopStreaming : undefined}
              onNudge={p.onNudge}
              onQueue={p.onQueue}
              onDequeue={p.onDequeue}
              onSkip={isUserParticipant ? p.onSkip : undefined}
              onTalkativenessChange={p.onTalkativenessChange}
              onRemove={p.onRemoveCharacter}
              canRemove={canRemove}
              canSkip={canSkip}
              isImpersonating={isImpersonating}
              isActiveTyping={isActiveTyping}
              onImpersonate={p.onImpersonate}
              onStopImpersonate={p.onStopImpersonate}
              connectionProfiles={p.connectionProfiles}
              onConnectionProfileChange={p.onConnectionProfileChange}
              onSystemPromptChange={p.onSystemPromptChange}
              onRebuildSystemPrompt={p.onRebuildSystemPrompt}
              onActiveChange={p.onParticipantSettingsChange
                ? (pId, active) => p.onParticipantSettingsChange!(pId, { isActive: active })
                : undefined}
              onStatusChange={p.onParticipantSettingsChange
                ? (pId, status) => p.onParticipantSettingsChange!(pId, { status, isActive: status === 'active' || status === 'silent' })
                : undefined}
              onWhisper={activeParticipantCount >= 3 ? p.onWhisper : undefined}
              chatId={p.chatId}
              onRegenerateAvatar={p.onRegenerateAvatar}
              isDangerousChat={shouldShowDangerStyling({ isDangerousChat: p.isDangerousChat, conciergeOverride: p.conciergeOverride })}
            />
          )
        })}
      </div>

      {p.onAddCharacter && (
        <div className="qt-chat-sidebar-add mt-3">
          <button
            onClick={p.onAddCharacter}
            className="w-full py-2 px-4 text-sm font-medium rounded-lg border border-dashed qt-border-default qt-text-secondary hover:qt-bg-surface-alt hover:qt-text transition-colors flex items-center justify-center gap-2"
          >
            <Icon name="plus" className="w-4 h-4" />
            Add Character
          </button>
        </div>
      )}
    </div>
  )
}

// =================================================================
// Chat section
// =================================================================

interface ChatSectionProps {
  chatId: string
  agentModeEnabled?: boolean | null
  onAgentModeToggle?: () => void
  roleplayTemplateId?: string | null
  onChatUpdated?: () => void
  projectName?: string | null
  projectId?: string | null
  scenarioText?: string | null
  /** Character IDs of the LLM-controlled cast, for the picker's group tier. */
  llmCharacterIds: string[]
  /** The lone LLM character's ID, or null when several share the room. */
  singleLlmCharacterId: string | null
  onProjectClick?: () => void
  imageProfileId?: string | null
  alertCharactersOfLanternImages?: boolean | null
  avatarGenerationEnabled?: boolean | null
  timelineMode?: 'realtime' | 'narrative' | null
  isDangerousChat?: boolean
  conciergeOverride?: 'OFF' | 'UNCENSORED' | null
  onToolSettingsClick?: () => void
  onRunToolClick?: () => void
  storyBackgroundsEnabled?: boolean
  onRegenerateBackgroundClick?: () => void
  sectionOpen: boolean
}

function ChatSection({
  chatId,
  agentModeEnabled,
  onAgentModeToggle,
  roleplayTemplateId,
  onChatUpdated,
  projectName,
  projectId,
  scenarioText,
  llmCharacterIds,
  singleLlmCharacterId,
  onProjectClick,
  imageProfileId,
  alertCharactersOfLanternImages,
  avatarGenerationEnabled,
  timelineMode,
  isDangerousChat,
  conciergeOverride,
  onToolSettingsClick,
  onRunToolClick,
  storyBackgroundsEnabled,
  onRegenerateBackgroundClick,
  sectionOpen,
}: ChatSectionProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(roleplayTemplateId ?? null)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [imageProfileSaving, setImageProfileSaving] = useState(false)
  const [alertImagesSaving, setAlertImagesSaving] = useState(false)
  const [avatarGenSaving, setAvatarGenSaving] = useState(false)
  const [conciergeSaving, setConciergeSaving] = useState(false)
  const [timelineModeSaving, setTimelineModeSaving] = useState(false)

  // Sync from props when chat record changes upstream
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream prop changes
    setSelectedTemplateId(roleplayTemplateId ?? null)
  }, [roleplayTemplateId])

  // Fetch reference data only after the section is opened the first time —
  // avoids hitting the API for users who never expand this accordion.
  const [hasEverOpened, setHasEverOpened] = useState(false)
  useEffect(() => {
    if (sectionOpen && !hasEverOpened) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot latch for lazy data fetch
      setHasEverOpened(true)
    }
  }, [sectionOpen, hasEverOpened])

  const { data: templatesData } = useQuery({
    queryKey: queryKeys.roleplayTemplates.all,
    queryFn: ({ signal }) => apiFetch<RoleplayTemplate[]>('/api/v1/roleplay-templates', { signal }),
    enabled: hasEverOpened,
  })
  const { data: imageProfilesData } = useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ImageProfile[] }>('/api/v1/image-profiles', { signal }),
    enabled: hasEverOpened,
  })
  const { data: apiKeysData } = useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: ({ signal }) => apiFetch<{ apiKeys: ApiKey[] }>('/api/v1/api-keys', { signal }),
    enabled: hasEverOpened,
  })

  const roleplayTemplates = templatesData ?? []
  const imageProfiles = imageProfilesData?.profiles ?? []
  const apiKeys = apiKeysData?.apiKeys ?? []

  const handleRoleplayTemplateChange = async (templateId: string | null) => {
    try {
      setTemplateSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleplayTemplateId: templateId }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      setSelectedTemplateId(templateId)
      showSuccessToast('Roleplay template updated')
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update roleplay template')
    } finally {
      setTemplateSaving(false)
    }
  }

  const handleImageProfileChange = async (profileId: string | null) => {
    try {
      setImageProfileSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageProfileId: profileId }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      showSuccessToast('Image profile updated')
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update image profile')
    } finally {
      setImageProfileSaving(false)
    }
  }

  const handleAlertImagesChange = async (value: boolean | null) => {
    try {
      setAlertImagesSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertCharactersOfLanternImages: value }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      showSuccessToast(
        value === null
          ? 'Lantern announcements will inherit from the project'
          : value
            ? 'Lantern images will be announced to characters'
            : 'Lantern images will stay silent for this chat'
      )
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update Lantern image announcements')
    } finally {
      setAlertImagesSaving(false)
    }
  }

  // Which clock the chat's story keeps for episodic memory. Persisted as the
  // explicit enum value; NULL in the record reads as 'realtime'.
  const handleTimelineModeChange = async (value: 'realtime' | 'narrative') => {
    try {
      setTimelineModeSaving(true)
      await patchChat(chatId, { timelineMode: value })
      showSuccessToast(
        value === 'narrative'
          ? 'The story now keeps its own hours'
          : 'The story is back on the clock on the wall'
      )
      onChatUpdated?.()
    } catch (error) {
      showErrorToast(apiErrorMessage(error, "Failed to change the story's clock"))
    } finally {
      setTimelineModeSaving(false)
    }
  }

  const handleConciergeStateChange = async (next: ConciergeState) => {
    try {
      setConciergeSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conciergeState: next }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      showSuccessToast(
        next === 'monitored'
          ? 'The Concierge is on watch'
          : next === 'flagged'
            ? 'Marked as flagged'
            : next === 'vouched'
              ? 'You have vouched for this chat'
              : 'The uncensored door stands open'
      )
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to change the Concierge state')
    } finally {
      setConciergeSaving(false)
    }
  }

  const handleAvatarGenToggle = async () => {
    try {
      setAvatarGenSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}?action=toggle-avatar-generation`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      const data = await res.json()
      showSuccessToast(data.avatarGenerationEnabled ? 'Avatar generation enabled' : 'Avatar generation disabled')
      onChatUpdated?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to toggle avatar generation')
    } finally {
      setAvatarGenSaving(false)
    }
  }

  const alertSelectValue = alertCharactersOfLanternImages === null || alertCharactersOfLanternImages === undefined
    ? 'inherit'
    : alertCharactersOfLanternImages ? 'enabled' : 'disabled'

  const conciergeState = getConciergeState({ isDangerousChat, conciergeOverride })
  // Four states, one 2×2: rows are the route (ordinary vs uncensored),
  // columns are the provenance (the Concierge's classifier vs the operator).
  // The optgroups carry the provenance structurally; the helper text names
  // the actor; the icon/color pair gives a third, colorblind-safe channel.
  // All of it comes from the presentation table, which this section's own
  // sentences seeded — so the list marks and the header pill say the same
  // words, and a copy edit here lands in all three.
  const conciergePresentation = CONCIERGE_STATE_PRESENTATION[conciergeState]
  const conciergeHelperText = conciergePresentation.detail
  const conciergeStateIcon = {
    name: conciergePresentation.icon,
    className: conciergeToneTextClass(conciergePresentation.tone),
  }

  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-chat flex flex-col gap-3">
      {/* The Concierge — per-chat four-state */}
      <label className="qt-label">
        <span className="mb-1 flex items-center gap-1.5">
          The Concierge
          <Icon name={conciergeStateIcon.name} className={`w-3.5 h-3.5 ${conciergeStateIcon.className}`} />
        </span>
        <select
          value={conciergeState}
          onChange={(e) => handleConciergeStateChange(e.target.value as ConciergeState)}
          disabled={conciergeSaving}
          className="qt-select text-sm"
        >
          <optgroup label="The Concierge decides">
            <option value="monitored">Monitored</option>
            <option value="flagged">Flagged</option>
          </optgroup>
          <optgroup label="You decide">
            <option value="vouched">Vouched Safe</option>
            <option value="uncensored">Uncensored</option>
          </optgroup>
        </select>
        <span className="block mt-1 qt-text-secondary text-xs">{conciergeHelperText}</span>
      </label>

      {/* Agent Mode */}
      {onAgentModeToggle && (
        <button
          type="button"
          onClick={onAgentModeToggle}
          className={`qt-tool-palette-badge ${agentModeEnabled ? 'qt-tool-palette-badge-on' : 'qt-tool-palette-badge-off'}`}
          title={agentModeEnabled ? 'Disable agent mode' : 'Enable agent mode'}
        >
          <Icon name="monitor" className="w-3.5 h-3.5" />
          <span>{agentModeEnabled ? 'Agent On' : 'Agent Off'}</span>
        </button>
      )}

      {/* Roleplay Template */}
      <label className="qt-label">
        <span className="block mb-1">Roleplay Template</span>
        <select
          value={selectedTemplateId || ''}
          onChange={(e) => handleRoleplayTemplateChange(e.target.value || null)}
          disabled={templateSaving}
          className="qt-select text-sm"
        >
          <option value="">No Template</option>
          {roleplayTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
            </option>
          ))}
        </select>
      </label>

      {/* Scenario — the scene this chat runs on */}
      <ChatScenarioControl
        chatId={chatId}
        projectId={projectId}
        scenarioText={scenarioText}
        llmCharacterIds={llmCharacterIds}
        singleLlmCharacterId={singleLlmCharacterId}
        enabled={hasEverOpened}
        onChatUpdated={onChatUpdated}
      />

      {/* The Story's Clock — episodic-memory timeline mode */}
      <label className="qt-label">
        <span className="block mb-1">The Story&rsquo;s Clock</span>
        <select
          value={timelineMode === 'narrative' ? 'narrative' : 'realtime'}
          onChange={(e) => handleTimelineModeChange(e.target.value === 'narrative' ? 'narrative' : 'realtime')}
          disabled={timelineModeSaving}
          className="qt-select text-sm"
        >
          <option value="realtime">Real time</option>
          <option value="narrative">Story time</option>
        </select>
        <span className="block mt-1 qt-text-secondary text-xs">
          {timelineMode === 'narrative'
            ? 'The tale keeps its own hours: the Commonplace Book files memories by the story’s reckoning — the third night at sea, the eve of the coronation — rather than the calendar on the wall.'
            : 'Memories are filed by the calendar on the wall — “last Tuesday” means the actual Tuesday. Switch to Story time if this chat runs on a fictional clock.'}
        </span>
      </label>

      {/* Project */}
      {onProjectClick && (
        <button
          type="button"
          onClick={onProjectClick}
          className="qt-tool-palette-button"
          title={projectName ? `In project: ${projectName}` : 'Assign to project'}
        >
          <Icon name="folder" className="w-4 h-4" />
          <span>{projectName ? `Project: ${projectName}` : 'Project'}</span>
        </button>
      )}

      {/* Image Provider */}
      <label className="qt-label">
        <span className="block mb-1">Image Provider</span>
        <select
          value={imageProfileId || ''}
          onChange={(e) => handleImageProfileChange(e.target.value || null)}
          disabled={imageProfileSaving}
          className="qt-select text-sm"
        >
          <option value="">None (image generation disabled)</option>
          {imageProfiles.map((profile) => {
            const hasKey = apiKeys.some(key => key.id === profile.apiKeyId)
            return (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.provider}){!hasKey && profile.apiKeyId ? ' ⚠️ No API Key' : ''}
              </option>
            )
          })}
        </select>
      </label>

      {/* Announce Generated Images */}
      <label className="qt-label">
        <span className="block mb-1">Announce Generated Images</span>
        <select
          value={alertSelectValue}
          onChange={(e) => {
            const v = e.target.value
            handleAlertImagesChange(v === 'inherit' ? null : v === 'enabled')
          }}
          disabled={alertImagesSaving}
          className="qt-select text-sm"
        >
          <option value="inherit">Inherit from project</option>
          <option value="enabled">Announce to characters</option>
          <option value="disabled">Keep silent</option>
        </select>
      </label>

      {/* Auto-generate Character Avatars */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!avatarGenerationEnabled}
          onChange={handleAvatarGenToggle}
          disabled={avatarGenSaving}
          className="qt-checkbox"
        />
        <span className="qt-label">Auto-generate character avatars</span>
      </label>

      {/* Tools (settings modal) */}
      {onToolSettingsClick && (
        <button
          type="button"
          onClick={onToolSettingsClick}
          className="qt-tool-palette-button"
          title="Configure LLM tools"
        >
          <Icon name="settings" className="w-4 h-4" />
          <span>Tools…</span>
        </button>
      )}

      {/* Run Tool */}
      {onRunToolClick && (
        <button
          type="button"
          onClick={onRunToolClick}
          className="qt-tool-palette-button"
          title="Run a tool manually"
        >
          <Icon name="wrench" className="w-4 h-4" />
          <span>Run Tool…</span>
        </button>
      )}

      {/* Regenerate Story Background */}
      {storyBackgroundsEnabled && onRegenerateBackgroundClick && (
        <button
          type="button"
          onClick={onRegenerateBackgroundClick}
          className="qt-tool-palette-button"
          title="Regenerate story background image"
        >
          <Icon name="image" className="w-4 h-4" />
          <span>Regenerate Background</span>
        </button>
      )}
    </div>
  )
}

// =================================================================
// Visibility section
// =================================================================

interface VisibilitySectionProps {
  showAllWhispers?: boolean
  onToggleAllWhispers?: () => void
  allowCrossCharacterVaultReads?: boolean
  onToggleCrossCharacterVaultReads?: () => void
  coreWhisperEnabled?: boolean | null
  onSetCoreWhisperEnabled?: (value: boolean | null) => void
  coreWhisperInterval?: number | null
  onSetCoreWhisperInterval?: (value: number | null) => void
  turnSkippingEnabled?: boolean | null
  onSetTurnSkippingEnabled?: (value: boolean | null) => void
  isMultiChar?: boolean
  showThinking?: boolean | null
  onSetShowThinking?: (value: boolean | null) => void
  answerConfirmationOverride?: 'ON' | 'OFF' | null
  onSetAnswerConfirmationOverride?: (value: 'ON' | 'OFF' | null) => void
}

const CORE_WHISPER_INTERVAL_OPTIONS = [
  { value: '', label: 'Inherit' },
  { value: '3', label: '3 turns' },
  { value: '6', label: '6 turns' },
  { value: '9', label: '9 turns' },
  { value: '12', label: '12 turns' },
  { value: '15', label: '15 turns' },
  { value: '20', label: '20 turns' },
  { value: '25', label: '25 turns' },
  { value: '30', label: '30 turns' },
  { value: '40', label: '40 turns' },
  { value: '50', label: '50 turns' },
] as const

function VisibilitySection({
  showAllWhispers,
  onToggleAllWhispers,
  allowCrossCharacterVaultReads,
  onToggleCrossCharacterVaultReads,
  coreWhisperEnabled,
  onSetCoreWhisperEnabled,
  coreWhisperInterval,
  onSetCoreWhisperInterval,
  turnSkippingEnabled,
  onSetTurnSkippingEnabled,
  isMultiChar,
  showThinking,
  onSetShowThinking,
  answerConfirmationOverride,
  onSetAnswerConfirmationOverride,
}: VisibilitySectionProps) {
  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-visibility flex flex-col gap-3">
      {onToggleAllWhispers && (
        <div className="flex items-center justify-between">
          <span className="qt-text-secondary text-xs">All Whispers</span>
          <button
            onClick={onToggleAllWhispers}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              showAllWhispers ? 'bg-primary' : 'qt-bg-muted'
            }`}
            role="switch"
            aria-checked={!!showAllWhispers}
            title={showAllWhispers ? 'Hide private whispers' : 'Show all whispers'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                showAllWhispers ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      )}

      {onToggleCrossCharacterVaultReads && (
        <div className="flex items-center justify-between">
          <span className="qt-text-secondary text-xs">Shared Vaults</span>
          <button
            onClick={onToggleCrossCharacterVaultReads}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              allowCrossCharacterVaultReads ? 'bg-primary' : 'qt-bg-muted'
            }`}
            role="switch"
            aria-checked={!!allowCrossCharacterVaultReads}
            title={
              allowCrossCharacterVaultReads
                ? 'Characters may read each other’s vaults (read-only) and the results are public to the chat. Click to lock.'
                : 'Each character’s vault is private; results from doc_* reads are whispered to the caller. Click to let them peek at each other’s dossiers.'
            }
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                allowCrossCharacterVaultReads ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      )}

      {onSetTurnSkippingEnabled && isMultiChar && (
        <div className="flex items-center justify-between pt-2 border-t qt-border-default">
          <span className="qt-text-secondary text-xs" title="When on, characters may pass a turn with a Host note when they have nothing to add, and the Skip button posts a Host note too. NULL/on is the default.">Turn Skipping</span>
          <button
            onClick={() => onSetTurnSkippingEnabled(turnSkippingEnabled === false ? true : false)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              turnSkippingEnabled !== false ? 'bg-primary' : 'qt-bg-muted'
            }`}
            role="switch"
            aria-checked={turnSkippingEnabled !== false}
            title={turnSkippingEnabled !== false ? 'Characters may pass their turn. Click to require everyone to speak.' : 'Every selected character must speak. Click to allow passing.'}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
                turnSkippingEnabled !== false ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      )}

      {(onSetCoreWhisperEnabled || onSetCoreWhisperInterval) && (
        <div className="flex flex-col gap-2 pt-2 border-t qt-border-default">
          <span className="qt-text-secondary text-xs">Aurora&apos;s Core Whisper</span>
          {onSetCoreWhisperEnabled && (
            <div className="flex items-center justify-between gap-2">
              <span className="qt-text-secondary text-xs">Offering</span>
              <select
                value={coreWhisperEnabled === true ? 'on' : coreWhisperEnabled === false ? 'off' : 'inherit'}
                onChange={(e) => {
                  const v = e.target.value
                  onSetCoreWhisperEnabled(v === 'on' ? true : v === 'off' ? false : null)
                }}
                className="qt-select qt-select-sm"
                title="When does Aurora offer this chat's characters their own Core/ packet? Inherit defers to per-character and global settings."
              >
                <option value="inherit">Inherit</option>
                <option value="on">Always</option>
                <option value="off">Never</option>
              </select>
            </div>
          )}
          {onSetCoreWhisperInterval && (
            <div className="flex items-center justify-between gap-2">
              <span className="qt-text-secondary text-xs">Cadence</span>
              <select
                value={coreWhisperInterval == null ? '' : String(coreWhisperInterval)}
                onChange={(e) => {
                  const raw = e.target.value
                  onSetCoreWhisperInterval(raw === '' ? null : parseInt(raw, 10))
                }}
                className="qt-select qt-select-sm"
                title="Assistant turns between periodic Core whispers in this chat. Inherit defers to the global default."
              >
                {CORE_WHISPER_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {onSetShowThinking && (
        <div className="flex flex-col gap-2 pt-2 border-t qt-border-default">
          <div className="flex items-center justify-between gap-2">
            <span className="qt-text-secondary text-xs">Thinking</span>
            <select
              value={showThinking === true ? 'on' : showThinking === false ? 'off' : 'inherit'}
              onChange={(e) => {
                const v = e.target.value
                onSetShowThinking(v === 'on' ? true : v === 'off' ? false : null)
              }}
              className="qt-select qt-select-sm"
              title="Show reasoning models' chain-of-thought in this chat. Inherit defers to the global default. Display-only — never sent to any model."
            >
              <option value="inherit">Inherit</option>
              <option value="on">Show</option>
              <option value="off">Hide</option>
            </select>
          </div>
        </div>
      )}

      {onSetAnswerConfirmationOverride && (
        <div className="flex flex-col gap-2 pt-2 border-t qt-border-default">
          <div className="flex items-center justify-between gap-2">
            <span className="qt-text-secondary text-xs">Answer Confirmation</span>
            <select
              value={answerConfirmationOverride ?? 'inherit'}
              onChange={(e) => {
                const v = e.target.value
                onSetAnswerConfirmationOverride(v === 'ON' ? 'ON' : v === 'OFF' ? 'OFF' : null)
              }}
              className="qt-select qt-select-sm"
              title="Vet this chat's looked-up answers against what the character actually knew. Inherit defers to the project, then the global default."
            >
              <option value="inherit">Inherit</option>
              <option value="ON">On</option>
              <option value="OFF">Off</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

// =================================================================
// Organize section
// =================================================================

interface OrganizeSectionProps {
  chatId: string
  onRenameClick?: () => void
  onStateClick?: () => void
  onContinueChatClick?: () => void
  onMergeConversationClick?: () => void
  chatPhotoCount?: number
  onGalleryClick?: () => void
  isAutonomousRoom?: boolean
  onEditEnclaveClick?: () => void
}

function OrganizeSection({
  chatId,
  onRenameClick,
  onStateClick,
  onContinueChatClick,
  onMergeConversationClick,
  chatPhotoCount = 0,
  onGalleryClick,
  isAutonomousRoom = false,
  onEditEnclaveClick,
}: OrganizeSectionProps) {
  const handleExport = () => {
    // The server names the file after the chat title via Content-Disposition;
    // the filename here is only the Electron/anchor fallback.
    triggerUrlDownload(`/api/v1/chats/${chatId}?action=export`, 'chat_export.qtap')
  }

  const handleExportMarkdown = () => {
    // The server names the file after the chat title via Content-Disposition;
    // the filename here is only the Electron/anchor fallback.
    triggerUrlDownload(`/api/v1/chats/${chatId}?action=export-markdown`, 'chat_transcript.md')
  }

  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-organize flex flex-col gap-2">
      {isAutonomousRoom && onEditEnclaveClick && (
        <button
          type="button"
          onClick={onEditEnclaveClick}
          className="qt-tool-palette-button"
          title="Edit this enclave’s schedule, budget, and visibility"
        >
          <Icon name="settings" className="w-4 h-4" />
          <span>Edit Enclave</span>
        </button>
      )}

      <CopyChatIdButton chatId={chatId} variant="palette" />

      {onRenameClick && (
        <button
          type="button"
          onClick={onRenameClick}
          className="qt-tool-palette-button"
          title="Rename chat"
        >
          <Icon name="pencil" className="w-4 h-4" />
          <span>Rename</span>
        </button>
      )}

      {onStateClick && (
        <button
          type="button"
          onClick={onStateClick}
          className="qt-tool-palette-button"
          title="View/edit chat state"
        >
          <Icon name="database" className="w-4 h-4" />
          <span>State…</span>
        </button>
      )}

      {onContinueChatClick && (
        <button
          type="button"
          onClick={onContinueChatClick}
          className="qt-tool-palette-button"
          title="Continue this conversation in a new chat with a different scenario or project"
        >
          <Icon name="arrow-right" className="w-4 h-4" />
          <span>Continue Elsewhere</span>
        </button>
      )}

      {onMergeConversationClick && !isAutonomousRoom && (
        <button
          type="button"
          onClick={onMergeConversationClick}
          className="qt-tool-palette-button"
          title="Merge another conversation's characters and summary into this one"
        >
          <Icon name="user-plus" className="w-4 h-4" />
          <span>Merge In…</span>
        </button>
      )}

      <button
        type="button"
        onClick={handleExport}
        className="qt-tool-palette-button"
        title="Export chat"
      >
        <Icon name="download" className="w-4 h-4" />
        <span>Export</span>
      </button>

      <button
        type="button"
        onClick={handleExportMarkdown}
        className="qt-tool-palette-button"
        title="Export the conversation as a readable Markdown transcript"
      >
        <Icon name="file" className="w-4 h-4" />
        <span>Export Markdown</span>
      </button>

      {chatPhotoCount > 0 && onGalleryClick && (
        <button
          type="button"
          onClick={onGalleryClick}
          className="qt-tool-palette-button"
          title="View gallery"
        >
          <Icon name="image" className="w-4 h-4" />
          <span>Gallery ({chatPhotoCount})</span>
        </button>
      )}
    </div>
  )
}

// =================================================================
// Edit Content section
// =================================================================

interface EditContentSectionProps {
  onSearchReplaceClick?: () => void
  onBulkCharacterReplaceClick?: () => void
  onReextractMemoriesClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  chatMemoryCount?: number
}

function EditContentSection({
  onSearchReplaceClick,
  onBulkCharacterReplaceClick,
  onReextractMemoriesClick,
  onDeleteChatMemoriesClick,
  chatMemoryCount = 0,
}: EditContentSectionProps) {
  return (
    <div className="qt-chat-sidebar-section qt-chat-sidebar-section-edit flex flex-col gap-2">
      {onSearchReplaceClick && (
        <button
          type="button"
          onClick={onSearchReplaceClick}
          className="qt-tool-palette-button"
          title="Search and replace in chat"
        >
          <Icon name="search" className="w-4 h-4" />
          <span>Replace</span>
        </button>
      )}

      {onBulkCharacterReplaceClick && (
        <button
          type="button"
          onClick={onBulkCharacterReplaceClick}
          className="qt-tool-palette-button"
          title="Bulk re-attribute messages between characters"
        >
          <Icon name="swap" className="w-4 h-4" />
          <span>Bulk Replace</span>
        </button>
      )}

      {onReextractMemoriesClick && (
        <button
          type="button"
          onClick={onReextractMemoriesClick}
          className="qt-tool-palette-button"
          title="Re-extract memories"
        >
          <Icon name="refresh" className="w-4 h-4" />
          <span>Re-extract Memories</span>
        </button>
      )}

      {onDeleteChatMemoriesClick && (
        <button
          type="button"
          onClick={onDeleteChatMemoriesClick}
          className="qt-tool-palette-button qt-tool-palette-button-danger"
          title="Delete chat memories"
        >
          <Icon name="trash" className="w-4 h-4" />
          <span>Delete Memories ({chatMemoryCount})</span>
        </button>
      )}
    </div>
  )
}

// =================================================================
// Helpers
// =================================================================

function getCollapsedPositionBadgeClass(status: TurnOrderStatus): string {
  switch (status) {
    case 'generating': return 'qt-participant-position-generating'
    case 'next': return 'qt-participant-position-next'
    case 'queued': return 'qt-participant-position-queued'
    case 'eligible': return 'qt-participant-position-eligible'
    case 'user-turn': return 'qt-participant-position-user-turn'
    case 'spoken': return 'qt-participant-position-spoken'
    default: return ''
  }
}
