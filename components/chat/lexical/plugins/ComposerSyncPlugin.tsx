'use client'

/**
 * ComposerSyncPlugin
 *
 * Decoupled bridge between the chat composer's Lexical editor and the React
 * page. Unlike [[markdown-bridge-plugin]] (which the Scriptorium document
 * editor and the standalone markdown editor use, and which pushes the full
 * markdown string into parent state on every keystroke), this plugin keeps the
 * live text *inside* the editor and reports only:
 *
 * - `onContentChange(hasContent)` — a debounced boolean so the Send button can
 *   enable/disable. React de-dupes identical values, so the page re-renders at
 *   most when emptiness flips (≈ twice per message) rather than per keystroke.
 * - `onPersistDraft(markdown)` — a debounced full-markdown emit used purely for
 *   draft persistence. The page writes it to localStorage via refs, with no
 *   `setState`, so it never re-renders the (large) Salon tree.
 *
 * The editor is *controlled* for EXTERNAL writes only (`value`): draft restore,
 * resend-into-composer, and post-send clear flow in through `value` and are
 * pushed into the editor here. Because the editor no longer writes back to
 * `value` on keystrokes, this `value → editor` sync is free of the feedback
 * loop that the old per-keystroke bridge had to debounce around.
 *
 * Live text for sending is read imperatively via the editor handle
 * (`getMarkdown()`), not from `value`, so `value` may lag the editor while the
 * user types — which is exactly what keeps the page from re-rendering.
 *
 * @module components/chat/lexical/plugins/ComposerSyncPlugin
 */

import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { $exportComposerMarkdown, $importComposerMarkdown } from './MarkdownBridgePlugin'

const PRESERVED_EXPORT_CHARS = ['*', '_', '`', '~']

interface ComposerSyncPluginProps {
  /**
   * External markdown value. Updated only by external events (draft restore,
   * resend, post-send clear) — NOT on keystrokes. Pushed into the editor when
   * it changes.
   */
  value: string
  /** Debounced report of whether the editor currently holds non-blank text. */
  onContentChange: (hasContent: boolean) => void
  /** Debounced full-markdown emit for draft persistence (no React state). */
  onPersistDraft?: (markdown: string) => void
  /**
   * When true (source/raw-markdown mode), the textarea owns the text and the
   * hidden Lexical editor must not be driven from `value`. The composer
   * re-syncs the editor on toggle-out via the editor handle.
   */
  suspendSync?: boolean
}

/** Fast debounce for the Send-button presence flag (~1 frame batch). */
const CONTENT_DEBOUNCE_MS = 100
/** Slower debounce for draft serialization + persistence. */
const DRAFT_DEBOUNCE_MS = 800

export function ComposerSyncPlugin({
  value,
  onContentChange,
  onPersistDraft,
  suspendSync = false,
}: ComposerSyncPluginProps): null {
  const [editor] = useLexicalComposerContext()

  // Last `value` we pushed into the editor, so we only rewrite on real changes.
  const lastSyncedRef = useRef<string | null>(null)
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // value → editor (controlled). Runs only when `value` actually changes, which
  // happens on external events only — typing does not touch `value`.
  useEffect(() => {
    if (suspendSync) return
    if (lastSyncedRef.current === value) {
      onContentChange(!!value.trim())
      return
    }
    lastSyncedRef.current = value
    editor.update(
      () => {
        $getRoot().clear()
        if (value) {
          $importComposerMarkdown(editor, value)
        }
      },
      { tag: 'external-sync' },
    )
    onContentChange(!!value.trim())
  }, [editor, value, suspendSync, onContentChange])

  // editor → page. Reports content presence (cheap text read) and, separately,
  // a debounced draft markdown. Never writes `value` back.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      // Skip our own value → editor pushes.
      if (tags.has('external-sync')) return

      let hasContent = false
      editorState.read(() => {
        hasContent = $getRoot().getTextContent().trim().length > 0
      })

      if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
      contentTimerRef.current = setTimeout(() => {
        onContentChange(hasContent)
      }, CONTENT_DEBOUNCE_MS)

      if (onPersistDraft) {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
        draftTimerRef.current = setTimeout(() => {
          let markdown = ''
          editor.getEditorState().read(() => {
            markdown = $exportComposerMarkdown(editor, PRESERVED_EXPORT_CHARS)
          })
          onPersistDraft(markdown)
        }, DRAFT_DEBOUNCE_MS)
      }
    })
  }, [editor, onContentChange, onPersistDraft])

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current)
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    }
  }, [])

  return null
}

export default ComposerSyncPlugin
