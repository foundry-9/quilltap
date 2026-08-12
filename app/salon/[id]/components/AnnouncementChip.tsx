'use client'

import { memo } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatMessageTime } from '@/lib/format-time'
import {
  getSystemSenderDisplayName,
  getSystemKindDisplayLabel,
  getAnnouncementImportance,
  getAnnouncementOutcomeState,
  getAnnouncementAccentClasses,
} from './system-message-labels'
import type { Message } from '../types'

/**
 * Render the whisper audience of an announcement as a compact "to Alice, Bob"
 * tag, or nothing at all when the announcement is public. Collapsed to a chip,
 * an announcement shows none of the message body's whisper chrome — without
 * this the operator cannot tell a private aside from a public proclamation
 * until they expand it, which is precisely the distinction they need at a
 * glance.
 */
function WhisperTag({
  message,
  participantNames,
}: {
  message: Message
  participantNames?: Record<string, string>
}) {
  const targets = message.targetParticipantIds
  if (!targets || targets.length === 0) return null
  const names = targets.map(id => participantNames?.[id] || 'unknown').join(', ')
  return (
    <span className="qt-chat-system-bar-whisper" title={`Whispered to ${names}`}>
      <span className="sr-only">whispered </span>
      to {names}
    </span>
  )
}

/**
 * Shared inner contents of a Staff-authored announcement summary: an importance
 * dot, the sender name, an optional kind label, an optional whisper audience,
 * the timestamp, and a chevron. Rendered both inside packed collapsed chips
 * ({@link AnnouncementChip}) and at the top of an expanded announcement
 * (MessageRow's expanded header), so the dot/sender/kind/time line stays
 * defined in exactly one place.
 *
 * A Pascal roll outcome swaps the importance dot for the outcome's own state —
 * the reader wants to know whether the table dealt a success or a failure, not
 * that Pascal is generically important.
 */
export const AnnouncementBarContents = memo(function AnnouncementBarContents({
  message,
  expanded = false,
  participantNames,
}: {
  message: Message
  /** When true, render the down-chevron (collapse affordance) instead of the right-chevron. */
  expanded?: boolean
  /** Participant id → display name, for naming a whisper's audience. */
  participantNames?: Record<string, string>
}) {
  const senderName = getSystemSenderDisplayName(message.systemSender)
  const kindLabel = getSystemKindDisplayLabel(message)
  const outcomeState = getAnnouncementOutcomeState(message)
  const importance = getAnnouncementImportance(message)
  const dotModifier = outcomeState
    ? `qt-chat-announcement-dot-outcome-${outcomeState}`
    : `qt-chat-announcement-dot-${importance}`
  return (
    <>
      <span className={`qt-chat-announcement-dot ${dotModifier}`} aria-hidden="true" />
      <span className="qt-chat-system-bar-sender">{senderName}</span>
      {/* The state is carried by colour alone in the bar; name it for readers
          who can't see the accent (and for anyone skimming with a screen reader). */}
      {outcomeState && <span className="sr-only">{outcomeState}</span>}
      {kindLabel && <span className="qt-chat-system-bar-kind">{kindLabel}</span>}
      <WhisperTag message={message} participantNames={participantNames} />
      <span className="qt-chat-system-bar-time">{formatMessageTime(message.createdAt)}</span>
      <Icon
        name={expanded ? 'chevron-down' : 'chevron-right'}
        className={`qt-chat-system-bar-chevron${expanded ? ' qt-chat-system-bar-chevron-down' : ''}`}
        aria-hidden="true"
      />
    </>
  )
})

/**
 * A single collapsed announcement rendered as a content-width chip. Keeps the
 * `id` / `data-message-id` so deep-link and delete-next-focus scroll-to-message
 * (page.tsx, useMessageActions) still resolve. Clicking expands it.
 */
export const AnnouncementChip = memo(function AnnouncementChip({
  message,
  onToggleExpanded,
  participantNames,
}: {
  message: Message
  onToggleExpanded: (messageId: string) => void
  participantNames?: Record<string, string>
}) {
  const senderName = getSystemSenderDisplayName(message.systemSender)
  const kindLabel = getSystemKindDisplayLabel(message)
  const accent = getAnnouncementAccentClasses(message)
  const isWhisper = !!message.targetParticipantIds?.length
  return (
    <button
      type="button"
      id={`message-${message.id}`}
      data-message-id={message.id}
      onClick={() => onToggleExpanded(message.id)}
      className={`qt-chat-announcement-chip${accent ? ` ${accent}` : ''}${
        isWhisper ? ' qt-chat-announcement-chip-whisper' : ''
      }`}
      aria-expanded={false}
      aria-label={`Expand ${senderName}${kindLabel ? ` ${kindLabel}` : ''} message`}
    >
      <AnnouncementBarContents message={message} participantNames={participantNames} />
    </button>
  )
})

/**
 * A run of consecutive collapsed announcements, packed into a single flex-wrap
 * row of chips. Occupies one virtualized render-item.
 */
export const AnnouncementGroup = memo(function AnnouncementGroup({
  members,
  onToggleSystemMessageExpanded,
  participantNames,
}: {
  members: { message: Message }[]
  onToggleSystemMessageExpanded: (messageId: string) => void
  participantNames?: Record<string, string>
}) {
  return (
    <div className="qt-chat-announcement-group">
      {members.map(({ message }) => (
        <AnnouncementChip
          key={message.id}
          message={message}
          onToggleExpanded={onToggleSystemMessageExpanded}
          participantNames={participantNames}
        />
      ))}
    </div>
  )
})
