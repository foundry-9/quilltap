'use client'

/**
 * DocumentChangeTracker - Lexical plugin that tracks changed lines and measures DOM positions.
 *
 * Listens to Lexical editor updates, diffs current block content against baseline,
 * and measures block element positions for the gutter.
 *
 * Captures baseline as block-level text (via getTextContent) when the baseline prop
 * changes, so both sides of the diff use the same representation — avoiding false
 * positives from comparing raw markdown against Lexical's plain-text output.
 *
 * The changed set is derived from a proper line diff (Myers shortest-edit
 * script), not a positional index comparison, so inserting or deleting a block
 * near the top no longer marks every block below it as changed — only the blocks
 * that are genuinely new or modified light up.
 *
 * Scriptorium Phase 3.6
 *
 * @module app/salon/[id]/components/DocumentChangeTracker
 */

import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { changedBlockIndices } from '@/lib/doc-edit/line-diff'
import type { LinePosition } from './DocumentGutter'

interface DocumentChangeTrackerProps {
  /** Content at document open / last save, used as diff baseline */
  baselineContent: string
  /** Called with the set of changed block indices */
  onChangedLines: (lines: Set<number>) => void
  /** Called with measured positions of each block element */
  onLinePositions: (positions: LinePosition[], totalHeight: number) => void
}

/**
 * Read current block text contents from a Lexical editor state.
 */
function readBlockTexts(editor: ReturnType<typeof useLexicalComposerContext>[0]): string[] {
  let blockTexts: string[] = []
  editor.getEditorState().read(() => {
    const root = $getRoot()
    blockTexts = root.getChildren().map((node) => node.getTextContent())
  })
  return blockTexts
}

export default function DocumentChangeTracker({
  baselineContent,
  onChangedLines,
  onLinePositions,
}: DocumentChangeTrackerProps) {
  const [editor] = useLexicalComposerContext()
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Baseline stored as block-level text array (same format as current block texts)
  const baselineBlockTextsRef = useRef<string[]>([])

  // When baselineContent changes (document open or save), capture the current
  // editor block texts as the new baseline. After a save the editor state matches
  // the saved content, so capturing block texts here gives us an apples-to-apples
  // comparison target that avoids markdown-vs-plain-text mismatches.
  useEffect(() => {
    baselineBlockTextsRef.current = readBlockTexts(editor)

    // Baseline just changed — content matches, so no changed lines
    onChangedLines(new Set())
  }, [baselineContent, editor, onChangedLines])

  useEffect(() => {
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      // Clear any pending debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        // Read block text contents from the editor state
        let blockTexts: string[] = []
        editorState.read(() => {
          const root = $getRoot()
          blockTexts = root.getChildren().map((node) => node.getTextContent())
        })

        const baselineTexts = baselineBlockTextsRef.current

        // Diff the current blocks against the baseline with a real line diff, so
        // only blocks that are genuinely new or modified are marked — a block
        // inserted or removed above no longer shifts everything below into the
        // changed set.
        const changedSet = changedBlockIndices(baselineTexts, blockTexts)

        onChangedLines(changedSet)

        // Measure DOM positions after the read, using rAF to ensure DOM is up to date.
        // Positions are computed relative to the root element's top so they align
        // with the gutter (a sibling in the same scroll container).
        requestAnimationFrame(() => {
          const rootElement = editor.getRootElement()
          if (!rootElement) {
            return
          }

          const rootRect = rootElement.getBoundingClientRect()
          const children = Array.from(rootElement.children) as HTMLElement[]
          const positions: LinePosition[] = children.map((child, index) => {
            const childRect = child.getBoundingClientRect()
            return {
              index,
              top: childRect.top - rootRect.top + rootElement.scrollTop,
              height: childRect.height,
            }
          })

          const totalHeight = rootElement.scrollHeight

          onLinePositions(positions, totalHeight)
        })
      }, 300)
    })

    return () => {
      unregister()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [editor, onChangedLines, onLinePositions])

  return null
}
