'use client'

import { useEffect, useRef, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'

const DEFAULT_MAX_AGENT_TURNS = 50
const MIN_TURNS = 5
const MAX_TURNS = 200

/**
 * The instance-wide Brahma Console agent-turn budget
 * (`instance_settings['brahmaConsole']`). Read at the start of every Console
 * query — and every one-shot `@Brahma` consultation — to cap how many tool-use
 * rounds the engine may take before it must answer. Global only; there is no
 * per-conversation dial.
 */
export function BrahmaConsoleSettings() {
  const [turns, setTurns] = useState<number>(DEFAULT_MAX_AGENT_TURNS)
  const [draft, setDraft] = useState<string>(String(DEFAULT_MAX_AGENT_TURNS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedTurns = useRef<number>(DEFAULT_MAX_AGENT_TURNS)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/v1/settings/brahma-console')
        if (!response.ok) {
          throw new Error('Failed to load Brahma Console settings')
        }
        const data = await response.json()
        const loaded = typeof data?.maxAgentTurns === 'number' ? data.maxAgentTurns : DEFAULT_MAX_AGENT_TURNS
        if (!cancelled) {
          setTurns(loaded)
          setDraft(String(loaded))
          savedTurns.current = loaded
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load Brahma Console settings'))
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
    if (!Number.isFinite(parsed) || parsed < MIN_TURNS || parsed > MAX_TURNS) {
      // Revert an unusable entry rather than nag — the bounds live in the copy.
      setDraft(String(turns))
      return
    }
    if (parsed === savedTurns.current) {
      setDraft(String(parsed))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/settings/brahma-console', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgentTurns: parsed }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save Brahma Console settings')
      }
      setTurns(parsed)
      setDraft(String(parsed))
      savedTurns.current = parsed
      showSuccessToast('Console turn budget saved')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save Brahma Console settings')
      setError(msg)
      showErrorToast(msg)
      setDraft(String(turns))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading Console settings&hellip;</p>
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Put a knotty question to the Brahma Console &mdash; &ldquo;where in the ledgers is such-and-such
        buried?&rdquo; &mdash; and it sets about the search one step at a time: a query here, a document
        read there, each a <em>turn</em> at the telegraph key. This dial sets how many turns it may
        take on a single question before it must down tools and tell you what it has found so far.
        Raise it when the Console keeps running out of rope mid-investigation; the higher ceiling
        costs nothing on questions it answers quickly.
      </p>

      <div>
        <label htmlFor="brahma-max-turns" className="qt-text-label block mb-2">
          Let the Console take up to
        </label>
        <div className="flex items-center gap-2">
          <input
            id="brahma-max-turns"
            type="number"
            min={MIN_TURNS}
            max={MAX_TURNS}
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
          <span className="qt-text-small qt-text-secondary">turns ({MIN_TURNS}&ndash;{MAX_TURNS}; the default is {DEFAULT_MAX_AGENT_TURNS})</span>
        </div>
        <p className="qt-text-xs qt-text-secondary mt-1">
          A generous budget only helps a Console that is making headway. Should it fall to asking the
          same question twice over, Quilltap notices the engine chasing its own tail and calls a halt
          regardless of this figure &mdash; so raising the ceiling never lets a truly stuck search run
          on and on.
        </p>
      </div>

      {error && <p className="qt-text-small qt-text-error">{error}</p>}
    </div>
  )
}
