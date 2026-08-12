/**
 * Provider Setup Wizard Route — thin wrapper around {@link SettingsWizardView}.
 * When the tabbed workspace is enabled, redirects into it; otherwise renders the
 * view. See `docs/developer/features/tabbed-workspace.md`.
 */

import { SettingsWizardView } from './SettingsWizardView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function SettingsWizardPage() {
  redirectToWorkspaceTab('settings-wizard')
  return <SettingsWizardView />
}
