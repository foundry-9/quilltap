'use client'

/**
 * Shared typeahead shell — the hook and the insertion helpers.
 *
 * Two deltas from what `composer-typeahead.md` Phase 1 originally described,
 * both introduced by the emoji layer that built this shell:
 *
 * 1. `insertWithTrailingSpace()` gained a sibling, `insertWithoutTrailingSpace()`.
 *    Chips want the space; emoji does not.
 * 2. The shell does NOT own trigger detection. A consumer hands it a
 *    precomputed match, so the "where does the trigger start and end" decision
 *    stays in framework-free logic that quilltap-v5 can copy (for emoji, that is
 *    `lib/emoji/trigger.ts`). `LexicalTypeaheadMenuPlugin`'s `triggerFn` becomes
 *    a thin adapter that converts such a match into a `MenuTextMatch`.
 *
 * @module components/chat/lexical/typeahead/useTypeaheadShell
 */

import { useCallback } from 'react'
import { MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { MenuRenderFn, MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { TextNode } from 'lexical'

import { MenuPortal } from './MenuPortal'
import type { TypeaheadInsertOptions, TypeaheadRow } from './types'

/** A menu option carrying both its presentation and the value it commits. */
export class TypeaheadOption<TPayload> extends MenuOption {
  readonly row: TypeaheadRow
  readonly payload: TPayload

  constructor(row: TypeaheadRow, payload: TPayload) {
    super(row.key)
    this.row = row
    this.payload = payload
  }
}

/**
 * A trigger match expressed in offsets within the anchor text node — the shape
 * `lib/emoji/trigger.ts` (and any future Tier B detector) produces.
 */
export interface ShellTriggerMatch {
  /** Offset of the trigger character. */
  start: number
  /** Offset one past the last query character. */
  end: number
  /** The query, trigger character excluded. */
  query: string
}

/**
 * Convert a precomputed trigger match into the `MenuTextMatch` that
 * `LexicalTypeaheadMenuPlugin` expects.
 *
 * `replaceableString` must be the RAW source text of the trigger (not the
 * normalized query): Lexical measures its length to decide where to split the
 * anchor node, and the node it hands back to `onSelectOption` then contains
 * exactly the text to overwrite.
 */
export function toMenuTextMatch(textBefore: string, match: ShellTriggerMatch): MenuTextMatch {
  return {
    leadOffset: match.start,
    matchingString: match.query,
    replaceableString: textBefore.slice(match.start, match.end),
  }
}

/**
 * Overwrite the split trigger node with the committed text.
 *
 * MUST run inside an `editor.update(fn, { tag })` so the whole commit is ONE
 * history entry — a single Cmd/Ctrl+Z restores the literal text the user typed.
 * That matches the Layer 1.5 undo contract.
 */
export function $insertTypeaheadText(
  nodeToReplace: TextNode | null,
  text: string,
  options: TypeaheadInsertOptions,
): void {
  if (!nodeToReplace) return

  const inserted = options.trailingSpace ? `${text} ` : text
  nodeToReplace.setTextContent(inserted)
  nodeToReplace.select(inserted.length, inserted.length)
}

/** Layer 2's chips: a chip is a word, so it gets a trailing space. */
export function $insertWithTrailingSpace(nodeToReplace: TextNode | null, text: string): void {
  $insertTypeaheadText(nodeToReplace, text, { trailingSpace: true })
}

/**
 * Emoji: NO trailing space. An emoji is punctuation-adjacent and writers
 * frequently want `word😄` or `😄😄`. Diverging from `$insertWithTrailingSpace`
 * here is deliberate — please do not "fix" it into consistency.
 */
export function $insertWithoutTrailingSpace(nodeToReplace: TextNode | null, text: string): void {
  $insertTypeaheadText(nodeToReplace, text, { trailingSpace: false })
}

interface TypeaheadShellOptions {
  /** Stable DOM id for the listbox; the plugin points `aria-activedescendant` at it. */
  listboxId: string
  /** Shown when the query matches nothing. */
  emptyLabel: string
  /**
   * The contenteditable that keeps focus while the menu is open — normally
   * `editor.getRootElement()`. Supplying it is what makes the menu announce
   * itself; omitting it renders a menu no screen reader can follow.
   */
  activeDescendantTarget?: HTMLElement | null
}

/**
 * Build the `menuRenderFn` for `LexicalTypeaheadMenuPlugin`. Consumers supply
 * options whose `row` describes how each line looks; everything about the
 * surface, the empty state, and the ARIA wiring lives here.
 */
export function useTypeaheadShell<TPayload>({
  listboxId,
  emptyLabel,
  activeDescendantTarget,
}: TypeaheadShellOptions): MenuRenderFn<TypeaheadOption<TPayload>> {
  return useCallback<MenuRenderFn<TypeaheadOption<TPayload>>>(
    (anchorElementRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options }) => (
      <MenuPortal
        anchorElementRef={anchorElementRef}
        rows={options.map((option) => option.row)}
        selectedIndex={selectedIndex}
        onSelect={(index) => {
          const option = options[index]
          if (option) selectOptionAndCleanUp(option)
        }}
        onHighlight={setHighlightedIndex}
        emptyLabel={emptyLabel}
        listboxId={listboxId}
        activeDescendantTarget={activeDescendantTarget}
      />
    ),
    [listboxId, emptyLabel, activeDescendantTarget],
  )
}
