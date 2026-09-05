'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { readErrorText } from './hooks/api-error-text'

interface HousekeepingConfig {
  enabled: boolean
  perCharacterCap: number
  perCharacterCapOverrides: Record<string, number>
  autoMergeSimilarThreshold: number
  mergeSimilar: boolean
}

interface CharacterSummary {
  id: string
  name: string
  memoryCount: number
}

const DEFAULT_CONFIG: HousekeepingConfig = {
  enabled: false,
  perCharacterCap: 2000,
  perCharacterCapOverrides: {},
  autoMergeSimilarThreshold: 0.9,
  mergeSimilar: false,
}

const HOUSEKEEPING_CONFIG_URL = '/api/v1/memories?action=housekeeping-config'
const CHARACTER_MEMORY_COUNTS_URL = '/api/v1/memories?action=character-memory-counts'

export function MemoryHousekeepingCard() {
  const [config, setConfig] = useState<HousekeepingConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [showOverrides, setShowOverrides] = useState(false)
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const {
    data: loadedConfig,
    isLoading: configLoading,
    error: loadError,
  } = useQuery({
    queryKey: queryKeys.memories.housekeepingConfig,
    queryFn: ({ signal }) =>
      apiFetch<{ settings?: Partial<HousekeepingConfig> }>(HOUSEKEEPING_CONFIG_URL, { signal }),
  })

  // The per-character counts are decoration for the overrides list: a failed
  // read leaves the list empty rather than failing the card.
  const { data: loadedCounts, isLoading: countsLoading } = useQuery({
    queryKey: queryKeys.memories.characterMemoryCounts,
    queryFn: ({ signal }) =>
      apiFetch<{ characters?: unknown }>(CHARACTER_MEMORY_COUNTS_URL, { signal }),
  })
  const loading = configLoading || countsLoading

  const rawCharacters = loadedCounts?.characters
  const characters: CharacterSummary[] = (Array.isArray(rawCharacters) ? rawCharacters : []).map(
    (c: { id: string; name: string; memoryCount: number }) => ({
      id: c.id,
      name: c.name,
      memoryCount: c.memoryCount,
    }),
  )

  // Seed the editable form from the server's settings whenever a fresh read lands.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form is local state seeded from the query
    if (loadedConfig?.settings) setConfig({ ...DEFAULT_CONFIG, ...loadedConfig.settings })
  }, [loadedConfig])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- surface the read failure in the shared error line
    if (loadError) setError(readErrorText(loadError, 'Failed to load housekeeping settings'))
  }, [loadError])

  const saveConfig = async (next: Partial<HousekeepingConfig>) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(HOUSEKEEPING_CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save housekeeping settings')
      }
      const data = await response.json()
      setConfig({ ...DEFAULT_CONFIG, ...data.settings })
      showSuccessToast('Housekeeping settings saved')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to save housekeeping settings')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = () => {
    const next = !config.enabled
    setConfig(c => ({ ...c, enabled: next }))
    void saveConfig({ enabled: next })
  }

  const handleCapBlur = (value: number) => {
    if (!Number.isFinite(value) || value < 100 || value > 100000) return
    if (value === config.perCharacterCap) return
    void saveConfig({ perCharacterCap: Math.floor(value) })
  }

  const handleToggleMergeSimilar = () => {
    const next = !config.mergeSimilar
    setConfig(c => ({ ...c, mergeSimilar: next }))
    void saveConfig({ mergeSimilar: next })
  }

  const handleOverrideBlur = (characterId: string, rawValue: string) => {
    const trimmed = rawValue.trim()
    const nextOverrides: Record<string, number> = { ...config.perCharacterCapOverrides }

    if (trimmed === '') {
      // Empty input removes any override for this character
      if (characterId in nextOverrides) {
        delete nextOverrides[characterId]
      } else {
        return // nothing to save
      }
    } else {
      const parsed = Math.floor(Number(trimmed))
      if (!Number.isFinite(parsed) || parsed < 100 || parsed > 100000) {
        setError(`Override for character ${characterId.slice(0, 8)} must be between 100 and 100,000`)
        return
      }
      if (nextOverrides[characterId] === parsed) return // no change
      nextOverrides[characterId] = parsed
    }

    setOverrideDrafts(d => {
      const next = { ...d }
      delete next[characterId]
      return next
    })
    void saveConfig({ perCharacterCapOverrides: nextOverrides })
  }

  const handleRunNow = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/memories?action=housekeep-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to run housekeeping')
      }
      showSuccessToast('Housekeeping job enqueued — it will run in the background')
    } catch (err) {
      const msg = getErrorMessage(err, 'Failed to run housekeeping')
      setError(msg)
      showErrorToast(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="qt-text-small qt-text-muted">Loading housekeeping settings&hellip;</p>
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Automatic housekeeping prunes low-importance, stale memories once a character approaches its cap. High-importance, manually added, recently accessed, and well-reinforced memories are never touched. Off by default — toggle on once you&rsquo;ve reviewed the limits below.
      </p>

      <label className="flex items-center gap-3 qt-body">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={saving}
          onChange={handleToggleEnabled}
          className="qt-checkbox"
        />
        <span>Enable automatic housekeeping</span>
      </label>

      <div className="flex items-center gap-3">
        <label className="qt-text-small qt-text-muted" htmlFor="perCharacterCap">
          Per-character cap
        </label>
        <input
          id="perCharacterCap"
          type="number"
          min={100}
          max={100000}
          step={100}
          value={config.perCharacterCap}
          disabled={saving}
          onChange={(e) =>
            setConfig(c => ({ ...c, perCharacterCap: Number(e.target.value) }))
          }
          onBlur={(e) => handleCapBlur(Number(e.target.value))}
          className="qt-input w-32"
        />
        <span className="qt-text-small qt-text-muted">memories per character</span>
      </div>

      {characters.length > 0 && (
        <div>
          <button
            type="button"
            className="qt-text-small qt-text-muted underline-offset-2 hover:underline"
            onClick={() => setShowOverrides(s => !s)}
          >
            {showOverrides ? '▾' : '▸'} Per-character overrides ({Object.keys(config.perCharacterCapOverrides).length} active)
          </button>

          {showOverrides && (
            <div className="mt-3 space-y-2">
              <p className="qt-text-small qt-text-muted">
                Set a different cap for individual characters. Leave blank to fall back to the global cap ({config.perCharacterCap.toLocaleString()}).
              </p>
              <div className="space-y-1">
                {characters.map(character => {
                  const override = config.perCharacterCapOverrides[character.id]
                  const draftKey = character.id
                  const draftValue =
                    draftKey in overrideDrafts
                      ? overrideDrafts[draftKey]
                      : override === undefined
                        ? ''
                        : String(override)
                  const effectiveCap = override ?? config.perCharacterCap
                  const overCap = character.memoryCount > effectiveCap

                  return (
                    <div key={character.id} className="flex items-center gap-3">
                      <div className="flex-1 qt-body">
                        <span>{character.name}</span>{' '}
                        <span className={overCap ? 'qt-text-destructive qt-text-small' : 'qt-text-muted qt-text-small'}>
                          ({character.memoryCount.toLocaleString()} memories)
                        </span>
                      </div>
                      <input
                        type="number"
                        min={100}
                        max={100000}
                        step={100}
                        placeholder={`${config.perCharacterCap}`}
                        value={draftValue}
                        disabled={saving}
                        onChange={(e) =>
                          setOverrideDrafts(d => ({ ...d, [draftKey]: e.target.value }))
                        }
                        onBlur={(e) => handleOverrideBlur(character.id, e.target.value)}
                        className="qt-input w-28"
                        aria-label={`Cap override for ${character.name}`}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <label className="flex items-center gap-3 qt-body">
        <input
          type="checkbox"
          checked={config.mergeSimilar}
          disabled={saving}
          onChange={handleToggleMergeSimilar}
          className="qt-checkbox"
        />
        <span>Also merge semantically similar memories during the sweep</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="qt-button qt-button-secondary"
          disabled={saving}
          onClick={handleRunNow}
        >
          Run housekeeping now
        </button>
        <span className="qt-text-small qt-text-muted">
          Sweeps every character. Runs in the background.
        </span>
      </div>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
