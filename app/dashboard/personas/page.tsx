'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Persona {
  id: string
  name: string
  description: string
  personalityTraits: string | null
  avatarUrl: string | null
  createdAt: string
  characters: Array<{
    character: {
      id: string
      name: string
    }
  }>
}

export default function PersonasPage() {
  const router = useRouter()
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

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
    if (!confirm('Are you sure you want to delete this persona?')) return

    try {
      const response = await fetch(`/api/personas/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete persona')

      setPersonas(personas.filter((p) => p.id !== id))
    } catch (err) {
      alert('Failed to delete persona')
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

      const newPersona = await response.json()
      setPersonas([newPersona, ...personas])
      setImportDialogOpen(false)
      alert('Persona imported successfully!')
    } catch (err) {
      alert('Failed to import persona. Make sure it\'s a valid SillyTavern persona JSON file.')
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
            href="/dashboard/personas/new"
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

      {personas.length === 0 ? (
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
              href="/dashboard/personas/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800"
            >
              Create Persona
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((persona) => (
            <div
              key={persona.id}
              className="bg-white dark:bg-slate-800 overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white truncate">
                    {persona.name}
                  </h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3 mb-4">
                  {persona.description}
                </p>
                {persona.characters.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Linked to:</p>
                    <div className="flex flex-wrap gap-1">
                      {persona.characters.map((link) => (
                        <span
                          key={link.character.id}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200"
                        >
                          {link.character.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/personas/${persona.id}`}
                    className="flex-1 text-center px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600"
                  >
                    Edit
                  </Link>
                  <a
                    href={`/api/personas/${persona.id}/export`}
                    className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 hover:bg-gray-50 dark:hover:bg-slate-600"
                    title="Export"
                  >
                    ↓
                  </a>
                  <button
                    onClick={() => handleDelete(persona.id)}
                    className="px-3 py-2 border border-red-300 dark:border-red-700 rounded-md text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-950"
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
    </div>
  )
}
