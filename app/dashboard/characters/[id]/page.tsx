'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { AvatarSelector } from '@/components/images/avatar-selector'

interface Character {
  id: string
  name: string
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
  createdAt: string
  _count: {
    chats: number
  }
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface Persona {
  id: string
  name: string
  title?: string
  description: string
}

interface LinkedPersona {
  personaId: string
  isDefault: boolean
  persona: Persona
}

export default function CharacterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [character, setCharacter] = useState<Character | null>(null)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [linkedPersonas, setLinkedPersonas] = useState<LinkedPersona[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>('')
  const [selectedPersona, setSelectedPersona] = useState<string>('')
  const [personaToLink, setPersonaToLink] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [startingChat, setStartingChat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)

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

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      setProfiles(data || [])
      const defaultProfile = data?.find((p: any) => p.isDefault)
      if (defaultProfile) {
        setSelectedProfile(defaultProfile.id)
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err)
    }
  }, [])

  const fetchPersonas = useCallback(async () => {
    try {
      const res = await fetch('/api/personas')
      if (!res.ok) throw new Error('Failed to fetch personas')
      const data = await res.json()
      setPersonas(data || [])
    } catch (err) {
      console.error('Failed to fetch personas:', err)
    }
  }, [])

  const fetchLinkedPersonas = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}/personas`)
      if (!res.ok) throw new Error('Failed to fetch linked personas')
      const data = await res.json()
      setLinkedPersonas(data || [])
    } catch (err) {
      console.error('Failed to fetch linked personas:', err)
    }
  }, [id])

  useEffect(() => {
    fetchCharacter()
    fetchProfiles()
    fetchPersonas()
    fetchLinkedPersonas()
  }, [fetchCharacter, fetchProfiles, fetchPersonas, fetchLinkedPersonas])

  const startChat = async () => {
    if (!selectedProfile) {
      alert('Please select a connection profile')
      return
    }

    setStartingChat(true)

    try {
      const body: any = {
        characterId: id,
        connectionProfileId: selectedProfile,
      }

      if (selectedPersona) {
        body.personaId = selectedPersona
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start chat')
      }

      const data = await res.json()
      router.push(`/chats/${data.chat.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start chat')
    } finally {
      setStartingChat(false)
    }
  }

  const linkPersona = async () => {
    if (!personaToLink) return

    try {
      const res = await fetch(`/api/characters/${id}/personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId: personaToLink }),
      })

      if (!res.ok) throw new Error('Failed to link persona')

      await fetchLinkedPersonas()
      setPersonaToLink('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to link persona')
    }
  }

  const unlinkPersona = async (personaId: string) => {
    if (!confirm('Are you sure you want to unlink this persona?')) return

    try {
      const res = await fetch(`/api/characters/${id}/personas?personaId=${personaId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to unlink persona')

      await fetchLinkedPersonas()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to unlink persona')
    }
  }

  const setDefaultPersona = async (personaId: string) => {
    try {
      const res = await fetch(`/api/characters/${id}/personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId, isDefault: true }),
      })

      if (!res.ok) throw new Error('Failed to set default persona')

      await fetchLinkedPersonas()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to set default persona')
    }
  }

  const setCharacterAvatar = async (imageId: string) => {
    try {
      const res = await fetch(`/api/characters/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      if (!res.ok) throw new Error('Failed to set avatar')

      await fetchCharacter()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to set avatar')
    }
  }

  const getAvatarSrc = () => {
    if (character?.defaultImage) {
      return character.defaultImage.url || `/${character.defaultImage.filepath}`
    }
    return character?.avatarUrl
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading character...</p>
      </div>
    )
  }

  if (error || !character) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600">Error: {error || 'Character not found'}</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link
        href="/characters"
        className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
      >
        ← Back to Characters
      </Link>

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center">
            <div className="relative mr-4">
              {getAvatarSrc() ? (
                <Image
                  src={getAvatarSrc()!}
                  alt={character.name}
                  width={80}
                  height={80}
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center">
                  <span className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                    {character.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <button
                onClick={() => setShowAvatarSelector(true)}
                className="absolute -bottom-1 -right-1 bg-blue-600 text-white rounded-full p-1.5 hover:bg-blue-700 shadow-lg"
                title="Change avatar"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{character.name}</h1>
              <p className="text-gray-600 dark:text-gray-400">
                {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowUploadDialog(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Import Image
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Description</h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{character.description}</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Personality</h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{character.personality}</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Scenario</h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{character.scenario}</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">First Message</h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{character.firstMessage}</p>
          </div>

          {character.exampleDialogues && (
            <div>
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Example Dialogues</h2>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{character.exampleDialogues}</p>
            </div>
          )}

          {character.systemPrompt && (
            <div>
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">System Prompt</h2>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{character.systemPrompt}</p>
            </div>
          )}
        </div>
      </div>

      {/* Linked Personas Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Linked Personas</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Link personas to this character to quickly select them when starting a chat
        </p>

        {/* Linked personas list */}
        {linkedPersonas.length > 0 && (
          <div className="mb-4 space-y-2">
            {linkedPersonas.map((link) => (
              <div
                key={link.personaId}
                className="flex items-center justify-between p-3 border border-gray-200 dark:border-slate-700 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {link.persona.name}
                    </span>
                    {link.isDefault && (
                      <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs rounded">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {link.persona.description}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!link.isDefault && (
                    <button
                      onClick={() => setDefaultPersona(link.personaId)}
                      className="px-3 py-1 text-sm bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-slate-600"
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    onClick={() => unlinkPersona(link.personaId)}
                    className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
                  >
                    Unlink
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Link new persona */}
        <div className="flex gap-2">
          <select
            value={personaToLink}
            onChange={(e) => setPersonaToLink(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          >
            <option value="">Select a persona to link...</option>
            {personas
              .filter(p => !linkedPersonas.some(lp => lp.personaId === p.id))
              .map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.title ? `${persona.name} (${persona.title})` : persona.name}
                </option>
              ))}
          </select>
          <button
            onClick={linkPersona}
            disabled={!personaToLink}
            className="px-6 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
          >
            Link
          </button>
        </div>

        {personas.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            No personas available.{' '}
            <Link href="/personas/new" className="text-blue-600 dark:text-blue-400 hover:underline">
              Create one
            </Link>
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Start a Chat</h2>

        {profiles.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              You need to create a connection profile first
            </p>
            <Link
              href="/settings"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Go to Settings
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="profile" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                Select Connection Profile *
              </label>
              <select
                id="profile"
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                <option value="">Select a profile</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} - {profile.modelName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="persona" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                Select Persona (Optional)
              </label>
              <select
                id="persona"
                value={selectedPersona}
                onChange={(e) => setSelectedPersona(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                <option value="">None (use default)</option>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.title ? `${persona.name} (${persona.title})` : persona.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Choose a persona to roleplay as during this chat
              </p>
            </div>

            <button
              onClick={startChat}
              disabled={!selectedProfile || startingChat}
              className="w-full px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
            >
              {startingChat ? 'Starting Chat...' : 'Start Chat'}
            </button>
          </div>
        )}
      </div>

      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={() => {
          setShowUploadDialog(false)
        }}
        contextType="CHARACTER"
        contextId={id}
      />

      {/* Avatar Selector Dialog */}
      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => setShowAvatarSelector(false)}
        onSelect={setCharacterAvatar}
        currentImageId={character?.defaultImageId}
        contextType="CHARACTER"
        contextId={id}
      />
    </div>
  )
}
