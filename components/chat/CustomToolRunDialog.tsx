'use client'

/**
 * CustomToolRunDialog — the operator's side of Pascal's table.
 *
 * A two-phase modal, replacing the cramped upward-opening popover this used to
 * be. Phase one lists the roster; choosing a tool replaces the dialog's body
 * with that tool's form, and a "Choose another tool" button goes back. The
 * whole thing is cancellable — Escape, the backdrop, or the Cancel button.
 *
 * The roster is fetched fresh on every open (`enabled: isOpen`) — custom-tool
 * definitions live in the user's document stores and can change mid-chat.
 *
 * ## What it remembers
 *
 * Everything you last set, for as long as the composer stays mounted: the
 * parameter values per tool, the privacy toggle per tool, and which tool you
 * were on. Reopening therefore lands you back on the last tool with its values
 * intact — the old popover's one genuinely good habit, and the reason the back
 * button is always in reach rather than the picker being forced on you.
 *
 * ## What it discloses
 *
 * Odds and outcome tables are never shown; the roster payload doesn't carry
 * them. What it does carry is each tool's `references` — the metadata keys and
 * state paths the definition quotes — which the reference panel lists so a user
 * can see what the tool reads about their character. Vocabulary, not odds.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import {
  CustomToolParamsForm,
  coerceParamValues,
  initialParamValues,
  type CustomToolParameterSpec,
  type ParameterFormValues,
} from '@/components/custom-tools/CustomToolParamsForm'

/** A single declared parameter of a custom-tool definition. */
export type CustomToolParameter = CustomToolParameterSpec

/**
 * What a tool actually quotes. Mirrors `ToolVocabulary` on the server
 * (`lib/pascal/tool-vocabulary.ts`) — every field is an occurrence, not an
 * availability, so a tool that rolls dice but never writes `{{dice}}` reports
 * `dice: false`.
 */
export interface CustomToolReferences {
  /** The tool quotes `{{value}}`. */
  value: boolean
  /** The tool quotes `{{roll}}`. */
  roll: boolean
  /** The tool quotes `{{dice}}`. */
  dice: boolean
  /** The tool quotes `{{llm}}`. */
  llm: boolean
  /** Declared parameters the tool quotes as `{{params.name}}`. */
  params: string[]
  /** Keys of the invoking character's `metadata.json` this tool reads. */
  metadata: string[]
  /** Paths into the merged persistent state this tool reads. */
  state: string[]
}

/** A runnable tool in the resolved roster. */
export interface CustomTool {
  /** Identity — what the run call names. Never displayed. */
  name: string
  /** What to display. Server-resolved, so `title` is always present. */
  title: string
  description: string
  parameters: Record<string, CustomToolParameter>
  /** Absent on a roster from an older server; treated as "quotes nothing". */
  references?: CustomToolReferences
  defaultVisibility: 'public' | 'whisper'
  sourceTier: string
  /** Present on per-character variants that shadow a broader definition. */
  characterLabel?: string
  /** Disambiguates a character-labeled variant on the run call. */
  asCharacterId?: string
  definitionPath: string
  /** Which store holds the file — the Workbench edits it by this pair. */
  mountPointId?: string
  mountName: string
}

/** A definition file that failed load-time validation and stayed out of the roster. */
export interface CustomToolError {
  definitionPath: string
  mountPointId?: string
  mountName: string
  tier: string
  reason: string
}

interface CustomToolsRosterResponse {
  tools: CustomTool[]
  errors: CustomToolError[]
  /** Tools dropped because the roster hit its cap — surfaced, never silent. */
  droppedForCap?: string[]
}

interface CustomToolRunDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when the dialog should close */
  onClose: () => void
  /** Chat ID for the roster + run API calls */
  chatId: string
  /** Called after a successful run so the Salon can refetch the chat */
  onRan?: () => void
}

/** Above this many tools, the picker earns a search box. */
const SEARCH_THRESHOLD = 6

/**
 * Identity of a roster entry. `name` alone isn't unique — a per-character
 * variant shadows a broader definition under the same name.
 */
function toolKey(tool: CustomTool): string {
  return `${tool.name}::${tool.asCharacterId ?? ''}`
}

/** What the picker matches a search against. */
function searchHaystack(tool: CustomTool): string {
  return `${tool.title} ${tool.name} ${tool.description} ${tool.characterLabel ?? ''}`.toLowerCase()
}

export function CustomToolRunDialog({
  isOpen,
  onClose,
  chatId,
  onRan,
}: Readonly<CustomToolRunDialogProps>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, ParameterFormValues>>({})
  const [privateByKey, setPrivateByKey] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()
  const workspace = useWorkspaceOptional()
  const router = useRouter()

  // Refetched on every open: definitions live in document stores the user edits
  // mid-chat, so a stale roster is worse than a round-trip.
  const rosterQuery = useQuery({
    queryKey: queryKeys.customTools.byChat(chatId),
    queryFn: ({ signal }) =>
      apiFetch<CustomToolsRosterResponse>(`/api/v1/chats/${chatId}/custom-tools`, { signal }),
    enabled: isOpen,
  })

  const tools = useMemo(() => rosterQuery.data?.tools ?? [], [rosterQuery.data])
  const errors = rosterQuery.data?.errors ?? []
  const droppedForCap = rosterQuery.data?.droppedForCap ?? []

  // Derived rather than stored, so a remembered tool that has since been
  // renamed, disabled, or shadowed simply drops the dialog back to the picker
  // instead of leaving it pointed at a tool that is no longer dealt.
  const selectedTool = useMemo(
    () => tools.find((tool) => toolKey(tool) === selectedKey) ?? null,
    [tools, selectedKey],
  )

  const visibleTools = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query === '') return tools
    return tools.filter((tool) => searchHaystack(tool).includes(query))
  }, [tools, search])

  const runMutation = useMutation({
    mutationFn: ({ title: _title, ...vars }: {
      tool: string
      /** Display only — the toast's, not the API's. */
      title: string
      parameters: Record<string, number | string | boolean>
      private: boolean
      asCharacterId?: string
    }) =>
      apiFetch(`/api/v1/chats/${chatId}/custom-tools?action=run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }),
    onSuccess: (_data, vars) => {
      showSuccessToast(`Pascal has settled ${vars.title}.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.customTools.byChat(chatId) })
      onRan?.()
      // The selection survives the close on purpose — see the file header.
      onClose()
    },
    onError: (err) => {
      showErrorToast(extractErrorMessage(err))
    },
  })

  const isRunning = runMutation.isPending

  /** Open Pascal's Workbench — as a tab inside the workspace, a route outside. */
  const openWorkbench = (payload?: { mountPointId?: string; path?: string; create?: boolean }) => {
    onClose()
    if (workspace) {
      workspace.openTab('custom-tools', payload)
      return
    }
    const params = new URLSearchParams()
    if (payload?.create) params.set('new', '1')
    if (payload?.mountPointId) params.set('mount', payload.mountPointId)
    if (payload?.path) params.set('path', payload.path)
    router.push(params.size > 0 ? `/custom-tools?${params.toString()}` : '/custom-tools')
  }

  /** Choose a tool, seeding its form + privacy default the first time it opens. */
  const handleSelect = (tool: CustomTool) => {
    const key = toolKey(tool)
    setFormValues((prev) => (key in prev ? prev : { ...prev, [key]: initialParamValues(tool.parameters) }))
    setPrivateByKey((prev) =>
      key in prev ? prev : { ...prev, [key]: tool.defaultVisibility === 'whisper' },
    )
    setSelectedKey(key)
  }

  const handleRun = () => {
    if (!selectedTool || isRunning) return
    const key = toolKey(selectedTool)
    runMutation.mutate({
      tool: selectedTool.name,
      title: selectedTool.title,
      parameters: coerceParamValues(
        selectedTool.parameters,
        formValues[key] ?? initialParamValues(selectedTool.parameters),
      ),
      private: privateByKey[key] ?? selectedTool.defaultVisibility === 'whisper',
      asCharacterId: selectedTool.asCharacterId,
    })
  }

  const selectedFormKey = selectedTool ? toolKey(selectedTool) : ''
  const isPrivate = selectedTool
    ? privateByKey[selectedFormKey] ?? selectedTool.defaultVisibility === 'whisper'
    : false

  const footer = selectedTool ? (
    <div className="flex items-center justify-between w-full gap-2">
      <button
        type="button"
        onClick={() => setSelectedKey(null)}
        disabled={isRunning}
        className="qt-button qt-button-secondary"
      >
        <Icon name="arrow-left" className="w-4 h-4 mr-1.5" />
        Choose another tool
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} disabled={isRunning} className="qt-button qt-button-secondary">
          Cancel
        </button>
        <button type="button" onClick={handleRun} disabled={isRunning} className="qt-button qt-button-primary">
          {isRunning ? 'Running…' : `Run ${selectedTool.title}`}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between w-full gap-2">
      <button
        type="button"
        onClick={() => openWorkbench({ create: true })}
        className="qt-button qt-button-secondary"
      >
        <Icon name="wrench" className="w-4 h-4 mr-1.5" />
        New contrivance&hellip;
      </button>
      <button type="button" onClick={onClose} className="qt-button qt-button-secondary">
        Cancel
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={selectedTool ? `Run ${selectedTool.title}` : "Pascal's Table"}
      maxWidth="2xl"
      showCloseButton
      footer={footer}
    >
      {selectedTool ? (
        <ToolRunForm
          tool={selectedTool}
          values={formValues[selectedFormKey] ?? initialParamValues(selectedTool.parameters)}
          onValueChange={(param, value) =>
            setFormValues((prev) => ({
              ...prev,
              [selectedFormKey]: { ...prev[selectedFormKey], [param]: value },
            }))
          }
          isPrivate={isPrivate}
          onPrivateChange={(next) =>
            setPrivateByKey((prev) => ({ ...prev, [selectedFormKey]: next }))
          }
          disabled={isRunning}
          onOpenWorkbench={openWorkbench}
        />
      ) : (
        <ToolPicker
          tools={visibleTools}
          totalCount={tools.length}
          errors={errors}
          droppedForCap={droppedForCap}
          isLoading={rosterQuery.isLoading}
          error={rosterQuery.isError ? extractErrorMessage(rosterQuery.error) : null}
          search={search}
          onSearchChange={setSearch}
          onSelect={handleSelect}
          onOpenWorkbench={openWorkbench}
        />
      )}
    </BaseModal>
  )
}

// ---------------------------------------------------------------------------
// Phase one — the roster
// ---------------------------------------------------------------------------

interface ToolPickerProps {
  tools: CustomTool[]
  /** Unfiltered count, so "no matches" and "no tools" can be told apart. */
  totalCount: number
  errors: CustomToolError[]
  droppedForCap: string[]
  isLoading: boolean
  error: string | null
  search: string
  onSearchChange: (next: string) => void
  onSelect: (tool: CustomTool) => void
  onOpenWorkbench: (payload?: { mountPointId?: string; path?: string; create?: boolean }) => void
}

function ToolPicker({
  tools,
  totalCount,
  errors,
  droppedForCap,
  isLoading,
  error,
  search,
  onSearchChange,
  onSelect,
  onOpenWorkbench,
}: Readonly<ToolPickerProps>) {
  return (
    <div className="space-y-4">
      {isLoading && (
        <p className="text-sm qt-text-secondary px-1 py-2">Consulting Pascal&rsquo;s ledger&hellip;</p>
      )}

      {error && <p className="text-sm qt-text-destructive px-1 py-2">{error}</p>}

      {totalCount > SEARCH_THRESHOLD && (
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search the table…"
            className="qt-input w-full pl-9 text-sm"
          />
        </div>
      )}

      {/* "Nothing here" only when there is genuinely nothing. With a failed
          definition below, this line would contradict the badge that is about
          to explain why the table looks bare. */}
      {!isLoading && !error && totalCount === 0 && errors.length === 0 && (
        <p className="text-sm qt-text-secondary px-1 py-2">No custom tools are laid out on the table.</p>
      )}

      {!isLoading && !error && totalCount === 0 && errors.length > 0 && (
        <p className="text-sm qt-text-secondary px-1 py-2">
          Nothing is runnable — the table was set, but the cards below would not read.
        </p>
      )}

      {!isLoading && totalCount > 0 && tools.length === 0 && (
        <p className="text-sm qt-text-secondary px-1 py-2">Nothing on the table answers to that.</p>
      )}

      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={toolKey(tool)}
            className="flex items-stretch gap-1 rounded-lg qt-bg-surface hover:qt-bg-surface-hover"
          >
            <button
              type="button"
              onClick={() => onSelect(tool)}
              className="flex-1 min-w-0 text-left px-4 py-3 rounded-lg"
            >
              <span className="block text-sm font-medium qt-text">
                {tool.title}
                {tool.characterLabel ? (
                  <span className="ml-2 text-xs qt-text-secondary font-normal">
                    as {tool.characterLabel}
                  </span>
                ) : null}
              </span>
              {tool.description && (
                <span className="block text-xs qt-text-secondary mt-1">{tool.description}</span>
              )}
              <span className="block text-[10px] qt-text-secondary mt-1.5 font-mono">
                {tool.mountName} · {tool.definitionPath}
              </span>
            </button>
            {tool.mountPointId && (
              <button
                type="button"
                className="px-4 qt-text-secondary hover:opacity-70 rounded-lg"
                title="Open on Pascal's Workbench"
                aria-label={`Open ${tool.title} on Pascal's Workbench`}
                onClick={() =>
                  onOpenWorkbench({ mountPointId: tool.mountPointId, path: tool.definitionPath })
                }
              >
                <Icon name="wrench" className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Definition files that failed validation — named, never swallowed. Each
          badge opens the Workbench's repair mode: the place you fix a broken file. */}
      {errors.length > 0 && (
        <div className="rounded-lg qt-border p-4 space-y-2">
          <h4 className="text-xs font-semibold qt-text-secondary uppercase tracking-wide">
            Would not read
          </h4>
          {errors.map((err) => (
            <button
              key={`${err.mountName}:${err.definitionPath}`}
              type="button"
              className="w-full px-3 py-2 text-xs qt-text-destructive text-left rounded-md hover:qt-bg-surface-hover disabled:hover:bg-transparent"
              disabled={!err.mountPointId}
              title={err.mountPointId ? "Open in Pascal's Workbench to repair" : undefined}
              onClick={() =>
                err.mountPointId &&
                onOpenWorkbench({ mountPointId: err.mountPointId, path: err.definitionPath })
              }
            >
              <span className="block break-all font-mono">{err.definitionPath}</span>
              <span className="block">{err.reason}</span>
            </button>
          ))}
        </div>
      )}

      {/* Roster cap — say so rather than truncate silently */}
      {droppedForCap.length > 0 && (
        <p className="text-xs qt-text-destructive rounded-lg qt-border p-4 leading-relaxed">
          Too many tools on the table; these were left off: {droppedForCap.join(', ')}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase two — the chosen tool
// ---------------------------------------------------------------------------

interface ToolRunFormProps {
  tool: CustomTool
  values: ParameterFormValues
  onValueChange: (param: string, value: string | boolean) => void
  isPrivate: boolean
  onPrivateChange: (next: boolean) => void
  disabled: boolean
  onOpenWorkbench: (payload?: { mountPointId?: string; path?: string; create?: boolean }) => void
}

function ToolRunForm({
  tool,
  values,
  onValueChange,
  isPrivate,
  onPrivateChange,
  disabled,
  onOpenWorkbench,
}: Readonly<ToolRunFormProps>) {
  const parameterNames = Object.keys(tool.parameters)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          {tool.description && <p className="text-sm qt-text-secondary">{tool.description}</p>}
          <p className="text-[10px] qt-text-secondary mt-1.5 font-mono break-all">
            {tool.mountName} · {tool.definitionPath}
            {tool.characterLabel ? ` · as ${tool.characterLabel}` : ''}
          </p>
        </div>
        {tool.mountPointId && (
          <button
            type="button"
            className="qt-text-secondary hover:opacity-70 flex-shrink-0"
            title="Open on Pascal's Workbench"
            aria-label="Open on Pascal's Workbench"
            onClick={() =>
              onOpenWorkbench({ mountPointId: tool.mountPointId, path: tool.definitionPath })
            }
          >
            <Icon name="wrench" className="w-4 h-4" />
          </button>
        )}
      </div>

      <section className="rounded-lg qt-border p-5">
        <h4 className="text-sm font-medium qt-text mb-4">
          {parameterNames.length > 0 ? 'What you are setting' : 'Nothing to set'}
        </h4>
        {parameterNames.length > 0 ? (
          <div className="space-y-6">
            <CustomToolParamsForm
              parameters={tool.parameters}
              values={values}
              onChange={onValueChange}
              disabled={disabled}
              idPrefix={`custom-tool-${toolKey(tool)}`}
              layout="stacked"
            />
          </div>
        ) : (
          <p className="text-sm qt-text-secondary">
            This tool takes no parameters. There is nothing to do but spin.
          </p>
        )}
      </section>

      {/* Above the reference panel on purpose: this is the last decision the
          operator makes about the run, and the panel below it is reading
          matter rather than a control. */}
      <section className="rounded-lg qt-border p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => onPrivateChange(e.target.checked)}
            disabled={disabled}
            className="mt-1"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium qt-text">Roll privately</span>
            <span className="block text-xs qt-text-secondary mt-1">
              The outcome is whispered to you alone. No character sees it, and it stays out of
              every character&rsquo;s context.
            </span>
          </span>
        </label>
      </section>

      <ToolReferencePanel tool={tool} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The reference panel — what this tool quotes
// ---------------------------------------------------------------------------

/** One row of the reference panel: a placeholder and what it stands for. */
interface ReferenceRow {
  placeholder: string
  meaning: string
}

/**
 * What the chosen tool actually quotes, in the order a reader wants it.
 *
 * Every row is an occurrence the server found in the definition's own strings.
 * Nothing is listed because the format merely permits it: a tool that never
 * writes `{{value}}` does not get a `{{value}}` row, and a parameter you are
 * filling in above appears here only if some message or prompt quotes it back.
 */
function referenceRows(tool: CustomTool): ReferenceRow[] {
  const refs = tool.references
  if (!refs) return []

  const rows: ReferenceRow[] = []

  if (refs.value) {
    rows.push({ placeholder: '{{value}}', meaning: 'the value the roll finally settles on' })
  }
  if (refs.roll) {
    rows.push({ placeholder: '{{roll}}', meaning: 'the raw draw, before the tool does its arithmetic' })
  }
  if (refs.dice) {
    rows.push({ placeholder: '{{dice}}', meaning: 'the dice, die by die, with the modifier' })
  }
  if (refs.llm) {
    rows.push({ placeholder: '{{llm}}', meaning: "the oracle's answer to the question this tool poses" })
  }

  for (const name of refs.params) {
    rows.push({
      placeholder: `{{params.${name}}}`,
      meaning: tool.parameters[name]?.description ?? `whatever you set “${name}” to above`,
    })
  }

  for (const key of refs.metadata) {
    rows.push({
      placeholder: `{{metadata.${key}}}`,
      meaning: `“${key}” from the invoking character's own fact sheet (metadata.json)`,
    })
  }

  for (const path of refs.state) {
    rows.push({
      placeholder: `{{state.${path}}}`,
      meaning: `“${path}” from the story's persistent state`,
    })
  }

  return rows
}

/**
 * What this particular tool can quote, and — just as importantly — who gets to
 * quote it. The placeholders belong to the definition's own outcome messages
 * and oracle prompt, which its author writes; what the operator types into the
 * form above is sent verbatim, `{{braces}}` and all. Saying so here is the
 * whole point of the panel: the vocabulary is visible, and so is its boundary.
 */
function ToolReferencePanel({ tool }: Readonly<{ tool: CustomTool }>) {
  const rows = referenceRows(tool)
  const readsMetadata = (tool.references?.metadata.length ?? 0) > 0
  const readsState = (tool.references?.state.length ?? 0) > 0

  // A tool that quotes nothing gets no panel. An empty list under a heading
  // promising a list is worse than the heading's absence.
  if (rows.length === 0) return null

  return (
    <details className="rounded-lg qt-border p-5" open>
      <summary className="text-sm font-medium qt-text cursor-pointer list-none flex items-center gap-2">
        <Icon name="info" className="w-4 h-4 qt-text-secondary flex-shrink-0" />
        What this tool can quote
      </summary>

      <p className="text-xs qt-text-secondary mt-3 leading-relaxed">
        Pascal substitutes these when he writes the outcome. They belong to the tool&rsquo;s own
        messages, which its author places on{' '}
        <span className="whitespace-nowrap">Pascal&rsquo;s Workbench</span> — what you type into
        the form above is sent exactly as written, braces and all.
      </p>

      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.placeholder} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <dt>
              <code className="text-xs font-mono qt-text">{row.placeholder}</code>
            </dt>
            <dd className="text-xs qt-text-secondary min-w-0">{row.meaning}</dd>
          </div>
        ))}
      </dl>

      {(readsMetadata || readsState) && (
        <p className="text-xs qt-text-secondary mt-4 leading-relaxed">
          {readsMetadata && readsState
            ? 'This tool also reads the character sheet and the story state above — a key or path that is missing simply leaves its placeholder standing.'
            : readsMetadata
              ? 'A metadata key the character does not have simply leaves its placeholder standing.'
              : 'A state path that has never been set simply leaves its placeholder standing.'}
        </p>
      )}
    </details>
  )
}

/** Pull a human message out of an ApiFetchError's parsed `{ error }` body. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiFetchError) {
    const info = err.info
    if (info && typeof info === 'object') {
      const record = info as Record<string, unknown>
      if (typeof record.error === 'string') return record.error
      if (typeof record.message === 'string') return record.message
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return 'The tool could not be run.'
}

export default CustomToolRunDialog
