'use client'

import { useState, useEffect } from 'react'
import { ImageProfileForm } from '@/components/image-profiles/ImageProfileForm'
import { ProviderBadge } from '@/components/image-profiles/ProviderIcon'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN' | 'GOOGLE'
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  apiKey?: ApiKey | null
}

export default function ImageProfilesTab() {
  const [profiles, setProfiles] = useState<ImageProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
  }, [])

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/image-profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      setProfiles(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchApiKeys = async () => {
    try {
      const res = await fetch('/api/keys')
      if (!res.ok) throw new Error('Failed to fetch API keys')
      const data = await res.json()
      setApiKeys(data)
    } catch (err) {
      console.error('Failed to fetch API keys:', err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/image-profiles/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete profile')
      await fetchProfiles()
      setDeleteConfirming(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  const handleFormSuccess = async () => {
    setShowForm(false)
    setEditingId(null)
    await fetchProfiles()
  }

  const handleFormCancel = () => {
    setShowForm(false)
    setEditingId(null)
  }

  const editingProfile = editingId ? profiles.find(p => p.id === editingId) : undefined

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="text-gray-600 dark:text-gray-400">Loading image profiles...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Image Generation Profiles</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Manage profiles for different image generation providers
          </p>
        </div>
        {!showForm && !editingId && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          >
            New Profile
          </button>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Form */}
      {(showForm || editingId) && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-6 bg-gray-50 dark:bg-slate-900/50">
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-4">
            {editingProfile ? 'Edit Profile' : 'Create New Profile'}
          </h3>
          <ImageProfileForm
            profile={editingProfile}
            apiKeys={apiKeys}
            onSuccess={handleFormSuccess}
            onCancel={handleFormCancel}
          />
        </div>
      )}

      {/* Profiles List */}
      {!showForm && !editingId && (
        <div className="space-y-3">
          {profiles.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 dark:bg-slate-900/30 rounded-lg border border-gray-200 dark:border-slate-700">
              <p className="text-gray-600 dark:text-gray-400 mb-4">No image profiles yet</p>
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                Create First Profile
              </button>
            </div>
          ) : (
            profiles.map(profile => (
              <div
                key={profile.id}
                className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 hover:border-gray-300 dark:hover:border-slate-600 transition bg-white dark:bg-slate-800"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-medium text-gray-900 dark:text-white">{profile.name}</h3>
                      <ProviderBadge provider={profile.provider} />
                      {profile.isDefault && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-500 uppercase">Model</p>
                        <p className="font-mono text-sm dark:text-gray-300">{profile.modelName}</p>
                      </div>
                      {profile.apiKey && (
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-500 uppercase">API Key</p>
                          <p className="text-sm dark:text-gray-300">{profile.apiKey.label}</p>
                        </div>
                      )}
                    </div>

                    {/* Parameters Display */}
                    {Object.keys(profile.parameters).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700">
                        <p className="text-xs text-gray-500 dark:text-gray-500 uppercase mb-2">Parameters</p>
                        <div className="space-y-1">
                          {Object.entries(profile.parameters).map(([key, value]) => (
                            <div key={key} className="text-xs text-gray-600 dark:text-gray-400">
                              <span className="font-mono">{key}:</span>{' '}
                              <span className="text-gray-900 dark:text-gray-200">
                                {typeof value === 'string' ? value : JSON.stringify(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => setEditingId(profile.id)}
                      className="px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded border border-blue-200 dark:border-blue-900/50 hover:border-blue-300 dark:hover:border-blue-900/70 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                    >
                      Edit
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setDeleteConfirming(deleteConfirming === profile.id ? null : profile.id)}
                        className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded border border-red-200 dark:border-red-900/50 hover:border-red-300 dark:hover:border-red-900/70 focus:outline-none focus:ring-2 focus:ring-red-500 dark:focus:ring-red-400"
                      >
                        Delete
                      </button>

                      {/* Delete Confirmation Popover */}
                      {deleteConfirming === profile.id && (
                        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg p-3 whitespace-nowrap z-10">
                          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">Delete this profile?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDeleteConfirming(null)}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-gray-500 dark:focus:ring-gray-400"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDelete(profile.id)}
                              className="px-2 py-1 text-xs bg-red-600 dark:bg-red-700 text-white hover:bg-red-700 dark:hover:bg-red-600 rounded focus:outline-none focus:ring-2 focus:ring-red-500 dark:focus:ring-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
