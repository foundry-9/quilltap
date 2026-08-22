/**
 * PromptFieldLabel — the shared labelled-field header for prompt-bearing
 * fields: label line, helper paragraph, and a worked example in the field's
 * correct form of address.
 *
 * It renders the header ONLY — it deliberately does not wrap the editor, so
 * it drops above any existing input (`MarkdownLexicalEditor`, `<textarea>`,
 * `<input>`) without touching its state wiring. Hint copy comes from
 * `./field-hints` (`PROMPT_FIELD_HINTS`), the single source shared with the
 * AI Wizard's field descriptions and the review panes — pass a `hint` to use
 * it, or override individual pieces via `label`/`helper`/`example`.
 *
 * See docs/developer/features/complete/prompt-person-consistency.md §5.1a for why this
 * exists: the create and edit forms had already drifted apart in their
 * hand-rolled copies of this markup, and hint text duplicated per-surface
 * guarantees another divergence.
 */

import type { ReactNode } from 'react'
import type { PromptFieldHint } from './field-hints'

export interface PromptFieldLabelProps {
  /** Hint bundle from PROMPT_FIELD_HINTS; individual props override it. */
  hint?: PromptFieldHint
  /** The label line. Required when no `hint` is given. */
  label?: string
  /** Renders " (Optional)" after the label. */
  optional?: boolean
  /** Renders a destructive-styled " *" after the label. */
  required?: boolean
  /** `id` of the field this labels, for `<label htmlFor>`. */
  htmlFor?: string
  /** Helper paragraph under the label (house voice). */
  helper?: string
  /** Worked example, rendered as `Written as: <em>…</em>` (plain voice). */
  example?: string
  /** Optional right-aligned controls on the label row (e.g. an import button). */
  actions?: ReactNode
}

export function PromptFieldLabel({
  hint,
  label,
  optional,
  required,
  htmlFor,
  helper,
  example,
  actions,
}: PromptFieldLabelProps) {
  const labelText = label ?? hint?.label ?? ''
  const helperText = helper ?? hint?.helper
  const exampleText = example ?? hint?.example

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="block qt-label text-foreground">
          {labelText}
          {optional ? ' (Optional)' : ''}
          {required ? <span className="qt-text-destructive"> *</span> : null}
        </label>
        {actions}
      </div>
      {helperText && (
        <p className="text-xs qt-text-secondary mt-1">{helperText}</p>
      )}
      {exampleText && (
        <p className="text-xs qt-text-secondary mt-1">
          Written as: <em>{exampleText}</em>
        </p>
      )}
    </div>
  )
}
