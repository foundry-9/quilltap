/**
 * The LoRA list editor for an image profile.
 *
 * Shown only when the selected provider/model resolves an `ImageLoraSupport`
 * — the host resolves that server-side and hands it down, so the browser never
 * re-implements the exact-id / family-prefix / provider-constraint lookup.
 *
 * Rows write straight into `parameters.loras` in the canonical
 * `{ source, scale, triggerPhrase }` shape. Over-cap rows (a profile saved
 * against a four-adapter model, then pointed at a one-adapter model) are
 * flagged, not deleted: switching the model back must lose nothing, and the
 * request builder caps the list again at generation time anyway.
 *
 * Each row can **Query** its source against HuggingFace. That is a read-out,
 * not a gate: it never blocks saving, never rewrites the Source field, and
 * offers no opinion on whether the adapter suits the selected model — see
 * `lib/image-gen/huggingface-lookup` for why such an opinion would be a
 * liability. A stale answer is worse than none, so a row's result is cleared
 * the moment its source is edited.
 */

'use client'

import { useState } from 'react'
import type { ImageLoraSpec, ImageLoraSupport } from '@quilltap/plugin-types'
import type { HuggingFaceLookupResult } from '@/lib/image-gen/huggingface-lookup'
import { extractHuggingFaceRepoId } from '@/lib/image-gen/huggingface-repo-id'
import { LoraQueryResult } from './LoraQueryResult'

interface LoraListEditorProps {
  /** Resolved support for the selected model; null hides the editor entirely. */
  support: ImageLoraSupport | null
  /** Current value of `parameters.loras`. */
  loras: ImageLoraSpec[]
  onChange: (loras: ImageLoraSpec[]) => void
  /**
   * The profile's configured `hf_api_token`, when it has one. Passed through
   * to the lookup so gated and private repositories resolve for the people
   * entitled to see them; it rides the request body, never the query string.
   */
  hfToken?: string
}

/** Per-row lookup state, keyed by row index. */
interface RowQuery {
  loading: boolean
  result: HuggingFaceLookupResult | null
}

/** Mirrors `DEFAULT_LORA_SCALE` in lib/image-gen/lora-support.ts. */
const DEFAULT_SCALE = { min: 0, max: 2, default: 1, step: 0.05 }

function scaleBounds(support: ImageLoraSupport) {
  const declared = support.scale
  if (!declared) return DEFAULT_SCALE
  return {
    min: declared.min,
    max: declared.max,
    default: declared.default,
    step: declared.step ?? DEFAULT_SCALE.step,
  }
}

function sourceHint(support: ImageLoraSupport): string {
  const kinds = support.sourceKinds
  const parts: string[] = []
  if (kinds.includes('url')) parts.push('a .safetensors URL')
  if (kinds.includes('hf-repo')) parts.push('a HuggingFace owner/model-name')
  if (kinds.includes('provider-id')) parts.push("an identifier from the provider's own catalogue")
  if (parts.length === 0) return 'Whatever identifier this provider accepts.'
  if (parts.length === 1) return `${parts[0][0].toUpperCase()}${parts[0].slice(1)}.`
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}.`
}

export function LoraListEditor({ support, loras, onChange, hfToken }: LoraListEditorProps) {
  const [queries, setQueries] = useState<Record<number, RowQuery>>({})

  if (!support) return null

  const bounds = scaleBounds(support)
  const max = support.maxLoras
  const atCap = loras.length >= max

  const update = (index: number, patch: Partial<ImageLoraSpec>) => {
    // An answer about the previous source would be actively misleading beside
    // a new one, so editing the source discards it.
    if (patch.source !== undefined) {
      setQueries(prev => {
        if (!prev[index]) return prev
        const next = { ...prev }
        delete next[index]
        return next
      })
    }
    onChange(loras.map((lora, i) => (i === index ? { ...lora, ...patch } : lora)))
  }

  const remove = (index: number) => {
    // Rows are keyed by position, so removing one has to shuffle the results
    // down with them — otherwise row 1's findings resurface under row 0.
    setQueries(prev => {
      const next: Record<number, RowQuery> = {}
      for (const [key, value] of Object.entries(prev)) {
        const at = Number(key)
        if (at === index) continue
        next[at > index ? at - 1 : at] = value
      }
      return next
    })
    onChange(loras.filter((_, i) => i !== index))
  }

  const add = () => {
    onChange([...loras, { source: '', scale: bounds.default }])
  }

  const query = async (index: number, source: string) => {
    setQueries(prev => ({ ...prev, [index]: { loading: true, result: null } }))
    try {
      const res = await fetch('/api/v1/image-profiles?action=lora-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, ...(hfToken ? { hfToken } : {}) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as HuggingFaceLookupResult
      setQueries(prev => ({ ...prev, [index]: { loading: false, result: data } }))
    } catch {
      // A failed request is reported in the same panel as a failed lookup —
      // from the reader's chair they are the same disappointment.
      setQueries(prev => ({
        ...prev,
        [index]: {
          loading: false,
          result: { ok: false, reason: 'network', repoId: null, url: null },
        },
      }))
    }
  }

  return (
    <div className="space-y-4 border-t qt-border-default pt-4">
      <div>
        <h3 className="text-sm qt-text-primary">LoRA Adapters (Optional)</h3>
        <p className="qt-text-xs mt-1">
          Adapters are applied in the order listed. {sourceHint(support)} This model accepts{' '}
          {max === 1 ? 'a single adapter' : `up to ${max} adapters`}.
        </p>
      </div>

      {loras.length === 0 && (
        <p className="qt-text-xs">
          No adapters attached — the model generates in its own native manner.
        </p>
      )}

      {loras.map((lora, index) => {
        const overCap = index >= max
        const scale = typeof lora.scale === 'number' ? lora.scale : bounds.default
        // The button is offered only when there is a repository to ask about.
        // A weights URL on some other host has no card behind it.
        const repoId = extractHuggingFaceRepoId(lora.source)
        const rowQuery = queries[index]
        return (
          <div
            key={index}
            className={`space-y-2 rounded border p-3 ${
              overCap ? 'qt-border-warning' : 'qt-border-default'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="qt-text-label-xs">
                Adapter {index + 1}
                {lora.label ? ` — ${lora.label}` : ''}
              </span>
              <button
                type="button"
                onClick={() => remove(index)}
                className="qt-button px-2 py-1 qt-button-secondary text-xs"
              >
                Remove
              </button>
            </div>

            {overCap && (
              <p className="qt-text-warning text-xs">
                Beyond this model&apos;s limit of {max} — kept on the profile, but left behind on
                every request until you remove an earlier adapter or return to a model that takes
                more.
              </p>
            )}

            <div>
              <label className="qt-text-label-xs" htmlFor={`lora-source-${index}`}>
                Source
              </label>
              <div className="flex items-start gap-2">
                <input
                  id={`lora-source-${index}`}
                  type="text"
                  value={lora.source}
                  onChange={e => update(index, { source: e.target.value })}
                  placeholder="owner/model-name or https://…/weights.safetensors"
                  className="qt-input text-sm"
                />
                <button
                  type="button"
                  onClick={() => query(index, lora.source)}
                  disabled={!repoId || rowQuery?.loading}
                  className="qt-button shrink-0 px-3 py-2 qt-button-secondary text-xs"
                  title={
                    repoId
                      ? `Ask HuggingFace about ${repoId}`
                      : 'Only a HuggingFace owner/model-name (or a huggingface.co address) can be looked up'
                  }
                >
                  {rowQuery?.loading ? 'Asking…' : 'Query'}
                </button>
              </div>
              <p className="qt-text-xs">
                Querying asks HuggingFace what it declares about this adapter — its base model, its weights,
                its magic word. It settles nothing about whether the two of you will get along.
              </p>
            </div>

            <div>
              <label className="qt-text-label-xs" htmlFor={`lora-scale-${index}`}>
                Strength — {scale.toFixed(2)}
              </label>
              <input
                id={`lora-scale-${index}`}
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={scale}
                onChange={e => update(index, { scale: Number(e.target.value) })}
                className="qt-range w-full"
              />
              <p className="qt-text-xs">
                {bounds.min} to {bounds.max}; this model&apos;s own default is {bounds.default}.
              </p>
            </div>

            <div>
              <label className="qt-text-label-xs" htmlFor={`lora-trigger-${index}`}>
                Trigger Phrase (optional)
              </label>
              <input
                id={`lora-trigger-${index}`}
                type="text"
                value={lora.triggerPhrase ?? ''}
                onChange={e => update(index, { triggerPhrase: e.target.value || undefined })}
                placeholder="e.g., in the style of ohwx"
                className="qt-input text-sm"
              />
              <p className="qt-text-xs">
                Many adapters answer only to a magic word. Whatever you put here is woven into the
                prompt on every generation that uses this profile.
              </p>
            </div>

            {rowQuery?.result && (
              <LoraQueryResult
                result={rowQuery.result}
                supportsPrivateWeightsToken={support.supportsPrivateWeightsToken === true}
                currentTriggerPhrase={lora.triggerPhrase ?? ''}
                onUseTriggerPhrase={phrase => update(index, { triggerPhrase: phrase })}
              />
            )}
          </div>
        )
      })}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={atCap}
          className="qt-button px-3 py-2 qt-button-primary"
          title={atCap ? `This model accepts at most ${max}` : 'Attach another adapter'}
        >
          Add LoRA
        </button>
        <span className="qt-text-xs">
          {loras.length} of {max}
        </span>
      </div>
    </div>
  )
}

export default LoraListEditor
