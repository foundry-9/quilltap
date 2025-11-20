'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAt: string
}

interface Persona {
  id: string
  name: string
  title: string | null
}

interface Chat {
  id: string
  title: string
  updatedAt: string
  character: {
    id: string
    name: string
  }
  persona: Persona | null
  messages: Message[]
}

interface RecentConversationsProps {
  characterId: string
}

export function RecentCharacterConversations({ characterId }: RecentConversationsProps) {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchChats = async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}/chats`)
        if (!res.ok) throw new Error('Failed to fetch chats')
        const data = await res.json()
        setChats(data.chats)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchChats()
  }, [characterId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-600 dark:text-gray-400">Loading conversations...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-red-600 dark:text-red-400">Error: {error}</p>
      </div>
    )
  }

  if (chats.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-600 dark:text-gray-400">No conversations yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
      {chats.map((chat) => {
        // Sort messages by date to get the most recent ones last
        const sortedMessages = [...chat.messages].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )

        return (
          <Link key={chat.id} href={`/chats/${chat.id}`}>
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-md transition-all cursor-pointer">
              {/* Header: Title and date */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <h4 className="font-semibold text-gray-900 dark:text-white truncate flex-grow">
                  {chat.title}
                </h4>
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap flex-shrink-0">
                  {new Date(chat.updatedAt).toLocaleDateString()}
                </span>
              </div>

              {/* Persona info if available */}
              {chat.persona && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  as {chat.persona.name}
                  {chat.persona.title && ` - ${chat.persona.title}`}
                </p>
              )}

              {/* Message preview */}
              <div className="space-y-2 max-h-24 overflow-hidden">
                {sortedMessages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`text-sm rounded px-3 py-1.5 ${
                      message.role === 'ASSISTANT'
                        ? 'bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white mr-auto max-w-xs'
                        : 'bg-blue-100 dark:bg-blue-900 text-gray-900 dark:text-white ml-auto max-w-xs'
                    }`}
                  >
                    <p className="line-clamp-2 break-words">{message.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
