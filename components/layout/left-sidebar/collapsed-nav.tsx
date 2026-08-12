'use client'

/**
 * Collapsed Navigation
 *
 * Navigation links shown in the always-collapsed sidebar.
 * Each item is a direct Link to the corresponding view-all page.
 *
 * @module components/layout/left-sidebar/collapsed-nav
 */

import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icons/icon-registry'
import { useWorkspaceLink } from '@/components/workspace/useWorkspaceLink'

interface NavItem {
  id: string
  label: string
  tooltip: string
  href: string
  icon: IconName
}

const navItems: NavItem[] = [
  { id: 'projects', label: 'Projects', tooltip: 'View all projects', href: '/prospero', icon: 'projects' },
  { id: 'files', label: 'Files', tooltip: 'View all files', href: '/files', icon: 'files' },
  { id: 'scriptorium', label: 'The Scriptorium', tooltip: 'View document stores', href: '/scriptorium', icon: 'scriptorium' },
  { id: 'characters', label: 'Characters', tooltip: 'View all characters', href: '/aurora', icon: 'characters' },
  { id: 'photos', label: 'My Photos', tooltip: "Your saved photo gallery", href: '/photos', icon: 'photos' },
  { id: 'scenarios', label: 'Scenarios', tooltip: 'Manage general scenarios', href: '/scenarios', icon: 'scenarios' },
  { id: 'custom-tools', label: "Pascal's Workbench", tooltip: 'Build and prove custom tools', href: '/custom-tools', icon: 'wrench' },
  { id: 'chats', label: 'Chats', tooltip: 'View all chats', href: '/salon', icon: 'chat' },
]

export function CollapsedNav() {
  // Inside the tabbed workspace, a rail click opens/focuses a tab in the focused
  // pane instead of navigating (which would unmount the workspace). On the
  // legacy shell there is no workspace store, so the plain links navigate as
  // before. The `href` is kept for middle-click / open-in-new-tab and the
  // legacy path.
  const openInWorkspace = useWorkspaceLink()
  return (
    <nav className="qt-collapsed-nav" aria-label="Quick navigation">
      {/* Plain <a> tags — no Link/router.push to avoid startTransition stall on chat page */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        onClick={(e) => openInWorkspace('/', e)}
        className="qt-collapsed-nav-button"
        title="Home"
        aria-label="Home"
      >
        <Icon name="brand" className="w-8 h-8" />
      </a>
      {navItems.map((item) => (
        <a
          key={item.id}
          href={item.href}
          onClick={(e) => openInWorkspace(item.href, e)}
          className="qt-collapsed-nav-button"
          title={item.tooltip}
          aria-label={item.tooltip}
        >
          <Icon name={item.icon} className="w-7 h-7" />
        </a>
      ))}
    </nav>
  )
}
