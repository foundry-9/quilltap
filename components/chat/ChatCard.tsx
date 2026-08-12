'use client'

/**
 * ChatCard - Unified chat list item component
 *
 * Used across multiple pages to display chat items in a consistent way:
 * - /chats - Main chats list
 * - /projects/[id] - Project detail page chats section
 * - /characters/[id]/view - Character conversations tab
 *
 * Configure via props to show/hide features based on context.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { TagDisplay } from '@/components/tags/tag-display'
import { useUserCharacterDisplayName } from '@/hooks/usePersonaDisplayName'
import AvatarStack from '@/components/ui/AvatarStack'
import { formatChatListDate } from '@/lib/format-time'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { Icon } from '@/components/ui/icon'

// ============================================================================
// Types
// ============================================================================

export interface ChatCardParticipant {
  id: string
  name: string
  avatarUrl?: string | null
  defaultImageId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string | null
  } | null
  tags?: string[]
}

export interface ChatCardTag {
  tag: {
    id: string
    name: string
  }
}

export interface ChatCardProject {
  id: string
  name: string
  color?: string | null
}

export interface ChatCardUserCharacter {
  id: string
  name: string
  title?: string | null
}

export interface ChatCardData {
  id: string
  title: string | null
  messageCount: number
  /** Number of memories associated with this chat */
  memoryCount?: number
  participants: ChatCardParticipant[]
  tags?: ChatCardTag[]
  updatedAt: string
  lastMessageAt?: string
  project?: ChatCardProject | null
  userCharacter?: ChatCardUserCharacter | null
  /** Last message preview text (optional) */
  previewText?: string | null
  /** Story background image URL - displayed instead of avatars when present */
  storyBackgroundUrl?: string | null
  /** Whether this chat has been classified as dangerous */
  isDangerousChat?: boolean
  /** Scriptorium rendering status: none = not rendered, rendered = markdown only, embedded = fully indexed */
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
  /** Whether this chat is an autonomous character-to-character room (4.6) */
  isAutonomous?: boolean
}

export interface ChatCardProps {
  chat: ChatCardData
  /** Show avatar stack - default true */
  showAvatars?: boolean
  /** Show project indicator - default true */
  showProject?: boolean
  /** Show message preview text - default false */
  showPreview?: boolean
  /** Use relative date formatting (Today, Yesterday, etc.) - default false */
  useRelativeDates?: boolean
  /** Action type: 'delete' permanently deletes, 'remove' just unlinks from project */
  actionType?: 'delete' | 'remove'
  /** Callback for delete action */
  onDelete?: (chatId: string) => void
  /** Callback for remove action (unlink from project) */
  onRemove?: (chatId: string) => void
  /** Callback for memory re-extraction action */
  onReextractMemories?: (chatId: string) => void
  /** Callback for Scriptorium re-render action */
  onRenderConversation?: (chatId: string) => void
  /** Whether this card should be highlighted (e.g., newly imported) */
  highlighted?: boolean
  /** Ref to forward to the card element */
  cardRef?: React.Ref<HTMLDivElement>
  /** Context for character view - provides fallback title */
  characterName?: string
}


// ============================================================================
// Helpers
// ============================================================================

/**
 * Format participant names for display
 */
function formatParticipantNames(participants: ChatCardParticipant[]): string {
  if (participants.length === 0) return 'Unknown'
  if (participants.length === 1) return participants[0].name
  if (participants.length === 2) return `${participants[0].name} + ${participants[1].name}`
  return participants.map(p => p.name).join(' + ')
}

// ============================================================================
// Component
// ============================================================================

export function ChatCard({
  chat,
  showAvatars = true,
  showProject = true,
  showPreview = false,
  useRelativeDates = false,
  actionType = 'delete',
  onDelete,
  onRemove,
  onReextractMemories,
  onRenderConversation,
  highlighted = false,
  cardRef,
  characterName,
}: ChatCardProps) {
  const navigate = useWorkspaceNavigate()
  const { formatCharacterName } = useUserCharacterDisplayName()
  const [copiedLink, setCopiedLink] = useState(false)

  const participantNames = formatParticipantNames(chat.participants)
  const dateStr = formatChatListDate(chat.lastMessageAt || chat.updatedAt, useRelativeDates)
  const displayTitle = chat.title || (characterName ? `Chat with ${characterName}` : 'Untitled Chat')

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url = `${window.location.origin}/salon/${chat.id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLink(true)
      showSuccessToast('Link copied to clipboard')
      setTimeout(() => setCopiedLink(false), 1500)
    } catch {
      showErrorToast('Failed to copy link')
    }
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on a button or link
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a[href]')) {
      return
    }
    navigate(`/salon/${chat.id}`)
  }

  const handleAction = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (actionType === 'delete' && onDelete) {
      onDelete(chat.id)
    } else if (actionType === 'remove' && onRemove) {
      onRemove(chat.id)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate(`/salon/${chat.id}`)
    }
  }

  return (
    <div
      ref={cardRef}
      className="qt-entity-card chat-card relative cursor-pointer hover:qt-bg-surface-alt transition-colors"
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Highlight animation arrow for imported chats */}
      {highlighted && (
        <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 chat-card-highlight-arrow">
          <span className="text-6xl qt-text-warning font-black" style={{ textShadow: '0 0 10px rgba(255, 255, 0, 0.8)' }}>←</span>
        </div>
      )}

      <div className="flex items-stretch justify-between gap-4">
        <div className="flex items-stretch flex-1 gap-4">
          {/* Story background thumbnail (preferred) or Avatar stack */}
          {showAvatars && chat.storyBackgroundUrl ? (
            <div className="flex-shrink-0 self-stretch w-24 min-h-[4rem] max-h-32 rounded-lg overflow-hidden qt-bg-muted">
              <img
                src={chat.storyBackgroundUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          ) : showAvatars && chat.participants.length > 0 ? (
            <AvatarStack entities={chat.participants} size="lg" />
          ) : null}

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="qt-card-title truncate">
                {displayTitle}
              </h3>
              <span className="chat-card__badge inline-flex items-center gap-1 rounded-full qt-bg-primary/10 px-2.5 py-0.5 qt-body-sm font-semibold flex-shrink-0" title="Messages">
                <Icon name="chat" className="w-3 h-3" />
                {chat.messageCount}
              </span>
              {chat.memoryCount !== undefined && (
                <button
                  type="button"
                  className="chat-card__badge inline-flex items-center gap-1 rounded-full qt-bg-primary/10 px-2.5 py-0.5 qt-body-sm font-semibold flex-shrink-0 hover:qt-bg-primary/20 transition-colors cursor-pointer"
                  title="Memories — click to delete and re-extract"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onReextractMemories?.(chat.id)
                  }}
                >
                  <Icon name="book" className="w-3 h-3" />
                  {chat.memoryCount}
                </button>
              )}
              {chat.scriptoriumStatus !== undefined && (
                <button
                  type="button"
                  className={`chat-card__badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 qt-body-sm font-semibold flex-shrink-0 transition-colors cursor-pointer ${
                    chat.scriptoriumStatus === 'embedded'
                      ? 'qt-bg-success/10 qt-text-success hover:qt-bg-success/20'
                      : chat.scriptoriumStatus === 'rendered'
                      ? 'qt-bg-warning/10 qt-text-warning hover:qt-bg-warning/20'
                      : 'bg-destructive/10 qt-text-destructive hover:bg-destructive/20'
                  }`}
                  title={
                    chat.scriptoriumStatus === 'embedded'
                      ? 'Scriptorium: Rendered and embedded — click to re-render'
                      : chat.scriptoriumStatus === 'rendered'
                      ? 'Scriptorium: Rendered but not fully embedded — click to re-render'
                      : 'Scriptorium: Not yet rendered — click to render'
                  }
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRenderConversation?.(chat.id)
                  }}
                >
                  <Icon name="file" className="w-3 h-3" />
                </button>
              )}
              {chat.isDangerousChat && (
                <span className="qt-text-destructive text-sm flex-shrink-0" title="Flagged as dangerous" aria-label="Flagged as dangerous">*</span>
              )}
              {chat.isAutonomous && (
                <span
                  className="chat-card__badge inline-flex items-center gap-1 rounded-full qt-bg-muted qt-text-secondary px-2 py-0.5 qt-body-sm font-semibold flex-shrink-0"
                  title="Autonomous character-to-character room"
                >
                  <Icon name="clock" className="w-3 h-3" />
                  Autonomous
                </span>
              )}
              <button
                type="button"
                className="chat-card__badge inline-flex items-center justify-center rounded-full qt-bg-muted qt-text-secondary w-6 h-6 flex-shrink-0 hover:qt-bg-surface-alt transition-colors cursor-pointer"
                title="Copy link to this chat"
                aria-label="Copy link to this chat"
                onClick={handleCopyLink}
              >
                {copiedLink ? (
                  <Icon name="check" className="w-3 h-3 qt-text-success" />
                ) : (
                  <Icon name="link" className="w-3 h-3" />
                )}
              </button>
            </div>

            {/* Metadata row */}
            <p className="qt-text-small qt-text-secondary">
              {showAvatars && participantNames}
              {chat.userCharacter && (
                <>
                  {showAvatars && ' with '}
                  {!showAvatars && 'with '}
                  {formatCharacterName(chat.userCharacter)}
                </>
              )}
              {(showAvatars || chat.userCharacter) && ' \u2022 '}
              {dateStr}
            </p>

            {/* Preview text */}
            {showPreview && chat.previewText && (
              <p className="qt-text-small qt-text-secondary line-clamp-1 mt-2">
                {chat.previewText}
              </p>
            )}

            {/* Project & Tags row */}
            {((showProject && chat.project) || (chat.tags && chat.tags.length > 0)) && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {showProject && chat.project && (
                  <Link
                    href={`/prospero/${chat.project.id}`}
                    className="inline-flex items-center gap-1 qt-text-xs px-2 py-1 rounded-full qt-bg-muted hover:qt-bg-surface-alt transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="folder" className="w-3 h-3" style={chat.project.color ? { color: chat.project.color } : undefined} />
                    <span>{chat.project.name}</span>
                  </Link>
                )}
                {chat.tags && chat.tags.length > 0 && (
                  <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action button */}
        {(onDelete || onRemove) && (
          <div className="flex items-center">
            <button
              onClick={handleAction}
              className={
                actionType === 'delete'
                  ? 'chat-card__action inline-flex h-10 w-10 items-center justify-center rounded-lg bg-destructive qt-text-destructive-foreground shadow transition hover:qt-bg-destructive/90'
                  : 'inline-flex h-10 w-10 items-center justify-center rounded-lg qt-bg-muted qt-text-secondary shadow transition hover:qt-text-destructive hover:qt-bg-destructive/10'
              }
              title={actionType === 'delete' ? 'Delete chat' : 'Remove from project'}
            >
              {actionType === 'delete' ? (
                <Icon name="trash" className="w-5 h-5" />
              ) : (
                <Icon name="close" className="w-5 h-5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// CSS Animation (add to parent component or global styles)
// ============================================================================

/**
 * Add this CSS to the parent component for highlight animation:
 *
 * @keyframes chatCardHighlight {
 *   0% { opacity: 1; transform: translateX(0); }
 *   50% { opacity: 1; transform: translateX(10px); }
 *   100% { opacity: 0; transform: translateX(10px); }
 * }
 * .chat-card-highlight-arrow {
 *   animation: chatCardHighlight 2.5s ease-out forwards;
 * }
 */
