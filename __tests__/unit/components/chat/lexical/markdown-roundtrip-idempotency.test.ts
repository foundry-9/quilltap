/**
 * General markdown round-trip idempotency table.
 *
 * v4 had no analogue of v5's `markdown-round-trip.spec.ts` `IDEMPOTENT` table —
 * only a list-specific suite (`markdown-list-roundtrip.test.ts`) and a pure
 * escape-helper suite. This is that table: source strings which must survive
 * `serialize(parse(x))` BYTE-identically through the composer bridge.
 *
 * It was opened by the composer emoji feature (Layer 2.0e), whose inserted value
 * is a plain Unicode character precisely so that markdown, export, search,
 * embeddings, and the LLM wire never have to know about it. The emoji vectors
 * are what catch a future change to the escape set; add to the table whenever a
 * character class earns a guarantee.
 */

import { createEditor } from 'lexical'
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import {
  $exportComposerMarkdown,
  $importComposerMarkdown,
} from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'

/** `DEFAULT_PRESERVED_MARKDOWN_CHARS` — the bridge's real escape set. */
const PRESERVED = ['*', '_', '`', '~']

function roundTrip(source: string): string {
  const editor = createEditor({
    namespace: 'roundtrip-idempotency',
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

/** [label, source]. The source must come back byte-identical. */
const IDEMPOTENT: [string, string][] = [
  // Controls — if these break, the harness is wrong, not the vectors.
  ['plain prose', 'Hello there.'],
  ['a bold run', '**bold** and plain'],

  // Emoji — astral (surrogate-pair) characters as plain TextNode content.
  ['an astral character in prose', 'Hello 😄'],
  ['an astral character inside a bold run', '**bold 😄**'],
  ['adjacent emoji', '😄😄'],
  // The composer inserts NO trailing space, so this is the shape a writer
  // actually produces — and the one a naive word-boundary escape would break.
  ['an emoji glued to a word', 'word😄'],
  // 👍️ carries a trailing U+FE0F variation selector. Anything that "tidies"
  // the text would silently drop it and change the rendered glyph.
  ['a variation-selector emoji', 'nice 👍️'],
  ['a ZWJ sequence', 'crew 🧑‍🚒'],
  ['a regional-indicator flag', 'from 🇺🇸'],
  ['emoji beside preserved-escape characters', 'a_b 😄 c*d'],
  ['an emoji in a list item', '- item 😄'],
  ['an emoji in a heading', '# Heading 😄'],
]

describe('markdown round-trip idempotency', () => {
  it.each(IDEMPOTENT)('%s survives serialize(parse(x)) byte-identically', (_label, source) => {
    expect(roundTrip(source)).toBe(source)
  })
})
