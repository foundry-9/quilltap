'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ChatCard } from '@/components/chat/ChatCard'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { useRealtimeConnected, useRealtimeTopic } from '@/hooks/useRealtime'
import {
  confirmAndDeleteChat,
  transformCharacterChatToCardData,
  type CharacterChatShape,
} from '@/lib/chat-utils'

type Chat = CharacterChatShape & {
  character?: {
    id: string
    name: string
  }
}

interface CharacterConversationsTabProps {
  characterId: string
  characterName: string
  /** Optional key to trigger data refresh when changed */
  refreshKey?: number
}

const CHATS_PER_PAGE = 10
/** Fallback re-read cadence for a Scriptorium watch, while the socket is down. */
const SCRIPTORIUM_POLL_INTERVAL_MS = 5000
/**
 * How long a watch waits before giving up. A render that never reaches
 * `embedded` (a failed job, an embedding provider that isn't answering) used to
 * leave the single-chat watch re-reading forever.
 */
const SCRIPTORIUM_WATCH_TIMEOUT_MS = 5 * 60_000
/** The archive re-render watch covers a fan-out, so it just runs for a minute. */
const SCRIPTORIUM_ARCHIVE_WATCH_MS = 60_000

export function CharacterConversationsTab({ characterId, characterName, refreshKey }: CharacterConversationsTabProps) {
  const [chats, setChats] = useState<Chat[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshingArchive, setRefreshingArchive] = useState(false)
  const { shouldHideByIds, hideDangerousChats } = useQuickHide()
  const visibleChats = useMemo(
    () => chats.filter(chat => {
      if (hideDangerousChats && chat.isDangerousChat) return false
      return !shouldHideByIds((chat.tags || []).map(ct => ct.tag.id))
    }),
    [chats, shouldHideByIds, hideDangerousChats]
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const fetchChats = useCallback(async (pageNum: number, search: string, append: boolean = false) => {
    if (pageNum === 0) {
      setIsLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const url = new URL(`/api/v1/characters/${characterId}`, window.location.origin)
      url.searchParams.set('action', 'chats')
      url.searchParams.set('limit', String(CHATS_PER_PAGE))
      url.searchParams.set('offset', String(pageNum * CHATS_PER_PAGE))
      if (search) {
        url.searchParams.set('search', search)
      }

      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to fetch conversations')

      const data = await res.json()
      const newChats = data.chats || data || []

      if (append) {
        setChats(prev => [...prev, ...newChats])
      } else {
        setChats(newChats)
      }

      setHasMore(newChats.length === CHATS_PER_PAGE)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
    } finally {
      setIsLoading(false)
      setLoadingMore(false)
    }
  }, [characterId])

  // Initial load and refresh when refreshKey changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- page resets to 0 whenever the paginated query key changes
    setPage(0)
    fetchChats(0, searchQuery, false)
  }, [fetchChats, searchQuery, refreshKey])

  // Set up infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading && !loadingMore) {
          const nextPage = page + 1
          setPage(nextPage)
          fetchChats(nextPage, searchQuery, true)
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, isLoading, loadingMore, page, searchQuery, fetchChats])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setPage(0)
  }

  const deleteChat = async (chatId: string) => {
    if (await confirmAndDeleteChat(chatId)) {
      setChats(chats.filter(c => c.id !== chatId))
    }
  }

  const handleReextractMemories = async (chatId: string) => {
    const confirmed = await showConfirmation(
      'This will delete all existing memories from this chat and re-extract them from the conversation. Are you sure?'
    )
    if (!confirmed) return

    try {
      // Delete existing memories for this chat
      await fetch(`/api/v1/memories?chatId=${chatId}`, { method: 'DELETE' })

      // Queue new memory extraction
      const res = await fetch(`/api/v1/chats/${chatId}?action=queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          characterName,
        }),
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast(`Queued ${data.jobCount} memory extraction jobs`)
        notifyQueueChange()
      } else {
        showErrorToast(data.error || 'Failed to queue memory extraction')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to re-extract memories')
    }
  }

  // Scriptorium status watch: re-read the chat list while a render/embed is in
  // progress, so the badge walks red → amber → green.
  //
  // The live signal is the `jobs` topic — CONVERSATION_RENDER and the embedding
  // jobs behind it all move it, and the hint arrives when the write actually
  // commits. The interval below is the fallback for a dropped socket. A watch
  // is declarative state rather than a stashed interval handle so both paths,
  // and the timeout, read it the same way.
  const [scriptoriumWatch, setScriptoriumWatch] = useState<
    { targetChatId: string | null; expiresAt: number } | null
  >(null)

  const refreshScriptoriumStatus = useCallback(async () => {
    await fetchChats(0, searchQuery, false)
  }, [fetchChats, searchQuery])

  // A single-chat watch is satisfied the moment its chat reads `embedded`.
  // Derived rather than stored: the answer is already on screen in `chats`, and
  // copying it into state would just be a second thing to keep in step. The
  // timeout below is what eventually clears the stored watch.
  const activeScriptoriumWatch = useMemo(() => {
    if (!scriptoriumWatch) return null
    if (!scriptoriumWatch.targetChatId) return scriptoriumWatch
    const target = chats.find(c => c.id === scriptoriumWatch.targetChatId)
    return target?.scriptoriumStatus === 'embedded' ? null : scriptoriumWatch
  }, [scriptoriumWatch, chats])

  useRealtimeTopic('jobs', () => {
    if (activeScriptoriumWatch) void refreshScriptoriumStatus()
  })

  const realtimeConnected = useRealtimeConnected()
  useEffect(() => {
    if (!activeScriptoriumWatch || realtimeConnected) return
    const interval = setInterval(() => {
      void refreshScriptoriumStatus()
    }, SCRIPTORIUM_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [activeScriptoriumWatch, realtimeConnected, refreshScriptoriumStatus])

  useEffect(() => {
    if (!scriptoriumWatch) return
    const timer = setTimeout(
      () => setScriptoriumWatch(null),
      Math.max(0, scriptoriumWatch.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [scriptoriumWatch])

  const handleRenderConversation = async (chatId: string) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=render-conversation`, {
        method: 'POST',
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast('Conversation rendering queued')
        notifyQueueChange()
        // Refresh immediately
        setPage(0)
        fetchChats(0, searchQuery, false)

        // Watch this chat's status until it reaches 'embedded'.
        setScriptoriumWatch({
          targetChatId: chatId,
          expiresAt: Date.now() + SCRIPTORIUM_WATCH_TIMEOUT_MS,
        })
      } else {
        showErrorToast(data.error || 'Failed to queue conversation rendering')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to render conversation')
    }
  }

  const handleRefreshArchive = async () => {
    setRefreshingArchive(true)
    try {
      const res = await fetch(`/api/v1/characters/${characterId}?action=refresh-archive`, {
        method: 'POST',
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast(`Queued re-render for ${data.queued} of ${data.total} conversations`)
        notifyQueueChange()
        // Watch the fan-out for a minute; there's no single chat to wait on.
        setScriptoriumWatch({
          targetChatId: null,
          expiresAt: Date.now() + SCRIPTORIUM_ARCHIVE_WATCH_MS,
        })
      } else {
        showErrorToast(data.error || 'Failed to refresh conversation archive')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to refresh conversation archive')
    } finally {
      setRefreshingArchive(false)
    }
  }

  if (isLoading && chats.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 qt-text-secondary">
          <div className="h-5 w-5 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
          Loading conversations...
        </div>
      </div>
    )
  }

  if (error && chats.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="qt-text-destructive">{error}</p>
        <button
          onClick={() => fetchChats(0, searchQuery, false)}
          className="mt-4 text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search Header */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={handleSearch}
            className="qt-input pl-10"
          />
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary" />
        </div>
        <button
          onClick={handleRefreshArchive}
          disabled={refreshingArchive || chats.length === 0}
          title="Re-render and re-embed all conversations for this character"
          className="qt-button-ghost text-xs whitespace-nowrap"
        >
          <Icon name="refresh" className={`w-3.5 h-3.5 ${refreshingArchive ? 'animate-spin' : ''}`} />
          {refreshingArchive ? 'Refreshing...' : 'Refresh Conversation Archive'}
        </button>
        <Link
          href={`/aurora/${characterId}/view?action=chat`}
          className="flex items-center gap-2 px-4 py-2 qt-button-primary font-medium text-sm whitespace-nowrap"
        >
          <Icon name="plus" className="w-4 h-4" />
          New Chat
        </Link>
      </div>

      {/* Conversations List */}
      {visibleChats.length === 0 ? (
        <div className="text-center py-12 border border-dashed qt-border-default rounded-lg">
          <Icon name="chat" className="mx-auto h-12 w-12 qt-text-secondary" />
          <p className="mt-2 qt-text-small">
            {searchQuery
              ? `No conversations found matching "${searchQuery}"`
              : `No conversations with ${characterName} yet`
            }
          </p>
          {!searchQuery && (
            <Link
              href={`/aurora/${characterId}/view?action=chat`}
              className="mt-4 inline-flex items-center gap-2 text-primary hover:underline"
            >
              Start your first conversation
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={transformCharacterChatToCardData(chat)}
              showAvatars={false}
              showProject={true}
              showPreview={true}
              useRelativeDates={true}
              actionType="delete"
              onDelete={deleteChat}
              onReextractMemories={handleReextractMemories}
              onRenderConversation={handleRenderConversation}
              characterName={characterName}
            />
          ))}

          {/* Load more trigger */}
          <div ref={loadMoreRef} className="py-4">
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 qt-text-secondary">
                <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
                Loading more...
              </div>
            )}
            {!hasMore && visibleChats.length > 0 && (
              <p className="text-center qt-text-small">
                No more conversations
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
