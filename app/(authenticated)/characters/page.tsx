'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
// Using native img tag instead of next/image because /api/files/* routes
// are dynamic API endpoints that can't go through Next.js image optimization
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { CharacterDeleteDialog } from '@/components/character-delete-dialog'
import { clientLogger } from '@/lib/client-logger'

interface Character {
  id: string
  name: string
  title?: string | null
  description: string
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  isFavorite: boolean
  createdAt: string
  tags?: string[]
  _count: {
    chats: number
  }
}

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [deleteDialogCharacter, setDeleteDialogCharacter] = useState<Character | null>(null)
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()

  const visibleCharacters = useMemo(
    () => characters.filter(character => !shouldHideByIds(character.tags || [])),
    [characters, shouldHideByIds]
  )

  useEffect(() => {
    fetchCharacters()
  }, [])

  const getAvatarSrc = (character: Character): string | null => {
    if (character.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      return character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    }
    return character.avatarUrl || null
  }

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

  const openDeleteDialog = (character: Character) => {
    setDeleteDialogCharacter(character)
  }

  const handleDeleteConfirm = async (options: { cascadeChats: boolean; cascadeImages: boolean }) => {
    if (!deleteDialogCharacter) return

    const id = deleteDialogCharacter.id
    const params = new URLSearchParams()
    if (options.cascadeChats) params.set('cascadeChats', 'true')
    if (options.cascadeImages) params.set('cascadeImages', 'true')

    try {
      const url = `/api/characters/${id}${params.toString() ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete character')

      const result = await res.json()
      setCharacters(characters.filter((c) => c.id !== id))
      setDeleteDialogCharacter(null)

      // Show success message with details
      const deletedItems: string[] = ['Character deleted']
      if (result.deletedChats > 0) {
        deletedItems.push(`${result.deletedChats} chat${result.deletedChats === 1 ? '' : 's'} deleted`)
      }
      if (result.deletedImages > 0) {
        deletedItems.push(`${result.deletedImages} image${result.deletedImages === 1 ? '' : 's'} deleted`)
      }
      if (result.deletedMemories > 0) {
        deletedItems.push(`${result.deletedMemories} memor${result.deletedMemories === 1 ? 'y' : 'ies'} deleted`)
      }
      showSuccessToast(deletedItems.join('. '))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to delete character')
    }
  }

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/characters/${id}/favorite`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed to toggle favorite')
      const data = await res.json()
      setCharacters(characters.map((c) => (c.id === id ? { ...c, isFavorite: data.character.isFavorite } : c)))
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to toggle favorite')
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
      showSuccessToast('Character imported successfully!')
    } catch (err) {
      showErrorToast('Failed to import character. Make sure it\'s a valid SillyTavern PNG or JSON file.')
      clientLogger.error('Failed to import character', { error: err instanceof Error ? err.message : String(err) })
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
    <div className="container mx-auto px-4 py-8 max-w-[800px]">
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
            href="/characters/new"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Character
          </Link>
        </div>
      </div>

      {visibleCharacters.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-4">No characters yet</p>
          <Link
            href="/characters/new"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Create your first character
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visibleCharacters.map((character) => (
            <div
              key={character.id}
              className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 hover:shadow-lg transition-shadow bg-white dark:bg-slate-800"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center flex-grow gap-4">
                  {getAvatarSrc(character) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getAvatarSrc(character)!}
                      alt={character.name}
                      width={48}
                      height={48}
                      className={getAvatarClasses(style, 'md').imageClass}
                    />
                  ) : (
                    <div className={getAvatarClasses(style, 'md').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                      <span className={getAvatarClasses(style, 'md').fallbackClass}>
                        {character.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-grow">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{character.name}</h2>
                    {character.title && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">{character.title}</p>
                    )}
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {character._count.chats} chat{character._count.chats !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => toggleFavorite(e, character.id)}
                  className="ml-2 text-2xl hover:scale-110 transition-transform flex-shrink-0"
                  title={character.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {character.isFavorite ? '⭐' : '☆'}
                </button>
              </div>

              <p className="text-gray-700 dark:text-gray-300 mb-4 line-clamp-3">
                {character.description}
              </p>

              <div className="flex gap-2">
                <Link
                  href={`/characters/${character.id}/view?action=chat`}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 cursor-pointer flex items-center justify-center gap-2"
                  title="Start a chat with this character"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </Link>
                <Link
                  href={`/characters/${character.id}/view`}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer flex items-center justify-center gap-2 flex-1"
                  title="View character details"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View
                </Link>
                <a
                  href={`/api/characters/${character.id}/export?format=json`}
                  className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center justify-center"
                  title="Export character data"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v6a2 2 0 002 2h12a2 2 0 002-2v-6m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </a>
                <button
                  onClick={() => openDeleteDialog(character)}
                  className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer flex items-center justify-center"
                  title="Delete this character"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
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

      {/* Delete Character Dialog */}
      {deleteDialogCharacter && (
        <CharacterDeleteDialog
          characterId={deleteDialogCharacter.id}
          characterName={deleteDialogCharacter.name}
          onClose={() => setDeleteDialogCharacter(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}

    </div>
  )
}
