'use client';

import { useHealthCheck } from '@/hooks/useHealthCheck';

/**
 * VersionGuardGate
 *
 * Client component that displays a full-screen error when the running
 * Quilltap version is older than what last touched the database. Uses
 * the shared health-check hook which fetches /api/health once on mount
 * and only polls when a problem is detected.
 */
export function VersionGuardGate() {
  const { versionBlock } = useHealthCheck();

  if (!versionBlock) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center qt-pretheme-bg">
      <div className="qt-card mx-4 max-w-lg p-8 text-center">
        <div className="text-4xl mb-4" aria-hidden="true">&#x26A0;&#xFE0F;</div>
        <h1 className="qt-heading-lg mb-2">A Most Regrettable Anachronism</h1>
        <p className="qt-text-secondary mb-6">
          This edition of Quilltap (v{versionBlock.currentVersion}) finds itself rather
          outpaced by progress. The database has already been attended to by a more
          advanced version (v{versionBlock.highestVersion}), and permitting this older
          model to tinker with the works would be, to put it delicately, catastrophic.
        </p>

        <div className="qt-bg-surface-alt rounded-lg p-4 text-left text-sm mb-6 space-y-1">
          <div>
            <span className="qt-text-secondary">Running version:</span>{' '}
            <code className="qt-code">{versionBlock.currentVersion}</code>
          </div>
          <div>
            <span className="qt-text-secondary">Database version:</span>{' '}
            <code className="qt-code">{versionBlock.highestVersion}</code>
          </div>
        </div>

        <div className="text-left text-sm space-y-3">
          <p className="font-medium">To set things right:</p>
          <ol className="list-decimal list-inside space-y-2 qt-text-secondary">
            <li>
              Upgrade to Quilltap <strong>v{versionBlock.highestVersion}</strong> or newer.
              This is by far the most civilised course of action.
            </li>
            <li>
              If you are quite certain you know what you are doing and have a backup,
              you may adjust the stored version via the CLI:<br />
              <code className="qt-code text-xs mt-1 inline-block">
                npx quilltap db &quot;UPDATE instance_settings SET value = &apos;{versionBlock.currentVersion}&apos; WHERE key = &apos;highest_app_version&apos;;&quot;
              </code>
            </li>
          </ol>
        </div>

        <p className="qt-text-secondary text-xs mt-6">
          This page will dismiss automatically should the situation resolve itself.
        </p>
      </div>
    </div>
  );
}
