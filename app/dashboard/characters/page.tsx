'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

interface Character {
  id: string
  name: string
  description: string
  avatarUrl?: string
  createdAt: string
  _count: {
    chats: number
  }
}

export default function CharactersPage() {
  const router = useRouter()
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  useEffect(() => {
    fetchCharacters()
  }, [])

  const fetchCharacters = async () => {
    try {
      const res = await fetch('/api/characters')
      if (!res.ok) throw new Error('Failed to fetch characters')
      const data = await res.json()
      setCharacters(data.characters)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const deleteCharacter = async (id: string) => {
    if (!confirm('Are you sure you want to delete this character?')) return

    try {
      const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete character')
      setCharacters(characters.filter((c) => c.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete character')
    }
  }

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/characters/import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to import character')

      const character = await res.json()
      setCharacters([character, ...characters])
      setImportDialogOpen(false)
      alert('Character imported successfully!')
    } catch (err) {
      alert('Failed to import character. Make sure it\'s a valid SillyTavern PNG or JSON file.')
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-900 dark:text-white">Loading characters...</p>
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Characters</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Import
          </button>
          <Link
            href="/dashboard/characters/new"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Character
          </Link>
        </div>
      </div>

      {characters.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-4">No characters yet</p>
          <Link
            href="/dashboard/characters/new"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Create your first character
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {characters.map((character) => (
            <div
              key={character.id}
              className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 hover:shadow-lg transition-shadow bg-white dark:bg-slate-800"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  {character.avatarUrl ? (
                    <Image
                      src={character.avatarUrl}
                      alt={character.name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-full mr-3"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-slate-700 mr-3 flex items-center justify-center">
                      <span className="text-xl font-bold text-gray-600 dark:text-gray-300">
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{character.name}</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-gray-700 dark:text-gray-300 mb-4 line-clamp-3">
                {character.description}
              </p>

              <div className="flex gap-2">
                <Link
                  href={`/dashboard/characters/${character.id}`}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-center"
                >
                  View
                </Link>
                <a
                  href={`/api/characters/${character.id}/export?format=json`}
                  className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                  title="Export"
                >
                  ↓
                </a>
                <button
                  onClick={() => deleteCharacter(character.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Dialog */}
      {importDialogOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Import Character
            </h3>
            <form onSubmit={handleImport}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select SillyTavern character file (PNG or JSON)
                </label>
                <input
                  type="file"
                  name="file"
                  accept=".png,.json"
                  required
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
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
