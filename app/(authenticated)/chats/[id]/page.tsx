'use client'

import { use, useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { TagEditor } from '@/components/tags/tag-editor'
import ImageModal from '@/components/chat/ImageModal'
import ChatPhotoGalleryModal from '@/components/chat/ChatPhotoGalleryModal'
import { showAlert } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { safeJsonParse } from '@/lib/fetch-helpers'
import MessageContent from '@/components/chat/MessageContent'
import { formatMessageTime } from '@/lib/format-time'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'

interface MessageAttachment {
  id: string
  filename: string
  filepath: string
  mimeType: string
}

interface Message {
  id: string
  role: string
  content: string
  createdAt: string
  swipeGroupId?: string | null
  swipeIndex?: number | null
  attachments?: MessageAttachment[]
}

interface Chat {
  id: string
  title: string
  character: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
    personas: Array<{
      persona: {
        id: string
        name: string
        title?: string | null
        avatarUrl?: string | null
        defaultImage?: {
          id: string
          filepath: string
          url?: string
        } | null
      }
    }>
  }
  persona?: {
    id: string
    name: string
    title?: string
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
  } | null
  user: {
    id: string
    name?: string | null
    image?: string | null
  }
  messages: Message[]
}

interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
  createdAt: string
  updatedAt: string
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { style } = useAvatarDisplay()
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
  const [viewSourceMessageIds, setViewSourceMessageIds] = useState<Set<string>>(new Set())
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<Array<{ id: string; filename: string; filepath: string; mimeType: string; url: string }>>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [modalImage, setModalImage] = useState<{ src: string; filename: string; fileId?: string } | null>(null)
  const [chatPhotoCount, setChatPhotoCount] = useState(0)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getCharacterAvatarSrc = (character: Chat['character']) => {
    if (character.defaultImage) {
      return character.defaultImage.url || `/${character.defaultImage.filepath}`
    }
    return character.avatarUrl
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchChatSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setChatSettings(data)
    } catch (err) {
      console.error('Failed to fetch chat settings:', err)
      // Use default settings if fetch fails
      setChatSettings({ id: '', userId: '', avatarDisplayMode: 'ALWAYS', createdAt: '', updatedAt: '' })
    }
  }, [])

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

  const fetchChatPhotoCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${id}/files`)
      if (res.ok) {
        const data = await res.json()
        const imageCount = (data.files || []).filter((f: { mimeType: string }) => f.mimeType.startsWith('image/')).length
        setChatPhotoCount(imageCount)
      }
    } catch (err) {
      console.error('Failed to fetch chat photo count:', err)
    }
  }, [id])

  useEffect(() => {
    fetchChat()
    fetchChatSettings()
    fetchChatPhotoCount()
  }, [fetchChat, fetchChatSettings, fetchChatPhotoCount])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent])

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/chats/${id}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await safeJsonParse<{ file?: { id: string; filepath: string; mimeType: string; url: string }; error?: string }>(res)

      if (!res.ok || !data.file) {
        throw new Error(data.error || 'Failed to upload file')
      }
      const uploadedFile = data.file
      setAttachedFiles((prev) => [...prev, {
        id: uploadedFile.id,
        filename: file.name,
        filepath: uploadedFile.filepath,
        mimeType: uploadedFile.mimeType,
        url: uploadedFile.url,
      }])
      showSuccessToast('File attached')
    } catch (err) {
      console.error('Error uploading file:', err)
      showErrorToast(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setUploadingFile(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Remove attached file
  const removeAttachedFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && attachedFiles.length === 0) || sending) return

    const userMessage = input.trim()
    const fileIds = attachedFiles.map((f) => f.id)
    // Capture attachments before clearing state
    const messageAttachments: MessageAttachment[] = attachedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      filepath: f.filepath,
      mimeType: f.mimeType,
    }))
    setInput('')
    setAttachedFiles([])
    setSending(true)
    setStreaming(true)
    setStreamingContent('')

    // Build display content with file indicators
    const displayContent = messageAttachments.length > 0
      ? `${userMessage}${userMessage ? '\n' : ''}[Attached: ${messageAttachments.map(f => f.filename).join(', ')}]`
      : userMessage

    // Add user message to UI
    const tempUserMessageId = `temp-user-${Date.now()}`
    const tempUserMessage: Message = {
      id: tempUserMessageId,
      role: 'USER',
      content: displayContent,
      createdAt: new Date().toISOString(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMessage || 'Please look at the attached file(s).', fileIds }),
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
      showErrorToast(err instanceof Error ? err.message : 'Failed to send message')
      // Remove the temporary user message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessageId))
      setStreamingContent('')
      setStreaming(false)
    } finally {
      setSending(false)
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
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
      showErrorToast(err instanceof Error ? err.message : 'Failed to update message')
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
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete message')
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
      showErrorToast(err instanceof Error ? err.message : 'Failed to generate alternative response')
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

  const copyMessageContent = (content: string) => {
    navigator.clipboard.writeText(content)
    showSuccessToast('Message copied to clipboard!')
  }

  const toggleSourceView = (messageId: string) => {
    setViewSourceMessageIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  const shouldShowAvatars = () => {
    if (!chatSettings) return true // Default to showing avatars
    return chatSettings.avatarDisplayMode === 'ALWAYS'
  }

  const getMessageAvatar = (message: Message) => {
    if (message.role === 'USER') {
      // Fallback priority:
      // 1. Chat's assigned persona (if explicitly set for this chat)
      // 2. Character's default persona (if it has one)
      // 3. User's avatar (fallback)

      if (chat?.persona) {
        return {
          name: chat.persona.name,
          title: chat.persona.title,
          avatarUrl: chat.persona.avatarUrl,
          defaultImage: chat.persona.defaultImage,
        }
      } else if (chat?.character.personas && chat.character.personas.length > 0) {
        const defaultPersona = chat.character.personas[0].persona
        return {
          name: defaultPersona.name,
          title: defaultPersona.title,
          avatarUrl: defaultPersona.avatarUrl,
          defaultImage: defaultPersona.defaultImage,
        }
      } else if (chat?.user) {
        return {
          name: chat.user.name || 'User',
          title: null,
          avatarUrl: chat.user.image,
          defaultImage: null,
        }
      }
    } else if (message.role === 'ASSISTANT' && chat?.character) {
      return {
        name: chat.character.name,
        title: chat.character.title,
        avatarUrl: chat.character.avatarUrl,
        defaultImage: chat.character.defaultImage,
      }
    }
    return null
  }

  const getAvatarSrc = (avatar: ReturnType<typeof getMessageAvatar>) => {
    if (!avatar) return null
    if (avatar.defaultImage) {
      return avatar.defaultImage.url || `/${avatar.defaultImage.filepath}`
    }
    return avatar.avatarUrl || null
  }

  // Strip [Attached: ...] from message content for display
  const getDisplayContent = (content: string) => {
    return content.replace(/\n?\[Attached: [^\]]+\]$/, '').trim()
  }

  // Get image attachments from a message
  const getImageAttachments = (message: Message) => {
    return (message.attachments || []).filter(a => a.mimeType.startsWith('image/'))
  }

  const renderAvatar = (avatar: ReturnType<typeof getMessageAvatar>) => {
    if (!avatar) return null

    const avatarSrc = getAvatarSrc(avatar)
    // 4:5 ratio: width 100px = height 125px, max height 200px = width 160px
    // Using width 120px and height 150px as a good balance
    const avatarWidth = 120
    const avatarHeight = 150

    return (
      <div className="flex flex-col items-center flex-shrink-0 w-32 gap-1">
        <div
          className="bg-gray-300 dark:bg-slate-700 flex items-center justify-center overflow-hidden"
          style={{
            width: `${avatarWidth}px`,
            height: `${avatarHeight}px`,
          }}
        >
          {avatarSrc ? (
            <Image
              src={avatarSrc}
              alt={avatar.name}
              width={avatarWidth}
              height={avatarHeight}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-4xl font-bold text-gray-600 dark:text-gray-400">
              {avatar.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-2">
            {avatar.name}
          </div>
          {avatar.title && (
            <div className="text-xs italic text-gray-600 dark:text-gray-400 line-clamp-2">
              {avatar.title}
            </div>
          )}
        </div>
      </div>
    )
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
        <div className="mx-auto max-w-[800px]">
          <div className="flex justify-between items-start mb-2">
            <Link
              href="/chats"
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
          <div className="flex items-center gap-3">
            {getCharacterAvatarSrc(chat.character) ? (
              <Image
                src={getCharacterAvatarSrc(chat.character)!}
                alt={chat.character.name}
                width={40}
                height={40}
                className="w-10 h-10 rounded-full mr-3 object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-slate-700 mr-3 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-bold text-gray-600 dark:text-gray-400">
                  {chat.character.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{chat.title}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {chat.character.title ? `${chat.character.name} - ${chat.character.title}` : chat.character.name}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <div className="mx-auto max-w-[800px] px-4 py-3">
          <TagEditor entityType="chat" entityId={id} />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-slate-900">
        <div className="mx-auto max-w-[800px] p-4 space-y-4">
        {messages.map((message) => {
          const isEditing = editingMessageId === message.id
          const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null

          const messageAvatar = shouldShowAvatars() ? getMessageAvatar(message) : null

          return (
            <div
              key={message.id}
              className={`flex gap-4 w-[90%] ${
                message.role === 'USER' ? 'justify-end ml-auto' : 'justify-start'
              }`}
            >
              {message.role === 'ASSISTANT' && shouldShowAvatars() && (
                <div className="flex-shrink-0">
                  {renderAvatar(messageAvatar)}
                </div>
              )}
              <div className="flex-1 min-w-0 group relative">
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
                    <>
                      {viewSourceMessageIds.has(message.id) ? (
                        <div className="bg-gray-100 dark:bg-gray-900 p-3 rounded font-mono text-sm whitespace-pre-wrap break-words overflow-auto max-h-96">
                          {message.content}
                        </div>
                      ) : (
                        <MessageContent content={getDisplayContent(message.content)} />
                      )}
                      {/* Image attachment thumbnails */}
                      {getImageAttachments(message).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {getImageAttachments(message).map((attachment) => (
                            <button
                              key={attachment.id}
                              onClick={() => setModalImage({
                                src: `/${attachment.filepath}`,
                                filename: attachment.filename,
                                fileId: attachment.id,
                              })}
                              className="relative group/thumb overflow-hidden rounded border border-gray-300 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                            >
                              <Image
                                src={`/${attachment.filepath}`}
                                alt={attachment.filename}
                                width={80}
                                height={80}
                                className="w-20 h-20 object-cover"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
                                <svg className="w-6 h-6 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                </svg>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        {formatMessageTime(message.createdAt)}
                      </div>
                    </>
                  )}
                </div>

                {/* Hover action buttons */}
                {!isEditing && (
                  <div className="absolute -top-8 right-0 flex gap-1 bg-gray-200 dark:bg-slate-700 rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyMessageContent(message.content)}
                      className="p-1 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                      title="Copy message"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => toggleSourceView(message.id)}
                      className="p-1 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                      title={viewSourceMessageIds.has(message.id) ? 'View rendered' : 'View source'}
                    >
                      {viewSourceMessageIds.has(message.id) ? '👁️' : '</>'}
                    </button>
                  </div>
                )}

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
              {message.role === 'USER' && shouldShowAvatars() && (
                <div className="flex-shrink-0">
                  {renderAvatar(messageAvatar)}
                </div>
              )}
            </div>
          )
        })}

        {/* Streaming message */}
        {streaming && streamingContent && (
          <div className="flex gap-4 w-[90%] justify-start">
            {shouldShowAvatars() && (
              <div className="flex-shrink-0">
                {renderAvatar({
                  name: chat?.character.name || 'AI',
                  title: null,
                  avatarUrl: chat?.character.avatarUrl,
                  defaultImage: chat?.character.defaultImage,
                })}
              </div>
            )}
            <div className="flex-1 min-w-0 px-4 py-3 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white">
              <MessageContent content={streamingContent} />
              <span className="inline-block w-2 h-4 bg-gray-400 dark:bg-gray-500 animate-pulse ml-1"></span>
            </div>
          </div>
        )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
        <div className="mx-auto max-w-[800px] p-4">
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-slate-700 rounded-lg text-sm"
                >
                  {file.mimeType.startsWith('image/') ? (
                    <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  <span className="text-gray-700 dark:text-gray-300 max-w-[150px] truncate">
                    {file.filename}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(file.id)}
                    className="text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={sendMessage} className="flex gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
              className="hidden"
            />
            {/* Attach file button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || uploadingFile}
              className="px-3 py-3 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Attach file"
            >
              {uploadingFile ? (
                <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              )}
            </button>
            {/* Photo gallery button - only shown if there are photos */}
            {chatPhotoCount > 0 && (
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                className="px-3 py-3 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700"
                title={`View chat photos (${chatPhotoCount})`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            )}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder={attachedFiles.length > 0 ? "Add a message (optional)..." : "Type a message..."}
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-gray-100 dark:disabled:bg-slate-700"
            />
            <button
              type="submit"
              disabled={sending || (!input.trim() && attachedFiles.length === 0)}
              className="px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </div>

      {/* Image Modal */}
      <ImageModal
        isOpen={modalImage !== null}
        onClose={() => setModalImage(null)}
        src={modalImage?.src || ''}
        filename={modalImage?.filename || ''}
        fileId={modalImage?.fileId}
        characterId={chat?.character.id}
        characterName={chat?.character.name}
        personaId={chat?.persona?.id || chat?.character.personas?.[0]?.persona.id}
        personaName={chat?.persona?.name || chat?.character.personas?.[0]?.persona.name}
        onDelete={() => {
          // Refresh chat to update message attachments
          fetchChat()
        }}
      />

      {/* Chat Photo Gallery Modal */}
      <ChatPhotoGalleryModal
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        chatId={id}
        characterId={chat?.character.id}
        characterName={chat?.character.name}
        personaId={chat?.persona?.id || chat?.character.personas?.[0]?.persona.id}
        personaName={chat?.persona?.name || chat?.character.personas?.[0]?.persona.name}
        onImageDeleted={(fileId) => {
          // Update messages to show deleted indicator for this file
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.attachments?.some((a) => a.id === fileId)) {
                // Remove the attachment and add deleted indicator to content
                const newAttachments = msg.attachments.filter((a) => a.id !== fileId)
                const newContent = msg.content.includes('[attached photo deleted]')
                  ? msg.content
                  : `${msg.content} [attached photo deleted]`
                return { ...msg, attachments: newAttachments, content: newContent }
              }
              return msg
            })
          )
          // Refresh photo count
          fetchChatPhotoCount()
        }}
      />
    </div>
  )
}
