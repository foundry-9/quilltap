'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Terminal } from './Terminal';
import { useTerminalSession } from '@/hooks/useTerminalSession';
import { showErrorToast } from '@/lib/toast';
import { useTerminalModeContext } from '@/app/salon/[id]/hooks/useTerminalMode';
import { useWorkspaceOptional } from '@/components/providers/workspace-provider';
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context';

interface TerminalEmbedProps {
  sessionId: string;
  label?: string | null;
  chatId: string;
}

/**
 * Inline terminal message wrapper for Salon chat bubbles
 *
 * Renders a collapsible terminal with header controls (pop-out, kill).
 * Collapse state persists in localStorage.
 */
export function TerminalEmbed({ sessionId, label, chatId }: TerminalEmbedProps) {
  const router = useRouter();
  const pathname = usePathname();
  const ws = useWorkspaceOptional();
  // The id of the Salon tab this embed is rendered inside (null on the legacy
  // route), used to parent the popped-out terminal tab to its conversation.
  const salonTabId = useWorkspaceTabId();
  const session = useTerminalSession(sessionId);
  const terminalModeCtx = useTerminalModeContext();
  const isInTerminalPane =
    terminalModeCtx.terminalMode !== 'normal' &&
    terminalModeCtx.activeTerminalSessionId === sessionId;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(`terminalEmbed:${sessionId}:collapsed`) === 'true';
  });

  // When the WS reports the PTY has exited, tell the salon page to refresh
  // its message list so the new Ariel close announcement appears.
  const exitDispatchedRef = useRef(false);
  useEffect(() => {
    if (session.state !== 'exited' || exitDispatchedRef.current) return;
    exitDispatchedRef.current = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('quilltap:terminal-exited', {
          detail: { chatId, sessionId },
        }),
      );
    }
  }, [session.state, chatId, sessionId]);

  // Persist collapse state
  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      const key = `terminalEmbed:${sessionId}:collapsed`;
      localStorage.setItem(key, String(next));
      return next;
    });
  }, [sessionId]);

  const handleKill = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/terminals/${sessionId}?action=kill`, {
        method: 'POST',
      });

      if (!res.ok) {
        showErrorToast('Failed to terminate session');
      }
    } catch (err) {
      showErrorToast('Failed to terminate session');
      console.error('Kill session error:', err);
    }
  }, [sessionId]);

  const handlePopOut = useCallback(() => {
    // Inside the workspace, open the terminal as its own tab (parented to this
    // Salon) so a route change doesn't remount the workspace and kill the live
    // PTY / any streaming. Elsewhere, the full-page terminal route.
    if (ws && pathname === '/workspace') {
      ws.openTab(
        'terminal',
        { chatId, sessionId },
        salonTabId ? { parentTabId: salonTabId } : undefined,
      );
      return;
    }
    router.push(`/salon/${chatId}/terminal/${sessionId}`);
  }, [ws, pathname, salonTabId, router, chatId, sessionId]);

  const handleFocusPane = useCallback(() => {
    if (typeof document === 'undefined') return;
    const pane = document.querySelector('.qt-doc-pane');
    if (pane && 'scrollIntoView' in pane) {
      try {
        (pane as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        // ignore
      }
    }
    const xtermTextarea = pane?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
    xtermTextarea?.focus();
  }, []);

  const title = label || (session.meta ? `Terminal — ${session.meta.shell}` : 'Terminal');

  return (
    <div className="qt-terminal-embed">
      {/* Header */}
      <div className="qt-terminal-embed-header">
        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={toggleCollapse}
            className="qt-button-icon p-1"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <Icon
              name="arrow-down"
              className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            />
          </button>
          <h3 className="text-sm font-medium">{title}</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePopOut}
            className="qt-button-icon text-sm"
            title="Pop out"
          >
            <Icon name="external-link" className="w-4 h-4" />
          </button>

          {session.state !== 'exited' && (
            <button
              onClick={handleKill}
              className="qt-button-icon text-sm qt-text-destructive opacity-70 hover:opacity-100"
              title="Kill session"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Terminal Body */}
      {!collapsed && (
        isInTerminalPane ? (
          <div className="qt-terminal-embed-footer">
            <span className="qt-text-secondary">
              Showing in Terminal Mode pane.
            </span>
            <button
              type="button"
              onClick={handleFocusPane}
              className="qt-button-secondary text-xs px-2 py-1"
              title="Focus the Terminal Mode pane"
            >
              Go to pane →
            </button>
          </div>
        ) : (
          <div className="qt-terminal-surface" style={{ height: '360px' }}>
            <Terminal
              sessionId={sessionId}
              className="h-full w-full"
            />
          </div>
        )
      )}
    </div>
  );
}
