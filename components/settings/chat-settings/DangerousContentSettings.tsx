'use client'

import { SettingsCard } from '@/components/ui/SettingsCard'
import type { ChatSettings, ConnectionProfile, ImageProfile, DangerousContentSettings as DangerousContentSettingsType } from './types'

export interface DangerousContentSettingsProps {
  settings: ChatSettings
  saving: boolean
  connectionProfiles: ConnectionProfile[]
  imageProfiles: ImageProfile[]
  loadingProfiles: boolean
  onUpdate: (updates: Partial<DangerousContentSettingsType>) => Promise<void>
  imagePromptProfileId?: string | null
  onImagePromptProfileChange: (profileId: string | null) => Promise<void>
}

const MODE_OPTIONS = [
  {
    value: 'OFF' as const,
    label: 'Off',
    description: 'No content scanning or routing',
  },
  {
    value: 'DETECT_ONLY' as const,
    label: 'Detect Only',
    description: 'Scan and flag content, but do not reroute to uncensored providers',
  },
  {
    value: 'AUTO_ROUTE' as const,
    label: 'Auto-Route',
    description: 'Scan content and automatically route flagged messages to uncensored-compatible providers',
  },
]

const DISPLAY_MODE_OPTIONS = [
  {
    value: 'SHOW' as const,
    label: 'Show',
    description: 'Display flagged content normally with a warning badge',
  },
  {
    value: 'BLUR' as const,
    label: 'Blur',
    description: 'Blur flagged content until clicked to reveal',
  },
  {
    value: 'COLLAPSE' as const,
    label: 'Collapse',
    description: 'Collapse flagged content behind a placeholder',
  },
]

const DEFAULT_SETTINGS: DangerousContentSettingsType = {
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

export function DangerousContentSettings({
  settings,
  saving,
  connectionProfiles,
  imageProfiles,
  loadingProfiles,
  onUpdate,
  imagePromptProfileId,
  onImagePromptProfileChange,
}: DangerousContentSettingsProps) {
  const dangerSettings = settings.dangerousContentSettings ?? DEFAULT_SETTINGS

  const dangerousCompatibleProfiles = connectionProfiles.filter(
    (p) => p.isDangerousCompatible
  )

  const dangerousCompatibleImageProfiles = imageProfiles.filter(
    (p) => p.isDangerousCompatible
  )

  const isEnabled = dangerSettings.mode !== 'OFF'

  return (
    <SettingsCard
      title="Dangerous Content Handling"
      subtitle="Classify and route sensitive content to uncensored-compatible providers"
    >
      <div className="space-y-6">
        {/* Mode Selector */}
        <div className="space-y-2">
          <label className="block font-medium text-foreground">
            Mode
          </label>
          <select
            value={dangerSettings.mode}
            onChange={(e) => onUpdate({ mode: e.target.value as DangerousContentSettingsType['mode'] })}
            disabled={saving}
            className="w-full max-w-xs rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground focus:qt-border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="qt-text-small">
            {MODE_OPTIONS.find((o) => o.value === dangerSettings.mode)?.description}
          </p>
        </div>

        {isEnabled && (
          <>
            {/* Detection Threshold */}
            <div className="space-y-2">
              <label className="block font-medium text-foreground">
                Detection Threshold ({dangerSettings.threshold.toFixed(1)})
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={dangerSettings.threshold}
                onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) })}
                disabled={saving}
                className="qt-range w-full max-w-xs"
              />
              <p className="qt-text-small">
                Lower values are more sensitive (more content flagged). Higher values only flag strongly dangerous content.
              </p>
            </div>

            {/* Scan Toggles */}
            <div className="space-y-3">
              <label className="block font-medium text-foreground">
                What to Scan
              </label>

              <label className="flex items-start gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={dangerSettings.scanTextChat}
                  onChange={(e) => onUpdate({ scanTextChat: e.target.checked })}
                  disabled={saving}
                  className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="text-sm text-foreground">Text Chat Messages</div>
                  <div className="qt-text-small">Classify user messages before sending to the LLM</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={dangerSettings.scanImagePrompts}
                  onChange={(e) => onUpdate({ scanImagePrompts: e.target.checked })}
                  disabled={saving}
                  className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="text-sm text-foreground">Image Prompts</div>
                  <div className="qt-text-small">Classify image generation prompts before expansion</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={dangerSettings.scanImageGeneration}
                  onChange={(e) => onUpdate({ scanImageGeneration: e.target.checked })}
                  disabled={saving}
                  className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="text-sm text-foreground">Image Generation</div>
                  <div className="qt-text-small">Classify the expanded prompt before sending to the image generator</div>
                </div>
              </label>
            </div>

            {/* Uncensored Provider Selection (only for AUTO_ROUTE) */}
            {dangerSettings.mode === 'AUTO_ROUTE' && (
              <div className="space-y-4">
                <label className="block font-medium text-foreground">
                  Uncensored Providers
                </label>

                {/* Text LLM Profile */}
                <div className="space-y-1">
                  <label className="block text-sm text-foreground">
                    Text LLM Profile
                  </label>
                  <select
                    value={dangerSettings.uncensoredTextProfileId || ''}
                    onChange={(e) => onUpdate({ uncensoredTextProfileId: e.target.value || null })}
                    disabled={saving || loadingProfiles}
                    className="qt-select"
                  >
                    <option value="">Auto-detect (scan all profiles)</option>
                    {dangerousCompatibleProfiles.length > 0 ? (
                      dangerousCompatibleProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} ({profile.provider} / {profile.modelName})
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>
                        No uncensored-compatible profiles found
                      </option>
                    )}
                  </select>
                  <p className="qt-text-small">
                    Select a specific profile or let the system scan for uncensored-compatible profiles automatically.
                  </p>
                </div>

                {/* Image Profile */}
                <div className="space-y-1">
                  <label className="block text-sm text-foreground">
                    Image Generation Profile
                  </label>
                  <select
                    value={dangerSettings.uncensoredImageProfileId || ''}
                    onChange={(e) => onUpdate({ uncensoredImageProfileId: e.target.value || null })}
                    disabled={saving || loadingProfiles}
                    className="qt-select"
                  >
                    <option value="">Auto-detect (scan all profiles)</option>
                    {dangerousCompatibleImageProfiles.length > 0 ? (
                      dangerousCompatibleImageProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} ({profile.provider})
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>
                        No uncensored-compatible image profiles found
                      </option>
                    )}
                  </select>
                  <p className="qt-text-small">
                    Select a specific image profile or let the system scan for uncensored-compatible profiles automatically.
                  </p>
                </div>
              </div>
            )}

            {/* Display Settings */}
            <div className="space-y-3">
              <label className="block font-medium text-foreground">
                Display Settings
              </label>

              <div className="space-y-2">
                <label className="block text-sm text-foreground">
                  Flagged Content Display Mode
                </label>
                <select
                  value={dangerSettings.displayMode}
                  onChange={(e) => onUpdate({ displayMode: e.target.value as DangerousContentSettingsType['displayMode'] })}
                  disabled={saving}
                  className="qt-select"
                >
                  {DISPLAY_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="qt-text-small">
                  {DISPLAY_MODE_OPTIONS.find((o) => o.value === dangerSettings.displayMode)?.description}
                </p>
              </div>

              <label className="flex items-start gap-3 p-3 border qt-border-default rounded qt-hover-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={dangerSettings.showWarningBadges}
                  onChange={(e) => onUpdate({ showWarningBadges: e.target.checked })}
                  disabled={saving}
                  className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div className="flex-1">
                  <div className="text-sm text-foreground">Show Warning Badges</div>
                  <div className="qt-text-small">Display category badges on flagged messages</div>
                </div>
              </label>
            </div>

            {/* Custom Classification Prompt */}
            <div className="space-y-2">
              <label className="block font-medium text-foreground">
                Custom Classification Prompt (Optional)
              </label>
              <textarea
                value={dangerSettings.customClassificationPrompt || ''}
                onChange={(e) => onUpdate({ customClassificationPrompt: e.target.value || null })}
                disabled={saving}
                rows={3}
                placeholder="Additional instructions for the content classifier..."
                className="qt-input"
              />
              <p className="qt-text-small">
                Additional instructions appended to the classification prompt. Use this to adjust sensitivity for your use case.
              </p>
            </div>

            {/* Image Prompt Expansion LLM (Uncensored) */}
            <div className="space-y-2">
              <label className="block font-medium text-foreground">
                Image Prompt Expansion LLM (Uncensored - Optional)
              </label>
              <p className="qt-text-small">
                When an image prompt is flagged as dangerous, this profile is used for prompt expansion instead of the standard cheap LLM. Select an uncensored-compatible model that can handle sensitive content.
              </p>
              <select
                value={imagePromptProfileId || ''}
                onChange={(e) => onImagePromptProfileChange(e.target.value || null)}
                disabled={saving || loadingProfiles}
                className="w-full max-w-md rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground focus:qt-border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Use global cheap LLM</option>
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
                <p className="mt-1 qt-text-small qt-text-warning">
                  No connection profiles found. Create one in the Connection Profiles tab first.
                </p>
              )}
            </div>
          </>
        )}

        {/* Warning Box */}
        <div className="qt-alert-warning p-4">
          <h4 className="font-medium text-foreground mb-2">Important Notes</h4>
          <ul className="qt-text-small space-y-1 list-disc list-inside">
            <li>If you have an OpenAI API key configured, the free OpenAI moderation endpoint is used automatically for classification (no token cost)</li>
            <li>Without an OpenAI connection profile, classification falls back to your configured Cheap LLM, adding a small cost per message</li>
            <li>Classification is fail-safe: errors never block your messages</li>
            <li>To use Auto-Route, mark at least one connection profile as &quot;Uncensored-Compatible&quot; in the Connection Profiles settings</li>
            <li>If no uncensored provider is available, flagged messages are sent to your regular provider with a warning</li>
            <li>Some providers may refuse flagged content even with rerouting</li>
          </ul>
        </div>
      </div>
    </SettingsCard>
  )
}
