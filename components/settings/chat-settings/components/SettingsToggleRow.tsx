'use client'

/**
 * SettingsToggleRow
 *
 * The one checkbox-plus-copy row the composer toggles share: heading beside
 * the box, description underneath. Children are the description body.
 */

import type { ReactNode } from 'react'

export interface SettingsToggleRowProps {
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void | Promise<void>
  heading: ReactNode
  children: ReactNode
}

export function SettingsToggleRow({
  checked,
  disabled,
  onChange,
  heading,
  children,
}: SettingsToggleRowProps) {
  return (
    <div>
      <label className="qt-settings-toggle-row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="qt-checkbox mt-1"
        />
        <div className="flex-1">
          <div className="qt-settings-section-heading">
            {heading}
          </div>
          <div className="qt-text-small mt-1">
            {children}
          </div>
        </div>
      </label>
    </div>
  )
}
