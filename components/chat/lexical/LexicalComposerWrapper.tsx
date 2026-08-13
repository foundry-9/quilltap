'use client'

/**
 * Lexical Composer Wrapper
 *
 * Top-level component that wires together a Lexical editor with all the
 * plugins required for the chat composer. Exposes a ComposerEditorHandle
 * via forwardRef so the parent can imperatively focus, read markdown, etc.
 *
 * @module components/chat/lexical/LexicalComposerWrapper
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'

import { composerTheme } from './theme'
import type { ComposerEditorHandle } from './types'
import { useMarkdownBridge, COMPOSER_TRANSFORMERS } from './plugins/MarkdownBridgePlugin'
import { ComposerSyncPlugin } from './plugins/ComposerSyncPlugin'
import KeyboardPlugin from './plugins/KeyboardPlugin'
import { ImagePastePlugin } from './plugins/ImagePastePlugin'
import {
  ExternalControlPlugin,
  type ExternalControlHandle,
} from './plugins/ExternalControlPlugin'
import { FormattingCommandPlugin } from './plugins/FormattingCommandPlugin'
import { TextReplacementPlugin } from './plugins/TextReplacementPlugin'
import { EmojiTypeaheadPlugin } from './plugins/EmojiTypeaheadPlugin'

interface LexicalComposerWrapperProps {
  /**
   * External markdown value. Updated only by external events (draft restore,
   * resend, post-send clear) — NOT on keystrokes. The editor owns the live
   * text; read it via the handle's `getMarkdown()` for sending.
   */
  input: string
  /** Debounced report of whether the editor holds non-blank text. */
  onContentChange: (hasContent: boolean) => void
  /** Debounced full-markdown emit for draft persistence (no parent re-render). */
  onPersistDraft?: (markdown: string) => void
  /** Callback to submit the message */
  onSubmit: () => void
  /** Callback when an image is pasted */
  onImagePaste: (file: File) => Promise<void>
  /** Whether document editing mode is enabled */
  documentEditingMode: boolean
  /** Whether the editor is disabled */
  disabled: boolean
  /** Placeholder text */
  placeholder: string
  /**
   * When true (source/raw-markdown mode), the hidden editor is not driven from
   * `input`; the composer re-syncs it on toggle-out via the editor handle.
   */
  suspendSync?: boolean
}

/**
 * Inner component that has access to the Lexical composer context.
 * This is needed because useMarkdownBridge requires the context.
 */
const ComposerPlugins = forwardRef<
  ComposerEditorHandle,
  LexicalComposerWrapperProps
>(function ComposerPlugins(
  {
    input,
    onContentChange,
    onPersistDraft,
    onSubmit,
    onImagePaste,
    documentEditingMode,
    disabled,
    placeholder,
    suspendSync,
  },
  ref,
) {
  const [editor] = useLexicalComposerContext()
  const controlRef = useRef<ExternalControlHandle>(null)
  const { getMarkdown, setMarkdown } = useMarkdownBridge()
  const { data: chatSettings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<{ composerSpellcheck?: boolean }>('/api/v1/settings/chat', { signal }),
  })
  const spellCheck = chatSettings?.composerSpellcheck ?? true

  // Expose the ComposerEditorHandle to parent
  useImperativeHandle(
    ref,
    () => ({
      focus: (options?: FocusOptions) => controlRef.current?.focus(options),
      scrollIntoView: (options?: ScrollIntoViewOptions) =>
        controlRef.current?.scrollIntoView(options),
      getMarkdown,
      setMarkdown,
      prependText: (text: string) => controlRef.current?.prependText(text),
      getEditor: () => editor,
    }),
    [editor, getMarkdown, setMarkdown],
  )

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="qt-chat-composer-input qt-lexical-contenteditable"
            aria-placeholder={placeholder}
            placeholder={
              <div className="qt-lexical-placeholder">{placeholder}</div>
            }
            style={{ lineHeight: '1.5' }}
            spellCheck={spellCheck}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <MarkdownShortcutPlugin transformers={COMPOSER_TRANSFORMERS} />
      <ComposerSyncPlugin
        value={input}
        onContentChange={onContentChange}
        onPersistDraft={onPersistDraft}
        suspendSync={suspendSync}
      />
      <KeyboardPlugin
        documentEditingMode={documentEditingMode}
        onSubmit={onSubmit}
      />
      <ImagePastePlugin onImagePaste={onImagePaste} />
      <ExternalControlPlugin controlRef={controlRef} />
      <FormattingCommandPlugin />
      {/* Above TextReplacementPlugin: `:` is a word-boundary trigger for both,
          and emoji only swallows the keystroke when it actually commits. */}
      <EmojiTypeaheadPlugin />
      <TextReplacementPlugin />
    </>
  )
})

/**
 * Lexical composer wrapper for the chat message input.
 *
 * Replaces the previous textarea-based input with a Lexical rich text
 * editor while maintaining the same external interface (markdown strings).
 */
export const LexicalComposerWrapper = forwardRef<
  ComposerEditorHandle,
  LexicalComposerWrapperProps
>(function LexicalComposerWrapper(props, ref) {
  const { disabled } = props

  const initialConfig = useMemo(
    () => ({
      namespace: 'ChatComposer',
      theme: composerTheme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode, TableNode, TableCellNode, TableRowNode],
      editable: !disabled,
      onError: (error: Error) => {
        console.error('[LexicalComposer] Editor error:', error)
      },
    }),
    // Only compute once on mount — editable state is updated via effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditableSync disabled={disabled} />
      <ComposerPlugins ref={ref} {...props} />
    </LexicalComposer>
  )
})

/**
 * Syncs the editor's editable state with the disabled prop.
 * Separated to avoid re-creating the entire composer on disabled changes.
 */
function EditableSync({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return null
}
