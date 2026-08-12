'use client'

/**
 * StandaloneDocumentView — a chat-less Document Mode workspace tab.
 *
 * Renders one {@link DocumentPane} bound to the standalone documents API
 * (`/api/v1/documents?action=…`) instead of a chat's document actions. No
 * chat_documents row exists and no Librarian announcement is posted — the tab's
 * payload is the only record of the open, so saving or closing here never
 * notifies a Salon conversation.
 *
 * Mirrors the per-document mechanics of `useDocumentMode` (30s autosave
 * debounce, flush on blur, absorb-first-serialization baseline, 409 conflict
 * reload) for a single document.
 *
 * @module components/workspace/StandaloneDocumentView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import DocumentPane from '@/app/salon/[id]/components/DocumentPane'
import type { ActiveDocument } from '@/app/salon/[id]/hooks/useDocumentMode'
import type { DocumentStandaloneTabPayload } from '@/lib/workspace/types'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { useCloseSelfTab } from '@/components/workspace/useCloseSelfTab'
import { showErrorToast } from '@/lib/toast'

const AUTOSAVE_DEBOUNCE_MS = 30000

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function postDocumentsAction(action: string, body: unknown): Promise<Response> {
  return fetch(`/api/v1/documents?action=${action}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

/** Pull the server's `error` field out of a failed response, if present. */
async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data.error === 'string' && data.error.length > 0) return data.error
  } catch {
    // Non-JSON body — use the fallback.
  }
  return fallback
}

function isMarkdownPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return false
  const ext = filePath.slice(dot).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

export function StandaloneDocumentView({ payload }: { payload: DocumentStandaloneTabPayload }) {
  const { openTab } = useWorkspace()
  const closeSelf = useCloseSelfTab()

  const [doc, setDoc] = useState<ActiveDocument | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
  // Content at open / last save — the dirty comparison and gutter-diff baseline.
  const [baselineContent, setBaselineContent] = useState('')

  // Live mirrors so the memoized save/close callbacks read current values.
  const docRef = useRef<ActiveDocument | null>(null)
  const isDirtyRef = useRef(false)
  const contentRef = useRef('')
  const savedContentRef = useRef('')
  // When true, the next content change is Lexical's post-remount
  // re-serialization and is adopted as the baseline, not flagged dirty.
  const absorbNextRef = useRef(false)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollPositionsRef = useRef(new Map<string, number>())
  // The in-flight open request, shared across effect re-runs (StrictMode runs
  // the mount effect twice in dev — without this, a blank open would CREATE
  // two untitled documents).
  const openRequestRef = useRef<Promise<{
    document: { filePath: string; scope: ActiveDocument['scope']; mountPoint?: string | null; displayTitle?: string }
    content?: string
    mtime?: number
  }> | null>(null)

  useEffect(() => { docRef.current = doc }, [doc])
  useEffect(() => { isDirtyRef.current = isDirty }, [isDirty])

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  /** Load (or reload) content into the pane, resetting the dirty baseline. */
  const adoptDocument = useCallback((next: ActiveDocument) => {
    const content = next.content || ''
    contentRef.current = content
    savedContentRef.current = content
    // Empty content has nothing for Lexical to re-serialize, so its editor may
    // never emit the post-remount change the absorb flag waits for — a lingering
    // flag would then swallow the user's first real edit as the "saved"
    // baseline (showing Saved without ever writing).
    absorbNextRef.current = isMarkdownPath(next.filePath) && content !== ''
    setBaselineContent(content)
    setIsDirty(false)
    setDoc(next)
    setContentVersion(v => v + 1)
  }, [])

  /**
   * Refresh this tab's payload/title in the workspace store. Same-identity
   * openTab with `focus: false` updates in place — crucial for blank documents,
   * whose persisted payload must gain the server-picked filePath so a reload
   * reopens the real file instead of minting another untitled one.
   */
  const refreshTab = useCallback((filePath: string, displayTitle: string) => {
    openTab(
      'document-standalone',
      { ...payload, filePath, displayTitle } satisfies DocumentStandaloneTabPayload,
      { focus: false, title: displayTitle },
    )
  }, [openTab, payload])

  // Open (or create) the document once on mount. The tab is kept alive across
  // tab switches, so this runs once per workspace session. The request itself
  // is minted at most once (openRequestRef) so StrictMode's double effect run
  // can't create two blank documents; each run just (re)binds the handlers.
  useEffect(() => {
    let cancelled = false
    if (!openRequestRef.current) {
      openRequestRef.current = (async () => {
        const res = await postDocumentsAction('open-document', {
          filePath: payload.filePath,
          title: payload.displayTitle,
          scope: payload.scope,
          mountPoint: payload.mountPoint ?? undefined,
          targetFolder: payload.targetFolder,
        })
        if (!res.ok) {
          throw new Error(await responseError(res, "Couldn't open document."))
        }
        return res.json()
      })()
    }
    openRequestRef.current
      .then((data) => {
        if (cancelled) return
        adoptDocument({
          id: payload.docKey,
          filePath: data.document.filePath,
          scope: data.document.scope,
          mountPoint: data.document.mountPoint,
          displayTitle: data.document.displayTitle || data.document.filePath,
          content: data.content || '',
          mtime: data.mtime,
        })
        refreshTab(data.document.filePath, data.document.displayTitle || data.document.filePath)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[StandaloneDocument] Failed to open document', { message, payload })
        setLoadError(message)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once on mount; the payload identity is fixed for this tab
  }, [])

  const saveDocument = useCallback(async () => {
    const current = docRef.current
    if (!current || !isDirtyRef.current) return

    setIsSaving(true)
    try {
      const content = contentRef.current
      const res = await postDocumentsAction('write-document', {
        filePath: current.filePath,
        scope: current.scope,
        mountPoint: current.mountPoint ?? undefined,
        content,
        mtime: current.mtime,
      })

      if (res.status === 409) {
        // The file was written elsewhere while we had it open. Re-read the
        // disk content: with no pending edits, silently adopt the disk
        // version; otherwise keep the unsaved content and just refresh mtime
        // so the next save can succeed.
        const hadLocalEdits = contentRef.current !== savedContentRef.current
        try {
          const readRes = await postDocumentsAction('read-document', {
            filePath: current.filePath,
            scope: current.scope,
            mountPoint: current.mountPoint ?? undefined,
          })
          if (readRes.ok) {
            const latest = await readRes.json()
            if (!hadLocalEdits) {
              adoptDocument({ ...current, content: latest.content || '', mtime: latest.mtime })
            } else {
              setDoc(prev => (prev ? { ...prev, mtime: latest.mtime } : prev))
            }
          }
          console.warn('[StandaloneDocument] Document changed on disk during save; reloaded mtime', {
            filePath: current.filePath,
            hadLocalEdits,
          })
        } catch (reloadError) {
          console.warn('[StandaloneDocument] Failed to reload document after save conflict', reloadError)
        }
        return
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        console.warn('[StandaloneDocument] Failed to save document', { status: res.status, body: bodyText })
        return
      }

      const data = await res.json()
      savedContentRef.current = content
      setBaselineContent(content)
      setIsDirty(false)
      setDoc(prev => (prev ? { ...prev, mtime: data.mtime } : prev))
    } catch (error) {
      console.error('[StandaloneDocument] Failed to save document', error)
    } finally {
      setIsSaving(false)
    }
  }, [adoptDocument])

  const handleContentChange = useCallback((content: string) => {
    contentRef.current = content
    setDoc(prev => (prev ? { ...prev, content } : prev))

    // First change after an external load is Lexical's normalized
    // re-serialization of the just-loaded content. Adopt it as the saved
    // baseline so the status reads "Saved" and byte-exact comparisons work.
    if (absorbNextRef.current) {
      absorbNextRef.current = false
      savedContentRef.current = content
      setBaselineContent(content)
      setIsDirty(false)
      return
    }

    if (content === savedContentRef.current) {
      setIsDirty(false)
      return
    }

    setIsDirty(true)
    clearAutosaveTimer()
    autosaveTimerRef.current = setTimeout(() => {
      void saveDocument()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [clearAutosaveTimer, saveDocument])

  const flushSave = useCallback(() => {
    clearAutosaveTimer()
    if (isDirtyRef.current) {
      void saveDocument()
    }
  }, [clearAutosaveTimer, saveDocument])

  const handleTitleChange = useCallback(async (newTitle: string) => {
    const current = docRef.current
    if (!current) return
    const trimmed = newTitle.trim()
    if (!trimmed || trimmed === current.displayTitle) return

    if (isDirtyRef.current) {
      await saveDocument()
    }

    try {
      const res = await postDocumentsAction('rename-document', {
        filePath: current.filePath,
        scope: current.scope,
        mountPoint: current.mountPoint ?? undefined,
        newTitle: trimmed,
      })
      if (!res.ok) {
        showErrorToast(await responseError(res, "Couldn't rename document."))
        return
      }
      const data = await res.json()
      const renamed = {
        filePath: data.document.filePath as string,
        displayTitle: (data.document.displayTitle as string) || (data.document.filePath as string),
      }
      // Carry the scroll position across the file-path key change.
      const scrollPos = scrollPositionsRef.current.get(current.filePath)
      if (scrollPos !== undefined) {
        scrollPositionsRef.current.set(renamed.filePath, scrollPos)
      }
      setDoc(prev => (prev ? { ...prev, ...renamed } : prev))
      refreshTab(renamed.filePath, renamed.displayTitle)
    } catch (error) {
      console.error('[StandaloneDocument] Failed to rename document', error)
    }
  }, [saveDocument, refreshTab])

  const handleCloseDocument = useCallback(async () => {
    clearAutosaveTimer()
    if (isDirtyRef.current) {
      await saveDocument()
    }
    closeSelf()
  }, [clearAutosaveTimer, saveDocument, closeSelf])

  const handleDeleteDocument = useCallback(async () => {
    const current = docRef.current
    if (!current) return
    clearAutosaveTimer()
    try {
      const res = await postDocumentsAction('delete-document', {
        filePath: current.filePath,
        scope: current.scope,
        mountPoint: current.mountPoint ?? undefined,
      })
      if (!res.ok) {
        showErrorToast(await responseError(res, "Couldn't delete document."))
        return
      }
      closeSelf()
    } catch (error) {
      console.error('[StandaloneDocument] Failed to delete document', error)
    }
  }, [clearAutosaveTimer, closeSelf])

  const getScrollPosition = useCallback((filePath: string): number => {
    return scrollPositionsRef.current.get(filePath) ?? 0
  }, [])

  const setScrollPosition = useCallback((filePath: string, pos: number): void => {
    scrollPositionsRef.current.set(filePath, pos)
  }, [])

  // The workspace hides (never unmounts) inactive tabs, so unmount here means
  // the tab was closed or the workspace was left — flush the timer.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [])

  const noop = useCallback(() => {}, [])

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <p className="qt-text-primary font-medium">This document could not be opened.</p>
        <p className="qt-text-secondary text-sm max-w-md">{loadError}</p>
        <button
          type="button"
          className="qt-button-secondary px-3 py-1.5 rounded-md text-sm"
          onClick={() => closeSelf()}
        >
          Close tab
        </button>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="qt-text-muted text-sm">Fetching the manuscript…</p>
      </div>
    )
  }

  return (
    <DocumentPane
      document={doc}
      mode="split"
      isDirty={isDirty}
      isSaving={isSaving}
      isLLMEditing={false}
      contentVersion={contentVersion}
      baselineContent={baselineContent}
      getScrollPosition={getScrollPosition}
      setScrollPosition={setScrollPosition}
      onContentChange={handleContentChange}
      onBlur={flushSave}
      onFlushSave={flushSave}
      onToggleFocusMode={noop}
      onCloseDocument={handleCloseDocument}
      onDeleteDocument={handleDeleteDocument}
      onTitleChange={handleTitleChange}
    />
  )
}
