'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { showAlert } from '@/lib/alert'

interface Persona {
  id: string
  name: string
  title?: string
  description: string
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
}

export default function EditPersonaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [persona, setPersona] = useState<Persona | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    description: '',
  })

  useEffect(() => {
    fetchPersona()
  }, [id])

  const fetchPersona = async () => {
    try {
      const res = await fetch(`/api/personas/${id}`)
      if (!res.ok) throw new Error('Failed to fetch persona')
      const p = await res.json()
      setPersona(p)
      setFormData({
        name: p.name,
        title: p.title || '',
        description: p.description,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/personas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update persona')
      }

      await fetchPersona()
      await showAlert('Persona saved successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const setPersonaAvatar = async (imageId: string) => {
    try {
      const res = await fetch(`/api/personas/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      if (!res.ok) throw new Error('Failed to set avatar')

      await fetchPersona()
      setShowAvatarSelector(false)
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : 'Failed to set avatar')
    }
  }

  const getAvatarSrc = () => {
    if (persona?.defaultImage) {
      return persona.defaultImage.url || `/${persona.defaultImage.filepath}`
    }
    return persona?.avatarUrl
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading persona...</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-8">
        <Link
          href="/personas"
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Back to Personas
        </Link>
        <div className="flex items-center gap-4">
          <div className="relative">
            {getAvatarSrc() ? (
              <Image
                src={getAvatarSrc()!}
                alt={persona?.name || ''}
                width={80}
                height={80}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center">
                <span className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                  {persona?.name?.charAt(0)?.toUpperCase() || '?'}
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{persona?.name || 'Loading...'}</h1>
            {persona?.title && (
              <p className="text-gray-600 dark:text-gray-400">{persona.title}</p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Title (Optional)
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="e.g., Student, Teacher, Narrator"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Description *
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            required
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="Describe this persona's characteristics, background, and role"
          />
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
          >
            {saving ? 'Saving...' : 'Save Persona'}
          </button>
          <Link
            href="/personas"
            className="px-6 py-3 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 text-center"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Avatar Selector Modal */}
      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => setShowAvatarSelector(false)}
        onSelect={setPersonaAvatar}
        currentImageId={persona?.defaultImageId}
        contextType="PERSONA"
        contextId={id}
      />

      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={() => {
          setShowUploadDialog(false)
          fetchPersona()
        }}
        contextType="PERSONA"
        contextId={id}
      />
    </div>
  )
}
