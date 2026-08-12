/**
 * End-to-end guard for sub-lists surviving the Markdown ⇄ Lexical bridge.
 *
 * Lexical's markdown importer resolves nesting with `Math.floor(spaces / 4)`,
 * so before [[list-indentation]] every two-space-nested document flattened on
 * open and was written back flat on the next save.
 */

import { createEditor, $getRoot, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode, $isListNode, $isListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { registerRichText } from '@lexical/rich-text'
import {
  $exportComposerMarkdown,
  $importComposerMarkdown,
} from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'

const PRESERVED = ['*', '_', '`', '~']

function makeEditor() {
  const editor = createEditor({
    namespace: 'list-roundtrip',
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
  registerRichText(editor)
  return editor
}

function roundTrip(source: string): string {
  const editor = makeEditor()
  editor.update(
    () => {
      $importComposerMarkdown(editor, source)
    },
    { discrete: true },
  )
  let exported = ''
  editor.getEditorState().read(() => {
    exported = $exportComposerMarkdown(editor, PRESERVED)
  })
  return exported
}

describe('markdown list round-trip', () => {
  it('preserves two-space sub-lists byte for byte', () => {
    const source = [
      '### Status',
      '',
      '- **Jackie** (3 nodes)',
      '  - Implant',
      '  - Notation Engine',
      '  - Resonator Mark Three',
      '',
      '- **Charlie** (2 nodes)',
      '  - Implant',
    ].join('\n')

    expect(roundTrip(source)).toBe(source)
  })

  it('preserves four-space sub-lists byte for byte', () => {
    const source = ['- a', '    - b', '        - c', '- d'].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  it('preserves nested ordered lists', () => {
    const source = ['1. a', '   1. b', '   2. c', '2. d'].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  it('preserves nesting in checklists', () => {
    const source = ['- [ ] a', '  - [x] b'].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  it('is stable across repeated saves', () => {
    const source = ['- a', '  - b', '    - c'].join('\n')
    expect(roundTrip(roundTrip(roundTrip(source)))).toBe(source)
  })

  it('exports an item indented in the editor at the document unit', () => {
    const editor = makeEditor()
    editor.update(
      () => {
        $importComposerMarkdown(editor, '- alpha\n  - beta\n- gamma')
      },
      { discrete: true },
    )

    // Put the caret in "gamma" and nest it, the way Tab or the toolbar does.
    const selectGamma = () => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      const last = list.getChildren().at(-1)
      if (!$isListItemNode(last)) throw new Error('expected a list item')
      last.selectEnd()
    }

    editor.update(
      () => {
        selectGamma()
        editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)
      },
      { discrete: true },
    )

    let exported = ''
    editor.getEditorState().read(() => {
      exported = $exportComposerMarkdown(editor, PRESERVED)
    })
    expect(exported).toBe(['- alpha', '  - beta', '  - gamma'].join('\n'))

    editor.update(
      () => {
        selectGamma()
        editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)
      },
      { discrete: true },
    )
    editor.getEditorState().read(() => {
      exported = $exportComposerMarkdown(editor, PRESERVED)
    })
    expect(exported).toBe(['- alpha', '  - beta', '- gamma'].join('\n'))
  })
})
