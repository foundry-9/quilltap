'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { ImageUploadDialog } from '@/components/images/image-upload-dialog'
import { TagEditor } from '@/components/tags/tag-editor'
import { MemoryList } from '@/components/memory'
import { showAlert } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { EntityTabs, Tab } from '@/components/tabs'
import { EmbeddedPhotoGallery } from '@/components/images/EmbeddedPhotoGallery'
import { PhysicalDescriptionList } from '@/components/physical-descriptions'
import { clientLogger } from '@/lib/client-logger'

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

interface ConnectionProfile {
  id: string
  name: string
}

interface Persona {
  id: string
  name: string
  title?: string
  matchingTagCount?: number
}

interface CharacterPersonaLink {
  personaId: string
  isDefault: boolean
  persona: Persona
}

const EDIT_CHARACTER_TABS: Tab[] = [
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

export default function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [character, setCharacter] = useState<Character | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [defaultPersonaId, setDefaultPersonaId] = useState<string>('')
  const [loadingPersonas, setLoadingPersonas] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    exampleDialogues: '',
    systemPrompt: '',
    avatarUrl: '',
    defaultConnectionProfileId: '',
  })
  const [originalFormData, setOriginalFormData] = useState({
    name: '',
    title: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    exampleDialogues: '',
    systemPrompt: '',
    avatarUrl: '',
    defaultConnectionProfileId: '',
  })
  const [originalDefaultPersonaId, setOriginalDefaultPersonaId] = useState<string>('')
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)

  const fetchCharacter = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        }
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      const char = data.character
      setCharacter((prev) => {
        if (prev?.defaultImageId !== char.defaultImageId) {
          setAvatarRefreshKey(k => k + 1)
        }
        return char
      })
      const initialFormData = {
        name: char.name,
        title: char.title || '',
        description: char.description || '',
        personality: char.personality || '',
        scenario: char.scenario || '',
        firstMessage: char.firstMessage || '',
        exampleDialogues: char.exampleDialogues || '',
        systemPrompt: char.systemPrompt || '',
        avatarUrl: char.avatarUrl || '',
        defaultConnectionProfileId: char.defaultConnectionProfileId || '',
      }
      setFormData(initialFormData)
      setOriginalFormData(initialFormData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [id])

  const fetchPersonas = useCallback(async () => {
    try {
      setLoadingPersonas(true)
      const res = await fetch(`/api/personas?sortByCharacter=${id}`)
      if (!res.ok) throw new Error('Failed to fetch personas')
      const data = await res.json()
      setPersonas(data)
    } catch (err) {
      clientLogger.error('Error fetching personas', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingPersonas(false)
    }
  }, [id])

  const fetchDefaultPersona = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${id}/personas`)
      if (!res.ok) throw new Error('Failed to fetch linked personas')
      const data = await res.json()
      const defaultPersona = data.find((cp: CharacterPersonaLink) => cp.isDefault)
      if (defaultPersona) {
        setDefaultPersonaId(defaultPersona.personaId)
        setOriginalDefaultPersonaId(defaultPersona.personaId)
      }
    } catch (err) {
      clientLogger.error('Error fetching default persona', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [id])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(data)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch profiles', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    fetchCharacter()
    fetchPersonas()
    fetchDefaultPersona()
    fetchProfiles()
  }, [fetchCharacter, fetchPersonas, fetchDefaultPersona, fetchProfiles])

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(originalFormData) || defaultPersonaId !== originalDefaultPersonaId

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

      // Handle persona linking/unlinking
      if (defaultPersonaId !== originalDefaultPersonaId) {
        // If there was a previous default persona, unlink it
        if (originalDefaultPersonaId) {
          await fetch(`/api/characters/${id}/personas?personaId=${originalDefaultPersonaId}`, {
            method: 'DELETE',
          })
        }

        // If a new default persona is selected, link it
        if (defaultPersonaId) {
          await fetch(`/api/characters/${id}/personas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personaId: defaultPersonaId,
              isDefault: true,
            }),
          })
        }
      }

      await fetchCharacter()
      showSuccessToast('Character saved successfully!')
      router.push(`/characters/${id}/view`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleCancel = async () => {
    if (hasChanges) {
      const result = await showAlert(
        'You have unsaved changes. What would you like to do?',
        ['Save', 'Discard', 'Cancel']
      )

      if (result === 'Save') {
        // Submit the form
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
        document.querySelector('form')?.dispatchEvent(submitEvent)
        return
      } else if (result === 'Cancel' || result === undefined) {
        return
      }
      // If 'Discard', continue to navigation
    }
    router.push(`/characters/${id}/view`)
  }

  const setCharacterAvatar = async (imageId: string) => {
    try {
      if (!id) {
        throw new Error('Character ID is missing')
      }
      
      const res = await fetch(`/api/characters/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      const responseData = await res.json()
      
      if (!res.ok) {
        throw new Error(responseData.error || 'Failed to set avatar')
      }

      await fetchCharacter()
      setShowAvatarSelector(false)
      showSuccessToast('Avatar updated!')
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to set avatar')
    }
  }

  const getAvatarSrc = () => {
    let src = null
    if (character?.defaultImage) {
      // Handle filepath - check if it already has a leading slash (e.g., S3 files use /api/files/...)
      const filepath = character.defaultImage.filepath
      src = character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-900 dark:text-white">Loading character...</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-[800px]">
      <div className="mb-8">
        <button
          onClick={handleCancel}
          className="text-blue-600 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Back
        </button>
        <div className="flex items-center gap-4">
          <div className="relative">
            {getAvatarSrc() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${character?.defaultImageId || 'no-image'}-${avatarRefreshKey}`}
                src={getAvatarSrc()!}
                alt={character?.name || ''}
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Edit: {character?.name || 'Loading...'}
            </h1>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <EntityTabs tabs={EDIT_CHARACTER_TABS} defaultTab="details">
          {(activeTab: string) => {
            switch (activeTab) {
              case 'details':
                return (
                  <div className="space-y-6">
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
                        Description (Optional)
                      </label>
                      <textarea
                        id="description"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                        placeholder="Describe the character's appearance, background, and key traits"
                      />
                    </div>

                    <div>
                      <label htmlFor="personality" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                        Personality (Optional)
                      </label>
                      <textarea
                        id="personality"
                        name="personality"
                        value={formData.personality}
                        onChange={handleChange}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                        placeholder="Describe the character's personality traits and behavioral patterns"
                      />
                    </div>

                    <div>
                      <label htmlFor="scenario" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                        Scenario (Optional)
                      </label>
                      <textarea
                        id="scenario"
                        name="scenario"
                        value={formData.scenario}
                        onChange={handleChange}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                        placeholder="Describe the setting and context for conversations"
                      />
                    </div>

                    <div>
                      <label htmlFor="firstMessage" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                        First Message (Optional)
                      </label>
                      <textarea
                        id="firstMessage"
                        name="firstMessage"
                        value={formData.firstMessage}
                        onChange={handleChange}
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

                    {/* Tag Editor */}
                    <TagEditor entityType="character" entityId={id} />

                    {/* Memories Section */}
                    <div className="pt-6 border-t border-gray-200 dark:border-slate-700">
                      <MemoryList characterId={id} />
                    </div>
                  </div>
                )

              case 'profiles':
                return (
                  <div className="space-y-6">
                    <div>
                      <label htmlFor="defaultConnectionProfileId" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                        Default Connection Profile (Optional)
                      </label>
                      <select
                        id="defaultConnectionProfileId"
                        name="defaultConnectionProfileId"
                        value={formData.defaultConnectionProfileId}
                        onChange={handleChange}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                      >
                        <option value="">No default profile</option>
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Can be overridden for individual chats
                      </p>
                    </div>

                    {/* Default Persona Selector */}
                    <div>
                      <label htmlFor="defaultPersona" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                        Default Persona (Optional)
                      </label>
                      {loadingPersonas ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">Loading personas...</p>
                      ) : personas.length > 0 ? (
                        <>
                          <select
                            id="defaultPersona"
                            value={defaultPersonaId}
                            onChange={(e) => setDefaultPersonaId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                          >
                            <option value="">No default persona</option>
                            {personas.map((persona) => {
                              const displayName = persona.title ? `${persona.name} (${persona.title})` : persona.name
                              const tagCount = persona.matchingTagCount
                              const plural = tagCount === 1 ? '' : 's'
                              const tagSuffix = tagCount ? ` — ${tagCount} shared tag${plural}` : ''
                              return (
                                <option key={persona.id} value={persona.id}>
                                  {displayName}{tagSuffix}
                                </option>
                              )
                            })}
                          </select>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Personas are sorted by number of tags shared with this character
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          No personas available. Create a persona first.
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
                    onAvatarChange={(imageId) => {
                      if (imageId) {
                        setCharacterAvatar(imageId)
                      } else {
                        // Clear avatar
                        fetch(`/api/characters/${id}/avatar`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ imageId: null }),
                        }).then(() => fetchCharacter())
                      }
                    }}
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
          }}
        </EntityTabs>

        <div className="flex gap-4 mt-8">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-6 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 font-medium"
          >
            {saving ? 'Saving...' : 'Save Character'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="px-6 py-3 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 font-medium"
          >
            Cancel
          </button>
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
