'use client'

import { Tooltip } from '@/components/ui/Tooltip'
import type { Message } from '../../types'

/**
 * A small, unobtrusive indicator on any Salon message that carries a resolved
 * answer-confirmation verdict (`confirmed` is not undefined). It reveals the
 * cheap-LLM discrepancy notes — and, on a revision, the pre-revision text — on
 * hover, and holds them open on a click. Metadata, not an alarm; kept quiet by
 * design.
 *
 * The verdict's notes are the longest thing in the action bar and the least
 * suited to a native `title`: too long to survive Chromium's truncation, and
 * gone at the first twitch of the pointer. It is a pinnable {@link Tooltip}
 * instead — hover to glance, click to keep it open and read (or select) the
 * whole of it.
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
  let summary: string

  if (message.confirmed === true && revised) {
    state = 'amended'
    glyph = '✎'
    label = 'Amended'
    summary = 'On reflection the author corrected this reply to match the record.'
  } else if (message.confirmed === true) {
    state = 'vouched'
    glyph = '✓'
    label = 'Vouched'
    summary = 'Checked against what the character recalled and looked up this turn — no contradictions found.'
  } else if (message.confirmed === false) {
    state = 'stood-by'
    glyph = '!'
    label = 'Stood by'
    summary = 'The author was asked about apparent contradictions and stood by this reply unchanged.'
  } else {
    state = 'unvetted'
    glyph = '—'
    label = 'Unvetted'
    summary = 'This reply could not be checked — the verifier was unavailable or the check timed out.'
  }

  const hasDetail = Boolean(notes || original)

  const tooltip = (
    <div className="qt-tooltip-body">
      <p className="qt-tooltip-title">{label}</p>
      <p>{summary}</p>
      {notes && (
        <div className="qt-tooltip-section">
          <p className="qt-tooltip-section-label">What looked off</p>
          <p className="qt-tooltip-quote">{notes}</p>
        </div>
      )}
      {original && (
        <div className="qt-tooltip-section">
          <p className="qt-tooltip-section-label">Originally written</p>
          <p className="qt-tooltip-quote">{original}</p>
        </div>
      )}
      {hasDetail && <p className="qt-tooltip-hint">Click the badge to pin this note; Esc dismisses it.</p>}
    </div>
  )

  // Plain-text twin of the bubble, for assistive technology and for anyone who
  // reaches the badge by keyboard rather than pointer.
  const spoken = [
    `Answer confirmation: ${label}. ${summary}`,
    notes ? `What looked off: ${notes}` : '',
    original ? `Originally written: ${original}` : '',
  ].filter(Boolean).join(' ')

  return (
    <Tooltip content={tooltip} pinnable={hasDetail} interactive={hasDetail}>
      <button
        type="button"
        className="qt-confirmation-badge qt-text-xs"
        data-confirmation-state={state}
        data-has-detail={hasDetail ? 'true' : undefined}
        aria-label={spoken}
      >
        <span aria-hidden="true" className="qt-confirmation-badge-glyph">{glyph}</span>
        <span className="qt-confirmation-badge-label">{label}</span>
      </button>
    </Tooltip>
  )
}
