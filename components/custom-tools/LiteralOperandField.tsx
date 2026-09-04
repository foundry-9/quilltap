'use client'

/**
 * LiteralOperandField — the literal right-hand side of a condition chip, as
 * both the outcome table and the availability gate render it: an optional
 * number / text / true-false picker, then the input that kind takes.
 *
 * The picker exists for eq/neq against a subject whose stored type is
 * unknowable at authoring time (a metadata key, the consult's answer): only
 * the author can say whether they mean 3, "3", or true. Switching kinds keeps
 * typed text between number and text and starts a boolean at `true`.
 */

import type { LiteralOperand } from '@/lib/pascal/tool-draft'

interface LiteralOperandFieldProps {
  operand: LiteralOperand
  onChange: (next: LiteralOperand) => void
  disabled: boolean
  /** Show the number / text / true-false picker before the input. */
  showTypePicker: boolean
  /** Extra classes on the picker — the gate pins its width so the chip stays on one line. */
  pickerClassName?: string
  /** Extra classes on the text input; the two chips size it differently. */
  textClassName?: string
}

/** The operand a picker choice produces from the one being replaced. */
function literalOfKind(kind: LiteralOperand['kind'], current: LiteralOperand): LiteralOperand {
  if (kind === 'number') return { kind: 'number', text: current.kind === 'string' ? current.text : '' }
  if (kind === 'string') return { kind: 'string', text: current.kind === 'number' ? current.text : '' }
  return { kind: 'boolean', value: true }
}

export function LiteralOperandField({
  operand,
  onChange,
  disabled,
  showTypePicker,
  pickerClassName = '',
  textClassName = 'w-28',
}: Readonly<LiteralOperandFieldProps>) {
  return (
    <>
      {showTypePicker && (
        <select
          value={operand.kind}
          onChange={(e) => onChange(literalOfKind(e.target.value as LiteralOperand['kind'], operand))}
          disabled={disabled}
          className={`qt-select qt-select-sm ${pickerClassName}`.trim()}
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
          onChange={(e) => onChange({ kind: 'boolean', value: e.target.value === 'true' })}
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
          onChange={(e) => onChange({ kind: 'string', text: e.target.value })}
          disabled={disabled}
          className={`qt-input ${textClassName} text-sm`}
          aria-label="Operand text"
        />
      ) : (
        <input
          type="number"
          step="any"
          value={operand.text}
          onChange={(e) => onChange({ kind: 'number', text: e.target.value })}
          disabled={disabled}
          className="qt-input w-24 text-sm"
          aria-label="Operand number"
        />
      )}
    </>
  )
}

export default LiteralOperandField
