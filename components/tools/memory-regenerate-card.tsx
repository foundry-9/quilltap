'use client'

import { useCallback, useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { useRealtimeFallbackPoll, useRealtimeTopic } from '@/hooks/useRealtime'

interface RegenerateStatus {
  inFlightFanOut: number
  inFlightWipes: number
  inFlightExtractions: number
  inFlight: number
}

/** Fallback poll cadence, used only while the realtime socket is down. */
const POLL_INTERVAL_MS = 5000

export function MemoryRegenerateCard() {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<RegenerateStatus | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/memories?action=regenerate-all')
      if (!res.ok) return
      const data = await res.json()
      setStatus({
        inFlightFanOut: data.inFlightFanOut ?? 0,
        inFlightWipes: data.inFlightWipes ?? 0,
        inFlightExtractions: data.inFlightExtractions ?? 0,
        inFlight: data.inFlight ?? 0,
      })
    } catch {
      // Status read failures aren't fatal — the UI still works without it.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!cancelled) await loadStatus()
    })()
    return () => {
      cancelled = true
    }
  }, [loadStatus])

  // The sweep is a fan-out of background jobs, so it drains visibly on the
  // `jobs` topic. Only while something is actually in flight, matching what the
  // old poll did — an idle card has no reason to re-read on every unrelated job.
  useRealtimeTopic('jobs', () => {
    if ((status?.inFlight ?? 0) > 0) void loadStatus()
  })

  // Fallback: re-read on a timer while a sweep is in flight and the socket is down.
  useRealtimeFallbackPoll(() => {
    void loadStatus()
  }, POLL_INTERVAL_MS, (status?.inFlight ?? 0) > 0)

  const handleConfirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/memories?action=regenerate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start regeneration')
      }
      const data = await res.json()
      showSuccessToast(data.message || 'Regeneration enqueued — chats will rebuild in the background')
      notifyQueueChange()
      // Refresh status so the badge in this card lights up immediately.
      await loadStatus()
      setConfirming(false)
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to start regeneration')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Wipes every memory linked to a conversation and re-runs the current extraction pipeline against the chat
        history. Manual memories that aren&rsquo;t tied to a chat are left alone. Memories whose chat has already
        been deleted are removed too. The work runs in the background; close this tab and come back whenever.
      </p>

      {status && status.inFlight > 0 && (
        <p className="qt-text-small qt-text-muted">
          In flight:{' '}
          {status.inFlightFanOut > 0 && (
            <>
              {status.inFlightFanOut} fan-out{status.inFlightFanOut === 1 ? '' : 's'} (building chat list),{' '}
            </>
          )}
          {status.inFlightWipes} chat wipe{status.inFlightWipes === 1 ? '' : 's'},{' '}
          {status.inFlightExtractions} extraction{status.inFlightExtractions === 1 ? '' : 's'}.
        </p>
      )}

      {!confirming ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="qt-button qt-button-danger"
            disabled={submitting}
            onClick={() => setConfirming(true)}
          >
            Delete and regenerate all memories
          </button>
          <span className="qt-text-small qt-text-muted">Affects every chat-linked memory across all characters.</span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="qt-body">
            This will delete and rebuild every chat-linked memory. Continue?
          </span>
          <button
            type="button"
            className="qt-button qt-button-danger"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? 'Enqueuing…' : 'Yes, regenerate'}
          </button>
          <button
            type="button"
            className="qt-button qt-button-secondary"
            disabled={submitting}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
