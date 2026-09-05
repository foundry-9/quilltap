'use client'

import type { ChatSettings } from './types'
import { SettingsToggleRow } from './components/SettingsToggleRow'

export interface ComposerSpellcheckSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function ComposerSpellcheckSettings({
  settings,
  saving,
  onChange,
}: ComposerSpellcheckSettingsProps) {
  const enabled = settings.composerSpellcheck ?? true

  return (
    <SettingsToggleRow
      checked={enabled}
      disabled={saving}
      onChange={onChange}
      heading="Spellcheck in the composer"
    >
      Underlines misspelled words in the Salon composer and the Document Mode editor.
      In the Quilltap desktop app, right-click a flagged word to see suggestions and
      add it to your dictionary. Source-mode editors (raw Markdown, plain text) stay
      unsquiggled regardless.
    </SettingsToggleRow>
  )
}
