'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Chat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  character: {
    id: string
    name: string
    avatarUrl?: string
  }
  _count: {
    messages: number
  }
}

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchChats()
  }, [])

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats')
      if (!res.ok) throw new Error('Failed to fetch chats')
      const data = await res.json()
      setChats(data.chats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const deleteChat = async (id: string) => {
    if (!confirm('Are you sure you want to delete this chat?')) return

    try {
      const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter((c) => c.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete chat')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-900 dark:text-white">Loading chats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600 dark:text-red-400">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Chats</h1>
        <Link
          href="/dashboard/characters"
          className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800"
        >
          New Chat
        </Link>
      </div>

      {chats.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">No chats yet</p>
          <Link
            href="/dashboard/characters"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Start a chat with a character
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 bg-white dark:bg-slate-800 hover:shadow-lg dark:hover:shadow-xl transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  {chat.character.avatarUrl ? (
                    <img
                      src={chat.character.avatarUrl}
                      alt={chat.character.name}
                      className="w-12 h-12 rounded-full mr-4"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-slate-700 mr-4 flex items-center justify-center">
                      <span className="text-xl font-bold text-gray-600 dark:text-gray-400">
                        {chat.character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{chat.title}</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {chat.character.name} • {chat._count.messages} message
                      {chat._count.messages !== 1 ? 's' : ''} • Last updated:{' '}
                      {new Date(chat.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/chats/${chat.id}`}
                    className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => deleteChat(chat.id)}
                    className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded hover:bg-red-700 dark:hover:bg-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
