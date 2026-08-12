'use client'

/**
 * TabooSettings
 *
 * Editor for the instance-wide Taboo list (`instance_settings['taboo']`) — the
 * phrases no character may utter. Instance-scoped, so it fetches for itself
 * rather than riding the per-user `useChatSettings` blob, exactly as
 * `DataRetentionSettings` does; the transport here is TanStack Query since the
 * list is a collection worth caching and invalidating.
 *
 * Every add and remove PUTs the WHOLE array — the server owns normalization
 * (trim, drop empties, case-insensitive dedupe, order preserved), and the
 * response is the normalized list, which is what lands in the cache.
 */

import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

/** Mirrors `TabooSettingsSchema` in `lib/schemas/settings.types.ts`. */
interface TabooSettings {
  phrases: string[]
}

const TABOO_URL = '/api/v1/settings/taboo'
const MAX_PHRASE_LENGTH = 200
const MAX_PHRASES = 500

export function TabooSettings() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.settings.taboo,
    queryFn: ({ signal }) => apiFetch<TabooSettings>(TABOO_URL, { signal }),
  })

  const phrases = data?.phrases ?? []

  const savePhrases = useMutation({
    mutationFn: (next: string[]) =>
      apiFetch<TabooSettings>(TABOO_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrases: next }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.settings.taboo, saved)
    },
    onError: (err) => {
      showErrorToast(apiErrorMessage(err, 'Failed to save the Taboo list'))
    },
  })

  const addPhrase = async () => {
    setAddError(null)
    const phrase = draft.trim()
    if (!phrase) return
    if (phrase.length > MAX_PHRASE_LENGTH) {
      setAddError(`A phrase may run to ${MAX_PHRASE_LENGTH} characters at most.`)
      return
    }
    if (phrases.length >= MAX_PHRASES) {
      setAddError(`The list is full at ${MAX_PHRASES} phrases.`)
      return
    }
    if (phrases.some((p) => p.toLowerCase() === phrase.toLowerCase())) {
      setAddError('That phrase is already forbidden.')
      return
    }

    try {
      await savePhrases.mutateAsync([...phrases, phrase])
      setDraft('')
      showSuccessToast('Phrase struck from the record')
    } catch {
      // The mutation's onError already surfaced it; keep the draft for a retry.
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void addPhrase()
  }

  /**
   * Enter is wired explicitly rather than left to the form's implicit
   * submission — the same pattern as the character editor's alias input. It
   * keeps the promise the card makes ("Press Enter or use Add") from depending
   * on implicit-submission behaviour, which varies with the browser and the
   * input method.
   */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    void addPhrase()
  }

  const handleRemove = async (index: number) => {
    setAddError(null)
    try {
      await savePhrases.mutateAsync(phrases.filter((_, i) => i !== index))
      showSuccessToast('Phrase restored to polite company')
    } catch {
      // Surfaced by the mutation's onError.
    }
  }

  if (isLoading) {
    return <p className="qt-text-small qt-text-muted">Consulting the list of forbidden phrases&hellip;</p>
  }

  if (error) {
    return (
      <p className="qt-text-small qt-text-error">
        {apiErrorMessage(error, 'Failed to load the Taboo list')}
      </p>
    )
  }

  const busy = savePhrases.isPending

  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-muted">
        Phrases the household has agreed never to utter &mdash; strike the tired ones from every
        tongue in the establishment. Each entry is forbidden outright: not merely word for word,
        but in every inflection, rewording, and near-variant of the same weary formula. Characters
        are told to say what they actually mean instead, in plain and particular words, and are
        under strict instruction never to mention the list itself.
      </p>

      <form onSubmit={handleSubmit} className="qt-settings-shell space-y-3" aria-label="Add a forbidden phrase">
        <div className="qt-settings-section-heading">Add a phrase</div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <label className="flex flex-col gap-1 flex-1">
            <span className="qt-text-small text-muted-foreground">Forbidden phrase</span>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_PHRASE_LENGTH}
              placeholder={'e.g. that’s not nothing'}
              className="qt-input"
              disabled={busy}
              aria-label="Forbidden phrase"
            />
          </label>
          <button type="submit" disabled={busy || !draft.trim()} className="qt-button-primary">
            Add
          </button>
        </div>
        <p className="qt-text-xs qt-text-secondary">
          One phrase at a time &mdash; commas are perfectly welcome inside a phrase, so they cannot
          serve as separators. Press Enter or use Add.
        </p>
        {addError && <div className="qt-text-small qt-text-error">{addError}</div>}
      </form>

      <div className="qt-settings-shell space-y-2">
        <div className="qt-settings-section-heading">Forbidden phrases</div>
        {phrases.length === 0 ? (
          <p className="qt-text-small text-muted-foreground italic">
            Nothing forbidden yet &mdash; every tongue in the house runs free.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {phrases.map((phrase, index) => (
                <span key={`${phrase}-${index}`} className="qt-tag-badge qt-tag-badge-md">
                  <span>{phrase}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemove(index)}
                    disabled={busy}
                    className="qt-tag-badge-remove"
                    aria-label={`Remove "${phrase}" from the Taboo list`}
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <p className="qt-text-xs qt-text-secondary">
              {`${phrases.length} phrase${phrases.length === 1 ? '' : 's'} forbidden, in the order you placed them. Applies to every character’s conversational replies across the whole establishment.`}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
