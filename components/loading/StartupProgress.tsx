'use client';

/**
 * Startup Progress Loading Screen
 *
 * Polls `/api/v1/system/startup-status` every second and renders what the
 * server is currently working on — pretty phase, current label, recent
 * events, and any sub-progress tiers (e.g. "3/4 projects, 224/459 files").
 *
 * This screen stays up — driven by `useStartupPhase` in the app layout — until
 * the post-startup background backfills (vault backfill + mount scan) settle,
 * not merely until the server reports `complete`. The server reaches `complete`
 * and starts serving before those finish, and server-rendered pages read empty
 * data in that window. The gate owner (app-layout) releases and refreshes stale
 * data; this component is purely presentational.
 */

import { useEffect, useRef, useState } from 'react';

import { formatRelativeAge } from '@/lib/format-time';
import { useNow } from '@/hooks/useNow';

type ProgressTier = { current: number; total: number; unit: string };

interface StartupEvent {
  ts: number;
  phase: string;
  rawLabel: string;
  prettyLabel: string;
  detail?: string;
  level: 'info' | 'warn' | 'error';
  progress?: ProgressTier[];
}

interface StartupStatus {
  phase: string;
  isReady: boolean;
  backgroundSettled: boolean;
  isLockedMode: boolean;
  startedAt: number;
  readyAt: number | null;
  errorMessage: string | null;
  currentLabel: string | null;
  currentRawLabel: string | null;
  currentSubProgress: ProgressTier[] | null;
  recentEvents: StartupEvent[];
}

const POLL_INTERVAL_MS = 1000;

export interface StartupGateState {
  /** The server's current coarse startup phase, or null before the first poll. */
  phase: string | null;
  /**
   * Whether the post-startup background backfills (vault backfill + mount
   * scan) have settled. The gate holds the progress screen until this is true,
   * because the server reaches `complete` and starts serving *before* those
   * finish — and server-rendered pages read empty data in that window.
   */
  settled: boolean;
  /**
   * True if we ever observed an unsettled, non-failed poll — i.e. the gate
   * actually had to hold. The layout uses this to decide whether a post-settle
   * reload is needed (the page underneath was server-rendered with mid-settle
   * empty data). Steady-state boots never set this, so they never reload.
   */
  everSettling: boolean;
}

/**
 * Hook: returns the server's startup gate state. Polling continues through the
 * `complete` phase and stops only once the background backfills have settled
 * (or the server has `failed`).
 *
 * Used by the app layout to decide whether to show the StartupProgress screen
 * or the real app — independently of whatever session.status says, since the
 * session endpoint can return 200 well before the server's subsystem work
 * (reconcile, vault backfill, mount-index rescan) actually finishes.
 */
export function useStartupPhase(): StartupGateState {
  const [state, setState] = useState<StartupGateState>({
    phase: null,
    settled: false,
    everSettling: false,
  });

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const response = await fetch('/api/v1/system/startup-status', {
          cache: 'no-store',
        });
        if (response.ok) {
          const data: StartupStatus = await response.json();
          const settled = data.backgroundSettled === true;
          const settling = !settled && data.phase !== 'failed';
          setState((prev) => ({
            phase: data.phase,
            settled,
            everSettling: prev.everSettling || settling,
          }));
          // Stop polling once the app is displayable: either the background
          // backfills have settled, or startup failed (errors surface in-app).
          if (settled || data.phase === 'failed') {
            return;
          }
        }
      } catch {
        // best-effort — keep polling
      }
      if (stopped) return;
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      stopped = true;
    };
  }, []);

  return state;
}

const PHASE_HEADLINE: Record<string, string> = {
  pending: 'Just getting our bearings',
  locked: 'Awaiting your passphrase',
  migrations: 'Bringing the records up to date',
  seeding: 'Setting out the initial furnishings',
  'plugin-updates': 'Polishing the plugin brass',
  plugins: 'Mustering the plugins',
  'file-storage': 'Reconciling the file ledger',
  complete: 'At your service',
  failed: 'Something has gone amiss',
};

function phaseHeadline(phase: string): string {
  return PHASE_HEADLINE[phase] ?? 'Working on something';
}

function formatTier(t: ProgressTier): string {
  return t.total > 0 ? `${t.current}/${t.total} ${t.unit}` : `${t.current} ${t.unit}`;
}

export function StartupProgress() {
  // The event ages used to advance only as a side effect of the 1 s status
  // poll landing. The shared clock makes them tick on their own, so a stalled
  // step visibly stalls instead of looking freshly finished.
  const nowMs = useNow(1_000);
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      if (stoppedRef.current) return;
      try {
        const response = await fetch('/api/v1/system/startup-status', {
          cache: 'no-store',
        });
        if (!response.ok) {
          setFetchError(`status endpoint returned ${response.status}`);
        } else {
          const data: StartupStatus = await response.json();
          setStatus(data);
          setFetchError(null);
        }
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : String(err));
      }

      // Keep polling for display while the screen is up. The gate owner
      // (app-layout) decides when to release and refreshes stale data; this
      // component is purely presentational.
      if (stoppedRef.current) return;
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  const phase = status?.phase ?? 'pending';
  const isErrored = phase === 'failed';
  // The server reaches `complete` before the background backfills settle; show
  // a distinct headline in that window rather than "At your service".
  const settling = phase === 'complete' && status?.backgroundSettled === false;
  const headline = isErrored
    ? phaseHeadline('failed')
    : settling
      ? 'Settling everything into place'
      : phaseHeadline(phase);
  const currentLabel = status?.currentLabel ?? null;
  const subProgress = status?.currentSubProgress;
  const events = status?.recentEvents ?? [];

  return (
    <div className="qt-pretheme-bg flex h-screen items-center justify-center p-6">
      <div className="qt-card flex w-full max-w-xl flex-col gap-4 p-8">
        <div className="flex flex-col gap-1">
          <div className="qt-text-secondary text-xs uppercase tracking-wide">
            Quilltap is starting up
          </div>
          <h1 className={`text-2xl ${isErrored ? 'qt-text-danger' : 'qt-text-primary'}`}>
            {headline}
          </h1>
          {currentLabel && !isErrored && (
            <div className="qt-text-secondary text-base">
              {currentLabel}
            </div>
          )}
          {status?.errorMessage && (
            <div className="qt-text-danger mt-2 text-sm">
              {status.errorMessage}
            </div>
          )}
        </div>

        {subProgress && subProgress.length > 0 && (
          <div className="flex flex-col gap-1 text-sm qt-text-secondary">
            {subProgress.map((tier, i) => (
              <div key={i} className={i === 0 ? '' : 'pl-4'}>
                {formatTier(tier)}
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div className="qt-divider mt-2 border-t pt-3">
            <div className="qt-text-secondary mb-2 text-xs uppercase tracking-wide">
              Recently
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {events.slice(-5).reverse().map((event, i) => (
                <li
                  key={`${event.ts}-${i}`}
                  className={
                    event.level === 'error'
                      ? 'qt-text-danger'
                      : event.level === 'warn'
                        ? 'qt-text-warning'
                        : 'qt-text-secondary'
                  }
                >
                  <span className="qt-text-secondary mr-2 tabular-nums">
                    {formatRelativeAge(event.ts, nowMs)}
                  </span>
                  {event.prettyLabel}
                  {event.detail && (
                    <span className="qt-text-secondary"> — {event.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {fetchError && !status && (
          <div className="qt-text-secondary animate-pulse text-sm">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
