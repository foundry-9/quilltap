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
  characters: Array<{
    character: {
      id: string
      name: string
    }
  }>
}

export default function EditPersonaPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [persona, setPersona] = useState<Persona | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPersona()
  }, [params.id])

  const fetchPersona = async () => {
    try {
      const response = await fetch(`/api/personas/${params.id}`)
      if (!response.ok) throw new Error('Failed to fetch persona')
      const data = await response.json()
      setPersona(data)
    } catch (err) {
      setError('Failed to load persona')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      personalityTraits: formData.get('personalityTraits') as string,
    }

    try {
      const response = await fetch(`/api/personas/${params.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update persona')
      }

      const updated = await response.json()
      setPersona(updated)
      alert('Persona updated successfully!')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this persona? This action cannot be undone.')) {
      return
    }

    try {
      const response = await fetch(`/api/personas/${params.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete persona')

      router.push('/dashboard/personas')
    } catch (err) {
      alert('Failed to delete persona')
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-gray-600">Loading persona...</div>
      </div>
    )
  }

  if (!persona) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-gray-600">Persona not found</div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <Link
          href="/dashboard/personas"
          className="text-sm text-indigo-600 hover:text-indigo-500 mb-4 inline-block"
        >
          ← Back to personas
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{persona.name}</h1>
            <p className="mt-2 text-sm text-gray-700">Edit persona details</p>
          </div>
          <div className="flex gap-2">
            <a
              href={`/api/personas/${params.id}/export`}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Export
            </a>
            <button
              onClick={handleDelete}
              className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {persona.characters.length > 0 && (
        <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-md">
          <h3 className="text-sm font-medium text-indigo-900 mb-2">
            Linked to characters:
          </h3>
          <div className="flex flex-wrap gap-2">
            {persona.characters.map((link) => (
              <Link
                key={link.character.id}
                href={`/dashboard/characters/${link.character.id}`}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200"
              >
                {link.character.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 bg-white shadow rounded-lg p-6">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            defaultValue={persona.name}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-4 py-2 border"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Description *
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            defaultValue={persona.description}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-4 py-2 border"
          />
        </div>

        <div>
          <label
            htmlFor="personalityTraits"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Personality Traits
          </label>
          <textarea
            id="personalityTraits"
            name="personalityTraits"
            rows={3}
            defaultValue={persona.personalityTraits || ''}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-4 py-2 border"
          />
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <Link
            href="/dashboard/personas"
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
