'use client'

import type { ChatSettings } from './types'
import { SettingsToggleRow } from './components/SettingsToggleRow'

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
    <SettingsToggleRow
      checked={enabled}
      disabled={saving}
      onChange={onChange}
      heading="Emoji shortcuts"
    >
      Type <code>:</code> and at least two letters to search emoji by name. The
      toolbar&apos;s emoji button works either way.
    </SettingsToggleRow>
  )
}
