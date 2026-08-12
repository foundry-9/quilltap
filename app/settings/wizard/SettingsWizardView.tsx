'use client'

import { ProviderWizard } from '@/components/setup-wizard/ProviderWizard'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'

/**
 * Settings re-entry point for the provider setup wizard (reached from
 * Settings → AI Providers). Rendered by the `/settings/wizard` route and as a
 * workspace tab.
 *
 * On finish/cancel it returns the user to Settings. Inside the workspace that
 * means focusing the Settings tab and closing this wizard tab (no navigation,
 * so a streaming Salon in the other pane is untouched); on the legacy route
 * `navigate` falls back to a plain push to `/settings` and `closeSelf` is a
 * no-op.
 */
export function SettingsWizardView() {
  const navigate = useWorkspaceNavigate()
  const closeSelf = useCloseSelfTab()

  const done = () => {
    navigate('/settings')
    closeSelf()
  }

  return <ProviderWizard mode="settings" onComplete={done} onCancel={done} />
}
