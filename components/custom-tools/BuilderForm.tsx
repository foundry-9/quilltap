'use client'

/**
 * BuilderForm — identity, options, parameters, and the roll, i.e. everything
 * in the Workbench's form column except the outcome cascade.
 *
 * Validity is by construction wherever the format allows: the name field
 * coerces to the identifier grammar as you type, min/max hide (not merely
 * disable) on non-numeric parameters, and roll `$param` pickers only ever list
 * numeric parameters. What cannot be prevented structurally arrives as issues
 * from `validateDraft` and renders as inline error state.
 */

import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import {
  IDENTIFIER_PATTERN,
  MAX_CHIP_LABEL_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LLM_OUTPUT_CEILING,
  MAX_LLM_OUTPUT_LENGTH,
  MAX_LLM_PROMPT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_PARAMETERS,
  MAX_TITLE_LENGTH,
  displayTitle,
  isStateRef,
} from '@/lib/pascal/custom-tool.types'
import {
  MAX_DICE_COUNT,
  MAX_DIE_SIDES,
  MIN_DIE_SIDES,
  parseDiceNotation,
} from '@/lib/pascal/dice-notation'
import {
  findParameterReferences,
  nextDraftId,
  numericParamNames,
  parseNumberText,
  renameParameterEverywhere,
  slugFromTitle,
  type DraftIssue,
  type DraftParameter,
  type NumberOrParamValue,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { GateSection } from './GateSection'
import { NumberOrParamField } from './NumberOrParamField'

interface BuilderFormProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  disabled?: boolean
}

/** Strip a typed name down to the identifier grammar, live. */
function coerceIdentifier(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64)
}

export function BuilderForm({ draft, issues, onChange, disabled = false }: Readonly<BuilderFormProps>) {
  /** While true, editing the title keeps regenerating the name slug (§4.1). */
  const [nameTracksTitle, setNameTracksTitle] = useState(draft.name === '')
  const [pendingRename, setPendingRename] = useState<{ id: string; from: string; to: string } | null>(null)

  const numericNames = numericParamNames(draft)

  const fieldError = (predicate: (issue: DraftIssue) => boolean): string | null =>
    issues.find((issue) => issue.severity === 'error' && predicate(issue))?.message ?? null

  const nameError = fieldError((i) => i.where.section === 'identity' && i.where.field === 'name')
  const chipLabelError = fieldError((i) => i.where.section === 'identity' && i.where.field === 'chipLabel')
  const chipLabelWarnings = issues
    .filter(
      (i) => i.severity === 'warning' && i.where.section === 'identity' && i.where.field === 'chipLabel'
    )
    .map((i) => i.message)
  const descriptionError = fieldError((i) => i.where.section === 'identity' && i.where.field === 'description')
  const llmError = (field: 'prompt' | 'errorMessage' | 'maxOutput') =>
    fieldError((i) => i.where.section === 'llm' && i.where.field === field)
  const llmWarnings = issues
    .filter((i) => i.severity === 'warning' && i.where.section === 'llm')
    .map((i) => i.message)

  const update = (partial: Partial<ToolDraft>) => onChange({ ...draft, ...partial })

  const handleTitleChange = (title: string) => {
    if (nameTracksTitle) {
      const slug = slugFromTitle(title)
      update({ title, name: slug })
    } else {
      update({ title })
    }
  }

  const handleNameChange = (raw: string) => {
    setNameTracksTitle(false)
    update({ name: coerceIdentifier(raw) })
  }

  // -- Parameters -----------------------------------------------------------

  const updateParam = (id: string, partial: Partial<DraftParameter>) => {
    update({ parameters: draft.parameters.map((p) => (p.id === id ? { ...p, ...partial } : p)) })
  }

  const addParam = () => {
    update({
      parameters: [
        ...draft.parameters,
        {
          id: nextDraftId('new-param'),
          name: '',
          type: 'number',
          defaultValue: '0',
          description: '',
          min: '',
          max: '',
        },
      ],
    })
  }

  /**
   * Renaming offers "rename everywhere" (safe, atomic). The commit happens on
   * blur so half-typed names don't thrash every reference.
   */
  const commitParamRename = () => {
    if (!pendingRename) return
    const { from, to } = pendingRename
    setPendingRename(null)
    if (from === '' || from === to) return
    onChange(renameParameterEverywhere(draft, from, to))
  }

  const handleParamNameChange = (param: DraftParameter, raw: string) => {
    const next = coerceIdentifier(raw)
    setPendingRename((prev) =>
      prev && prev.id === param.id ? { ...prev, to: next } : { id: param.id, from: param.name, to: next }
    )
    updateParam(param.id, { name: next })
  }

  /** Deleting a referenced parameter breaks loudly, never rewrites (§4.2). */
  const deleteParam = (param: DraftParameter) => {
    const references = param.name ? findParameterReferences(draft, param.name) : []
    if (references.length > 0) {
      const listing = references.map((site) => `  • ${site}`).join('\n')
       
      const confirmed = window.confirm(
        `"${param.name}" is referenced here:\n${listing}\n\n` +
          'Deleting it will NOT rewrite those references — each flips to an error for you to resolve. Delete anyway?'
      )
      if (!confirmed) return
    }
    update({ parameters: draft.parameters.filter((p) => p.id !== param.id) })
  }

  // -- Roll -----------------------------------------------------------------

  const parsedDice = parseDiceNotation(draft.rollDice.trim())
  const diceError = fieldError((i) => i.where.section === 'roll' && i.where.field === 'dice')
  const rollFieldError = (field: 'min' | 'max' | 'multiplier' | 'offset') =>
    fieldError((i) => i.where.section === 'roll' && i.where.field === field)

  const rangeReadout = useMemo(() => {
    const r = draft.rollRange
    const part = (value: NumberOrParamValue, fallback: string) =>
      value.kind === 'param'
        ? `“${value.name}”`
        : value.kind === 'state'
          ? `state:${value.path}`
          : value.text.trim() === ''
            ? fallback
            : value.text.trim()

    const min = part(r.min, '0')
    const max = part(r.max, '1')
    const pieces = [`Draws uniformly in [${min}, ${max})`]
    const multiplier = part(r.multiplier, '1')
    if (multiplier !== '1') pieces.push(`then ×${multiplier}`)
    const offset = part(r.offset, '0')
    if (offset !== '0') pieces.push(`then +${offset}`)
    if (r.round) pieces.push('then rounds')

    const sentence = `${pieces.join(', ')}.`

    // When fully literal, also show the resulting value bounds.
    const allLiteral = [r.min, r.max, r.multiplier, r.offset].every((v) => v.kind === 'literal')
    if (!allLiteral) return sentence
    const minN = r.min.kind === 'literal' && r.min.text.trim() !== '' ? parseNumberText(r.min.text) : 0
    const maxN = r.max.kind === 'literal' && r.max.text.trim() !== '' ? parseNumberText(r.max.text) : 1
    const multiplierN = r.multiplier.kind === 'literal' && r.multiplier.text.trim() !== '' ? parseNumberText(r.multiplier.text) : 1
    const offsetN = r.offset.kind === 'literal' && r.offset.text.trim() !== '' ? parseNumberText(r.offset.text) : 0
    if (![minN, maxN, multiplierN, offsetN].every(Number.isFinite)) return sentence
    const lowRaw = minN * multiplierN + offsetN
    const highRaw = maxN * multiplierN + offsetN
    let low = Math.min(lowRaw, highRaw)
    let high = Math.max(lowRaw, highRaw)
    if (r.round) {
      low = Math.round(low)
      high = Math.round(high)
    }
    return `${sentence} Values land in [${low}, ${high}).`
  }, [draft.rollRange])

  return (
    <div className="space-y-4">
      {/* Identity */}
      <section className="qt-card p-4 space-y-3">
        <h2 className="qt-card-title text-sm">The contrivance itself</h2>

        <div>
          <label htmlFor="wb-title" className="qt-label">
            Title
          </label>
          <input
            id="wb-title"
            type="text"
            value={draft.title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={draft.name ? displayTitle({ name: draft.name }) : 'Force the Lock'}
            disabled={disabled}
            className="qt-input w-full"
          />
          <p className="qt-hint">
            Optional. Leave it blank and the table announces {draft.name ? `“${displayTitle({ name: draft.name })}”` : 'a title-cased name'}.
          </p>
        </div>

        <div>
          <label htmlFor="wb-chip-label" className="qt-label">
            Chip label
          </label>
          <input
            id="wb-chip-label"
            type="text"
            value={draft.chipLabel}
            maxLength={MAX_CHIP_LABEL_LENGTH}
            onChange={(e) => update({ chipLabel: e.target.value })}
            placeholder="Agent lambda — {{params.label}}"
            disabled={disabled}
            className={`qt-input w-full ${chipLabelError ? 'qt-input-error' : ''}`}
          />
          <p className={chipLabelError ? 'text-xs qt-text-destructive mt-1' : 'qt-hint'}>
            {chipLabelError ??
              'Optional. Names each RUN on the chip and the announcement heading, rendered after the deal — ' +
                'takes {{value}}, {{roll}}, {{dice}}, {{params.name}}, {{metadata.key}}, {{state.path}}, and {{llm}}. ' +
                'Blank, and the title labels the chip.'}
          </p>
          {chipLabelWarnings.map((message) => (
            <p key={message} className="text-xs qt-text-secondary">
              ⚠ {message}
            </p>
          ))}
        </div>

        <div>
          <label htmlFor="wb-name" className="qt-label">
            Name
          </label>
          <input
            id="wb-name"
            type="text"
            value={draft.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="force_the_lock"
            disabled={disabled}
            className={`qt-input w-full font-mono ${nameError ? 'qt-input-error' : ''}`}
            pattern={IDENTIFIER_PATTERN.source}
          />
          <p className={nameError ? 'text-xs qt-text-destructive mt-1' : 'qt-hint'}>
            {nameError ?? 'The tool’s identity: lowercase, starts with a letter, 1–64 characters.'}
          </p>
        </div>

        <div>
          <label htmlFor="wb-description" className="qt-label">
            Description
          </label>
          <textarea
            id="wb-description"
            value={draft.description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={(e) => update({ description: e.target.value })}
            disabled={disabled}
            className={`qt-textarea w-full ${descriptionError ? 'qt-input-error' : ''}`}
            rows={2}
          />
          <p className="qt-hint flex justify-between">
            <span>What the tool does <em>in the fiction</em> — this is how a model decides to reach for it.</span>
            <span>
              {draft.description.length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2" title="Tombstone: suppresses this name at this tier and every farther one">
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={draft.disabled}
              onChange={(e) => update({ disabled: e.target.checked })}
              disabled={disabled}
            />
            Disabled (tombstone)
          </label>
          <label
            className="flex items-center gap-2"
            title="Off: the house does not show the odds — models see only name, description, and parameters"
          >
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={draft.revealOdds}
              onChange={(e) => update({ revealOdds: e.target.checked })}
              disabled={disabled}
            />
            Reveal the odds
          </label>
          <label className="flex items-center gap-2">
            Results
            <select
              value={draft.defaultVisibility}
              onChange={(e) => update({ defaultVisibility: e.target.value as 'public' | 'whisper' })}
              disabled={disabled}
              className="qt-select qt-select-sm"
              aria-label="Default visibility"
            >
              <option value="public">announced publicly</option>
              <option value="whisper">whispered</option>
            </select>
          </label>
        </div>
      </section>

      {/* Availability gate */}
      <GateSection draft={draft} issues={issues} onChange={onChange} disabled={disabled} />

      {/* Parameters */}
      <section className="qt-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="qt-card-title text-sm">Parameters</h2>
          <button
            type="button"
            className="qt-button qt-button-secondary qt-button-sm"
            onClick={addParam}
            disabled={disabled || draft.parameters.length >= MAX_PARAMETERS}
            title={draft.parameters.length >= MAX_PARAMETERS ? `At most ${MAX_PARAMETERS} parameters` : undefined}
          >
            <Icon name="plus" className="w-3.5 h-3.5" />
            Add parameter ({draft.parameters.length}/{MAX_PARAMETERS})
          </button>
        </div>

        {draft.parameters.length === 0 && (
          <p className="text-xs qt-text-secondary">
            None declared. Parameters let the caller weight the roll — a bonus, a difficulty, a material.
          </p>
        )}

        {draft.parameters.map((param) => {
          const numeric = param.type === 'number' || param.type === 'integer'
          const paramError = (field: 'name' | 'default' | 'min' | 'max') =>
            fieldError((i) => i.where.section === 'parameter' && i.where.id === param.id && i.where.field === field)

          return (
            <div key={param.id} className="qt-card p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={param.name}
                  onChange={(e) => handleParamNameChange(param, e.target.value)}
                  onBlur={commitParamRename}
                  placeholder="bonus"
                  disabled={disabled}
                  className={`qt-input w-36 font-mono ${paramError('name') ? 'qt-input-error' : ''}`}
                  aria-label="Parameter name"
                />
                <select
                  value={param.type}
                  onChange={(e) =>
                    updateParam(param.id, {
                      type: e.target.value as DraftParameter['type'],
                      // A type change re-seats the default in the new type's widget.
                      defaultValue:
                        e.target.value === 'boolean' ? false : String(param.defaultValue ?? ''),
                      ...(e.target.value === 'string' || e.target.value === 'boolean'
                        ? { min: '', max: '' }
                        : {}),
                    })
                  }
                  disabled={disabled}
                  className="qt-select qt-select-sm"
                  aria-label="Parameter type"
                >
                  <option value="number">number</option>
                  <option value="integer">integer</option>
                  <option value="string">string</option>
                  <option value="boolean">boolean</option>
                </select>
                <button
                  type="button"
                  className="qt-button qt-button-ghost qt-button-sm ml-auto"
                  onClick={() => deleteParam(param)}
                  disabled={disabled}
                  title="Delete this parameter"
                >
                  <Icon name="trash" className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap text-sm">
                <label className="flex items-center gap-2">
                  Default
                  {isStateRef(param.defaultValue) ? (
                    <span
                      className="qt-text-xs qt-text-secondary font-mono rounded qt-bg-muted px-2 py-1"
                      title="This default draws from persistent state. Edit $state references in the raw JSON."
                    >
                      $state: {param.defaultValue.$state} → {String(param.defaultValue.fallback)}
                    </span>
                  ) : param.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      className="qt-checkbox"
                      checked={Boolean(param.defaultValue)}
                      onChange={(e) => updateParam(param.id, { defaultValue: e.target.checked })}
                      disabled={disabled}
                    />
                  ) : (
                    <input
                      type={param.type === 'string' ? 'text' : 'number'}
                      step={param.type === 'integer' ? 1 : 'any'}
                      value={String(param.defaultValue ?? '')}
                      onChange={(e) => updateParam(param.id, { defaultValue: e.target.value })}
                      disabled={disabled}
                      className={`qt-input w-28 ${paramError('default') ? 'qt-input-error' : ''}`}
                    />
                  )}
                </label>
                {numeric && (
                  <>
                    <label className="flex items-center gap-2">
                      Min
                      <input
                        type="number"
                        step="any"
                        value={param.min}
                        onChange={(e) => updateParam(param.id, { min: e.target.value })}
                        disabled={disabled}
                        className={`qt-input w-24 ${paramError('min') ? 'qt-input-error' : ''}`}
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      Max
                      <input
                        type="number"
                        step="any"
                        value={param.max}
                        onChange={(e) => updateParam(param.id, { max: e.target.value })}
                        disabled={disabled}
                        className={`qt-input w-24 ${paramError('max') ? 'qt-input-error' : ''}`}
                      />
                    </label>
                  </>
                )}
              </div>
              {(paramError('name') || paramError('default') || paramError('min')) && (
                <p className="text-xs qt-text-destructive">
                  {paramError('name') ?? paramError('default') ?? paramError('min')}
                </p>
              )}

              <input
                type="text"
                value={param.description}
                onChange={(e) => updateParam(param.id, { description: e.target.value })}
                placeholder="What this parameter means, in the fiction (optional)"
                disabled={disabled}
                className="qt-input w-full text-sm"
                aria-label="Parameter description"
              />
            </div>
          )
        })}
        <p className="qt-hint">Every parameter needs a default, so a bare invocation can still roll.</p>
      </section>

      {/* Roll */}
      <section className="qt-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="qt-card-title text-sm">The roll</h2>
          <div className="flex rounded overflow-hidden border" role="radiogroup" aria-label="Roll form">
            {(['range', 'dice'] as const).map((form) => (
              <button
                key={form}
                type="button"
                role="radio"
                aria-checked={draft.rollForm === form}
                onClick={() => update({ rollForm: form })}
                disabled={disabled}
                className={`px-3 py-1 text-sm ${draft.rollForm === form ? 'qt-button-primary qt-button' : 'qt-button qt-button-ghost'}`}
              >
                {form === 'range' ? 'Range' : 'Dice'}
              </button>
            ))}
          </div>
        </div>

        {draft.rollForm === 'dice' ? (
          <div className="space-y-1">
            <input
              type="text"
              value={draft.rollDice}
              onChange={(e) => update({ rollDice: e.target.value })}
              placeholder="3d6+2"
              disabled={disabled}
              className={`qt-input w-40 font-mono ${diceError ? 'qt-input-error' : ''}`}
              aria-label="Dice notation"
            />
            {parsedDice ? (
              <p className="qt-hint">
                {parsedDice.count} {parsedDice.count === 1 ? 'die' : 'dice'}, {parsedDice.sides} sides
                {parsedDice.modifier !== 0 &&
                  `, ${parsedDice.modifier > 0 ? '+' : '−'}${Math.abs(parsedDice.modifier)}`}{' '}
                — totals {parsedDice.count + parsedDice.modifier}–{parsedDice.count * parsedDice.sides + parsedDice.modifier}
              </p>
            ) : (
              <p className="text-xs qt-text-destructive">
                Dice notation like &ldquo;3d6+2&rdquo; or &ldquo;1d20&rdquo; ({MIN_DIE_SIDES}–{MAX_DIE_SIDES} sides, 1–{MAX_DICE_COUNT} dice).
              </p>
            )}
            <p className="qt-hint">Dice carry their own modifier; the range transform does not apply.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['min', 'Min', '0'],
                  ['max', 'Max', '1'],
                  ['multiplier', 'Multiplier', '×1'],
                  ['offset', 'Offset', '+0'],
                ] as const
              ).map(([field, label, fallback]) => (
                <label key={field} className="flex items-center justify-between gap-2 text-sm">
                  {label}
                  <NumberOrParamField
                    value={draft.rollRange[field]}
                    onChange={(value) => update({ rollRange: { ...draft.rollRange, [field]: value } })}
                    paramNames={numericNames}
                    placeholder={fallback}
                    hasError={rollFieldError(field) !== null}
                    disabled={disabled}
                    label={label}
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="qt-checkbox"
                checked={draft.rollRange.round}
                onChange={(e) => update({ rollRange: { ...draft.rollRange, round: e.target.checked } })}
                disabled={disabled}
              />
              Round the final value
            </label>
            {(rollFieldError('min') || rollFieldError('max') || rollFieldError('multiplier') || rollFieldError('offset')) && (
              <p className="text-xs qt-text-destructive">
                {rollFieldError('min') ?? rollFieldError('max') ?? rollFieldError('multiplier') ?? rollFieldError('offset')}
              </p>
            )}
            <p className="qt-hint">{rangeReadout}</p>
          </div>
        )}
      </section>

      {/* LLM consult */}
      <section className="qt-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="qt-card-title text-sm">The consulted oracle</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={draft.llmEnabled}
              onChange={(e) => update({ llmEnabled: e.target.checked })}
              disabled={disabled}
            />
            Consult an LLM
          </label>
        </div>

        {draft.llmEnabled ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="wb-llm-prompt" className="qt-label">
                The question
              </label>
              <textarea
                id="wb-llm-prompt"
                value={draft.llmPrompt}
                maxLength={MAX_LLM_PROMPT_LENGTH}
                onChange={(e) => update({ llmPrompt: e.target.value })}
                disabled={disabled}
                rows={3}
                className={`qt-textarea w-full text-sm ${llmError('prompt') ? 'qt-input-error' : ''}`}
                placeholder="The roll came up {{value}}. In one word, YES or NO: does the mechanism yield?"
              />
              <p className={llmError('prompt') ? 'text-xs qt-text-destructive mt-1' : 'qt-hint'}>
                {llmError('prompt') ??
                  'Posed to the instance’s cheap utility model after the roll, before the outcome table. ' +
                    'Takes {{value}}, {{roll}}, {{dice}}, {{params.name}}, and {{metadata.key}}. ' +
                    'Ask for the answer shape the table means to test — a bare word, a number, a sentence.'}
              </p>
              <p className="qt-hint text-right">
                {draft.llmPrompt.length}/{MAX_LLM_PROMPT_LENGTH}
              </p>
            </div>

            <div>
              <label htmlFor="wb-llm-error" className="qt-label">
                When the oracle is silent
              </label>
              <input
                id="wb-llm-error"
                type="text"
                value={draft.llmErrorMessage}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(e) => update({ llmErrorMessage: e.target.value })}
                disabled={disabled}
                className={`qt-input w-full text-sm ${llmError('errorMessage') ? 'qt-input-error' : ''}`}
                placeholder="The wire crackles, and no answer comes."
              />
              <p className={llmError('errorMessage') ? 'text-xs qt-text-destructive mt-1' : 'qt-hint'}>
                {llmError('errorMessage') ??
                  'Stands in as the answer when the consult fails — your words, never the provider’s. ' +
                    'The table can test for it with a “Consult succeeded” condition, and {{llm}} renders it.'}
              </p>
            </div>

            <div>
              <label htmlFor="wb-llm-max-output" className="qt-label">
                Answer cap
              </label>
              <input
                id="wb-llm-max-output"
                type="number"
                min={1}
                max={MAX_LLM_OUTPUT_CEILING}
                step={1}
                value={draft.llmMaxOutput}
                onChange={(e) => update({ llmMaxOutput: e.target.value })}
                disabled={disabled}
                placeholder={String(MAX_LLM_OUTPUT_LENGTH)}
                className={`qt-input w-36 text-sm ${llmError('maxOutput') ? 'qt-input-error' : ''}`}
              />
              <p className={llmError('maxOutput') ? 'text-xs qt-text-destructive mt-1' : 'qt-hint'}>
                {llmError('maxOutput') ??
                  `Characters kept of the answer. Blank means ${MAX_LLM_OUTPUT_LENGTH.toLocaleString()}; ` +
                    `up to ${MAX_LLM_OUTPUT_CEILING.toLocaleString()}. Keep it short for a verdict, ` +
                    'or let a long-winded oracle run on — the call’s token budget follows suit.'}
              </p>
            </div>

            {llmWarnings.map((message) => (
              <p key={message} className="text-xs qt-text-secondary">
                ⚠ {message}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs qt-text-secondary">
            Off. Enable it and every run asks a model your question — the answer becomes {'{{llm}}'} in
            messages and a testable subject in the outcome table, with your own error line when no answer comes.
          </p>
        )}
      </section>
    </div>
  )
}

export default BuilderForm
