/**
 * RecentChatsSection
 *
 * Client component displaying recent chats on the homepage with quick-hide filtering.
 */

'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { RecentChatItem } from './RecentChatItem'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import type { RecentChatsSectionProps } from './types'

export function RecentChatsSection({ chats }: RecentChatsSectionProps) {
  const { shouldHideChat } = useQuickHide()

  // Filter chats using quick-hide (one rule, shared with every other chat list)
  // CSS overflow:hidden will hide chats that don't fit in the card
  const visibleChats = useMemo(() => {
    return chats.filter(chat => {
      // Collect all tag IDs from character participants
      const characterTags: string[] = []

      for (const participant of chat.participants) {
        if (participant.character?.tags) {
          characterTags.push(...participant.character.tags)
        }
      }

      return !shouldHideChat({ characterTags, conciergeState: chat.conciergeState })
    })
  }, [chats, shouldHideChat])

  return (
    <div className="qt-homepage-section">
      <div className="qt-homepage-section-header">
        <h2 className="qt-homepage-section-title">Recent Chats</h2>
        <Link href="/salon" className="qt-homepage-section-link">
          View all &rarr;
        </Link>
      </div>
      <div className="qt-homepage-section-content">
        {visibleChats.length === 0 ? (
          <div className="text-center py-6 qt-text-secondary">
            <p className="text-sm">No chats yet</p>
            <Link href="/salon/new" className="text-xs text-primary hover:underline">
              Start your first chat
            </Link>
          </div>
        ) : (
          visibleChats.map(chat => (
            <RecentChatItem key={chat.id} chat={chat} />
          ))
        )}
      </div>
    </div>
  )
}
