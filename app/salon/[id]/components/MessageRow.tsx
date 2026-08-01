'use client'

import { memo } from 'react'
import { Icon } from '@/components/ui/icon'
import LazyMessageContent from '@/components/chat/LazyMessageContent'
import ToolMessage from '@/components/chat/ToolMessage'
import { DangerFlagBadge } from '@/components/chat/DangerFlagBadge'
import { DangerContentWrapper } from '@/components/chat/DangerContentWrapper'
import { TerminalEmbed } from '@/components/terminal/TerminalEmbed'
import {
  getSystemSenderDisplayName,
  getSystemKindDisplayLabel,
  getAnnouncementAccentClasses,
} from './system-message-labels'
import { AnnouncementChip, AnnouncementBarContents } from './AnnouncementChip'
import { CourierBubble } from './CourierBubble'
import { buildInterleavedLayout, resolveReasoningSegments } from '../intersperse-reasoning'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { MessageDesktopAvatar } from './message-row/MessageDesktopAvatar'
import { MessageActionBar } from './message-row/MessageActionBar'
import { MessageDesktopActions } from './message-row/MessageDesktopActions'
import { getImageAttachments } from './message-row/helpers'
import type { MessageAvatarInfo } from './message-row/types'
import type { Message, TokenDisplaySettings, DangerousContentSettings, CharacterData } from '../types'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

const TERMINAL_SESSION_ID_RE = /<!--\s*terminalSessionId:([0-9a-f-]+)\s*-->/i

function extractTerminalSessionId(content: string | null | undefined): string | null {
  if (!content) return null
  const m = content.match(TERMINAL_SESSION_ID_RE)
  return m ? m[1] : null
}

interface MessageRowProps {
  message: Message
  messageIndex: number
  isEditing: boolean
  editContent: string
  viewSourceMessageIds: Set<string>
  swipeState: { current: number; total: number } | null
  showResendButton: boolean
  shouldShowAvatars: boolean
  messageAvatar: MessageAvatarInfo | null
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null
  /** Force immediate render (skip lazy loading) - use for last few messages */
  forceRender?: boolean
  isMultiChar: boolean
  participantData: ParticipantData[]
  turnState: TurnState
  streaming: boolean
  waitingForResponse: boolean
  userParticipantId: string | null
  isPaused?: boolean
  onTogglePause?: () => void
  /** Token display settings */
  tokenDisplaySettings?: TokenDisplaySettings
  /** Dangerous content display settings */
  dangerousContentSettings?: DangerousContentSettings
  /** Callback to override danger flags on a message */
  onOverrideDangerFlag?: (messageId: string) => void
  /** Whether this message has LLM logs available */
  hasLLMLogs?: boolean
  /** Callback to view LLM logs */
  onViewLLMLogs?: (messageId: string) => void
  /** Character data for tool messages */
  character?: CharacterData
  /** Chat ID for terminal embed rendering */
  chatId?: string

  // Callbacks
  onEditStart: (message: Message) => void
  onEditSave: (messageId: string) => void
  onEditCancel: () => void
  onEditChange: (content: string) => void
  onToggleSourceView: (messageId: string) => void
  onDelete: (messageId: string) => void
  onGenerateSwipe: (messageId: string) => void
  onSwitchSwipe: (swipeGroupId: string, direction: 'prev' | 'next') => void
  onCopyContent: (content: string) => void
  onResend: (message: Message) => void
  onImageClick: (filepath: string, filename: string, fileId?: string) => void
  /**
   * Open the Save Image dialog for one of the message's image attachments.
   * Fired by the per-message save toolbar button. When omitted, the button
   * is hidden.
   */
  onSaveImage?: (messageId: string, attachmentId: string) => void
  onHandleNudge: (participantId: string) => void
  onHandleQueue: (participantId: string) => void
  onHandleDequeue: (participantId: string) => void
  onHandleTalkativenessChange: (participantId: string, value: number) => void
  onHandleRemoveCharacter: (participantId: string) => void
  onHandleContinue: () => void
  onReattribute?: (messageId: string) => void
  /** Mapping of participant IDs to display names for whisper labels */
  participantNames?: Record<string, string>
  /** Whether this message is a whisper being shown via "show all" and the user is not sender/target */
  isOverheardWhisper?: boolean
  /** Whether the Concierge has flagged this chat as dangerous */
  isDangerousChat?: boolean
  /** True for Staff-authored messages that should render as a thin collapsed bar */
  isSystemMessageCollapsed?: boolean
  /** Toggle the collapsed state of a system-authored message */
  onToggleSystemMessageExpanded?: (messageId: string) => void
  /** Callback fired after a Courier placeholder is resolved or cancelled — triggers a chat refetch. */
  onCourierTurnSettled?: () => void
  /** Character-initiated TOOL result rows folded into this assistant message
   * (see group-tool-messages.ts). Rendered as embedded blocks below the prose. */
  attachedToolMessages?: Message[]
  /** Resolved per-chat thinking visibility (chat.showThinking ?? global default).
   * When false, reasoning blocks are omitted entirely. DISPLAY ONLY. */
  showThinking?: boolean
  /** Whether thinking blocks start collapsed (global default). */
  thinkingCollapsedByDefault?: boolean
}

function MessageRowInner({
  message,
  messageIndex,
  isEditing,
  editContent,
  viewSourceMessageIds,
  swipeState,
  showResendButton,
  shouldShowAvatars,
  messageAvatar,
  renderingPatterns,
  dialogueDetection,
  forceRender = false,
  isMultiChar,
  participantData,
  turnState,
  streaming,
  waitingForResponse,
  userParticipantId,
  isPaused = false,
  onTogglePause,
  tokenDisplaySettings,
  dangerousContentSettings,
  onOverrideDangerFlag,
  hasLLMLogs,
  onViewLLMLogs,
  character,
  chatId,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditChange,
  onToggleSourceView,
  onDelete,
  onGenerateSwipe,
  onSwitchSwipe,
  onCopyContent,
  onResend,
  onImageClick,
  onSaveImage,
  onHandleNudge,
  onHandleQueue,
  onHandleDequeue,
  onHandleTalkativenessChange,
  onHandleRemoveCharacter,
  onHandleContinue,
  onReattribute,
  participantNames,
  isOverheardWhisper = false,
  isDangerousChat = false,
  isSystemMessageCollapsed = false,
  onCourierTurnSettled,
  onToggleSystemMessageExpanded,
  attachedToolMessages,
  showThinking = false,
  thinkingCollapsedByDefault = true,
}: MessageRowProps) {
  const isWhisper = !!(message.targetParticipantIds && message.targetParticipantIds.length > 0)

  // Silent message styling is based solely on the persisted flag set when the message
  // was generated — NOT the participant's current status. Changing a character to silent
  // should not retroactively restyle their old messages.
  const isSilentMessage = !!message.isSilentMessage

  const messageRowClasses = ['qt-chat-message-row']
  if (message.role === 'USER') {
    messageRowClasses.push('qt-chat-message-row-user')
  } else {
    messageRowClasses.push('qt-chat-message-row-assistant')
  }

  const hasDangerFlags = message.dangerFlags && message.dangerFlags.length > 0
  const dangerDisplayMode = hasDangerFlags && dangerousContentSettings?.displayMode
    ? dangerousContentSettings.displayMode
    : 'SHOW'
  const showDangerBadges = hasDangerFlags && dangerousContentSettings?.showWarningBadges !== false

  // Character-initiated tool calls folded into this assistant message
  // (group-tool-messages.ts) and reasoning ("thinking") segments are spliced
  // into the prose at the offsets they fired, merged into one stream ordered by
  // (anchorOffset, seq). Source view shows the raw body, so it skips
  // interspersing and renders every folded call in the trailing block instead.
  // Reasoning is included only when the chat's thinking-visibility is on.
  const attachedTools = attachedToolMessages ?? []
  const isSourceView = viewSourceMessageIds.has(message.id)
  const reasoningSegments = (showThinking && !isSourceView) ? resolveReasoningSegments(message) : []
  const toolLayout = (attachedTools.length > 0 || reasoningSegments.length > 0) && !isSourceView
    ? buildInterleavedLayout(message.content, attachedTools, reasoningSegments)
    : null
  const trailingTools = isSourceView ? attachedTools : (toolLayout?.trailingTools ?? [])

  // The Courier: pending placeholder for a manual / clipboard turn. Render
  // a special bubble with the Markdown blob, copy button, attachment links,
  // and a paste-back textarea. Skip the normal action bar, edit, source-view,
  // and danger-flag chrome.
  if (message.pendingExternalPrompt) {
    const courierName = messageAvatar?.name || 'this character'
    return (
      <div
        id={`message-${message.id}`}
        data-message-id={message.id}
        key={message.id}
        className={messageRowClasses.concat(['qt-chat-message-row-courier']).join(' ')}
      >
        {message.role === 'ASSISTANT' && shouldShowAvatars && messageAvatar && (
          <MessageDesktopAvatar
            messageAvatar={messageAvatar}
            dangerous={isDangerousChat}
            badge={{ provider: message.provider, modelName: message.modelName }}
          />
        )}
        <div className="qt-chat-message-body group">
          <div className="chat-message qt-chat-message-assistant">
            <CourierBubble
              chatId={chatId || ''}
              message={message}
              characterName={courierName}
              onResolved={() => onCourierTurnSettled?.()}
              onCancelled={() => onCourierTurnSettled?.()}
            />
          </div>
        </div>
      </div>
    )
  }

  if (isSystemMessageCollapsed && message.systemSender && onToggleSystemMessageExpanded) {
    // Defensive fallback: collapsed announcements normally render packed into an
    // AnnouncementGroup (see VirtualizedMessageList) and don't reach MessageRow.
    // The chip itself owns the id/data-message-id scroll anchor, so the wrapper
    // omits them to avoid a duplicate id.
    return (
      <div key={message.id} className={messageRowClasses.join(' ')}>
        <AnnouncementChip
          message={message}
          onToggleExpanded={onToggleSystemMessageExpanded}
          participantNames={participantNames}
        />
      </div>
    )
  }

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      key={message.id}
      className={messageRowClasses.join(' ')}
    >
      {/* Desktop avatar - assistant (left side) */}
      {message.role === 'ASSISTANT' && shouldShowAvatars && messageAvatar && (
        <MessageDesktopAvatar
          messageAvatar={messageAvatar}
          dangerous={isDangerousChat}
          badge={{ provider: message.provider, modelName: message.modelName }}
        />
      )}
      <div className="qt-chat-message-body group">
        {message.systemSender && !isEditing && onToggleSystemMessageExpanded && (() => {
          const senderName = getSystemSenderDisplayName(message.systemSender)
          const kindLabel = getSystemKindDisplayLabel(message)
          // A Pascal roll wears its outcome state on the bar's leading edge.
          const accent = getAnnouncementAccentClasses(message)
          return (
            <button
              type="button"
              onClick={() => onToggleSystemMessageExpanded(message.id)}
              className={`qt-chat-system-bar qt-chat-system-bar-expanded${accent ? ` ${accent}` : ''}`}
              aria-expanded={true}
              aria-label={`Collapse ${senderName}${kindLabel ? ` ${kindLabel}` : ''} message`}
            >
              <AnnouncementBarContents
                message={message}
                expanded
                participantNames={participantNames}
              />
            </button>
          )
        })()}
        <div
          className={`chat-message ${
            message.role === 'USER'
              ? 'qt-chat-message-user'
              : 'qt-chat-message-assistant'
          }${isWhisper ? ' qt-chat-message-whisper' : ''}${isOverheardWhisper ? ' qt-chat-message-whisper-overheard' : ''}${isSilentMessage ? ' qt-chat-message-silent' : ''}`}
        >
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => onEditChange(e.target.value)}
                className="qt-textarea"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onEditSave(message.id)}
                  className="qt-button qt-button-primary qt-button-sm"
                >
                  Save
                </button>
                <button
                  onClick={onEditCancel}
                  className="qt-button qt-button-secondary qt-button-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Whisper label */}
              {isWhisper && (
                <div className="qt-chat-whisper-label">
                  whispered to {message.targetParticipantIds!.map(
                    id => participantNames?.[id] || 'unknown'
                  ).join(', ')}
                </div>
              )}
              {/* Silent mode label */}
              {isSilentMessage && !isWhisper && (
                <div className="qt-chat-silent-label">
                  silent — inner thoughts and actions only
                </div>
              )}
              <DangerContentWrapper displayMode={dangerDisplayMode}>
                {isSourceView ? (
                  <div className="qt-code-block whitespace-pre-wrap break-words overflow-auto max-h-96">
                    {message.content}
                  </div>
                ) : toolLayout ? (
                  /* Character-initiated tool calls spliced into the prose at the
                     point they were invoked. Each prose run renders on its own
                     (no server-pre-rendered HTML) so per-run Markdown stays
                     well-formed. Calls with no usable anchor fall through to the
                     trailing block below. */
                  toolLayout.parts.map((part, idx) =>
                    part.kind === 'text' ? (
                      <LazyMessageContent
                        key={`seg-${idx}`}
                        content={part.text}
                        renderingPatterns={renderingPatterns}
                        dialogueDetection={dialogueDetection}
                        forceRender={forceRender}
                      />
                    ) : part.kind === 'reasoning' ? (
                      <ThinkingBlock
                        key={`reasoning-${idx}`}
                        content={part.content}
                        collapsedByDefault={thinkingCollapsedByDefault}
                        renderingPatterns={renderingPatterns}
                        dialogueDetection={dialogueDetection}
                      />
                    ) : (
                      <div
                        key={`tools-${idx}`}
                        className={`qt-chat-message-tools${toolLayout.parts[idx + 1]?.kind === 'text' ? ' qt-chat-message-tools-before-prose' : ''}`}
                      >
                        {part.messages.map((toolMessage) => (
                          <ToolMessage
                            key={toolMessage.id}
                            embedded
                            message={toolMessage}
                            character={character}
                            onImageClick={onImageClick}
                          />
                        ))}
                      </div>
                    )
                  )
                ) : (
                  <LazyMessageContent content={message.content} renderingPatterns={renderingPatterns} dialogueDetection={dialogueDetection} forceRender={forceRender} renderedHtml={message.renderedHtml} />
                )}
              </DangerContentWrapper>
              {/* Terminal embed for ariel session-opened messages */}
              {message.systemSender === 'ariel' && message.systemKind === 'session-opened' && chatId && (() => {
                const terminalSessionId = extractTerminalSessionId(message.content)
                return terminalSessionId ? <div className="mt-2"><TerminalEmbed sessionId={terminalSessionId} chatId={chatId} /></div> : null
              })()}
              {/* Danger flag badges */}
              {showDangerBadges && message.dangerFlags && (
                <DangerFlagBadge
                  dangerFlags={message.dangerFlags}
                  onOverride={onOverrideDangerFlag ? () => onOverrideDangerFlag(message.id) : undefined}
                />
              )}
              {/* Image attachment thumbnails */}
              {getImageAttachments(message).length > 0 && (
                <div className="qt-chat-attachment-list">
                  {getImageAttachments(message).map((attachment) => (
                    <button
                      key={attachment.id}
                      onClick={() => onImageClick(
                        attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`,
                        attachment.filename,
                        attachment.id
                      )}
                      type="button"
                      className="qt-button qt-chat-attachment-button"
                    >
                      { }
                      <img
                        src={`/${attachment.filepath.startsWith('/') ? attachment.filepath.slice(1) : attachment.filepath}`}
                        alt={attachment.filename}
                        width={80}
                        height={80}
                        className="qt-chat-attachment-image"
                      />
                      <div className="qt-chat-attachment-overlay">
                        <Icon name="zoom-in" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Tool calls without a usable prose anchor (legacy rows, dropped
                  offsets) — and, in source view, every folded call — render as
                  separate blocks below the prose, the pre-interspersing layout. */}
              {trailingTools.length > 0 && (
                <div className="qt-chat-message-tools">
                  {trailingTools.map((toolMessage) => (
                    <ToolMessage
                      key={toolMessage.id}
                      embedded
                      message={toolMessage}
                      character={character}
                      onImageClick={onImageClick}
                    />
                  ))}
                </div>
              )}

              {/* Action bar - shows action icons at bottom of message */}
              <MessageActionBar
                message={message}
                viewSourceMessageIds={viewSourceMessageIds}
                swipeState={swipeState}
                showResendButton={showResendButton}
                hasLLMLogs={hasLLMLogs}
                participantData={participantData}
                tokenDisplaySettings={tokenDisplaySettings}
                onToggleSystemMessageExpanded={onToggleSystemMessageExpanded}
                onCopyContent={onCopyContent}
                onSaveImage={onSaveImage}
                onToggleSourceView={onToggleSourceView}
                onEditStart={onEditStart}
                onDelete={onDelete}
                onGenerateSwipe={onGenerateSwipe}
                onReattribute={onReattribute}
                onViewLLMLogs={onViewLLMLogs}
                onResend={onResend}
                onSwitchSwipe={onSwitchSwipe}
              />
            </>
          )}
        </div>

        {/* Desktop-only affordances (hover toolbar + text actions) */}
        {!isEditing && (
          <MessageDesktopActions
            message={message}
            viewSourceMessageIds={viewSourceMessageIds}
            swipeState={swipeState}
            showResendButton={showResendButton}
            hasLLMLogs={hasLLMLogs}
            participantData={participantData}
            onCopyContent={onCopyContent}
            onToggleSourceView={onToggleSourceView}
            onViewLLMLogs={onViewLLMLogs}
            onEditStart={onEditStart}
            onDelete={onDelete}
            onResend={onResend}
            onReattribute={onReattribute}
            onGenerateSwipe={onGenerateSwipe}
            onSwitchSwipe={onSwitchSwipe}
          />
        )}
      </div>
      {/* Desktop avatar - user (right side) */}
      {message.role === 'USER' && shouldShowAvatars && messageAvatar && (
        <MessageDesktopAvatar messageAvatar={messageAvatar} />
      )}
    </div>
  )
}

/**
 * Memoized MessageRow component to prevent unnecessary re-renders.
 * Only re-renders when message content, edit state, or relevant UI state changes.
 */
export const MessageRow = memo(MessageRowInner, (prev, next) => {
  // Return true if props are equal (skip re-render)

  // Core message identity and content
  if (prev.message.id !== next.message.id) return false
  if (prev.message.content !== next.message.content) return false
  if (prev.message.role !== next.message.role) return false
  if (prev.messageIndex !== next.messageIndex) return false

  // Edit state
  if (prev.isEditing !== next.isEditing) return false
  if (prev.isEditing && prev.editContent !== next.editContent) return false

  // View source toggle (compare Set membership for this message)
  if (prev.viewSourceMessageIds.has(prev.message.id) !== next.viewSourceMessageIds.has(next.message.id)) return false

  // Swipe state
  if (prev.swipeState?.current !== next.swipeState?.current) return false
  if (prev.swipeState?.total !== next.swipeState?.total) return false

  // Display toggles
  if (prev.showResendButton !== next.showResendButton) return false
  if (prev.shouldShowAvatars !== next.shouldShowAvatars) return false

  // Streaming/generation state
  if (prev.streaming !== next.streaming) return false
  if (prev.waitingForResponse !== next.waitingForResponse) return false
  if (prev.isPaused !== next.isPaused) return false

  // Multi-char specific state
  if (prev.isMultiChar !== next.isMultiChar) return false
  if (prev.turnState.currentTurnParticipantId !== next.turnState.currentTurnParticipantId) return false

  // Avatar info (compare by value since it's an object)
  if (prev.messageAvatar?.name !== next.messageAvatar?.name) return false
  if (prev.messageAvatar?.avatarUrl !== next.messageAvatar?.avatarUrl) return false

  // Rendering patterns (reference equality is fine - they're stable)
  if (prev.renderingPatterns !== next.renderingPatterns) return false
  if (prev.dialogueDetection !== next.dialogueDetection) return false

  // Force render flag (for last few messages to avoid lazy loading)
  if (prev.forceRender !== next.forceRender) return false

  // Attachments (check if array changed)
  const prevAttachments = prev.message.attachments || []
  const nextAttachments = next.message.attachments || []
  if (prevAttachments.length !== nextAttachments.length) return false

  // Pre-rendered HTML
  if (prev.message.renderedHtml !== next.message.renderedHtml) return false

  // Character data
  if (prev.character?.id !== next.character?.id) return false

  // Token display settings
  if (prev.tokenDisplaySettings?.showPerMessageTokens !== next.tokenDisplaySettings?.showPerMessageTokens) return false
  if (prev.tokenDisplaySettings?.showPerMessageCost !== next.tokenDisplaySettings?.showPerMessageCost) return false

  // Token data (if display is enabled)
  if (prev.tokenDisplaySettings?.showPerMessageTokens || next.tokenDisplaySettings?.showPerMessageTokens) {
    if (prev.message.promptTokens !== next.message.promptTokens) return false
    if (prev.message.completionTokens !== next.message.completionTokens) return false
  }

  // LLM logs availability
  if (prev.hasLLMLogs !== next.hasLLMLogs) return false

  // Danger flags
  const prevDangerFlags = prev.message.dangerFlags || []
  const nextDangerFlags = next.message.dangerFlags || []
  if (prevDangerFlags.length !== nextDangerFlags.length) return false
  if (prev.dangerousContentSettings?.displayMode !== next.dangerousContentSettings?.displayMode) return false
  if (prev.dangerousContentSettings?.showWarningBadges !== next.dangerousContentSettings?.showWarningBadges) return false

  // Whisper props
  if (prev.isOverheardWhisper !== next.isOverheardWhisper) return false
  if (prev.participantNames !== next.participantNames) return false

  // Danger state
  if (prev.isDangerousChat !== next.isDangerousChat) return false

  // System-message collapse state
  if (prev.isSystemMessageCollapsed !== next.isSystemMessageCollapsed) return false

  // Attached (nested) tool messages — compare by length and id sequence
  const prevTools = prev.attachedToolMessages || []
  const nextTools = next.attachedToolMessages || []
  if (prevTools.length !== nextTools.length) return false
  for (let i = 0; i < prevTools.length; i++) {
    if (prevTools[i].id !== nextTools[i].id) return false
    if (prevTools[i].content !== nextTools[i].content) return false
  }

  // Thinking ("reasoning") visibility + content
  if (prev.showThinking !== next.showThinking) return false
  if (prev.thinkingCollapsedByDefault !== next.thinkingCollapsedByDefault) return false
  if (prev.message.reasoningContent !== next.message.reasoningContent) return false
  if ((prev.message.reasoningSegments?.length ?? 0) !== (next.message.reasoningSegments?.length ?? 0)) return false

  // Answer-confirmation state (badge)
  if (prev.message.confirmed !== next.message.confirmed) return false
  if (prev.message.confirmationChecked !== next.message.confirmationChecked) return false
  if (prev.message.confirmationRevised !== next.message.confirmationRevised) return false
  if (prev.message.confirmationNotes !== next.message.confirmationNotes) return false

  // Props are equal, skip re-render
  return true
})
