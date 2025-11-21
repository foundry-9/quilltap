'use client'

import { useState, useEffect } from 'react'

type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'

interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  createdAt: string
  updatedAt: string
}

const AVATAR_MODES: { value: AvatarDisplayMode; label: string; description: string }[] = [
  {
    value: 'ALWAYS',
    label: 'Always Show Avatars',
    description: 'Display avatar for every message (character on left, user on right)',
  },
  {
    value: 'GROUP_ONLY',
    label: 'Group Chats Only',
    description: 'Only show avatars in group chats (will be implemented in the future)',
  },
  {
    value: 'NEVER',
    label: 'Never Show Avatars',
    description: 'Hide avatars in all chats',
  },
]

const AVATAR_STYLES: { value: AvatarDisplayStyle; label: string; description: string; preview: string }[] = [
  {
    value: 'CIRCULAR',
    label: 'Circular',
    description: 'Display avatars as circles',
    preview: '⭕',
  },
  {
    value: 'RECTANGULAR',
    label: 'Rectangular (5:4)',
    description: 'Display avatars as rectangles with 5:4 aspect ratio',
    preview: '▭',
  },
]

export default function ChatSettingsTab() {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleAvatarModeChange = async (mode: AvatarDisplayMode) => {
    if (!settings) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayMode: mode }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update chat settings')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarStyleChange = async (style: AvatarDisplayStyle) => {
    if (!settings) return

    try {
      setSaving(true)
      setError(null)
      setSuccess(false)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayStyle: style }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update chat settings')
      }

      const updatedSettings = await res.json()
      setSettings(updatedSettings)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-600 dark:text-gray-400">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-red-600 dark:text-red-400 py-8">
        Failed to load chat settings
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4 text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4 text-green-800 dark:text-green-200">
          Settings saved successfully
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">Message Avatar Display</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Control how avatars are displayed in chat messages
        </p>

        <div className="space-y-3">
          {AVATAR_MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex items-start gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayMode"
                value={mode.value}
                checked={settings.avatarDisplayMode === mode.value}
                onChange={() => handleAvatarModeChange(mode.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{mode.label}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {mode.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 pt-6">
        <h2 className="text-xl font-semibold mb-4">Avatar Display Style</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Choose how avatars are shaped and displayed throughout the application
        </p>

        <div className="space-y-3">
          {AVATAR_STYLES.map((style) => (
            <label
              key={style.value}
              className="flex items-start gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayStyle"
                value={style.value}
                checked={settings.avatarDisplayStyle === style.value}
                onChange={() => handleAvatarStyleChange(style.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{style.label}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {style.description}
                </div>
              </div>
              <div className="text-3xl">{style.preview}</div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
