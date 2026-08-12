'use client'

/**
 * WorkbenchLibrary — the landing surface of Pascal's Workbench.
 *
 * Every definition in every enabled store, valid or not, face up. Deliberately
 * NOT the chat roster: no per-invoker shadowing, no hiding broken files behind
 * badges — this is the authoring surface. Name collisions across stores get an
 * advisory (the library cannot say which wins in general; that depends on the
 * invoker), and invalid files carry the loader's own reason string, verbatim.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { buildMountFileItemUrl } from '@/components/files/mountBlobUrl'
import { MAX_ROSTER_SIZE } from '@/lib/pascal/custom-tool.types'
import type {
  CustomToolLibraryEntry,
  CustomToolLibraryError,
  CustomToolLibraryResponse,
  MountAttachment,
} from '@/lib/pascal/workbench'

interface WorkbenchLibraryProps {
  onOpen: (mountPointId: string, path: string) => void
  onCreate: (mountPointId?: string) => void
  /** Open the builder in create mode pre-filled from a serialized definition. */
  onDuplicate: (templateJson: string) => void
}

const TIER_ADVISORY =
  'Nearest tier wins: character → participant → group → project → global. ' +
  'A disabled definition at a nearer tier suppresses the name outward. ' +
  'Which one a given chat deals depends on who is rolling.'

function attachmentBadgeClass(kind: MountAttachment['kind']): string {
  switch (kind) {
    case 'general':
      return 'qt-badge qt-badge-primary'
    case 'character':
      return 'qt-badge qt-badge-info'
    case 'group':
      return 'qt-badge qt-badge-secondary'
    case 'project':
      return 'qt-badge qt-badge-success'
    case 'unattached':
      return 'qt-badge qt-badge-outline'
  }
}

function attachmentLabel(attachment: MountAttachment): string {
  switch (attachment.kind) {
    case 'general':
      return 'The General Store'
    case 'character':
      return `${attachment.label}'s vault`
    case 'group':
      return `Group: ${attachment.label}`
    case 'project':
      return `Project: ${attachment.label}`
    case 'unattached':
      return 'Unattached'
  }
}

export function WorkbenchLibrary({ onOpen, onCreate, onDuplicate }: Readonly<WorkbenchLibraryProps>) {
  const [search, setSearch] = useState('')
  const [groupByStore, setGroupByStore] = useState(false)
  const queryClient = useQueryClient()

  const libraryQuery = useQuery({
    queryKey: queryKeys.customTools.library(),
    queryFn: ({ signal }) => apiFetch<CustomToolLibraryResponse>('/api/v1/custom-tools', { signal }),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ mountPointId, path }: { mountPointId: string; path: string; title: string }) =>
      apiFetch(buildMountFileItemUrl(mountPointId, path), { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      showSuccessToast(`${vars.title} has been cleared from the table.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.customTools.all })
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : 'The contrivance would not be removed.')
    },
  })

  const tools = useMemo(() => libraryQuery.data?.tools ?? [], [libraryQuery.data])
  const errors = useMemo(() => libraryQuery.data?.errors ?? [], [libraryQuery.data])

  /** Tool names that exist in more than one store — the shadowing advisory. */
  const collidingNames = useMemo(() => {
    const byName = new Map<string, number>()
    for (const tool of tools) byName.set(tool.name, (byName.get(tool.name) ?? 0) + 1)
    return new Map([...byName].filter(([, count]) => count > 1))
  }, [tools])

  /** Stores holding more tools than one chat's roster can seat. */
  const overCapStores = useMemo(() => {
    const byMount = new Map<string, { mountName: string; count: number }>()
    for (const tool of tools) {
      const entry = byMount.get(tool.mountPointId) ?? { mountName: tool.mountName, count: 0 }
      entry.count += 1
      byMount.set(tool.mountPointId, entry)
    }
    return [...byMount.values()].filter((s) => s.count > MAX_ROSTER_SIZE)
  }, [tools])

  const filteredTools = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matched = needle
      ? tools.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            t.title.toLowerCase().includes(needle) ||
            t.description.toLowerCase().includes(needle)
        )
      : tools
    return [...matched].sort(
      (a, b) => a.title.localeCompare(b.title) || a.mountName.localeCompare(b.mountName)
    )
  }, [tools, search])

  const filteredErrors = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? errors.filter((e) => e.definitionPath.toLowerCase().includes(needle)) : errors
  }, [errors, search])

  const groups = useMemo(() => {
    if (!groupByStore) return null
    const byStore = new Map<string, { mountName: string; tools: CustomToolLibraryEntry[] }>()
    for (const tool of filteredTools) {
      const entry = byStore.get(tool.mountPointId) ?? { mountName: tool.mountName, tools: [] }
      entry.tools.push(tool)
      byStore.set(tool.mountPointId, entry)
    }
    return [...byStore.entries()].sort((a, b) => a[1].mountName.localeCompare(b[1].mountName))
  }, [filteredTools, groupByStore])

  const handleDuplicate = async (tool: CustomToolLibraryEntry) => {
    try {
      const file = await apiFetch<{ content: string }>(buildMountFileItemUrl(tool.mountPointId, tool.definitionPath))
      onDuplicate(file.content)
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'The definition could not be read.')
    }
  }

  const handleDelete = (tool: { mountPointId: string; definitionPath: string; title: string }) => {
     
    if (!window.confirm(`Clear ${tool.title} from the table? The file ${tool.definitionPath} will be deleted.`)) return
    deleteMutation.mutate({ mountPointId: tool.mountPointId, path: tool.definitionPath, title: tool.title })
  }

  const renderToolRow = (tool: CustomToolLibraryEntry) => (
    <div key={`${tool.mountPointId}:${tool.definitionPath}`} className={`qt-card p-3 ${tool.disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 text-left flex-1"
          onClick={() => onOpen(tool.mountPointId, tool.definitionPath)}
          title="Open on the workbench"
        >
          <span className="block text-sm font-medium truncate">{tool.title}</span>
          <span className="block text-xs font-mono qt-text-secondary truncate">{tool.name}</span>
          {tool.description && (
            <span className="block text-xs qt-text-secondary mt-1 line-clamp-2">{tool.description}</span>
          )}
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={() => onOpen(tool.mountPointId, tool.definitionPath)}
            title="Open on the workbench"
          >
            <Icon name="pencil" className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={() => handleDuplicate(tool)}
            title="Duplicate as a new contrivance"
          >
            <Icon name="copy" className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={() => handleDelete(tool)}
            disabled={deleteMutation.isPending}
            title="Delete the definition file"
          >
            <Icon name="trash" className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 mt-2">
        <span className="qt-badge qt-badge-outline" title={tool.definitionPath}>
          {tool.mountName}
        </span>
        {tool.attachments.map((attachment) => (
          <span key={`${attachment.kind}:${attachment.id ?? ''}`} className={attachmentBadgeClass(attachment.kind)}>
            {attachmentLabel(attachment)}
          </span>
        ))}
        {tool.disabled && (
          <span className="qt-badge qt-badge-disabled" title="A tombstone: suppresses this name at this tier and every farther one">
            disabled
          </span>
        )}
        {tool.gate && (
          <span
            className="qt-badge qt-badge-warning"
            title={
              tool.gate === 'available'
                ? 'Only offered to a character whose metadata passes this tool’s “only show if” test'
                : 'Withheld from a character whose metadata passes this tool’s “do not show if” test'
            }
          >
            gated
          </span>
        )}
        {tool.defaultVisibility === 'whisper' && (
          <span className="qt-badge qt-badge-secondary" title="Results whisper by default">
            whisper
          </span>
        )}
        <span className="qt-badge qt-badge-outline">{tool.rollForm === 'dice' ? 'dice' : 'range'}</span>
        {tool.llm && (
          <span className="qt-badge qt-badge-outline" title="Consults an LLM mid-run; outcomes may test its answer">
            oracle
          </span>
        )}
        {tool.parameterCount > 0 && (
          <span className="qt-badge qt-badge-outline">
            {tool.parameterCount} param{tool.parameterCount === 1 ? '' : 's'}
          </span>
        )}
        <span className="qt-badge qt-badge-outline">
          {tool.outcomeCount} outcome{tool.outcomeCount === 1 ? '' : 's'}
        </span>
        {collidingNames.has(tool.name) && (
          <span className="qt-badge qt-badge-warning" title={TIER_ADVISORY}>
            this name is defined in {collidingNames.get(tool.name)} places
          </span>
        )}
        <Link
          href={`/scriptorium/${tool.mountPointId}`}
          className="text-xs qt-text-secondary underline ml-auto"
          title="Reveal this store in the Scriptorium"
        >
          reveal in Scriptorium
        </Link>
      </div>
    </div>
  )

  const renderErrorRow = (error: CustomToolLibraryError) => (
    <div key={`${error.mountPointId}:${error.definitionPath}`} className="qt-card p-3 border qt-input-error">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 text-left flex-1"
          onClick={() => onOpen(error.mountPointId, error.definitionPath)}
          title="Open in repair mode"
        >
          <span className="block text-sm font-mono break-all">{error.definitionPath}</span>
          <span className="block text-xs qt-text-destructive mt-1">{error.reason}</span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            className="qt-button qt-button-warning qt-button-sm"
            onClick={() => onOpen(error.mountPointId, error.definitionPath)}
          >
            Repair
          </button>
          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={() =>
              handleDelete({ mountPointId: error.mountPointId, definitionPath: error.definitionPath, title: error.definitionPath })
            }
            title="Delete the definition file"
          >
            <Icon name="trash" className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-2">
        <span className="qt-badge qt-badge-outline">{error.mountName}</span>
        {error.attachments.map((attachment) => (
          <span key={`${attachment.kind}:${attachment.id ?? ''}`} className={attachmentBadgeClass(attachment.kind)}>
            {attachmentLabel(attachment)}
          </span>
        ))}
        <span className="qt-badge qt-badge-destructive">will not read</span>
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="qt-card-title flex items-center gap-2">
              <Icon name="wrench" className="w-5 h-5" />
              Pascal&rsquo;s Workbench
            </h1>
            <p className="text-xs qt-text-secondary mt-1">
              Every contrivance on the premises, face up — whichever store it calls home.
            </p>
          </div>
          <button type="button" className="qt-button qt-button-primary" onClick={() => onCreate()}>
            <Icon name="plus" className="w-4 h-4" />
            New contrivance
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, title, or description…"
            className="qt-input flex-1 min-w-48"
            aria-label="Search custom tools"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={groupByStore}
              onChange={(e) => setGroupByStore(e.target.checked)}
            />
            Group by store
          </label>
        </div>

        {libraryQuery.isLoading && (
          <div className="text-sm qt-text-secondary py-8 text-center">Consulting Pascal&rsquo;s ledger&hellip;</div>
        )}

        {libraryQuery.isError && (
          <div className="text-sm qt-text-destructive py-4">
            {libraryQuery.error instanceof Error ? libraryQuery.error.message : 'The library could not be read.'}
          </div>
        )}

        {!libraryQuery.isLoading && !libraryQuery.isError && tools.length === 0 && errors.length === 0 && (
          <div className="qt-card p-6 text-center space-y-2">
            <p className="text-sm">The baize is bare — not a single contrivance on the table.</p>
            <p className="text-xs qt-text-secondary">
              A custom tool is a small JSON file in any document store&rsquo;s <code>Tools/</code> folder. Build your
              first one here, and Pascal will deal it into every chat that can see its store.
            </p>
          </div>
        )}

        {overCapStores.map((store) => (
          <div key={store.mountName} className="text-xs qt-text-secondary">
            {store.mountName} holds {store.count} tools — more than the {MAX_ROSTER_SIZE} a single chat&rsquo;s roster
            seats; the surplus is left off the table at deal time.
          </div>
        ))}

        {groups
          ? groups.map(([mountPointId, group]) => (
              <div key={mountPointId} className="space-y-2">
                <h2 className="text-sm font-medium mt-2">{group.mountName}</h2>
                {group.tools.map(renderToolRow)}
              </div>
            ))
          : filteredTools.map(renderToolRow)}

        {filteredErrors.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium mt-4">Cards that would not read</h2>
            {filteredErrors.map(renderErrorRow)}
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkbenchLibrary
