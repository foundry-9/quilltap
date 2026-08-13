'use client'

/**
 * EmojiTypeaheadPlugin
 *
 * Layer 2.0e of the composer series: type `:` plus at least two characters and
 * pick an emoji by name. Two commit paths, one engine:
 *
 * - the menu (Enter or click), and
 * - a closing `:` on an exact shortcode (`:smile:`), which commits without the
 *   menu ever mattering.
 *
 * What it inserts is the literal Unicode character — not a shortcode, not a
 * node, not an image. That single decision is why markdown round-trip, export,
 * search, embeddings, and the LLM wire are all untouched by this feature.
 *
 * Every DECISION (which emoji match, in what order, where the trigger starts and
 * ends) lives in `lib/emoji/`, which imports nothing and is copied wholesale
 * into quilltap-v5. This file is the adapter that asks the questions and applies
 * the answers. Keep it that way.
 *
 * Registered at COMMAND_PRIORITY_NORMAL, ABOVE TextReplacementPlugin's
 * COMMAND_PRIORITY_LOW — see "Interaction with Layer 1.5" below.
 *
 * @module components/chat/lexical/plugins/EmojiTypeaheadPlugin
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type TextNode,
} from 'lexical'

import { findEmojiTrigger, isTriggerOpenerContext } from '@/lib/emoji/trigger'
import { searchEmoji, findByShortcode } from '@/lib/emoji/search'
import { loadEmojiIndex, getLoadedEmojiIndex } from '@/lib/emoji/load'
import type { EmojiEntry, EmojiIndex } from '@/lib/emoji/types'
import {
  TypeaheadOption,
  useTypeaheadShell,
  toMenuTextMatch,
  $insertWithoutTrailingSpace,
} from '../typeahead/useTypeaheadShell'
import { $isInCodeContext } from '../utils/code-context'
import { recordEmojiRecent } from '../../emoji/recents-storage'
import { EMOJI_INSERT_TAG } from '../../emoji/insert-emoji'

/** Rows visible at once; the menu scrolls with the keyboard beyond this. */
const MENU_LIMIT = 10

const LISTBOX_ID = 'qt-emoji-typeahead'

interface ChatSettingsResponse {
  composerEmoji?: boolean
}

function toOption(entry: EmojiEntry): TypeaheadOption<EmojiEntry> {
  return new TypeaheadOption<EmojiEntry>(
    {
      key: entry.char,
      glyph: entry.char,
      label: entry.name,
      detail: entry.shortcodes[0] ? `:${entry.shortcodes[0]}:` : undefined,
    },
    entry,
  )
}

/**
 * The text of the anchor node up to the cursor — the same slice Lexical's own
 * trigger machinery works from, so our offsets and its node-splitting agree.
 *
 * Returns null in every position a typing aid must stay out of. Must run inside
 * a read/update context.
 */
function $textBeforeCursor(): { node: TextNode; text: string } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  if ($isInCodeContext(selection)) return null

  const anchor = selection.anchor
  if (anchor.type !== 'text') return null

  const node = anchor.getNode()
  if (!$isTextNode(node) || !node.isSimpleText()) return null

  return { node, text: node.getTextContent().slice(0, anchor.offset) }
}

/**
 * A trigger at offset 0 of the anchor node is only really at a word opening if
 * nothing is glued to it in the preceding inline run — `**bold**:smi` must not
 * open a menu. The rule itself comes from Tier B rather than being re-derived.
 */
function $isGluedToPreviousRun(node: TextNode, start: number): boolean {
  if (start !== 0) return false

  const previous = node.getPreviousSibling()
  if (!previous) return false

  const previousText = previous.getTextContent()
  const lastChar = previousText[previousText.length - 1]
  if (!lastChar) return false

  return !isTriggerOpenerContext(lastChar)
}

export function EmojiTypeaheadPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const { data: chatSettings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettingsResponse>('/api/v1/settings/chat', { signal }),
  })

  const [index, setIndex] = useState<EmojiIndex | null>(() => getLoadedEmojiIndex())
  const [query, setQuery] = useState<string | null>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)

  const enabled = chatSettings?.composerEmoji ?? true

  // Refs so the registered command handler never needs re-registering when
  // settings or the dataset arrive — same shape as TextReplacementPlugin.
  const enabledRef = useRef(enabled)
  const indexRef = useRef(index)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    indexRef.current = index
  }, [index])

  // The contenteditable can be swapped out (mode toggles), so subscribe rather
  // than reading it once. `registerRootListener` invokes the listener
  // IMMEDIATELY with the current root, so no separate seeding call is needed —
  // and adding one would be a synchronous setState in an effect body.
  useEffect(() => editor.registerRootListener((next) => setRootElement(next)), [editor])

  /**
   * Kick off the lazy fetch. Called only once a `:` is actually in play, so an
   * instance whose writer never types one never pays the quarter-megabyte.
   */
  const ensureIndex = useCallback(() => {
    if (indexRef.current) return
    void loadEmojiIndex().then((loaded) => {
      if (loaded) setIndex(loaded)
    })
  }, [])

  const options = useMemo(() => {
    if (!index || query === null) return []
    return searchEmoji(index, query, MENU_LIMIT).map(toOption)
  }, [index, query])

  const menuRenderFn = useTypeaheadShell<EmojiEntry>({
    listboxId: LISTBOX_ID,
    emptyLabel: 'No emoji found',
    activeDescendantTarget: rootElement,
  })

  /**
   * Bail conditions, in order — these MIRROR Layer 1.5's and must not drift from
   * them. 3-5 are enforced inside `$textBeforeCursor`.
   *
   *   1. feature disabled       4. inside a fenced code block
   *   2. IME composition        5. inside an inline `code` run
   *   3. no collapsed selection 6. dataset not loaded yet
   */
  const triggerFn = useCallback(
    (text: string, activeEditor: LexicalEditor): MenuTextMatch | null => {
      if (!enabledRef.current) return null
      if (activeEditor.isComposing()) return null

      const match = findEmojiTrigger(text)
      if (!match) return null

      // A closed trigger (`:smile:`) is the keydown handler's business; if it
      // reached here the shortcode did not resolve, and re-opening a menu on the
      // text the user just closed would be a jack-in-the-box.
      if (match.closed) return null

      const current = $textBeforeCursor()
      if (!current) return null
      if ($isGluedToPreviousRun(current.node, match.start)) return null

      if (!indexRef.current) {
        ensureIndex()
        return null
      }

      return toMenuTextMatch(text, match)
    },
    [ensureIndex],
  )

  const commit = useCallback(
    (nodeToReplace: TextNode | null, entry: EmojiEntry) => {
      editor.update(
        () => {
          // No trailing space: an emoji is punctuation-adjacent, and writers
          // frequently want `word😄` or `😄😄`. Deliberate divergence from the
          // chip path — see $insertWithoutTrailingSpace.
          $insertWithoutTrailingSpace(nodeToReplace, entry.char)
        },
        { tag: EMOJI_INSERT_TAG },
      )
      recordEmojiRecent(entry.char)
    },
    [editor],
  )

  const onSelectOption = useCallback(
    (
      option: TypeaheadOption<EmojiEntry>,
      nodeToReplace: TextNode | null,
      closeMenu: () => void,
    ) => {
      commit(nodeToReplace, option.payload)
      closeMenu()
    },
    [commit],
  )

  /**
   * Interaction with Layer 1.5.
   *
   * `:` is ALSO a text-replacement word-boundary trigger, so this handler sits
   * at COMMAND_PRIORITY_NORMAL, above TextReplacementPlugin's LOW. It swallows
   * the keystroke (`return true`) ONLY when it commits an emoji. Otherwise it
   * returns false, so a `:` typed after a replaceable word still fires the
   * replacement AND still opens the menu on the resulting text — which is what a
   * writer expects.
   */
  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event === null) return false
        if (event.key !== ':') return false
        if (!enabledRef.current) return false
        if (editor.isComposing()) return false

        const emojiIndex = indexRef.current
        if (!emojiIndex) {
          ensureIndex()
          return false
        }

        const target = editor.getEditorState().read(() => {
          const current = $textBeforeCursor()
          if (!current) return null

          // The closing ':' has not been typed yet — preventDefault below stops
          // it ever landing — so ask Tier B about the text as it WOULD read.
          const match = findEmojiTrigger(`${current.text}:`)
          if (!match || !match.closed) return null
          if ($isGluedToPreviousRun(current.node, match.start)) return null

          const entry = findByShortcode(emojiIndex, match.query)
          if (!entry) return null

          return { nodeKey: current.node.getKey(), match, entry }
        })

        if (!target) return false

        event.preventDefault()
        editor.update(
          () => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            const node = selection.anchor.getNode()
            if (!$isTextNode(node) || node.getKey() !== target.nodeKey) return

            const text = node.getTextContent()
            const { start, end } = target.match

            // Bail if the world shifted under us between read and update.
            if (end > text.length || text[start] !== ':') return

            const next = text.slice(0, start) + target.entry.char + text.slice(end)
            node.setTextContent(next)
            const cursor = start + target.entry.char.length
            node.select(cursor, cursor)
          },
          { tag: EMOJI_INSERT_TAG },
        )
        recordEmojiRecent(target.entry.char)

        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )
  }, [editor, ensureIndex])

  if (!enabled) return null

  return (
    <LexicalTypeaheadMenuPlugin<TypeaheadOption<EmojiEntry>>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
      /*
       * CRITICAL, not NORMAL — and this is load-bearing. `KeyboardPlugin`
       * registers KEY_ENTER_COMMAND at COMMAND_PRIORITY_HIGH to submit the
       * message, so a lower-priority menu never sees Enter and picking an emoji
       * with the keyboard silently sends the draft instead.
       *
       * Safe because these handlers exist ONLY while the menu is open:
       * `LexicalTypeaheadMenuPlugin` mounts `LexicalMenu` (which registers
       * Enter / arrows / Escape / Tab) only once a trigger has resolved. With
       * the menu shut, Enter reaches KeyboardPlugin exactly as before.
       *
       * The separate closing-colon KEY_DOWN handler above stays at NORMAL,
       * where it needs to be to sit above TextReplacementPlugin's LOW.
       */
      commandPriority={COMMAND_PRIORITY_CRITICAL}
    />
  )
}

export default EmojiTypeaheadPlugin
