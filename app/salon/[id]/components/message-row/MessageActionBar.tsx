'use client'

import { Icon } from '@/components/ui/icon'
import { formatMessageTime } from '@/lib/format-time'
import { TokenBadge } from '@/components/chat/TokenBadge'
import { ConfirmationBadge } from './ConfirmationBadge'
import { getImageAttachments } from './helpers'
import type { Message, TokenDisplaySettings } from '../../types'
import type { ParticipantData } from '@/components/chat/ParticipantCard'

interface MessageActionBarProps {
  message: Message
  viewSourceMessageIds: Set<string>
  swipeState: { current: number; total: number } | null
  showResendButton: boolean
  hasLLMLogs?: boolean
  participantData: ParticipantData[]
  tokenDisplaySettings?: TokenDisplaySettings
  onToggleSystemMessageExpanded?: (messageId: string) => void
  onCopyContent: (content: string) => void
  onSaveImage?: (messageId: string, attachmentId: string) => void
  onToggleSourceView: (messageId: string) => void
  onEditStart: (message: Message) => void
  onDelete: (messageId: string) => void
  onGenerateSwipe: (messageId: string) => void
  onReattribute?: (messageId: string) => void
  onViewLLMLogs?: (messageId: string) => void
  onResend: (message: Message) => void
  onSwitchSwipe: (swipeGroupId: string, direction: 'prev' | 'next') => void
}

/**
 * The in-message action bar pinned to the bottom of a message bubble: the icon
 * toolbar (copy, save-image, source toggle, edit, delete, regenerate,
 * re-attribute, LLM logs, resend, swipe) plus the timestamp and token badge.
 */
export function MessageActionBar({
  message,
  viewSourceMessageIds,
  swipeState,
  showResendButton,
  hasLLMLogs,
  participantData,
  tokenDisplaySettings,
  onToggleSystemMessageExpanded,
  onCopyContent,
  onSaveImage,
  onToggleSourceView,
  onEditStart,
  onDelete,
  onGenerateSwipe,
  onReattribute,
  onViewLLMLogs,
  onResend,
  onSwitchSwipe,
}: MessageActionBarProps) {
  return (
    <div className="qt-chat-message-action-bar">
      <div className="qt-chat-message-action-bar-icons">
        {/* Collapse (Staff-authored messages only) */}
        {message.systemSender && onToggleSystemMessageExpanded && (
          <button
            type="button"
            onClick={() => onToggleSystemMessageExpanded(message.id)}
            className="qt-chat-message-action-icon"
            title="Collapse this message"
            aria-label="Collapse this message"
          >
            <Icon name="chevron-down" className="rotate-180" />
          </button>
        )}
        {/* Copy */}
        <button
          onClick={() => onCopyContent(message.content)}
          className="qt-chat-message-action-icon"
          title="Copy message"
        >
          <Icon name="copy" />
        </button>
        {/* Save image (only when one or more image attachments are present) */}
        {onSaveImage && getImageAttachments(message).length > 0 && (
          <button
            onClick={() => {
              const images = getImageAttachments(message)
              if (images.length > 0) {
                onSaveImage(message.id, images[0].id)
              }
            }}
            className="qt-chat-message-action-icon"
            title={getImageAttachments(message).length > 1
              ? 'Save an image to a photo album'
              : 'Save image to a photo album'}
            aria-label="Save image to a photo album"
          >
            <Icon name="bookmark" />
          </button>
        )}
        {/* View source/rendered */}
        <button
          onClick={() => onToggleSourceView(message.id)}
          className="qt-chat-message-action-icon"
          title={viewSourceMessageIds.has(message.id) ? 'View rendered' : 'View source'}
        >
          {viewSourceMessageIds.has(message.id) ? (
            <Icon name="eye" />
          ) : (
            <Icon name="code" />
          )}
        </button>
        {/* Edit (user messages only) */}
        {message.role === 'USER' && (
          <button
            onClick={() => onEditStart(message)}
            className="qt-chat-message-action-icon"
            title="Edit message"
          >
            <Icon name="pencil" />
          </button>
        )}
        {/* Delete */}
        <button
          onClick={() => onDelete(message.id)}
          className="qt-chat-message-action-icon qt-chat-message-action-icon-danger"
          title="Delete message"
        >
          <Icon name="trash" />
        </button>
        {/* Regenerate (assistant messages only) */}
        {message.role === 'ASSISTANT' && (
          <button
            onClick={() => onGenerateSwipe(message.id)}
            className="qt-chat-message-action-icon"
            title="Regenerate response"
          >
            <Icon name="refresh" />
          </button>
        )}
        {/* Re-attribute (when other participants exist) */}
        {onReattribute && participantData.filter(p => p.id !== message.participantId).length > 0 && (
          <button
            onClick={() => onReattribute(message.id)}
            className="qt-chat-message-action-icon"
            title="Re-attribute to different participant"
          >
            <Icon name="swap" />
          </button>
        )}
        {/* View LLM Logs (assistant messages with logs) */}
        {hasLLMLogs && message.role === 'ASSISTANT' && onViewLLMLogs && (
          <button
            onClick={() => onViewLLMLogs(message.id)}
            className="qt-chat-message-action-icon"
            title="View LLM request/response logs"
          >
            <Icon name="cpu" />
          </button>
        )}
        {/* Answer-confirmation verdict (only present when a check ran) */}
        <ConfirmationBadge message={message} />
        {/* Resend (user messages only) */}
        {message.role === 'USER' && showResendButton && (
          <button
            onClick={() => onResend(message)}
            className="qt-chat-message-action-icon"
            title="Resend this message"
          >
            <Icon name="send" />
          </button>
        )}
        {/* Swipe controls */}
        {message.role === 'ASSISTANT' && swipeState && swipeState.total > 1 && (
          <>
            <button
              onClick={() => onSwitchSwipe(message.swipeGroupId!, 'prev')}
              disabled={swipeState.current === 0}
              className="qt-chat-message-action-icon disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous response"
            >
              <Icon name="chevron-left" />
            </button>
            <span className="qt-text-xs px-1">
              {swipeState.current + 1}/{swipeState.total}
            </span>
            <button
              onClick={() => onSwitchSwipe(message.swipeGroupId!, 'next')}
              disabled={swipeState.current === swipeState.total - 1}
              className="qt-chat-message-action-icon disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next response"
            >
              <Icon name="chevron-right" />
            </button>
          </>
        )}
      </div>
      <div className="qt-chat-message-action-timestamp flex items-center gap-2">
        <span>{formatMessageTime(message.createdAt)}</span>
        {tokenDisplaySettings?.showPerMessageTokens && (message.promptTokens || message.completionTokens) && (
          <TokenBadge
            promptTokens={message.promptTokens}
            completionTokens={message.completionTokens}
            totalTokens={message.tokenCount}
            showTokens={tokenDisplaySettings.showPerMessageTokens}
            showCost={tokenDisplaySettings.showPerMessageCost}
          />
        )}
      </div>
    </div>
  )
}
