'use client'

/**
 * Chats Section
 *
 * Infinite scrolling list of project chats.
 * Uses the unified ChatCard component for consistent display.
 * Supports quick-hide filtering and displays tags.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useContentWidthOptional } from '@/components/providers/content-width-provider'
import { ChatCard, type ChatCardData } from '@/components/chat/ChatCard'
import type { ProjectChat } from '../types'

interface ChatsSectionProps {
  projectId: string
  chats: ProjectChat[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  onLoadMore: () => void
  onRemoveChat: (chatId: string) => void
}

/**
 * Transform ProjectChat to ChatCardData format
 */
function transformProjectChatToCardData(chat: ProjectChat): ChatCardData {
  return {
    id: chat.id,
    title: chat.title || null,
    messageCount: chat.messageCount,
    participants: chat.participants,
    tags: chat.tags,
    lastMessageAt: chat.lastMessageAt || undefined,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    // Project is null since we're already in project context
    project: null,
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    conciergeState: chat.conciergeState,
    dangerCategories: chat.dangerCategories,
  }
}

export function ChatsSection({
  projectId,
  chats,
  loading,
  loadingMore,
  hasMore,
  total,
  onLoadMore,
  onRemoveChat,
}: ChatsSectionProps) {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const { shouldHideChat } = useQuickHide()
  const contentWidth = useContentWidthOptional()
  const isWide = contentWidth?.isWide ?? false

  // Filter chats based on quick-hide rules
  const visibleChats = useMemo(() => {
    return chats.filter(chat => {
      // Collect all tag IDs: chat tags + all participant character tags
      const characterTags: string[] = (chat.tags || []).map(ct => ct.tag.id)

      for (const participant of chat.participants) {
        if (participant.tags) {
          characterTags.push(...participant.tags)
        }
      }

      return !shouldHideChat({ characterTags, conciergeState: chat.conciergeState })
    })
  }, [chats, shouldHideChat])


  // Set up intersection observer for infinite scroll
  const setupObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }
  }, [hasMore, loadingMore, onLoadMore])

  useEffect(() => {
    setupObserver()
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [setupObserver])

  if (loading) {
    return (
      <div className="mt-8">
        <h2 className="qt-heading-3 text-foreground mb-4">Chats</h2>
        <div className="flex items-center justify-center py-12 qt-text-secondary">
          <p>Loading chats...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="qt-heading-3 text-foreground">
          Chats
          {total > 0 && (
            <span className="ml-2 text-base font-normal qt-text-secondary">({visibleChats.length})</span>
          )}
        </h2>
        <Link
          href={`/salon/new?projectId=${projectId}`}
          className="qt-button qt-button-primary"
        >
          New Chat
        </Link>
      </div>

      {/* Empty state */}
      {visibleChats.length === 0 ? (
        <div className="rounded-2xl qt-border border-dashed qt-bg-card px-8 py-12 text-center qt-shadow-sm">
          <p className="mb-4 text-lg qt-text-secondary">
            {chats.length === 0 ? 'No chats in this project yet.' : 'No visible chats (some may be hidden).'}
          </p>
          <Link
            href={`/salon/new?projectId=${projectId}`}
            className="font-medium qt-text-primary hover:opacity-80"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <>
          {/* Chat cards - 2 columns when full-width is on, otherwise 1 */}
          <div className={`grid gap-4 ${isWide ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
            {visibleChats.map((chat) => (
              <ChatCard
                key={chat.id}
                chat={transformProjectChatToCardData(chat)}
                showAvatars={true}
                showProject={false}
                actionType="remove"
                onRemove={onRemoveChat}
              />
            ))}
          </div>

          {/* Load more indicator / trigger */}
          <div
            ref={loadMoreRef}
            className="py-8 flex items-center justify-center"
          >
            {loadingMore ? (
              <p className="qt-text-secondary">Loading more chats...</p>
            ) : hasMore ? (
              <button
                onClick={onLoadMore}
                className="qt-button qt-button-ghost"
              >
                Load more
              </button>
            ) : visibleChats.length > 0 ? (
              <p className="qt-text-xs qt-text-secondary">All chats loaded</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
