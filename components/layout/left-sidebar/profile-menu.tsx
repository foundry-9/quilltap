'use client'

/**
 * Profile Menu
 *
 * User profile dropdown for the sidebar footer.
 *
 * @module components/layout/left-sidebar/profile-menu
 */

import { useState, useRef } from 'react'
import { useSession } from '@/components/providers/session-provider'
import { useSidebar } from '@/components/providers/sidebar-provider'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { Icon } from '@/components/ui/icon'

export function ProfileMenu() {
  const { data: session } = useSession()
  const { isCollapsed } = useSidebar()
  // Keep-alive-safe: inside the workspace this opens Profile/About as tabs in
  // place; elsewhere it falls back to a normal route push.
  const navigate = useWorkspaceNavigate()
  const menuRef = useRef<HTMLDivElement>(null)

  const [isOpen, setIsOpen] = useState(false)

  const user = session?.user

  // Close menu when clicking outside
  useClickOutside(menuRef, () => setIsOpen(false), {
    enabled: isOpen,
    onEscape: () => setIsOpen(false),
  })

  const handleToggle = () => {
    setIsOpen(!isOpen)
  }

  const handleProfileClick = () => {
    setIsOpen(false)
    navigate('/profile')
  }

  const handleAboutClick = () => {
    setIsOpen(false)
    navigate('/about')
  }

  if (!user) {
    return null
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile trigger */}
      <button
        type="button"
        onClick={handleToggle}
        className="qt-left-sidebar-profile w-full"
        title={isCollapsed ? 'Profile' : undefined}
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {user.image ? (
          <img
            src={user.image}
            alt={user.name || 'User'}
            className="qt-left-sidebar-profile-avatar object-cover"
          />
        ) : (
          <div className="qt-left-sidebar-profile-avatar flex items-center justify-center">
            <Icon name="profile" className="w-4 h-4 qt-text-secondary" />
          </div>
        )}

        {!isCollapsed && (
          <>
            <div className="qt-left-sidebar-profile-info">
              <span className="qt-left-sidebar-profile-name">{user.name || 'User'}</span>
              <span className="qt-left-sidebar-profile-email">{user.email}</span>
            </div>
            {/* chevron-down base glyph; rotate 180° (points up) while the menu is open */}
            <Icon name="chevron-down" className={`w-4 h-4 qt-text-secondary ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className={`absolute bottom-full mb-2 bg-popover border qt-border-default rounded-lg qt-shadow-lg overflow-hidden z-50 ${isCollapsed ? 'left-0 w-48' : 'left-0 right-0'}`}>
          <div className="p-2 space-y-1">
            {/* Profile link */}
            <button
              type="button"
              onClick={handleProfileClick}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:qt-bg-muted transition-colors"
            >
              <Icon name="profile" className="w-4 h-4" />
              Profile
            </button>

            {/* About link */}
            <button
              type="button"
              onClick={handleAboutClick}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md hover:qt-bg-muted transition-colors"
            >
              <Icon name="info" className="w-4 h-4" />
              About
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
