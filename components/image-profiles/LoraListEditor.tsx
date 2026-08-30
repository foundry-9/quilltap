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
 */

'use client'

import type { ImageLoraSpec, ImageLoraSupport } from '@quilltap/plugin-types'

interface LoraListEditorProps {
  /** Resolved support for the selected model; null hides the editor entirely. */
  support: ImageLoraSupport | null
  /** Current value of `parameters.loras`. */
  loras: ImageLoraSpec[]
  onChange: (loras: ImageLoraSpec[]) => void
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

export function LoraListEditor({ support, loras, onChange }: LoraListEditorProps) {
  if (!support) return null

  const bounds = scaleBounds(support)
  const max = support.maxLoras
  const atCap = loras.length >= max

  const update = (index: number, patch: Partial<ImageLoraSpec>) => {
    onChange(loras.map((lora, i) => (i === index ? { ...lora, ...patch } : lora)))
  }

  const remove = (index: number) => {
    onChange(loras.filter((_, i) => i !== index))
  }

  const add = () => {
    onChange([...loras, { source: '', scale: bounds.default }])
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
              <input
                id={`lora-source-${index}`}
                type="text"
                value={lora.source}
                onChange={e => update(index, { source: e.target.value })}
                placeholder="owner/model-name or https://…/weights.safetensors"
                className="qt-input text-sm"
              />
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
