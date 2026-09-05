'use client'

import { useRef, useState, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import ComposerGutterTools from '@/components/chat/ComposerGutterTools'
import { SpeakingAsAvatar } from './SpeakingAsAvatar'
import type { AvatarImageSource } from '@/components/ui/Avatar'
import { QuillAnimation } from '@/components/chat/QuillAnimation'
import { LexicalComposerWrapper } from '@/components/chat/lexical'
import type { ComposerEditorHandle } from '@/components/chat/lexical'
import type { AttachedFile, PendingToolResult } from '../types'
import type { RenderingPattern, DialogueDetection, NarrationDelimiters } from '@/lib/schemas/template.types'

// Platform detection for keyboard shortcuts
const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

interface ChatComposerProps {
  id: string
  /**
   * External markdown value (draft restore / resend / post-send clear and the
   * source-mode textarea). NOT updated on every keystroke — the Lexical editor
   * owns the live text. Use the editor handle (`inputRef`) to read it for send.
   */
  input: string
  setInput: (value: string) => void
  /** Whether the composer currently holds non-blank content (drives Send). */
  hasContent: boolean
  /** Debounced editor content-presence reporter (wired to the page). */
  onContentChange: (hasContent: boolean) => void
  /** Debounced full-markdown emit for draft persistence. */
  onPersistDraft?: (markdown: string) => void
  attachedFiles: AttachedFile[]
  onRemoveAttachedFile: (fileId: string) => void
  /** Pending tool results to display in composer */
  pendingToolResults: PendingToolResult[]
  /** Remove a pending tool result */
  onRemovePendingToolResult: (id: string) => void
  /** External ref for the editor, enabling parent components to focus it */
  inputRef?: React.MutableRefObject<ComposerEditorHandle | null>
  disabled: boolean
  sending: boolean
  hasActiveCharacters: boolean
  streaming: boolean
  waitingForResponse: boolean
  /** Current response generation status */
  responseStatus?: {
    stage: string
    message: string
    toolName?: string
    characterName?: string
  } | null
  showSource: boolean
  setShowSource: (show: boolean) => void
  uploadingFile: boolean
  toolExecutionStatus: { tool: string; status: 'pending' | 'success' | 'error'; message: string } | null
  /** Dismiss the tool-execution notice early; it also self-expires once settled. */
  onDismissToolExecutionStatus: () => void
  /** Patterns for styling roleplay text in preview */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling in preview */
  dialogueDetection?: DialogueDetection | null
  roleplayTemplateId?: string | null
  /** Whether document editing mode is enabled */
  documentEditingMode: boolean
  /** Toggle document editing mode on/off */
  onToggleDocumentEditingMode: () => void
  /** Callback to open the document picker for Document Mode */
  onOpenDocumentClick?: () => void
  /** Whether Document Mode is currently active (split/focus) */
  isDocumentModeActive?: boolean

  // Callbacks
  onSubmit: (e: React.FormEvent) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onAttachFileClick?: () => void
  onImagePaste: (file: File) => Promise<void>
  onLibraryFileClick: () => void
  onStandaloneGenerateImageClick: () => void
  onInsertAnnouncementClick: () => void
  onComposeMailClick: () => void
  onStopStreaming: () => void
  /** Hide the stop button (when sidebar has its own stop button) */
  hideStopButton?: boolean
  /** Callback when a pending tool result is added */
  onPendingToolResult?: (result: Omit<PendingToolResult, 'id' | 'createdAt'>) => void
  /** Whether this chat resolves a non-empty Pascal custom-tool roster */
  customToolsAvailable?: boolean
  /** Callback after a custom tool runs, so the chat can refetch */
  onCustomToolRan?: () => void
  /** Current roleplay template narration delimiters (e.g. '*' or ['[', ']']) */
  narrationDelimiters?: NarrationDelimiters
  /** Callback to open a new terminal session */
  onOpenTerminalClick?: () => void
  /** Whether Terminal Mode is currently active (hides the open-terminal button) */
  isTerminalModeActive?: boolean
  /**
   * The character the human is currently speaking as — rendered as a persistent
   * full-height portrait directly left of the toolbar cluster. Null when the
   * human plays no character (e.g. an all-LLM room).
   */
  speakingAs?: {
    name: string
    title?: string | null
    character?: AvatarImageSource | null
  } | null
}

export function ChatComposer({
  id,
  input,
  setInput,
  hasContent,
  onContentChange,
  onPersistDraft,
  attachedFiles,
  onRemoveAttachedFile,
  pendingToolResults,
  onRemovePendingToolResult,
  disabled,
  sending,
  hasActiveCharacters,
  streaming,
  waitingForResponse,
  responseStatus,
  showSource,
  setShowSource,
  uploadingFile,
  toolExecutionStatus,
  onDismissToolExecutionStatus,
  renderingPatterns: _renderingPatterns,
  dialogueDetection: _dialogueDetection,
  roleplayTemplateId,
  documentEditingMode,
  onToggleDocumentEditingMode,
  onOpenDocumentClick,
  isDocumentModeActive,
  inputRef: externalInputRef,
  onSubmit,
  onFileSelect,
  onAttachFileClick,
  onImagePaste,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  onInsertAnnouncementClick,
  onComposeMailClick,
  onStopStreaming,
  hideStopButton = false,
  onPendingToolResult,
  customToolsAvailable,
  onCustomToolRan,
  narrationDelimiters,
  onOpenTerminalClick,
  isTerminalModeActive,
  speakingAs,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)
  // Track the Lexical editor instance in state so it's available during render
  // (refs can't be read during render in React 19)
  const [lexicalEditor, setLexicalEditor] = useState<import('lexical').LexicalEditor | null>(null)

  // Sync external ref with internal editor ref
  const setEditorRef = useCallback(
    (handle: ComposerEditorHandle | null) => {
      editorRef.current = handle
      if (externalInputRef) {
        externalInputRef.current = handle
      }
    },
    [externalInputRef],
  )

  // Handler that triggers the file input click
  const handleAttachFileClick = () => {
    fileInputRef.current?.click()
    onAttachFileClick?.()
  }

  // Submit handler: the editor owns the live text, so we just dispatch the
  // form submit — the page's onSubmit reads markdown straight from the editor
  // handle (`getMarkdown()`), which is why we no longer round-trip through
  // setInput here (that was the per-keystroke re-render source).
  const handleEditorSubmit = useCallback(() => {
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (markdown.trim() || attachedFiles.length > 0 || pendingToolResults.length > 0) {
      const form = document.querySelector<HTMLFormElement>(`#composer-form-${id}`)
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true }))
        setTimeout(() => {
          editorRef.current?.focus({ preventScroll: true })
        }, 10)
      }
    }
  }, [id, attachedFiles.length, pendingToolResults.length])

  // Capture the Lexical editor instance when the wrapper mounts
  const composerRefCallback = useCallback(
    (handle: ComposerEditorHandle | null) => {
      setEditorRef(handle)
      setLexicalEditor(handle?.getEditor() ?? null)
    },
    [setEditorRef],
  )

  return (
    <div className="qt-chat-composer">
      {/* No active characters warning */}
      {!hasActiveCharacters && (
        <div className="qt-alert qt-alert-warning flex items-center gap-3">
          <Icon name="alert-triangle" className="w-5 h-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm">No characters in this chat</p>
            <p className="text-xs opacity-80 mt-0.5">
              Add a character to continue the conversation.
            </p>
          </div>
        </div>
      )}

      <div className="qt-chat-composer-content">
        {/* Tool execution status indicator */}
        {toolExecutionStatus && (
          <div
            role="status"
            aria-live="polite"
            className={`qt-alert flex items-center gap-2 ${
              toolExecutionStatus.status === 'pending'
                ? 'qt-alert-info'
                : toolExecutionStatus.status === 'success'
                  ? 'qt-alert-success'
                  : 'qt-alert-error'
            }`}
          >
            {toolExecutionStatus.status === 'pending' ? (
              <svg className="w-5 h-5 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            ) : toolExecutionStatus.status === 'success' ? (
              <Icon name="check-circle" className="w-5 h-5 flex-shrink-0" />
            ) : (
              <Icon name="alert-circle" className="w-5 h-5 flex-shrink-0" />
            )}
            <span className="qt-label flex-1">{toolExecutionStatus.message}</span>
            <button
              type="button"
              onClick={onDismissToolExecutionStatus}
              className="qt-button-ghost flex-shrink-0 p-1"
              title="Dismiss"
              aria-label="Dismiss notice"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Response status indicator */}
        {responseStatus && (
          <div
            className="qt-chat-response-status"
            data-stage={responseStatus.stage}
            role="status"
            aria-live="polite"
          >
            <div className="qt-chat-response-status-icon">
              {responseStatus.stage === 'streaming' ? (
                <QuillAnimation size="sm" label={null} />
              ) : (
                <svg className="w-4 h-4 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" opacity="0.3" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              )}
            </div>
            <span className="qt-chat-response-status-text">
              {responseStatus.message}
            </span>
          </div>
        )}

        {/* Attached files and pending tool results preview */}
        {(attachedFiles.length > 0 || pendingToolResults.length > 0) && (
          <div className="qt-chat-attachment-list mb-2">
            {/* Attached files */}
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className="qt-chat-attachment-chip"
              >
                {file.mimeType.startsWith('image/') ? (
                  <Icon name="image" className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-success" />
                ) : (
                  <Icon name="file" className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info" />
                )}
                <span className="text-foreground max-w-[150px] truncate">
                  {file.filename}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachedFile(file.id)}
                  className="qt-chat-attachment-chip-remove"
                  title="Remove attachment"
                >
                  <Icon name="close" className="w-4 h-4" />
                </button>
              </div>
            ))}

            {/* Pending tool results */}
            {pendingToolResults.map((result) => (
              <div
                key={result.id}
                className="qt-chat-tool-result-chip group relative"
                title={`${result.requestPrompt}\n\n${result.formattedResult}`}
              >
                <span className="text-base leading-none">{result.icon}</span>
                <span className="text-foreground max-w-[200px] truncate">
                  {result.summary}
                </span>
                <button
                  type="button"
                  onClick={() => onRemovePendingToolResult(result.id)}
                  className="qt-chat-attachment-chip-remove"
                  title="Remove tool result"
                >
                  <Icon name="close" className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Formatting toolbar - shown above the form when document editing mode is enabled */}
        {documentEditingMode && lexicalEditor && (
          <FormattingToolbar
            roleplayTemplateId={roleplayTemplateId}
            editor={lexicalEditor}
            disabled={sending || !hasActiveCharacters}
            showSource={showSource}
            sourceTextareaRef={sourceTextareaRef}
            setInput={setInput}
            onToggleSource={() => {
              if (showSource) {
                // Leaving source mode — push textarea edits into Lexical.
                editorRef.current?.setMarkdown(input)
              } else {
                // Entering source mode — seed the textarea from the editor's
                // live content (page `input` lags while typing in rich mode).
                setInput(editorRef.current?.getMarkdown() ?? '')
              }
              setShowSource(!showSource)
            }}
            narrationDelimiters={narrationDelimiters}
          />
        )}

        <form id={`composer-form-${id}`} onSubmit={onSubmit} className="qt-chat-composer-inner">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={onFileSelect}
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
            className="hidden"
          />

          {/* "Speaking as" portrait — full-height, directly left of the toolbar
              cluster; hidden on the narrowest viewports where there's no room.
              The outer wrapper owns the responsive show/hide so it doesn't
              collide with the avatar's own display utility. */}
          {speakingAs && (
            <div className="hidden sm:flex self-stretch flex-shrink-0">
              <SpeakingAsAvatar
                name={speakingAs.name}
                title={speakingAs.title}
                src={speakingAs.character}
                canType={hasActiveCharacters && !sending && !streaming && !waitingForResponse}
              />
            </div>
          )}

          {/* Left side toolbar - gutter tools, then main toolbar buttons */}
          <div className="qt-chat-toolbar-row">
            <div className="qt-composer-gutter-column">
            {/* Gutter tools - Attach, Generate, RNG */}
            <ComposerGutterTools
              onAttachFileClick={handleAttachFileClick}
              uploadingFile={uploadingFile}
              onLibraryFileClick={onLibraryFileClick}
              onStandaloneGenerateImageClick={onStandaloneGenerateImageClick}
              onInsertAnnouncementClick={onInsertAnnouncementClick}
              onComposeMailClick={onComposeMailClick}
              chatId={id}
              onPendingToolResult={onPendingToolResult}
              customToolsAvailable={customToolsAvailable}
              onCustomToolRan={onCustomToolRan}
              disabled={sending || !hasActiveCharacters}
            />
            </div>

            {/* Main toolbar buttons - composition mode, document, terminal */}
            <div className="qt-chat-toolbar">
              {/* Composition mode toggle button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDocumentEditingMode()
                }}
                className={`qt-chat-toolbar-button ${documentEditingMode ? 'qt-chat-toolbar-button-active' : ''}`}
                title={documentEditingMode
                  ? `Switch to chat mode (Enter to send)`
                  : `Switch to composition mode (${isMac ? 'Cmd' : 'Ctrl'}+Enter to send)`}
              >
                <Icon name="file" className="w-5 h-5" />
              </button>

              {/* Open Document button — stays available even with documents
                  already open, so the user can keep adding more. */}
              {onOpenDocumentClick && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDocumentClick()
                  }}
                  className="qt-chat-toolbar-button qt-doc-open-button"
                  title={isDocumentModeActive
                    ? 'Open another document'
                    : `Open document (${isMac ? 'Cmd' : 'Ctrl'}+Shift+D)`}
                >
                  <Icon name="pencil" className="w-5 h-5" />
                </button>
              )}

              {/* Open Terminal button */}
              {onOpenTerminalClick && !isTerminalModeActive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenTerminalClick()
                  }}
                  className="qt-chat-toolbar-button"
                  title="Open terminal"
                >
                  <Icon name="code" className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {showSource && (
            <textarea
              ref={sourceTextareaRef}
              className="qt-chat-composer-input qt-source-mode-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending || !hasActiveCharacters}
              style={{ lineHeight: '1.5' }}
            />
          )}
          {/* Keep Lexical mounted but hidden during source mode to preserve undo history */}
          <div className="flex-1 min-w-0 self-stretch" style={showSource ? { display: 'none' } : undefined}>
            <LexicalComposerWrapper
              ref={composerRefCallback}
              input={input}
              onContentChange={onContentChange}
              onPersistDraft={onPersistDraft}
              suspendSync={showSource}
              onSubmit={handleEditorSubmit}
              onImagePaste={onImagePaste}
              documentEditingMode={documentEditingMode}
              disabled={sending || !hasActiveCharacters}
              placeholder={!hasActiveCharacters ? "Add a character to start chatting..." : attachedFiles.length > 0 ? "Add a message (optional)..." : ""}
            />
          </div>

          {/* Right side buttons */}
          {(streaming || waitingForResponse) && !hideStopButton ? (
            /* Stop button - shown during streaming/waiting (hidden when sidebar has its own) */
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onStopStreaming()
              }}
              className="qt-chat-composer-send qt-chat-stop-button"
              title="Stop generating"
            >
              <Icon name="stop" className="w-5 h-5" />
            </button>
          ) : (
            /* Send button - disabled while generating when stop is in sidebar */
            <button
              type="submit"
              disabled={sending || (streaming || waitingForResponse) || (!hasContent && attachedFiles.length === 0 && pendingToolResults.length === 0) || !hasActiveCharacters}
              className="qt-chat-composer-send"
              title={!hasActiveCharacters ? "Add a character to start chatting" : (streaming || waitingForResponse) ? "Generating..." : "Send message"}
            >
              <Icon name="send" className="w-5 h-5" />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
