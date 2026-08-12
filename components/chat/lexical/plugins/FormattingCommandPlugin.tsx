'use client'

/**
 * Formatting Command Plugin
 *
 * Registers custom Lexical commands for each formatting action that the
 * FormattingToolbar dispatches. Handles bold, italic, headings, lists,
 * and roleplay delimiter insertion.
 *
 * Roleplay delimiters are inserted as literal text (not Lexical formatting)
 * because they must survive the markdown roundtrip as plain text markers.
 *
 * @module components/chat/lexical/plugins/FormattingCommandPlugin
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  FORMAT_TEXT_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  $getSelection,
  $getPreviousSelection,
  $setSelection,
  $isRangeSelection,
  $isElementNode,
  $createTextNode,
  $createParagraphNode,
  $findMatchingParent,
  createCommand,
  type LexicalCommand,
  type TextNode,
} from 'lexical'
import { $setBlocksType } from '@lexical/selection'
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $insertList, $isListItemNode } from '@lexical/list'
import { $createCodeNode, $isCodeNode } from '@lexical/code'
import type { TemplateDelimiter } from '@/lib/schemas/template.types'
import { delimiterToPrefixSuffix } from '@/lib/chat/annotations'
import { toggleWrap, toggleLinePrefix, insertTagPrefix } from '@/lib/chat/text-transforms'

/**
 * Command to set the current block to a heading.
 * Payload is the heading tag ('h1', 'h2', 'h3').
 */
export const INSERT_HEADING_COMMAND: LexicalCommand<HeadingTagType> =
  createCommand('INSERT_HEADING_COMMAND')

/**
 * Command to insert an unordered list.
 */
export const INSERT_UNORDERED_LIST_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_UL_COMMAND')

/**
 * Command to insert an ordered list.
 */
export const INSERT_ORDERED_LIST_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_OL_COMMAND')

/**
 * Command to convert the current block(s) to a blockquote.
 */
export const INSERT_BLOCKQUOTE_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_BLOCKQUOTE_COMMAND')

/**
 * Command to apply a roleplay delimiter to the current selection. Payload is the
 * full {@link TemplateDelimiter}; the handler dispatches by `kind`:
 *  - `wrap` → toggle `open`…`close` around the selection (insert + cursor when empty).
 *  - `linePrefix` → toggle a line-start marker on the current block.
 *  - `tagPrefix` → insert `open`+`close` at the block start, cursor between.
 *
 * Delimiters are inserted as literal text (not Lexical formatting) so they
 * survive the markdown roundtrip as plain markers — the same string transforms
 * back the source-textarea path, so the two stay consistent.
 */
export const APPLY_DELIMITER_COMMAND: LexicalCommand<TemplateDelimiter> =
  createCommand('APPLY_DELIMITER_COMMAND')

/**
 * Command to toggle a code block. If the cursor is in a code block,
 * exit it (convert to paragraph). If not, convert the current block
 * to a code block.
 */
export const TOGGLE_CODE_BLOCK_COMMAND: LexicalCommand<void> =
  createCommand('TOGGLE_CODE_BLOCK_COMMAND')

/**
 * Command to nest the selected list item(s) one level deeper — the sub-list
 * that Markdown writes as an indented bullet.
 */
export const INDENT_LIST_ITEM_COMMAND: LexicalCommand<void> =
  createCommand('INDENT_LIST_ITEM_COMMAND')

/** Command to lift the selected list item(s) out one nesting level. */
export const OUTDENT_LIST_ITEM_COMMAND: LexicalCommand<void> =
  createCommand('OUTDENT_LIST_ITEM_COMMAND')

/**
 * True when the selection sits anywhere inside a list item — mid-word, inside a
 * bold run, on an empty item, or spanning several items.
 *
 * The caret's own anchor/focus are checked alongside `getNodes()` because a
 * collapsed selection expressed as an *element* point (which is what clicking
 * into a line can produce, rather than a text point) makes `getNodes()` return
 * an empty array. Relying on it alone left the indent controls dead for a caret
 * that was plainly sitting in a list.
 *
 * Indenting is deliberately confined to lists: Markdown has no notion of an
 * indented paragraph, so indenting one would produce editor state that vanishes
 * silently on the next save.
 */
export function $selectionIsInListItem(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  const nodes = [selection.anchor.getNode(), selection.focus.getNode(), ...selection.getNodes()]
  return nodes.some((node) => $findMatchingParent(node, $isListItemNode) !== null)
}

/**
 * Put the caret back where it was if the editor has no live selection.
 *
 * Toolbar buttons suppress focus loss on mousedown, but a click that arrives
 * after the editor has been blurred some other way would otherwise act on a
 * null selection and appear to do nothing at all.
 */
function $restoreSelection(): void {
  if ($getSelection() !== null) return
  const previous = $getPreviousSelection()
  if (previous !== null) $setSelection(previous.clone())
}

export function FormattingCommandPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterHeading = editor.registerCommand(
      INSERT_HEADING_COMMAND,
      (tag: HeadingTagType) => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(tag))
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterUL = editor.registerCommand(
      INSERT_UNORDERED_LIST_COMMAND,
      () => {
        $insertList('bullet')
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterOL = editor.registerCommand(
      INSERT_ORDERED_LIST_COMMAND,
      () => {
        $insertList('number')
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterBlockquote = editor.registerCommand(
      INSERT_BLOCKQUOTE_COMMAND,
      () => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode())
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterDelimiter = editor.registerCommand(
      APPLY_DELIMITER_COMMAND,
      (delimiter: TemplateDelimiter) => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        if (delimiter.kind === 'wrap') {
          // Wrap toggles around the SELECTION (preserving the rest of the block's
          // nodes/formatting). The string + cursor are computed by the shared
          // transform over a mini flat model of just the selected text.
          const { prefix, suffix } = delimiterToPrefixSuffix(delimiter)
          const selectedText = selection.getTextContent()
          const { value: newText, cursor } = toggleWrap(
            { value: selectedText, start: 0, end: selectedText.length },
            prefix,
            suffix,
          )
          selection.insertRawText(newText)

          // Only the insert-into-empty-selection case needs the cursor pulled
          // back from the end (to sit between the delimiters). For wrap/unwrap,
          // `cursor` is at the end of the inserted run, so insertRawText's
          // default placement is already correct.
          const fromEnd = newText.length - cursor
          if (fromEnd > 0) {
            const updated = $getSelection()
            if ($isRangeSelection(updated)) {
              const nodes = updated.getNodes()
              const lastNode = nodes[nodes.length - 1]
              if (lastNode && lastNode.getType() === 'text') {
                const pos = (lastNode as TextNode).getTextContentSize() - fromEnd
                updated.setTextNodeRange(lastNode as TextNode, pos, lastNode as TextNode, pos)
              }
            }
          }
          return true
        }

        // linePrefix / tagPrefix style the WHOLE line, so they operate on the
        // current block's text. We replace the block's inline content with the
        // transformed plain text (preserving the block type), then place the
        // cursor. Skip code blocks.
        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block || !$isElementNode(block) || $isCodeNode(block)) return false

        const blockText = block.getTextContent()
        const result = delimiter.kind === 'linePrefix'
          ? toggleLinePrefix({ value: blockText, start: 0, end: blockText.length }, delimiter.marker)
          : insertTagPrefix({ value: blockText, start: 0, end: 0 }, delimiter.open, delimiter.close)

        block.getChildren().forEach((child) => child.remove())
        const textNode = $createTextNode(result.value)
        block.append(textNode)
        textNode.select(result.cursor, result.cursor)
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterCodeBlock = editor.registerCommand(
      TOGGLE_CODE_BLOCK_COMMAND,
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return false

        // With a non-collapsed selection, toggle inline code formatting
        if (!selection.isCollapsed()) {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
          return true
        }

        // Collapsed cursor: toggle code block
        const anchorNode = selection.anchor.getNode()
        const codeBlock = anchorNode.getParent()

        if (codeBlock && $isCodeNode(codeBlock)) {
          // Exit the code block: convert its text content to a paragraph
          const text = codeBlock.getTextContent()
          const paragraph = $createParagraphNode()
          if (text) {
            paragraph.append($createTextNode(text))
          }
          codeBlock.replace(paragraph)
          paragraph.selectEnd()
        } else {
          // Enter a code block: convert current block to CodeNode
          $setBlocksType(selection, () => $createCodeNode())
        }
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterIndent = editor.registerCommand(
      INDENT_LIST_ITEM_COMMAND,
      () => {
        $restoreSelection()
        if (!$selectionIsInListItem()) return true
        editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterOutdent = editor.registerCommand(
      OUTDENT_LIST_ITEM_COMMAND,
      () => {
        $restoreSelection()
        if (!$selectionIsInListItem()) return true
        editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    // Tab nests a list item, Shift+Tab lifts it — but only inside a list.
    // Everywhere else Tab is left to the browser so it still moves focus out
    // of the editor, which keyboard users depend on.
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        if (!$selectionIsInListItem()) return false
        event.preventDefault()
        editor.dispatchCommand(
          event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
          undefined,
        )
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    return () => {
      unregisterHeading()
      unregisterUL()
      unregisterOL()
      unregisterBlockquote()
      unregisterDelimiter()
      unregisterCodeBlock()
      unregisterIndent()
      unregisterOutdent()
      unregisterTab()
    }
  }, [editor])

  return null
}
