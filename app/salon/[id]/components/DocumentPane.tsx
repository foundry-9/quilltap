'use client'

/**
 * DocumentPane - Split-panel document editor for Document Mode
 *
 * Contains the document header, formatting toolbar, Lexical editor,
 * and status bar. Sits in the right side of the SplitLayout.
 *
 * Scriptorium Phase 3.5
 *
 * @module app/salon/[id]/components/DocumentPane
 */

import { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import DocumentGutter, { type LinePosition } from './DocumentGutter'
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
import YAML from 'yaml'
import { composerTheme } from '@/components/chat/lexical/theme'
import { MarkdownBridgePlugin, COMPOSER_TRANSFORMERS } from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'
import { FormattingCommandPlugin } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import { TextReplacementPlugin } from '@/components/chat/lexical/plugins/TextReplacementPlugin'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import DocumentChangeTracker from './DocumentChangeTracker'
import DocumentFocusPlugin from './DocumentFocusPlugin'
import { showConfirmation } from '@/lib/alert'
import { formatQtapUri } from '@/lib/doc-edit/qtap-uri'
import { showSuccessToast } from '@/lib/toast'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'
import type { ActiveDocument, DocumentMode, FocusRequest } from '../hooks/useDocumentMode'

interface DocumentPaneProps {
  document: ActiveDocument
  mode: DocumentMode
  isDirty: boolean
  isSaving: boolean
  isLLMEditing: boolean
  /** Increments on each external content load to force editor remount */
  contentVersion: number
  roleplayTemplateId?: string | null
  /** Pixel offset from content top where AI attention eye sits; null when unset */
  attentionTop?: number | null
  /** Content at document open / last save — used to diff changed lines for the gutter */
  baselineContent: string
  getScrollPosition: (filePath: string) => number
  setScrollPosition: (filePath: string, pos: number) => void
  onContentChange: (content: string) => void
  onBlur: () => void
  onFlushSave: () => void
  onToggleFocusMode: () => void
  onCloseDocument: () => void
  onDeleteDocument: () => void
  onTitleChange?: (title: string) => void
  /** doc_focus tool request from the LLM */
  focusRequest?: FocusRequest | null
  onFocusResolved?: (pixelTop: number) => void
  onFocusCleared?: () => void
  onFocusProcessed?: () => void
}

/**
 * Word count utility
 */
function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * True for files we want to edit as Markdown with Lexical. Everything else
 * (JSON, YAML, plain text, source code, etc.) renders in a plain textarea
 * so its bytes are not round-tripped through a Markdown serializer.
 */
function isMarkdownFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return false
  const ext = filePath.slice(dot).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

interface ExtractedFrontmatter {
  rawBlock: string | null
  body: string
  data: Record<string, unknown>
}

function parseLooseFrontmatterData(yamlContent: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmed.slice(0, colonIndex).trim()
    const value = trimmed.slice(colonIndex + 1).trim()
    if (!key) continue
    data[key] = value || '\u2014'
  }
  return data
}

function extractFrontmatter(content: string): ExtractedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!match) {
    return {
      rawBlock: null,
      body: content,
      data: {},
    }
  }

  const rawBlock = match[0]
  const yamlContent = match[1]
  const body = content.slice(rawBlock.length)

  try {
    const parsed = YAML.parse(yamlContent)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        rawBlock,
        body,
        data: parsed as Record<string, unknown>,
      }
    }
  } catch {
    // If YAML parsing fails, fall back to a line-based view so metadata still appears.
  }

  return {
    rawBlock,
    body,
    data: parseLooseFrontmatterData(yamlContent),
  }
}

function frontmatterValueToText(value: unknown): string {
  if (value === null || value === undefined) return '\u2014'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toChipValues(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value
      .map((item) => frontmatterValueToText(item).trim())
      .filter(Boolean)
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null

  const inlineItems = trimmed.slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  return inlineItems.length > 0 ? inlineItems : null
}

function FrontmatterTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  return (
    <div className="qt-frontmatter">
      <div className="qt-frontmatter-title">Document Info</div>
      <table className="qt-frontmatter-table">
        <tbody>
          {entries.length > 0 ? entries.map(([key, value]) => {
            const chipValues = toChipValues(value)
            return (
              <tr key={key}>
                <th>{key}</th>
                <td>
                  {chipValues ? (
                    <div className="qt-frontmatter-chip-list">
                      {chipValues.map((chipValue, index) => (
                        <span key={`${key}-${chipValue}-${index}`} className="qt-badge qt-badge-tag">{chipValue}</span>
                      ))}
                    </div>
                  ) : (
                    <span>{frontmatterValueToText(value)}</span>
                  )}
                </td>
              </tr>
            )
          }) : (
            <tr>
              <th>frontmatter</th>
              <td>\u2014</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Inner editor plugins that need Lexical context
 */
function DocumentEditorPlugins({
  content,
  onContentChange,
  disabled,
  baselineContent,
  onChangedLines,
  onLinePositions,
  scrollContainerRef,
  focusRequest,
  onFocusResolved,
  onFocusCleared,
  onFocusProcessed,
}: {
  content: string
  onContentChange: (content: string) => void
  disabled: boolean
  baselineContent: string
  onChangedLines: (lines: Set<number>) => void
  onLinePositions: (positions: LinePosition[], totalHeight: number) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  focusRequest?: FocusRequest | null
  onFocusResolved?: (pixelTop: number) => void
  onFocusCleared?: () => void
  onFocusProcessed?: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const { data: chatSettings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<{ composerSpellcheck?: boolean }>('/api/v1/settings/chat', { signal }),
  })
  const spellCheck = chatSettings?.composerSpellcheck ?? true

  // Sync editable state
  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="qt-doc-editor-area qt-lexical-contenteditable"
            aria-label="Document editor"
            style={{ lineHeight: '1.6', minHeight: '100%' }}
            spellCheck={spellCheck}
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
        input={content}
        setInput={onContentChange}
        initialMarkdown={content}
        preserveAsterisks
        preserveUnderscores
        preserveBackticks
        preserveTildes
      />
      <FormattingCommandPlugin />
      <TextReplacementPlugin />
      <DocumentChangeTracker
        baselineContent={baselineContent}
        onChangedLines={onChangedLines}
        onLinePositions={onLinePositions}
      />
      {focusRequest !== undefined && onFocusResolved && onFocusCleared && onFocusProcessed && (
        <DocumentFocusPlugin
          focusRequest={focusRequest ?? null}
          scrollContainerRef={scrollContainerRef}
          onFocusResolved={onFocusResolved}
          onFocusCleared={onFocusCleared}
          onFocusProcessed={onFocusProcessed}
        />
      )}
    </>
  )
}

/**
 * Toolbar wrapper that can access the Lexical editor context
 */
function DocumentToolbarWrapper({
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
  onContentChange: (content: string) => void
  onToggleSource: () => void
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

export default function DocumentPane({
  document,
  mode,
  isDirty,
  isSaving,
  isLLMEditing,
  contentVersion,
  roleplayTemplateId,
  attentionTop = null,
  baselineContent,
  getScrollPosition,
  setScrollPosition,
  onContentChange,
  onBlur,
  onFlushSave,
  onToggleFocusMode,
  onCloseDocument,
  onDeleteDocument,
  onTitleChange,
  focusRequest,
  onFocusResolved,
  onFocusCleared,
  onFocusProcessed,
}: DocumentPaneProps) {
  // In the tabbed workspace each document is already its own (maximizable) tab,
  // so the split/focus toggle is redundant there; keep it only on the legacy
  // single-pane `/salon/[id]` route (where this is null).
  const inWorkspace = useWorkspaceTabId() != null

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [editTitle, setEditTitle] = useState(document.displayTitle)
  const [uriCopied, setUriCopied] = useState(false)
  // Gutter state — populated by DocumentChangeTracker plugin
  const [changedLines, setChangedLines] = useState<Set<number>>(new Set())
  const [linePositions, setLinePositions] = useState<LinePosition[]>([])
  const [totalHeight, setTotalHeight] = useState(0)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isMarkdown = useMemo(() => isMarkdownFile(document.filePath), [document.filePath])
  const extractedContent = useMemo(() => {
    if (!isMarkdown) {
      return {
        current: {
          rawBlock: null,
          body: document.content,
          data: {},
        },
        baseline: {
          rawBlock: null,
          body: baselineContent,
          data: {},
        },
      }
    }

    return {
      current: extractFrontmatter(document.content),
      baseline: extractFrontmatter(baselineContent),
    }
  }, [isMarkdown, document.content, baselineContent])
  const currentFrontmatterRawBlock = extractedContent.current.rawBlock
  const currentBodyContent = extractedContent.current.body
  const baselineBodyContent = extractedContent.baseline.body
  const hasFrontmatter = currentFrontmatterRawBlock !== null
  const wordCount = useMemo(
    () => countWords(isMarkdown ? currentBodyContent : document.content),
    [isMarkdown, currentBodyContent, document.content],
  )
  const documentUri = useMemo(() => {
    if (document.scope === 'project' || document.scope === 'general') {
      return formatQtapUri({
        scope: document.scope,
        path: document.filePath,
      })
    }

    return formatQtapUri({
      scope: 'document_store',
      mountPoint: document.mountPoint?.trim() || 'self',
      path: document.filePath,
    })
  }, [document.scope, document.mountPoint, document.filePath])

  // Stable callbacks for DocumentChangeTracker — avoid re-registering the update listener
  const handleChangedLines = useCallback((lines: Set<number>) => {
    setChangedLines(lines)
  }, [])

  const handleLinePositions = useCallback((positions: LinePosition[], height: number) => {
    setLinePositions(positions)
    setTotalHeight(height)
  }, [])

  const initialConfig = useMemo(
    () => ({
      namespace: 'DocumentEditor',
      theme: composerTheme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode, TableNode, TableCellNode, TableRowNode],
      editable: !isLLMEditing,
      onError: (error: Error) => {
        console.error('[DocumentPane] Editor error:', error)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Sync editTitle with document prop when not actively editing
  useEffect(() => {
    if (!isEditingTitle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when document changes
      setEditTitle(document.displayTitle)
    }
  }, [document.displayTitle, isEditingTitle])

  useEffect(() => {
    if (!isEditingTitle) {
      return
    }

    const frame = requestAnimationFrame(() => titleInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [isEditingTitle])

  const toggleSourceMode = useCallback(() => {
    // Leaving source mode: flush any pending edits before Lexical re-parses
    // the markdown, so raw source bytes are persisted before serialization.
    // The flush must run outside the state updater — updaters are pure and
    // may execute during render, which would setState on the parent mid-render.
    if (showSource) onFlushSave()
    setShowSource((prev) => !prev)
  }, [showSource, onFlushSave])

  const handleMarkdownBodyChange = useCallback((updatedBody: string) => {
    if (!currentFrontmatterRawBlock) {
      onContentChange(updatedBody)
      return
    }
    onContentChange(`${currentFrontmatterRawBlock}${updatedBody}`)
  }, [currentFrontmatterRawBlock, onContentChange])

  // Throttled scroll handler — saves position ~100ms after last scroll event
  const handleScroll = useCallback(() => {
    if (scrollThrottleRef.current) return
    scrollThrottleRef.current = setTimeout(() => {
      scrollThrottleRef.current = null
      if (scrollContainerRef.current) {
        setScrollPosition(document.filePath, scrollContainerRef.current.scrollTop)
      }
    }, 100)
  }, [document.filePath, setScrollPosition])

  // Restore scroll position after contentVersion changes (Lexical remount)
  useEffect(() => {
    const savedPos = getScrollPosition(document.filePath)
    if (savedPos > 0 && scrollContainerRef.current) {
      // Double RAF to ensure Lexical has rendered content before we scroll
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedPos
          }
        })
      })
    }
  }, [contentVersion, document.filePath, getScrollPosition])

  // Cleanup throttle timer on unmount
  useEffect(() => {
    return () => {
      if (scrollThrottleRef.current) {
        clearTimeout(scrollThrottleRef.current)
      }
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current)
      }
    }
  }, [])

  // Handle title editing
  const handleTitleClick = useCallback(() => {
    setIsEditingTitle(true)
    setEditTitle(document.displayTitle)
  }, [document.displayTitle])

  const handleTitleSubmit = useCallback(() => {
    setIsEditingTitle(false)
    if (editTitle.trim() && editTitle !== document.displayTitle && onTitleChange) {
      onTitleChange(editTitle.trim())
    }
  }, [editTitle, document.displayTitle, onTitleChange])

  const handleDeleteClick = useCallback(async () => {
    const confirmed = await showConfirmation(
      `Delete "${document.displayTitle}"? This removes the underlying file and cannot be undone.`,
    )
    if (!confirmed) return
    onDeleteDocument()
  }, [document.displayTitle, onDeleteDocument])

  const handleCopyUri = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(documentUri)
      setUriCopied(true)
      showSuccessToast('Document URL copied')
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current)
      }
      copyResetRef.current = setTimeout(() => {
        setUriCopied(false)
      }, 1200)
    } catch (error) {
      console.error('[DocumentPane] Failed to copy document URI', error)
      setUriCopied(false)
    }
  }, [documentUri])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
      setEditTitle(document.displayTitle)
    }
  }, [handleTitleSubmit, document.displayTitle])

  // Save status display
  const saveStatus = useMemo(() => {
    if (isSaving) return { label: 'Saving...', dot: 'qt-doc-status-saving' }
    if (isDirty) return { label: 'Unsaved', dot: 'qt-doc-status-saving' }
    return { label: 'Saved', dot: 'qt-doc-status-saved' }
  }, [isSaving, isDirty])

  // Editing indicator
  const editingIndicator = useMemo(() => {
    if (isLLMEditing) return 'AI editing...'
    return null
  }, [isLLMEditing])

  return (
    <div className="flex flex-col h-full">
      {/* Document Header */}
      <div className="qt-doc-header">
        <span className="qt-doc-badge">Document</span>

        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="qt-doc-title-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <span
            className="qt-doc-title cursor-pointer"
            onClick={handleTitleClick}
            title="Click to rename"
          >
            {document.displayTitle}
          </span>
        )}

        <div className="flex items-center gap-1">
          {/* Toggle focus/split — legacy single-pane route only; in the
              workspace the document is its own maximizable tab. */}
          {!inWorkspace && (
            <button
              type="button"
              className="qt-doc-header-button"
              onClick={onToggleFocusMode}
              title={mode === 'focus' ? 'Show chat' : 'Maximize'}
              aria-label={mode === 'focus' ? 'Show chat' : 'Maximize document'}
            >
              {mode === 'focus'
                ? <Icon name="compress" className="w-4 h-4" />
                : <Icon name="expand" className="w-4 h-4" />
              }
            </button>
          )}

          {/* Delete the underlying file */}
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={handleDeleteClick}
            title="Delete document"
            aria-label="Delete document"
          >
            <Icon name="trash" className="w-4 h-4" />
          </button>

          {/* Exit document mode */}
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={onCloseDocument}
            title="Exit document mode"
            aria-label="Exit document mode"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="qt-doc-uri-row">
        <span className="qt-doc-uri-label">URL</span>
        <span className="qt-doc-uri-value" title={documentUri}>{documentUri}</span>
        <button
          type="button"
          className="qt-doc-uri-copy-button"
          onClick={handleCopyUri}
          title={uriCopied ? 'Copied' : 'Copy URL'}
          aria-label={uriCopied ? 'Copied URL' : 'Copy URL'}
        >
          <Icon name="copy" className="w-3.5 h-3.5" />
        </button>
      </div>

      {isMarkdown ? (
        /* Shared editor shell — key forces remount on external content changes */
        <LexicalComposer key={contentVersion} initialConfig={initialConfig}>
          <DocumentToolbarWrapper
            roleplayTemplateId={roleplayTemplateId}
            disabled={isLLMEditing}
            showSource={showSource}
            sourceTextareaRef={sourceTextareaRef}
            onContentChange={onContentChange}
            onToggleSource={toggleSourceMode}
          />

          {showSource ? (
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onBlur={onBlur} onScroll={handleScroll}>
              <textarea
                ref={sourceTextareaRef}
                className="w-full h-full p-4 qt-bg-input qt-text-primary font-mono text-sm resize-none outline-none"
                value={document.content}
                onChange={(e) => onContentChange(e.target.value)}
                disabled={isLLMEditing}
                spellCheck={false}
                style={{ lineHeight: '1.6', minHeight: '100%', backgroundColor: 'var(--color-background)' }}
              />
            </div>
          ) : (
            <div ref={scrollContainerRef} className="qt-doc-editor-with-gutter" onBlur={onBlur} onScroll={handleScroll}>
              <DocumentGutter
                changedLines={changedLines}
                attentionTop={attentionTop}
                linePositions={linePositions}
                totalHeight={totalHeight}
              />
              <div className="flex-1">
                {hasFrontmatter && (
                  <FrontmatterTable data={extractedContent.current.data} />
                )}
                <DocumentEditorPlugins
                  content={currentBodyContent}
                  onContentChange={handleMarkdownBodyChange}
                  disabled={isLLMEditing}
                  baselineContent={baselineBodyContent}
                  onChangedLines={handleChangedLines}
                  onLinePositions={handleLinePositions}
                  scrollContainerRef={scrollContainerRef}
                  focusRequest={focusRequest}
                  onFocusResolved={onFocusResolved}
                  onFocusCleared={onFocusCleared}
                  onFocusProcessed={onFocusProcessed}
                />
              </div>
            </div>
          )}
        </LexicalComposer>
      ) : (
        /* Plain-text editor for non-Markdown files — no Lexical, no markdown
         * bridge, no formatting toolbar. Bytes go straight to/from disk. */
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
          onBlur={onBlur}
          onScroll={handleScroll}
        >
          <textarea
            className="w-full h-full p-4 qt-bg-input qt-text-primary font-mono text-sm resize-none outline-none"
            value={document.content}
            onChange={(e) => onContentChange(e.target.value)}
            disabled={isLLMEditing}
            spellCheck={false}
            style={{ lineHeight: '1.6', minHeight: '100%', backgroundColor: 'var(--color-background)' }}
          />
        </div>
      )}

      {/* Status Bar */}
      <div className="qt-doc-status-bar">
        <span className="qt-doc-status-item">{isMarkdown ? 'Markdown' : 'Plain text'}</span>
        <span className="qt-doc-status-item">{wordCount.toLocaleString()} word{wordCount !== 1 ? 's' : ''}</span>
        <span className="qt-doc-status-item">
          <span className={saveStatus.dot} />
          {saveStatus.label}
        </span>
        {editingIndicator && (
          <span className="qt-doc-status-item ml-auto">{editingIndicator}</span>
        )}
      </div>
    </div>
  )
}
