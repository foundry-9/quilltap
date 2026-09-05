'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useJobFanOutStatus } from './hooks/useJobFanOutStatus'
import { writeErrorText } from './hooks/api-error-text'

const STATUS_URL = '/api/v1/system/conversation-summaries?action=regenerate'
/** Fallback poll cadence, used only while the realtime socket is down. */
const POLL_INTERVAL_MS = 5000

export function ConversationSummaryRegenerateCard() {
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // The regeneration is a fan-out of background jobs, so it drains on the
  // `jobs` topic — but only while something is in flight, matching the old
  // poll's scope rather than re-reading on every unrelated job.
  const { data: status } = useJobFanOutStatus<{ inFlight?: number }>({
    queryKey: queryKeys.system.conversationSummaryRegenerate,
    url: STATUS_URL,
    pollMs: POLL_INTERVAL_MS,
    inFlightOf: s => s.inFlight ?? 0,
  })
  const inFlight = status?.inFlight ?? 0

  const regenerate = useMutation({
    mutationFn: () =>
      apiFetch<{ message?: string }>(STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: async data => {
      showSuccessToast(data.message || 'Conversation summaries are being re-mirrored in the background')
      notifyQueueChange()
      await queryClient.invalidateQueries({ queryKey: queryKeys.system.conversationSummaryRegenerate })
    },
    onError: err => {
      const msg = writeErrorText(err, 'Failed to start regeneration')
      setError(msg)
      showErrorToast(msg)
    },
  })
  const submitting = regenerate.isPending

  const handleClick = () => {
    setError(null)
    regenerate.mutate()
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Re-mirrors every summarised conversation into each participant&rsquo;s vault under{' '}
        <code>Conversation Summaries/</code>, where the Commonplace Book draws the &ldquo;relevant past
        conversations&rdquo; it offers a character before their turn. Run this to seed those files for older
        chats, or to repair them after a format change. Nothing is deleted that isn&rsquo;t replaced; the work
        runs in the background, so you may close this tab and come back whenever.
      </p>

      {inFlight > 0 && (
        <p className="qt-text-small qt-text-muted">
          In flight: {inFlight} regeneration{inFlight === 1 ? '' : 's'}.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="qt-button qt-button-primary"
          disabled={submitting}
          onClick={handleClick}
        >
          {submitting ? 'Enqueuing…' : 'Regenerate conversation summaries'}
        </button>
        <span className="qt-text-small qt-text-muted">Re-mirrors every summarised chat across all characters.</span>
      </div>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
