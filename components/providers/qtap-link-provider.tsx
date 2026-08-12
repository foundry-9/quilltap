'use client'

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { QtapUriParts } from '@/lib/doc-edit/qtap-uri'
import { openDocumentForChat, resolveDocumentExistsForChat } from '@/app/salon/[id]/hooks/documentModeApi'
import ImageModal from '@/components/chat/ImageModal'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { QtapLinkContext, type QtapTargetKind, type QtapTargetResolution } from '@/components/qtap/QtapLinkContext'
import { showErrorToast, showWarningToast } from '@/lib/toast'
import type { WorkspaceState, WorkspaceTab } from '@/lib/workspace/types'

interface QtapLinkProviderProps {
  children: ReactNode
}

interface ImageViewerState {
  src: string
  filename: string
}

function extractChatIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null
  const match = pathname.match(/^\/salon\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function getChatIdFromTab(tab: WorkspaceTab | undefined): string | null {
  if (!tab || !tab.payload || typeof tab.payload !== 'object') return null
  if (tab.kind !== 'salon' && tab.kind !== 'document' && tab.kind !== 'terminal') return null
  const chatId = (tab.payload as { chatId?: unknown }).chatId
  return typeof chatId === 'string' && chatId.length > 0 ? chatId : null
}

function getWorkspaceChatId(state: WorkspaceState | undefined): string | null {
  if (!state) return null

  const focusedPaneState = state.panes[state.focusedPane] ?? state.panes.left

  const activeIds = [
    focusedPaneState.activeTabId,
    state.panes.left.activeTabId,
    state.panes.right?.activeTabId ?? null,
  ]

  for (const id of activeIds) {
    if (!id) continue
    const chatId = getChatIdFromTab(state.tabs[id])
    if (chatId) return chatId
  }

  for (const pane of [state.panes.left, state.panes.right].filter(Boolean)) {
    for (const id of pane!.order) {
      const chatId = getChatIdFromTab(state.tabs[id])
      if (chatId) return chatId
    }
  }

  return null
}

function buildQtapTargetUrl(chatId: string, parts: QtapUriParts): string {
  const params = new URLSearchParams({
    filePath: parts.path,
    scope: parts.scope,
  })
  if (parts.mountPoint) {
    params.set('mountPoint', parts.mountPoint)
  }
  return `/api/v1/chats/${encodeURIComponent(chatId)}/qtap-target?${params.toString()}`
}

function basename(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

export function QtapLinkProvider({ children }: QtapLinkProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const ws = useWorkspaceOptional()
  const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null)

  const activeChatId = useMemo(
    () => extractChatIdFromPath(pathname) ?? getWorkspaceChatId(ws?.state),
    [pathname, ws?.state],
  )

  const cacheRef = useRef<Map<string, Promise<QtapTargetResolution>>>(new Map())

  const focusChat = useCallback((chatId: string) => {
    if (ws && pathname === '/workspace') {
      ws.openTab('salon', { chatId }, { focus: true })
      return
    }
    if (extractChatIdFromPath(pathname) !== chatId) {
      router.push(`/salon/${encodeURIComponent(chatId)}`)
    }
  }, [pathname, router, ws])

  const resolve = useCallback(async (parts: QtapUriParts): Promise<QtapTargetResolution> => {
    if (!activeChatId) {
      return { exists: false, kind: 'other' }
    }

    const key = `${activeChatId}|${parts.scope}|${parts.mountPoint ?? ''}|${parts.path}`
    const cached = cacheRef.current.get(key)
    if (cached) return cached

    const pending = resolveDocumentExistsForChat(activeChatId, {
      filePath: parts.path,
      scope: parts.scope,
      mountPoint: parts.mountPoint,
    })
      .then((result) => ({ exists: result.exists, kind: result.kind }))
      .catch(() => ({ exists: false, kind: 'other' as QtapTargetKind }))

    cacheRef.current.set(key, pending)
    return pending
  }, [activeChatId])

  const open = useCallback((parts: QtapUriParts, resolution: QtapTargetResolution, href: string) => {
    if (!activeChatId) {
      showWarningToast('Open a Salon first to use qtap:// links.')
      return
    }

    if (resolution.kind === 'image') {
      setImageViewer({
        src: buildQtapTargetUrl(activeChatId, parts),
        filename: basename(parts.path) || href,
      })
      return
    }

    if (resolution.kind === 'other') {
      showWarningToast(`We do not have a way to open ${href} yet.`)
      return
    }

    focusChat(activeChatId)
    void openDocumentForChat(activeChatId, {
      filePath: parts.path,
      scope: parts.scope,
      mountPoint: parts.mountPoint,
      mode: 'split',
    })
      .then((data) => {
        if (ws && pathname === '/workspace') {
          ws.openTab(
            'document',
            {
              chatId: activeChatId,
              chatDocumentId: data.document.id,
              displayTitle: data.document.displayTitle,
            },
            { focus: true },
          )
        }

        // Notify any mounted Salon for this chat to reconcile and focus the
        // newly-opened document row immediately (no manual refresh needed).
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('qtap-document-opened', {
            detail: {
              chatId: activeChatId,
              chatDocumentId: data.document.id,
            },
          }))
        }
      })
      .catch((error) => {
        showErrorToast(error instanceof Error ? error.message : 'Failed to open document')
      })
  }, [activeChatId, focusChat, pathname, ws])

  const value = useMemo(() => ({ resolve, open }), [open, resolve])

  return (
    <QtapLinkContext.Provider value={value}>
      {children}
      <ImageModal
        isOpen={imageViewer !== null}
        onClose={() => setImageViewer(null)}
        src={imageViewer?.src ?? ''}
        filename={imageViewer?.filename ?? 'image'}
      />
    </QtapLinkContext.Provider>
  )
}