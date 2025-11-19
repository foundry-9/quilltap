'use client'

import { use, useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'

interface Message {
  id: string
  role: string
  content: string
  createdAt: string
  swipeGroupId?: string | null
  swipeIndex?: number | null
}

interface Chat {
  id: string
  title: string
  character: {
    id: string
    name: string
    avatarUrl?: string
  }
  messages: Message[]
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [swipeStates, setSwipeStates] = useState<Record<string, { current: number; total: number; messages: Message[] }>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${id}`)
      if (!res.ok) throw new Error('Failed to fetch chat')
      const data = await res.json()
      setChat(data.chat)

      const allMessages = data.chat.messages.filter((m: Message) => m.role !== 'SYSTEM')

      // Organize swipe groups
      const swipeGroups: Record<string, Message[]> = {}
      const displayMessages: Message[] = []
      const newSwipeStates: Record<string, { current: number; total: number; messages: Message[] }> = {}

      allMessages.forEach((msg: Message) => {
        if (msg.swipeGroupId) {
          if (!swipeGroups[msg.swipeGroupId]) {
            swipeGroups[msg.swipeGroupId] = []
          }
          swipeGroups[msg.swipeGroupId].push(msg)
        } else {
          displayMessages.push(msg)
        }
      })

      // For each swipe group, show only the current swipe (index 0 by default)
      Object.entries(swipeGroups).forEach(([groupId, groupMessages]) => {
        const sorted = groupMessages.sort((a, b) => (a.swipeIndex || 0) - (b.swipeIndex || 0))
        displayMessages.push(sorted[0])
        newSwipeStates[groupId] = {
          current: 0,
          total: sorted.length,
          messages: sorted
        }
      })

      // Sort by creation time
      displayMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      setMessages(displayMessages)
      setSwipeStates(newSwipeStates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchChat()
  }, [fetchChat])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || sending) return

    const userMessage = input.trim()
    setInput('')
    setSending(true)
    setStreaming(true)
    setStreamingContent('')

    // Add user message to UI
    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: userMessage,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMessage }),
      })

      if (!res.ok) {
        throw new Error('Failed to send message')
      }

      // Handle streaming response
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No response body')

      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.content) {
                fullContent += data.content
                setStreamingContent(fullContent)
              }

              if (data.done) {
                // Add assistant message to messages list
                const assistantMessage: Message = {
                  id: data.messageId,
                  role: 'ASSISTANT',
                  content: fullContent,
                  createdAt: new Date().toISOString(),
                }
                setMessages((prev) => [...prev, assistantMessage])
                setStreamingContent('')
                setStreaming(false)
              }

              if (data.error) {
                throw new Error(data.error)
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError)
            }
          }
        }
      }
    } catch (err) {
      console.error('Error sending message:', err)
      alert(err instanceof Error ? err.message : 'Failed to send message')
      // Remove the temporary user message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessageId))
      setStreamingContent('')
      setStreaming(false)
    } finally {
      setSending(false)
    }
  }

  const startEdit = (message: Message) => {
    setEditingMessageId(message.id)
    setEditContent(message.content)
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditContent('')
  }

  const saveEdit = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })

      if (!res.ok) throw new Error('Failed to update message')

      const updated = await res.json()
      setMessages(messages.map(m => m.id === messageId ? { ...m, content: updated.content } : m))
      setEditingMessageId(null)
      setEditContent('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update message')
    }
  }

  const deleteMessage = async (messageId: string) => {
    if (!confirm('Are you sure you want to delete this message?')) return

    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to delete message')

      // Remove message from display
      setMessages(messages.filter(m => m.id !== messageId))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete message')
    }
  }

  const generateSwipe = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/swipe`, {
        method: 'POST',
      })

      if (!res.ok) throw new Error('Failed to generate alternative response')

      const newSwipe = await res.json()

      // Refresh chat to get updated swipe groups
      await fetchChat()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate alternative response')
    }
  }

  const switchSwipe = (groupId: string, direction: 'prev' | 'next') => {
    const state = swipeStates[groupId]
    if (!state) return

    const newIndex = direction === 'next'
      ? Math.min(state.current + 1, state.total - 1)
      : Math.max(state.current - 1, 0)

    if (newIndex === state.current) return

    const newMessage = state.messages[newIndex]
    setMessages(messages.map(m =>
      m.swipeGroupId === groupId ? newMessage : m
    ))
    setSwipeStates({
      ...swipeStates,
      [groupId]: { ...state, current: newIndex }
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading chat...</p>
      </div>
    )
  }

  if (error || !chat) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600">Error: {error || 'Chat not found'}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 p-4">
        <div className="flex justify-between items-start mb-2">
          <Link
            href="/dashboard/chats"
            className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
          >
            ← Back to Chats
          </Link>
          <a
            href={`/api/chats/${id}/export`}
            download
            className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 dark:bg-slate-600 dark:hover:bg-slate-500"
          >
            Export Chat
          </a>
        </div>
        <div className="flex items-center">
          {chat.character.avatarUrl ? (
            <Image
              src={chat.character.avatarUrl}
              alt={chat.character.name}
              width={40}
              height={40}
              className="w-10 h-10 rounded-full mr-3"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-slate-700 mr-3 flex items-center justify-center">
              <span className="text-lg font-bold text-gray-600 dark:text-gray-400">
                {chat.character.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{chat.title}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">{chat.character.name}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-900">
        {messages.map((message) => {
          const isEditing = editingMessageId === message.id
          const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null

          return (
            <div
              key={message.id}
              className={`flex ${
                message.role === 'USER' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div className={`max-w-3xl ${message.role === 'USER' ? '' : 'w-full max-w-3xl'}`}>
                <div
                  className={`px-4 py-3 rounded-lg ${
                    message.role === 'USER'
                      ? 'bg-blue-600 dark:bg-blue-700 text-white'
                      : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(message.id)}
                          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>

                {/* Message actions */}
                {!isEditing && (
                  <div className="flex gap-2 mt-1 text-sm">
                    {message.role === 'USER' && (
                      <>
                        <button
                          onClick={() => startEdit(message)}
                          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteMessage(message.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        >
                          Delete
                        </button>
                      </>
                    )}

                    {message.role === 'ASSISTANT' && (
                      <>
                        <button
                          onClick={() => deleteMessage(message.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => generateSwipe(message.id)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                        >
                          🔄 Regenerate
                        </button>

                        {/* Swipe controls */}
                        {swipeState && swipeState.total > 1 && (
                          <div className="flex items-center gap-2 ml-2">
                            <button
                              onClick={() => switchSwipe(message.swipeGroupId!, 'prev')}
                              disabled={swipeState.current === 0}
                              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              ←
                            </button>
                            <span className="text-gray-600 dark:text-gray-400 text-xs">
                              {swipeState.current + 1} / {swipeState.total}
                            </span>
                            <button
                              onClick={() => switchSwipe(message.swipeGroupId!, 'next')}
                              disabled={swipeState.current === swipeState.total - 1}
                              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              →
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Streaming message */}
        {streaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-3xl px-4 py-3 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white">
              <p className="whitespace-pre-wrap">{streamingContent}</p>
              <span className="inline-block w-2 h-4 bg-gray-400 dark:bg-gray-500 animate-pulse ml-1"></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 p-4">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-gray-100 dark:disabled:bg-slate-700"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
