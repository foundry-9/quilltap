'use client'

import { useCallback, useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { useRealtimeConnected, useRealtimeTopic } from '@/hooks/useRealtime'

const STATUS_URL = '/api/v1/system/conversation-summaries?action=regenerate'
/** Fallback poll cadence, used only while the realtime socket is down. */
const POLL_INTERVAL_MS = 5000

export function ConversationSummaryRegenerateCard() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inFlight, setInFlight] = useState<number>(0)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(STATUS_URL)
      if (res.ok) {
        const data = await res.json()
        setInFlight(data.inFlight ?? 0)
      }
    } catch {
      // Status failures aren't fatal — the button still works.
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

  // The regeneration is a fan-out of background jobs, so it drains on the
  // `jobs` topic — but only while something is in flight, matching the old
  // poll's scope rather than re-reading on every unrelated job.
  useRealtimeTopic('jobs', () => {
    if (inFlight > 0) void loadStatus()
  })

  // Fallback: a timer while work is in flight and the socket is down.
  const connected = useRealtimeConnected()
  useEffect(() => {
    if (connected || inFlight === 0) return
    const interval = setInterval(() => {
      void loadStatus()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [connected, inFlight, loadStatus])

  const handleClick = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(STATUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start regeneration')
      }
      const data = await res.json()
      showSuccessToast(data.message || 'Conversation summaries are being re-mirrored in the background')
      notifyQueueChange()
      await loadStatus()
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
