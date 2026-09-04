'use client'

/**
 * OutcomesSection — the cascading outcome table.
 *
 * An ordered list, checked top to bottom, first row whose every condition
 * holds wins. The final row is the pinned catch-all: not movable, not
 * deletable, its condition reading "otherwise" — which makes the loader's
 * ordering rule unviolatable by construction. Conditions are chips (subject +
 * comparator + operand) joined by AND; a duplicate subject+comparator pair is
 * blocked at the door because one comparator object can carry each key once.
 */

import { useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import {
  CONTAINMENT_KEYS,
  MAX_MESSAGE_LENGTH,
  MAX_OUTCOMES,
  ORDERING_KEYS,
  PLACEHOLDER_PATTERN,
  valueTypeOf,
  type ComparatorKey,
  type OutcomeState,
  type ValueType,
} from '@/lib/pascal/custom-tool.types'
import {
  conditionSlotKey,
  nextDraftId,
  reseatOperandForComparator,
  subjectValueType,
  type ConditionOperand,
  type ConditionSubject,
  type DraftCondition,
  type DraftIssue,
  type DraftOutcome,
  type LiteralOperand,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { COMPARATOR_LABELS } from './comparator-labels'
import { LiteralOperandField } from './LiteralOperandField'

interface OutcomesSectionProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  /** Outcome id to flash after a bench roll lands on it. */
  flashOutcomeId?: string | null
  disabled?: boolean
}

const STATE_OPTIONS: Array<{ state: OutcomeState; label: string; badge: string }> = [
  { state: 'success', label: 'success', badge: 'qt-badge qt-badge-success' },
  { state: 'partial', label: 'partial', badge: 'qt-badge qt-badge-warning' },
  { state: 'failure', label: 'failure', badge: 'qt-badge qt-badge-destructive' },
  { state: 'info', label: 'info', badge: 'qt-badge qt-badge-info' },
]

/** Serialize a subject select value; `param:` and `metadata` carry extra state. */
function subjectSelectValue(subject: ConditionSubject): string {
  switch (subject.kind) {
    case 'value':
      return 'value'
    case 'roll':
      return 'roll'
    case 'param':
      return `param:${subject.name}`
    case 'metadata':
      return 'metadata'
    case 'llm':
      return 'llm'
    case 'llm-ok':
      return 'llm-ok'
  }
}

export function OutcomesSection({
  draft,
  issues,
  onChange,
  flashOutcomeId = null,
  disabled = false,
}: Readonly<OutcomesSectionProps>) {
  const outcomes = draft.outcomes
  const nonTailCount = outcomes.length - 1
  const canAdd = outcomes.length < MAX_OUTCOMES

  const outcomeErrors = (id: string, conditionId?: string): string[] =>
    issues
      .filter(
        (issue) =>
          issue.severity === 'error' &&
          (issue.where.section === 'outcome' || issue.where.section === 'message') &&
          issue.where.id === id &&
          (conditionId === undefined || (issue.where.section === 'outcome' && issue.where.conditionId === conditionId))
      )
      .map((issue) => issue.message)

  const messageWarnings = (id: string): string[] =>
    issues
      .filter((issue) => issue.severity === 'warning' && issue.where.section === 'message' && issue.where.id === id)
      .map((issue) => issue.message)

  const setOutcomes = (next: DraftOutcome[]) => onChange({ ...draft, outcomes: next })

  const updateOutcome = (id: string, partial: Partial<DraftOutcome>) =>
    setOutcomes(outcomes.map((o) => (o.id === id ? { ...o, ...partial } : o)))

  const addOutcome = () => {
    const fresh: DraftOutcome = {
      id: nextDraftId('new-outcome'),
      catchAll: false,
      conditions: [],
      state: 'success',
      message: '',
    }
    // Insert above the pinned catch-all.
    setOutcomes([...outcomes.slice(0, -1), fresh, outcomes[outcomes.length - 1]])
  }

  const deleteOutcome = (id: string) => setOutcomes(outcomes.filter((o) => o.id !== id))

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= nonTailCount) return
    const next = [...outcomes]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOutcomes(next)
  }

  return (
    <section className="qt-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="qt-card-title text-sm">The outcome table</h2>
          <p className="qt-hint">Checked top to bottom — the first row whose every condition holds wins.</p>
        </div>
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm"
          onClick={addOutcome}
          disabled={disabled || !canAdd}
          title={canAdd ? 'Insert a row above the catch-all' : `At most ${MAX_OUTCOMES} outcomes`}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Add outcome ({outcomes.length}/{MAX_OUTCOMES})
        </button>
      </div>

      {outcomes.map((outcome, index) => (
        <OutcomeRow
          key={outcome.id}
          outcome={outcome}
          index={index}
          isTail={index === outcomes.length - 1}
          draft={draft}
          errors={outcomeErrors(outcome.id)}
          conditionErrorIds={
            new Set(
              issues
                .filter(
                  (i) =>
                    i.severity === 'error' &&
                    i.where.section === 'outcome' &&
                    i.where.id === outcome.id &&
                    i.where.conditionId !== undefined
                )
                .map((i) => (i.where.section === 'outcome' ? i.where.conditionId! : ''))
            )
          }
          warnings={messageWarnings(outcome.id)}
          flash={flashOutcomeId === outcome.id}
          disabled={disabled}
          onUpdate={(partial) => updateOutcome(outcome.id, partial)}
          onDelete={() => deleteOutcome(outcome.id)}
          onMoveUp={() => move(index, -1)}
          onMoveDown={() => move(index, 1)}
          canMoveUp={index > 0 && index < nonTailCount}
          canMoveDown={index < nonTailCount - 1}
        />
      ))}
    </section>
  )
}

interface OutcomeRowProps {
  outcome: DraftOutcome
  index: number
  isTail: boolean
  draft: ToolDraft
  errors: string[]
  conditionErrorIds: Set<string>
  warnings: string[]
  flash: boolean
  disabled: boolean
  onUpdate: (partial: Partial<DraftOutcome>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

function OutcomeRow({
  outcome,
  index,
  isTail,
  draft,
  errors,
  conditionErrorIds,
  warnings,
  flash,
  disabled,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: Readonly<OutcomeRowProps>) {
  const hasError = errors.length > 0
  const accent = `qt-pascal-result qt-pascal-result--${outcome.state}`

  return (
    <div
      className={`${accent} qt-card p-3 space-y-2 ${hasError ? 'qt-input-error border' : ''} ${
        flash ? 'qt-highlight' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs qt-text-secondary font-mono w-6">{isTail ? '∞' : index + 1}</span>

        {isTail ? (
          <span className="text-sm italic" title="The mandatory catch-all: every roll lands somewhere">
            otherwise
          </span>
        ) : (
          <span className="text-sm">when…</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {!isTail && (
            <>
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm"
                onClick={onMoveUp}
                disabled={disabled || !canMoveUp}
                title="Move up"
                aria-label={`Move outcome ${index + 1} up`}
              >
                <Icon name="chevron-down" className="w-3.5 h-3.5 rotate-180" />
              </button>
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm"
                onClick={onMoveDown}
                disabled={disabled || !canMoveDown}
                title="Move down"
                aria-label={`Move outcome ${index + 1} down`}
              >
                <Icon name="chevron-down" className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm"
                onClick={onDelete}
                disabled={disabled}
                title="Delete this outcome"
                aria-label={`Delete outcome ${index + 1}`}
              >
                <Icon name="trash" className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {!isTail && (
        <ConditionList
          outcome={outcome}
          draft={draft}
          conditionErrorIds={conditionErrorIds}
          disabled={disabled}
          onUpdate={onUpdate}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1" role="radiogroup" aria-label="Outcome state">
          {STATE_OPTIONS.map((option) => (
            <button
              key={option.state}
              type="button"
              role="radio"
              aria-checked={outcome.state === option.state}
              onClick={() => onUpdate({ state: option.state })}
              disabled={disabled}
              className={`${option.badge} ${outcome.state === option.state ? '' : 'opacity-40'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <MessageEditor outcome={outcome} draft={draft} disabled={disabled} onUpdate={onUpdate} />

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
}

// ---------------------------------------------------------------------------
// Condition chips
// ---------------------------------------------------------------------------

interface ConditionListProps {
  outcome: DraftOutcome
  draft: ToolDraft
  conditionErrorIds: Set<string>
  disabled: boolean
  onUpdate: (partial: Partial<DraftOutcome>) => void
}

function ConditionList({ outcome, draft, conditionErrorIds, disabled, onUpdate }: Readonly<ConditionListProps>) {
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)

  const setConditions = (conditions: DraftCondition[]) => onUpdate({ conditions })

  const updateCondition = (id: string, next: DraftCondition) => {
    // Block a change that would collide with an existing subject+comparator
    // slot — one comparator object carries each key once (§4.4.1).
    const slot = conditionSlotKey(next)
    const collision = outcome.conditions.some((c) => c.id !== id && conditionSlotKey(c) === slot)
    if (collision) {
      setDuplicateNotice(describeSlot(next))
      return
    }
    setDuplicateNotice(null)
    setConditions(outcome.conditions.map((c) => (c.id === id ? next : c)))
  }

  const addCondition = () => {
    const base: DraftCondition = {
      id: nextDraftId('new-cond'),
      subject: { kind: 'value' },
      comparator: 'gte',
      operand: { kind: 'number', text: '' },
    }
    // Find a free slot so the fresh chip never lands on a duplicate.
    const taken = new Set(outcome.conditions.map(conditionSlotKey))
    const comparators: ComparatorKey[] = ['gte', 'gt', 'lte', 'lt', 'eq', 'neq']
    for (const subject of [{ kind: 'value' } as const, { kind: 'roll' } as const]) {
      for (const comparator of comparators) {
        if (!taken.has(conditionSlotKey({ subject, comparator }))) {
          setConditions([...outcome.conditions, { ...base, subject, comparator }])
          return
        }
      }
    }
    // Every value/roll slot is taken; fall back to a metadata chip.
    setConditions([
      ...outcome.conditions,
      { ...base, subject: { kind: 'metadata', key: '' }, operand: { kind: 'number', text: '' } },
    ])
  }

  const deleteCondition = (id: string) => {
    setDuplicateNotice(null)
    setConditions(outcome.conditions.filter((c) => c.id !== id))
  }

  return (
    <div className="space-y-1 pl-6">
      {outcome.conditions.map((condition, i) => (
        <div key={condition.id} className="flex items-center gap-2 flex-wrap">
          {i > 0 && <span className="text-xs qt-text-secondary font-mono">AND</span>}
          <ConditionChip
            condition={condition}
            draft={draft}
            hasError={conditionErrorIds.has(condition.id)}
            disabled={disabled}
            onChange={(next) => updateCondition(condition.id, next)}
            onDelete={() => deleteCondition(condition.id)}
          />
        </div>
      ))}
      {duplicateNotice && <p className="text-xs qt-text-destructive">{duplicateNotice}</p>}
      <button
        type="button"
        className="qt-button qt-button-ghost qt-button-sm"
        onClick={addCondition}
        disabled={disabled}
      >
        <Icon name="plus" className="w-3 h-3" />
        add condition
      </button>
    </div>
  )
}

function describeSlot(condition: Pick<DraftCondition, 'subject' | 'comparator'>): string {
  const label = COMPARATOR_LABELS[condition.comparator]
  switch (condition.subject.kind) {
    case 'value':
      return `A row can test ${label} on the value only once.`
    case 'roll':
      return `A row can test ${label} on the raw roll only once.`
    case 'param':
      return `A row can test ${label} on "${condition.subject.name}" only once.`
    case 'metadata':
      return `A row can test ${label} on metadata "${condition.subject.key}" only once.`
    case 'llm':
      return `A row can test ${label} on the consult's answer only once.`
    case 'llm-ok':
      return 'A row can test whether the consult succeeded only once.'
  }
}

interface ConditionChipProps {
  condition: DraftCondition
  draft: ToolDraft
  hasError: boolean
  disabled: boolean
  onChange: (next: DraftCondition) => void
  onDelete: () => void
}

function ConditionChip({ condition, draft, hasError, disabled, onChange, onDelete }: Readonly<ConditionChipProps>) {
  const paramByName = new Map(draft.parameters.map((p) => [p.name, p] as const))
  const subject = condition.subject

  // null where the type is unknowable at authoring time — a metadata key's
  // stored value, or whatever the consulted model chooses to answer.
  const typeOfSubject = (s: ConditionSubject): ValueType | null => subjectValueType(s, paramByName)

  const subjectType = typeOfSubject(subject)

  // Metadata and the consult's answer offer every comparator — the stored type
  // is unknowable at authoring time (§4.4.1). String subjects offer equality
  // and containment; boolean subjects only = and ≠; numbers cannot contain.
  const comparators: ComparatorKey[] =
    subjectType === 'string'
      ? ['eq', 'neq', 'contains', 'ncontains']
      : subjectType === 'boolean'
        ? ['eq', 'neq']
        : subjectType === null
          ? ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'ncontains']
          : ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']

  const ordering = ORDERING_KEYS.has(condition.comparator)
  const containment = CONTAINMENT_KEYS.has(condition.comparator)

  /** Parameters an operand reference may name, mirroring `validateComparator`. */
  const eligibleOperandParams = draft.parameters
    .filter((p) => {
      if (!p.name) return false
      // A substring must be text whatever the subject turns out to hold.
      if (containment) return p.type === 'string'
      if (subject.kind === 'metadata' || subject.kind === 'llm') {
        // With the subject's type unknown, no reference can be ruled
        // incompatible — ordering still demands a number, though.
        return !ordering || p.type === 'number' || p.type === 'integer'
      }
      const paramType = valueTypeOf(p.type)
      if (ordering) return paramType === 'number'
      return subjectType === null || paramType === subjectType
    })
    .map((p) => p.name)

  const handleSubjectChange = (value: string) => {
    let nextSubject: ConditionSubject
    if (value === 'value') nextSubject = { kind: 'value' }
    else if (value === 'roll') nextSubject = { kind: 'roll' }
    else if (value === 'metadata') nextSubject = { kind: 'metadata', key: subject.kind === 'metadata' ? subject.key : '' }
    else if (value === 'llm') nextSubject = { kind: 'llm' }
    else if (value === 'llm-ok') nextSubject = { kind: 'llm-ok' }
    else nextSubject = { kind: 'param', name: value.slice('param:'.length) }

    // Re-legalize the comparator and operand for the new subject's type.
    let nextComparator = condition.comparator
    const nextType = typeOfSubject(nextSubject)
    if ((nextType === 'string' || nextType === 'boolean') && ORDERING_KEYS.has(nextComparator)) {
      nextComparator = 'eq'
    }
    if ((nextType === 'number' || nextType === 'boolean') && CONTAINMENT_KEYS.has(nextComparator)) {
      nextComparator = 'eq'
    }
    let nextOperand: ConditionOperand = condition.operand
    if (nextType === 'boolean' && nextOperand.kind !== 'param') nextOperand = { kind: 'boolean', value: true }
    else if (nextType === 'string' && nextOperand.kind === 'number') nextOperand = { kind: 'string', text: nextOperand.text }
    else if (nextType === 'number' && (nextOperand.kind === 'string' || nextOperand.kind === 'boolean')) {
      nextOperand = { kind: 'number', text: nextOperand.kind === 'string' ? nextOperand.text : '' }
    }

    onChange({ ...condition, subject: nextSubject, comparator: nextComparator, operand: nextOperand })
  }

  const handleComparatorChange = (comparator: ComparatorKey) =>
    onChange({ ...condition, comparator, operand: reseatOperandForComparator(condition.operand, comparator) })

  return (
    <div className={`flex items-center gap-1 flex-wrap rounded border px-2 py-1 ${hasError ? 'qt-input-error' : ''}`}>
      <select
        value={subjectSelectValue(subject)}
        onChange={(e) => handleSubjectChange(e.target.value)}
        disabled={disabled}
        className="qt-select qt-select-sm"
        aria-label="Condition subject"
      >
        <option value="value">Value</option>
        <option value="roll" title="The raw pre-transform draw">
          Raw roll
        </option>
        {draft.parameters
          .filter((p) => p.name)
          .map((p) => (
            <option key={p.id} value={`param:${p.name}`}>
              Parameter: {p.name}
            </option>
          ))}
        <option value="metadata">Metadata…</option>
        {draft.llmEnabled && (
          <>
            <option value="llm" title="What the consulted model answered">
              Consult answer
            </option>
            <option value="llm-ok" title="Whether the consult produced an answer at all">
              Consult succeeded
            </option>
          </>
        )}
      </select>

      {subject.kind === 'metadata' && (
        <input
          type="text"
          value={subject.key}
          onChange={(e) => onChange({ ...condition, subject: { kind: 'metadata', key: e.target.value } })}
          placeholder="key on the character's fact sheet"
          disabled={disabled}
          className={`qt-input w-44 text-sm ${subject.key.trim() === '' ? 'qt-input-error' : ''}`}
          aria-label="Metadata key"
          title="The invoking character's fact sheet — a key the character lacks simply doesn't match."
        />
      )}

      <select
        value={condition.comparator}
        onChange={(e) => handleComparatorChange(e.target.value as ComparatorKey)}
        disabled={disabled}
        className="qt-select qt-select-sm min-w-14"
        aria-label="Comparator"
      >
        {comparators.map((key) => (
          <option key={key} value={key}>
            {COMPARATOR_LABELS[key]}
          </option>
        ))}
      </select>

      <OperandField
        condition={condition}
        subjectType={subjectType}
        eligibleParams={eligibleOperandParams}
        disabled={disabled}
        onChange={onChange}
      />

      {subject.kind === 'metadata' && (ordering || containment) && (
        <span
          className="text-xs qt-text-secondary"
          title={
            ordering
              ? 'Matches only when the stored value is a number — anything else declines the row at run time, fail-soft, never an error.'
              : 'Matches only when the stored value is text — anything else declines the row at run time, fail-soft, never an error.'
          }
        >
          ⓘ
        </span>
      )}

      {subject.kind === 'llm' && ordering && (
        <span
          className="text-xs qt-text-secondary"
          title="Matches only when the answer reads as a number — anything else declines the row at run time, fail-soft, never an error."
        >
          ⓘ
        </span>
      )}

      {subject.kind === 'llm' && containment && (
        <span
          className="text-xs qt-text-secondary"
          title="Searches the answer without regard to case — 'west door' finds 'the West Door'."
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

interface OperandFieldProps {
  condition: DraftCondition
  subjectType: 'number' | 'string' | 'boolean' | null
  eligibleParams: string[]
  disabled: boolean
  onChange: (next: DraftCondition) => void
}

function OperandField({ condition, subjectType, eligibleParams, disabled, onChange }: Readonly<OperandFieldProps>) {
  const operand = condition.operand
  const ordering = ORDERING_KEYS.has(condition.comparator)
  const containment = CONTAINMENT_KEYS.has(condition.comparator)
  const typeUnknowable = condition.subject.kind === 'metadata' || condition.subject.kind === 'llm'

  const setOperand = (next: ConditionOperand) => onChange({ ...condition, operand: next })

  // Metadata / consult-answer eq/neq: no declared type steers the widget, so a
  // segmented literal-type picker chooses between number, text, and true/false
  // (§4.4.1). Containment needs no picker — the substring is always text.
  const showTypePicker =
    typeUnknowable && !ordering && !containment && operand.kind !== 'param' && operand.kind !== 'state'

  /**
   * The literal the shared widget renders. A string operand against a numeric
   * subject (no containment) shows as a blank number field rather than text —
   * the subject's declared type steers the widget, and typing into it re-seats
   * the operand as a number.
   */
  const literal = (o: LiteralOperand): LiteralOperand =>
    o.kind === 'string' && !(containment || subjectType !== 'number') ? { kind: 'number', text: '' } : o

  return (
    <div className="flex items-center gap-1">
      {operand.kind === 'state' ? (
        <span
          className="qt-text-xs qt-text-secondary font-mono rounded qt-bg-muted px-2 py-1"
          title="This operand draws from persistent state. Edit $state references in the raw JSON."
        >
          $state: {operand.path} → {String(operand.fallback)}
        </span>
      ) : operand.kind === 'param' ? (
        <select
          value={operand.name}
          onChange={(e) => setOperand({ kind: 'param', name: e.target.value })}
          disabled={disabled}
          className="qt-select qt-select-sm w-28"
          aria-label="Operand parameter"
        >
          {!eligibleParams.includes(operand.name) && <option value={operand.name}>{operand.name || '—'}</option>}
          {eligibleParams.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : (
        <LiteralOperandField
          operand={literal(operand)}
          onChange={setOperand}
          disabled={disabled}
          showTypePicker={showTypePicker}
        />
      )}

      <button
        type="button"
        onClick={() =>
          operand.kind === 'param'
            ? setOperand(
                containment || subjectType === 'string'
                  ? { kind: 'string', text: '' }
                  : subjectType === 'boolean'
                    ? { kind: 'boolean', value: true }
                    : { kind: 'number', text: '' }
              )
            : setOperand({ kind: 'param', name: eligibleParams[0] ?? '' })
        }
        disabled={disabled || (operand.kind !== 'param' && eligibleParams.length === 0)}
        className="qt-button qt-button-ghost qt-button-sm"
        title={
          operand.kind === 'param'
            ? 'Use a literal instead'
            : eligibleParams.length === 0
              ? 'Declare a compatible parameter first'
              : 'Compare against a parameter'
        }
        aria-label="Toggle operand between a literal and a parameter reference"
      >
        <Icon name="swap" className="w-3 h-3" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message editor
// ---------------------------------------------------------------------------

interface MessageEditorProps {
  outcome: DraftOutcome
  draft: ToolDraft
  disabled: boolean
  onUpdate: (partial: Partial<DraftOutcome>) => void
}

function MessageEditor({ outcome, draft, disabled, onUpdate }: Readonly<MessageEditorProps>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const insertAtCursor = (placeholder: string) => {
    const textarea = textareaRef.current
    setMenuOpen(false)
    if (!textarea) {
      onUpdate({ message: outcome.message + placeholder })
      return
    }
    const start = textarea.selectionStart ?? outcome.message.length
    const end = textarea.selectionEnd ?? start
    const next = outcome.message.slice(0, start) + placeholder + outcome.message.slice(end)
    onUpdate({ message: next })
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + placeholder.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  const insertMetadataKey = () => {
    // Suggest keys the author demonstrably cares about: those already tested
    // in this tool's `when` objects (§4.4.2).
    const testedKeys = new Set<string>()
    for (const o of draft.outcomes) {
      for (const condition of o.conditions) {
        if (condition.subject.kind === 'metadata' && condition.subject.key.trim() !== '') {
          testedKeys.add(condition.subject.key)
        }
      }
    }
    const suggestion = [...testedKeys][0] ?? ''
     
    const key = window.prompt('Metadata key to render (any non-empty string):', suggestion)
    if (key && key.trim() !== '') insertAtCursor(`{{metadata.${key.trim()}}}`)
    else setMenuOpen(false)
  }

  /** Placeholders present in the text, for the visibility strip. */
  const placeholders = [...outcome.message.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[0])

  return (
    <div className="space-y-1">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={outcome.message}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(e) => onUpdate({ message: e.target.value })}
          disabled={disabled}
          rows={2}
          className="qt-textarea w-full text-sm"
          placeholder="What Pascal announces when this row wins…"
          aria-label="Outcome message"
        />
        <div className="absolute top-1 right-1">
          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={disabled}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            Insert value ▾
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 qt-card qt-shadow-lg rounded border z-10 py-1 w-52" role="menu">
              <MenuItem label="Value" onClick={() => insertAtCursor('{{value}}')} />
              <MenuItem label="Raw roll" onClick={() => insertAtCursor('{{roll}}')} />
              {draft.rollForm === 'dice' && (
                <MenuItem label="Dice breakdown" onClick={() => insertAtCursor('{{dice}}')} />
              )}
              {draft.parameters
                .filter((p) => p.name)
                .map((p) => (
                  <MenuItem key={p.id} label={`Parameter: ${p.name}`} onClick={() => insertAtCursor(`{{params.${p.name}}}`)} />
                ))}
              <MenuItem label="Metadata key…" onClick={insertMetadataKey} />
              {draft.llmEnabled && (
                <MenuItem label="Consult answer" onClick={() => insertAtCursor('{{llm}}')} />
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {placeholders.map((placeholder, i) => (
          <code key={`${placeholder}-${i}`} className="qt-badge qt-badge-outline font-mono">
            {placeholder}
          </code>
        ))}
        <span className="text-xs qt-text-secondary ml-auto">
          {outcome.message.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </div>
    </div>
  )
}

function MenuItem({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      role="menuitem"
      className="block w-full text-left px-3 py-1 text-sm hover:qt-bg-muted"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export default OutcomesSection
