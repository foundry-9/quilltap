'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import type { ChatSettings, CheapLLMSettings as CheapLLMSettingsType, ConnectionProfile, CheapLLMStrategy, EmbeddingProvider } from './types'

export interface CheapLLMSettingsProps {
  settings: ChatSettings
  saving: boolean
  loadingProfiles: boolean
  connectionProfiles: ConnectionProfile[]
  onUpdate: (updates: Partial<CheapLLMSettingsType>) => Promise<void>
}

/**
 * CheapLLMSettings Component
 * Manages configuration for cheap LLM usage for background tasks
 */
export function CheapLLMSettings({
  settings,
  saving,
  loadingProfiles,
  connectionProfiles,
  onUpdate,
}: CheapLLMSettingsProps) {
  return (
    <SettingsCard
      title="Cheap LLM Settings"
      subtitle="Configure which LLM to use for background tasks like memory extraction and summarization"
    >
      <div className="space-y-4">
        {/* Strategy Selection */}
        <div>
          <label className="block qt-text-label mb-2">
            Strategy
          </label>
          <div className="space-y-2">
            {[
              { value: 'USER_DEFINED' as CheapLLMStrategy, label: 'User Defined', description: 'Use the profile you select below' },
              { value: 'PROVIDER_CHEAPEST' as CheapLLMStrategy, label: 'Provider Cheapest', description: 'Automatically use the cheapest model from current provider' },
              { value: 'LOCAL_FIRST' as CheapLLMStrategy, label: 'Local First', description: 'Prefer local/Ollama models if available' },
            ].map((strategy) => (
              <label
                key={strategy.value}
                className="flex items-start gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors"
              >
                <input
                  type="radio"
                  name="cheapLLMStrategy"
                  value={strategy.value}
                  checked={settings?.cheapLLMSettings.strategy === strategy.value}
                  onChange={() => onUpdate({ strategy: strategy.value })}
                  disabled={saving}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{strategy.label}</div>
                  <div className="qt-text-xs">
                    {strategy.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* User Defined Profile Selection */}
        {settings?.cheapLLMSettings.strategy === 'USER_DEFINED' && (
          <div>
            <label className="block qt-text-label mb-2">
              Select Cheap LLM Profile
            </label>
            <select
              value={settings?.cheapLLMSettings.userDefinedProfileId || ''}
              onChange={(e) => onUpdate({ userDefinedProfileId: e.target.value || null })}
              disabled={saving || loadingProfiles}
              className="qt-select"
            >
              <option value="">Select a profile...</option>
              {connectionProfiles.map((profile) => {
                const hasApiKey = Boolean(profile.apiKey)
                return (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                  </option>
                )
              })}
            </select>
            {connectionProfiles.length === 0 && !loadingProfiles && (
              <p className="mt-1 qt-text-xs qt-text-warning">
                No connection profiles found. Create one in the Connection Profiles tab first.
              </p>
            )}
          </div>
        )}

        {/* Default Cheap Profile (Global Override) */}
        <div>
          <label className="block qt-text-label mb-2">
            Global Default Cheap LLM (Optional Override)
          </label>
          <p className="qt-text-xs mb-2">
            If set, this profile will always be used regardless of strategy
          </p>
          <select
            value={settings?.cheapLLMSettings.defaultCheapProfileId || ''}
            onChange={(e) => onUpdate({ defaultCheapProfileId: e.target.value || null })}
            disabled={saving || loadingProfiles}
            className="qt-select"
          >
            <option value="">Not set</option>
            {connectionProfiles.map((profile) => {
              const hasApiKey = Boolean(profile.apiKey)
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName}){!hasApiKey ? ' ⚠️ No API Key' : ''}
                </option>
              )
            })}
          </select>
        </div>

        {/* Fallback to Local */}
        <label className="flex items-center gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={settings?.cheapLLMSettings.fallbackToLocal ?? true}
            onChange={(e) => onUpdate({ fallbackToLocal: e.target.checked })}
            disabled={saving}
            className="qt-checkbox"
          />
          <div className="flex-1">
            <div className="font-medium text-sm">Fallback to Local</div>
            <div className="qt-text-xs">
              Use local Ollama models as fallback if configured strategy is unavailable
            </div>
          </div>
        </label>

        {/* Allow a drafted stand-in for profile-less cheap routes */}
        <label className="flex items-center gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={settings?.cheapLLMSettings.allowCheapFallback ?? false}
            onChange={(e) => onUpdate({ allowCheapFallback: e.target.checked })}
            disabled={saving}
            className="qt-checkbox"
          />
          <div className="flex-1">
            <div className="font-medium text-sm">Allow a Similar-Tier Stand-In</div>
            <div className="qt-text-xs">
              When the cheap route fails and no connection profile stands behind it — a
              local model, or a route assembled on the spot — permit one understudy to be
              drafted from your inexpensive connections. Routes that <em>do</em> have a
              profile take their understudy from that profile&rsquo;s own Fallback
              section instead.
            </div>
          </div>
        </label>

        {/* Embedding Provider */}
        <div>
          <label className="block qt-text-label mb-2">
            Embedding Provider
          </label>
          <div className="space-y-2">
            {[
              { value: 'SAME_PROVIDER' as EmbeddingProvider, label: 'Same Provider', description: 'Use embeddings from the same provider as the cheap LLM' },
              { value: 'OPENAI' as EmbeddingProvider, label: 'OpenAI', description: 'Use OpenAI for embeddings' },
              { value: 'LOCAL' as EmbeddingProvider, label: 'Local', description: 'Use local Ollama embeddings' },
            ].map((provider) => (
              <label
                key={provider.value}
                className="flex items-start gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer transition-colors"
              >
                <input
                  type="radio"
                  name="embeddingProvider"
                  value={provider.value}
                  checked={settings?.cheapLLMSettings.embeddingProvider === provider.value}
                  onChange={() => onUpdate({ embeddingProvider: provider.value })}
                  disabled={saving}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{provider.label}</div>
                  <div className="qt-text-xs">
                    {provider.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Embedding profile is managed globally via Embedding Profiles — the default profile is always used */}
      </div>
    </SettingsCard>
  )
}
