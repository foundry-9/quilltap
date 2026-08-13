'use client'

/**
 * The one place an inserted character enters a document.
 *
 * All four surfaces — the `:` and `\` typeaheads and the two toolbar pickers —
 * commit through here or through the typeahead's trigger-replacing path, so they
 * cannot drift apart in what they insert, how it undoes, or whether the pick is
 * remembered.
 *
 * @module components/chat/char-insert/insert-char
 */

import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'

import type { CharProfile } from '@/lib/char-insert/types'
import { recordRecent } from './recents-storage'

/**
 * History tag. Everything a commit does goes inside ONE `editor.update` carrying
 * this tag, so a single Cmd/Ctrl+Z removes the character and restores the
 * literal `:smi` / `\to` the user typed — matching the Layer 1.5 undo contract.
 *
 * One tag for both profiles: it identifies the KIND of edit for the history
 * plugin, and emoji and Unicode insertions behave identically under undo.
 */
export const CHAR_INSERT_TAG = 'char-insert'

/**
 * Insert a character at the current cursor, for a picker (which has no trigger
 * text to overwrite). The typeaheads use the trigger-replacing path instead, but
 * share this module's tag and recents bookkeeping.
 *
 * No trailing space — see `$insertWithoutTrailingSpace`.
 */
export function insertCharAtSelection(
  editor: LexicalEditor,
  profile: CharProfile,
  char: string,
): void {
  editor.update(
    () => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      selection.insertText(char)
    },
    { tag: CHAR_INSERT_TAG },
  )
  recordRecent(profile, char)
}
