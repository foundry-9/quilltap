'use client'

/**
 * SmartTypographyPlugin
 *
 * Layer 1.6, Part B (Tier C — the adapter): turns `--` into an en dash, `---`
 * into an em dash and `...` into an ellipsis as the writer types, in the Salon
 * composer and the Document Mode rich editor.
 *
 * Unlike Part A's quote curling — which happens at render time and never
 * touches a stored byte — these substitutions write real characters into the
 * message. That is deliberate: a writer typing `--` unambiguously means a dash,
 * the hyphen being a keyboard workaround for a character with no key, so the
 * dash is genuinely part of what was written and belongs in the content. It is
 * also why dashes are permanently OFF at render time: `run it with --verbose`
 * must survive being written in prose, and here it does, because the writer
 * sees the dash appear and hits Backspace once.
 *
 * **Every decision lives in `lib/smart-typography/engine.ts`, not here.** This
 * file is keystroke plumbing that knows about Lexical; quilltap-v5 rewrites it
 * against ProseMirror and copies the engine verbatim. If an `if` about dashes
 * appears below, it is in the wrong file.
 *
 * Behavior:
 * - Registered at COMMAND_PRIORITY_NORMAL, above TextReplacementPlugin's LOW,
 *   so `.` resolves as typography before it resolves as a word boundary — see
 *   "Interaction with Layer 1.5" below.
 * - Code is never rewritten: fenced blocks and inline `code` runs both bail via
 *   the shared `$isInCodeContext()` guard (bug 63).
 * - IME composition skips the plugin.
 * - Paste does NOT trigger (paste arrives via clipboard events, not keystrokes).
 * - One `editor.update` tagged "smart-typography" per substitution, so a single
 *   Cmd/Ctrl+Z restores the literal `--` or `...`.
 * - Backspace immediately after a substitution restores the literal characters
 *   too. Both are required: Cmd-Z is what the documentation says, Backspace is
 *   what a writer's hands actually do, and v5 gets the latter for free from
 *   ProseMirror's `undoInputRule`. The two apps must agree on a key this common.
 *
 * ## Interaction with Layer 1.5
 *
 * `.` is a word-boundary trigger for text replacement as well. Lexical's
 * `triggerCommandListeners` loops `for (let i = 4; i >= 0; i--)`, so NORMAL (2)
 * runs before LOW (1). With a rule `Aris → Aristarchus the Wise` and the writer
 * typing `Aris...`:
 *
 * | Keystroke | Smart typography       | Text replacement          | Buffer                  |
 * | --------- | ---------------------- | ------------------------- | ----------------------- |
 * | `.` 1st   | `before` = `is`, no    | replaces `Aris`, adds `.` | `Aristarchus the Wise.`  |
 * | `.` 2nd   | `before` = `e.`, no    | no match (empty word)     | `Aristarchus the Wise..` |
 * | `.` 3rd   | `before` = `..` → `…`  | never sees it             | `Aristarchus the Wise…`  |
 *
 * Correct in both features, which is the point of fixing the order rather than
 * leaving it to registration accident.
 *
 * @module components/chat/lexical/plugins/SmartTypographyPlugin
 */

import { useEffect, useRef } from 'react'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $getNodeByKey,
  BLUR_COMMAND,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  type TextNode,
} from 'lexical'

import {
  smartTypographyStep,
  type SmartTypographyOptions,
} from '@/lib/smart-typography/engine'
import { $isInCodeContext } from '../utils/code-context'

/** Lexical update tag; also the marker that keeps the revert memo alive. */
const UPDATE_TAG = 'smart-typography'

/** The only two characters that can start a substitution. Cheapest bail. */
const TRIGGER_CHARS = new Set(['-', '.'])

/**
 * The last substitution, kept only until the very next thing that happens.
 * Backspace at exactly `endOffset` in `nodeKey` puts `literal` back.
 */
interface RevertMemo {
  nodeKey: string
  /** Caret offset immediately after `inserted`. */
  endOffset: number
  /** What the writer actually typed, e.g. `--`, `–-`, `...`. */
  literal: string
  /** What replaced it, e.g. `–`, `—`, `…`. */
  inserted: string
}

export function SmartTypographyPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const { data: chatSettings } = useChatSettingsQuery()

  // Keep the latest settings in a ref so the registered command handler doesn't
  // need re-registering every time they change.
  const optionsRef = useRef<SmartTypographyOptions>({ dashes: true, ellipsis: true })
  const memoRef = useRef<RevertMemo | null>(null)

  useEffect(() => {
    optionsRef.current = {
      dashes: chatSettings?.smartTypographySettings?.dashes ?? true,
      ellipsis: chatSettings?.smartTypographySettings?.ellipsis ?? true,
    }
  }, [chatSettings?.smartTypographySettings?.dashes, chatSettings?.smartTypographySettings?.ellipsis])

  useEffect(() => {
    /**
     * Backspace straight after a substitution puts the literal characters back.
     * Anything else — a different key, a moved caret, a blur — has already
     * cleared the memo.
     *
     * ⚠ The decision is made in a `read()` and the commit follows. It cannot be
     * made *inside* `editor.update()`: this runs inside a command listener,
     * which is already inside an update, so a nested `editor.update()` is QUEUED
     * rather than run inline. A flag assigned in that callback is still false
     * when the handler returns, and the handler would report "I did nothing" to
     * Lexical after having already called `preventDefault()` — handing the
     * keystroke to the next listener down. `TextReplacementPlugin` has the same
     * shape for the same reason.
     */
    const handleBackspace = (): boolean => {
      const memo = memoRef.current
      if (!memo) return false
      memoRef.current = null

      const start = memo.endOffset - memo.inserted.length
      if (start < 0) return false

      const canRevert = editor.getEditorState().read<boolean>(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

        const anchor = selection.anchor
        if (anchor.key !== memo.nodeKey || anchor.offset !== memo.endOffset) return false

        const node = $getNodeByKey(memo.nodeKey)
        if (!node || !$isTextNode(node)) return false

        // The characters we put there must still be exactly where we put them.
        return node.getTextContent().slice(start, memo.endOffset) === memo.inserted
      })

      if (!canRevert) return false

      editor.update(
        () => {
          const node = $getNodeByKey(memo.nodeKey)
          if (!node || !$isTextNode(node)) return

          const textNode = node as TextNode
          const text = textNode.getTextContent()
          // Re-check: the queued callback runs after the read above.
          if (text.slice(start, memo.endOffset) !== memo.inserted) return

          textNode.setTextContent(
            text.slice(0, start) + memo.literal + text.slice(memo.endOffset),
          )
          const cursor = start + memo.literal.length
          textNode.select(cursor, cursor)
        },
        { tag: UPDATE_TAG },
      )

      return true
    }

    const handleKeyDown = (event: KeyboardEvent | null): boolean => {
      if (event === null) return false

      if (event.key === 'Backspace') {
        // Modifier-Backspace deletes a word/line; never a revert.
        if (event.metaKey || event.ctrlKey || event.altKey) {
          memoRef.current = null
          return false
        }
        if (!handleBackspace()) return false
        event.preventDefault()
        return true
      }

      // Any key that is not the immediate Backspace ends the revert window.
      // Invalidating on the KEYSTROKE rather than on an update listener is
      // deliberate: Lexical fires update listeners for selection reconciliation
      // and for no-op commits too, so a listener-based memo is cleared before
      // the writer's finger reaches Backspace. The revert itself re-verifies the
      // node, the offset and the actual characters before touching anything, so
      // this is the invalidation policy, not the safety check.
      memoRef.current = null

      // 1. Cheapest first: not a trigger character at all.
      if (!TRIGGER_CHARS.has(event.key)) return false
      // A modified `-`/`.` is a shortcut, not typing.
      if (event.metaKey || event.ctrlKey || event.altKey) return false

      // 2. Both rules off.
      const options = optionsRef.current
      if (!options.dashes && !options.ellipsis) return false

      // 3. IME composition.
      if (editor.isComposing()) return false

      const typed = event.key

      // 4/5/6. Selection shape, and never inside code — read `before` in the
      // same pass so the editor state is only walked once per keystroke.
      const before = editor.getEditorState().read<string | null>(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

        // Never rewrite code as it is typed — bug 63. Shared with
        // TextReplacementPlugin and CharTypeaheadPlugin so the bail lists
        // cannot drift.
        if ($isInCodeContext(selection)) return null

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()
        if (!$isTextNode(anchorNode)) return null

        // Up to two characters preceding the caret, read WITHIN the anchor text
        // node. There is no block-level `textBetween` helper in this codebase
        // and none is needed: two consecutive hyphens (or dots) cannot land in
        // different text nodes from typing, so unlike Layer 1.5 this needs no
        // end-of-node bail either.
        return anchorNode
          .getTextContent()
          .slice(Math.max(0, anchor.offset - 2), anchor.offset)
      })

      if (before === null) return false

      const result = smartTypographyStep({ before, typed, options })
      if (result === null) return false

      // The characters the engine wants removed, and therefore what the writer
      // will get back if they hit Backspace next.
      const deleted = before.slice(before.length - result.deleteBefore)
      if (deleted.length !== result.deleteBefore) return false
      const literal = deleted + typed

      // Everything above ran against a consistent read of the editor state, so
      // the decision is already made. Claim the keystroke and commit — see the
      // note on `handleBackspace` for why a flag set inside the update callback
      // would come back false.
      event.preventDefault()
      editor.update(
        () => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

          const anchor = selection.anchor
          const anchorNode = anchor.getNode()
          if (!$isTextNode(anchorNode)) return

          const textNode = anchorNode as TextNode
          const text = textNode.getTextContent()
          const offset = anchor.offset
          const start = offset - result.deleteBefore

          // Bail if the world has shifted under us (concurrent edit).
          if (start < 0 || text.slice(start, offset) !== deleted) return

          textNode.setTextContent(text.slice(0, start) + result.insert + text.slice(offset))
          const cursor = start + result.insert.length
          textNode.select(cursor, cursor)

          memoRef.current = {
            nodeKey: textNode.getKey(),
            endOffset: cursor,
            literal,
            inserted: result.insert,
          }
        },
        { tag: UPDATE_TAG },
      )

      // One line per SUBSTITUTION — never per keystroke; this handler runs on
      // every key the composer sees.
      console.debug(`[smart-typography] ${result.rule}: ${literal} → ${result.insert}`)

      return true
    }

    const unregisterKeyDown = editor.registerCommand(
      KEY_DOWN_COMMAND,
      handleKeyDown,
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        memoRef.current = null
        return false
      },
      COMMAND_PRIORITY_NORMAL,
    )

    return () => {
      unregisterKeyDown()
      unregisterBlur()
    }
  }, [editor])

  return null
}

export default SmartTypographyPlugin
