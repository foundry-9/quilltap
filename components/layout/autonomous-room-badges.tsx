'use client'

/**
 * Autonomous Room Badges
 *
 * Compact handles in the page toolbar — one per autonomous chat that is
 * currently idle, paused, or running. Each badge abbreviates the chat
 * title (and the parent project, if any), shows a single budget-remaining
 * readout, and exposes an inline play/pause button.
 *
 * Polling mirrors the queue-status badges and the Settings → System
 * management list: 5s. A shared 1s clock (`useNow`) refreshes the time readout
 * between polls for running, time-budgeted rooms — that readout drifts because
 * the *client's* clock advances, so it never involves the server.
 *
 * @module components/layout/autonomous-room-badges
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useNow } from '@/hooks/useNow'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import { useAutonomousRoomAction } from '@/hooks/useAutonomousRoomAction'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

type RunState = 'idle' | 'running' | 'paused' | 'stopped' | 'budgetExhausted' | 'error'

interface AutonomousRoom {
  id: string
  title: string
  projectId: string | null
  projectName: string | null
  runState: RunState | null
  runStateMessage: string | null
  runStartedAt: string | null
  runEndedAt: string | null
  runPausedAccumMs: number
  runTurnsConsumed: number
  runTokensConsumed: number
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMs: number | null
}

const POLL_INTERVAL_MS = 5_000
const TICK_INTERVAL_MS = 1_000

function abbreviate(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .filter((c) => c.length > 0)
    .join('')
}

function trimZero(s: string): string {
  return s.replace(/\.0$/, '')
}

function formatTokens(n: number): string {
  n = Math.max(0, Math.floor(n))
  const K = 1024
  const M = K * K
  const G = M * K
  if (n < K) return String(n)
  if (n < M) {
    const v = n / K
    return `${v < 10 ? trimZero(v.toFixed(1)) : Math.round(v)}K`
  }
  if (n < G) {
    const v = n / M
    return `${v < 10 ? trimZero(v.toFixed(1)) : Math.round(v)}M`
  }
  const v = n / G
  return `${v < 10 ? trimZero(v.toFixed(1)) : Math.round(v)}B`
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

function timeRemainingMs(room: AutonomousRoom, nowMs: number): number {
  const max = room.budgetMaxWallClockMs
  if (!max) return 0
  if (!room.runStartedAt) return max
  const start = Date.parse(room.runStartedAt)
  if (Number.isNaN(start)) return max
  const end =
    room.runState === 'running'
      ? nowMs
      : room.runEndedAt
      ? Date.parse(room.runEndedAt)
      : nowMs
  // Exclude accumulated paused time so the countdown matches the budget check.
  const elapsed = (Number.isNaN(end) ? nowMs : end) - start - (room.runPausedAccumMs ?? 0)
  return Math.max(0, max - Math.max(0, elapsed))
}

type BudgetReadout =
  | { kind: 'tokens'; label: string; used: number; total: number }
  | { kind: 'messages'; label: string; used: number; total: number }
  | { kind: 'time'; label: string; usedMs: number; totalMs: number }
  | null

function selectBudgetReadout(room: AutonomousRoom, nowMs: number): BudgetReadout {
  if (room.budgetMaxTokens != null) {
    const total = room.budgetMaxTokens
    const used = Math.max(0, room.runTokensConsumed ?? 0)
    const remaining = Math.max(0, total - used)
    return { kind: 'tokens', label: formatTokens(remaining), used, total }
  }
  if (room.budgetMaxTurns != null) {
    const total = room.budgetMaxTurns
    const used = Math.max(0, room.runTurnsConsumed ?? 0)
    const remaining = Math.max(0, total - used)
    return { kind: 'messages', label: String(remaining), used, total }
  }
  if (room.budgetMaxWallClockMs != null) {
    const total = room.budgetMaxWallClockMs
    const remainingMs = timeRemainingMs(room, nowMs)
    const usedMs = Math.max(0, total - remainingMs)
    return { kind: 'time', label: formatTime(remainingMs), usedMs, totalMs: total }
  }
  return null
}

function buildLabel(room: AutonomousRoom): string {
  const chat = abbreviate(room.title || 'untitled')
  if (room.projectName) {
    const project = abbreviate(room.projectName)
    if (project) return `${project}:${chat || '?'}`
  }
  return chat || '?'
}

function buildTooltip(room: AutonomousRoom, readout: BudgetReadout): string {
  const projectLine = room.projectName ?? '(no project)'
  const titleLine = room.title || '(untitled autonomous room)'
  const status = room.runState ?? 'idle'
  let limitLine = 'no budget set'
  if (readout?.kind === 'tokens') {
    limitLine = `tokens: ${readout.used.toLocaleString()}/${readout.total.toLocaleString()}`
  } else if (readout?.kind === 'messages') {
    limitLine = `messages: ${readout.used}/${readout.total}`
  } else if (readout?.kind === 'time') {
    limitLine = `time: ${formatTime(readout.usedMs)}/${formatTime(readout.totalMs)}`
  }
  return `${projectLine}\n${titleLine}\n${limitLine}\nstatus: ${status}`
}


export function AutonomousRoomBadges() {
  const { data } = useQuery({
    queryKey: queryKeys.system.autonomousRooms,
    queryFn: ({ signal }) =>
      apiFetch<{ rooms: AutonomousRoom[] }>('/api/v1/system/autonomous-rooms', { signal, cache: 'no-store' }),
    // Pushed by the `autonomousRooms` topic; the 5 s poll is the fallback
    // for a dropped socket.
    refetchInterval: useRealtimeRefetchInterval(POLL_INTERVAL_MS),
  })
  const [busyChatId, setBusyChatId] = useState<string | null>(null)

  // Optimistic toggle: patch the cached run state immediately, roll back on
  // error, revalidate on settle. Shared with the Settings → System management
  // card — see hooks/useAutonomousRoomAction.
  const toggleMutation = useAutonomousRoomAction('Autonomous-room badge action failed')

  const rooms = (data?.rooms ?? []).filter(
    (r) => r.runState === 'idle' || r.runState === 'running' || r.runState === 'paused',
  )

  const hasTimeBudgetedRunning = rooms.some(
    (r) => r.runState === 'running' && r.budgetMaxWallClockMs != null,
  )

  // Only a running, time-budgeted room needs a second hand; everything else
  // reads a frozen snapshot and costs no re-renders at all.
  const nowMs = useNow(TICK_INTERVAL_MS, hasTimeBudgetedRunning)

  if (rooms.length === 0) return null

  const handleToggle = async (room: AutonomousRoom, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const isRunning = room.runState === 'running'
    const verb: 'pause' | 'resume' | 'start' = isRunning
      ? 'pause'
      : room.runState === 'paused'
      ? 'resume'
      : 'start'
    // The server flips the run state synchronously (start/resume → running,
    // pause → paused), so we can reflect it optimistically the instant the
    // button is clicked instead of waiting for the POST + revalidation
    // round-trip — which can lag when the server is busy running a turn.
    setBusyChatId(room.id)
    try {
      await toggleMutation.mutateAsync({ chatId: room.id, verb })
    } catch {
      // Already logged in the mutation's onError handler.
    } finally {
      setBusyChatId(null)
    }
  }

  return (
    <div className="qt-autonomous-badge-group">
      {rooms.map((room) => {
        const isRunning = room.runState === 'running'
        const readout = selectBudgetReadout(room, nowMs)
        const label = buildLabel(room)
        const tooltip = buildTooltip(room, readout)
        const colorClass = isRunning
          ? 'qt-autonomous-badge-running'
          : 'qt-autonomous-badge-idle'
        return (
          <a
            key={room.id}
            href={`/salon/${room.id}`}
            className={`qt-autonomous-badge ${colorClass}`}
            title={tooltip}
          >
            <span>{label}</span>
            {readout && <span>{readout.label}</span>}
            <button
              type="button"
              className="qt-autonomous-badge-button"
              onClick={(e) => handleToggle(room, e)}
              disabled={busyChatId === room.id}
              aria-label={isRunning ? 'Pause' : 'Resume'}
              title={isRunning ? 'Pause' : 'Resume'}
            >
              {isRunning ? <Icon name="pause" className="w-2.5 h-2.5" /> : <Icon name="play" className="w-2.5 h-2.5" />}
            </button>
          </a>
        )
      })}
    </div>
  )
}
