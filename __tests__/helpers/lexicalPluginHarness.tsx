/**
 * Harness for the composer's Lexical typing-aid plugins.
 *
 * Mounts a REAL Lexical editor (same node set as the ChatComposer) with the
 * plugin under test, and exposes the editor so a test can seed content, place a
 * selection, and dispatch the commands the plugin registers. Nothing here is
 * mocked but the network, so a passing test means the actual registered handler
 * ran against actual editor state.
 *
 * Commands are dispatched directly rather than through synthetic DOM key events:
 * `KEY_DOWN_COMMAND` is exactly the seam these plugins register on, and going
 * through it avoids testing jsdom's keyboard plumbing instead of our code.
 */

import React, { type ReactNode } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode, $createCodeNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from 'lexical'

import { renderWithQuery } from './renderWithQuery'

export const HARNESS_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
  TableNode,
  TableCellNode,
  TableRowNode,
]

export interface PluginHarness {
  editor: LexicalEditor
  unmount: () => void
}

export function renderPluginEditor(plugin: ReactNode): PluginHarness {
  let captured: LexicalEditor | null = null

  function CaptureEditor() {
    const [editor] = useLexicalComposerContext()
    captured = editor
    return null
  }

  const { unmount } = renderWithQuery(
    <LexicalComposer
      initialConfig={{
        namespace: 'plugin-harness',
        nodes: HARNESS_NODES,
        onError: (error: Error) => {
          throw error
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <CaptureEditor />
      {plugin}
    </LexicalComposer>,
  )

  if (!captured) throw new Error('Lexical editor was not captured')
  return { editor: captured, unmount }
}

/** Replace the document with one paragraph and put the caret at the end of it. */
export function seedParagraph(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(text)
      paragraph.append(textNode)
      root.append(paragraph)
      textNode.select(text.length, text.length)
    },
    { discrete: true },
  )
}

/** Same, but the text sits inside a fenced code block. */
export function seedCodeBlock(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const code = $createCodeNode()
      const textNode = $createTextNode(text)
      code.append(textNode)
      root.append(code)
      textNode.select(text.length, text.length)
    },
    { discrete: true },
  )
}

/** Same, but the text carries the inline `code` format. */
export function seedInlineCode(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(text)
      textNode.setFormat('code')
      paragraph.append(textNode)
      root.append(paragraph)
      textNode.select(text.length, text.length)
    },
    { discrete: true },
  )
}

/**
 * Seed `[bold run][plain run]` with the caret at the end — the shape that proves
 * a trigger at offset 0 of its own text node is still glued to the run before it.
 */
export function seedAfterBoldRun(editor: LexicalEditor, bold: string, plain: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const boldNode = $createTextNode(bold)
      boldNode.setFormat('bold')
      const plainNode = $createTextNode(plain)
      paragraph.append(boldNode, plainNode)
      root.append(paragraph)
      plainNode.select(plain.length, plain.length)
    },
    { discrete: true },
  )
}

export function readText(editor: LexicalEditor): string {
  let text = ''
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent()
  })
  return text
}

export function readCaretOffset(editor: LexicalEditor): number | null {
  let offset: number | null = null
  editor.getEditorState().read(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) offset = selection.anchor.offset
  })
  return offset
}

/**
 * Commit any batched `editor.update()` so the next read sees it.
 *
 * The plugins commit inside a plain (non-discrete) update, which Lexical
 * batches — reading the editor state straight after dispatching would return
 * the PREVIOUS state and quietly assert nothing.
 */
export function flush(editor: LexicalEditor): void {
  editor.update(() => {}, { discrete: true })
}

/**
 * Dispatch a keydown through the command system and flush the result.
 *
 * `cancelable` matters: the plugins call `preventDefault()`, and a
 * non-cancelable event would silently swallow that signal.
 *
 * NOTE on the return value: Lexical core registers its own KEY_DOWN handler at
 * COMMAND_PRIORITY_EDITOR, which returns true for most keys, so
 * `dispatchCommand`'s result is NOT a usable "did our plugin act" signal.
 * `defaultPrevented` is — only a plugin that commits calls `preventDefault()` on
 * these keys. Prefer asserting on the resulting document text.
 */
export function pressKey(
  editor: LexicalEditor,
  key: string,
): { defaultPrevented: boolean } {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
  editor.dispatchCommand(KEY_DOWN_COMMAND, event)
  flush(editor)
  return { defaultPrevented: event.defaultPrevented }
}
