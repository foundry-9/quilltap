'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'
import { EditEnclaveModal } from '@/components/new-chat/EditEnclaveModal'

interface AutonomousRoom {
  id: string
  title: string
  participants: Array<{
    id: string
    type: string
    characterId: string | null
    status: string
  }>
  runState: 'idle' | 'running' | 'paused' | 'stopped' | 'budgetExhausted' | 'error' | null
  runStateMessage: string | null
  currentRunId: string | null
  runStartedAt: string | null
  runEndedAt: string | null
  runPausedAccumMs: number
  runTurnsConsumed: number
  runTokensConsumed: number
  scheduleCron: string | null
  scheduleNextRunAt: string | null
  scheduleLastRunAt: string | null
  scheduleFreshnessWindowMs: number | null
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMs: number | null
  budgetEstimatedSpendCapUSD: number | null
  runDestructiveToolsAllowed: number
  runVisibility: string | null
  createdAt: string
  updatedAt: string
}

function badgeClass(state: AutonomousRoom['runState']): string {
  switch (state) {
    case 'running': return 'qt-badge-autonomous-running'
    case 'idle': return 'qt-badge-autonomous-idle'
    case 'paused': return 'qt-badge-autonomous-paused'
    case 'stopped': return 'qt-badge-autonomous-stopped'
    case 'budgetExhausted': return 'qt-badge-autonomous-budget'
    case 'error': return 'qt-badge-autonomous-error'
    default: return 'qt-badge-autonomous-stopped'
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function summarizeBudget(room: AutonomousRoom): string {
  const parts: string[] = []
  if (room.budgetMaxTurns != null) parts.push(`${room.runTurnsConsumed}/${room.budgetMaxTurns} turns`)
  else parts.push(`${room.runTurnsConsumed} turns`)
  if (room.budgetMaxTokens != null) parts.push(`${room.runTokensConsumed.toLocaleString()}/${room.budgetMaxTokens.toLocaleString()} tokens`)
  else parts.push(`${room.runTokensConsumed.toLocaleString()} tokens`)
  if (room.budgetMaxWallClockMs != null && room.runStartedAt) {
    // Exclude accumulated paused time so the readout matches the budget check.
    const elapsedMs = (room.runEndedAt ? Date.parse(room.runEndedAt) : Date.now()) - Date.parse(room.runStartedAt) - (room.runPausedAccumMs ?? 0)
    parts.push(`${Math.round(Math.max(0, elapsedMs) / 60000)}/${Math.round(room.budgetMaxWallClockMs / 60000)} min`)
  }
  return parts.join(' · ')
}

/** Fallback poll cadence while the realtime socket is down. */
const ROOMS_POLL_INTERVAL_MS = 5_000

export function AutonomousRoomsCard() {
  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.system.autonomousRooms,
    queryFn: ({ signal }) => apiFetch<{ rooms: AutonomousRoom[] }>('/api/v1/system/autonomous-rooms', { signal }),
    // Same reading as the toolbar badges: pushed by `autonomousRooms`, with
    // the original 5 s cadence held in reserve.
    refetchInterval: useRealtimeRefetchInterval(ROOMS_POLL_INTERVAL_MS),
  })
  const [busyChatId, setBusyChatId] = useState<string | null>(null)
  const [editRoom, setEditRoom] = useState<{ id: string; title: string } | null>(null)

  // The server flips the run state synchronously, so reflect it optimistically
  // the instant the button is clicked rather than waiting for the POST +
  // revalidation round-trip (which can lag while a turn is running). onMutate
  // applies the optimistic patch, onError rolls back, onSettled revalidates —
  // the TanStack equivalent of SWR's mutate(post, { optimisticData, rollbackOnError }).
  const actionMutation = useMutation({
    mutationFn: async ({ chatId, verb }: { chatId: string; verb: 'start' | 'pause' | 'stop' | 'resume' }) => {
      const res = await fetch(`/api/v1/chats/${chatId}/autonomous-room?action=${verb}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Failed to ${verb}`)
      }
    },
    onMutate: async ({ chatId, verb }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.system.autonomousRooms })
      const previous = queryClient.getQueryData<{ rooms: AutonomousRoom[] }>(queryKeys.system.autonomousRooms)
      const optimisticState: AutonomousRoom['runState'] =
        verb === 'pause' ? 'paused' : verb === 'stop' ? 'stopped' : 'running'
      queryClient.setQueryData<{ rooms: AutonomousRoom[] }>(queryKeys.system.autonomousRooms, (cur) => ({
        rooms: (cur?.rooms ?? []).map((r) => (r.id === chatId ? { ...r, runState: optimisticState } : r)),
      }))
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.system.autonomousRooms, context.previous)
      }
      console.error('Autonomous-room action failed', err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.system.autonomousRooms })
    },
  })

  const action = async (chatId: string, verb: 'start' | 'pause' | 'stop' | 'resume') => {
    setBusyChatId(chatId)
    try {
      await actionMutation.mutateAsync({ chatId, verb })
    } catch {
      // Already logged in the mutation's onError handler.
    } finally {
      setBusyChatId(null)
    }
  }

  if (isLoading) {
    return <div className="qt-text-secondary">Loading autonomous rooms…</div>
  }
  if (error) {
    return <div className="qt-alert-error">Failed to load autonomous rooms.</div>
  }
  const allRooms = data?.rooms ?? []
  const rooms = allRooms.filter((room) => {
    if (room.scheduleCron) return true
    return room.runState === 'idle' || room.runState === 'running' || room.runState === 'paused'
  })
  if (rooms.length === 0) {
    return (
      <div className="qt-text-small qt-text-muted">
        No active autonomous rooms. Cron-scheduled rooms always appear here; ad-hoc rooms appear while idle, running, or paused.
      </div>
    )
  }

  return (
    <>
    <div className="space-y-3">
      {rooms.map((room) => {
        const state = room.runState ?? 'idle'
        const isRunning = state === 'running'
        const canStart = state === 'idle' || state === 'paused' || state === 'budgetExhausted' || state === 'stopped'
        return (
          <div key={room.id} className="border qt-border-default rounded p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`/salon/${room.id}`}
                    className="font-medium text-foreground hover:underline truncate"
                  >
                    {room.title || '(untitled autonomous room)'}
                  </a>
                  <span className={`qt-badge text-xs ${badgeClass(state)}`}>
                    {state}
                  </span>
                  {room.scheduleCron && (
                    <span className="qt-badge qt-badge-auto text-xs">
                      cron: {room.scheduleCron}
                    </span>
                  )}
                  {!room.scheduleCron && (
                    <span className="qt-badge qt-badge-manual text-xs">
                      manual
                    </span>
                  )}
                </div>
                <div className="qt-text-small mt-1">
                  <span>Last run: {formatTimestamp(room.scheduleLastRunAt)}</span>
                  <span className="mx-2">·</span>
                  <span>Next run: {formatTimestamp(room.scheduleNextRunAt)}</span>
                </div>
                <div className="qt-text-small">
                  {summarizeBudget(room)}
                </div>
                {room.runStateMessage && (
                  <div className="qt-text-small qt-text-muted italic mt-1">
                    {room.runStateMessage}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1 shrink-0">
                <button
                  className="qt-button-secondary text-xs px-2 py-1"
                  onClick={() => action(room.id, isRunning ? 'pause' : state === 'paused' ? 'resume' : 'start')}
                  disabled={busyChatId === room.id || (!isRunning && !canStart)}
                >
                  {isRunning ? 'Pause' : (state === 'paused' || state === 'budgetExhausted' ? 'Resume' : 'Start')}
                </button>
                <button
                  className="qt-button-secondary text-xs px-2 py-1"
                  onClick={() => action(room.id, 'stop')}
                  disabled={busyChatId === room.id || state === 'stopped'}
                >
                  Stop
                </button>
                <button
                  className="qt-button-secondary text-xs px-2 py-1"
                  onClick={() => setEditRoom({ id: room.id, title: room.title })}
                  disabled={busyChatId === room.id}
                  title="Edit this enclave’s schedule, budget, and visibility"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
    {editRoom && (
      <EditEnclaveModal
        isOpen={true}
        onClose={() => setEditRoom(null)}
        chatId={editRoom.id}
        currentTitle={editRoom.title}
        onSaved={() => {
          setEditRoom(null)
          refetch()
        }}
      />
    )}
    </>
  )
}
