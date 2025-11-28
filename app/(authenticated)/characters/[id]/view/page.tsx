'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { showErrorToast } from '@/lib/toast'
import MessageContent from '@/components/chat/MessageContent'
import { RecentCharacterConversations } from '@/components/character/recent-conversations'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TagBadge } from '@/components/tags/tag-badge'
import { EntityTabs, Tab } from '@/components/tabs'
import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { PhysicalDescriptionList } from '@/components/physical-descriptions'

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
  description?: string | null
  personality?: string | null
  scenario?: string | null
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompt?: string
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
}

const CHARACTER_TABS: Tab[] = [
  {
    id: 'details',
    label: 'Details',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'profiles',
    label: 'Associated Profiles',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'gallery',
    label: 'Photo Gallery',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'descriptions',
    label: 'Physical Descriptions',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
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
  const [openedFromQuery, setOpenedFromQuery] = useState(false)
  const [defaultPersonaId, setDefaultPersonaId] = useState<string>('')
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)
  const { style } = useAvatarDisplay()

  const fetchCharacter = useCallback(async () => {
    console.log('[ViewCharacterPage] fetchCharacter called')
    try {
      const res = await fetch(`/api/characters/${id}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        }
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      console.log('[ViewCharacterPage] Fetched character with defaultImageId:', data.character.defaultImageId)
      setCharacter((prev) => {
        console.log('[ViewCharacterPage] Previous defaultImageId:', prev?.defaultImageId)
        if (prev?.defaultImageId !== data.character.defaultImageId) {
          console.log('[ViewCharacterPage] Avatar changed! Incrementing refresh key')
          setAvatarRefreshKey(k => k + 1)
        }
        return data.character
      })
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

  const fetchDefaultPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}/personas`)
      if (res.ok) {
        const data = await res.json()
        const defaultPersona = data.find((cp: any) => cp.isDefault)
        if (defaultPersona) {
          setDefaultPersonaId(defaultPersona.personaId)
        }
      }
    } catch (err) {
      console.error('Failed to fetch default persona:', err)
    }
  }, [id])

  useEffect(() => {
    fetchCharacter()
    fetchTags()
    fetchProfiles()
    fetchPersonas()
    fetchDefaultPersona()
  }, [fetchCharacter, fetchTags, fetchProfiles, fetchPersonas, fetchDefaultPersona])

  useEffect(() => {
    if (searchParams.get('action') === 'chat') {
      setShowChatDialog(true)
      setOpenedFromQuery(true)

      // Set default profile when opening from query
      if (character?.defaultConnectionProfileId) {
        setSelectedProfileId(character.defaultConnectionProfileId)
      } else if (profiles.length > 0) {
        setSelectedProfileId(profiles[0].id)
      }

      // Set default persona if available
      if (defaultPersonaId) {
        setSelectedPersonaId(defaultPersonaId)
      }
    }
  }, [searchParams, character?.defaultConnectionProfileId, profiles, defaultPersonaId])

  const getAvatarSrc = () => {
    let src = null
    if (character?.defaultImage) {
      src = character.defaultImage.url || `/${character.defaultImage.filepath}`
    } else {
      src = character?.avatarUrl
    }
    // Add cache-busting parameter based on defaultImageId to force reload when avatar changes
    if (src && character?.defaultImageId) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${character.defaultImageId}`
    }
    return src
  }

  const handleStartChat = () => {
    // Use character's default connection profile if available
    if (character?.defaultConnectionProfileId) {
      setSelectedProfileId(character.defaultConnectionProfileId)
    } else if (profiles.length === 0) {
      showErrorToast('No connection profiles available. Please set up a profile first.')
      return
    } else {
      // Fall back to first profile if no default is set
      setSelectedProfileId(profiles[0].id)
    }

    // Use character's default persona if available
    if (defaultPersonaId) {
      setSelectedPersonaId(defaultPersonaId)
    } else {
      setSelectedPersonaId('')
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
      const participants: any[] = [
        {
          type: 'CHARACTER',
          characterId: id,
          connectionProfileId: selectedProfileId,
          imageProfileId: selectedImageProfileId || undefined,
        },
      ]

      if (selectedPersonaId) {
        participants.push({
          type: 'PERSONA',
          personaId: selectedPersonaId,
        })
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants,
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

  const renderTabContent = (activeTab: string) => {
    switch (activeTab) {
      case 'details':
        return (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* Left Column: Character Details */}
            <div className="xl:col-span-2">
              {/* Tags Section */}
              {tags.length > 0 && (
                <div className="mb-6">
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <TagBadge key={tag.id} tag={tag} />
                    ))}
                  </div>
                </div>
              )}

              {/* Main Content */}
              <div className="space-y-6">
                {character?.description && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Description
                    </h2>
                    <div className="text-gray-700 dark:text-gray-300">
                      <MessageContent content={character.description} />
                    </div>
                  </div>
                )}

                {character?.personality && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Personality
                    </h2>
                    <div className="text-gray-700 dark:text-gray-300">
                      <MessageContent content={character.personality} />
                    </div>
                  </div>
                )}

                {character?.scenario && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      Scenario
                    </h2>
                    <div className="text-gray-700 dark:text-gray-300">
                      <MessageContent content={character.scenario} />
                    </div>
                  </div>
                )}

                {character?.firstMessage && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      First Message
                    </h2>
                    <div className="text-gray-700 dark:text-gray-300">
                      <MessageContent content={character.firstMessage} />
                    </div>
                  </div>
                )}

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
        )

      case 'profiles':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Default Connection Profile
              </h2>
              {character?.defaultConnectionProfileId ? (
                <div className="p-4 bg-gray-50 dark:bg-slate-700 rounded-lg">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    This character uses a default connection profile for chats, which can be overridden per individual chat.
                  </p>
                  <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
                    Profile: <span className="font-medium text-gray-900 dark:text-white">
                      {profiles.find(p => p.id === character.defaultConnectionProfileId)?.name || 'Unknown'}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No default connection profile set. Edit the character to set one.
                </p>
              )}
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Default Persona
              </h2>
              {defaultPersonaId ? (
                <div className="p-4 bg-gray-50 dark:bg-slate-700 rounded-lg">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    This character has a default persona linked for conversations.
                  </p>
                  <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
                    Persona: <span className="font-medium text-gray-900 dark:text-white">
                      {personas.find(p => p.id === defaultPersonaId)?.name || 'Unknown'}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No default persona linked. Edit the character to set one.
                </p>
              )}
            </div>
          </div>
        )

      case 'gallery':
        return (
          <EmbeddedPhotoGallery
            entityType="character"
            entityId={id}
            entityName={character?.name || 'Character'}
            currentAvatarId={character?.defaultImageId}
            onRefresh={fetchCharacter}
          />
        )

      case 'descriptions':
        return (
          <PhysicalDescriptionList
            entityType="character"
            entityId={id}
          />
        )

      default:
        return null
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
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                  src={getAvatarSrc()!}
                  alt={character?.name || ''}
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

        {/* Tabbed Content */}
        <EntityTabs tabs={CHARACTER_TABS} defaultTab="details">
          {renderTabContent}
        </EntityTabs>
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
                onClick={() => {
                  if (openedFromQuery) {
                    router.push('/characters')
                  } else {
                    setShowChatDialog(false)
                  }
                }}
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
