'use client';

import { useHealthCheck } from '@/hooks/useHealthCheck';

/**
 * InstanceLockGate
 *
 * Client component that displays a full-screen error when another Quilltap
 * process holds the database lock. Uses the shared health-check hook which
 * fetches /api/health once on mount and only polls when a problem is detected.
 */
export function InstanceLockGate() {
  const { lockConflict: conflict } = useHealthCheck();

  if (!conflict) return null;

  const envLabel =
    conflict.environment === 'electron' ? 'the Electron app'
    : conflict.environment === 'docker' ? 'a Docker container'
    : 'a local server';

  const startedAt = new Date(conflict.startedAt).toLocaleString();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center qt-pretheme-bg">
      <div className="qt-card mx-4 max-w-lg p-8 text-center">
        <div className="text-4xl mb-4" aria-hidden="true">&#x1F512;</div>
        <h1 className="qt-heading-lg mb-2">Database In Use</h1>
        <p className="qt-text-secondary mb-6">
          Another Quilltap instance is already using this database.
          Running two instances against the same data can cause corruption.
        </p>

        <div className="qt-bg-surface-alt rounded-lg p-4 text-left text-sm mb-6 space-y-1">
          <div><span className="qt-text-secondary">Held by:</span> {envLabel}</div>
          <div><span className="qt-text-secondary">PID:</span> {conflict.pid}</div>
          <div><span className="qt-text-secondary">Host:</span> {conflict.hostname}</div>
          <div><span className="qt-text-secondary">Since:</span> {startedAt}</div>
        </div>

        <div className="text-left text-sm space-y-3">
          <p className="font-medium">To resolve this:</p>
          <ol className="list-decimal list-inside space-y-2 qt-text-secondary">
            <li>
              Stop the other Quilltap instance, or close the other browser tab
              if you simply have one open elsewhere.
            </li>
            <li>
              If the other process is gone but left a stale lock, run:<br />
              <code className="qt-code text-xs mt-1 inline-block">
                npx quilltap db --lock-clean
              </code>
            </li>
            <li>
              If you need to force access (use with caution):<br />
              <code className="qt-code text-xs mt-1 inline-block">
                npx quilltap db --lock-override
              </code>
            </li>
          </ol>
        </div>

        <p className="qt-text-secondary text-xs mt-6">
          This page will dismiss automatically when the conflict resolves.
        </p>
      </div>
    </div>
  );
}
