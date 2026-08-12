'use client'

/**
 * SideEffectsSection — the Workbench's "Side effects" card, between the
 * builder form and the outcome table: what a run writes back once the deal is
 * done.
 *
 * The form authors the common shapes only: a When of "Always" or "on a given
 * outcome state", a target, and a value that is a literal number, a literal
 * boolean, or an expression. A hand-written richer condition (comparators,
 * metadata, the oracle) is carried verbatim behind a read-only badge — the
 * `$state`-default precedent: the builder round-trips what it cannot author.
 * Everything else arrives as issues from `validateDraft` and renders inline.
 */

import { Icon } from '@/components/ui/icon'
import { MAX_EFFECTS, MAX_EFFECT_TARGET_LENGTH, type OutcomeState } from '@/lib/pascal/custom-tool.types'
import type { DraftEffect, DraftIssue, ToolDraft } from '@/lib/pascal/tool-draft'

interface SideEffectsSectionProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  disabled?: boolean
}

let effectIdCounter = 0

const OUTCOME_STATES: readonly OutcomeState[] = ['success', 'partial', 'failure', 'info'] as const

/** The When select's flat values; 'verbatim' never appears as an option. */
type WhenChoice = 'always' | OutcomeState

function whenChoiceOf(effect: DraftEffect): WhenChoice | 'verbatim' {
  if (effect.when.kind === 'always') return 'always'
  if (effect.when.kind === 'outcome-state') return effect.when.state
  return 'verbatim'
}

export function SideEffectsSection({ draft, issues, onChange, disabled = false }: Readonly<SideEffectsSectionProps>) {
  const update = (partial: Partial<ToolDraft>) => onChange({ ...draft, ...partial })

  const updateEffect = (id: string, partial: Partial<DraftEffect>) =>
    update({ effects: draft.effects.map((effect) => (effect.id === id ? { ...effect, ...partial } : effect)) })

  const addEffect = () => {
    effectIdCounter += 1
    update({
      effects: [
        ...draft.effects,
        {
          id: `new-effect-${effectIdCounter}`,
          when: { kind: 'always' },
          target: '',
          valueKind: 'expression',
          value: '',
        },
      ],
    })
  }

  const removeEffect = (id: string) => update({ effects: draft.effects.filter((effect) => effect.id !== id) })

  const effectErrors = (id: string): string[] =>
    issues
      .filter((issue) => issue.severity === 'error' && issue.where.section === 'effect' && issue.where.id === id)
      .map((issue) => issue.message)
  const effectWarnings = (id: string): string[] =>
    issues
      .filter((issue) => issue.severity === 'warning' && issue.where.section === 'effect' && issue.where.id === id)
      .map((issue) => issue.message)

  return (
    <section className="qt-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="qt-card-title text-sm">Side effects</h2>
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm"
          onClick={addEffect}
          disabled={disabled || draft.effects.length >= MAX_EFFECTS}
          title={draft.effects.length >= MAX_EFFECTS ? `At most ${MAX_EFFECTS} effects` : undefined}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Add effect ({draft.effects.length}/{MAX_EFFECTS})
        </button>
      </div>

      {draft.effects.length === 0 && (
        <p className="text-xs qt-text-secondary">
          None declared. An effect lets a roll record its consequences — tick a counter in the story&rsquo;s
          state, note a fact on the rolling character&rsquo;s sheet — applied server-side as part of the deal,
          beyond any model&rsquo;s power to fudge.
        </p>
      )}

      {draft.effects.map((effect) => {
        const errors = effectErrors(effect.id)
        const warnings = effectWarnings(effect.id)
        const choice = whenChoiceOf(effect)

        return (
          <div key={effect.id} className="qt-card p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2">
                When
                {choice === 'verbatim' ? (
                  <span
                    className="qt-text-xs qt-text-secondary font-mono rounded qt-bg-muted px-2 py-1"
                    title="This condition is richer than the form authors. Edit it in the raw JSON."
                  >
                    {effect.when.kind === 'verbatim' ? JSON.stringify(effect.when.when) : ''}
                  </span>
                ) : (
                  <select
                    value={choice}
                    onChange={(e) => {
                      const value = e.target.value as WhenChoice
                      updateEffect(effect.id, {
                        when: value === 'always' ? { kind: 'always' } : { kind: 'outcome-state', state: value },
                      })
                    }}
                    disabled={disabled}
                    className="qt-select qt-select-sm"
                    aria-label="When this effect applies"
                  >
                    <option value="always">every run</option>
                    {OUTCOME_STATES.map((state) => (
                      <option key={state} value={state}>
                        outcome is {state}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm ml-auto"
                onClick={() => removeEffect(effect.id)}
                disabled={disabled}
                title="Delete this effect"
              >
                <Icon name="trash" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2 flex-1 min-w-56">
                Target
                <input
                  type="text"
                  value={effect.target}
                  maxLength={MAX_EFFECT_TARGET_LENGTH}
                  onChange={(e) => updateEffect(effect.id, { target: e.target.value })}
                  placeholder="state.encounter.count"
                  disabled={disabled}
                  className={`qt-input flex-1 font-mono ${errors.length > 0 ? 'qt-input-error' : ''}`}
                  aria-label="Effect target"
                />
              </label>
              {effect.target.trim() === '' && (
                <span className="flex gap-1">
                  {(['state.', 'metadata.'] as const).map((prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      className="qt-button qt-button-ghost qt-button-sm font-mono"
                      onClick={() => updateEffect(effect.id, { target: prefix })}
                      disabled={disabled}
                      title={
                        prefix === 'state.'
                          ? 'Write into tiered persistent state, at the tier where the key already lives'
                          : "Write onto the rolling character's own fact sheet (metadata.json)"
                      }
                    >
                      {prefix}
                    </button>
                  ))}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2">
                Value
                <select
                  value={effect.valueKind}
                  onChange={(e) => {
                    const valueKind = e.target.value as DraftEffect['valueKind']
                    updateEffect(effect.id, {
                      valueKind,
                      value: valueKind === 'literal-boolean' ? 'true' : valueKind === 'literal-number' ? '' : effect.value,
                    })
                  }}
                  disabled={disabled}
                  className="qt-select qt-select-sm"
                  aria-label="Value kind"
                >
                  <option value="expression">expression</option>
                  <option value="literal-number">number</option>
                  <option value="literal-boolean">true/false</option>
                </select>
              </label>
              {effect.valueKind === 'literal-boolean' ? (
                <select
                  value={effect.value === 'true' ? 'true' : 'false'}
                  onChange={(e) => updateEffect(effect.id, { value: e.target.value })}
                  disabled={disabled}
                  className="qt-select qt-select-sm"
                  aria-label="Boolean value"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={effect.valueKind === 'literal-number' ? 'number' : 'text'}
                  step="any"
                  value={effect.value}
                  onChange={(e) => updateEffect(effect.id, { value: e.target.value })}
                  placeholder={effect.valueKind === 'literal-number' ? '1' : "{{state.encounter.count}} + 1"}
                  disabled={disabled}
                  className={`qt-input flex-1 min-w-48 font-mono ${errors.length > 0 ? 'qt-input-error' : ''}`}
                  aria-label="Effect value"
                />
              )}
            </div>

            {errors.map((message) => (
              <p key={message} className="text-xs qt-text-destructive">
                {message}
              </p>
            ))}
            {warnings.map((message) => (
              <p key={message} className="text-xs qt-text-secondary">
                ⚠ {message}
              </p>
            ))}
          </div>
        )
      })}

      <p className="qt-hint">
        Effects apply in order, after the outcome is chosen. A JSON string value is always an expression —
        quote literal prose: <code className="font-mono">&apos;broken pick&apos;</code>, never bare words.
        Expressions take + − × ÷, parentheses, and the same {'{{…}}'} references as a message.
      </p>
    </section>
  )
}

export default SideEffectsSection
