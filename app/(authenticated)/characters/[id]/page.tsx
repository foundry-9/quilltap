'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { showAlert } from '@/lib/alert'

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
}

export default function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [character, setCharacter] = useState<Character | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    exampleDialogues: '',
    systemPrompt: '',
    avatarUrl: '',
  })

  useEffect(() => {
    fetchCharacter()
  }, [id])

  const fetchCharacter = async () => {
    try {
      const res = await fetch(`/api/characters/${id}`)
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      const char = data.character
      setCharacter(char)
      setFormData({
        name: char.name,
        description: char.description,
        personality: char.personality,
        scenario: char.scenario,
        firstMessage: char.firstMessage,
        exampleDialogues: char.exampleDialogues || '',
        systemPrompt: char.systemPrompt || '',
        avatarUrl: char.avatarUrl || '',
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
      const res = await fetch(`/api/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }

      await fetchCharacter()
      await showAlert('Character saved successfully!')
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

  const setCharacterAvatar = async (imageId: string) => {
    try {
      const res = await fetch(`/api/characters/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      if (!res.ok) throw new Error('Failed to set avatar')

      await fetchCharacter()
      setShowAvatarSelector(false)
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : 'Failed to set avatar')
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

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-8">
        <Link
          href="/characters"
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Back to Characters
        </Link>
        <div className="flex items-center gap-4">
          <div className="relative">
            {getAvatarSrc() ? (
              <Image
                src={getAvatarSrc()!}
                alt={character?.name || ''}
                width={80}
                height={80}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center">
                <span className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                  {character?.name?.charAt(0)?.toUpperCase() || '?'}
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{character?.name || 'Loading...'}</h1>
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
          <label htmlFor="description" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Description *
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            required
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="Describe the character's appearance, background, and key traits"
          />
        </div>

        <div>
          <label htmlFor="personality" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Personality *
          </label>
          <textarea
            id="personality"
            name="personality"
            value={formData.personality}
            onChange={handleChange}
            required
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="Describe the character's personality traits and behavioral patterns"
          />
        </div>

        <div>
          <label htmlFor="scenario" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Scenario *
          </label>
          <textarea
            id="scenario"
            name="scenario"
            value={formData.scenario}
            onChange={handleChange}
            required
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="Describe the setting and context for conversations"
          />
        </div>

        <div>
          <label htmlFor="firstMessage" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            First Message *
          </label>
          <textarea
            id="firstMessage"
            name="firstMessage"
            value={formData.firstMessage}
            onChange={handleChange}
            required
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="The character's opening message to start conversations"
          />
        </div>

        <div>
          <label htmlFor="exampleDialogues" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            Example Dialogues (Optional)
          </label>
          <textarea
            id="exampleDialogues"
            name="exampleDialogues"
            value={formData.exampleDialogues}
            onChange={handleChange}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="Example conversations to guide the AI's responses"
          />
        </div>

        <div>
          <label htmlFor="systemPrompt" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
            System Prompt (Optional)
          </label>
          <textarea
            id="systemPrompt"
            name="systemPrompt"
            value={formData.systemPrompt}
            onChange={handleChange}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="Custom system instructions (will be combined with auto-generated prompt)"
          />
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600"
          >
            {saving ? 'Saving...' : 'Save Character'}
          </button>
          <Link
            href="/characters"
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
        onSelect={setCharacterAvatar}
        currentImageId={character?.defaultImageId}
        contextType="CHARACTER"
        contextId={id}
      />

      {/* Image Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        contextType="CHARACTER"
        contextId={id}
        onSuccess={() => {
          setShowUploadDialog(false)
          fetchCharacter()
        }}
      />
    </div>
  )
}
