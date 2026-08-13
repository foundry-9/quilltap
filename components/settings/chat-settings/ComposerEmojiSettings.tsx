'use client'

import type { ChatSettings } from './types'

export interface ComposerEmojiSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function ComposerEmojiSettings({
  settings,
  saving,
  onChange,
}: ComposerEmojiSettingsProps) {
  const enabled = settings.composerEmoji ?? true

  return (
    <div>
      <label className="qt-settings-toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          disabled={saving}
          className="qt-checkbox mt-1"
        />
        <div className="flex-1">
          <div className="qt-settings-section-heading">
            Emoji shortcuts
          </div>
          <div className="qt-text-small mt-1">
            Type <code>:</code> and at least two letters to search emoji by name. The
            toolbar&apos;s emoji button works either way.
          </div>
        </div>
      </label>
    </div>
  )
}
