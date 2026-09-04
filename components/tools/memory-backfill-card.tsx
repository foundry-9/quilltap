'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useJobFanOutStatus } from './hooks/useJobFanOutStatus'
import { readErrorText, writeErrorText } from './hooks/api-error-text'

interface BackfillProgress {
  remaining: number
  inFlight: number
}

const BACKFILL_URL = '/api/v1/memories?action=backfill-embeddings'
/** Fallback poll cadence, used only while the realtime socket is down. */
const FALLBACK_POLL_INTERVAL_MS = 4_000

export function MemoryBackfillCard() {
  const [actionError, setActionError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Live path: the backfill runs as background jobs, so every completion moves
  // the `jobs` topic and re-reads progress the moment it changes. The
  // repeating 4 s poll is the fallback for a dropped socket.
  const {
    data,
    isLoading: loading,
    error: loadError,
    dataUpdatedAt,
  } = useJobFanOutStatus<{ progress: BackfillProgress }>({
    queryKey: queryKeys.memories.backfillProgress,
    url: BACKFILL_URL,
    pollMs: FALLBACK_POLL_INTERVAL_MS,
  })
  const progress = data?.progress ?? null

  // A successful (re)read wipes a stale start error, as the old shared error
  // state did on every progress tick.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the action error once fresh progress lands
    if (dataUpdatedAt) setActionError(null)
  }, [dataUpdatedAt])

  const start = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string; enqueued?: number }>(BACKFILL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 500 }),
      }),
    onSuccess: async data => {
      showSuccessToast(data.message || `Enqueued ${data.enqueued} embedding jobs`)
      await queryClient.invalidateQueries({ queryKey: queryKeys.memories.backfillProgress })
    },
    onError: err => {
      const msg = writeErrorText(err, 'Failed to start backfill')
      setActionError(msg)
      showErrorToast(msg)
    },
  })
  const running = start.isPending

  const handleStart = () => {
    setActionError(null)
    start.mutate()
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading backfill status&hellip;</p>
  }

  const error =
    actionError ?? (loadError ? readErrorText(loadError, 'Failed to load backfill progress') : null)
  const remaining = progress?.remaining ?? 0
  const inFlight = progress?.inFlight ?? 0

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Some older memories may not carry an embedding &mdash; usually because the pre-write gate fell back to a keyword check when the embedding provider was briefly unavailable, or because the memory was imported before the gate became embedding-aware. Such memories can&rsquo;t be found by semantic search and are invisible to the deduplication gate, which lets phrase-variants accumulate. Running the backfill enqueues an embedding job for each of them so they rejoin the fold.
      </p>

      <div className="qt-body">
        <div className="flex items-center gap-4">
          <div>
            <span className="qt-text-muted">Memories missing an embedding: </span>
            <strong>{remaining.toLocaleString()}</strong>
          </div>
          <div>
            <span className="qt-text-muted">Embedding jobs in flight: </span>
            <strong>{inFlight.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="qt-button qt-button-secondary"
          disabled={running || remaining === 0}
          onClick={handleStart}
        >
          {remaining === 0 ? 'Nothing to backfill' : `Backfill up to 500 memories`}
        </button>
        <span className="qt-text-small qt-text-muted">
          Run repeatedly for large backlogs. Jobs drain in the background.
        </span>
      </div>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
