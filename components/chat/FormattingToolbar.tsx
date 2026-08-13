'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import type { LexicalEditor } from 'lexical'
import { FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, $createTextNode, $createParagraphNode, $getRoot } from 'lexical'
import { $isCodeNode, $createCodeNode } from '@lexical/code'
import { $setBlocksType } from '@lexical/selection'
import type { TemplateDelimiter, NarrationDelimiters } from '@/lib/schemas/template.types'
import {
  MARKDOWN_FORMATS,
  getDelimiterTooltip,
  delimiterToPrefixSuffix,
  type MarkdownFormatConfig,
} from '@/lib/chat/annotations'
import { toggleWrap, toggleLinePrefix, insertTagPrefix } from '@/lib/chat/text-transforms'
import {
  INSERT_HEADING_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  APPLY_DELIMITER_COMMAND,
  INDENT_LIST_ITEM_COMMAND,
  OUTDENT_LIST_ITEM_COMMAND,
} from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import {
  detectListIndentUnit,
  indentSourceLines,
  outdentSourceLines,
} from '@/components/chat/lexical/transformers/list-indentation'
import { type HeadingTagType, $createQuoteNode } from '@lexical/rich-text'
import { EmojiPickerPopover } from '@/components/chat/EmojiPickerPopover'

interface RoleplayTemplateWithDelimiters {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
  delimiters?: TemplateDelimiter[]
}

interface FormattingToolbarProps {
  roleplayTemplateId?: string | null
  /** Lexical editor instance for dispatching formatting commands */
  editor: LexicalEditor
  disabled?: boolean
  /** Whether source editing mode is active */
  showSource?: boolean
  /** Ref to the source textarea (needed for source mode formatting) */
  sourceTextareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Callback to update parent input state (needed for source mode) */
  setInput?: (value: string) => void
  /** Callback to toggle source editing mode */
  onToggleSource?: () => void
  /** Narration delimiters from the active roleplay template */
  narrationDelimiters?: NarrationDelimiters
}

/**
 * Formatting toolbar for document editing mode.
 *
 * Displays Markdown formatting buttons (bold, italic, headers, lists)
 * and roleplay delimiter buttons based on the active template.
 * Dispatches Lexical commands for formatting.
 */
export default function FormattingToolbar({
  roleplayTemplateId,
  editor,
  disabled = false,
  showSource = false,
  sourceTextareaRef,
  setInput,
  onToggleSource,
  narrationDelimiters,
}: FormattingToolbarProps) {
  const [template, setTemplate] = useState<RoleplayTemplateWithDelimiters | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [inCodeBlock, setInCodeBlock] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)

  // Track whether the cursor is inside a code block
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          setInCodeBlock(false)
          return
        }
        const anchorNode = selection.anchor.getNode()
        const parent = anchorNode.getParent()
        setInCodeBlock(parent !== null && $isCodeNode(parent))
      })
    })
  }, [editor])

  // Fetch template info when roleplayTemplateId changes
  useEffect(() => {
    if (!roleplayTemplateId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch with dependency tracking
      setTemplate(null)
      return
    }

    const fetchTemplate = async () => {
      try {
        setLoadingTemplate(true)

        const response = await fetch(`/api/v1/roleplay-templates/${roleplayTemplateId}`)
        if (response.ok) {
          const data = await response.json()
          setTemplate(data)
        } else {
          setTemplate(null)
        }
      } catch (error) {
        console.error('[FormattingToolbar] Error fetching template', {
          roleplayTemplateId,
          error: error instanceof Error ? error.message : String(error),
        })
        setTemplate(null)
      } finally {
        setLoadingTemplate(false)
      }
    }

    fetchTemplate()
  }, [roleplayTemplateId])

  // ── Source mode textarea helpers ──────────────────────────────────

  /** Replace textarea value, update parent state, and set cursor position */
  const sourceApply = useCallback(
    (textarea: HTMLTextAreaElement, newValue: string, cursorPos: number) => {
      textarea.value = newValue
      setInput?.(newValue)
      // Restore cursor after React re-render
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = cursorPos
        textarea.focus()
      })
    },
    [setInput],
  )

  /** Toggle wrap/unwrap of prefix+suffix around the current selection in the textarea */
  const sourceToggleWrap = useCallback(
    (textarea: HTMLTextAreaElement, prefix: string, suffix: string) => {
      const { value, cursor } = toggleWrap(
        { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd },
        prefix,
        suffix,
      )
      sourceApply(textarea, value, cursor)
    },
    [sourceApply],
  )

  /** Prefix each line in the selection (or the current line) with a string */
  const sourcePrefixLines = useCallback(
    (textarea: HTMLTextAreaElement, linePrefix: string) => {
      const { selectionStart: start, selectionEnd: end, value } = textarea

      // Expand selection to full lines
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const lineEnd = value.indexOf('\n', end)
      const actualEnd = lineEnd === -1 ? value.length : lineEnd

      const lines = value.slice(lineStart, actualEnd).split('\n')
      const prefixed = lines.map((line) => `${linePrefix}${line}`).join('\n')
      const newValue = value.slice(0, lineStart) + prefixed + value.slice(actualEnd)
      sourceApply(textarea, newValue, lineStart + prefixed.length)
    },
    [sourceApply],
  )

  // ── Handler functions ───────────────────────────────────────────

  // Handle Markdown format button click — dispatch Lexical commands
  // Uses editor.update() to ensure selection context is available
  const handleMarkdownClick = useCallback(
    (format: MarkdownFormatConfig) => {
      // Source mode: manipulate textarea directly
      if (showSource && sourceTextareaRef?.current) {
        const textarea = sourceTextareaRef.current
        switch (format.type) {
          case 'bold':
            sourceToggleWrap(textarea, '**', '**')
            break
          case 'italic':
            sourceToggleWrap(textarea, '_', '_')
            break
          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6': {
            const level = parseInt(format.type.slice(1))
            const hashes = '#'.repeat(level) + ' '
            sourcePrefixLines(textarea, hashes)
            break
          }
          case 'ul':
            sourcePrefixLines(textarea, '- ')
            break
          case 'ol':
            sourcePrefixLines(textarea, '1. ')
            break
          case 'blockquote':
            sourcePrefixLines(textarea, '> ')
            break
        }
        return
      }

      // Rich text mode: dispatch Lexical commands
      editor.update(() => {
        let selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          const root = $getRoot()
          const firstChild = root.getFirstChild()
          if (firstChild) {
            firstChild.selectEnd()
            selection = $getSelection()
          }
          if (!$isRangeSelection(selection)) return
        }

        switch (format.type) {
          case 'bold':
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
            break
          case 'italic':
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')
            break
          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6':
            editor.dispatchCommand(INSERT_HEADING_COMMAND, format.type as HeadingTagType)
            break
          case 'ul':
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
            break
          case 'ol':
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
            break
          case 'blockquote':
            $setBlocksType(selection, () => $createQuoteNode())
            break
        }
      })
      editor.focus()
    },
    [editor, showSource, sourceTextareaRef, sourceToggleWrap, sourcePrefixLines]
  )

  // Handle code block toggle
  const handleCodeBlockClick = useCallback(() => {
    // Source mode: toggle inline backticks or insert fenced code block
    if (showSource && sourceTextareaRef?.current) {
      const textarea = sourceTextareaRef.current
      const { selectionStart: start, selectionEnd: end, value } = textarea
      const selected = value.slice(start, end)

      if (selected) {
        // Toggle inline code backticks on selection
        sourceToggleWrap(textarea, '`', '`')
      } else {
        // Insert fenced code block
        const before = value.slice(0, start)
        const after = value.slice(end)
        const needsNewlineBefore = before.length > 0 && !before.endsWith('\n') ? '\n' : ''
        const needsNewlineAfter = after.length > 0 && !after.startsWith('\n') ? '\n' : ''
        const block = `${needsNewlineBefore}\`\`\`\n\n\`\`\`${needsNewlineAfter}`
        const newValue = before + block + after
        // Place cursor inside the code block (after opening ```)
        const cursorPos = before.length + needsNewlineBefore.length + 4 // after ```\n
        sourceApply(textarea, newValue, cursorPos)
      }
      return
    }

    // Rich text mode
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      if (!selection.isCollapsed()) {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
        return
      }

      const anchorNode = selection.anchor.getNode()
      const codeBlock = anchorNode.getParent()

      if (codeBlock && $isCodeNode(codeBlock)) {
        const text = codeBlock.getTextContent()
        const paragraph = $createParagraphNode()
        if (text) {
          paragraph.append($createTextNode(text))
        }
        codeBlock.replace(paragraph)
        paragraph.selectEnd()
      } else {
        $setBlocksType(selection, () => $createCodeNode())
      }
    })
    editor.focus()
  }, [editor, showSource, sourceTextareaRef, sourceToggleWrap, sourceApply])

  // Handle list indent / outdent. Both surfaces confine the change to list
  // items: Markdown can't represent an indented paragraph, so indenting one
  // would look right until the next save quietly dropped it.
  const handleIndentClick = useCallback(
    (direction: 'indent' | 'outdent') => {
      // Source mode: shift the selected lines in the textarea directly
      if (showSource && sourceTextareaRef?.current) {
        const textarea = sourceTextareaRef.current
        const state = {
          value: textarea.value,
          start: textarea.selectionStart,
          end: textarea.selectionEnd,
        }
        const unit = detectListIndentUnit(textarea.value)
        const result =
          direction === 'indent'
            ? indentSourceLines(state, unit)
            : outdentSourceLines(state, unit)
        sourceApply(textarea, result.value, result.cursor)
        return
      }

      // Rich text mode: the command handler no-ops outside a list
      editor.dispatchCommand(
        direction === 'indent' ? INDENT_LIST_ITEM_COMMAND : OUTDENT_LIST_ITEM_COMMAND,
        undefined,
      )
      editor.focus()
    },
    [editor, showSource, sourceTextareaRef, sourceApply],
  )

  // Prevent toolbar buttons from stealing focus/selection from the editor
  const preventFocusLoss = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  // Handle delimiter button click. Both editing surfaces route through the same
  // pure transforms (lib/chat/text-transforms): source mode applies the result
  // to the textarea; rich-text mode dispatches APPLY_DELIMITER_COMMAND, whose
  // handler runs the very same transforms inside the Lexical editor.
  const handleDelimiterClick = useCallback(
    (delimiter: TemplateDelimiter) => {
      // Source mode: apply the matching transform to the textarea by kind.
      if (showSource && sourceTextareaRef?.current) {
        const textarea = sourceTextareaRef.current
        const state = { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd }
        let result
        if (delimiter.kind === 'linePrefix') {
          result = toggleLinePrefix(state, delimiter.marker)
        } else if (delimiter.kind === 'tagPrefix') {
          result = insertTagPrefix(state, delimiter.open, delimiter.close)
        } else {
          const { prefix, suffix } = delimiterToPrefixSuffix(delimiter)
          result = toggleWrap(state, prefix, suffix)
        }
        sourceApply(textarea, result.value, result.cursor)
        return
      }

      // Rich text mode: a single dispatch; the command handler dispatches by kind.
      editor.dispatchCommand(APPLY_DELIMITER_COMMAND, delimiter)
      editor.focus()
    },
    [editor, showSource, sourceTextareaRef, sourceApply]
  )

  // Build the narration button from delimiters, and filter out any template
  // delimiter buttons whose delimiters match the narration delimiters
  const { narrationButton, filteredDelimiters } = useMemo(() => {
    if (!narrationDelimiters) {
      return {
        narrationButton: null,
        filteredDelimiters: template?.delimiters ?? [],
      }
    }

    const narPrefix = Array.isArray(narrationDelimiters) ? narrationDelimiters[0] : narrationDelimiters
    const narSuffix = Array.isArray(narrationDelimiters) ? narrationDelimiters[1] : narrationDelimiters

    const btn: TemplateDelimiter = {
      kind: 'wrap',
      name: 'Narration',
      buttonName: 'Nar',
      delimiters: narrationDelimiters,
      style: 'qt-chat-narration',
    }

    // Remove any template delimiter whose delimiters match the narration delimiters
    const filtered = (template?.delimiters ?? []).filter((d) => {
      const { prefix, suffix } = delimiterToPrefixSuffix(d)
      return prefix !== narPrefix || suffix !== narSuffix
    })

    return { narrationButton: btn, filteredDelimiters: filtered }
  }, [narrationDelimiters, template])

  const allDelimiters = narrationButton
    ? [narrationButton, ...filteredDelimiters]
    : filteredDelimiters
  const hasDelimiters = !loadingTemplate && allDelimiters.length > 0

  return (
    <div className="qt-formatting-toolbar">
      {/* Markdown buttons - always shown */}
      <div className="qt-formatting-toolbar-section">
        {MARKDOWN_FORMATS.map((format) => (
          <button
            key={format.type}
            type="button"
            onMouseDown={preventFocusLoss}
            onClick={() => handleMarkdownClick(format)}
            disabled={disabled}
            className={`qt-formatting-button qt-formatting-button-${format.type}`}
            title={format.tooltip}
          >
            {format.label}
          </button>
        ))}
        <button
          type="button"
          onMouseDown={preventFocusLoss}
          onClick={() => handleIndentClick('outdent')}
          disabled={disabled}
          className="qt-formatting-button qt-formatting-button-outdent"
          title="Outdent list item (Shift+Tab)"
          aria-label="Outdent list item"
        >
          {'⇤'}
        </button>
        <button
          type="button"
          onMouseDown={preventFocusLoss}
          onClick={() => handleIndentClick('indent')}
          disabled={disabled}
          className="qt-formatting-button qt-formatting-button-indent"
          title="Indent list item (Tab)"
          aria-label="Indent list item"
        >
          {'⇥'}
        </button>
        <button
          type="button"
          onMouseDown={preventFocusLoss}
          onClick={handleCodeBlockClick}
          disabled={disabled}
          className={`qt-formatting-button qt-formatting-button-code-block${inCodeBlock ? ' qt-formatting-button-active' : ''}`}
          title={inCodeBlock ? 'End code block' : 'Insert code block'}
        >
          {inCodeBlock ? '/CODE' : 'CODE'}
        </button>
      </div>

      {/* RP template buttons - only shown when template has delimiters */}
      {hasDelimiters && (
        <>
          <div className="qt-formatting-toolbar-divider" />
          <div className="qt-formatting-toolbar-section">
            {allDelimiters.map((delimiter, index) => (
              <button
                key={`${delimiter.buttonName}-${index}`}
                type="button"
                onMouseDown={preventFocusLoss}
                onClick={() => handleDelimiterClick(delimiter)}
                disabled={disabled}
                className="qt-rp-annotation-button"
                title={getDelimiterTooltip(delimiter)}
              >
                {delimiter.buttonName}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Emoji picker — its own section, after the RP delimiters.
          NOT gated by the composerEmoji setting: that flag governs the automatic
          `:` trigger, which is the part that can surprise. An explicit button
          press never can. */}
      <div className="qt-formatting-toolbar-divider" />
      <div className="qt-formatting-toolbar-section relative">
        <button
          ref={emojiButtonRef}
          type="button"
          onMouseDown={preventFocusLoss}
          onClick={() => setEmojiPickerOpen((open) => !open)}
          disabled={disabled}
          className={`qt-formatting-button qt-formatting-button-emoji${emojiPickerOpen ? ' qt-formatting-button-active' : ''}`}
          title="Insert emoji (or type `:` and a name)"
          aria-label="Insert emoji"
          aria-haspopup="dialog"
          aria-expanded={emojiPickerOpen}
        >
          {'☺'}
        </button>
        {emojiPickerOpen && (
          <EmojiPickerPopover
            onClose={() => setEmojiPickerOpen(false)}
            editor={editor}
            toggleRef={emojiButtonRef}
          />
        )}
      </div>

      {/* Source mode toggle - always at the end */}
      {onToggleSource && (
        <>
          <div className="qt-formatting-toolbar-divider" />
          <div className="qt-formatting-toolbar-section">
            <button
              type="button"
              onMouseDown={preventFocusLoss}
              onClick={onToggleSource}
              disabled={disabled}
              className={`qt-formatting-button qt-formatting-button-source ${showSource ? 'qt-formatting-button-active' : ''}`}
              title={showSource ? 'Switch to rich text editor' : 'Edit markdown source'}
              aria-label={showSource ? 'Switch to rich text editor' : 'Edit markdown source'}
              aria-pressed={showSource}
            >
              {showSource ? (
                // Rich text icon when source mode is active
                <Icon name="pencil" className="w-4 h-4" />
              ) : (
                // Code/source icon when in rich text mode
                <Icon name="code" className="w-4 h-4" />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
