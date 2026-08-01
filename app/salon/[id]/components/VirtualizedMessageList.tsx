'use client'

import type { Virtualizer } from '@tanstack/react-virtual'
import ToolMessage from '@/components/chat/ToolMessage'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'
import type { Message, CharacterData, ChatSettings } from '../types'
import type { SwipeState } from '../hooks/useChatData'
import type { RenderItem } from '../announcement-render-items'
import { Icon } from '@/components/ui/icon'
import { MessageRow } from './MessageRow'
import { AnnouncementGroup } from './AnnouncementChip'
import { isOperatorAuthoredAnnouncement } from '../whisper-visibility'
import { StreamingMessage } from './StreamingMessage'
import type { StreamingToolBatch } from '../hooks/useSSEStreaming'
import { useDeferredMeasureRef } from '../hooks/useDeferredMeasureRef'

interface VirtualizedMessageListProps {
  /** Flat (post-tool-grouping) message list. Still needed for the TOOL-row
   *  backward participant-walk and the near-end forceRender heuristic. */
  messages: Message[]
  /** Render-items the virtualizer indexes over: messages + packed announcement groups. */
  renderItems: RenderItem[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
  messagesContainerRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  // Message display
  editingMessageId: string | null
  editContent: string
  viewSourceMessageIds: Set<string>
  /** IDs of system-author messages that the user has explicitly expanded */
  expandedSystemMessageIds: Set<string>
  /** Toggle expansion state for a system-author message */
  onToggleSystemMessageExpanded: (messageId: string) => void
  swipeStates: Record<string, SwipeState>
  setSwipeStates: React.Dispatch<React.SetStateAction<Record<string, SwipeState>>>
  // Appearance
  chatSettings: ChatSettings | null
  roleplayRenderingPatterns: RenderingPattern[] | undefined
  roleplayDialogueDetection: DialogueDetection | null | undefined
  // Multi-char
  isMultiChar: boolean
  participantData: ParticipantData[]
  turnState: TurnState
  streaming: boolean
  streamingContent: string
  waitingForResponse: boolean
  userParticipantId: string | null
  isPaused: boolean
  respondingParticipantId: string | null
  /** Chat ID for terminal embed rendering */
  chatId: string
  // Message actions - signatures match useMessageActions return type
  messageActions: {
    startEdit: (message: Message) => void
    saveEdit: (messageId: string) => Promise<void>
    cancelEdit: () => void
    toggleSourceView: (messageId: string) => void
    deleteMessage: (messageId: string) => Promise<void>
    generateSwipe: (messageId: string, fetchChat: () => Promise<void>) => void
    switchSwipe: (groupId: string, direction: 'prev' | 'next', swipeStates: Record<string, SwipeState>, setSwipeStates: (value: any) => void) => void
    copyMessageContent: (content: string) => void
    resendMessage: (message: Message) => Promise<void>
    canResendMessage: (messageId: string) => boolean
  }
  turnManagement: {
    handleNudge: (participantId: string) => void | Promise<void>
    handleQueue: (participantId: string) => void
    handleDequeue: (participantId: string) => void
    handleContinue: () => void
  }
  // Handlers
  setEditContent: (content: string) => void
  onTogglePause: () => void
  onOverrideDangerFlag: (messageId: string) => void
  onRemoveCharacter: (participantId: string) => void
  onReattribute: (messageId: string) => void
  onImageClick: (filepath: string, filename: string, fileId?: string) => void
  /** Opens the SaveImageDialog for one image attachment on a message. */
  onSaveImage?: (messageId: string, attachmentId: string) => void
  fetchChat: () => Promise<void>
  // LLM logs
  messagesWithLogs: Set<string>
  onViewLLMLogs: (messageId: string) => void
  // In-progress tool calls, batched by prose offset, for the streaming bubble
  streamingToolBatches: StreamingToolBatch[]
  // Streaming message display
  getRespondingCharacter: () => CharacterData | undefined
  shouldShowAvatars: () => boolean
  getFirstCharacter: () => CharacterData | null | undefined
  getMessageAvatar: (message: Message) => {
    name: string
    title?: string | null
    avatarUrl?: string | null
    defaultImage?: { id: string; filepath: string; url?: string } | null
  } | null
  /** Mapping of participant IDs to display names for whisper labels */
  participantNames?: Record<string, string>
  /** Set of participant IDs controlled by the user */
  userParticipantIdSet?: Set<string>
  /** Whether the Concierge has flagged this chat as dangerous */
  isDangerousChat?: boolean
  /** Resolved per-chat thinking visibility (chat.showThinking ?? global default). DISPLAY ONLY. */
  showThinking?: boolean
  /** Whether thinking blocks start collapsed (global default). */
  thinkingCollapsedByDefault?: boolean
  /** Live cumulative reasoning ("thinking") for the in-progress streaming message. DISPLAY ONLY. */
  streamingReasoning?: string
  /** Whether to show the floating jump-to-bottom button (reader has scrolled up). */
  showScrollToBottom?: boolean
  /** Click handler for the jump-to-bottom button. */
  onScrollToBottom?: () => void
}

export function VirtualizedMessageList({
  messages,
  renderItems,
  virtualizer,
  messagesContainerRef,
  messagesEndRef,
  editingMessageId,
  editContent,
  viewSourceMessageIds,
  expandedSystemMessageIds,
  onToggleSystemMessageExpanded,
  swipeStates,
  setSwipeStates,
  chatSettings,
  roleplayRenderingPatterns,
  roleplayDialogueDetection,
  isMultiChar,
  participantData,
  turnState,
  streaming,
  streamingContent,
  waitingForResponse,
  userParticipantId,
  isPaused,
  respondingParticipantId,
  chatId,
  messageActions,
  turnManagement,
  setEditContent,
  onTogglePause,
  onOverrideDangerFlag,
  onRemoveCharacter,
  onReattribute,
  onImageClick,
  onSaveImage,
  fetchChat,
  messagesWithLogs,
  onViewLLMLogs,
  streamingToolBatches,
  getRespondingCharacter,
  shouldShowAvatars,
  getFirstCharacter,
  getMessageAvatar,
  participantNames,
  userParticipantIdSet,
  isDangerousChat = false,
  showThinking = false,
  thinkingCollapsedByDefault = true,
  streamingReasoning = '',
  showScrollToBottom = false,
  onScrollToBottom,
}: VirtualizedMessageListProps) {
  // Measure rows on a microtask rather than during commit — measuring inline
  // makes the virtualizer call `flushSync` from a ref callback, which React
  // refuses (and warns about) while it is already rendering. See the hook.
  const measureRow = useDeferredMeasureRef(virtualizer)

  // Resolve per-message character from participantData, falling back to first character
  const getCharacterForMessage = (message: Message): CharacterData | undefined => {
    if (message.participantId) {
      const participant = participantData.find(p => p.id === message.participantId)
      if (participant?.character) {
        return participant.character as CharacterData
      }
    }
    return getFirstCharacter() ?? undefined
  }

  return (
    <div className="qt-chat-messages-viewport">
    <div className="qt-chat-messages" ref={messagesContainerRef}>
      <div className="qt-chat-messages-list">
        {/* Virtualized messages rendering */}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = renderItems[virtualRow.index]
            if (!item) return null

            // Packed run of consecutive collapsed announcements — one virtual row
            // of flex-wrapping chips.
            if (item.kind === 'announcement-group') {
              return (
                <div
                  key={item.id}
                  data-index={virtualRow.index}
                  ref={measureRow}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <AnnouncementGroup
                    members={item.members}
                    onToggleSystemMessageExpanded={onToggleSystemMessageExpanded}
                    participantNames={participantNames}
                  />
                </div>
              )
            }

            const message = item.message
            const messageIndex = item.messageIndex
            const isEditing = editingMessageId === message.id
            const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null
            const showResendButton = messageActions.canResendMessage(message.id)

            if (message.role === 'TOOL') {
              // Fall back to the most recent ASSISTANT message's participant
              // when this row has no participantId itself — historical TOOL
              // rows persisted before character attribution was added are
              // identifiable by position only.
              const messageForAvatar = message.systemSender || message.participantId
                ? message
                : (() => {
                    for (let k = messageIndex - 1; k >= 0; k--) {
                      const prev = messages[k]
                      if (prev.role === 'ASSISTANT' && prev.participantId) {
                        return { ...message, participantId: prev.participantId }
                      }
                      if (prev.role === 'USER') break
                    }
                    return message
                  })()
              const avatarData = getMessageAvatar(messageForAvatar)
              const headerAvatar = avatarData
                ? {
                    name: avatarData.name,
                    avatarUrl: avatarData.avatarUrl ?? null,
                    defaultImage: avatarData.defaultImage ?? null,
                  }
                : null
              return (
                <div
                  key={message.id}
                  data-index={virtualRow.index}
                  ref={measureRow}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ToolMessage
                    message={message}
                    character={getCharacterForMessage(messageForAvatar)}
                    headerAvatar={headerAvatar}
                    onImageClick={(filepath, filename, fileId) => {
                      onImageClick(filepath, filename, fileId)
                    }}
                  />
                </div>
              )
            }

            const messageAvatarData = shouldShowAvatars() ? getMessageAvatar(message) : null
            const messageAvatar = messageAvatarData as any

            return (
              <div
                key={message.id}
                data-index={virtualRow.index}
                ref={measureRow}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <MessageRow
                  message={message}
                  messageIndex={messageIndex}
                  isEditing={isEditing}
                  editContent={editContent}
                  viewSourceMessageIds={viewSourceMessageIds}
                  isSystemMessageCollapsed={
                    // Carina reference answers always render as a full row (with
                    // the answerer's avatar + the answer), never a collapsed chip.
                    message.systemSender !== 'carina' &&
                    !!message.systemSender && !expandedSystemMessageIds.has(message.id)
                  }
                  onToggleSystemMessageExpanded={onToggleSystemMessageExpanded}
                  swipeState={swipeState}
                  showResendButton={showResendButton}
                  shouldShowAvatars={shouldShowAvatars()}
                  messageAvatar={messageAvatar}
                  renderingPatterns={roleplayRenderingPatterns}
                  dialogueDetection={roleplayDialogueDetection}
                  forceRender={messageIndex >= messages.length - 5}
                  isMultiChar={isMultiChar}
                  participantData={participantData}
                  turnState={turnState}
                  streaming={streaming}
                  waitingForResponse={waitingForResponse}
                  userParticipantId={userParticipantId}
                  isPaused={isPaused}
                  onTogglePause={onTogglePause}
                  tokenDisplaySettings={chatSettings?.tokenDisplaySettings}
                  dangerousContentSettings={chatSettings?.dangerousContentSettings}
                  onOverrideDangerFlag={onOverrideDangerFlag}
                  character={getCharacterForMessage(message)}
                  chatId={chatId}
                  onEditStart={messageActions.startEdit}
                  onEditSave={messageActions.saveEdit}
                  onEditCancel={messageActions.cancelEdit}
                  onEditChange={setEditContent}
                  onToggleSourceView={messageActions.toggleSourceView}
                  onDelete={messageActions.deleteMessage}
                  onGenerateSwipe={(msgId) => messageActions.generateSwipe(msgId, fetchChat)}
                  onSwitchSwipe={(groupId, dir) => messageActions.switchSwipe(groupId, dir, swipeStates, setSwipeStates)}
                  onCopyContent={messageActions.copyMessageContent}
                  onResend={messageActions.resendMessage}
                  onImageClick={(filepath, filename, fileId) => {
                    onImageClick(filepath, filename, fileId)
                  }}
                  onSaveImage={onSaveImage}
                  onHandleNudge={turnManagement.handleNudge}
                  onHandleQueue={turnManagement.handleQueue}
                  onHandleDequeue={turnManagement.handleDequeue}
                  onHandleTalkativenessChange={() => {}}
                  onHandleRemoveCharacter={onRemoveCharacter}
                  onHandleContinue={turnManagement.handleContinue}
                  onReattribute={onReattribute}
                  hasLLMLogs={messagesWithLogs.has(message.id)}
                  onViewLLMLogs={onViewLLMLogs}
                  onCourierTurnSettled={fetchChat}
                  attachedToolMessages={message.attachedToolMessages}
                  showThinking={showThinking}
                  thinkingCollapsedByDefault={thinkingCollapsedByDefault}
                  participantNames={participantNames}
                  isOverheardWhisper={
                    !!(message.targetParticipantIds?.length) &&
                    // Staff whispers (Pascal, the Commonplace Book, …) are
                    // surfaced to the operator on purpose — see the visibility
                    // rule in SalonView. Dimming what we deliberately showed
                    // them to read would undercut the reason we showed it. They
                    // keep the whisper border and "whispered" label, so the
                    // privacy status stays legible without the 0.6 opacity.
                    // An announcement the operator wrote themselves is not
                    // overheard by definition — they are its author.
                    !message.systemSender &&
                    !isOperatorAuthoredAnnouncement(message) &&
                    !!(userParticipantIdSet) &&
                    !(message.participantId && userParticipantIdSet.has(message.participantId)) &&
                    !message.targetParticipantIds.some(id => userParticipantIdSet.has(id))
                  }
                  isDangerousChat={isDangerousChat}
                />
              </div>
            )
          })}
        </div>

        {/* Streaming message — in-progress tool calls nest inside this bubble */}
        <StreamingMessage
          streaming={streaming}
          streamingContent={streamingContent}
          waitingForResponse={waitingForResponse}
          respondingCharacter={getRespondingCharacter()}
          renderingPatterns={roleplayRenderingPatterns}
          dialogueDetection={roleplayDialogueDetection}
          shouldShowAvatars={shouldShowAvatars()}
          isDangerousChat={isDangerousChat}
          streamingToolBatches={streamingToolBatches}
          streamingReasoning={showThinking ? streamingReasoning : ''}
          thinkingCollapsedByDefault={thinkingCollapsedByDefault}
        />

        <div ref={messagesEndRef} />
      </div>
    </div>

      {showScrollToBottom && (
        <button
          type="button"
          className="qt-chat-scroll-to-bottom"
          onClick={onScrollToBottom}
          aria-label="Jump to latest message"
          title="Jump to latest message"
        >
          <Icon name="chevron-down" className="w-5 h-5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
