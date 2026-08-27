'use client'

import type { ChatSettings } from './types'
import { SettingsToggleRow } from './components/SettingsToggleRow'

export interface ComposerUnicodeSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

export function ComposerUnicodeSettings({
  settings,
  saving,
  onChange,
}: ComposerUnicodeSettingsProps) {
  const enabled = settings.composerUnicode ?? true

  return (
    <SettingsToggleRow
      checked={enabled}
      disabled={saving}
      onChange={onChange}
      heading="Symbol shortcuts"
    >
      Type <code>\</code> and a LaTeX name (<code>\to</code>, <code>\phi</code>) or a code
      point (<code>\u2192</code>) to insert a symbol. Nothing fires inside a formula, so{' '}
      <code>$$\phi$$</code> stays as you typed it. The toolbar&apos;s <code>Ω</code> button
      works either way.
    </SettingsToggleRow>
  )
}
