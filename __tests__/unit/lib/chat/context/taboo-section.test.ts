/**
 * Unit tests for the Taboo prompt section (`instance_settings['taboo']`
 * rendered into the system prompt).
 *
 * Two things are load-bearing and tested here:
 *  - **Empty means absent.** An instance that never touches the feature must
 *    produce a byte-identical prompt to one built before the feature existed,
 *    or the golden cache-determinism hash moves for everybody.
 *  - **Placement.** The section belongs between the universal math-formatting
 *    note and the per-turn tool instructions, so it stays inside the cacheable
 *    system block 1.
 */

import {
  buildSystemPrompt,
  renderTabooSection,
} from '@/lib/chat/context/system-prompt-builder'
import type { Character } from '@/lib/schemas/types'

const now = '2025-01-01T00:00:00.000Z'

const CHARACTER = {
  id: 'char-1',
  name: 'Test Character',
  personality: 'Friendly and helpful',
  systemPrompts: [
    {
      id: 'prompt-1',
      name: 'Default',
      content: 'You are a helpful assistant.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  scenarios: [],
  createdAt: now,
  updatedAt: now,
} as unknown as Character

const MATH_MARKER = '[FORMATTING: MATHEMATICAL NOTATION]'
const TABOO_MARKER = '[STYLE: FORBIDDEN PHRASES]'

describe('renderTabooSection', () => {
  it('returns null for an empty list', () => {
    expect(renderTabooSection([])).toBeNull()
  })

  it('returns null when the phrases are absent entirely', () => {
    expect(renderTabooSection(undefined)).toBeNull()
    expect(renderTabooSection(null)).toBeNull()
  })

  it('returns null when every phrase is blank', () => {
    expect(renderTabooSection(['', '   '])).toBeNull()
  })

  it('renders each phrase as a quoted bullet, in stored order', () => {
    const section = renderTabooSection(['weight-bearing', "that's not nothing"])

    expect(section).toBe(
      `${TABOO_MARKER}
The phrases below are worn-out clichés, beneath you. They never appear in anything you say — not verbatim, and not as inflections, rewordings, or near-variants of the same formula. When one of them would be the easy thing to reach for, say what you actually mean in plain, specific words instead. Never mention, quote, or allude to this list.
- "weight-bearing"
- "that's not nothing"`,
    )
  })

  it('preserves the given order rather than sorting', () => {
    const section = renderTabooSection(['zeta', 'alpha', 'mu'])!
    expect(section.indexOf('"zeta"')).toBeLessThan(section.indexOf('"alpha"'))
    expect(section.indexOf('"alpha"')).toBeLessThan(section.indexOf('"mu"'))
  })

  it('carries the positive instruction and the do-not-mention clause', () => {
    const section = renderTabooSection(['weight-bearing'])!
    // These clauses defend against prohibition-without-alternative and against
    // characters joking about the list; a "simplification" to a bare list of
    // banned strings should fail here.
    expect(section).toContain('say what you actually mean in plain, specific words instead')
    expect(section).toContain('Never mention, quote, or allude to this list')
    expect(section).toContain('inflections, rewordings, or near-variants')
  })

  it('trims blanks out of an otherwise populated list', () => {
    const section = renderTabooSection(['  weight-bearing  ', '   ', 'tapestry'])!
    expect(section).toContain('- "weight-bearing"')
    expect(section).toContain('- "tapestry"')
    expect(section).not.toContain('- ""')
  })

  it('emits phrases literally, without template processing', () => {
    // A user is free to forbid a phrase containing template syntax; it must
    // reach the model as typed rather than being substituted or stripped.
    const section = renderTabooSection(['as {{char}} always says'])!
    expect(section).toContain('- "as {{char}} always says"')
  })

  it('is byte-identical across consecutive calls', () => {
    const phrases = ['weight-bearing', "that's not nothing"]
    expect(renderTabooSection(phrases)).toBe(renderTabooSection(phrases))
  })
})

describe('buildSystemPrompt — Taboo integration', () => {
  it('omits the section entirely when the option is absent', () => {
    // The announcer and self_inventory call sites rely on this default.
    const prompt = buildSystemPrompt({ character: CHARACTER })
    expect(prompt).not.toContain(TABOO_MARKER)
  })

  it('omits the section when the list is empty', () => {
    const prompt = buildSystemPrompt({ character: CHARACTER, tabooPhrases: [] })
    expect(prompt).not.toContain(TABOO_MARKER)
  })

  it('produces a byte-identical prompt for "absent" and "empty list"', () => {
    const without = buildSystemPrompt({ character: CHARACTER })
    const empty = buildSystemPrompt({ character: CHARACTER, tabooPhrases: [] })
    expect(empty).toBe(without)
  })

  it('places the section after the math note and before tool instructions', () => {
    const prompt = buildSystemPrompt({
      character: CHARACTER,
      toolInstructions: 'Tools available: foo, bar.',
      tabooPhrases: ['weight-bearing'],
    })

    const mathIdx = prompt.indexOf(MATH_MARKER)
    const tabooIdx = prompt.indexOf(TABOO_MARKER)
    const toolIdx = prompt.indexOf('Tools available: foo, bar.')

    expect(mathIdx).toBeGreaterThanOrEqual(0)
    expect(tabooIdx).toBeGreaterThan(mathIdx)
    expect(toolIdx).toBeGreaterThan(tabooIdx)
  })

  it('still sits after the math note when there are no tool instructions', () => {
    const prompt = buildSystemPrompt({
      character: CHARACTER,
      tabooPhrases: ['weight-bearing'],
    })
    expect(prompt.indexOf(TABOO_MARKER)).toBeGreaterThan(prompt.indexOf(MATH_MARKER))
  })

  it('does not template-process the phrases it renders', () => {
    const prompt = buildSystemPrompt({
      character: CHARACTER,
      tabooPhrases: ['as {{char}} always says'],
    })
    expect(prompt).toContain('- "as {{char}} always says"')
    expect(prompt).not.toContain('as Test Character always says')
  })
})
