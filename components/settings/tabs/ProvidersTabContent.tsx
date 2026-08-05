'use client'

import Link from 'next/link'
import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import ApiKeysTab from '@/components/settings/api-keys-tab'
import ConnectionProfilesTab from '@/components/settings/connection-profiles-tab'
import { CheapLLMSettings } from '@/components/settings/chat-settings/CheapLLMSettings'
import { CapabilitiesReportCard } from '@/components/tools/capabilities-report-card'
import { useSettingsSection } from './useSettingsSection'
import { Icon } from '@/components/ui/icon'

export function ProvidersTabContent() {
  const info = useSubsystemInfo('forge')
  const activeSection = useSettingsSection()
  const {
    settings,
    loading,
    saving,
    connectionProfiles,
    embeddingProfiles,
    loadingProfiles,
    handleCheapLLMUpdate,
  } = useChatSettingsContext()

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <Link
          href="/settings/wizard"
          className="qt-card block p-4 hover:qt-bg-surface-alt transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">AI Stack Setup Wizard</h3>
              <p className="qt-text-small qt-text-muted mt-1">
                Re-run the guided setup to configure providers, API keys, models, and profiles all in one go.
              </p>
            </div>
            <Icon name="chevron-right" className="w-5 h-5 qt-text-muted flex-shrink-0" />
          </div>
        </Link>

        <CollapsibleCard title="API Keys" description="Manage API keys for LLM providers" sectionId="api-keys" forceOpen={activeSection === 'api-keys'}>
          <ApiKeysTab />
        </CollapsibleCard>

        <CollapsibleCard title="Connection Profiles" description="Configure LLM connection profiles" sectionId="connection-profiles" forceOpen={activeSection === 'connection-profiles'}>
          <ConnectionProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Cheap LLM Settings" description="Configure the lightweight LLM used for background tasks" sectionId="cheap-llm" forceOpen={activeSection === 'cheap-llm'}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="qt-text-secondary">Loading settings...</div>
            </div>
          ) : settings ? (
            <CheapLLMSettings
              settings={settings}
              saving={saving}
              loadingProfiles={loadingProfiles}
              connectionProfiles={connectionProfiles}
              onUpdate={handleCheapLLMUpdate}
            />
          ) : (
            <div className="qt-alert-error">Failed to load settings</div>
          )}
        </CollapsibleCard>

        {/* `sectionId` stays `capabilities-report`: it is the deep-link anchor
            (?section=…) that the help docs and old bookmarks point at. */}
        <CollapsibleCard title="The Almanack (System Report)" description="A compendium of the whole establishment — configuration, contents and condition" sectionId="capabilities-report" forceOpen={activeSection === 'capabilities-report'}>
          <CapabilitiesReportCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
