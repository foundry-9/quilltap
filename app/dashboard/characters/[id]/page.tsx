'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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

export default function CharacterDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [character, setCharacter] = useState<Character | null>(null)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [startingChat, setStartingChat] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCharacter()
    fetchProfiles()
  }, [params.id])

  const fetchCharacter = async () => {
    try {
      const res = await fetch(`/api/characters/${params.id}`)
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      setCharacter(data.character)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchProfiles = async () => {
    try {
      const res = await fetch('/api/profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      setProfiles(data.profiles || [])
      const defaultProfile = data.profiles?.find((p: any) => p.isDefault)
      if (defaultProfile) {
        setSelectedProfile(defaultProfile.id)
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err)
    }
  }

  const startChat = async () => {
    if (!selectedProfile) {
      alert('Please select a connection profile')
      return
    }

    setStartingChat(true)

    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: params.id,
          connectionProfileId: selectedProfile,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start chat')
      }

      const data = await res.json()
      router.push(`/dashboard/chats/${data.chat.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start chat')
    } finally {
      setStartingChat(false)
    }
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
        href="/dashboard/characters"
        className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
      >
        ← Back to Characters
      </Link>

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center">
            {character.avatarUrl ? (
              <img
                src={character.avatarUrl}
                alt={character.name}
                className="w-20 h-20 rounded-full mr-4"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-slate-700 mr-4 flex items-center justify-center">
                <span className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                  {character.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{character.name}</h1>
              <p className="text-gray-600 dark:text-gray-400">
                {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
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

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Start a Chat</h2>

        {profiles.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              You need to create a connection profile first
            </p>
            <Link
              href="/dashboard/settings"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Go to Settings
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="profile" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                Select Connection Profile
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
    </div>
  )
}
