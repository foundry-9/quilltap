/**
 * The indent/outdent affordances light up whenever the caret is *anywhere*
 * inside a list item — not only where it happens to land first.
 */

import {
  createEditor,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
} from 'lexical'
import { registerRichText } from '@lexical/rich-text'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode, $isListNode, $isListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { $selectionIsInListItem } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import { $importComposerMarkdown } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'

function makeEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'list-selection',
    nodes: [
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
    ],
    onError: (error) => {
      throw error
    },
  })
  editor.setRootElement(document.createElement('div'))
  registerRichText(editor)
  return editor
}

/** The nth top-level list item. */
function $itemAt(index: number): ListItemNode {
  const list = $getRoot().getFirstChild()
  if (!$isListNode(list)) throw new Error('expected a list')
  const item = list.getChildren()[index]
  if (!$isListItemNode(item)) throw new Error(`expected a list item at ${index}`)
  return item
}

function loadMarkdown(editor: LexicalEditor, markdown: string) {
  editor.update(
    () => {
      $importComposerMarkdown(editor, markdown)
    },
    { discrete: true },
  )
}

/** Place a collapsed caret inside the nth item's `child`th text node. */
function placeCaret(editor: LexicalEditor, index: number, offset: number, child = 0) {
  editor.update(
    () => {
      const texts = $itemAt(index).getChildren().filter($isTextNode)
      texts[child].select(offset, offset)
    },
    { discrete: true },
  )
}

function isInListItem(editor: LexicalEditor): boolean {
  let result = false
  editor.getEditorState().read(() => {
    result = $selectionIsInListItem()
  })
  return result
}

describe('$selectionIsInListItem', () => {
  it.each([
    ['at the start of the text', 0],
    ['mid-word', 3],
    ['at the end of the text', 5],
  ])('is true with the caret %s', (_label, offset) => {
    const editor = makeEditor()
    loadMarkdown(editor, '- alpha\n- beta')
    placeCaret(editor, 1, offset === 5 ? 4 : offset)

    expect(isInListItem(editor)).toBe(true)
  })

  it('is true inside any of an item\'s inline runs', () => {
    const editor = makeEditor()
    loadMarkdown(editor, '- alpha\n- **Jackie** (3 nodes)')

    // "**Jackie** (3 nodes)" is a bold run followed by a plain one; the caret
    // must count as "in a list item" in either.
    placeCaret(editor, 1, 2, 0)
    expect(isInListItem(editor)).toBe(true)

    placeCaret(editor, 1, 4, 1)
    expect(isInListItem(editor)).toBe(true)
  })

  it('is true for a caret expressed as an element point on a non-empty item', () => {
    // Clicking into a line can land the caret on the element rather than on its
    // text, and `getNodes()` returns [] for that shape — the case that left the
    // indent buttons dead unless the caret happened to be a text point.
    const editor = makeEditor()
    loadMarkdown(editor, '- alpha\n- beta')
    editor.update(
      () => {
        const item = $itemAt(1)
        const selection = $createRangeSelection()
        selection.anchor.set(item.getKey(), 0, 'element')
        selection.focus.set(item.getKey(), 0, 'element')
        $setSelection(selection)
      },
      { discrete: true },
    )

    expect(isInListItem(editor)).toBe(true)
  })

  it('is true for an element point at the end of a non-empty item', () => {
    const editor = makeEditor()
    loadMarkdown(editor, '- alpha\n- beta')
    editor.update(
      () => {
        const item = $itemAt(1)
        const selection = $createRangeSelection()
        const end = item.getChildrenSize()
        selection.anchor.set(item.getKey(), end, 'element')
        selection.focus.set(item.getKey(), end, 'element')
        $setSelection(selection)
      },
      { discrete: true },
    )

    expect(isInListItem(editor)).toBe(true)
  })

  it('is true when the caret sits on an empty list item', () => {
    const editor = makeEditor()
    loadMarkdown(editor, '- alpha\n- beta')
    editor.update(
      () => {
        const item = $itemAt(1)
        item.getChildren().forEach((child) => child.remove())
        item.select()
      },
      { discrete: true },
    )

    expect(isInListItem(editor)).toBe(true)
  })

  it('is true for a selection spanning several list items', () => {
    const editor = makeEditor()
    loadMarkdown(editor, '- alpha\n- beta\n- gamma')
    editor.update(
      () => {
        const first = $itemAt(0).getChildren().filter($isTextNode)[0]
        const last = $itemAt(2).getChildren().filter($isTextNode)[0]
        const selection = first.select(1, 1)
        selection.focus.set(last.getKey(), 2, 'text')
      },
      { discrete: true },
    )

    expect(isInListItem(editor)).toBe(true)
  })

  it('is false in a paragraph', () => {
    const editor = makeEditor()
    loadMarkdown(editor, 'Just prose.\n\n- alpha')
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild()
        if (paragraph === null) throw new Error('expected a paragraph')
        paragraph.selectEnd()
      },
      { discrete: true },
    )

    expect(isInListItem(editor)).toBe(false)
  })
})
