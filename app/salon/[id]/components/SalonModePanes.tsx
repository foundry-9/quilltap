'use client'

/**
 * SalonModePanes — routes the Salon's Document/Terminal panes either to the
 * legacy in-chat {@link SplitLayout} (when rendered on the old `/salon/[id]`
 * route) or to sibling workspace tabs (when rendered inside the tabbed
 * workspace).
 *
 * In the workspace branch the chat fills its own tab and each open document
 * gets its own child tab — its editor pane is **portaled** into that tab's DOM
 * host. The panes stay children of the Salon view's React tree (so their hooks
 * and the live editors are never remounted) while appearing in their own
 * (possibly other-pane) tabs. Opening a document spawns its child tab; closing
 * the document closes the tab; closing the tab closes the document. The Terminal
 * pane follows the same single-pane pattern. See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * The legacy branch is single-document: it shows the focused document only,
 * matching the previous behavior so the old route is unaffected.
 *
 * @module app/salon/[id]/components/SalonModePanes
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import SplitLayout from './SplitLayout'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import {
  useWorkspaceTabId,
  useWorkspacePortalRegistry,
  portalKey,
} from '@/components/workspace/workspace-tab-context'

/** One open document's editor pane, ready to portal into its tab. */
export interface DocumentPaneDescriptor {
  docId: string
  displayTitle: string
  content: ReactNode
}

export interface SalonModePanesProps {
  parentChatId: string
  chatTitle?: string | null
  /** Combined legacy mode (normal/split/focus) — only used by SplitLayout. */
  mode: 'normal' | 'split' | 'focus'
  dividerPosition: number
  onDividerPositionChange: (position: number) => void
  rightPaneVerticalSplit: number
  onRightPaneVerticalSplitChange: (position: number) => void
  chatContent: ReactNode
  /** One descriptor per open document (each gets its own tab + portal). */
  documentPanes: DocumentPaneDescriptor[]
  /** The focused document — the one the legacy single-pane route shows. */
  focusedDocId: string | null
  terminalContent: ReactNode | null
  /** Whether Terminal mode is currently showing a pane. */
  terminalActive: boolean
  /** Close a specific document (called when its child tab is closed). */
  onCloseDocument: (docId: string) => void
  onCloseTerminal: () => void
}

export function SalonModePanes(props: SalonModePanesProps) {
  const {
    parentChatId,
    chatTitle,
    mode,
    dividerPosition,
    onDividerPositionChange,
    rightPaneVerticalSplit,
    onRightPaneVerticalSplitChange,
    chatContent,
    documentPanes,
    focusedDocId,
    terminalContent,
    terminalActive,
    onCloseDocument,
    onCloseTerminal,
  } = props

  // Hooks are called unconditionally; they return null outside the workspace.
  const ws = useWorkspaceOptional()
  const parentTabId = useWorkspaceTabId()
  const registry = useWorkspacePortalRegistry()
  const inWorkspace = Boolean(ws && parentTabId && registry)

  // docId -> tabId for the document child tabs this view opened.
  const docTabsRef = useRef<Map<string, string>>(new Map())
  const termTabRef = useRef<string | null>(null)

  // Reconcile the Document child tabs with the open-document set.
  useEffect(() => {
    if (!inWorkspace || !ws || !parentTabId) return
    const tabs = ws.state.tabs
    const map = docTabsRef.current
    const openIds = new Set(documentPanes.map((p) => p.docId))

    // 1. A tracked tab that no longer exists → the user closed it → close the doc.
    for (const [docId, tabId] of [...map.entries()]) {
      if (!tabs[tabId]) {
        map.delete(docId)
        if (openIds.has(docId)) onCloseDocument(docId)
      }
    }

    // 2. Open a tab for any document that doesn't have a live one.
    for (const pane of documentPanes) {
      const existingTabId = map.get(pane.docId)
      if (existingTabId && tabs[existingTabId]) continue
      const tabId = ws.openTab(
        'document',
        { chatId: parentChatId, chatDocumentId: pane.docId, displayTitle: pane.displayTitle },
        {
          parentTabId,
          title: pane.displayTitle || (chatTitle ? `Document: ${chatTitle}` : 'Document'),
        }
      )
      map.set(pane.docId, tabId)
    }

    // 3. Close tabs for documents that are no longer open.
    for (const [docId, tabId] of [...map.entries()]) {
      if (!openIds.has(docId)) {
        if (tabs[tabId]) ws.closeTab(tabId)
        map.delete(docId)
      }
    }
  }, [inWorkspace, ws, parentTabId, parentChatId, chatTitle, documentPanes, onCloseDocument])

  // Reconcile the Terminal child tab with terminal-mode state.
  useEffect(() => {
    if (!inWorkspace || !ws || !parentTabId) return
    const tabs = ws.state.tabs
    if (terminalActive) {
      const existing = termTabRef.current ? tabs[termTabRef.current] : undefined
      if (!existing) {
        if (termTabRef.current) {
          termTabRef.current = null
          onCloseTerminal()
        } else {
          termTabRef.current = ws.openTab(
            'terminal',
            { chatId: parentChatId },
            { parentTabId, title: chatTitle ? `Terminal: ${chatTitle}` : 'Terminal' }
          )
        }
      }
    } else if (termTabRef.current) {
      if (tabs[termTabRef.current]) ws.closeTab(termTabRef.current)
      termTabRef.current = null
    }
  }, [inWorkspace, ws, parentTabId, parentChatId, chatTitle, terminalActive, onCloseTerminal])

  if (!inWorkspace || !registry) {
    // Legacy single-pane route: show the focused document only.
    const focusedPane =
      documentPanes.find((p) => p.docId === focusedDocId) ?? documentPanes[0] ?? null
    return (
      <SplitLayout
        mode={mode}
        dividerPosition={dividerPosition}
        onDividerPositionChange={onDividerPositionChange}
        rightPaneVerticalSplit={rightPaneVerticalSplit}
        onRightPaneVerticalSplitChange={onRightPaneVerticalSplitChange}
        chatContent={chatContent}
        documentContent={focusedPane?.content ?? null}
        terminalContent={terminalContent}
      />
    )
  }

  const termNode = registry.nodes[portalKey('terminal', parentChatId)] ?? null

  return (
    <div className="qt-doc-split-layout">
      <div className="qt-doc-chat-pane" style={{ flex: 1, minWidth: 0 }}>
        {chatContent}
      </div>
      {documentPanes.map((pane) => {
        const node = registry.nodes[portalKey('document', parentChatId, pane.docId)] ?? null
        return node
          ? createPortal(
              <div className="qt-salon-portaled-pane">{pane.content}</div>,
              node,
              pane.docId
            )
          : null
      })}
      {terminalContent && termNode
        ? createPortal(<div className="qt-salon-portaled-pane">{terminalContent}</div>, termNode)
        : null}
    </div>
  )
}
