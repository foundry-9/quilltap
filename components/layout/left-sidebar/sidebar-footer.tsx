'use client'

/**
 * Sidebar Footer
 *
 * Footer area with Foundry link, themes, quick-hide, and profile.
 * Sidebar is always collapsed — all items use centered icon styling.
 *
 * @module components/layout/left-sidebar/sidebar-footer
 */

import { useState, useRef, useCallback } from 'react'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { useHasDangerousChats } from '@/components/hooks/use-has-dangerous-chats'
import { useTheme } from '@/components/providers/theme-provider'
import { ProfileMenu } from './profile-menu'
import { NavUserMenuThemeContent } from '@/components/dashboard/nav-user-menu-theme'
import { NavUserMenuQuickHideContent, QuickHideIcon } from '@/components/dashboard/nav-user-menu-quick-hide'
import { useHelpChatOptional } from '@/components/providers/help-chat-provider'
import { useBrahmaConsoleOptional } from '@/components/providers/brahma-console-provider'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { standaloneDocKey, type DocumentStandaloneTabPayload } from '@/lib/workspace/types'
import { Icon } from '@/components/ui/icon'

// Lazy-load the picker: the sidebar is on every page, and the modal (with its
// file browser) is only needed once the Document Mode button is pressed.
const DocumentPickerModal = dynamic(
  () => import('@/app/salon/[id]/components/DocumentPickerModal'),
  { ssr: false },
)

// Match a UUID immediately following /salon/. If the user is reading a chat,
// the sidebar's Wardrobe button should pass that chat id along so the dialog
// can show Wearing now / Wear this against the right scope.
const SALON_CHAT_PATH_RE = /^\/salon\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/

interface SalonParticipantLite {
  id: string
  controlledBy?: string | null
  displayOrder?: number | null
  character?: { id?: string | null } | null
}

interface MessageLite {
  role?: string | null
  participantId?: string | null
  createdAt?: string | null
}

/**
 * Resolve the wardrobe dialog's default character for a chat. Priority:
 *   1. Most recent assistant message authored by a non-user-controlled participant.
 *   2. First non-user-controlled CHARACTER participant in chat order.
 *   3. null — caller should let the dialog fall back to alphabetical first.
 */
async function resolveDefaultCharacterForChat(
  chatId: string,
): Promise<string | null> {
  try {
    const [chatRes, msgRes] = await Promise.all([
      fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' }),
      fetch(`/api/v1/messages?chatId=${chatId}`, { cache: 'no-store' }),
    ])
    if (!chatRes.ok) return null
    const chatData = (await chatRes.json()) as {
      chat?: { participants?: SalonParticipantLite[] }
    }
    const participants = chatData.chat?.participants ?? []
    const eligible = participants.filter(
      (p) => p.controlledBy !== 'user' && p.character?.id,
    )
    if (eligible.length === 0) return null
    const eligibleIds = new Set(eligible.map((p) => p.character!.id!))

    // Priority 1: most recent assistant message attribution
    if (msgRes.ok) {
      const msgData = (await msgRes.json()) as { messages?: MessageLite[] }
      const messages = msgData.messages ?? []
      // Scan from the end — messages are returned in chronological order.
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role !== 'assistant' || !m.participantId) continue
        const p = eligible.find((pp) => pp.id === m.participantId)
        const cid = p?.character?.id
        if (cid && eligibleIds.has(cid)) return cid
      }
    }

    // Priority 2: first non-user-controlled participant in chat order
    const sortedByOrder = [...eligible].sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
    )
    return sortedByOrder[0]?.character?.id ?? null
  } catch {
    return null
  }
}

type PopoutMenu = 'themes' | 'quickHide' | null

export function SidebarFooter() {
  const quickHide = useQuickHide()
  const { hasDangerousChats } = useHasDangerousChats()
  const theme = useTheme()
  const helpChat = useHelpChatOptional()
  const brahmaConsole = useBrahmaConsoleOptional()
  const wardrobeDialog = useWardrobeDialogOptional()
  const pathname = usePathname()
  // Inside the workspace, the Brahma Console and the rail Wardrobe open as
  // their own tabs (per spec) rather than dialogs. Elsewhere they stay dialogs.
  const workspace = useWorkspaceOptional()
  const inWorkspace = Boolean(workspace) && pathname === '/workspace'
  const [openPopout, setOpenPopout] = useState<PopoutMenu>(null)
  const [showDocumentPicker, setShowDocumentPicker] = useState(false)
  const themesRef = useRef<HTMLDivElement>(null)
  const quickHideRef = useRef<HTMLDivElement>(null)

  // Track if component has mounted (for hydration-safe rendering)
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')

  // Close popout when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (openPopout === 'themes' && themesRef.current && !themesRef.current.contains(target)) {
        setOpenPopout(null)
      }
      if (openPopout === 'quickHide' && quickHideRef.current && !quickHideRef.current.contains(target)) {
        setOpenPopout(null)
      }
    }

    if (openPopout) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openPopout])

  // Show quick-hide button if there are tags, dangerous chats exist, or danger filter is active
  const hasQuickHideFeatures = mounted && (quickHide.quickHideTags.length > 0 || quickHide.hideDangerousChats || hasDangerousChats)
  const hasAnyHidden = mounted && (quickHide.hiddenTagIds.size > 0 || quickHide.hideDangerousChats)
  // Check if theme selector should be shown in nav
  const showThemes = mounted && theme.showNavThemeSelector

  const handleThemeClick = useCallback(() => {
    setOpenPopout(prev => prev === 'themes' ? null : 'themes')
  }, [])

  const handleQuickHideClick = useCallback(() => {
    setOpenPopout(prev => prev === 'quickHide' ? null : 'quickHide')
  }, [])

  const handleThemeSelected = useCallback(() => {
    setOpenPopout(null)
  }, [])

  // Open the picked document as a standalone (chat-less) Document Mode tab.
  // No conversation is attached, so nothing is announced when it's edited.
  const handleSelectDocument = useCallback((params: {
    filePath?: string
    title?: string
    scope?: 'project' | 'document_store' | 'general'
    mountPoint?: string
    targetFolder?: string
  }) => {
    setShowDocumentPicker(false)
    // The standalone surface has no project context; `project` can't arrive
    // from a chat-less picker, but map it defensively.
    const scope: DocumentStandaloneTabPayload['scope'] =
      params.scope === 'document_store' ? 'document_store' : 'general'

    if (inWorkspace) {
      const payload: DocumentStandaloneTabPayload = {
        docKey: standaloneDocKey(scope, params.mountPoint ?? null, params.filePath),
        scope,
        mountPoint: params.mountPoint ?? null,
        filePath: params.filePath,
        targetFolder: params.targetFolder,
        displayTitle: params.title,
      }
      const title = params.filePath?.split('/').pop() || params.title || 'New Document'
      workspace!.openTab('document-standalone', payload, { title })
      return
    }

    // Legacy shell: funnel into the workspace with an `?open=` intent, which
    // mints the tab (and its docKey) on arrival.
    const sp = new URLSearchParams({ open: 'document-standalone', scope })
    if (params.mountPoint) sp.set('mountPoint', params.mountPoint)
    if (params.filePath) sp.set('filePath', params.filePath)
    if (params.targetFolder) sp.set('targetFolder', params.targetFolder)
    window.location.href = `/workspace?${sp.toString()}`
  }, [inWorkspace, workspace])

  return (
    <div className="qt-left-sidebar-footer">
      <div className="qt-left-sidebar-footer-actions">
        {helpChat && (
          <button
            type="button"
            onClick={helpChat.openHelpChat}
            disabled={!helpChat.isEligible && !helpChat.eligibilityLoading}
            className={`qt-left-sidebar-item justify-center px-0 ${!helpChat.isEligible && !helpChat.eligibilityLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
            title={helpChat.isEligible ? 'Help' : 'Help (requires a help-enabled character with a tool-capable connection)'}
          >
            <Icon name="help" className="qt-left-sidebar-item-icon w-7 h-7" />
          </button>
        )}
        {brahmaConsole && (
          <button
            type="button"
            onClick={() => {
              if (inWorkspace) workspace!.openTab('brahma')
              else brahmaConsole.openConsole()
            }}
            disabled={!brahmaConsole.isEligible}
            className={`qt-left-sidebar-item justify-center px-0 ${!brahmaConsole.isEligible ? 'opacity-40 cursor-not-allowed' : ''}`}
            title={brahmaConsole.isEligible ? 'Brahma Console' : 'Brahma Console (requires a connection profile)'}
          >
            <Icon name="brahma-console" className="qt-left-sidebar-item-icon w-7 h-7" />
          </button>
        )}
        {wardrobeDialog && (
          <button
            type="button"
            onClick={async () => {
              // In the workspace the rail Wardrobe is a browse/edit tab (no chat
              // scope — that path is the in-chat participant card's dialog).
              if (inWorkspace) {
                workspace!.openTab('wardrobe')
                return
              }
              const chatMatch = pathname?.match(SALON_CHAT_PATH_RE)
              if (!chatMatch) {
                wardrobeDialog.open()
                return
              }
              const chatId = chatMatch[1]
              const characterId = await resolveDefaultCharacterForChat(chatId)
              wardrobeDialog.open(
                characterId ? { chatId, characterId } : { chatId },
              )
            }}
            className="qt-left-sidebar-item justify-center px-0"
            title="Wardrobe"
          >
            <Icon name="wardrobe" className="qt-left-sidebar-item-icon w-7 h-7" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowDocumentPicker(true)}
          className="qt-left-sidebar-item justify-center px-0"
          title="Document Mode"
        >
          <Icon name="file-plus" className="qt-left-sidebar-item-icon w-7 h-7" />
        </button>

        <a
          href="/settings"
          className="qt-left-sidebar-item justify-center px-0"
          title="Settings"
        >
          <Icon name="settings" className="qt-left-sidebar-item-icon w-7 h-7" />
        </a>

        {showThemes && (
          <div ref={themesRef} className="relative">
            <button
              type="button"
              onClick={handleThemeClick}
              className={`qt-left-sidebar-item w-full justify-center px-0 ${openPopout === 'themes' ? 'qt-bg-primary/10' : ''}`}
              title="Themes"
            >
              <Icon name="themes" className="qt-left-sidebar-item-icon w-7 h-7" />
            </button>
            {openPopout === 'themes' && (
              <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border qt-border-default rounded-lg qt-shadow-lg z-50">
                <NavUserMenuThemeContent onThemeSelected={handleThemeSelected} />
              </div>
            )}
          </div>
        )}

        {hasQuickHideFeatures && (
          <div ref={quickHideRef} className="relative">
            <button
              type="button"
              onClick={handleQuickHideClick}
              className={`qt-left-sidebar-item w-full justify-center px-0 ${openPopout === 'quickHide' ? 'qt-bg-primary/10' : ''}`}
              title={hasAnyHidden ? 'Show' : 'Hide'}
            >
              <QuickHideIcon hasHidden={hasAnyHidden} className="qt-left-sidebar-item-icon w-7 h-7" />
            </button>
            {openPopout === 'quickHide' && (
              <div className="absolute bottom-full left-0 mb-1 w-56 bg-popover border qt-border-default rounded-lg qt-shadow-lg z-50">
                <NavUserMenuQuickHideContent />
              </div>
            )}
          </div>
        )}
      </div>

      <ProfileMenu />

      {/* Standalone Document Mode picker — chatId null means "look everywhere"
          and no conversation is notified of edits. */}
      {showDocumentPicker && (
        <DocumentPickerModal
          isOpen={showDocumentPicker}
          onClose={() => setShowDocumentPicker(false)}
          chatId={null}
          onSelectDocument={handleSelectDocument}
        />
      )}
    </div>
  )
}
