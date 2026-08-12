'use client'

/**
 * DestinationPicker — "Where shall Pascal keep this contrivance?"
 *
 * Renders the §5.2 destination groups with a one-line consequence per tier —
 * this dialog doubles as the user's education about shadowing. A store already
 * carrying the same `name` is a blocking warning (a same-store duplicate is a
 * load-time rejection) with a one-click "open the existing one instead"; the
 * same name in a DIFFERENT store is a non-blocking advisory.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { CustomToolDestinations, DestinationStore } from '@/lib/pascal/workbench'

export interface PickedDestination {
  mountPointId: string
  mountName: string
}

interface DestinationPickerProps {
  /** The draft's tool name, for duplicate warnings. */
  toolName: string
  onPick: (destination: PickedDestination) => void
  onCancel: () => void
  /** Open an existing definition instead (same-store duplicate escape hatch). */
  onOpenExisting?: (mountPointId: string) => void
}

export function DestinationPicker({ toolName, onPick, onCancel, onOpenExisting }: Readonly<DestinationPickerProps>) {
  const [selected, setSelected] = useState<PickedDestination | null>(null)

  const destinationsQuery = useQuery({
    queryKey: queryKeys.customTools.destinations(),
    queryFn: ({ signal }) => apiFetch<CustomToolDestinations>('/api/v1/custom-tools?action=destinations', { signal }),
  })

  const data = destinationsQuery.data

  const nameElsewhere =
    data && toolName
      ? allStores(data).some((s) => s.mountPointId !== selected?.mountPointId && s.existingToolNames.includes(toolName))
      : false

  const selectedStore = selected && data ? allStores(data).find((s) => s.mountPointId === selected.mountPointId) : null
  const duplicateHere = Boolean(toolName && selectedStore?.existingToolNames.includes(toolName))

  const storeRow = (store: DestinationStore, label?: string) => {
    const isSelected = selected?.mountPointId === store.mountPointId
    const hasDuplicate = Boolean(toolName && store.existingToolNames.includes(toolName))
    return (
      <button
        key={store.mountPointId}
        type="button"
        onClick={() => setSelected({ mountPointId: store.mountPointId, mountName: store.mountName })}
        className={`block w-full text-left px-3 py-1.5 rounded text-sm ${isSelected ? 'qt-bg-muted border' : 'hover:qt-bg-muted'}`}
      >
        <span className="flex items-center gap-2">
          <span className="qt-badge qt-badge-outline">{store.mountName}</span>
          {label && <span className="text-xs qt-text-secondary">{label}</span>}
          {hasDuplicate && (
            <span className="qt-badge qt-badge-destructive" title={`"${toolName}" is already in this store`}>
              name taken
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div className="qt-dialog-overlay" role="dialog" aria-modal="true">
      <div className="qt-card qt-shadow-lg rounded-lg border w-full max-w-lg max-h-[80vh] overflow-y-auto p-4 space-y-3">
        <h2 className="qt-card-title text-base">Where shall Pascal keep this contrivance?</h2>

        {destinationsQuery.isLoading && <p className="text-sm qt-text-secondary">Surveying the premises…</p>}
        {destinationsQuery.isError && (
          <p className="text-sm qt-text-destructive">
            {destinationsQuery.error instanceof Error ? destinationsQuery.error.message : 'The stores could not be listed.'}
          </p>
        )}

        {data && (
          <div className="space-y-3">
            <DestinationGroup
              heading="◈ The General Store"
              consequence="every chat, every character"
            >
              {data.general ? (
                storeRow(data.general)
              ) : (
                <p className="text-xs qt-text-secondary px-3">Not yet provisioned — the General store appears once first used.</p>
              )}
            </DestinationGroup>

            {data.projects.length > 0 && (
              <DestinationGroup heading="◈ Projects" consequence="chats in that project">
                {data.projects.map((project) => (
                  <div key={project.projectId} className="pl-2">
                    <p className="text-sm">▸ {project.projectName}</p>
                    {project.stores.map((store) => storeRow(store))}
                  </div>
                ))}
              </DestinationGroup>
            )}

            {data.groups.length > 0 && (
              <DestinationGroup heading="◈ Groups" consequence="every member of the group">
                {data.groups.map((group) => (
                  <div key={group.groupId} className="pl-2">
                    <p className="text-sm">▸ {group.groupName}</p>
                    {group.stores.map((store) => storeRow(store, store.official ? 'Official Store ★' : undefined))}
                  </div>
                ))}
              </DestinationGroup>
            )}

            {data.characters.length > 0 && (
              <DestinationGroup
                heading="◈ Character vaults"
                consequence="that character only — shadows every farther tier"
              >
                {data.characters.map((character) =>
                  storeRow(
                    {
                      mountPointId: character.mountPointId,
                      mountName: character.characterName,
                      existingToolNames: character.existingToolNames,
                    },
                    'their vault'
                  )
                )}
              </DestinationGroup>
            )}

            {data.other.length > 0 && (
              <DestinationGroup heading="◈ Other stores" consequence="not attached to anything — inert until linked">
                {data.other.map((store) => storeRow(store))}
              </DestinationGroup>
            )}
          </div>
        )}

        {duplicateHere && selected && (
          <div className="text-xs qt-text-destructive space-y-1">
            <p>
              &ldquo;{toolName}&rdquo; is already on the table in {selected.mountName} — two files with one name in one
              store would both be refused at deal time.
            </p>
            {onOpenExisting && (
              <button
                type="button"
                className="qt-button qt-button-secondary qt-button-sm"
                onClick={() => onOpenExisting(selected.mountPointId)}
              >
                Open the existing one instead
              </button>
            )}
          </div>
        )}
        {!duplicateHere && nameElsewhere && (
          <p className="text-xs qt-text-secondary">
            This name is also on the table at another store; when both are in reach, the nearest tier wins.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="qt-button qt-button-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="qt-button qt-button-primary"
            disabled={!selected || duplicateHere}
            onClick={() => selected && onPick(selected)}
          >
            Keep it here
          </button>
        </div>
      </div>
    </div>
  )
}

function DestinationGroup({
  heading,
  consequence,
  children,
}: Readonly<{ heading: string; consequence: string; children: React.ReactNode }>) {
  return (
    <div>
      <p className="text-sm font-medium">
        {heading} <span className="text-xs qt-text-secondary font-normal">— {consequence}</span>
      </p>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  )
}

function allStores(data: CustomToolDestinations): DestinationStore[] {
  return [
    ...(data.general ? [data.general] : []),
    ...data.projects.flatMap((p) => p.stores),
    ...data.groups.flatMap((g) => g.stores),
    ...data.characters.map((c) => ({
      mountPointId: c.mountPointId,
      mountName: c.mountName,
      existingToolNames: c.existingToolNames,
    })),
    ...data.other,
  ]
}

export default DestinationPicker
