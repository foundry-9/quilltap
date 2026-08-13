/**
 * Layer 1.5 coverage that did not exist until bug 63.
 *
 * The plugin had NO tests at all, which is why the two code-context guards it
 * was missing went unnoticed — see
 * `docs/developer/bugs/fixed/bug-63-text-replacement-in-code.md`. This suite
 * pins the guards together with the bail conditions that were always intended,
 * so the pair of typing aids cannot drift apart again.
 */

import { TextReplacementPlugin } from '@/components/chat/lexical/plugins/TextReplacementPlugin'

import React from 'react'
import { $setCompositionKey, $getSelection, $isRangeSelection, UNDO_COMMAND } from 'lexical'

import {
  renderPluginEditor,
  seedParagraph,
  seedCodeBlock,
  seedInlineCode,
  readText,
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

const RULES = compileRules([
  {
    id: 'r1',
    fromText: 'fn',
    toText: 'function',
    enabled: true,
    caseSensitive: false,
    createdAt: '',
    updatedAt: '',
  },
] as never)

describe('TextReplacementPlugin', () => {
  let harness: PluginHarness
  const realFetch = global.fetch

  beforeEach(() => {
    // ⚠ `jest.setup.ts` assigns `global.fetch` directly, which REPLACES
    // jest-fetch-mock's function — `fetchMock.mockResponse(...)` is a silent
    // no-op in this repo. Stub `global.fetch` ourselves so the settings query
    // actually resolves to the flag under test.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ textReplacementsEnabled: true }),
      text: async () => '{"textReplacementsEnabled":true}',
    })) as unknown as typeof fetch
    useTextReplacementRules.mockReturnValue({ compiled: RULES })
  })

  afterEach(() => {
    harness?.unmount()
  })

  afterAll(() => {
    global.fetch = realFetch
  })

  function mount() {
    harness = renderPluginEditor(<TextReplacementPlugin />)
    return harness.editor
  }

  describe('the feature itself', () => {
    it('replaces a trigger word on a boundary character', () => {
      const editor = mount()
      seedParagraph(editor, 'const fn')

      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe('const function ')
    })

    it.each([' ', '.', ',', ';', ':', '!', '?', ')', '\t'])(
      'fires on the %j boundary character',
      (boundary) => {
        const editor = mount()
        seedParagraph(editor, 'fn')

        pressKey(editor, boundary)

        expect(readText(editor)).toBe(`function${boundary}`)
      },
    )

    it('leaves a non-boundary keystroke alone', () => {
      const editor = mount()
      seedParagraph(editor, 'fn')

      const { defaultPrevented } = pressKey(editor, 'a')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('fn')
    })

    it('reverts to the literal typed text in ONE undo', () => {
      const editor = mount()
      seedParagraph(editor, 'const fn')
      pressKey(editor, ' ')
      expect(readText(editor)).toBe('const function ')

      // The replacement and its trigger character go in a single tagged update,
      // so one step of history restores what was actually typed.
      editor.dispatchCommand(UNDO_COMMAND, undefined)
      flush(editor)

      expect(readText(editor)).toBe('const fn')
    })
  })

  describe('bug 63 — code is never rewritten', () => {
    it('does not fire inside a fenced code block', () => {
      const editor = mount()
      seedCodeBlock(editor, 'const fn')

      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('const fn')
    })

    it('does not fire inside an inline code run', () => {
      const editor = mount()
      seedInlineCode(editor, 'fn')

      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('fn')
    })

    it('STILL fires in ordinary prose (the regression check)', () => {
      const editor = mount()
      seedParagraph(editor, 'fn')

      pressKey(editor, ' ')

      expect(readText(editor)).toBe('function ')
    })
  })

  describe('bail conditions', () => {
    it('does nothing while an IME composition is active', () => {
      const editor = mount()
      seedParagraph(editor, 'fn')

      editor.update(
        () => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setCompositionKey(selection.anchor.getNode().getKey())
          }
        },
        { discrete: true },
      )

      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('fn')
    })

    it('does nothing when the rule list is empty', () => {
      useTextReplacementRules.mockReturnValue({ compiled: compileRules([]) })
      const editor = mount()
      seedParagraph(editor, 'fn')

      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('fn')
    })

    it('does nothing when the cursor is mid-word rather than at the end', () => {
      const editor = mount()
      seedParagraph(editor, 'fnx')
      editor.update(
        () => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) selection.anchor.offset = 2
        },
        { discrete: true },
      )

      pressKey(editor, ' ')

      expect(readText(editor)).toBe('fnx')
    })

    it('does nothing when the word does not match a rule', () => {
      const editor = mount()
      seedParagraph(editor, 'notarule')

      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('notarule')
    })
  })
})
