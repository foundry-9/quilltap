'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ApiKeysTab from '@/components/settings/api-keys-tab'
import ConnectionProfilesTab from '@/components/settings/connection-profiles-tab'
import ChatSettingsTab from '@/components/settings/chat-settings-tab'
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'keys' | 'profiles' | 'chat' | 'image-profiles' | 'embedding-profiles'>('keys')

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Manage your API keys and connection profiles</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-slate-700 mb-6">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('keys')}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'keys'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            API Keys
          </button>
          <button
            onClick={() => setActiveTab('profiles')}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'profiles'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Connection Profiles
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'chat'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Chat Settings
          </button>
          <button
            onClick={() => setActiveTab('image-profiles')}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'image-profiles'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Image Generation Profiles
          </button>
          <button
            onClick={() => setActiveTab('embedding-profiles')}
            className={`px-4 py-2 border-b-2 font-medium transition-colors ${
              activeTab === 'embedding-profiles'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Embedding Profiles
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'keys' && <ApiKeysTab />}
        {activeTab === 'profiles' && <ConnectionProfilesTab />}
        {activeTab === 'chat' && <ChatSettingsTab />}
        {activeTab === 'image-profiles' && <ImageProfilesTab />}
        {activeTab === 'embedding-profiles' && <EmbeddingProfilesTab />}
      </div>

      {/* Back Link */}
      <div className="mt-8">
        <Link
          href="/dashboard"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
