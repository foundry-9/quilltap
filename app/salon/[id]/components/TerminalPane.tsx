'use client'

/**
 * TerminalPane - the right-side wrapper for Terminal Mode in the salon.
 *
 * Shape mirrors DocumentPane: header with focus-toggle / hide-pane / kill,
 * body is the xterm terminal sized to fill the pane.
 */

import { useEffect, useState } from 'react'
import { Terminal } from '@/components/terminal/Terminal'
import { useTerminalSession } from '@/hooks/useTerminalSession'
import { Icon } from '@/components/ui/icon'
import type { TerminalMode } from '../hooks/useTerminalMode'

interface TerminalPaneProps {
  sessionId: string
  chatId: string
  mode: TerminalMode
  onToggleFocusMode: () => void
  /** Hide the pane but leave the PTY alive (the inline embed becomes interactive again). */
  onHidePane: () => void | Promise<void>
  /** Kill the PTY and close the pane. */
  onKill: () => void | Promise<void>
}

export function TerminalPane({
  sessionId,
  chatId: _chatId,
  mode,
  onToggleFocusMode,
  onHidePane,
  onKill,
}: TerminalPaneProps) {
  const session = useTerminalSession(sessionId)
  const [confirmKill, setConfirmKill] = useState(false)

  // Reset the kill-confirm state when the session changes — local UI state only,
  // not a cascading render in any meaningful sense.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting transient UI state when the bound session changes
    setConfirmKill(false)
  }, [sessionId])

  const title = session.meta
    ? `Terminal — ${session.meta.shell}${session.meta.label ? ` (${session.meta.label})` : ''}`
    : 'Terminal'

  const handleKillClick = () => {
    if (!confirmKill) {
      setConfirmKill(true)
      // Auto-cancel the confirm after a few seconds so it doesn't linger.
      window.setTimeout(() => setConfirmKill(false), 4000)
      return
    }
    void onKill()
  }

  return (
    <div className="qt-doc-pane-inner flex flex-col h-full overflow-hidden qt-bg-surface">
      <div className="qt-doc-header flex items-center justify-between gap-2 px-3 py-2 border-b qt-border-default">
        <div className="qt-doc-title min-w-0 truncate text-sm font-medium">{title}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleFocusMode}
            className="qt-button-icon p-1"
            title={mode === 'focus' ? 'Restore split layout' : 'Maximize terminal'}
            aria-label={mode === 'focus' ? 'Restore split layout' : 'Maximize terminal'}
          >
            {mode === 'focus' ? (
              <Icon name="compress" className="w-4 h-4" />
            ) : (
              <Icon name="expand" className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void onHidePane()}
            className="qt-button-icon p-1"
            title="Close pane (terminal stays alive)"
            aria-label="Close terminal pane"
          >
            <Icon name="minus" className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleKillClick}
            className={`qt-button-icon p-1 qt-text-destructive ${confirmKill ? '' : 'opacity-70 hover:opacity-100'}`}
            title={confirmKill ? 'Click again to confirm: kill terminal and close pane' : 'Kill terminal and close pane'}
            aria-label="Kill terminal and close pane"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 qt-terminal-surface">
        <Terminal sessionId={sessionId} className="h-full w-full" />
      </div>
    </div>
  )
}
