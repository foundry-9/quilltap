'use client'

/**
 * DocumentPaneBinding — binds one open document to a {@link DocumentPane}.
 *
 * The multi-document hook addresses every operation by chat_documents row id;
 * this thin per-document wrapper closes those id-keyed methods over its own
 * document so the {@link DocumentPane} keeps its clean single-document prop
 * surface. Rendering one binding per open document (each with a stable `key`)
 * also gives every pane its own hook instance, so the bound callbacks stay
 * stable without a loop-of-hooks.
 *
 * @module app/salon/[id]/components/DocumentPaneBinding
 */

import { useCallback } from 'react'
import DocumentPane from './DocumentPane'
import type { OpenDocEntry, DocumentMode, UseDocumentModeReturn } from '../hooks/useDocumentMode'

interface DocumentPaneBindingProps {
  entry: OpenDocEntry
  mode: DocumentMode
  roleplayTemplateId?: string | null
  doc: UseDocumentModeReturn
}

export function DocumentPaneBinding({ entry, mode, roleplayTemplateId, doc }: DocumentPaneBindingProps) {
  const docId = entry.document.id

  const onContentChange = useCallback((content: string) => doc.handleContentChange(docId, content), [doc, docId])
  const onBlur = useCallback(() => doc.flushSave(docId), [doc, docId])
  const onTitleChange = useCallback((title: string) => doc.renameDocument(docId, title), [doc, docId])
  const onCloseDocument = useCallback(() => doc.closeDocument(docId), [doc, docId])
  const onDeleteDocument = useCallback(() => doc.deleteDocument(docId), [doc, docId])
  const onToggleFocusMode = useCallback(() => doc.toggleFocusMode(), [doc])
  const onFocusResolved = useCallback((pixelTop: number) => doc.setDocAttentionTop(docId, pixelTop), [doc, docId])
  const onFocusCleared = useCallback(() => doc.setDocAttentionTop(docId, null), [doc, docId])
  const onFocusProcessed = useCallback(() => doc.clearDocFocusRequest(docId), [doc, docId])

  return (
    <DocumentPane
      document={entry.document}
      mode={mode}
      isDirty={entry.isDirty}
      isSaving={entry.isSaving}
      isLLMEditing={entry.isLLMEditing}
      contentVersion={entry.contentVersion}
      roleplayTemplateId={roleplayTemplateId}
      attentionTop={entry.attentionTop}
      baselineContent={doc.getBaselineContent(docId)}
      getScrollPosition={doc.getScrollPosition}
      setScrollPosition={doc.setScrollPosition}
      onContentChange={onContentChange}
      onBlur={onBlur}
      onFlushSave={onBlur}
      onTitleChange={onTitleChange}
      onToggleFocusMode={onToggleFocusMode}
      onCloseDocument={onCloseDocument}
      onDeleteDocument={onDeleteDocument}
      focusRequest={entry.focusRequest}
      onFocusResolved={onFocusResolved}
      onFocusCleared={onFocusCleared}
      onFocusProcessed={onFocusProcessed}
    />
  )
}
