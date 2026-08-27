'use client'

import { useCallback, useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { useRealtimeFallbackPoll, useRealtimeTopic } from '@/hooks/useRealtime'

interface BackfillProgress {
  remaining: number
  inFlight: number
}

/** Fallback poll cadence, used only while the realtime socket is down. */
const FALLBACK_POLL_INTERVAL_MS = 4_000

export function MemoryBackfillCard() {
  const [progress, setProgress] = useState<BackfillProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/memories?action=backfill-embeddings')
      if (!response.ok) {
        throw new Error('Failed to load backfill progress')
      }
      const data = await response.json()
      setProgress(data.progress)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load backfill progress'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Live path: the backfill runs as background jobs, so every completion moves
  // the `jobs` topic and re-reads progress the moment it changes.
  useRealtimeTopic('jobs', fetchProgress)

  useEffect(() => {
    // The first tick fires almost immediately so the user doesn't wait for a
    // round trip to see the initial load.
    const firstTick = setTimeout(() => {
      void fetchProgress()
    }, 0)
    return () => clearTimeout(firstTick)
  }, [fetchProgress])

  // The repeating 4 s poll is the fallback for a dropped socket.
  useRealtimeFallbackPoll(() => {
    void fetchProgress()
  }, FALLBACK_POLL_INTERVAL_MS)

  const handleStart = async () => {
    setRunning(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/memories?action=backfill-embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: 500 }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start backfill')
      }
      const data = await response.json()
      showSuccessToast(data.message || `Enqueued ${data.enqueued} embedding jobs`)
      await fetchProgress()
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to start backfill')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading backfill status&hellip;</p>
  }

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
