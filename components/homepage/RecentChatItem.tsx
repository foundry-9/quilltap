'use client'

/**
 * RecentChatItem
 *
 * Individual chat item for the homepage recent chats list.
 */

import Link from 'next/link'
import AvatarStack from '@/components/ui/AvatarStack'
import { formatMessageTime } from '@/lib/format-time'
import { useWorkspaceLink } from '@/components/workspace/useWorkspaceLink'
import type { RecentChat } from './types'

interface RecentChatItemProps {
  chat: RecentChat
}

export function RecentChatItem({ chat }: RecentChatItemProps) {
  // Inside the workspace, open the conversation as a tab instead of navigating
  // (which would unmount the whole workspace). Falls through to normal Link
  // navigation on the legacy home route.
  const openInWorkspace = useWorkspaceLink()
  const href = `/salon/${chat.id}`
  // Get active character participants for avatar display
  const characters = chat.participants
    .filter(p => p.type === 'CHARACTER' && p.isActive && p.character)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(p => p.character!)

  // Format character names
  const characterNames = characters.length === 0
    ? 'Unknown'
    : characters.length === 1
      ? characters[0].name
      : characters.length === 2
        ? `${characters[0].name} + ${characters[1].name}`
        : characters.map(c => c.name).join(' + ')

  return (
    <Link
      href={href}
      onClick={(e) => openInWorkspace(href, e)}
      className="flex items-center gap-3 p-2 rounded-lg hover:qt-bg-muted/50 transition-colors"
    >
      {/* Story background thumbnail (preferred) or Avatar stack */}
      {chat.storyBackgroundUrl ? (
        <div className="flex-shrink-0 w-16 h-11 rounded-md overflow-hidden qt-bg-muted -my-1">
          <img
            src={chat.storyBackgroundUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <AvatarStack entities={characters} size="sm" maxDisplay={2} />
      )}
      <div className="flex-1 min-w-0">
        <p className="qt-card-title truncate">
          {chat.title}
        </p>
        <p className="qt-card-subtitle truncate">
          {characterNames}
        </p>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className="qt-meta">
          {formatMessageTime(chat.lastMessageAt ?? chat.updatedAt)}
        </span>
        <span className="qt-meta text-primary">
          {chat._count.messages} msgs{chat.isDangerousChat && <span className="qt-text-destructive" title="Flagged as dangerous" aria-label="Flagged as dangerous">*</span>}
        </span>
      </div>
    </Link>
  )
}
