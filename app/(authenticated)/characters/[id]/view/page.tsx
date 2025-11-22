'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { showErrorToast } from '@/lib/toast'
import MessageContent from '@/components/chat/MessageContent'
import { RecentCharacterConversations } from '@/components/character/recent-conversations'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'

interface Tag {
  id: string
  name: string
}

interface ConnectionProfile {
  id: string
  name: string
}

interface Persona {
  id: string
  name: string
  title: string | null
}

interface Character {
  id: string
  name: string
  title?: string | null
  description: string
  personality: string
  scenario: string
  firstMessage: string
  exampleDialogues?: string
  systemPrompt?: string
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
}

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [showChatDialog, setShowChatDialog] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('')
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [creatingChat, setCreatingChat] = useState(false)
  const { style } = useAvatarDisplay()

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}`)
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      setCharacter(data.character)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [id])

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}/tags`)
      if (!res.ok) throw new Error('Failed to fetch tags')
      const data = await res.json()
      setTags(data.tags || [])
    } catch (err) {
      console.error('Failed to fetch tags:', err)
    }
  }, [id])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(data.map((p: any) => ({ id: p.id, name: p.name })))
        // Set first profile as default if available
        if (data.length > 0) {
          setSelectedProfileId(data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err)
    }
  }, [])

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch('/api/personas')
      if (res.ok) {
        const data = await res.json()
        setPersonas(data.map((p: any) => ({ id: p.id, name: p.name, title: p.title })))
      }
    } catch (err) {
      console.error('Failed to fetch personas:', err)
    }
  }, [])

  useEffect(() => {
    fetchCharacter()
    fetchTags()
    fetchProfiles()
    fetchPersonas()
  }, [fetchCharacter, fetchTags, fetchProfiles, fetchPersonas])

  const getAvatarSrc = () => {
    if (character?.defaultImage) {
      return character.defaultImage.url || `/${character.defaultImage.filepath}`
    }
    return character?.avatarUrl
  }

  const handleStartChat = () => {
    if (profiles.length === 0) {
      showErrorToast('No connection profiles available. Please set up a profile first.')
      return
    }
    setShowChatDialog(true)
  }

  const handleCreateChat = async () => {
    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      return
    }

    setCreatingChat(true)
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: id,
          connectionProfileId: selectedProfileId,
          personaId: selectedPersonaId || undefined,
          imageProfileId: selectedImageProfileId || undefined,
          title: `Chat with ${character?.name}`,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }
      const data = await res.json()
      setShowChatDialog(false)
      router.push(`/chats/${data.chat.id}`)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to start chat')
    } finally {
      setCreatingChat(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-900 dark:text-white">Loading character...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-lg text-red-600 dark:text-red-400 mb-4">Error: {error}</p>
          <Link
            href="/characters"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Back to Characters
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto">
        <Link
          href="/characters"
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Back to Characters
        </Link>
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="flex items-center gap-4 flex-grow">
            <div className="relative">
              {getAvatarSrc() ? (
                <Image
                  src={getAvatarSrc()!}
                  alt={character?.name || ''}
                  width={80}
                  height={80}
                  className={getAvatarClasses(style, 'lg').imageClass}
                />
              ) : (
                <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                  <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                    {character?.name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                {character?.name || 'Loading...'}
              </h1>
              {character?.title && (
                <p className="text-gray-600 dark:text-gray-400">{character.title}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleStartChat}
              className="px-4 py-2 bg-green-600 dark:bg-green-700 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-800 font-medium whitespace-nowrap"
            >
              Start Chat
            </button>
            <Link
              href={`/characters/${id}/edit`}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 font-medium whitespace-nowrap text-center"
            >
              Edit
            </Link>
          </div>
        </div>

        {/* Two-column layout: content on left, conversations on right on wide screens */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column: Character Details */}
          <div className="xl:col-span-2">
            {/* Tags Section */}
            {tags.length > 0 && (
              <div className="mb-6">
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-block px-3 py-1 bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Main Content */}
            <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Description
          </h2>
          <div className="text-gray-700 dark:text-gray-300">
            <MessageContent content={character?.description || ''} />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Personality
          </h2>
          <div className="text-gray-700 dark:text-gray-300">
            <MessageContent content={character?.personality || ''} />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Scenario
          </h2>
          <div className="text-gray-700 dark:text-gray-300">
            <MessageContent content={character?.scenario || ''} />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            First Message
          </h2>
          <div className="text-gray-700 dark:text-gray-300">
            <MessageContent content={character?.firstMessage || ''} />
          </div>
        </div>

        {character?.exampleDialogues && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Example Dialogues
            </h2>
            <div className="text-gray-700 dark:text-gray-300">
              <MessageContent content={character.exampleDialogues} />
            </div>
          </div>
        )}

        {character?.systemPrompt && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              System Prompt
            </h2>
            <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-md overflow-hidden my-2">
              <code className="text-sm whitespace-pre-wrap break-words">
                {character.systemPrompt}
              </code>
            </pre>
          </div>
        )}
            </div>
          </div>

          {/* Right Column: Recent Conversations */}
          <div className="xl:col-span-1">
            <div className="sticky top-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Recent Conversations
              </h2>
              <RecentCharacterConversations characterId={id} />
            </div>
          </div>
        </div>
      </div>

      {/* Chat Creation Dialog */}
      {showChatDialog && (
        <div className="fixed inset-0 bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Start Chat with {character?.name}
            </h3>

            <div className="space-y-4">
              {/* Connection Profile Selection */}
              <div>
                <label htmlFor="profile" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Connection Profile *
                </label>
                <select
                  id="profile"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                >
                  <option value="">Select a profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Persona Selection */}
              {personas.length > 0 && (
                <div>
                  <label htmlFor="persona" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                    Persona (Optional)
                  </label>
                  <select
                    id="persona"
                    value={selectedPersonaId}
                    onChange={(e) => setSelectedPersonaId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  >
                    <option value="">Use character defaults</option>
                    {personas.map((persona) => (
                      <option key={persona.id} value={persona.id}>
                        {persona.title ? `${persona.name} (${persona.title})` : persona.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Image Profile Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Image Generation Profile (Optional)
                </label>
                <ImageProfilePicker
                  value={selectedImageProfileId}
                  onChange={setSelectedImageProfileId}
                  characterId={id}
                  personaId={selectedPersonaId}
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowChatDialog(false)}
                className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChat}
                disabled={!selectedProfileId || creatingChat}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 transition-colors"
              >
                {creatingChat ? 'Creating...' : 'Start Chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
