'use client'

/**
 * WorkbenchEditor — the single-definition editor of Pascal's Workbench.
 *
 * A main form column (identity, parameters, roll, outcome cascade) beside the
 * collapsible proving bench, under a header carrying the source store + path,
 * dirty state, Save / Save As…, and the Form ⇄ JSON switch.
 *
 * The validity gate (§6.1): nothing invalid is ever written. Form mode is
 * valid by construction plus a belt-and-braces `safeParse` before save; JSON
 * mode saves only what parses and validates. The one deliberate exception is
 * repair mode — a file already broken on disk may be saved broken again, with
 * an explicit confirm, because refusing a partial repair would chase the user
 * back to the raw Scriptorium editor.
 *
 * All file I/O goes through the mount-points file routes — the Workbench adds
 * no second write path into stores.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { apiFetch, apiErrorMessage, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { buildMountFileItemUrl } from '@/components/files/mountBlobUrl'
import {
  QtapCustomToolSchema,
  TOOLS_FOLDER,
  TOOL_FILE_SUFFIX,
  collectUnknownKeys,
  displayTitle,
  formatDefinitionIssues,
} from '@/lib/pascal/custom-tool.types'
import {
  draftFromDefinition,
  draftIsValid,
  newDraft,
  serializeDraft,
  validateDraft,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { BuilderForm } from './BuilderForm'
import { OutcomesSection } from './OutcomesSection'
import { ProvingBench } from './ProvingBench'
import { DestinationPicker, type PickedDestination } from './DestinationPicker'

interface WorkbenchEditorProps {
  /** Edit an existing file. */
  source?: { mountPointId: string; path: string }
  /** Create a new definition; `template` pre-fills (duplicate flow, forces save-as). */
  create?: { mountPointId?: string; template?: string }
  onBack: () => void
  /** Open a different definition (the duplicate-name escape hatch). */
  onOpenOther: (mountPointId: string, path: string) => void
}

interface FileEnvelope {
  content: string
  mtime: number
}

/** Debounce a value. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/** {@link apiErrorMessage} with the bench's own fallback. */
function extractErrorMessage(err: unknown): string {
  return apiErrorMessage(err, 'Something went sideways at the bench.')
}

export function WorkbenchEditor({ source, create, onBack, onOpenOther }: Readonly<WorkbenchEditorProps>) {
  const queryClient = useQueryClient()

  // -- Load -----------------------------------------------------------------

  const fileQuery = useQuery({
    queryKey: source ? ['custom-tools', 'file', source.mountPointId, source.path] : ['custom-tools', 'file', 'new'],
    queryFn: ({ signal }) =>
      apiFetch<FileEnvelope>(buildMountFileItemUrl(source!.mountPointId, source!.path), { signal }),
    enabled: Boolean(source),
    staleTime: Infinity,
    gcTime: 0,
  })

  // -- Editor state ---------------------------------------------------------

  const needsContentInit = Boolean(source || create?.template)
  const [initialized, setInitialized] = useState(!needsContentInit)
  const [draft, setDraft] = useState<ToolDraft | null>(() => (needsContentInit ? null : newDraft()))
  const [jsonText, setJsonText] = useState('')
  const [editorMode, setEditorMode] = useState<'form' | 'json'>('form')
  const [repairReason, setRepairReason] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [location, setLocation] = useState<{ mountPointId: string; path: string } | null>(source ?? null)
  const [mtime, setMtime] = useState<number | null>(null)
  const [loadedName, setLoadedName] = useState<string | null>(null)
  const [benchOpen, setBenchOpen] = useState(true)
  const [pickerOpen, setPickerOpen] = useState<'save' | 'save-as' | null>(null)
  const [conflictContent, setConflictContent] = useState<string | null>(null)
  const [flashOutcomeId, setFlashOutcomeId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Seed editor state from raw file bytes (also used by reload-theirs). */
  const initializeFromContent = (content: string, fileMtime: number | null) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      setRepairReason(`This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      setJsonText(content)
      setDraft(null)
      setEditorMode('json')
      setMtime(fileMtime)
      setDirty(false)
      setInitialized(true)
      return
    }

    const validated = QtapCustomToolSchema.safeParse(parsed)
    if (!validated.success) {
      setRepairReason(formatDefinitionIssues(validated.error))
      setJsonText(content)
      setDraft(null)
      setEditorMode('json')
      setMtime(fileMtime)
      setDirty(false)
      setInitialized(true)
      return
    }

    const loaded = draftFromDefinition(parsed)
    setRepairReason(null)
    setDraft(loaded)
    setJsonText(content)
    setEditorMode('form')
    setLoadedName(validated.data.name)
    setMtime(fileMtime)
    setDirty(false)
    setInitialized(true)
  }

  // Initialize once from content, adjusting state during render (React's
  // sanctioned derive-from-props pattern — guarded, so it runs exactly once;
  // see TabView's latch for the precedent).
  if (!initialized) {
    if (source && fileQuery.data) {
      initializeFromContent(fileQuery.data.content, fileQuery.data.mtime)
    } else if (!source && create?.template) {
      initializeFromContent(create.template, null)
      // A duplicate is a copy: it has no location and must save-as.
      setLocation(null)
      setLoadedName(null)
    }
  }

  // -- Derived validation ---------------------------------------------------

  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft])
  const formValid = useMemo(() => (draft ? draftIsValid(draft) : false), [draft])

  const debouncedJson = useDebounced(jsonText, 300)
  const jsonState = useMemo(() => {
    if (editorMode !== 'json') return null
    let parsed: unknown
    try {
      parsed = JSON.parse(debouncedJson)
    } catch (error) {
      return { valid: false as const, issues: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`], unknownKeys: [] as string[] }
    }
    const validated = QtapCustomToolSchema.safeParse(parsed)
    if (!validated.success) {
      return {
        valid: false as const,
        issues: validated.error.issues.map(
          (issue) => `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
        ),
        summary: formatDefinitionIssues(validated.error),
        unknownKeys: collectUnknownKeys(parsed),
      }
    }
    return { valid: true as const, issues: [], unknownKeys: collectUnknownKeys(parsed) }
  }, [editorMode, debouncedJson])

  const unknownKeysInDraft = draft?.unknownKeys.map(([key]) => key) ?? []

  // -- Mode switch ----------------------------------------------------------

  const switchToJson = () => {
    if (draft) setJsonText(serializeDraft(draft))
    setEditorMode('json')
  }

  const switchToForm = () => {
    if (editorMode === 'form') return
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return
    }
    const loaded = draftFromDefinition(parsed)
    if (!loaded) return
    setDraft(loaded)
    setRepairReason(null)
    setEditorMode('form')
  }

  const canSwitchToForm = editorMode === 'json' && jsonState?.valid === true

  // -- Save -----------------------------------------------------------------

  const contentToWrite = (): string | null => {
    if (editorMode === 'form') {
      if (!draft) return null
      return serializeDraft(draft)
    }
    // JSON mode writes the user's bytes verbatim — canonicalization applies to
    // form-mode emission only (§6.2).
    return jsonText
  }

  const currentName = (): string | null => {
    if (editorMode === 'form') return draft?.name ?? null
    try {
      const parsed = QtapCustomToolSchema.safeParse(JSON.parse(jsonText))
      return parsed.success ? parsed.data.name : null
    } catch {
      return null
    }
  }

  const saveIsBlocked = editorMode === 'form' ? !formValid : jsonState ? !jsonState.valid && repairReason === null : true

  const putFile = async (mountPointId: string, path: string, content: string, opts: { expectedMtime?: number | null; force?: boolean }) => {
    const body: Record<string, unknown> = { content }
    if (opts.expectedMtime !== null && opts.expectedMtime !== undefined && !opts.force) {
      body.expected_mtime = opts.expectedMtime
    }
    if (opts.force) body.force = true
    return apiFetch<{ mtime: number }>(buildMountFileItemUrl(mountPointId, path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const fileExists = async (mountPointId: string, path: string): Promise<boolean> => {
    try {
      await apiFetch(buildMountFileItemUrl(mountPointId, path))
      return true
    } catch (error) {
      if (error instanceof ApiFetchError && error.status === 404) return false
      throw error
    }
  }

  const saveMutation = useMutation({
    mutationFn: async ({ destination, force }: { destination: { mountPointId: string; path: string }; force?: boolean }) => {
      const content = contentToWrite()
      if (content === null) throw new Error('Nothing to save')
      const result = await putFile(destination.mountPointId, destination.path, content, {
        expectedMtime: location && location.path === destination.path && location.mountPointId === destination.mountPointId ? mtime : null,
        force,
      })
      return { destination, result }
    },
    onSuccess: ({ destination, result }) => {
      setLocation(destination)
      setMtime(result.mtime)
      setLoadedName(currentName())
      setDirty(false)
      setConflictContent(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.customTools.all })
      showSuccessToast('Pascal has filed the contrivance.')
    },
    onError: (error) => {
      if (error instanceof ApiFetchError && error.status === 409) {
        // Conflict: someone else edited the file since we read it.
        setConflictContent(contentToWrite())
        return
      }
      showErrorToast(extractErrorMessage(error))
    },
  })

  /**
   * The full save pipeline for a chosen store: figure out the path (create =
   * `Tools/<name>.tool.json`), offer the file rename when `name` changed, and
   * write-then-delete so a failure never loses the definition (§6.5).
   */
  const saveToStore = async (store: PickedDestination) => {
    const name = currentName()
    const content = contentToWrite()
    if (content === null) return

    if (!location || pickerOpen === 'save-as' || location.mountPointId !== store.mountPointId) {
      // A fresh file (create, save-as, or new store — a copy; the original stays).
      const fileName = `${TOOLS_FOLDER}/${name ?? 'contrivance'}${TOOL_FILE_SUFFIX}`
      try {
        if (await fileExists(store.mountPointId, fileName)) {
          showErrorToast(`${store.mountName} already holds ${fileName} — rename this contrivance first.`)
          return
        }
      } catch (error) {
        showErrorToast(extractErrorMessage(error))
        return
      }
      setPickerOpen(null)
      saveMutation.mutate({ destination: { mountPointId: store.mountPointId, path: fileName } })
      return
    }

    setPickerOpen(null)
    saveMutation.mutate({ destination: location })
  }

  /** Save in place, offering the filename realignment when `name` changed. */
  const handleSave = async () => {
    if (saveIsBlocked && repairReason === null) return

    // Repair mode may save an invalid file back only as itself (§6.4).
    if (editorMode === 'json' && jsonState && !jsonState.valid) {
       
      const confirmed = window.confirm('Save it broken? It will stay off the table until it validates.')
      if (!confirmed) return
    }

    if (!location) {
      setPickerOpen('save')
      return
    }

    const name = currentName()
    const expectedFileName = name ? `${TOOLS_FOLDER}/${name}${TOOL_FILE_SUFFIX}` : null
    if (name && loadedName && name !== loadedName && expectedFileName && location.path !== expectedFileName) {
       
      const renameFile = window.confirm(
        `The name is now "${name}". Also rename the file to ${expectedFileName}?\n\n` +
          'OK renames the file to match; Cancel keeps the current filename.'
      )
      if (renameFile) {
        try {
          if (await fileExists(location.mountPointId, expectedFileName)) {
            showErrorToast(`${expectedFileName} already exists in this store; the file keeps its name.`)
          } else {
            const content = contentToWrite()
            if (content === null) return
            // Write the new path first, delete the old only once that landed —
            // a failure between the two leaves both copies, never neither.
            const result = await putFile(location.mountPointId, expectedFileName, content, {})
            await apiFetch(buildMountFileItemUrl(location.mountPointId, location.path), { method: 'DELETE' })
            setLocation({ mountPointId: location.mountPointId, path: expectedFileName })
            setMtime(result.mtime)
            setLoadedName(name)
            setDirty(false)
            queryClient.invalidateQueries({ queryKey: queryKeys.customTools.all })
            showSuccessToast('Filed under its new name.')
            return
          }
        } catch (error) {
          showErrorToast(extractErrorMessage(error))
          return
        }
      }
    }

    saveMutation.mutate({ destination: location })
  }

  const reloadTheirs = async () => {
    if (!location) return
    try {
      const fresh = await apiFetch<FileEnvelope>(buildMountFileItemUrl(location.mountPointId, location.path))
      initializeFromContent(fresh.content, fresh.mtime)
      setConflictContent(null)
    } catch (error) {
      showErrorToast(extractErrorMessage(error))
    }
  }

  // -- Draft change plumbing ------------------------------------------------

  const handleDraftChange = (next: ToolDraft) => {
    setDraft(next)
    setDirty(true)
  }

  const handleMatched = (outcomeId: string | null) => {
    setFlashOutcomeId(outcomeId)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashOutcomeId(null), 1600)
  }

  const handleBack = () => {
     
    if (dirty && !window.confirm('Leave the workbench? Unsaved changes will be lost.')) return
    onBack()
  }

  // -- Render ---------------------------------------------------------------

  if (source && fileQuery.isLoading) {
    return <div className="p-6 text-sm qt-text-secondary">Fetching the card from its store…</div>
  }
  if (source && fileQuery.isError) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm qt-text-destructive">{extractErrorMessage(fileQuery.error)}</p>
        <button type="button" className="qt-button qt-button-secondary" onClick={onBack}>
          Back to the library
        </button>
      </div>
    )
  }
  if (!initialized) return <div className="p-6 text-sm qt-text-secondary">Setting up the bench…</div>

  const headerTitle =
    editorMode === 'form' && draft
      ? draft.name || draft.title
        ? displayTitle({ name: draft.name || 'contrivance', title: draft.title || undefined })
        : 'A new contrivance'
      : (location?.path ?? 'A new contrivance')

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={handleBack}>
            <Icon name="arrow-left" className="w-4 h-4" />
            Library
          </button>
          <div className="min-w-0">
            <h1 className="qt-card-title text-base truncate">
              {headerTitle}
              {dirty && (
                <span className="qt-text-secondary" title="Unsaved changes">
                  {' '}
                  •
                </span>
              )}
            </h1>
            <p className="text-xs qt-text-secondary truncate">
              {location ? `${location.path}` : 'unsaved — Pascal has nowhere to keep it yet'}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Form ⇄ JSON switch */}
            <div className="flex rounded overflow-hidden border" role="radiogroup" aria-label="Editor mode">
              <button
                type="button"
                role="radio"
                aria-checked={editorMode === 'form'}
                className={`px-3 py-1 text-sm ${editorMode === 'form' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
                onClick={switchToForm}
                disabled={editorMode === 'form' ? false : !canSwitchToForm}
                title={
                  editorMode === 'json' && !canSwitchToForm
                    ? (jsonState?.issues[0] ?? 'The JSON must validate before the form can hold it')
                    : undefined
                }
              >
                Form
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={editorMode === 'json'}
                className={`px-3 py-1 text-sm ${editorMode === 'json' ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`}
                onClick={switchToJson}
                disabled={editorMode === 'json' || !draft}
              >
                JSON
              </button>
            </div>

            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => setBenchOpen(!benchOpen)}
              aria-pressed={benchOpen}
              title={benchOpen ? 'Hide the proving bench' : 'Show the proving bench'}
            >
              <Icon name="dice" className="w-4 h-4" />
            </button>

            <button
              type="button"
              className="qt-button qt-button-primary qt-button-sm"
              onClick={handleSave}
              disabled={(saveIsBlocked && repairReason === null) || saveMutation.isPending}
              title={saveIsBlocked && repairReason === null ? 'The draft has errors to resolve first' : undefined}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="qt-button qt-button-secondary qt-button-sm"
              onClick={() => setPickerOpen('save-as')}
              disabled={saveIsBlocked || saveMutation.isPending}
              title="Write a copy to another store; the original stays put"
            >
              Save As…
            </button>
          </div>
        </div>

        {/* Repair banner */}
        {repairReason && (
          <div className="qt-card p-3 border qt-input-error space-y-1">
            <p className="text-sm">
              <strong>Repair mode.</strong> This card would not read, so the form is off the table until it validates.
            </p>
            <p className="text-xs qt-text-destructive">{repairReason}</p>
          </div>
        )}

        {/* Body */}
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0 space-y-4">
            {editorMode === 'form' && draft ? (
              <>
                <BuilderForm draft={draft} issues={issues} onChange={handleDraftChange} disabled={saveMutation.isPending} />
                <OutcomesSection
                  draft={draft}
                  issues={issues}
                  onChange={handleDraftChange}
                  flashOutcomeId={flashOutcomeId}
                  disabled={saveMutation.isPending}
                />
              </>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value)
                    setDirty(true)
                  }}
                  rows={28}
                  spellCheck={false}
                  className="qt-textarea w-full font-mono text-xs"
                  aria-label="Definition JSON"
                />
                {jsonState && !jsonState.valid && (
                  <div className="qt-card p-2 space-y-1">
                    {jsonState.issues.map((issue) => (
                      <p key={issue} className="text-xs qt-text-destructive">
                        {issue}
                      </p>
                    ))}
                  </div>
                )}
                {jsonState?.valid && jsonState.unknownKeys.length > 0 && (
                  <p className="text-xs qt-text-secondary">
                    Carries keys this build doesn&rsquo;t know: {jsonState.unknownKeys.map((k) => `\`${k}\``).join(', ')} —
                    they&rsquo;ll be kept as-is.
                  </p>
                )}
              </div>
            )}
            {editorMode === 'form' && unknownKeysInDraft.length > 0 && (
              <p className="text-xs qt-text-secondary">
                Carries keys this build doesn&rsquo;t know: {unknownKeysInDraft.map((k) => `\`${k}\``).join(', ')} —
                they&rsquo;ll be kept as-is.
              </p>
            )}
          </div>

          {benchOpen && draft && editorMode === 'form' && (
            <div className="w-80 flex-shrink-0 sticky top-0">
              <ProvingBench draft={draft} valid={formValid} onMatched={handleMatched} />
            </div>
          )}
        </div>
      </div>

      {/* Destination picker */}
      {pickerOpen && (
        <DestinationPicker
          toolName={currentName() ?? ''}
          onPick={(store) => void saveToStore(store)}
          onCancel={() => setPickerOpen(null)}
          onOpenExisting={(mountPointId) => {
            const name = currentName()
            setPickerOpen(null)
            if (name) onOpenOther(mountPointId, `${TOOLS_FOLDER}/${name}${TOOL_FILE_SUFFIX}`)
          }}
        />
      )}

      {/* Conflict dialog */}
      {conflictContent !== null && location && (
        <div className="qt-dialog-overlay" role="dialog" aria-modal="true">
          <div className="qt-card qt-shadow-lg rounded-lg border w-full max-w-md p-4 space-y-3">
            <h2 className="qt-card-title text-base">The file has moved under your hand</h2>
            <p className="text-sm">
              {location.path} was changed by someone else since you opened it. Take theirs, or press yours?
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="qt-button qt-button-secondary" onClick={() => void reloadTheirs()}>
                Reload theirs
              </button>
              <button
                type="button"
                className="qt-button qt-button-destructive"
                onClick={() => saveMutation.mutate({ destination: location, force: true })}
              >
                Overwrite with mine
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkbenchEditor
