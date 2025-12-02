'use client'

import Link from 'next/link'
import ApiKeysTab from '@/components/settings/api-keys-tab'
import ConnectionProfilesTab from '@/components/settings/connection-profiles-tab'
import ChatSettingsTab from '@/components/settings/chat-settings-tab'
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
import PluginsTab from '@/components/settings/plugins-tab'
import { EntityTabs, Tab } from '@/components/tabs'

const SETTINGS_TABS: Tab[] = [
  {
    id: 'keys',
    label: 'API Keys',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ),
  },
  {
    id: 'profiles',
    label: 'Connection Profiles',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat Settings',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    id: 'image-profiles',
    label: 'Image Profiles',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'embedding-profiles',
    label: 'Embedding Profiles',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    ),
  },
  {
    id: 'plugins',
    label: 'Plugins',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
]

export default function SettingsPage() {
  const renderTabContent = (activeTab: string) => {
    switch (activeTab) {
      case 'keys':
        return <ApiKeysTab />
      case 'profiles':
        return <ConnectionProfilesTab />
      case 'chat':
        return <ChatSettingsTab />
      case 'image-profiles':
        return <ImageProfilesTab />
      case 'embedding-profiles':
        return <EmbeddingProfilesTab />
      case 'plugins':
        return <PluginsTab />
      default:
        return null
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Manage your API keys, connection profiles, and plugins</p>
      </div>

      {/* Tabs */}
      <EntityTabs tabs={SETTINGS_TABS} defaultTab="keys" persistToUrl={false}>
        {renderTabContent}
      </EntityTabs>

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
