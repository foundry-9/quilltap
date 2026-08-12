'use client'

/**
 * GateSection — who may reach for this tool at all.
 *
 * The outcome table decides what happens once a tool is run; this decides
 * whether a character is offered it in the first place. Three modes, exclusive
 * by construction (the format admits at most one clause): anyone may reach for
 * it, only those whose fact sheet passes, or everyone except those whose fact
 * sheet passes.
 *
 * The chips are deliberately thinner than the outcome table's. A gate is
 * answered before the deal, so there are no parameters to compare against and
 * no roll to test — every subject is a metadata key and every operand is a
 * literal, and the widget offers exactly that and nothing more.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import {
  CONTAINMENT_COMPARATORS,
  ORDERING_COMPARATORS,
  type ComparatorKey,
  type DraftGateCondition,
  type DraftIssue,
  type GateMode,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { COMPARATOR_LABELS } from './comparator-labels'

interface GateSectionProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  disabled?: boolean
}

const MODE_OPTIONS: Array<{ mode: GateMode; label: string; title: string }> = [
  { mode: 'none', label: 'Anyone', title: 'Every character in the scene is offered this tool' },
  {
    mode: 'available',
    label: 'Only show if…',
    title: 'Offer it only to a character whose fact sheet passes every test below',
  },
  {
    mode: 'withheld',
    label: 'Do not show if…',
    title: 'Withhold it from a character whose fact sheet passes every test below',
  },
]

/** Every comparator is on offer: a metadata key's stored type is unknowable here. */
const COMPARATORS: ComparatorKey[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'ncontains']

let gateIdCounter = 0

export function GateSection({ draft, issues, onChange, disabled = false }: Readonly<GateSectionProps>) {
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)

  const gateIssues = issues.filter((issue) => issue.severity === 'error' && issue.where.section === 'gate')
  const sectionErrors = gateIssues
    .filter((issue) => issue.where.section === 'gate' && issue.where.conditionId === undefined)
    .map((issue) => issue.message)
  const conditionErrorIds = new Set(
    gateIssues
      .map((issue) => (issue.where.section === 'gate' ? issue.where.conditionId : undefined))
      .filter((id): id is string => id !== undefined)
  )

  const setConditions = (gateConditions: DraftGateCondition[]) => onChange({ ...draft, gateConditions })

  const setMode = (gateMode: GateMode) => {
    setDuplicateNotice(null)
    // Conditions survive a mode change, exactly as the roll fields survive a
    // form change: flipping "only if" to "not if" is the commonest edit there
    // is, and retyping the tests to make it would be a poor joke.
    onChange({ ...draft, gateMode })
  }

  const addCondition = () => {
    gateIdCounter += 1
    setDuplicateNotice(null)
    setConditions([
      ...draft.gateConditions,
      { id: `new-gate-${gateIdCounter}`, key: '', comparator: 'eq', operand: { kind: 'boolean', value: true } },
    ])
  }

  const updateCondition = (id: string, next: DraftGateCondition) => {
    // One comparator object carries each key once, so a duplicate key+comparator
    // pair is blocked at the door rather than silently overwriting its twin.
    const slot = `${next.key}:${next.comparator}`
    const collision = draft.gateConditions.some((c) => c.id !== id && `${c.key}:${c.comparator}` === slot)
    if (collision) {
      setDuplicateNotice(`The gate can test “${next.key}” with ${COMPARATOR_LABELS[next.comparator]} only once.`)
      return
    }
    setDuplicateNotice(null)
    setConditions(draft.gateConditions.map((c) => (c.id === id ? next : c)))
  }

  const deleteCondition = (id: string) => {
    setDuplicateNotice(null)
    setConditions(draft.gateConditions.filter((c) => c.id !== id))
  }

  return (
    <section className="qt-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="qt-card-title text-sm">Who may reach for it</h2>
          <p className="qt-hint">
            Tested before the deal, against the invoking character&rsquo;s <code>metadata.json</code> — the only thing
            known before a roll exists.
          </p>
        </div>
        <div className="flex rounded overflow-hidden border" role="radiogroup" aria-label="Availability">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={draft.gateMode === option.mode}
              onClick={() => setMode(option.mode)}
              disabled={disabled}
              title={option.title}
              className={`px-3 py-1 text-sm ${
                draft.gateMode === option.mode ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {draft.gateMode === 'none' ? (
        <p className="text-xs qt-text-secondary">
          Every character in the scene is offered this tool. Set a condition and it becomes theirs alone — the model
          is never told a withheld tool exists, and the composer popup does not list it.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs qt-text-secondary">
            {draft.gateMode === 'available'
              ? 'Offered only to a character whose sheet passes every test:'
              : 'Withheld from a character whose sheet passes every test:'}
          </p>

          {draft.gateConditions.map((condition, index) => (
            <div key={condition.id} className="flex items-center gap-2 flex-wrap">
              {index > 0 && <span className="text-xs qt-text-secondary font-mono">AND</span>}
              <GateChip
                condition={condition}
                hasError={conditionErrorIds.has(condition.id)}
                disabled={disabled}
                onChange={(next) => updateCondition(condition.id, next)}
                onDelete={() => deleteCondition(condition.id)}
              />
            </div>
          ))}

          {duplicateNotice && <p className="text-xs qt-text-destructive">{duplicateNotice}</p>}
          {sectionErrors.map((message) => (
            <p key={message} className="text-xs qt-text-destructive">
              {message}
            </p>
          ))}

          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={addCondition}
            disabled={disabled}
          >
            <Icon name="plus" className="w-3 h-3" />
            add condition
          </button>

          <p className="qt-hint">
            A key the character lacks never matches. So an &ldquo;only show if&rdquo; withholds the tool from a
            character with no sheet at all, while a &ldquo;do not show if&rdquo; still offers it to them.
          </p>
        </div>
      )}
    </section>
  )
}

interface GateChipProps {
  condition: DraftGateCondition
  hasError: boolean
  disabled: boolean
  onChange: (next: DraftGateCondition) => void
  onDelete: () => void
}

function GateChip({ condition, hasError, disabled, onChange, onDelete }: Readonly<GateChipProps>) {
  const ordering = ORDERING_COMPARATORS.has(condition.comparator)
  const containment = CONTAINMENT_COMPARATORS.has(condition.comparator)
  const operand = condition.operand

  const handleComparatorChange = (comparator: ComparatorKey) => {
    // Re-seat the operand in the widget the new comparator can actually use.
    let next = operand
    if (ORDERING_COMPARATORS.has(comparator) && operand.kind !== 'number') {
      next = { kind: 'number', text: operand.kind === 'string' ? operand.text : '' }
    } else if (CONTAINMENT_COMPARATORS.has(comparator) && operand.kind !== 'string') {
      next = { kind: 'string', text: operand.kind === 'number' ? operand.text : '' }
    }
    onChange({ ...condition, comparator, operand: next })
  }

  return (
    <div className={`flex items-center gap-1 flex-wrap rounded border px-2 py-1 ${hasError ? 'qt-input-error' : ''}`}>
      <input
        type="text"
        value={condition.key}
        onChange={(e) => onChange({ ...condition, key: e.target.value })}
        placeholder="key on the character's fact sheet"
        disabled={disabled}
        className={`qt-input w-44 text-sm ${condition.key.trim() === '' ? 'qt-input-error' : ''}`}
        aria-label="Metadata key"
        title="The invoking character's fact sheet — a key the character lacks never matches."
      />

      <select
        value={condition.comparator}
        onChange={(e) => handleComparatorChange(e.target.value as ComparatorKey)}
        disabled={disabled}
        // `.qt-select` is w-full, so the width is pinned here — otherwise an
        // eight-item comparator dropdown stretches across the whole chip and
        // shoves the operand onto a line of its own.
        className="qt-select qt-select-sm w-32 shrink-0"
        aria-label="Comparator"
      >
        {COMPARATORS.map((key) => (
          <option key={key} value={key}>
            {COMPARATOR_LABELS[key]}
          </option>
        ))}
      </select>

      {/* eq/neq alone need a type picker: with the stored type unknowable, only
          the author can say whether they mean 3, "3", or true. */}
      {!ordering && !containment && (
        <select
          value={operand.kind}
          onChange={(e) => {
            const kind = e.target.value as 'number' | 'string' | 'boolean'
            if (kind === 'number') {
              onChange({ ...condition, operand: { kind: 'number', text: operand.kind === 'string' ? operand.text : '' } })
            } else if (kind === 'string') {
              onChange({ ...condition, operand: { kind: 'string', text: operand.kind === 'number' ? operand.text : '' } })
            } else {
              onChange({ ...condition, operand: { kind: 'boolean', value: true } })
            }
          }}
          disabled={disabled}
          className="qt-select qt-select-sm w-24 shrink-0"
          aria-label="Literal type"
        >
          <option value="number">number</option>
          <option value="string">text</option>
          <option value="boolean">true/false</option>
        </select>
      )}

      {operand.kind === 'boolean' ? (
        <select
          value={operand.value ? 'true' : 'false'}
          onChange={(e) => onChange({ ...condition, operand: { kind: 'boolean', value: e.target.value === 'true' } })}
          disabled={disabled}
          className="qt-select qt-select-sm w-20"
          aria-label="Operand value"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : operand.kind === 'string' ? (
        <input
          type="text"
          value={operand.text}
          onChange={(e) => onChange({ ...condition, operand: { kind: 'string', text: e.target.value } })}
          disabled={disabled}
          className="qt-input w-32 text-sm"
          aria-label="Operand text"
        />
      ) : (
        <input
          type="number"
          step="any"
          value={operand.text}
          onChange={(e) => onChange({ ...condition, operand: { kind: 'number', text: e.target.value } })}
          disabled={disabled}
          className="qt-input w-24 text-sm"
          aria-label="Operand number"
        />
      )}

      {(ordering || containment) && (
        <span
          className="text-xs qt-text-secondary"
          title={
            ordering
              ? 'Matches only when the stored value is a number — anything else fails the test, fail-soft, never an error.'
              : 'Matches only when the stored value is text — anything else fails the test, fail-soft, never an error.'
          }
        >
          ⓘ
        </span>
      )}

      <button
        type="button"
        className="qt-button qt-button-ghost qt-button-sm"
        onClick={onDelete}
        disabled={disabled}
        title="Remove this condition"
        aria-label="Remove this condition"
      >
        <Icon name="close" className="w-3 h-3" />
      </button>
    </div>
  )
}

export default GateSection
