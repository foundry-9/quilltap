'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * AutoLockProvider
 *
 * Headless provider that monitors user activity and triggers an auto-lock
 * after a configurable idle period. Only active when the user has set a
 * passphrase and enabled auto-lock in settings.
 *
 * The provider:
 * 1. Fetches lock config from GET /api/v1/system/unlock on mount
 * 2. Tracks DOM activity events (throttled to once per 30s)
 * 3. Checks idle time every 60s
 * 4. Shows a warning toast 1 minute before locking
 * 5. Locks by calling POST /api/v1/system/unlock?action=lock and redirecting to /unlock
 */
export function AutoLockProvider() {
  const lastActivityRef = useRef<number>(0);
  const configRef = useRef<{ hasUserPassphrase: boolean; autoLockMinutes: number | null } | null>(null);
  const warningShownRef = useRef(false);
  const lockingRef = useRef(false);
  const throttleTimerRef = useRef<number | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/unlock');
      if (!res.ok) return;
      const data = await res.json();
      configRef.current = {
        hasUserPassphrase: data.hasUserPassphrase ?? false,
        autoLockMinutes: data.autoLockMinutes ?? null,
      };
      // Reset warning state when config changes
      warningShownRef.current = false;
    } catch {
      // Silently ignore — will retry on next settings change event
    }
  }, []);

  const handleActivity = useCallback(() => {
    // Throttle: only update lastActivity at most once per 30s
    if (throttleTimerRef.current !== null) return;
    lastActivityRef.current = Date.now();
    warningShownRef.current = false;
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = null;
    }, 30000);
  }, []);

  const triggerLock = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;

    console.debug('[AutoLock] Idle timeout reached — locking application');

    // Save current location for return after unlock
    const returnPath = window.location.pathname + window.location.search;
    sessionStorage.setItem('quilltap-autolock-return', returnPath);

    try {
      await fetch('/api/v1/system/unlock?action=lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      console.error('[AutoLock] Failed to call lock endpoint');
    }

    // Full page reload to /unlock to reset all client state. This is the point
    // of the auto-lock: router.push() would leave decrypted data alive in
    // memory and in client caches, which is exactly what locking must discard.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/unlock';
  }, []);

  const showWarningToast = useCallback(() => {
    if (warningShownRef.current) return;
    warningShownRef.current = true;

    // Create a toast notification
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 z-[9999] qt-card p-4 qt-shadow-lg border qt-border max-w-sm animate-in slide-in-from-bottom-2';
    toast.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <p class="qt-text-small font-semibold">Auto-Lock Warning</p>
          <p class="qt-text-xs qt-text-muted mt-1">Quilltap will lock in approximately one minute due to inactivity. Move the mouse or press a key to remain.</p>
        </div>
        <button onclick="this.closest('div.fixed').remove()" class="qt-button qt-button-ghost text-xs px-2 py-1">Dismiss</button>
      </div>
    `;
    document.body.appendChild(toast);

    // Auto-remove after 30 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 30000);
  }, []);

  useEffect(() => {
    // Initialize lastActivity on mount
    lastActivityRef.current = Date.now();

    // Skip on setup and unlock pages
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path.startsWith('/setup') || path === '/unlock') {
        return;
      }
    }

    // Fetch initial config
    fetchConfig();

    // Listen for settings changes
    const handleSettingsChanged = () => {
      fetchConfig();
    };
    window.addEventListener('quilltap-autolock-settings-changed', handleSettingsChanged);

    // Activity event listeners
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const event of events) {
      document.addEventListener(event, handleActivity, { passive: true, capture: true });
    }

    // Idle check interval (every 60 seconds)
    const intervalId = window.setInterval(() => {
      const config = configRef.current;
      if (!config || !config.hasUserPassphrase || config.autoLockMinutes === null) {
        return;
      }

      const idleMs = Date.now() - lastActivityRef.current;
      const lockThresholdMs = config.autoLockMinutes * 60000;
      const warningThresholdMs = Math.max(0, (config.autoLockMinutes - 1) * 60000);

      if (idleMs >= lockThresholdMs) {
        triggerLock();
      } else if (idleMs >= warningThresholdMs && !warningShownRef.current) {
        showWarningToast();
      }
    }, 60000);

    return () => {
      window.removeEventListener('quilltap-autolock-settings-changed', handleSettingsChanged);
      for (const event of events) {
        document.removeEventListener(event, handleActivity, { capture: true });
      }
      window.clearInterval(intervalId);
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, [fetchConfig, handleActivity, triggerLock, showWarningToast]);

  // Headless — renders nothing
  return null;
}
