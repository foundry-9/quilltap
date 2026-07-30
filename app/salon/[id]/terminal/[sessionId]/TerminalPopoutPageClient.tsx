'use client';

/**
 * Legacy-shell body for the full-page terminal popout (workspace disabled).
 * The workspace path opens the conversation plus a child terminal tab instead.
 */

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Terminal } from '@/components/terminal/Terminal';
import { useTerminalSession } from '@/hooks/useTerminalSession';
import { Icon } from '@/components/ui/icon';
import { showErrorToast } from '@/lib/toast';

export function TerminalPopoutPageClient({ chatId, sessionId }: { chatId: string; sessionId: string }) {
  const router = useRouter();
  const session = useTerminalSession(sessionId);

  const handleKill = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/terminals/${sessionId}?action=kill`, {
        method: 'POST',
      });

      if (!res.ok) {
        showErrorToast('Failed to terminate session');
      }
    } catch {
      showErrorToast('Failed to terminate session');
    }
  }, [sessionId]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const title = session.meta?.label || (session.meta ? `Terminal — ${session.meta.shell}` : 'Terminal');

  return (
    <div className="qt-terminal-popout-page h-screen flex flex-col">
      {/* Header */}
      <div className="qt-terminal-popout-header">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="qt-button-icon"
            title="Back to chat"
          >
            <Icon name="chevron-left" className="w-5 h-5" />
          </button>
          <a
            href={`/salon/${chatId}`}
            className="qt-terminal-popout-link text-sm"
          >
            Chat
          </a>
          <span className="qt-terminal-popout-separator">/</span>
          <h1 className="qt-terminal-popout-title">{title}</h1>
        </div>

        {session.state !== 'exited' && (
          <button
            onClick={handleKill}
            className="qt-button-destructive text-sm"
          >
            Kill Session
          </button>
        )}
      </div>

      {/* Terminal Body */}
      <div className="flex-1 overflow-hidden">
        <Terminal
          sessionId={sessionId}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
