'use client'

/**
 * useDocumentMode - State management for Document Mode (Scriptorium Phase 3.5)
 *
 * Manages a chat's set of **open documents** — several may be open at once, each
 * surfacing as its own tab in the tabbed workspace — plus per-document autosave,
 * baseline tracking, and LLM-edit reconciliation. The legacy single-pane
 * `/salon/[id]` route drives the same hook through the "focused document"
 * conveniences (`documentMode`, `activeDocument`, `toggleFocusMode`).
 *
 * @module app/salon/[id]/hooks/useDocumentMode
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatAutosaveNotification } from '@/lib/doc-edit/unified-diff'
import { showErrorToast } from '@/lib/toast'
import type { Chat, Message } from '../types'
import {
  closeDocumentForChat,
  deleteDocumentForChat,
  fetchOpenDocumentRecords,
  fetchChatDocumentState,
  openDocumentForChat,
  persistChatDocumentState,
  readDocumentContentForChat,
  renameDocumentForChat,
  requestDocumentWrite,
  toActiveDocument,
} from './documentModeApi'

export interface ActiveDocument {
  id: string
  filePath: string
  scope: 'project' | 'document_store' | 'general'
  mountPoint?: string | null
  displayTitle: string
  content: string
  mtime?: number
}

export type DocumentMode = 'normal' | 'split' | 'focus'

export interface FocusRequest {
  anchor?: string
  highlight?: string
  line?: number
  clear_focus?: boolean
}

/**
 * A doc_focus instruction surfaced from the LLM tool result, carrying the
 * identity of the document it targets so the matching pane (and only that one)
 * reacts when several documents are open.
 */
export interface DocFocusTarget extends FocusRequest {
  chatDocumentId?: string
  filePath?: string
  scope?: string
  mountPoint?: string | null
}

/**
 * One open document plus its per-pane editor state. `document.id` is the
 * chat_documents row id and the stable key everything is addressed by.
 */
export interface OpenDocEntry {
  document: ActiveDocument
  isDirty: boolean
  isSaving: boolean
  isLLMEditing: boolean
  contentVersion: number
  attentionTop: number | null
  focusRequest: FocusRequest | null
}

interface UseDocumentModeParams {
  chatId: string
  chat: Chat | null
  /** Called when the server posts a Librarian announcement (document open or save) so the UI can append it to the chat */
  onLibrarianMessage?: (message: Message) => void
}

interface OpenDocumentParams {
  filePath?: string
  title?: string
  scope?: 'project' | 'document_store' | 'general'
  mountPoint?: string
  mode?: 'split' | 'focus'
  /**
   * For new blank documents (no filePath), the folder relative to the scope
   * root where the document should be created. Server picks an unused
   * "Untitled Document.md" name inside this folder.
   */
  targetFolder?: string
}

export interface UseDocumentModeReturn {
  // ---- Open-document collection ----
  openDocs: OpenDocEntry[]
  focusedDocId: string | null
  setFocusedDoc: (docId: string) => void
  /** True while any document is open. */
  documentActive: boolean

  // ---- Per-document operations (addressed by chat_documents row id) ----
  openDocument: (params: OpenDocumentParams) => Promise<ActiveDocument | null>
  /** Close one document; omit `docId` to close the focused document (legacy route). */
  closeDocument: (docId?: string) => Promise<void>
  renameDocument: (docId: string, newTitle: string) => Promise<void>
  deleteDocument: (docId: string) => Promise<void>
  handleContentChange: (docId: string, content: string) => void
  flushSave: (docId: string) => void
  saveDocument: (docId: string) => Promise<void>
  setDocAttentionTop: (docId: string, top: number | null) => void
  clearDocFocusRequest: (docId: string) => void

  // ---- LLM / server reconciliation ----
  /** Re-read content of every open document after the LLM finishes a turn. */
  handleLLMEditEnd: () => Promise<void>
  /** Reload the open-document set + each document's content from the server. */
  reloadFromServer: () => Promise<void>
  /** Route an LLM doc_focus to the matching open document's pane. */
  handleDocFocus: (target: DocFocusTarget) => void

  // ---- Shared ----
  /** Scroll position persistence keyed by file path. */
  getScrollPosition: (filePath: string) => number
  setScrollPosition: (filePath: string, pos: number) => void
  /** A document's content as of its last save (the diff/changed-line baseline). */
  getBaselineContent: (docId: string) => string

  // ---- Focused-document conveniences (legacy single-pane route + shortcuts) ----
  documentMode: DocumentMode
  activeDocument: ActiveDocument | null
  dividerPosition: number
  setDividerPosition: (position: number) => void
  toggleFocusMode: () => void
}

const AUTOSAVE_DEBOUNCE_MS = 30000

function isMarkdownDocument(document: Pick<ActiveDocument, 'filePath'>): boolean {
  const dot = document.filePath.lastIndexOf('.')
  if (dot < 0) return false
  const ext = document.filePath.slice(dot).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

function getDocumentModeState(
  source: Partial<{ documentMode: DocumentMode; dividerPosition: number }> | null | undefined,
): { mode: DocumentMode; dividerPosition: number } {
  return {
    mode: (source?.documentMode as DocumentMode) || 'normal',
    dividerPosition: source?.dividerPosition ?? 45,
  }
}

/**
 * Map an open-document error from the API into a single-line user-facing
 * message. The server returns a JSON body whose `error` field is the raw
 * message; if parsing fails, we fall back to the original text.
 */
function friendlyOpenDocumentError(
  rawMessage: string,
  filePath: string | undefined,
  title: string | undefined,
): string {
  let serverMessage = rawMessage
  try {
    const parsed = JSON.parse(rawMessage) as { error?: string }
    if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
      serverMessage = parsed.error
    }
  } catch {
    // rawMessage isn't JSON — leave it alone.
  }

  if (/^File not found/i.test(serverMessage)) {
    const target = filePath || title
    return target
      ? `Couldn't open "${target}" — file not found. It may have been deleted or renamed.`
      : "Couldn't open document — file not found."
  }
  return serverMessage || "Couldn't open document."
}

export function useDocumentMode({ chatId, chat, onLibrarianMessage }: UseDocumentModeParams): UseDocumentModeReturn {
  const [openDocs, setOpenDocs] = useState<OpenDocEntry[]>([])
  const [focusedDocId, setFocusedDocId] = useState<string | null>(null)
  const [documentMode, setDocumentMode] = useState<DocumentMode>('normal')
  const [dividerPosition, setDividerPositionState] = useState(45)

  // Per-document refs keyed by chat_documents row id. Mirror the single-doc
  // hook's refs, one slot per open document.
  const contentRefs = useRef(new Map<string, string>())
  // Last-saved content per doc, to distinguish real edits from Lexical re-sync.
  const savedContentRefs = useRef(new Map<string, string>())
  const autosaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // When true, the next handleContentChange for this doc is Lexical's
  // post-remount re-serialization and is adopted as the baseline, not flagged dirty.
  const absorbNextRefs = useRef(new Map<string, boolean>())
  // Scroll position map keyed by file path — persists across document re-opens.
  const scrollPositionsRef = useRef(new Map<string, number>())

  // Latest-value mirrors so memoized callbacks can read current state without
  // resubscribing (and stay stable for the per-pane binding components).
  const openDocsRef = useRef<OpenDocEntry[]>([])
  const focusedDocIdRef = useRef<string | null>(null)
  const onLibrarianMessageRef = useRef(onLibrarianMessage)

  useEffect(() => { openDocsRef.current = openDocs }, [openDocs])
  useEffect(() => { focusedDocIdRef.current = focusedDocId }, [focusedDocId])
  useEffect(() => { onLibrarianMessageRef.current = onLibrarianMessage }, [onLibrarianMessage])

  const clearTimerFor = useCallback((docId: string) => {
    const t = autosaveTimers.current.get(docId)
    if (t) {
      clearTimeout(t)
      autosaveTimers.current.delete(docId)
    }
  }, [])

  const updateEntry = useCallback((docId: string, updater: (e: OpenDocEntry) => OpenDocEntry) => {
    setOpenDocs(prev => prev.map(e => (e.document.id === docId ? updater(e) : e)))
  }, [])

  const persistChatState = useCallback(async (updates: Partial<{ documentMode: DocumentMode; dividerPosition: number }>) => {
    try {
      await persistChatDocumentState(chatId, updates)
    } catch (error) {
      console.error('[DocumentMode] Failed to persist chat document state', error)
    }
  }, [chatId])

  const persistMode = useCallback((mode: DocumentMode) => {
    void persistChatState({ documentMode: mode })
  }, [persistChatState])

  const persistDividerPosition = useCallback((position: number) => {
    void persistChatState({ dividerPosition: position })
  }, [persistChatState])

  const applyChatState = useCallback((source: Partial<{ documentMode: DocumentMode; dividerPosition: number }> | null | undefined) => {
    const { mode, dividerPosition } = getDocumentModeState(source)
    setDocumentMode(mode)
    setDividerPositionState(dividerPosition)
    return mode
  }, [])

  const readDocumentContent = useCallback(async (
    filePath: string,
    scope: ActiveDocument['scope'],
    mountPoint?: string | null,
  ) => {
    return readDocumentContentForChat(chatId, { filePath, scope, mountPoint })
  }, [chatId])

  /**
   * Load (or refresh) a document's content into its entry. Mirrors the
   * single-doc `applyDocumentState`: resets the dirty baseline and, when
   * `incrementVersion`, bumps `contentVersion` so the Lexical editor remounts
   * and the first re-serialization is absorbed as the new baseline.
   */
  const applyDocContent = useCallback((doc: ActiveDocument, incrementVersion = true) => {
    const content = doc.content || ''
    contentRefs.current.set(doc.id, content)
    savedContentRefs.current.set(doc.id, content)
    // Empty content has nothing for Lexical to re-serialize, so its editor may
    // never emit the post-remount change the absorb flag waits for — a lingering
    // flag would then swallow the user's first real edit as the "saved"
    // baseline (showing Saved without ever writing).
    absorbNextRefs.current.set(doc.id, incrementVersion ? isMarkdownDocument(doc) && content !== '' : false)

    setOpenDocs(prev => {
      const buildEntry = (existing?: OpenDocEntry): OpenDocEntry => ({
        document: doc,
        isDirty: false,
        isSaving: existing?.isSaving ?? false,
        isLLMEditing: existing?.isLLMEditing ?? false,
        contentVersion: incrementVersion ? (existing?.contentVersion ?? 0) + 1 : (existing?.contentVersion ?? 0),
        attentionTop: existing?.attentionTop ?? null,
        focusRequest: existing?.focusRequest ?? null,
      })
      if (prev.some(e => e.document.id === doc.id)) {
        return prev.map(e => (e.document.id === doc.id ? buildEntry(e) : e))
      }
      return [...prev, buildEntry()]
    })
  }, [])

  /** Remove a document's entry + refs and repair the focused-document pointer. */
  const removeEntry = useCallback((docId: string) => {
    clearTimerFor(docId)
    contentRefs.current.delete(docId)
    savedContentRefs.current.delete(docId)
    absorbNextRefs.current.delete(docId)

    const order = openDocsRef.current
    const idx = order.findIndex(e => e.document.id === docId)
    const remaining = order.filter(e => e.document.id !== docId)

    setOpenDocs(prev => prev.filter(e => e.document.id !== docId))

    if (focusedDocIdRef.current === docId) {
      const neighbor = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
      setFocusedDocId(neighbor ? neighbor.document.id : null)
    }
  }, [clearTimerFor])

  // ---- Save / edit (per document) ----------------------------------------

  const saveDocument = useCallback(async (docId: string) => {
    const entry = openDocsRef.current.find(e => e.document.id === docId)
    if (!entry || !entry.isDirty) return
    const doc = entry.document

    setOpenDocs(prev => prev.map(e => (e.document.id === docId ? { ...e, isSaving: true } : e)))
    try {
      // Generate the diff client-side so the server can post a single Librarian
      // save announcement with the human-readable diff in the same round-trip.
      const oldContentForDiff = savedContentRefs.current.get(docId) ?? ''
      const newContentForDiff = contentRefs.current.get(docId) ?? ''
      const diffContent = oldContentForDiff !== newContentForDiff
        ? formatAutosaveNotification(
            oldContentForDiff,
            newContentForDiff,
            doc.displayTitle || doc.filePath,
          ) || undefined
        : undefined

      const res = await requestDocumentWrite(chatId, {
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        content: newContentForDiff,
        mtime: doc.mtime,
        diffContent,
      })

      if (res.status === 409) {
        // The file was written elsewhere (likely the LLM) while we had it open.
        // Re-read the disk content. If the user has no pending edits, silently
        // adopt the server version; otherwise keep the unsaved content and just
        // refresh mtime so the next save can succeed.
        const localContent = contentRefs.current.get(docId) ?? ''
        const hadLocalEdits = localContent !== (savedContentRefs.current.get(docId) ?? '')
        try {
          const latest = await readDocumentContent(doc.filePath, doc.scope, doc.mountPoint)
          if (!hadLocalEdits) {
            applyDocContent({ ...doc, content: latest.content || '', mtime: latest.mtime })
          } else {
            updateEntry(docId, e => ({ ...e, document: { ...e.document, mtime: latest.mtime } }))
          }
          console.warn('[DocumentMode] Document changed on disk during save; reloaded mtime', {
            filePath: doc.filePath,
            hadLocalEdits,
          })
        } catch (reloadError) {
          console.warn('[DocumentMode] Failed to reload document after save conflict', reloadError)
        }
        return
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        console.warn('[DocumentMode] Failed to save document', { status: res.status, body: bodyText })
        return
      }

      const data = await res.json()
      savedContentRefs.current.set(docId, newContentForDiff)
      updateEntry(docId, e => ({ ...e, isDirty: false, document: { ...e.document, mtime: data.mtime } }))

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to save document', error)
    } finally {
      setOpenDocs(prev => prev.map(e => (e.document.id === docId ? { ...e, isSaving: false } : e)))
    }
  }, [chatId, readDocumentContent, applyDocContent, updateEntry])

  const handleContentChange = useCallback((docId: string, content: string) => {
    contentRefs.current.set(docId, content)
    updateEntry(docId, e => ({ ...e, document: { ...e.document, content } }))

    // First change after an external state load is Lexical's normalized
    // re-serialization of the just-loaded content. Adopt it as the saved
    // baseline so the status reads "Saved" and byte-exact comparisons work.
    if (absorbNextRefs.current.get(docId)) {
      absorbNextRefs.current.set(docId, false)
      savedContentRefs.current.set(docId, content)
      updateEntry(docId, e => ({ ...e, isDirty: false }))
      return
    }

    if (content === (savedContentRefs.current.get(docId) ?? '')) {
      updateEntry(docId, e => ({ ...e, isDirty: false }))
      return
    }

    updateEntry(docId, e => ({ ...e, isDirty: true }))

    // Debounce autosave.
    clearTimerFor(docId)
    autosaveTimers.current.set(docId, setTimeout(() => {
      saveDocument(docId)
    }, AUTOSAVE_DEBOUNCE_MS))
  }, [updateEntry, clearTimerFor, saveDocument])

  const flushSave = useCallback((docId: string) => {
    clearTimerFor(docId)
    const entry = openDocsRef.current.find(e => e.document.id === docId)
    if (entry?.isDirty) {
      saveDocument(docId)
    }
  }, [clearTimerFor, saveDocument])

  // ---- Open / close / rename / delete ------------------------------------

  const openDocument = useCallback(async (params: OpenDocumentParams): Promise<ActiveDocument | null> => {
    const targetMode = params.mode || 'split'

    try {
      const data = await openDocumentForChat(chatId, {
        filePath: params.filePath,
        title: params.title,
        scope: params.scope || 'project',
        mountPoint: params.mountPoint,
        mode: targetMode,
        targetFolder: params.targetFolder,
      })

      const doc: ActiveDocument = toActiveDocument(data.document, data.content || '', data.mtime)

      applyDocContent(doc)
      setFocusedDocId(doc.id)
      setDocumentMode(targetMode)

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }

      return doc
    } catch (error) {
      // Surface to the user as a toast and log without console.error so we don't
      // trigger Next's red-screen overlay for a recoverable miss (e.g. the
      // picker pointed at a file since deleted from the vault).
      const rawMessage = error instanceof Error ? error.message : String(error)
      const toastMessage = friendlyOpenDocumentError(rawMessage, params.filePath, params.title)
      showErrorToast(toastMessage)
      console.warn('[DocumentMode] Failed to open document', { rawMessage, params })
      return null
    }
  }, [applyDocContent, chatId])

  const closeDocument = useCallback(async (docId?: string) => {
    const targetId = docId ?? focusedDocIdRef.current
    if (!targetId) return

    const entry = openDocsRef.current.find(e => e.document.id === targetId)
    if (entry?.isDirty) {
      await saveDocument(targetId)
    }

    try {
      await closeDocumentForChat(chatId, targetId)
    } catch (error) {
      console.error('[DocumentMode] Failed to close document', error)
    }

    removeEntry(targetId)

    // documentMode only returns to 'normal' once the last document closes.
    const remaining = openDocsRef.current.filter(e => e.document.id !== targetId)
    if (remaining.length === 0) {
      setDocumentMode('normal')
      await persistMode('normal')
    }
  }, [chatId, saveDocument, removeEntry, persistMode])

  const renameDocument = useCallback(async (docId: string, newTitle: string) => {
    const entry = openDocsRef.current.find(e => e.document.id === docId)
    if (!entry) return
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === entry.document.displayTitle) return

    if (entry.isDirty) {
      await saveDocument(docId)
    }

    try {
      const data = await renameDocumentForChat(chatId, trimmed, docId)
      updateEntry(docId, e => ({
        ...e,
        document: {
          ...e.document,
          filePath: data.document.filePath,
          displayTitle: data.document.displayTitle || data.document.filePath,
        },
      }))

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to rename document', error)
    }
  }, [chatId, saveDocument, updateEntry])

  const deleteDocument = useCallback(async (docId: string) => {
    const entry = openDocsRef.current.find(e => e.document.id === docId)
    if (!entry) return

    clearTimerFor(docId)

    try {
      const data = await deleteDocumentForChat(chatId, docId)

      removeEntry(docId)
      const remaining = openDocsRef.current.filter(e => e.document.id !== docId)
      if (remaining.length === 0) {
        setDocumentMode('normal')
      }

      const notifyLibrarian = onLibrarianMessageRef.current
      if (notifyLibrarian && data.librarianMessage) {
        notifyLibrarian(data.librarianMessage as Message)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to delete document', error)
    }
  }, [chatId, clearTimerFor, removeEntry])

  // ---- LLM / server reconciliation ---------------------------------------

  /**
   * Reconcile the open-document set against the server: drop documents the
   * server no longer reports open, add ones it newly reports, and refresh the
   * content of those that changed on disk. Unsaved (dirty) panes are left
   * untouched so a background reload never clobbers the user's edits.
   */
  const reconcileOpenDocuments = useCallback(async () => {
    try {
      const openList = await fetchOpenDocumentRecords(chatId)
      const serverDocs = openList.documents
      const serverIds = new Set(serverDocs.map(d => d.id))

      // Remove documents the server no longer reports open.
      for (const e of openDocsRef.current) {
        if (!serverIds.has(e.document.id)) removeEntry(e.document.id)
      }

      // Add new documents and refresh changed content.
      for (const rec of serverDocs) {
        const existing = openDocsRef.current.find(e => e.document.id === rec.id)
        if (existing?.isDirty) continue
        const contentData = await readDocumentContent(rec.filePath, rec.scope, rec.mountPoint)
        const fresh = contentData.content || ''
        if (existing && fresh === (savedContentRefs.current.get(rec.id) ?? '')) {
          // Unchanged on disk — just refresh mtime/title without a remount.
          updateEntry(rec.id, e => ({
            ...e,
            document: {
              ...e.document,
              mtime: contentData.mtime,
              displayTitle: rec.displayTitle || e.document.displayTitle,
            },
          }))
          continue
        }
        applyDocContent(toActiveDocument(rec, fresh, contentData.mtime))
      }

      const focused = focusedDocIdRef.current
      if (!focused || !serverIds.has(focused)) {
        setFocusedDocId(serverDocs.length ? serverDocs[serverDocs.length - 1].id : null)
      }
    } catch (error) {
      console.error('[DocumentMode] Failed to reconcile open documents', error)
    }
  }, [chatId, readDocumentContent, applyDocContent, removeEntry, updateEntry])

  const reloadFromServer = useCallback(async () => {
    try {
      const chatData = await fetchChatDocumentState(chatId)
      applyChatState(chatData.chat)
      await reconcileOpenDocuments()
    } catch (error) {
      console.error('[DocumentMode] Failed to reload from server', error)
    }
  }, [chatId, applyChatState, reconcileOpenDocuments])

  // Refetch every open document's content after the LLM finishes a turn. Skips
  // dirty panes so pending user edits aren't lost.
  const handleLLMEditEnd = useCallback(async () => {
    for (const entry of openDocsRef.current) {
      if (entry.isDirty) continue
      const doc = entry.document
      try {
        const data = await readDocumentContent(doc.filePath, doc.scope, doc.mountPoint)
        const fresh = data.content || ''
        if (fresh !== (savedContentRefs.current.get(doc.id) ?? '')) {
          applyDocContent({ ...doc, content: fresh, mtime: data.mtime })
        } else {
          updateEntry(doc.id, e => ({ ...e, document: { ...e.document, mtime: data.mtime } }))
        }
      } catch (error) {
        console.warn('[DocumentMode] Failed to refetch document after LLM edit', error)
      }
    }
  }, [readDocumentContent, applyDocContent, updateEntry])

  // ---- Focus / attention --------------------------------------------------

  /** Resolve which open document a doc_focus targets, by id then path. */
  const resolveTargetDocId = useCallback((target: DocFocusTarget): string | null => {
    const docs = openDocsRef.current
    if (target.chatDocumentId && docs.some(e => e.document.id === target.chatDocumentId)) {
      return target.chatDocumentId
    }
    if (target.filePath) {
      const match = docs.find(e =>
        e.document.filePath === target.filePath &&
        (target.scope === undefined || e.document.scope === target.scope) &&
        (target.mountPoint === undefined || (e.document.mountPoint ?? null) === (target.mountPoint ?? null)),
      )
      if (match) return match.document.id
    }
    return focusedDocIdRef.current ?? (docs.length ? docs[docs.length - 1].document.id : null)
  }, [])

  const handleDocFocus = useCallback((target: DocFocusTarget): void => {
    const docId = resolveTargetDocId(target)
    if (!docId) return

    if (target.clear_focus) {
      updateEntry(docId, e => ({ ...e, attentionTop: null, focusRequest: null }))
      return
    }

    // Don't eagerly set attentionTop — DocumentFocusPlugin resolves the target
    // and calls back after scrolling. Bring the document to the foreground.
    updateEntry(docId, e => ({
      ...e,
      focusRequest: { anchor: target.anchor, highlight: target.highlight, line: target.line },
    }))
    setFocusedDocId(docId)
  }, [resolveTargetDocId, updateEntry])

  const setDocAttentionTop = useCallback((docId: string, top: number | null): void => {
    updateEntry(docId, e => ({ ...e, attentionTop: top }))
  }, [updateEntry])

  const clearDocFocusRequest = useCallback((docId: string): void => {
    updateEntry(docId, e => ({ ...e, focusRequest: null }))
  }, [updateEntry])

  // ---- Scroll position helpers -------------------------------------------

  const getScrollPosition = useCallback((filePath: string): number => {
    return scrollPositionsRef.current.get(filePath) ?? 0
  }, [])

  const setScrollPosition = useCallback((filePath: string, pos: number): void => {
    scrollPositionsRef.current.set(filePath, pos)
  }, [])

  const getBaselineContent = useCallback((docId: string): string => {
    return savedContentRefs.current.get(docId) ?? ''
  }, [])

  // ---- Layout (legacy single-pane conveniences) --------------------------

  const setFocusedDoc = useCallback((docId: string) => {
    setFocusedDocId(docId)
  }, [])

  const toggleFocusMode = useCallback(() => {
    const newMode = documentMode === 'focus' ? 'split' : 'focus'
    setDocumentMode(newMode)
    persistMode(newMode)
  }, [documentMode, persistMode])

  const setDividerPosition = useCallback((position: number) => {
    setDividerPositionState(position)
    persistDividerPosition(position)
  }, [persistDividerPosition])

  // ---- Initialization / cleanup ------------------------------------------

  // Initialize from chat data when it loads, and re-reconcile when the server's
  // documentMode changes (e.g. an LLM open/close persisted the flag).
  useEffect(() => {
    if (!chat) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; contract predates the query migration
    const mode = applyChatState(chat)
    if (mode !== 'normal') {
      void reconcileOpenDocuments()
    } else {
      for (const e of openDocsRef.current) removeEntry(e.document.id)
      setOpenDocs([])
      setFocusedDocId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyChatState, chat?.documentMode, chat?.dividerPosition])

  // Cleanup all autosave timers on unmount.
  useEffect(() => {
    const timers = autosaveTimers.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  // External qtap:// opens (from non-Salon surfaces) resolve through the API;
  // when they land, reconcile this chat's open-document set and focus the new
  // row so the pane appears immediately without a manual reload.
  useEffect(() => {
    const onQtapDocumentOpened = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId?: string; chatDocumentId?: string }>).detail
      if (!detail || detail.chatId !== chatId) return

      void reconcileOpenDocuments().then(() => {
        if (detail.chatDocumentId) {
          setFocusedDocId(detail.chatDocumentId)
        }
      })
    }

    window.addEventListener('qtap-document-opened', onQtapDocumentOpened as EventListener)
    return () => {
      window.removeEventListener('qtap-document-opened', onQtapDocumentOpened as EventListener)
    }
  }, [chatId, reconcileOpenDocuments])

  const focusedDocument =
    openDocs.find(e => e.document.id === focusedDocId)?.document ?? openDocs[0]?.document ?? null

  return {
    openDocs,
    focusedDocId,
    setFocusedDoc,
    documentActive: openDocs.length > 0,
    openDocument,
    closeDocument,
    renameDocument,
    deleteDocument,
    handleContentChange,
    flushSave,
    saveDocument,
    setDocAttentionTop,
    clearDocFocusRequest,
    handleLLMEditEnd,
    reloadFromServer,
    handleDocFocus,
    getScrollPosition,
    setScrollPosition,
    getBaselineContent,
    documentMode,
    activeDocument: focusedDocument,
    dividerPosition,
    setDividerPosition,
    toggleFocusMode,
  }
}
