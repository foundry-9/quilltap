'use client'

/**
 * MarkdownLexicalEditor — reusable Lexical-based markdown editor.
 *
 * Self-contained: composer + standard plugin set + formatting toolbar +
 * markdown bidirectional bridge, plus the same "edit source" toggle the
 * Salon's Document Mode offers. Designed for forms (character fields,
 * project scenarios, settings panels) that want the same editing
 * affordances without inheriting Document Mode's chat-specific bits
 * (line gutter, doc_focus tool plugin).
 *
 * Lower-level building blocks (MarkdownBridgePlugin, FormattingCommandPlugin,
 * FormattingToolbar, COMPOSER_TRANSFORMERS, composerTheme) live alongside
 * Document Mode in components/chat/lexical and are reused verbatim.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { composerTheme } from '@/components/chat/lexical/theme'
import {
  MarkdownBridgePlugin,
  COMPOSER_TRANSFORMERS,
} from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'
import { FormattingCommandPlugin } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import FormattingToolbar from '@/components/chat/FormattingToolbar'

interface MarkdownLexicalEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Pass to enable roleplay-template-aware delimiter buttons in the toolbar */
  roleplayTemplateId?: string | null
  /**
   * Forces a Lexical remount when this changes — use when external loads
   * replace the editor's state (e.g. switching scenario files).
   */
  remountKey?: string | number
  className?: string
  /** Identifier for the LexicalComposer namespace (debugging/devtools) */
  namespace?: string
  ariaLabel?: string
  /**
   * Show the "Edit markdown source" toggle button in the toolbar. Defaults
   * to true. Set false for callers that should never expose raw source.
   */
  showSourceToggle?: boolean
  /** Minimum height of the editor body. Accepts any CSS height value. */
  minHeight?: string
}

function EditorBody({
  value,
  onChange,
  disabled,
  minHeight,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  minHeight: string
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="qt-doc-editor-area qt-lexical-contenteditable"
            aria-label="Markdown editor"
            style={{ lineHeight: '1.6', minHeight }}
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <TablePlugin />
      <MarkdownShortcutPlugin transformers={COMPOSER_TRANSFORMERS} />
      <MarkdownBridgePlugin
        input={value}
        setInput={onChange}
        initialMarkdown={value}
      />
      <FormattingCommandPlugin />
    </>
  )
}

function ToolbarSlot({
  roleplayTemplateId,
  disabled,
  showSource,
  sourceTextareaRef,
  onContentChange,
  onToggleSource,
}: {
  roleplayTemplateId?: string | null
  disabled: boolean
  showSource: boolean
  sourceTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  onContentChange: (value: string) => void
  onToggleSource?: () => void
}) {
  const [editor] = useLexicalComposerContext()
  return (
    <div className="qt-doc-toolbar">
      <FormattingToolbar
        roleplayTemplateId={roleplayTemplateId}
        editor={editor}
        disabled={disabled}
        showSource={showSource}
        sourceTextareaRef={sourceTextareaRef}
        setInput={onContentChange}
        onToggleSource={onToggleSource}
      />
    </div>
  )
}

export default function MarkdownLexicalEditor({
  value,
  onChange,
  disabled = false,
  roleplayTemplateId,
  remountKey,
  className,
  namespace = 'MarkdownLexicalEditor',
  ariaLabel,
  showSourceToggle = true,
  minHeight = '12rem',
}: MarkdownLexicalEditorProps) {
  const [showSource, setShowSource] = useState(false)
  // Bumped each time the user leaves source mode, so the LexicalComposer
  // remounts and the MarkdownBridge re-parses the (possibly textarea-edited)
  // value. MarkdownBridgePlugin only reads initialMarkdown on first mount.
  const [sourceLeaveCount, setSourceLeaveCount] = useState(0)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)

  const initialConfig = useMemo(
    () => ({
      namespace,
      theme: composerTheme,
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
      editable: !disabled,
      onError: (error: Error) => {
        console.error('[MarkdownLexicalEditor] Editor error:', error)
      },
    }),
    // Lexical's initialConfig is read once at mount; we force re-mount via
    // the `key` on LexicalComposer below when remountKey or the source-leave
    // counter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const toggleSourceMode = useCallback(() => {
    setShowSource((prev) => {
      if (prev) setSourceLeaveCount((n) => n + 1)
      return !prev
    })
  }, [])

  const composerKey = `${remountKey ?? 'default'}-${sourceLeaveCount}`

  const frameClassName = [
    'rounded-lg border qt-border-default qt-bg-card qt-shadow-sm overflow-hidden',
    'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={frameClassName} aria-label={ariaLabel}>
      <LexicalComposer key={composerKey} initialConfig={initialConfig}>
        <ToolbarSlot
          roleplayTemplateId={roleplayTemplateId}
          disabled={disabled}
          showSource={showSource}
          sourceTextareaRef={sourceTextareaRef}
          onContentChange={onChange}
          onToggleSource={showSourceToggle ? toggleSourceMode : undefined}
        />
        {showSource ? (
          <textarea
            ref={sourceTextareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            spellCheck={false}
            aria-label={ariaLabel ? `${ariaLabel} (markdown source)` : 'Markdown source'}
            className="w-full px-3 py-2 font-mono text-sm qt-text-primary border-0 outline-none resize-y"
            style={{ lineHeight: '1.6', minHeight, backgroundColor: 'var(--color-background)' }}
          />
        ) : (
          <div className="qt-doc-editor-with-gutter">
            <div className="flex-1">
              <EditorBody
                value={value}
                onChange={onChange}
                disabled={disabled}
                minHeight={minHeight}
              />
            </div>
          </div>
        )}
      </LexicalComposer>
    </div>
  )
}
