'use client';

/**
 * ProgressBar — the app's one segmented task-progress bar.
 *
 * A bar of named segments, one per phase of whatever long operation is running.
 * Completed segments are full, the active one animates toward ~90% over its
 * estimated duration (never to 100%, so a slow phase reads as "still working"
 * rather than "finished and stuck"), and the rest sit empty.
 *
 * Lifted out of the character optimizer, which was the only real progress bar
 * in the app, when The Almanack needed the same thing. Both now drive it, so
 * the segments are a prop rather than a module constant.
 *
 * Styling comes entirely from the `qt-progress` class family — no raw colour
 * utilities — so a theme can restyle every bar in the app from two variables.
 *
 * @module components/ui/ProgressBar
 */

import { useEffect, useRef, useState } from 'react';

export interface ProgressSegment {
  /** Stable key; also what {@link ProgressBarProps.currentKey} is matched against. */
  key: string;
  /** Short label rendered under the bar. */
  label: string;
  /**
   * Roughly how long this phase takes. Only drives the fill animation — a
   * segment that outlives its estimate holds at 90% rather than overflowing.
   */
  estimatedDurationMs: number;
}

export interface ProgressBarProps {
  segments: ProgressSegment[];
  /** The phase currently running, or `null` when finished (or not yet started). */
  currentKey: string | null;
  /** When the operation began; drives the elapsed timer. `null` hides it. */
  startedAt: number | null;
  /**
   * True between "started" and the first phase event, when there is nothing
   * honest to show a width for. Renders the sliding indeterminate animation.
   */
  indeterminate?: boolean;
  /** Hide the per-segment labels — for bars in tight rows. */
  hideLabels?: boolean;
  className?: string;
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function ProgressBar({
  segments,
  currentKey,
  startedAt,
  indeterminate = false,
  hideLabels = false,
  className = '',
}: ProgressBarProps) {
  const [fillPercents, setFillPercents] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartTimeRef = useRef<Record<string, number>>({});

  const currentIndex = currentKey ? segments.findIndex(s => s.key === currentKey) : -1;

  // Stamp each segment the first time it becomes current, so its fill animates
  // from when it actually started rather than from when the bar mounted.
  useEffect(() => {
    if (currentKey && !segmentStartTimeRef.current[currentKey]) {
      segmentStartTimeRef.current[currentKey] = Date.now();
    }
  }, [currentKey]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      // "No current phase, but we did start" is the finished state — as opposed
      // to "no current phase because nothing has begun".
      const isDone = currentKey === null && startedAt !== null;

      setFillPercents(() => {
        const next: Record<string, number> = {};
        for (const [index, segment] of segments.entries()) {
          if (isDone || index < currentIndex) {
            next[segment.key] = 100;
          } else if (index === currentIndex) {
            const startTime = segmentStartTimeRef.current[segment.key] ?? now;
            next[segment.key] =
              Math.min((now - startTime) / segment.estimatedDurationMs, 0.9) * 100;
          } else {
            next[segment.key] = 0;
          }
        }
        return next;
      });

      if (startedAt) {
        setElapsed(Math.floor((now - startedAt) / 1000));
      }
    }, 500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [segments, currentKey, currentIndex, startedAt]);

  const finished = currentKey === null && startedAt !== null;

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      <div className="flex gap-1">
        {segments.map((segment, index) => {
          const isActive = index === currentIndex;
          const isDone = finished || index < currentIndex;
          const showIndeterminate = indeterminate && index === 0;

          const fillState = isDone
            ? 'qt-progress-fill-success'
            : isActive || showIndeterminate
              ? ''
              : 'qt-progress-fill-idle';

          return (
            <div key={segment.key} className="qt-progress flex-1" title={segment.label}>
              <div
                className={`qt-progress-fill ${fillState} ${
                  showIndeterminate ? 'qt-progress-indeterminate' : ''
                }`.trim()}
                style={showIndeterminate ? undefined : { width: `${fillPercents[segment.key] ?? 0}%` }}
              />
            </div>
          );
        })}
      </div>

      {!hideLabels && (
        <div className="flex justify-between">
          <div className="flex gap-2">
            {segments.map((segment, index) => {
              const isActive = index === currentIndex;
              const isDone = finished || index < currentIndex;
              return (
                <span
                  key={segment.key}
                  className={`text-[10px] ${
                    isActive
                      ? 'text-primary font-medium'
                      : isDone
                        ? 'qt-text-success'
                        : 'qt-text-secondary'
                  }`}
                >
                  {segment.label}
                </span>
              );
            })}
          </div>
          {startedAt !== null && (
            <span className="text-[10px] qt-text-secondary tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
