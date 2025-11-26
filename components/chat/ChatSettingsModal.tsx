'use client'

import { useState, useEffect, useRef } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  modelName: string
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

interface ChatSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  currentProfileId?: string
  onSuccess?: () => void
}

export default function ChatSettingsModal({
  isOpen,
  onClose,
  chatId,
  currentProfileId,
  onSuccess,
}: Readonly<ChatSettingsModalProps>) {
  const modalRef = useRef<HTMLDivElement>(null)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState(currentProfileId || '')
  const [selectedImageProfileId, setSelectedImageProfileId] = useState('')

  useEffect(() => {
    if (isOpen) {
      setSelectedProfileId(currentProfileId || '')
      fetchProfiles()
    }
  }, [isOpen, currentProfileId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      const [profilesRes, imageProfilesRes] = await Promise.all([
        fetch('/api/profiles'),
        fetch('/api/image-profiles'),
      ])

      if (profilesRes.ok) {
        const data = await profilesRes.json()
        setConnectionProfiles(data)
      }

      if (imageProfilesRes.ok) {
        const data = await imageProfilesRes.json()
        setImageProfiles(data)
      }
    } catch (error) {
      console.error('Failed to fetch profiles:', error)
      showErrorToast('Failed to load profiles')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      const updateData: Record<string, any> = {}
      if (selectedProfileId) {
        updateData.connectionProfileId = selectedProfileId
      }
      if (selectedImageProfileId) {
        updateData.imageProfileId = selectedImageProfileId
      }

      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (!res.ok) throw new Error('Failed to update chat settings')
      showSuccessToast('Chat settings updated')
      onSuccess?.()
      onClose()
    } catch (error) {
      console.error('Failed to save settings:', error)
      showErrorToast('Failed to save chat settings')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 w-full max-w-md max-h-96 overflow-y-auto"
      >
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Chat Settings</h2>

        {/* Connection Profile Selection */}
        <div className="mb-6">
          <label htmlFor="chat-provider" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Chat Provider
          </label>
          <select
            id="chat-provider"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-gray-100 dark:disabled:bg-slate-600"
          >
            <option value="">Select a provider...</option>
            {connectionProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.modelName})
              </option>
            ))}
          </select>
        </div>

        {/* Image Profile Selection */}
        <div className="mb-6">
          <label htmlFor="image-provider" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Image Provider (Optional)
          </label>
          <select
            id="image-provider"
            value={selectedImageProfileId}
            onChange={(e) => setSelectedImageProfileId(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:bg-gray-100 dark:disabled:bg-slate-600"
          >
            <option value="">None</option>
            {imageProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.provider})
              </option>
            ))}
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 disabled:bg-gray-100 dark:disabled:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 transition-colors"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
