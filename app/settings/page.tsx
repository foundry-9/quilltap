/**
 * Settings Route (The Foundry)
 *
 * Thin wrapper around {@link SettingsView}. When the tabbed workspace is
 * enabled, redirects into it preserving the `?tab=`/`&section=` deep-link.
 * Otherwise renders the view, which reads those params off the URL itself.
 * See `docs/developer/features/tabbed-workspace.md`.
 */

import { SettingsView } from './SettingsView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; section?: string }>
}) {
  const { tab, section } = await searchParams
  redirectToWorkspaceTab('settings', { tab, section })
  return <SettingsView />
}
