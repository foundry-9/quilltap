/**
 * Tests for lib/services/dangerous-content/concierge-state-presentation.ts
 *
 * The presentation table is the single source for every word the four states
 * wear on screen, so the tests pin the whole table rather than a sample: a copy
 * edit should be a deliberate one-line change here, not a silent drift.
 */

import {
  CONCIERGE_STATE_PRESENTATION,
  conciergeToneSuffix,
  conciergeToneTextClass,
  describeConciergeState,
} from '@/lib/services/dangerous-content/concierge-state-presentation'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

const ALL_STATES: ConciergeState[] = ['monitored', 'flagged', 'vouched', 'uncensored']

describe('CONCIERGE_STATE_PRESENTATION', () => {
  it.each([
    ['monitored', 'Monitored', 'eye', 'success'],
    ['flagged', 'Flagged', 'alert-triangle', 'danger'],
    ['vouched', 'Vouched Safe', 'check-circle', 'muted'],
    ['uncensored', 'Uncensored', 'eye-off', 'info'],
  ])('describes %s as %s / %s / %s', (state, label, icon, tone) => {
    const presentation = CONCIERGE_STATE_PRESENTATION[state as ConciergeState]
    expect(presentation.label).toBe(label)
    expect(presentation.icon).toBe(icon)
    expect(presentation.tone).toBe(tone)
  })

  it('covers all four states, each with a detail sentence and the same hint', () => {
    expect(Object.keys(CONCIERGE_STATE_PRESENTATION).sort()).toEqual([...ALL_STATES].sort())
    for (const state of ALL_STATES) {
      expect(CONCIERGE_STATE_PRESENTATION[state].detail.length).toBeGreaterThan(0)
      expect(CONCIERGE_STATE_PRESENTATION[state].hint).toBe(
        "Change it from the Salon sidebar's Chat section."
      )
    }
  })

  it('keeps the sidebar helper sentences verbatim', () => {
    expect(CONCIERGE_STATE_PRESENTATION.monitored.detail).toBe(
      'The Concierge keeps watch, and will flip the switch himself if the conversation calls for it.'
    )
    expect(CONCIERGE_STATE_PRESENTATION.flagged.detail).toBe(
      'The Concierge has this chat down as dangerous, and routes it through the uncensored providers.'
    )
    expect(CONCIERGE_STATE_PRESENTATION.vouched.detail).toBe(
      'You have vouched for this chat. The Concierge stops watching; the ordinary providers still apply, and may still refuse.'
    )
    expect(CONCIERGE_STATE_PRESENTATION.uncensored.detail).toBe(
      'You have sent the Concierge away and opened the uncensored door yourself. Nothing is scanned, nothing is softened — the risk is yours.'
    )
  })

  it('gives every state a distinct label and icon', () => {
    const labels = ALL_STATES.map(s => CONCIERGE_STATE_PRESENTATION[s].label)
    const icons = ALL_STATES.map(s => CONCIERGE_STATE_PRESENTATION[s].icon)
    expect(new Set(labels).size).toBe(4)
    expect(new Set(icons).size).toBe(4)
  })
})

describe('conciergeToneSuffix', () => {
  it('leaves the danger base rule unsuffixed and names the two modifiers', () => {
    expect(conciergeToneSuffix('danger')).toBe('')
    expect(conciergeToneSuffix('muted')).toBe('-muted')
    expect(conciergeToneSuffix('info')).toBe('-info')
  })

  it('falls through to the base for success (Monitored draws no badge and no mark)', () => {
    expect(conciergeToneSuffix('success')).toBe('')
  })

  it.each([
    ['flagged', ''],
    ['vouched', '-muted'],
    ['uncensored', '-info'],
  ])('gives %s the class suffix "%s"', (state, suffix) => {
    expect(conciergeToneSuffix(CONCIERGE_STATE_PRESENTATION[state as ConciergeState].tone)).toBe(suffix)
  })
})

describe('conciergeToneTextClass', () => {
  it.each([
    ['monitored', 'qt-text-success'],
    ['flagged', 'qt-text-danger'],
    ['vouched', 'qt-text-muted'],
    ['uncensored', 'qt-text-info'],
  ])('gives %s the text class %s', (state, expected) => {
    expect(conciergeToneTextClass(CONCIERGE_STATE_PRESENTATION[state as ConciergeState].tone)).toBe(expected)
  })
})

describe('describeConciergeState', () => {
  it.each(ALL_STATES)('reads %s straight off the table', (state) => {
    const presentation = CONCIERGE_STATE_PRESENTATION[state]
    expect(describeConciergeState(state)).toEqual({
      title: presentation.label,
      detail: presentation.detail,
      categories: null,
      hint: presentation.hint,
    })
  })

  it('surfaces categories for Flagged when the chat carries any', () => {
    expect(describeConciergeState('flagged', ['NSFW', 'Violence']).categories).toEqual(['NSFW', 'Violence'])
  })

  it('omits an empty category list even for Flagged', () => {
    expect(describeConciergeState('flagged', []).categories).toBeNull()
    expect(describeConciergeState('flagged', undefined).categories).toBeNull()
  })

  it.each(['monitored', 'vouched', 'uncensored'] as ConciergeState[])(
    'never surfaces the preserved categories on %s',
    (state) => {
      // The categories are the classifier's reasons; on the two operator states
      // (and on Monitored) they are a stale artefact, not a live verdict.
      expect(describeConciergeState(state, ['NSFW']).categories).toBeNull()
    }
  )
})
