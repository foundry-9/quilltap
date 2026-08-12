'use client'

import type { Message } from '../../types'

/**
 * A small, unobtrusive indicator on any Salon message that carries a resolved
 * answer-confirmation verdict (`confirmed` is not undefined). It reveals the
 * cheap-LLM discrepancy notes — and, on a revision, the pre-revision text — on
 * hover. Metadata, not an alarm; kept quiet by design.
 *
 * States:
 *   confirmed true  & !revised → "Vouched"    (consistent; no notes)
 *   confirmed true  &  revised → "Amended"    (rewritten; notes + original)
 *   confirmed false            → "Stood by"   (affirmed a flagged answer; notes)
 *   confirmed null             → "Unvetted"   (check could not run)
 */
export function ConfirmationBadge({ message }: { message: Message }) {
  // Show whenever a check ran. `confirmed` is true/false/null live, but a
  // reloaded "unverified" (null) comes back as undefined from SQL NULL — so
  // `confirmationChecked` is what tells an unverified message from an unchecked
  // one after a refresh.
  const checked = message.confirmationChecked === true
  if (message.confirmed === undefined && !checked) return null

  const revised = message.confirmationRevised === true
  const notes = message.confirmationNotes ?? ''
  const original = message.confirmationOriginalContent ?? ''

  let state: 'vouched' | 'amended' | 'stood-by' | 'unvetted'
  let glyph: string
  let label: string
  let title: string

  if (message.confirmed === true && revised) {
    state = 'amended'
    glyph = '✎'
    label = 'Amended'
    title = `On reflection the author corrected this reply to match the record.${notes ? `\n\nWhat looked off:\n${notes}` : ''}${original ? `\n\nOriginally written:\n${original}` : ''}`
  } else if (message.confirmed === true) {
    state = 'vouched'
    glyph = '✓'
    label = 'Vouched'
    title = 'Checked against what the character recalled and looked up this turn — no contradictions found.'
  } else if (message.confirmed === false) {
    state = 'stood-by'
    glyph = '!'
    label = 'Stood by'
    title = `The author was asked about apparent contradictions and stood by this reply unchanged.${notes ? `\n\nWhat looked off:\n${notes}` : ''}`
  } else {
    state = 'unvetted'
    glyph = '—'
    label = 'Unvetted'
    title = 'This reply could not be checked — the verifier was unavailable or the check timed out.'
  }

  return (
    <span
      className="qt-confirmation-badge qt-text-xs"
      data-confirmation-state={state}
      title={title}
      aria-label={`Answer confirmation: ${label}. ${title}`}
    >
      <span aria-hidden="true" className="qt-confirmation-badge-glyph">{glyph}</span>
      <span className="qt-confirmation-badge-label">{label}</span>
    </span>
  )
}
