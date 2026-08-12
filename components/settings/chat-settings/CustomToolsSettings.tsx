'use client'

import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { type ChatSettings, DEFAULT_CUSTOM_TOOLS } from './types'

export interface CustomToolsSettingsProps {
  settings: ChatSettings
  saving: boolean
  onChange: (value: boolean) => Promise<void>
}

/**
 * CustomToolsSettings Component
 * Controls whether Pascal offers his custom pseudo-tools to models
 */
export function CustomToolsSettings({
  settings,
  saving,
  onChange,
}: CustomToolsSettingsProps) {
  const enabled = settings.customTools ?? DEFAULT_CUSTOM_TOOLS
  const workspace = useWorkspaceOptional()
  const router = useRouter()

  // Authoring while the toggle is off is legitimate — the Workbench link stays
  // visible either way.
  const openWorkbench = () => {
    if (workspace) workspace.openTab('custom-tools')
    else router.push('/custom-tools')
  }

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
            Custom tools
          </div>
          <div className="qt-text-small mt-1">
            Permits Pascal to lay your own contrivances upon the baize, where any model at the
            table may reach for one of its own accord, and posts the little button in the
            composer&apos;s gutter for when you&apos;d rather call the play yourself. Unchecked,
            the croupier sweeps the lot out of sight: no model is offered them, the gutter button
            retires, and your contraptions wait — undisturbed and entirely intact — until you
            see fit to invite them back.
          </div>
          <button
            type="button"
            className="qt-button qt-button-secondary qt-button-sm mt-2"
            onClick={(e) => {
              e.preventDefault()
              openWorkbench()
            }}
          >
            <Icon name="wrench" className="w-3.5 h-3.5" />
            Open Pascal&rsquo;s Workbench
          </button>
        </div>
      </label>
    </div>
  )
}
