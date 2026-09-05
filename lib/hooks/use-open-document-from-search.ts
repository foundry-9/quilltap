'use client'

/**
 * useOpenDocumentFromSearch
 *
 * Click behaviour for a **Documents** result in the global search bar. Where
 * the document lands depends on what the user is looking at:
 *
 * - **A Salon is focused** → open it *in that chat*, exactly as the composer's
 *   document picker would: the Librarian announces the open, and the chat sees
 *   later saves. See `openDocumentInChat`.
 * - **Inside the workspace, no Salon focused** → open a `document-standalone`
 *   tab in place. Standalone Document Mode touches no `chat_documents` row, so
 *   no conversation is told of the open or of any edit.
 * - **Outside the workspace shell** → push the result's own URL, which is the
 *   same standalone deep link `WorkspaceIntent` consumes on arrival.
 *
 * Modified clicks (⌘/ctrl/shift/alt, middle button) are left alone so the
 * browser opens the anchor's href — the silent standalone link — in a new tab.
 * That is also what a JS-free open does, which is why the server hands out the
 * standalone URL rather than a chat one: the default can never surprise a
 * conversation.
 *
 * @module lib/hooks/use-open-document-from-search
 */

import { useCallback, useMemo, type MouseEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { openDocumentInChat } from '@/lib/documents/open-document-in-chat'
import { showErrorToast } from '@/lib/toast'
import { standaloneDocKey, type DocumentStandaloneTabPayload, type WorkspaceState } from '@/lib/workspace/types'
import type { DocumentSearchResultItem } from '@/components/search/types'

/** The workspace-focused Salon, plus the tab it lives in. */
export interface ActiveSalon {
  chatId: string
  /** The Salon tab's id, so an opened document can be parented to it. */
  tabId: string | null
}

/**
 * Which conversation an "open in the chat" would land in, if any.
 *
 * Follows **focus**, not mere presence: only the focused pane's active tab
 * counts, so a Salon idling in the other pane never captures the open. Outside
 * the workspace shell the pathname decides (`/salon/<id>`).
 *
 * Pure — the hook is a thin wrapper so this stays directly testable.
 */
export function resolveActiveSalon(
  state: WorkspaceState | null | undefined,
  pathname: string | null,
): ActiveSalon | null {
  if (state) {
    const activeTabId = state.panes[state.focusedPane]?.activeTabId ?? null
    const tab = activeTabId ? state.tabs[activeTabId] : undefined
    if (tab && tab.kind === 'salon') {
      const chatId = (tab.payload as { chatId?: unknown } | undefined)?.chatId
      if (typeof chatId === 'string' && chatId.length > 0) {
        return { chatId, tabId: tab.id }
      }
    }
    return null
  }

  const match = pathname?.match(/^\/salon\/([^/?#]+)$/)
  if (!match) return null
  const chatId = decodeURIComponent(match[1])
  if (!chatId || chatId === 'new') return null
  return { chatId, tabId: null }
}

/** True when the click should be left to the browser (new tab / new window). */
function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

export function useActiveSalon(): ActiveSalon | null {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  const inWorkspace = ws !== null && pathname === '/workspace'
  return useMemo(
    () => resolveActiveSalon(inWorkspace ? ws!.state : null, pathname),
    [inWorkspace, ws, pathname],
  )
}

/**
 * Returns the click handler for a document search result. Call it from the
 * result card's `onClick`; it decides between the in-chat and the silent
 * standalone open and leaves modified clicks to the browser.
 */
export function useOpenDocumentFromSearch(): (
  result: DocumentSearchResultItem,
  event: MouseEvent,
) => void {
  const ws = useWorkspaceOptional()
  const pathname = usePathname()
  const router = useRouter()
  const activeSalon = useActiveSalon()
  const inWorkspace = ws !== null && pathname === '/workspace'

  return useCallback((result, event) => {
    if (isModifiedClick(event)) return
    event.preventDefault()

    if (activeSalon) {
      void openDocumentInChat(
        activeSalon.chatId,
        {
          filePath: result.relativePath,
          scope: 'document_store',
          mountPoint: result.mountPointRef,
          mode: 'split',
        },
        {
          openTab: inWorkspace ? ws!.openTab : null,
          parentTabId: activeSalon.tabId ?? undefined,
        },
      ).catch((error) => {
        showErrorToast(error instanceof Error ? error.message : 'Failed to open document')
      })
      return
    }

    if (inWorkspace) {
      const payload: DocumentStandaloneTabPayload = {
        docKey: standaloneDocKey('document_store', result.mountPointRef, result.relativePath),
        scope: 'document_store',
        mountPoint: result.mountPointRef,
        filePath: result.relativePath,
        displayTitle: result.name,
      }
      ws!.openTab('document-standalone', payload, { title: result.name })
      return
    }

    // Legacy shell: the result's URL is the `?open=document-standalone` intent,
    // which mints the tab (and its docKey) once the workspace mounts.
    router.push(result.url)
  }, [activeSalon, inWorkspace, router, ws])
}
