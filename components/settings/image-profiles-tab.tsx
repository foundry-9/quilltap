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
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
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
        <div className="text-gray-600">Loading image profiles...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Image Generation Profiles</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage profiles for different image generation providers
          </p>
        </div>
        {!showForm && !editingId && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            New Profile
          </button>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Form */}
      {(showForm || editingId) && (
        <div className="border rounded-lg p-6 bg-gray-50">
          <h3 className="text-md font-semibold text-gray-900 mb-4">
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
            <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-600 mb-4">No image profiles yet</p>
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Create First Profile
              </button>
            </div>
          ) : (
            profiles.map(profile => (
              <div
                key={profile.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-medium text-gray-900">{profile.name}</h3>
                      <ProviderBadge provider={profile.provider} />
                      {profile.isDefault && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div>
                        <p className="text-xs text-gray-500 uppercase">Model</p>
                        <p className="font-mono text-sm">{profile.modelName}</p>
                      </div>
                      {profile.apiKey && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase">API Key</p>
                          <p className="text-sm">{profile.apiKey.label}</p>
                        </div>
                      )}
                    </div>

                    {/* Parameters Display */}
                    {Object.keys(profile.parameters).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs text-gray-500 uppercase mb-2">Parameters</p>
                        <div className="space-y-1">
                          {Object.entries(profile.parameters).map(([key, value]) => (
                            <div key={key} className="text-xs text-gray-600">
                              <span className="font-mono">{key}:</span>{' '}
                              <span className="text-gray-900">
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
                      className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded border border-blue-200 hover:border-blue-300"
                    >
                      Edit
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setDeleteConfirming(deleteConfirming === profile.id ? null : profile.id)}
                        className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded border border-red-200 hover:border-red-300"
                      >
                        Delete
                      </button>

                      {/* Delete Confirmation Popover */}
                      {deleteConfirming === profile.id && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 whitespace-nowrap z-10">
                          <p className="text-sm text-gray-700 mb-2">Delete this profile?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDeleteConfirming(null)}
                              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDelete(profile.id)}
                              className="px-2 py-1 text-xs bg-red-600 text-white hover:bg-red-700 rounded"
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
