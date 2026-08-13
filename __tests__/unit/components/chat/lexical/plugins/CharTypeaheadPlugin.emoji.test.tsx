/**
 * Layer 2.0e composer emoji — plugin-level coverage of the EMOJI profile.
 *
 * Layer 2.0u generalized the plugin into `CharTypeaheadPlugin`; this suite is
 * unchanged in substance, which is the point. The Unicode profile has its own
 * suite beside this one.
 *
 * Runs against a REAL Lexical editor and the REAL committed dataset (served
 * through the fetch mock, exactly as the browser would fetch it), so these
 * assertions exercise the whole adapter: lazy load, trigger detection, the
 * closing-colon commit, the bail conditions, and the undo contract.
 *
 * The `:name` MATCH RULES themselves are pinned in `lib/char-insert/__tests__` against
 * a shared corpus that quilltap-v5 copies; this suite is about the wiring.
 */

import { CharTypeaheadPlugin } from '@/components/chat/lexical/plugins/CharTypeaheadPlugin'
import { EMOJI_PROFILE } from '@/lib/char-insert/profiles/emoji'
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

import datasetPayload from '../../../../../../public/emoji/emoji-index.v1.json'

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

/** 😄 — the dataset's `:smile:`. Spelled by lookup so no invisible codepoint is transcribed. */
const SMILE = (datasetPayload.emoji as { c: string; s: string[] }[]).find((entry) =>
  entry.s.includes('smile'),
)!.c

let emojiFetchCount = 0
const realFetch = global.fetch

/**
 * ⚠ `jest.setup.ts` assigns `global.fetch` directly, which REPLACES
 * jest-fetch-mock's function — so `fetchMock.mockResponse(...)` is a silent
 * no-op in this repo and its stub answers every URL with a body-less `{}` that
 * has no `ok`/`status`. Route by assigning `global.fetch` ourselves instead.
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
  emojiFetchCount = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url

    if (url.includes('emoji-index.v1.json')) {
      emojiFetchCount += 1
      if (datasetFails) return jsonResponse({ error: 'nope' }, 500)
      return jsonResponse(datasetPayload)
    }
    return jsonResponse({ composerEmoji: true, textReplacementsEnabled: true, ...settings })
  }) as unknown as typeof fetch
}

describe('CharTypeaheadPlugin — emoji profile', () => {
  let harness: PluginHarness

  beforeEach(() => {
    EMOJI_PROFILE.loader.resetForTests()
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
        <CharTypeaheadPlugin profile={EMOJI_PROFILE} />
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
   * Warm the lazy dataset the way the app does — the plugin only fetches once a
   * `:` is actually in play, so type one and let the promise settle.
   */
  async function warmIndex(editor: ReturnType<typeof mount>) {
    seedParagraph(editor, 'warm :ab')
    pressKey(editor, ':')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  describe('the closing-colon commit', () => {
    it('commits an exact shortcode without the menu ever mattering', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'hello :smile')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(true)
      expect(readText(editor)).toBe(`hello ${SMILE}`)
    })

    it('inserts NO trailing space and leaves the caret after the emoji', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, ':smile')
      pressKey(editor, ':')

      expect(readText(editor)).toBe(SMILE)
      expect(readCaretOffset(editor)).toBe(SMILE.length)
    })

    it('lets an unknown shortcode through as literal text', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'hello :notanemoji')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('hello :notanemoji')
    })

    it('records the pick in recents', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, ':smile')
      pressKey(editor, ':')

      expect(JSON.parse(window.localStorage.getItem(EMOJI_PROFILE.recentsStorageKey)!)).toEqual([SMILE])
    })

    it('reverts to the literal typed text in ONE undo', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, 'hello :smile')
      pressKey(editor, ':')
      expect(readText(editor)).toBe(`hello ${SMILE}`)

      editor.dispatchCommand(UNDO_COMMAND, undefined)
      flush(editor)

      expect(readText(editor)).toBe('hello :smile')
    })
  })

  describe('triggers that must never fire', () => {
    it.each([
      ['a URL scheme', 'see http:/'],
      ['a clock time', 'meet at 10:3'],
      ['a Windows path', 'open C:\\User'],
      ['an emoticon', 'hah :'],
      ['a colon glued to a word', 'ratio a:b'],
    ])('does not commit on %s', async (_label, text) => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, text)
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(text)
    })

    it('does not commit when the colon is glued to a preceding bold run', async () => {
      const editor = mount()
      await warmIndex(editor)

      // The anchor text node starts at `:`, so a naive offset-0 check would read
      // it as the start of the block. It is not — `bold` precedes it.
      seedAfterBoldRun(editor, 'bold', ':smile')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('bold:smile')
    })
  })

  describe('bail conditions', () => {
    it('does nothing inside a fenced code block', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedCodeBlock(editor, 'const x = :smile')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe('const x = :smile')
    })

    it('does nothing inside an inline code run', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedInlineCode(editor, ':smile')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(':smile')
    })

    it('does nothing while an IME composition is active', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, ':smile')
      editor.update(
        () => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            $setCompositionKey(selection.anchor.getNode().getKey())
          }
        },
        { discrete: true },
      )

      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(':smile')
    })

    it('is inert when composerEmoji is off — and never even fetches the dataset', async () => {
      stubFetch({ settings: { composerEmoji: false } })
      const editor = mount()
      await settleSettings()

      seedParagraph(editor, ':smile')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(':smile')
      expect(emojiFetchCount).toBe(0)
    })

    it('is inert, without throwing, when the dataset cannot be loaded', async () => {
      stubFetch({ datasetFails: true })
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, ':smile')
      const { defaultPrevented } = pressKey(editor, ':')

      expect(defaultPrevented).toBe(false)
      expect(readText(editor)).toBe(':smile')
    })
  })

  describe('the lazy dataset', () => {
    it('is not fetched until a `:` is in play', async () => {
      const editor = mount()
      seedParagraph(editor, 'no colons here')
      pressKey(editor, ' ')

      expect(emojiFetchCount).toBe(0)

      await warmIndex(editor)
      expect(emojiFetchCount).toBe(1)
    })

    it('is fetched exactly once no matter how many colons are typed', async () => {
      const editor = mount()
      await warmIndex(editor)

      seedParagraph(editor, ':smile')
      pressKey(editor, ':')
      seedParagraph(editor, ':tada')
      pressKey(editor, ':')

      expect(emojiFetchCount).toBe(1)
    })
  })

  describe('interaction with Layer 1.5 text replacement', () => {
    it('lets a `:` typed after a replaceable word still fire the replacement', async () => {
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
      pressKey(editor, ':')

      // Emoji returned false (no exact shortcode to commit), so the lower
      // priority replacement handler still got the keystroke.
      expect(readText(editor)).toBe('function:')
    })

    it('swallows the `:` when it commits, so no replacement also runs', async () => {
      useTextReplacementRules.mockReturnValue({
        compiled: compileRules([
          {
            id: 'r1',
            fromText: 'smile',
            toText: 'GRIN',
            enabled: true,
            caseSensitive: false,
            createdAt: '',
            updatedAt: '',
          },
        ] as never),
      })

      const editor = mount(<TextReplacementPlugin />)
      await warmIndex(editor)

      seedParagraph(editor, ':smile')
      pressKey(editor, ':')

      expect(readText(editor)).toBe(SMILE)
    })
  })

  describe('the picker path', () => {
    it('inserts at the cursor with no trailing space and records a recent', () => {
      const editor = mount()
      seedParagraph(editor, 'hi ')

      act(() => {
        insertCharAtSelection(editor, EMOJI_PROFILE, SMILE)
      })
      flush(editor)

      expect(readText(editor)).toBe(`hi ${SMILE}`)
      expect(JSON.parse(window.localStorage.getItem(EMOJI_PROFILE.recentsStorageKey)!)).toEqual([SMILE])
    })

    it('still works when composerEmoji is off — the flag governs only the `:` trigger', async () => {
      stubFetch({ settings: { composerEmoji: false } })
      const editor = mount()
      await settleSettings()
      seedParagraph(editor, 'hi ')

      act(() => {
        insertCharAtSelection(editor, EMOJI_PROFILE, SMILE)
      })
      flush(editor)

      expect(readText(editor)).toBe(`hi ${SMILE}`)
    })
  })
})
