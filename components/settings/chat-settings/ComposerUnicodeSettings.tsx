'use client'

import type { ChatSettings } from './types'

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
            Symbol shortcuts
          </div>
          <div className="qt-text-small mt-1">
            Type <code>\</code> and a LaTeX name (<code>\to</code>, <code>\phi</code>) or a code
            point (<code>\u2192</code>) to insert a symbol. Nothing fires inside a formula, so{' '}
            <code>$$\phi$$</code> stays as you typed it. The toolbar&apos;s <code>Ω</code> button
            works either way.
          </div>
        </div>
      </label>
    </div>
  )
}
