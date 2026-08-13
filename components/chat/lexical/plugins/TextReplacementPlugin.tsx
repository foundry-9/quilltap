'use client'

/**
 * TextReplacementPlugin
 *
 * Layer 1.5 of the composer spellcheck/autocorrect plan: applies user-defined
 * word-boundary text replacements while typing. Listens for trigger characters
 * via KEY_DOWN_COMMAND at COMMAND_PRIORITY_LOW so other handlers (Enter
 * submission, composition mode, etc.) get first dibs.
 *
 * Behavior:
 * - Only fires when the cursor is at the end of a TextNode (mid-edits skip).
 * - Replacement and trigger char are inserted in a single editor.update tagged
 *   "text-replacement" so a single Cmd-Z reverts to the literal typed text.
 * - IME composition skips the plugin.
 * - Code is never rewritten: fenced blocks and inline `code` runs both bail via
 *   the shared $isInCodeContext() guard (bug 63).
 * - Paste does NOT trigger (paste arrives via clipboard events, not keystrokes).
 * - Newline (Enter) is intentionally NOT a trigger in v1 — submission /
 *   paragraph-break handlers own that key.
 *
 * @module components/chat/lexical/plugins/TextReplacementPlugin
 */

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $getNodeByKey,
  KEY_DOWN_COMMAND,
  COMMAND_PRIORITY_LOW,
  type TextNode,
} from 'lexical'

import {
  useTextReplacementRules,
  findReplacement,
} from '@/lib/text-replacement/useTextReplacementRules'
import { $isInCodeContext } from '../utils/code-context'

/**
 * Word-boundary trigger characters. Newline is excluded — submit/paragraph
 * handlers own that key.
 */
const TRIGGER_CHARS = new Set([
  ' ',
  ' ', // NBSP
  '\t',
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
])

function isBoundaryChar(ch: string): boolean {
  return TRIGGER_CHARS.has(ch)
}

interface ChatSettingsResponse {
  textReplacementsEnabled?: boolean
}

interface CandidateWord {
  nodeKey: string
  startOffset: number
  endOffset: number
  word: string
}

export function TextReplacementPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const { data: chatSettings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettingsResponse>('/api/v1/settings/chat', { signal }),
  })
  const { compiled } = useTextReplacementRules()

  // Keep latest values in refs so the registered command handler doesn't need
  // to be re-registered every time settings or rules change.
  const enabledRef = useRef<boolean>(true)
  const compiledRef = useRef(compiled)

  useEffect(() => {
    enabledRef.current = chatSettings?.textReplacementsEnabled ?? true
  }, [chatSettings?.textReplacementsEnabled])

  useEffect(() => {
    compiledRef.current = compiled
  }, [compiled])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent | null) => {
      if (event === null) return false
      if (!enabledRef.current) return false
      const rules = compiledRef.current
      if (rules.empty) return false
      if (editor.isComposing()) return false
      if (!TRIGGER_CHARS.has(event.key)) return false

      const candidate = editor.getEditorState().read<CandidateWord | null>(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null

        // Never rewrite code as it is typed — bug 63. Shared with
        // CharTypeaheadPlugin so the two bail lists cannot drift.
        if ($isInCodeContext(selection)) return null

        const anchor = selection.anchor
        const anchorNode = anchor.getNode()
        if (!$isTextNode(anchorNode)) return null

        const text = anchorNode.getTextContent()
        const offset = anchor.offset

        // Only trigger when the cursor is at the very end of the text node —
        // matches user-is-typing-at-end semantics and avoids mid-word
        // surprises.
        if (offset !== text.length) return null

        // Walk back across non-boundary chars to find the start of the word.
        let start = offset
        while (start > 0 && !isBoundaryChar(text[start - 1])) start--

        if (start === offset) return null // empty word (cursor sits on a boundary)

        return {
          nodeKey: anchorNode.getKey(),
          startOffset: start,
          endOffset: offset,
          word: text.slice(start, offset),
        }
      })

      if (!candidate) return false

      const replacement = findReplacement(candidate.word, rules)
      if (replacement === undefined) return false

      event.preventDefault()
      editor.update(
        () => {
          const node = $getNodeByKey(candidate.nodeKey)
          if (!node || !$isTextNode(node)) return
          const textNode = node as TextNode
          const text = textNode.getTextContent()

          // Bail if the world has shifted under us (concurrent edit).
          if (
            candidate.endOffset > text.length ||
            text.slice(candidate.startOffset, candidate.endOffset) !== candidate.word
          ) {
            return
          }

          const triggerChar = event.key
          const newText =
            text.slice(0, candidate.startOffset) +
            replacement +
            triggerChar +
            text.slice(candidate.endOffset)
          textNode.setTextContent(newText)

          const cursor = candidate.startOffset + replacement.length + triggerChar.length
          textNode.select(cursor, cursor)
        },
        { tag: 'text-replacement' },
      )

      return true
    }

    return editor.registerCommand(KEY_DOWN_COMMAND, handleKeyDown, COMMAND_PRIORITY_LOW)
  }, [editor])

  return null
}

export default TextReplacementPlugin
