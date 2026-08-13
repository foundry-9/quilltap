/**
 * Layer 2.0u composer Unicode — plugin-level coverage of the UNICODE profile.
 *
 * Mirrors the emoji suite with the profile swapped, which is the point: the
 * adapter is one implementation, so the two suites differ only where the
 * PROFILES differ — the trailing-space commit instead of a closing colon, the
 * math-span bail, case-sensitive aliases, and code-point entry.
 *
 * Runs against a REAL Lexical editor and the REAL committed dataset (served
 * through the fetch mock, exactly as the browser would fetch it).
 *
 * The `\name` MATCH RULES themselves are pinned in `lib/char-insert/__tests__`
 * against a shared corpus that quilltap-v5 copies; this suite is about the
 * wiring.
 */

import { CharTypeaheadPlugin } from '@/components/chat/lexical/plugins/CharTypeaheadPlugin'
import { UNICODE_PROFILE } from '@/lib/char-insert/profiles/unicode'
import { TextReplacementPlugin } from '@/components/chat/lexical/plugins/TextReplacementPlugin'

import React from 'react'
import { act } from '@testing-library/react'
import { $setCompositionKey, $getSelection, $isRangeSelection, UNDO_COMMAND } from 'lexical'

import {
  renderPluginEditor,
  seedParagraph,
  seedCodeBlock,
  seedInlineCode,
  seedAfterBoldRun,
  readText,
  readCaretOffset,
  pressKey,
  flush,
  type PluginHarness,
} from '../../../../../helpers/lexicalPluginHarness'
import { insertCharAtSelection } from '@/components/chat/char-insert/insert-char'
import { compileRules } from '@/lib/text-replacement/useTextReplacementRules'

import datasetPayload from '../../../../../../public/unicode/unicode-index.v1.json'

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

/** Spelled by lookup so no invisible or easily-transcribed-wrong code point is typed here. */
function charForAlias(alias: string): string {
  const row = (datasetPayload.entries as { c: string; s: string[] }[]).find((entry) =>
    entry.s.includes(alias),
  )
  if (!row) throw new Error(`The committed dataset has no \\${alias}`)
  return row.c
}

const ARROW = charForAlias('to') // →
const PHI_LOWER = charForAlias('phi') // φ
const PHI_UPPER = charForAlias('Phi') // Φ

let unicodeFetchCount = 0
const realFetch = global.fetch

/**
 * ⚠ `jest.setup.ts` assigns `global.fetch` directly, which REPLACES
 * jest-fetch-mock's function — so `fetchMock.mockResponse(...)` is a silent
 * no-op in this repo. Route by assigning `global.fetch` ourselves instead.
 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function stubFetch({ settings = {}, datasetFails = false } = {}) {
  unicodeFetchCount = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url

    if (url.includes('unicode-index.v1.json')) {
      unicodeFetchCount += 1
      if (datasetFails) return jsonResponse({ error: 'nope' }, 500)
      return jsonResponse(datasetPayload)
    }
    return jsonResponse({ composerUnicode: true, textReplacementsEnabled: true, ...settings })
  }) as unknown as typeof fetch
}

describe('CharTypeaheadPlugin — unicode profile', () => {
  let harness: PluginHarness

  beforeEach(() => {
    UNICODE_PROFILE.loader.resetForTests()
    window.localStorage.clear()
    stubFetch()
    useTextReplacementRules.mockReturnValue({ compiled: compileRules([]) })
  })

  afterEach(() => {
    harness?.unmount()
  })

  afterAll(() => {
    global.fetch = realFetch
  })

  function mount(extra?: React.ReactNode) {
    harness = renderPluginEditor(
      <>
        <CharTypeaheadPlugin profile={UNICODE_PROFILE} />
        {extra}
      </>,
    )
    return harness.editor
  }

  /** Let the TanStack settings query resolve so the flag is actually in effect. */
  async function settleSettings() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  /**
   * Warm the lazy dataset the way the app does. The `\` typeahead fetches from
   * the TRIGGER path, never from the space bar, so drive it with a typed query.
   */
  async function warmIndex(editor: ReturnType<typeof mount>) {
    seedParagraph(editor, 'warm \\ab')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  describe('the trailing-space commit', () => {
    it('commits an exact alias and keeps the space the writer typed', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'go \\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe(`go ${ARROW} `)
    })

    it('leaves the caret after the space', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '\\to')
      pressKey(editor, ' ')

      expect(readText(editor)).toBe(`${ARROW} `)
      expect(readCaretOffset(editor)).toBe(`${ARROW} `.length)
    })

    /** ⚠ The correctness point the whole spec is organized around. */
    it('respects alias CASE — \\phi is φ and \\Phi is Φ', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '\\phi')
      pressKey(editor, ' ')
      expect(readText(editor)).toBe(`${PHI_LOWER} `)

      seedParagraph(editor, '\\Phi')
      pressKey(editor, ' ')
      expect(readText(editor)).toBe(`${PHI_UPPER} `)

      expect(PHI_LOWER).not.toBe(PHI_UPPER)
    })

    it('commits a code point with no table lookup', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '\\u{1D538}')
      pressKey(editor, ' ')

      expect(readText(editor)).toBe('\u{1D538} ')
    })

    it('lets an unknown alias through as literal text', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'hello \\notacommand')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('hello \\notacommand')
    })

    it('records the pick in the Unicode recents, not the emoji ones', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '\\to')
      pressKey(editor, ' ')

      expect(
        JSON.parse(window.localStorage.getItem(UNICODE_PROFILE.recentsStorageKey)!),
      ).toEqual([ARROW])
      expect(window.localStorage.getItem('quilltap.emoji.recents.v1')).toBeNull()
    })

    it('reverts to the literal typed text in ONE undo', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'go \\to')
      pressKey(editor, ' ')
      expect(readText(editor)).toBe(`go ${ARROW} `)

      editor.dispatchCommand(UNDO_COMMAND, undefined)
      flush(editor)

      expect(readText(editor)).toBe('go \\to')
    })
  })

  describe('triggers that must never fire', () => {
    it.each([
      ['a markdown escape', 'literal \\*'],
      ['an escaped underscore', 'literal \\_'],
      ['an escaped bracket', 'literal \\['],
      ['a Windows path', 'open C:\\User'],
      ['a lone backslash', 'a \\'],
    ])('does not commit on %s', async (_label, text) => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, text)
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(text)
    })

    it('does not commit when the backslash is glued to a preceding bold run', async () => {
      const editor = mount()
      await warmIndex(editor)

      // The anchor text node starts at `\`, so a naive offset-0 check would read
      // it as the start of the block. It is not — `bold` precedes it.
      seedAfterBoldRun(editor, 'bold', '\\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('bold\\to')
    })
  })

  /** The hazard the spec singles out: a `\` typeahead that eats people's LaTeX. */
  describe('the math bail', () => {
    it.each([
      ['display math', '$$\\to'],
      ['single-dollar math', '$\\to'],
      ['a backslash-paren span', '\\(\\to'],
      ['a backslash-bracket span', '\\[\\to'],
    ])('leaves %s alone', async (_label, text) => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, text)
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(text)
    })

    it('still fires after a currency amount, which is not math', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'costs $5 and \\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe(`costs $5 and ${ARROW} `)
    })

    it('still fires after a CLOSED formula', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '$$x$$ and \\to')
      pressKey(editor, ' ')

      expect(readText(editor)).toBe(`$$x$$ and ${ARROW} `)
    })
  })

  describe('bail conditions', () => {
    it('does nothing inside a fenced code block', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedCodeBlock(editor, 'const x = \\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('const x = \\to')
    })

    it('does nothing inside an inline code run', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedInlineCode(editor, '\\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('\\to')
    })

    it('does nothing while an IME composition is active', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '\\to')
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
      expect(readText(editor)).toBe('\\to')
    })

    it('is inert when composerUnicode is off — and never even fetches the dataset', async () => {
      stubFetch({ settings: { composerUnicode: false } })
      const editor = mount()
      await settleSettings()

      seedParagraph(editor, '\\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('\\to')
      expect(unicodeFetchCount).toBe(0)
    })

    it('is inert, without throwing, when the dataset cannot be loaded', async () => {
      stubFetch({ datasetFails: true })
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, '\\to')
      const { defaultPrevented } = pressKey(editor, ' ')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('\\to')
    })
  })

  describe('the lazy dataset', () => {
    /**
     * The space bar is the commit key, and it is the most-pressed key there is.
     * Fetching from it would mean every instance downloads 300 KB the moment
     * anyone types a sentence.
     */
    it('is NEVER fetched from the space bar', async () => {
      const editor = mount()
      await settleSettings()

      seedParagraph(editor, 'no backslashes here')
      pressKey(editor, ' ')
      pressKey(editor, ' ')

      expect(unicodeFetchCount).toBe(0)
    })

    it('is fetched once a `\\` query is in play, and only once', async () => {
      const editor = mount()
      await warmIndex(editor)
      expect(unicodeFetchCount).toBe(1)

      seedParagraph(editor, '\\to')
      pressKey(editor, ' ')
      seedParagraph(editor, '\\phi')
      pressKey(editor, ' ')

      expect(unicodeFetchCount).toBe(1)
    })
  })

  describe('interaction with Layer 1.5 text replacement', () => {
    it('lets a space typed after a replaceable word still fire the replacement', async () => {
      useTextReplacementRules.mockReturnValue({
        compiled: compileRules([
          {
            id: 'r1',
            fromText: 'fn',
            toText: 'function',
            enabled: true,
            caseSensitive: false,
            createdAt: '',
            updatedAt: '',
          },
        ] as never),
      })

      const editor = mount(<TextReplacementPlugin />)
      await warmIndex(editor)

      seedParagraph(editor, 'fn')
      pressKey(editor, ' ')

      // Unicode returned false (no `\` trigger to commit), so the lower-priority
      // replacement handler still got the keystroke.
      expect(readText(editor)).toBe('function ')
    })
  })

  describe('the picker path', () => {
    it('inserts at the cursor with no trailing space and records a recent', () => {
      const editor = mount()
      seedParagraph(editor, 'hi ')

      act(() => {
        insertCharAtSelection(editor, UNICODE_PROFILE, ARROW)
      })
      flush(editor)

      expect(readText(editor)).toBe(`hi ${ARROW}`)
      expect(
        JSON.parse(window.localStorage.getItem(UNICODE_PROFILE.recentsStorageKey)!),
      ).toEqual([ARROW])
    })

    it('still works when composerUnicode is off — the flag governs only the `\\` trigger', async () => {
      stubFetch({ settings: { composerUnicode: false } })
      const editor = mount()
      await settleSettings()
      seedParagraph(editor, 'hi ')

      act(() => {
        insertCharAtSelection(editor, UNICODE_PROFILE, ARROW)
      })
      flush(editor)

      expect(readText(editor)).toBe(`hi ${ARROW}`)
    })
  })
})
