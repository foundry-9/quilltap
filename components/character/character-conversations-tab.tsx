'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAt: string
}

interface Chat {
  id: string
  title: string | null
  updatedAt: string
  character?: {
    id: string
    name: string
  }
  persona?: {
    id: string
    name: string
    title?: string | null
  } | null
  messages: Message[]
  _count?: {
    messages: number
  }
}

interface CharacterConversationsTabProps {
  characterId: string
  characterName: string
}

const CHATS_PER_PAGE = 10

export function CharacterConversationsTab({ characterId, characterName }: CharacterConversationsTabProps) {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null)

  const fetchChats = useCallback(async (pageNum: number, search: string, append: boolean = false) => {
    if (pageNum === 0) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const url = new URL(`/api/characters/${characterId}/chats`, window.location.origin)
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
      setLoading(false)
      setLoadingMore(false)
    }
  }, [characterId])

  // Initial load
  useEffect(() => {
    setPage(0)
    fetchChats(0, searchQuery, false)
  }, [fetchChats, searchQuery])

  // Set up infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
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
  }, [hasMore, loading, loadingMore, page, searchQuery, fetchChats])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setPage(0)
  }

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const confirmed = confirm('Are you sure you want to delete this chat?')
    if (!confirmed) return

    setDeletingChatId(chatId)
    try {
      const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter(c => c.id !== chatId))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete chat')
    } finally {
      setDeletingChatId(null)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
    }
  }

  const getPreviewText = (messages: Message[]) => {
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage) return 'No messages yet'
    const content = lastMessage.content.replace(/\n/g, ' ').trim()
    return content.length > 100 ? content.slice(0, 100) + '...' : content
  }

  if (loading && chats.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
          Loading conversations...
        </div>
      </div>
    )
  }

  if (error && chats.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={() => fetchChats(0, searchQuery, false)}
          className="mt-4 text-blue-600 dark:text-blue-400 hover:underline"
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
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <Link
          href={`/characters/${characterId}/view?action=chat`}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 dark:bg-green-700 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-800 font-medium text-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </Link>
      </div>

      {/* Conversations List */}
      {chats.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {searchQuery
              ? `No conversations found matching "${searchQuery}"`
              : `No conversations with ${characterName} yet`
            }
          </p>
          {!searchQuery && (
            <Link
              href={`/characters/${characterId}/view?action=chat`}
              className="mt-4 inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline"
            >
              Start your first conversation
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className="flex items-start justify-between gap-4 p-4 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 hover:shadow-sm transition-all"
            >
              <Link
                href={`/chats/${chat.id}`}
                className="flex-1 min-w-0 block"
              >
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-gray-900 dark:text-white truncate">
                    {chat.title || `Chat with ${characterName}`}
                  </h3>
                  <span className="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-sm font-semibold px-3 py-1 rounded-full flex-shrink-0">
                    {chat._count?.messages ?? chat.messages.length}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {chat.persona && (
                    <>
                      as {chat.persona.title ? `${chat.persona.name} (${chat.persona.title})` : chat.persona.name}
                      {' \u2022 '}
                    </>
                  )}
                  {formatDate(chat.updatedAt)}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1 mt-2">
                  {getPreviewText(chat.messages)}
                </p>
              </Link>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <Link
                  href={`/chats/${chat.id}`}
                  className="w-10 h-10 flex items-center justify-center bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
                  title="Open chat"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
                    <path d="M6 11l2 2 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <button
                  onClick={(e) => deleteChat(chat.id, e)}
                  disabled={deletingChatId === chat.id}
                  className="w-10 h-10 flex items-center justify-center bg-red-600 dark:bg-red-700 text-white rounded hover:bg-red-700 dark:hover:bg-red-800 disabled:opacity-50 transition-colors"
                  title="Delete chat"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          {/* Load more trigger */}
          <div ref={loadMoreRef} className="py-4">
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-r-transparent"></div>
                Loading more...
              </div>
            )}
            {!hasMore && chats.length > 0 && (
              <p className="text-center text-sm text-gray-400 dark:text-gray-500">
                No more conversations
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
