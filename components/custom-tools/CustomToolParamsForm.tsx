'use client'

/**
 * CustomToolParamsForm — the parameter form generated from a custom tool's
 * `parameters` declarations.
 *
 * Extracted from the composer's custom-tool popup so it and Pascal's Workbench
 * proving bench render the very same form from the very same declarations — a
 * third copy would drift.
 *
 * Two layouts, one form. `inline` is the original cramped row — label left,
 * small input right — and remains the default so the proving bench is
 * untouched. `stacked` is for a full dialog, where there is room to put the
 * label on its own line, show the parameter's description instead of hiding it
 * in a tooltip, and state the declared bounds rather than only enforcing them.
 *
 * Stacked string parameters get an auto-growing textarea rather than a single
 * line. Nothing in the format declares how long a string is expected to be —
 * `llm_request` and `colour` are the same declaration — so rather than guess
 * from the default's length, the field simply fits itself to whatever is in it,
 * from one line up to a cap, and scrolls past that.
 *
 * Values are held loosely (text inputs yield strings) and coerced back to the
 * declared types on use, via {@link coerceParamValues}.
 */

import { useEffect, useRef } from 'react'

/** A single declared parameter of a custom-tool definition. */
export interface CustomToolParameterSpec {
  type: 'number' | 'integer' | 'string' | 'boolean'
  default: number | string | boolean
  description?: string
  min?: number
  max?: number
}

/** Form values are held loosely (text inputs yield strings) and coerced on use. */
export type ParameterFormValues = Record<string, string | boolean>

/** Seed a form from the declared defaults. */
export function initialParamValues(
  parameters: Record<string, CustomToolParameterSpec>,
): ParameterFormValues {
  const values: ParameterFormValues = {}
  for (const [name, param] of Object.entries(parameters)) {
    values[name] = param.type === 'boolean' ? Boolean(param.default) : String(param.default)
  }
  return values
}

/**
 * Coerce the form's loose values back to the declared types. Blank or
 * unparseable numbers fall back to the declared default rather than sending
 * NaN — the server validates properly; this only keeps the payload well-typed.
 */
export function coerceParamValues(
  parameters: Record<string, CustomToolParameterSpec>,
  values: ParameterFormValues,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [name, param] of Object.entries(parameters)) {
    const raw = values[name]
    if (param.type === 'boolean') {
      out[name] = Boolean(raw)
      continue
    }
    if (param.type === 'string') {
      out[name] = typeof raw === 'string' ? raw : String(param.default)
      continue
    }
    const parsed = param.type === 'integer'
      ? parseInt(String(raw), 10)
      : parseFloat(String(raw))
    out[name] = Number.isFinite(parsed) ? parsed : Number(param.default)
  }
  return out
}

/** Floor and ceiling for an auto-growing string field, in pixels. */
const TEXTAREA_MIN_HEIGHT = 40
const TEXTAREA_MAX_HEIGHT = 224

interface AutoGrowTextareaProps {
  id: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

/**
 * A textarea that fits itself to its content, up to {@link TEXTAREA_MAX_HEIGHT}
 * and then scrolls. `useEffect` rather than `useLayoutEffect` on purpose: this
 * renders on the server too, where the layout hook only earns a warning.
 */
function AutoGrowTextarea({ id, value, onChange, disabled }: Readonly<AutoGrowTextareaProps>) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Collapse first, or scrollHeight reports the height it already has.
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT)}px`
  }, [value])

  return (
    <textarea
      id={id}
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="qt-textarea w-full"
      style={{ minHeight: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT, overflowY: 'auto' }}
    />
  )
}

/** Describe a numeric parameter's declared bounds, or nothing when it has none. */
function boundsHint(param: CustomToolParameterSpec): string | null {
  if (param.type === 'string' || param.type === 'boolean') return null
  if (param.min !== undefined && param.max !== undefined) return `${param.min}–${param.max}`
  if (param.min !== undefined) return `${param.min} or more`
  if (param.max !== undefined) return `${param.max} or less`
  return null
}

interface CustomToolParamsFormProps {
  parameters: Record<string, CustomToolParameterSpec>
  values: ParameterFormValues
  onChange: (param: string, value: string | boolean) => void
  disabled?: boolean
  /** Unique prefix for input ids, so two forms on one page never collide. */
  idPrefix: string
  /** `inline` (default) is the compact row; `stacked` is the roomy dialog form. */
  layout?: 'inline' | 'stacked'
}

export function CustomToolParamsForm({
  parameters,
  values,
  onChange,
  disabled = false,
  idPrefix,
  layout = 'inline',
}: Readonly<CustomToolParamsFormProps>) {
  const stacked = layout === 'stacked'

  return (
    <>
      {Object.entries(parameters).map(([name, param]) => {
        const inputId = `${idPrefix}-${name}`
        const bounds = boundsHint(param)

        if (param.type === 'boolean') {
          if (!stacked) {
            return (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={Boolean(values[name])}
                  onChange={(e) => onChange(name, e.target.checked)}
                  disabled={disabled}
                />
                <span title={param.description}>{name}</span>
              </label>
            )
          }
          return (
            <label key={name} className="flex items-start gap-2 cursor-pointer">
              <input
                id={inputId}
                type="checkbox"
                className="mt-1"
                checked={Boolean(values[name])}
                onChange={(e) => onChange(name, e.target.checked)}
                disabled={disabled}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium font-mono">{name}</span>
                {param.description && (
                  <span className="block text-xs qt-text-secondary">{param.description}</span>
                )}
              </span>
            </label>
          )
        }

        if (!stacked) {
          return (
            <div key={name} className="flex items-center justify-between gap-2">
              <label htmlFor={inputId} className="text-sm" title={param.description}>
                {name}
              </label>
              <input
                id={inputId}
                type={param.type === 'string' ? 'text' : 'number'}
                value={String(values[name] ?? '')}
                onChange={(e) => onChange(name, e.target.value)}
                min={param.min}
                max={param.max}
                disabled={disabled}
                className={param.type === 'string' ? 'qt-input w-40' : 'qt-input w-20'}
              />
            </div>
          )
        }

        return (
          <div key={name}>
            <label htmlFor={inputId} className="flex items-baseline gap-2 mb-1.5">
              <span className="text-sm font-medium font-mono">{name}</span>
              <span className="text-xs qt-text-secondary">
                {param.type}
                {bounds ? ` · ${bounds}` : ''}
              </span>
            </label>
            {param.description && (
              <p className="text-xs qt-text-secondary mb-2">{param.description}</p>
            )}
            {param.type === 'string' ? (
              <AutoGrowTextarea
                id={inputId}
                value={String(values[name] ?? '')}
                onChange={(next) => onChange(name, next)}
                disabled={disabled}
              />
            ) : (
              <input
                id={inputId}
                type="number"
                value={String(values[name] ?? '')}
                onChange={(e) => onChange(name, e.target.value)}
                min={param.min}
                max={param.max}
                disabled={disabled}
                className="qt-input w-32"
              />
            )}
          </div>
        )
      })}
    </>
  )
}

export default CustomToolParamsForm
