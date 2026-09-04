'use client'

/**
 * BoundedNumberInstanceSetting
 *
 * One numeric dial on an instance-wide setting (`instance_settings[...]`): a
 * GET that answers `{ [field]: number }`, a PUT that takes the same shape and
 * echoes the saved settings. `DataRetentionSettings` and
 * `BrahmaConsoleSettings` are this component plus copy and constants.
 *
 * Commit rules (blur or Enter): an entry outside `[min, max]` or not a number
 * is reverted without comment — the bounds live in the copy; an unchanged
 * entry is normalised (`"30.7"` → `"30"`) and nothing is sent; a changed
 * entry PUTs, and a failed PUT shows the server's `error` (or the caller's
 * fallback) inline and as a toast, then reverts the field.
 */

import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'

export interface UseInstanceNumberSettingOptions {
  /** Cache key from `queryKeys.settings.*`. */
  queryKey: readonly unknown[]
  /** The `/api/v1/settings/...` endpoint serving both GET and PUT. */
  url: string
  /** The numeric field on the settings object this dial edits. */
  field: string
  defaultValue: number
  min: number
  max: number
  /** Inline error when the GET fails with a non-2xx status. */
  loadFailureMessage: string
  /** Fallback error when the PUT fails and the server sent no `error`. */
  saveFailureMessage: string
  /** Success toast after a saved change. */
  successToast: string
}

/**
 * The v1 API answers a failure with `{ error }`; older code read exactly that
 * off the body and fell back to the surface's own sentence. A non-HTTP failure
 * (network, abort) keeps its own message.
 */
function settingErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiFetchError) {
    const info = err.info
    const serverError =
      info && typeof info === 'object' ? (info as Record<string, unknown>).error : undefined
    return typeof serverError === 'string' && serverError ? serverError : fallback
  }
  return getErrorMessage(err, fallback)
}

/**
 * Query + mutation behind {@link BoundedNumberInstanceSetting}. Exported so a
 * differently-shaped card can reuse the commit rules without the markup.
 */
export function useInstanceNumberSetting({
  queryKey,
  url,
  field,
  defaultValue,
  min,
  max,
  loadFailureMessage,
  saveFailureMessage,
  successToast,
}: UseInstanceNumberSettingOptions) {
  const queryClient = useQueryClient()
  // `null` means "show the saved value"; a string is the user's in-progress entry.
  const [draft, setDraft] = useState<string | null>(null)

  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- queryKey is the caller's `queryKeys.settings.*` entry, which names this url 1:1
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiFetch<Record<string, unknown>>(url, { signal }),
  })

  const loaded = query.data?.[field]
  const saved = typeof loaded === 'number' ? loaded : defaultValue

  const save = useMutation({
    mutationFn: (value: number) =>
      apiFetch<Record<string, unknown>>(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKey, settings)
      setDraft(null)
      showSuccessToast(successToast)
    },
    onError: (err) => {
      console.debug('[BoundedNumberInstanceSetting] Save failed', { url, field, error: getErrorMessage(err) })
      showErrorToast(settingErrorMessage(err, saveFailureMessage))
      setDraft(null)
    },
  })

  const commit = () => {
    const parsed = Math.floor(Number(draft ?? saved))
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      // Revert an unusable entry rather than nag — the bounds live in the copy.
      setDraft(null)
      return
    }
    if (parsed === saved) {
      setDraft(null)
      return
    }
    save.mutate(parsed)
  }

  const error = save.error
    ? settingErrorMessage(save.error, saveFailureMessage)
    : query.error
      ? settingErrorMessage(query.error, loadFailureMessage)
      : null

  return {
    loading: query.isLoading,
    saving: save.isPending,
    error,
    value: draft ?? String(saved),
    setDraft,
    commit,
  }
}

export interface BoundedNumberInstanceSettingProps extends UseInstanceNumberSettingOptions {
  /** `id` of the `<input>`, matched by the label's `htmlFor`. */
  inputId: string
  /** Shown in place of the card while the GET is in flight. */
  loadingText: ReactNode
  /** The paragraph above the dial. */
  intro: ReactNode
  /** Label text for the input. */
  label: ReactNode
  /** Unit word after the input ("days", "turns"). */
  unit: string
  /** The small print beneath the dial. */
  footnote: ReactNode
}

export function BoundedNumberInstanceSetting({
  inputId,
  loadingText,
  intro,
  label,
  unit,
  footnote,
  ...options
}: BoundedNumberInstanceSettingProps) {
  const { loading, saving, error, value, setDraft, commit } = useInstanceNumberSetting(options)
  const { min, max, defaultValue } = options

  if (loading) {
    return <p className="qt-text-small qt-text-muted">{loadingText}</p>
  }

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">{intro}</p>

      <div>
        <label htmlFor={inputId} className="qt-text-label block mb-2">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            disabled={saving}
            className="qt-input w-28"
          />
          <span className="qt-text-small qt-text-secondary">{unit} ({min}&ndash;{max}; the default is {defaultValue})</span>
        </div>
        <p className="qt-text-xs qt-text-secondary mt-1">{footnote}</p>
      </div>

      {error && <p className="qt-text-small qt-text-destructive">{error}</p>}
    </div>
  )
}
