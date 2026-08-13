'use client'

/**
 * The one place an emoji enters a document.
 *
 * Both surfaces — the `:` typeahead and the toolbar picker — commit through
 * here, so they cannot drift apart in what they insert, how it undoes, or
 * whether the pick is remembered.
 *
 * @module components/chat/emoji/insert-emoji
 */

import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'

import { recordEmojiRecent } from './recents-storage'

/**
 * History tag. Everything a commit does goes inside ONE `editor.update` carrying
 * this tag, so a single Cmd/Ctrl+Z removes the emoji and restores the literal
 * `:smi` the user typed — matching the Layer 1.5 undo contract.
 */
export const EMOJI_INSERT_TAG = 'emoji-insert'

/**
 * Insert an emoji at the current cursor, for the picker (which has no trigger
 * text to overwrite). The typeahead uses the trigger-replacing path instead, but
 * shares this module's tag and recents bookkeeping.
 *
 * No trailing space — see `$insertWithoutTrailingSpace`.
 */
export function insertEmojiAtSelection(editor: LexicalEditor, char: string): void {
  editor.update(
    () => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      selection.insertText(char)
    },
    { tag: EMOJI_INSERT_TAG },
  )
  recordEmojiRecent(char)
}
