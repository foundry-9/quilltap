/**
 * Shared code-context guard for composer typing aids.
 *
 * Every plugin that rewrites text as the user types must stay out of code. This
 * is the ONE predicate they share — see
 * [bug 63](../../../../docs/developer/bugs/fixed/bug-63-text-replacement-in-code.md),
 * which is what happens when two plugins keep their own bail lists.
 *
 * @module components/chat/lexical/utils/code-context
 */

import { $isCodeNode } from '@lexical/code'
import {
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type BaseSelection,
} from 'lexical'

/**
 * True when the cursor sits somewhere a typing aid must NOT fire.
 *
 * Covers the two ways code is represented, which are easy to conflate and must
 * both be checked:
 *
 * 1. **Fenced blocks** — the enclosing top-level element is a `CodeNode`. Note
 *    that the anchor node itself is no help here: `CodeHighlightNode` *extends*
 *    `TextNode`, so `$isTextNode` is true inside a fenced block. That is exactly
 *    the trap bug 63 fell into.
 * 2. **Inline code** — an ordinary `TextNode` carrying the `code` format bit.
 *
 * Conservative by design: an absent top-level element, or one that is not an
 * `ElementNode`, also returns true. We cannot prove such a position is safe, and
 * a typing aid that stays quiet beats one that corrupts.
 *
 * The `$isElementNode` narrowing is load-bearing, not decoration —
 * `getTopLevelElement()` is not guaranteed to hand back something `$isCodeNode`
 * can inspect. Do not drop it.
 *
 * Must be called inside an `editor.read()` / `editor.update()` context, which is
 * what the `$` prefix signals.
 */
export function $isInCodeContext(selection: BaseSelection | null): boolean {
  if (!$isRangeSelection(selection)) return false

  const anchorNode = selection.anchor.getNode()

  if ($isTextNode(anchorNode) && anchorNode.hasFormat('code')) return true

  const block = anchorNode.getTopLevelElement()
  return !block || !$isElementNode(block) || $isCodeNode(block)
}
