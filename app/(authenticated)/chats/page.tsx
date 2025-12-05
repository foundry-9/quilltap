'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { clientLogger } from '@/lib/client-logger'
import { TagDisplay } from '@/components/tags/tag-display'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

interface ChatParticipant {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  characterId?: string | null
  personaId?: string | null
  connectionProfileId?: string | null
  imageProfileId?: string | null
  isActive: boolean
  displayOrder: number
  character?: {
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
  }
}

interface Chat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  participants: ChatParticipant[]
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
  const [characters, setCharacters] = useState<Array<{ id: string; name: string; title?: string | null }>>([])
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()

  const visibleChats = useMemo(
    () => chats.filter(chat => !shouldHideByIds(chat.tags.map(ct => ct.tag.id))),
    [chats, shouldHideByIds]
  )

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

  // Helper to get first character participant
  const getFirstCharacter = (chat: Chat) => {
    const charParticipant = chat.participants.find(
      p => p.type === 'CHARACTER' && p.isActive && p.character
    )
    return charParticipant?.character
  }

  // Helper to get first persona participant
  const getFirstPersona = (chat: Chat) => {
    const personaParticipant = chat.participants.find(
      p => p.type === 'PERSONA' && p.isActive && p.persona
    )
    return personaParticipant?.persona
  }

  const getAvatarSrc = (chat: Chat): string | null => {
    const character = getFirstCharacter(chat)
    if (!character) return null
    if (character.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    }
    return character.avatarUrl || null
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
        setCharacters(data.characters.map((c: any) => ({ id: c.id, name: c.name, title: c.title })))
      }
    } catch (err) {
      clientLogger.error('Failed to fetch characters:', { error: err instanceof Error ? err.message : String(err) })
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
      clientLogger.error('Failed to fetch profiles:', { error: err instanceof Error ? err.message : String(err) })
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
                clientLogger.warn('Skipped invalid JSON line:', { line: line.substring(0, 50) })
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
          clientLogger.error('Error importing chat:', { error: err instanceof Error ? err.message : String(err) })
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
      clientLogger.error('Error importing chats:', { error: err instanceof Error ? err.message : String(err) })
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

      {visibleChats.length === 0 ? (
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
          {visibleChats.map((chat) => (
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
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start flex-1 gap-4">
                  {(() => {
                    const character = getFirstCharacter(chat)
                    const persona = getFirstPersona(chat)
                    const avatarSrc = getAvatarSrc(chat)
                    const characterName = character?.name || 'Unknown'

                    return (
                      <>
                        {avatarSrc ? (
                          <Image
                            src={avatarSrc}
                            alt={characterName}
                            width={64}
                            height={64}
                            className={getAvatarClasses(style, 'lg').imageClass}
                          />
                        ) : (
                          <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                            <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                              {characterName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{chat.title}</h2>
                            <span className="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 text-sm font-semibold px-3 py-1 rounded-full">
                              {chat._count.messages}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {characterName}
                            {persona && ` (${persona.name}${persona.title ? ` - ${persona.title}` : ''})`}
                            {' \u2022 '}
                            {new Date(chat.updatedAt).toLocaleDateString()}
                          </p>
                          {chat.tags.length > 0 && (
                            <div className="mt-2">
                              <TagDisplay tags={chat.tags.map(ct => ct.tag)} />
                            </div>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>

                <div className="flex flex-col gap-2">
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
                    onClick={() => deleteChat(chat.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-600 dark:bg-red-700 rounded hover:bg-red-700 dark:hover:bg-red-800 transition-colors"
                    title="Delete chat"
                  >
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
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
                        {char.title ? `${char.name} (${char.title})` : char.name}
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
