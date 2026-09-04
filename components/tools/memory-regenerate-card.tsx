'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useJobFanOutStatus } from './hooks/useJobFanOutStatus'
import { writeErrorText } from './hooks/api-error-text'

interface RegenerateStatus {
  inFlightFanOut?: number
  inFlightWipes?: number
  inFlightExtractions?: number
  inFlight?: number
}

const STATUS_URL = '/api/v1/memories?action=regenerate-all'
/** Fallback poll cadence, used only while the realtime socket is down. */
const POLL_INTERVAL_MS = 5000

export function MemoryRegenerateCard() {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // The sweep is a fan-out of background jobs, so it drains visibly on the
  // `jobs` topic. Only while something is actually in flight, matching what the
  // old poll did — an idle card has no reason to re-read on every unrelated job.
  const { data: status } = useJobFanOutStatus<RegenerateStatus>({
    queryKey: queryKeys.memories.regenerateStatus,
    url: STATUS_URL,
    pollMs: POLL_INTERVAL_MS,
    inFlightOf: s => s.inFlight ?? 0,
  })
  const inFlight = status?.inFlight ?? 0
  const inFlightFanOut = status?.inFlightFanOut ?? 0
  const inFlightWipes = status?.inFlightWipes ?? 0
  const inFlightExtractions = status?.inFlightExtractions ?? 0

  const regenerate = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>(STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: async data => {
      showSuccessToast(data.message || 'Regeneration enqueued — chats will rebuild in the background')
      notifyQueueChange()
      // Refresh status so the badge in this card lights up immediately.
      await queryClient.invalidateQueries({ queryKey: queryKeys.memories.regenerateStatus })
      setConfirming(false)
    },
    onError: err => {
      const msg = writeErrorText(err, 'Failed to start regeneration')
      setError(msg)
      showErrorToast(msg)
    },
  })
  const submitting = regenerate.isPending

  const handleConfirm = () => {
    setError(null)
    regenerate.mutate()
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Wipes every memory linked to a conversation and re-runs the current extraction pipeline against the chat
        history. Manual memories that aren&rsquo;t tied to a chat are left alone. Memories whose chat has already
        been deleted are removed too. The work runs in the background; close this tab and come back whenever.
      </p>

      {status && inFlight > 0 && (
        <p className="qt-text-small qt-text-muted">
          In flight:{' '}
          {inFlightFanOut > 0 && (
            <>
              {inFlightFanOut} fan-out{inFlightFanOut === 1 ? '' : 's'} (building chat list),{' '}
            </>
          )}
          {inFlightWipes} chat wipe{inFlightWipes === 1 ? '' : 's'},{' '}
          {inFlightExtractions} extraction{inFlightExtractions === 1 ? '' : 's'}.
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
