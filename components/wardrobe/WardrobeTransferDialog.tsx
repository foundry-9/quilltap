'use client'

import { useEffect, useMemo, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

type TransferMode = 'move' | 'copy'
type DestinationScope = 'general' | 'project' | 'group' | 'character'

interface DestinationOption {
  id: string
  name: string
}

interface DestinationsPayload {
  general: { available: boolean; label: string }
  projects: DestinationOption[]
  groups: DestinationOption[]
  users: DestinationOption[]
}

interface WardrobeTransferDialogProps {
  isOpen: boolean
  mode: TransferMode
  item: WardrobeItem
  sourceCharacterId: string
  sourceProjectId: string | null
  onClose: () => void
  onTransferred: () => Promise<void> | void
}

interface DestinationValue {
  scope: DestinationScope
  id: string | null
}

function encodeDestination(scope: DestinationScope, id: string | null): string {
  return `${scope}:${id ?? ''}`
}

function decodeDestination(value: string): DestinationValue | null {
  const [scopeRaw, idRaw] = value.split(':', 2)
  if (!scopeRaw) return null
  if (scopeRaw !== 'general' && scopeRaw !== 'project' && scopeRaw !== 'group' && scopeRaw !== 'character') {
    return null
  }
  const id = idRaw && idRaw.length > 0 ? idRaw : null
  return { scope: scopeRaw, id }
}

export function WardrobeTransferDialog({
  isOpen,
  mode,
  item,
  sourceCharacterId,
  sourceProjectId,
  onClose,
  onTransferred,
}: WardrobeTransferDialogProps) {
  const [loadingDestinations, setLoadingDestinations] = useState(false)
  const [destinations, setDestinations] = useState<DestinationsPayload | null>(null)
  const [selectedDestination, setSelectedDestination] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open; async fetch callback drives the lasting state
    setLoadingDestinations(true)
    setDestinations(null)
    setSelectedDestination('')

    void fetch('/api/v1/wardrobe/transfers')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load destinations (${res.status})`)
        return res.json() as Promise<{ destinations: DestinationsPayload }>
      })
      .then((body) => {
        setDestinations(body.destinations)
        if (body.destinations.general.available) {
          setSelectedDestination(encodeDestination('general', null))
        }
      })
      .catch((error) => {
        showErrorToast(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setLoadingDestinations(false)
      })
  }, [isOpen])

  const selection = useMemo(
    () => decodeDestination(selectedDestination),
    [selectedDestination],
  )

  const submitLabel = mode === 'move' ? 'Move item' : 'Copy item'
  const title = mode === 'move' ? 'Move wardrobe item' : 'Copy wardrobe item'

  const handleSubmit = async (): Promise<void> => {
    if (!selection) return
    setWorking(true)
    try {
      const res = await fetch('/api/v1/wardrobe/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          itemId: item.id,
          sourceCharacterId,
          sourceProjectId,
          destination: {
            scope: selection.scope,
            ...(selection.id ? { id: selection.id } : {}),
          },
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(body.error || `Failed to ${mode} wardrobe item`)
      }
      showSuccessToast(mode === 'move' ? `Moved "${item.title}"` : `Copied "${item.title}"`)
      await onTransferred()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="lg"
      closeOnClickOutside={!working}
      closeOnEscape={!working}
      footer={(
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="qt-button-secondary qt-button-sm"
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSubmit()
            }}
            className="qt-button-primary qt-button-sm"
            disabled={working || loadingDestinations || !selection}
          >
            {working ? (mode === 'move' ? 'Moving…' : 'Copying…') : submitLabel}
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <p className="qt-text-sm">
          {mode === 'move' ? 'Move' : 'Copy'} <span className="font-medium">&quot;{item.title}&quot;</span> to:
        </p>

        {loadingDestinations ? (
          <p className="qt-text-sm qt-text-secondary">Loading destinations…</p>
        ) : (
          <div>
            <label htmlFor="wardrobe-transfer-destination" className="qt-text-sm qt-text-secondary">
              Destination
            </label>
            <select
              id="wardrobe-transfer-destination"
              className="qt-select w-full mt-1"
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
              disabled={working}
            >
              {!destinations?.general.available &&
                destinations?.projects.length === 0 &&
                destinations?.groups.length === 0 &&
                destinations?.users.length === 0 && (
                  <option value="">No destinations available</option>
                )}

              {destinations?.general.available && (
                <optgroup label="General">
                  <option value={encodeDestination('general', null)}>{destinations.general.label}</option>
                </optgroup>
              )}

              {destinations && destinations.projects.length > 0 && (
                <optgroup label="Projects">
                  {destinations.projects.map((project) => (
                    <option
                      key={`project-${project.id}`}
                      value={encodeDestination('project', project.id)}
                    >
                      {project.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {destinations && destinations.groups.length > 0 && (
                <optgroup label="Groups">
                  {destinations.groups.map((group) => (
                    <option key={`group-${group.id}`} value={encodeDestination('group', group.id)}>
                      {group.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {destinations && destinations.users.length > 0 && (
                <optgroup label="Users">
                  {destinations.users.map((user) => (
                    <option
                      key={`character-${user.id}`}
                      value={encodeDestination('character', user.id)}
                    >
                      {user.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        <p className="qt-text-xs qt-text-secondary">
          Copy creates a new item ID in the destination. Move keeps the item ID and removes it from its current location.
        </p>
      </div>
    </BaseModal>
  )
}
