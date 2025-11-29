'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import { TagBadge } from '@/components/tags/tag-badge'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

interface Persona {
  id: string
  name: string
  title: string | null
  description: string
  personalityTraits: string | null
  avatarUrl: string | null
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  createdAt: string
  characters: Array<{
    character: {
      id: string
      name: string
    }
  }>
  tags: Array<{
    tagId: string
    tag: {
      id: string
      name: string
    }
  }>
}

export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [galleryPersona, setGalleryPersona] = useState<{ id: string; name: string } | null>(null)
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()

  const visiblePersonas = useMemo(
    () => personas.filter(persona => !shouldHideByIds(persona.tags.map(tagLink => tagLink.tag.id))),
    [personas, shouldHideByIds]
  )

  const getAvatarSrc = (persona: Persona): string | null => {
    if (persona.defaultImage) {
      return persona.defaultImage.url || `/${persona.defaultImage.filepath}`
    }
    return persona.avatarUrl || null
  }

  useEffect(() => {
    fetchPersonas()
  }, [])

  const fetchPersonas = async () => {
    try {
      const response = await fetch('/api/personas')
      if (!response.ok) throw new Error('Failed to fetch personas')
      const data = await response.json()
      setPersonas(data)
    } catch (err) {
      setError('Failed to load personas')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this persona?')
    if (!confirmed) return

    try {
      const response = await fetch(`/api/personas/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete persona')

      setPersonas(personas.filter((p) => p.id !== id))
    } catch (err) {
      showErrorToast('Failed to delete persona')
      console.error(err)
    }
  }

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const file = formData.get('file') as File

    if (!file) return

    try {
      const text = await file.text()
      const personaData = JSON.parse(text)

      const response = await fetch('/api/personas/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ personaData }),
      })

      if (!response.ok) throw new Error('Failed to import persona')

      const result = await response.json()

      // Check if this is a multi-persona import or single persona import
      if (result.personas && Array.isArray(result.personas)) {
        // Multi-persona import
        setPersonas([...result.personas, ...personas])
        setImportDialogOpen(false)
        showSuccessToast(result.message || `Successfully imported ${result.count} persona(s)!`)
      } else {
        // Single persona import
        setPersonas([result, ...personas])
        setImportDialogOpen(false)
        showSuccessToast('Persona imported successfully!')
      }
    } catch (err) {
      showErrorToast('Failed to import persona. Make sure it\'s a valid SillyTavern persona JSON file.')
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-gray-600 dark:text-gray-400">Loading personas...</div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Personas</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Manage your user personas for roleplay chats
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            Import
          </button>
          <Link
            href="/personas/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800"
          >
            Create Persona
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-200">{error}</p>
        </div>
      )}

      {visiblePersonas.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No personas</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Get started by creating a new persona or importing one.
          </p>
          <div className="mt-6">
            <Link
              href="/personas/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800"
            >
              Create Persona
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {visiblePersonas.map((persona) => (
            <div
              key={persona.id}
              className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 hover:shadow-lg transition-shadow bg-white dark:bg-slate-800 flex flex-col"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center flex-grow gap-4">
                  {getAvatarSrc(persona) ? (
                    <Image
                      src={getAvatarSrc(persona)!}
                      alt={persona.name}
                      width={48}
                      height={60}
                      className={getAvatarClasses(style, 'md').imageClass}
                      priority={false}
                    />
                  ) : (
                    <div className={getAvatarClasses(style, 'md').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                      <span className={getAvatarClasses(style, 'md').fallbackClass}>
                        {persona.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="flex-grow">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{persona.name}</h2>
                    {persona.title && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">{persona.title}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-grow">
                <p className="text-gray-700 dark:text-gray-300 mb-4 line-clamp-3">
                  {persona.description}
                </p>

                {persona.characters.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">Linked to:</p>
                    <div className="flex flex-wrap gap-1">
                      {persona.characters.map((link) => (
                        <span
                          key={link.character.id}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                        >
                          {link.character.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {persona.tags.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">Tags:</p>
                    <div className="flex flex-wrap gap-1">
                      {persona.tags.map((tagLink) => (
                        <TagBadge
                          key={tagLink.tag.id}
                          tag={tagLink.tag}
                          size="sm"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4">
                <Link
                  href={`/personas/${persona.id}`}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-center"
                >
                  Edit
                </Link>
                <button
                  onClick={() => setGalleryPersona({ id: persona.id, name: persona.name })}
                  className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                  title="Photos"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <a
                  href={`/api/personas/${persona.id}/export`}
                  className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                  title="Export"
                >
                  ↓
                </a>
                <button
                  onClick={() => handleDelete(persona.id)}
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
        <div className="fixed inset-0 bg-gray-500 dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Import Persona
            </h3>
            <form onSubmit={handleImport}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select SillyTavern persona JSON file
                </label>
                <input
                  type="file"
                  name="file"
                  accept=".json"
                  required
                  className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 dark:file:bg-indigo-900 file:text-indigo-700 dark:file:text-indigo-200 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-800"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800"
                >
                  Import
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Persona Photo Gallery Modal */}
      {galleryPersona && (
        <PhotoGalleryModal
          mode="persona"
          isOpen={true}
          onClose={() => setGalleryPersona(null)}
          personaId={galleryPersona.id}
          personaName={galleryPersona.name}
        />
      )}
    </div>
  )
}
