'use client'

import { useEffect, useRef, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'

const DEFAULT_STALE_CHAT_DAYS = 30
const MIN_DAYS = 1
const MAX_DAYS = 3650

/**
 * The instance-wide stale-chat retention window
 * (`instance_settings['dataRetention']`). Read daily by the maintenance sweep
 * to decide when a quiet conversation's regenerable working data (compression
 * caches, rendered markdown, model scratch-work, cold-tier chunk embeddings)
 * is tidied away. Global only — there is deliberately no per-chat control.
 */
export function DataRetentionSettings() {
  const [days, setDays] = useState<number>(DEFAULT_STALE_CHAT_DAYS)
  const [draft, setDraft] = useState<string>(String(DEFAULT_STALE_CHAT_DAYS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedDays = useRef<number>(DEFAULT_STALE_CHAT_DAYS)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/v1/settings/data-retention')
        if (!response.ok) {
          throw new Error('Failed to load data-retention settings')
        }
        const data = await response.json()
        const loaded = typeof data?.staleChatDays === 'number' ? data.staleChatDays : DEFAULT_STALE_CHAT_DAYS
        if (!cancelled) {
          setDays(loaded)
          setDraft(String(loaded))
          savedDays.current = loaded
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load data-retention settings'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const commit = async () => {
    const parsed = Math.floor(Number(draft))
    if (!Number.isFinite(parsed) || parsed < MIN_DAYS || parsed > MAX_DAYS) {
      // Revert an unusable entry rather than nag — the bounds live in the copy.
      setDraft(String(days))
      return
    }
    if (parsed === savedDays.current) {
      setDraft(String(parsed))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/settings/data-retention', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staleChatDays: parsed }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save data-retention settings')
      }
      setDays(parsed)
      setDraft(String(parsed))
      savedDays.current = parsed
      showSuccessToast('Retention window saved')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save data-retention settings')
      setError(msg)
      showErrorToast(msg)
      setDraft(String(days))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading retention settings&hellip;</p>
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        A conversation left to gather dust accumulates a surprising amount of behind-the-scenes
        paraphernalia — compression caches, pre-rendered pages, the models&rsquo; own scratch-work.
        Once a chat has gone this many days without anyone actually speaking in it, Quilltap&rsquo;s
        nightly housekeeping quietly tidies that working data away. The conversation itself — every
        word anyone said — remains exactly as you left it, and the tidied bits are rebuilt the
        moment you take up the thread again.
      </p>

      <div>
        <label htmlFor="stale-chat-days" className="qt-text-label block mb-2">
          Keep inactive chats&rsquo; working data for
        </label>
        <div className="flex items-center gap-2">
          <input
            id="stale-chat-days"
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            disabled={saving}
            className="qt-input w-28"
          />
          <span className="qt-text-small qt-text-secondary">days ({MIN_DAYS}&ndash;{MAX_DAYS}; the default is {DEFAULT_STALE_CHAT_DAYS})</span>
        </div>
        <p className="qt-text-xs qt-text-secondary mt-1">
          Applies to the whole establishment — there is no per-chat dial. Announcements from the
          Staff don&rsquo;t count as activity; only you and your characters do.
        </p>
      </div>

      {error && <p className="qt-text-small qt-text-error">{error}</p>}
    </div>
  )
}
