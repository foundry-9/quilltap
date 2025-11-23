'use client'

import { useEffect, useState } from 'react'
import { ProviderIcon } from './ProviderIcon'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  modelName: string
  isDefault: boolean
  apiKey?: ApiKey | null
  tags?: any[]
}

interface ImageProfilePickerProps {
  value?: string | null
  onChange?: (profileId: string | null) => void
  characterId?: string
  personaId?: string
}

export function ImageProfilePicker({
  value,
  onChange,
  characterId,
  personaId,
}: ImageProfilePickerProps) {
  const [profiles, setProfiles] = useState<ImageProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        setLoading(true)
        setError(null)

        const url = new URL('/api/image-profiles', window.location.origin)
        if (characterId) {
          url.searchParams.set('sortByCharacter', characterId)
        }
        if (personaId) {
          url.searchParams.set('sortByPersona', personaId)
        }

        const res = await fetch(url.toString())
        if (!res.ok) throw new Error('Failed to fetch profiles')

        const data = await res.json()
        setProfiles(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch profiles')
      } finally {
        setLoading(false)
      }
    }

    fetchProfiles()
  }, [characterId, personaId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 dark:border-blue-400 border-r-transparent"></div>
        Loading profiles...
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <select
        value={value || ''}
        onChange={e => onChange?.(e.target.value || null)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
      >
        <option value="">No image generation</option>
        {profiles.map(profile => (
          <option key={profile.id} value={profile.id}>
            {profile.name} ({profile.modelName})
            {profile.isDefault ? ' [Default]' : ''}
          </option>
        ))}
      </select>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      {profiles.length === 0 && !loading && !error && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No image profiles available. Create one in Settings first.
        </p>
      )}

      {/* Show selected profile details */}
      {value && profiles.length > 0 && (
        <div className="mt-3 p-3 bg-blue-50 dark:bg-slate-700 rounded-md border border-blue-200 dark:border-slate-600">
          {(() => {
            const selected = profiles.find(p => p.id === value)
            if (!selected) return null

            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ProviderIcon provider={selected.provider} />
                  <div>
                    <p className="font-medium text-sm text-gray-900 dark:text-white">{selected.name}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{selected.modelName}</p>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
