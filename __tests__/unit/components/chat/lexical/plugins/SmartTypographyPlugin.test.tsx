/**
 * Layer 1.6, Part B (Tier C) — the adapter.
 *
 * The rule engine is pinned by its own corpus (`lib/smart-typography/__tests__`),
 * so this suite is about the things only a real editor can prove: the bail
 * conditions, the two undo mechanisms, and the registration-order contract with
 * Layer 1.5's TextReplacementPlugin — which is the test that fails if someone
 * reorders the plugin stack.
 */

import { SmartTypographyPlugin } from '@/components/chat/lexical/plugins/SmartTypographyPlugin'
import { TextReplacementPlugin } from '@/components/chat/lexical/plugins/TextReplacementPlugin'

import React from 'react'
import { $setCompositionKey, UNDO_COMMAND } from 'lexical'

import {
  renderPluginEditor,
  seedParagraph,
  seedCodeBlock,
  seedInlineCode,
  readText,
  readCaretOffset,
  pressKey,
  flush,
  type PluginHarness,
} from '../../../../../helpers/lexicalPluginHarness'
import { compileRules } from '@/lib/text-replacement/useTextReplacementRules'

jest.mock('@/lib/text-replacement/useTextReplacementRules', () => {
  const actual = jest.requireActual('@/lib/text-replacement/useTextReplacementRules')
  return {
    ...actual,
    useTextReplacementRules: jest.fn(),
  }
})

const { useTextReplacementRules } = jest.requireMock(
  '@/lib/text-replacement/useTextReplacementRules',
) as { useTextReplacementRules: jest.Mock }

const EN_DASH = '–'
const EM_DASH = '—'
const ELLIPSIS = '…'

/** The Layer 1.5 rule used by the interaction table at the bottom of the file. */
const ARIS_RULES = compileRules([
  {
    id: 'r1',
    fromText: 'Aris',
    toText: 'Aristarchus the Wise',
    enabled: true,
    caseSensitive: false,
    createdAt: '',
    updatedAt: '',
  },
] as never)

describe('SmartTypographyPlugin', () => {
  let harness: PluginHarness
  const realFetch = global.fetch
  let settingsPayload: Record<string, unknown>

  beforeEach(() => {
    // ⚠ `jest.setup.ts` assigns `global.fetch` directly, which REPLACES
    // jest-fetch-mock's function — `fetchMock.mockResponse(...)` is a silent
    // no-op in this repo. Stub `global.fetch` ourselves so the settings query
    // actually resolves to the flags under test.
    settingsPayload = { smartTypographySettings: { dashes: true, ellipsis: true } }
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => settingsPayload,
      text: async () => JSON.stringify(settingsPayload),
    })) as unknown as typeof fetch
    useTextReplacementRules.mockReturnValue({ compiled: ARIS_RULES })
    jest.spyOn(console, 'debug').mockImplementation(() => {})

    // jsdom implements no `Selection.modify`, which Lexical's OWN rich-text
    // Backspace handler calls once our plugin declines the keystroke. Without
    // this the pass-through cases throw from inside Lexical and we learn nothing
    // about our plugin. A no-op is right here: these tests assert what the
    // PLUGIN decided (`defaultPrevented`), not what Lexical's deletion did.
    if (typeof (window.Selection?.prototype as { modify?: unknown })?.modify !== 'function') {
      ;(window.Selection.prototype as unknown as { modify: () => void }).modify = () => {}
    }
  })

  afterEach(() => {
    harness?.unmount()
    jest.restoreAllMocks()
  })

  afterAll(() => {
    global.fetch = realFetch
  })

  function mount() {
    harness = renderPluginEditor(<SmartTypographyPlugin />)
    return harness.editor
  }

  describe('the dash ladder', () => {
    it('turns a second hyphen into an en dash', () => {
      const editor = mount()
      seedParagraph(editor, '1920-')

      const { defaultPrevented } = pressKey(editor, '-')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe(`1920${EN_DASH}`)
    })

    it('promotes the en dash to an em dash on the third hyphen', () => {
      const editor = mount()
      seedParagraph(editor, `wait${EN_DASH}`)

      pressKey(editor, '-')

      expect(readText(editor)).toBe(`wait${EM_DASH}`)
    })

    it('walks the whole ladder from a bare word', () => {
      const editor = mount()
      seedParagraph(editor, 'wait')

      // The first hyphen is ordinary typing — the plugin must not swallow it.
      const first = pressKey(editor, '-')
      expect(first.defaultPrevented).toBe(false)
      // The harness dispatches the command only; ordinary insertion is the
      // browser's job, so seed the state the browser would have produced.
      seedParagraph(editor, 'wait-')

      pressKey(editor, '-')
      expect(readText(editor)).toBe(`wait${EN_DASH}`)

      pressKey(editor, '-')
      expect(readText(editor)).toBe(`wait${EM_DASH}`)
    })

    it('stops at the em dash — a fourth hyphen is the escape hatch', () => {
      const editor = mount()
      seedParagraph(editor, `wait${EM_DASH}`)

      const { defaultPrevented } = pressKey(editor, '-')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(`wait${EM_DASH}`)
    })
  })

  describe('the ellipsis', () => {
    it('turns a third dot into an ellipsis', () => {
      const editor = mount()
      seedParagraph(editor, 'Well..')

      const { defaultPrevented } = pressKey(editor, '.')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe(`Well${ELLIPSIS}`)
    })

    it('leaves a second dot alone', () => {
      const editor = mount()
      seedParagraph(editor, 'Well.')

      const { defaultPrevented } = pressKey(editor, '.')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('Well.')
    })

    it('leaves a dot after an existing ellipsis alone', () => {
      const editor = mount()
      seedParagraph(editor, `Well${ELLIPSIS}`)

      pressKey(editor, '.')

      expect(readText(editor)).toBe(`Well${ELLIPSIS}`)
    })

    it('places the caret immediately after the substitution', () => {
      const editor = mount()
      seedParagraph(editor, 'Well..')

      pressKey(editor, '.')

      // "Well" + one ellipsis character.
      expect(readCaretOffset(editor)).toBe(5)
    })
  })

  describe('bail conditions', () => {
    it('ignores a non-trigger keystroke', () => {
      const editor = mount()
      seedParagraph(editor, 'wait-')

      const { defaultPrevented } = pressKey(editor, 'x')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('wait-')
    })

    it('does not fire inside a fenced code block', () => {
      const editor = mount()
      seedCodeBlock(editor, 'npm run build -')

      const { defaultPrevented } = pressKey(editor, '-')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('npm run build -')
    })

    it('does not fire inside inline code', () => {
      const editor = mount()
      seedInlineCode(editor, '--verbose..')

      expect(pressKey(editor, '.').defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('--verbose..')
    })

    it('does not fire during IME composition', () => {
      const editor = mount()
      seedParagraph(editor, 'wait-')
      editor.update(() => {
        $setCompositionKey('some-key')
      }, { discrete: true })

      const { defaultPrevented } = pressKey(editor, '-')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('wait-')
    })

    it('does not fire at the start of a block', () => {
      const editor = mount()
      seedParagraph(editor, '')

      const { defaultPrevented } = pressKey(editor, '-')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('')
    })
  })

  describe('per-rule gating', () => {
    it('honors dashes off / ellipsis on', async () => {
      settingsPayload = { smartTypographySettings: { dashes: false, ellipsis: true } }
      const editor = mount()
      await waitForSettings()

      seedParagraph(editor, 'wait-')
      expect(pressKey(editor, '-').defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('wait-')

      seedParagraph(editor, 'Well..')
      pressKey(editor, '.')
      expect(readText(editor)).toBe(`Well${ELLIPSIS}`)
    })

    it('honors ellipsis off / dashes on', async () => {
      settingsPayload = { smartTypographySettings: { dashes: true, ellipsis: false } }
      const editor = mount()
      await waitForSettings()

      seedParagraph(editor, 'Well..')
      expect(pressKey(editor, '.').defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('Well..')

      seedParagraph(editor, 'wait-')
      pressKey(editor, '-')
      expect(readText(editor)).toBe(`wait${EN_DASH}`)
    })

    it('does nothing at all when both are off', async () => {
      settingsPayload = { smartTypographySettings: { dashes: false, ellipsis: false } }
      const editor = mount()
      await waitForSettings()

      seedParagraph(editor, 'wait-')
      expect(pressKey(editor, '-').defaultPrevented).toBe(false)
      seedParagraph(editor, 'Well..')
      expect(pressKey(editor, '.').defaultPrevented).toBe(false)
    })
  })

  describe('undo and escape', () => {
    it('reverts in ONE undo', () => {
      const editor = mount()
      seedParagraph(editor, 'Well..')
      pressKey(editor, '.')
      expect(readText(editor)).toBe(`Well${ELLIPSIS}`)

      editor.dispatchCommand(UNDO_COMMAND, undefined)
      flush(editor)

      expect(readText(editor)).toBe('Well..')
    })

    it('reverts on an immediate Backspace, restoring the literal characters', () => {
      const editor = mount()
      seedParagraph(editor, 'Well..')
      pressKey(editor, '.')
      expect(readText(editor)).toBe(`Well${ELLIPSIS}`)

      const { defaultPrevented } = pressKey(editor, 'Backspace')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe('Well...')
      expect(readCaretOffset(editor)).toBe(7)
    })

    it('restores the en dash literal, not a bare hyphen', () => {
      const editor = mount()
      seedParagraph(editor, '1920-')
      pressKey(editor, '-')

      pressKey(editor, 'Backspace')

      expect(readText(editor)).toBe('1920--')
    })

    it('restores what was typed before an em dash, keeping the en dash', () => {
      const editor = mount()
      seedParagraph(editor, `wait${EN_DASH}`)
      pressKey(editor, '-')
      expect(readText(editor)).toBe(`wait${EM_DASH}`)

      pressKey(editor, 'Backspace')

      // Exactly the buffer that would have existed without the substitution.
      expect(readText(editor)).toBe(`wait${EN_DASH}-`)
    })

    /*
     * NOTE on assertions below: once our plugin declines a Backspace, Lexical's
     * own rich-text handler claims it, so `defaultPrevented` says nothing about
     * what WE did (the harness documents this trap). The signal is the text: a
     * revert is the only thing that can put the literal `--`/`...` back, so its
     * absence is proof the plugin stood down.
     */

    it('does not revert an en dash the writer typed themselves', () => {
      const editor = mount()
      // No substitution preceded this, so there is no memo and nothing to undo.
      seedParagraph(editor, `1920${EN_DASH}`)

      pressKey(editor, 'Backspace')

      expect(readText(editor)).not.toContain('--')
    })

    it('forgets the substitution once anything else happens', () => {
      const editor = mount()
      seedParagraph(editor, 'Well..')
      pressKey(editor, '.')
      expect(readText(editor)).toBe(`Well${ELLIPSIS}`)

      // Any other edit invalidates the memo — here, re-seeding the paragraph
      // stands in for the writer typing on.
      seedParagraph(editor, `Well${ELLIPSIS}x`)

      pressKey(editor, 'Backspace')

      expect(readText(editor)).not.toContain('...')
    })

    it('never revives a memo for a second Backspace', () => {
      const editor = mount()
      seedParagraph(editor, 'Well..')
      pressKey(editor, '.')
      pressKey(editor, 'Backspace')
      expect(readText(editor)).toBe('Well...')

      pressKey(editor, 'Backspace')

      // A second revert would have to re-insert the ellipsis it just removed.
      expect(readText(editor)).not.toContain(ELLIPSIS)
    })
  })

  describe('logging', () => {
    it('logs once per substitution and never on an ordinary keystroke', () => {
      const debug = console.debug as jest.Mock
      const editor = mount()

      seedParagraph(editor, 'Well.')
      pressKey(editor, '.')
      expect(debug).not.toHaveBeenCalled()

      seedParagraph(editor, 'Well..')
      pressKey(editor, '.')

      expect(debug).toHaveBeenCalledTimes(1)
      expect(debug.mock.calls[0][0]).toContain('[smart-typography]')
      expect(debug.mock.calls[0][0]).toContain('ellipsis')
    })
  })

  /**
   * The registration-order contract with Layer 1.5.
   *
   * Smart typography registers at COMMAND_PRIORITY_NORMAL (2), text replacement
   * at COMMAND_PRIORITY_LOW (1), and Lexical's `triggerCommandListeners` loops
   * `for (let i = 4; i >= 0; i--)` — so NORMAL runs first. This table is the
   * whole reason that ordering was fixed deliberately rather than left to
   * registration accident, and it is what fails if someone reorders the stack.
   */
  describe('interaction with Layer 1.5 text replacement', () => {
    function mountBoth() {
      harness = renderPluginEditor(
        <>
          <SmartTypographyPlugin />
          <TextReplacementPlugin />
        </>,
      )
      return harness.editor
    }

    it('resolves `Aris...` as replacement, then replacement-miss, then ellipsis', () => {
      const editor = mountBoth()
      seedParagraph(editor, 'Aris')

      // 1st `.`: before = "is" → no typography match; text replacement fires.
      pressKey(editor, '.')
      expect(readText(editor)).toBe('Aristarchus the Wise.')

      // 2nd `.`: before = "e." → not `..`; text replacement sees an empty word.
      // The harness dispatches commands only, so stand in for the browser's
      // ordinary insertion of the unclaimed keystroke.
      const second = pressKey(editor, '.')
      expect(second.defaultPrevented).toBe(false)
      seedParagraph(editor, 'Aristarchus the Wise..')

      // 3rd `.`: before = ".." → typography claims it; text replacement never
      // sees the keystroke.
      const third = pressKey(editor, '.')
      expect(third.defaultPrevented).toBe(true)
      expect(readText(editor)).toBe(`Aristarchus the Wise${ELLIPSIS}`)
    })

    it('leaves a plain text replacement untouched', () => {
      const editor = mountBoth()
      seedParagraph(editor, 'Aris')

      pressKey(editor, ' ')

      expect(readText(editor)).toBe('Aristarchus the Wise ')
    })
  })
})

/**
 * Let the settings query resolve so the plugin's ref carries the flags under
 * test rather than the `?? true` defaults it mounts with.
 */
async function waitForSettings(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
