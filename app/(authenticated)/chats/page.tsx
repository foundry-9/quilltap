'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { TagDisplay } from '@/components/tags/tag-display'

interface Chat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  character: {
    id: string
    name: string
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    }
  }
  persona?: {
    id: string
    name: string
    title?: string | null
  } | null
  tags: Array<{
    tag: {
      id: string
      name: string
    }
  }>
  _count: {
    messages: number
  }
}

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([])
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchChats()
    fetchCharacters()
    fetchProfiles()
  }, [])

  // Auto-scroll and highlight imported chat
  useEffect(() => {
    if (highlightedChatId && importedChatRef.current) {
      importedChatRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Clear the highlight after animation completes (2.5 seconds)
      const timer = setTimeout(() => {
        setHighlightedChatId(null)
      }, 2500)

      return () => clearTimeout(timer)
    }
  }, [highlightedChatId])

  const getAvatarSrc = (chat: Chat): string | null => {
    if (chat.character.defaultImage) {
      return chat.character.defaultImage.url || `/${chat.character.defaultImage.filepath}`
    }
    return chat.character.avatarUrl || null
  }

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

  const fetchCharacters = async () => {
    try {
      const res = await fetch('/api/characters')
      if (res.ok) {
        const data = await res.json()
        setCharacters(data.characters.map((c: any) => ({ id: c.id, name: c.name })))
      }
    } catch (err) {
      console.error('Failed to fetch characters:', err)
    }
  }

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(data.map((p: any) => ({ id: p.id, name: p.name })))
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err)
    }
  }

  const deleteChat = async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete chat')
      setChats(chats.filter((c) => c.id !== id))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete chat')
    }
  }

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const files = formData.getAll('files') as File[]
    const characterId = formData.get('characterId') as string
    const profileId = formData.get('profileId') as string

    if (!files || files.length === 0 || !characterId || !profileId) {
      showErrorToast('Please select at least one file, a character, and a profile')
      return
    }

    try {
      const importedChats: Chat[] = []
      let successCount = 0
      let failCount = 0
      const errors: string[] = []

      for (const file of files) {
        try {
          const text = await file.text()
          let chatData

          // Handle both JSON and JSONL formats
          if (file.name.endsWith('.jsonl')) {
            // SillyTavern JSONL format: first line is metadata, rest are messages
            const lines = text.trim().split('\n').filter(line => line.trim())
            if (lines.length === 0) throw new Error('Empty JSONL file')

            let metadata: any = {}
            const messages = []

            for (const line of lines) {
              try {
                const obj = JSON.parse(line)

                // First line with chat_metadata is the metadata
                if (obj.chat_metadata && !metadata.chat_metadata) {
                  metadata = obj
                } else if (obj.mes !== undefined) {
                  // Lines with 'mes' field are messages
                  messages.push(obj)
                }
              } catch {
                // Skip invalid JSON lines
                console.warn('Skipped invalid JSON line:', line.substring(0, 50))
              }
            }

            if (messages.length === 0) {
              throw new Error('No messages found in JSONL file')
            }

            // Wrap in the expected format
            chatData = {
              messages,
              chat_metadata: metadata.chat_metadata,
              character_name: metadata.character_name,
              user_name: metadata.user_name,
              create_date: metadata.create_date,
            }
          } else {
            // Parse regular JSON format
            chatData = JSON.parse(text)
          }

          const res = await fetch('/api/chats/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chatData,
              characterId,
              connectionProfileId: profileId,
            }),
          })

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to import chat')
          }

          const imported = await res.json()
          // API returns the chat directly, not wrapped in a 'chat' property
          const chat = imported.chat || imported
          importedChats.push(chat)
          successCount++
        } catch (err) {
          failCount++
          const errorMessage = err instanceof Error ? err.message : `Failed to import ${file.name}`
          errors.push(`${file.name}: ${errorMessage}`)
          console.error(err)
        }
      }

      // Update chats list with imported chats
      if (importedChats.length > 0) {
        const sortedChats = [...importedChats, ...chats].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        setChats(sortedChats)
        // Highlight the first imported chat
        setHighlightedChatId(importedChats[0].id)
      }

      setImportDialogOpen(false)

      // Show appropriate message
      if (failCount === 0) {
        showSuccessToast(`Successfully imported ${successCount} chat${successCount !== 1 ? 's' : ''}!`)
      } else if (successCount > 0) {
        showErrorToast(`Imported ${successCount} chat${successCount !== 1 ? 's' : ''}, ${failCount} failed.\n${errors.join('\n')}`)
      } else {
        showErrorToast(`Failed to import all chats.\n${errors.join('\n')}`)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to import chats'
      showErrorToast(errorMessage)
      console.error(err)
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
    <div className="container mx-auto px-4 py-8 max-w-[800px]">
      <style>{`
        @keyframes arrowFlash {
          0% {
            opacity: 1;
            transform: translateX(0);
          }
          50% {
            opacity: 1;
            transform: translateX(10px);
          }
          100% {
            opacity: 0;
            transform: translateX(10px);
          }
        }
        .arrow-highlight {
          animation: arrowFlash 2.5s ease-out forwards;
        }
      `}</style>

      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Chats</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="px-4 py-2 bg-gray-600 dark:bg-slate-600 text-white rounded hover:bg-gray-700 dark:hover:bg-slate-500"
          >
            Import
          </button>
          <Link
            href="/characters"
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800"
          >
            New Chat
          </Link>
        </div>
      </div>

      {chats.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">No chats yet</p>
          <Link
            href="/characters"
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
              ref={highlightedChatId === chat.id ? importedChatRef : null}
              className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 bg-white dark:bg-slate-800 hover:shadow-lg dark:hover:shadow-xl transition-shadow relative"
            >
              {highlightedChatId === chat.id && (
                <div className="absolute -right-12 top-1/2 transform -translate-y-1/2 arrow-highlight">
                  <span className="text-6xl text-yellow-200 font-black" style={{ textShadow: '0 0 10px rgba(255, 255, 0, 0.8)' }}>←</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  {getAvatarSrc(chat) ? (
                    <Image
                      src={getAvatarSrc(chat)!}
                      alt={chat.character.name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-full mr-4 object-cover"
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
                      {chat.character.name}
                      {chat.persona && ` (${chat.persona.name}${chat.persona.title ? ` - ${chat.persona.title}` : ''})`}
                      {' •  '}{chat._count.messages} message
                      {chat._count.messages !== 1 ? 's' : ''} • Last updated:{' '}
                      {new Date(chat.updatedAt).toLocaleDateString()}
                    </p>
                    {chat.tags.length > 0 && (
                      <div className="mt-2">
                        <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/chats/${chat.id}`}
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

      {/* Import Dialog */}
      {importDialogOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Import Chats
            </h3>
            <form onSubmit={handleImport}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Select SillyTavern chat JSON files (one or more)
                  </label>
                  <input
                    type="file"
                    name="files"
                    accept=".json,.jsonl"
                    multiple
                    required
                    className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900 file:text-blue-700 dark:file:text-blue-200 hover:file:bg-blue-100 dark:hover:file:bg-blue-800"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Character
                  </label>
                  <select
                    name="characterId"
                    required
                    className="block w-full rounded-md border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
                  >
                    <option value="">Select a character</option>
                    {characters.map((char) => (
                      <option key={char.id} value={char.id}>
                        {char.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Connection Profile
                  </label>
                  <select
                    name="profileId"
                    required
                    className="block w-full rounded-md border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
                  >
                    <option value="">Select a profile</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800"
                >
                  Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
