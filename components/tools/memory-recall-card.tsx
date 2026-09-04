'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { readErrorText } from './hooks/api-error-text'

type ScopePolicy = 'down-weight' | 'exclude'

interface RecallConfig {
  scopePolicy: ScopePolicy
  expandRelated: boolean
  perTurnConversationSummaries: boolean
}

const DEFAULT_CONFIG: RecallConfig = {
  scopePolicy: 'down-weight',
  expandRelated: false,
  perTurnConversationSummaries: false,
}

const RECALL_CONFIG_URL = '/api/v1/memories?action=recall-config'

const SCOPE_POLICY_OPTIONS: ReadonlyArray<{
  value: ScopePolicy
  label: string
  description: string
}> = [
  {
    value: 'down-weight',
    label: 'Down-weight (recommended)',
    description:
      'Apply a strong penalty so a memory tied to another project rarely surfaces here — but never fully hide it. A powerful match can still break through.',
  },
  {
    value: 'exclude',
    label: 'Exclude',
    description:
      'Drop project-specific memories from other projects out of this chat entirely. The firmest guard against cross-project leakage.',
  },
]

/**
 * The cross-project scope policy for the Commonplace Book recall path. Instance-
 * wide setting (`instance_settings['memoryRecall']`) read on every turn by the
 * recall path; see lib/memory/recall-tags.ts.
 */
export function MemoryRecallCard() {
  const [config, setConfig] = useState<RecallConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    data: loaded,
    isLoading: loading,
    error: loadError,
  } = useQuery({
    queryKey: queryKeys.memories.recallConfig,
    queryFn: ({ signal }) =>
      apiFetch<{ settings?: Partial<RecallConfig> }>(RECALL_CONFIG_URL, { signal }),
  })

  // Seed the editable form from the server's settings whenever a fresh read lands.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form is local state seeded from the query
    if (loaded?.settings) setConfig({ ...DEFAULT_CONFIG, ...loaded.settings })
  }, [loaded])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- surface the read failure in the shared error line
    if (loadError) setError(readErrorText(loadError, 'Failed to load recall settings'))
  }, [loadError])

  const saveConfig = async (next: Partial<RecallConfig>) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(RECALL_CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save recall settings')
      }
      const data = await response.json()
      setConfig({ ...DEFAULT_CONFIG, ...data.settings })
      showSuccessToast('Recall settings saved')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save recall settings')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleScopePolicyChange = (value: ScopePolicy) => {
    setConfig(c => ({ ...c, scopePolicy: value }))
    void saveConfig({ scopePolicy: value })
  }

  const handleExpandRelatedChange = (value: boolean) => {
    setConfig(c => ({ ...c, expandRelated: value }))
    void saveConfig({ expandRelated: value })
  }

  const handlePerTurnConversationsChange = (value: boolean) => {
    setConfig(c => ({ ...c, perTurnConversationSummaries: value }))
    void saveConfig({ perTurnConversationSummaries: value })
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading recall settings&hellip;</p>
  }

  const activePolicy = SCOPE_POLICY_OPTIONS.find(o => o.value === config.scopePolicy)

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        When a character files away something true only inside a particular project or story, that memory shouldn&rsquo;t come wandering into an unrelated conversation. This setting decides what becomes of such a memory when it tries to surface in a chat belonging to a different project.
      </p>

      <div>
        <label className="qt-text-label block mb-2">Cross-project memories:</label>
        <select
          value={config.scopePolicy}
          onChange={e => handleScopePolicyChange(e.target.value as ScopePolicy)}
          disabled={saving}
          className="qt-select w-full"
        >
          {SCOPE_POLICY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {activePolicy && (
          <p className="qt-text-xs qt-text-secondary mt-1">{activePolicy.description}</p>
        )}
      </div>

      <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
        <input
          type="checkbox"
          checked={config.expandRelated}
          onChange={e => handleExpandRelatedChange(e.target.checked)}
          disabled={saving}
          className="mt-1 qt-checkbox"
        />
        <div className="flex-1">
          <div className="font-medium text-foreground">Follow the threads between memories</div>
          <div className="qt-text-small mt-1">
            When a memory surfaces, gather the handful of others it is bound to and let them
            compete for a place in the recollection too. This rescues the memory that is plainly
            relevant by association yet never quite matched the words of the moment. A touch more
            work each turn; left off unless you ask for it.
          </div>
        </div>
      </label>

      <label className="flex items-start gap-3 p-4 border qt-border-default rounded qt-hover-accent cursor-pointer">
        <input
          type="checkbox"
          checked={config.perTurnConversationSummaries}
          onChange={e => handlePerTurnConversationsChange(e.target.checked)}
          disabled={saving}
          className="mt-1 qt-checkbox"
        />
        <div className="flex-1">
          <div className="font-medium text-foreground">Consult past conversations every turn</div>
          <div className="qt-text-small mt-1">
            Ordinarily the Book re-reads its shelf of past conversations only at the opening of a
            chat, whenever it takes down a fresh summary, and when somebody speaks of days gone by.
            Switch this on and it consults that shelf on <em>every</em> turn, so the list of
            pertinent past dialogues never lags behind the talk at hand. It rides along on the
            reckoning already made for the memory search, so it asks nothing further of your
            embedding provider — merely a little more reading, and a few more lines in each
            whisper. Off unless you ask for it, and it applies to every conversation alike.
          </div>
        </div>
      </label>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
