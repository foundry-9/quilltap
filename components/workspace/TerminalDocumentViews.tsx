'use client'

/**
 * TerminalView / DocumentView — the chat-linked child tabs.
 *
 * These render only a portal *host*. The live Terminal (Ariel PTY) and Document
 * (Librarian editor) panes are rendered by the parent Salon view — which owns
 * their chat-bound hooks — and portaled into this host. That keeps the PTY/editor
 * mounted inside the kept-alive Salon subtree (surviving tab switches) while
 * appearing in their own tab, possibly in the other pane. See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * @module components/workspace/TerminalDocumentViews
 */

import { useCallback } from 'react'
import {
  useWorkspacePortalRegistry,
  portalKey,
} from '@/components/workspace/workspace-tab-context'
import type { TerminalTabPayload, DocumentTabPayload } from '@/lib/workspace/types'

function PortalHost({ kind, chatId, docId }: { kind: 'terminal' | 'document'; chatId: string; docId?: string }) {
  const registry = useWorkspacePortalRegistry()
  const setNode = registry?.setNode
  const key = portalKey(kind, chatId, docId)
  const hasSource = registry ? registry.nodes[key] != null : false

  // Stable ref callback: an inline arrow changes identity every render, which
  // makes React detach+reattach the ref each commit and toggles the registry
  // node — an infinite update loop. useCallback keeps it stable.
  const mountRef = useCallback(
    (el: HTMLElement | null) => setNode?.(key, el),
    [setNode, key]
  )

  return (
    <div className="qt-tab-portal-host">
      <div className="qt-tab-portal-mount" ref={mountRef} />
      {!hasSource && (
        <div className="qt-tab-portal-empty">
          <p className="qt-text-muted text-sm">
            Open this conversation in the workspace to bring its{' '}
            {kind === 'terminal' ? 'terminal' : 'document'} to life here.
          </p>
        </div>
      )}
    </div>
  )
}

export function TerminalView({ chatId }: TerminalTabPayload) {
  return <PortalHost kind="terminal" chatId={chatId} />
}

export function DocumentView({ chatId, chatDocumentId }: DocumentTabPayload) {
  return <PortalHost kind="document" chatId={chatId} docId={chatDocumentId} />
}
