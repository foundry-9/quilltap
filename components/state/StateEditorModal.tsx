'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

export type StateEntityType = 'chat' | 'project' | 'group' | 'general'

interface StateEditorModalProps {
  isOpen: boolean
  onClose: () => void
  entityType: StateEntityType
  /** Entity id. Ignored for the instance-wide 'general' tier. */
  entityId?: string
  entityName?: string
  onSuccess?: () => void
}

interface GroupTier {
  status: 'none' | 'single' | 'ambiguous'
  candidates: Array<{ id: string; name: string }>
  appliedGroupId?: string
}

interface StateResponse {
  state: Record<string, unknown>
  chatState?: Record<string, unknown>
  projectState?: Record<string, unknown> | null
  groupState?: Record<string, unknown> | null
  generalState?: Record<string, unknown> | null
  groupTier?: GroupTier
  projectId?: string
}

/**
 * Per-entity-type wiring: the query key and the three action URLs. The chat
 * tier is the only one that surfaces inherited layers (project / group /
 * general) beneath its own state; the others edit a single tier directly.
 */
function endpointConfig(entityType: StateEntityType, entityId: string) {
  switch (entityType) {
    case 'chat':
      return {
        queryKey: queryKeys.chats.state(entityId),
        getUrl: `/api/v1/chats/${entityId}?action=get-state`,
        setUrl: `/api/v1/chats/${entityId}?action=set-state`,
        resetUrl: `/api/v1/chats/${entityId}?action=reset-state`,
        label: 'Chat',
      }
    case 'project':
      return {
        queryKey: queryKeys.projects.state(entityId),
        getUrl: `/api/v1/projects/${entityId}?action=get-state`,
        setUrl: `/api/v1/projects/${entityId}?action=set-state`,
        resetUrl: `/api/v1/projects/${entityId}?action=reset-state`,
        label: 'Project',
      }
    case 'group':
      return {
        queryKey: queryKeys.groups.state(entityId),
        getUrl: `/api/v1/groups/${entityId}?action=get-state`,
        setUrl: `/api/v1/groups/${entityId}?action=set-state`,
        resetUrl: `/api/v1/groups/${entityId}?action=reset-state`,
        label: 'Group',
      }
    case 'general':
      return {
        queryKey: queryKeys.settings.generalState,
        getUrl: `/api/v1/settings/general-state`,
        setUrl: `/api/v1/settings/general-state`,
        resetUrl: `/api/v1/settings/general-state`,
        label: 'General',
      }
  }
}

export default function StateEditorModal({
  isOpen,
  onClose,
  entityType,
  entityId = '',
  entityName,
  onSuccess,
}: Readonly<StateEditorModalProps>) {
  const cfg = endpointConfig(entityType, entityId)

  const [state, setState] = useState<Record<string, unknown>>({})
  const [projectState, setProjectState] = useState<Record<string, unknown> | null>(null)
  const [groupState, setGroupState] = useState<Record<string, unknown> | null>(null)
  const [generalState, setGeneralState] = useState<Record<string, unknown> | null>(null)
  const [groupTier, setGroupTier] = useState<GroupTier | null>(null)
  const [stateText, setStateText] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Fetch state via TanStack Query (gated by isOpen). `cfg.getUrl` is derived
  // from the same (entityType, entityId) inputs as `cfg.queryKey`, so the
  // factory key already uniquely identifies the request — don't append the raw
  // URL to a query-key factory value (keys are the single source of truth).
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- getUrl is a pure function of the same inputs as queryKey
  const { data: stateData, isPending: loading, refetch: mutateState } = useQuery({
    queryKey: cfg.queryKey,
    queryFn: ({ signal }) => apiFetch<StateResponse>(cfg.getUrl, { signal }),
    enabled: isOpen,
  })

  // Sync state data when fetched
  useEffect(() => {
    if (!stateData) return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset fires only on open; parent renders unconditionally
    setState(stateData.state || {})
    setStateText(JSON.stringify(stateData.state || {}, null, 2))

    if (entityType === 'chat') {
      setProjectState(stateData.projectState || null)
      setGroupState(stateData.groupState || null)
      setGeneralState(stateData.generalState || null)
      setGroupTier(stateData.groupTier || null)
    }

    setIsEditing(false)
  }, [stateData, entityType])

  const handleTextChange = (value: string) => {
    setStateText(value)
    try {
      JSON.parse(value)
      setJsonError(null)
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const handleSave = async () => {
    try {
      const newState = JSON.parse(stateText)

      if (typeof newState !== 'object' || newState === null || Array.isArray(newState)) {
        showErrorToast('State must be a JSON object')
        return
      }

      setSaving(true)

      const res = await fetch(cfg.setUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to save state')
      }

      await mutateState()
      setState(newState)
      setStateText(JSON.stringify(newState, null, 2))
      setIsEditing(false)
      showSuccessToast('State saved')
      onSuccess?.()
    } catch (error) {
      console.error('[StateEditorModal] Failed to save state', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to save state')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    try {
      setResetting(true)

      const res = await fetch(cfg.resetUrl, { method: 'DELETE' })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to reset state')
      }

      await mutateState()
      setState({})
      setStateText(JSON.stringify({}, null, 2))
      setIsEditing(false)
      setShowResetConfirm(false)
      showSuccessToast('State reset')
      onSuccess?.()
    } catch (error) {
      console.error('[StateEditorModal] Failed to reset state', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to reset state')
    } finally {
      setResetting(false)
    }
  }

  const handleCancel = () => {
    setStateText(JSON.stringify(state, null, 2))
    setJsonError(null)
    setIsEditing(false)
  }

  const isLoading = loading || saving || resetting
  const hasState = Object.keys(state).length > 0

  const title = entityType === 'general'
    ? 'General State'
    : `${cfg.label} State${entityName ? ` - ${entityName}` : ''}`

  const footer = (
    <div className="flex justify-between gap-2">
      <div>
        {!showResetConfirm && hasState && (
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={isLoading}
            className="qt-button qt-button-danger-outline"
          >
            Reset State
          </button>
        )}
        {showResetConfirm && (
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={isLoading}
              className="qt-button qt-button-danger"
            >
              {resetting ? 'Resetting...' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => setShowResetConfirm(false)}
              disabled={isLoading}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {isEditing ? (
          <>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading || !!jsonError}
              className="qt-button qt-button-primary"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="qt-button qt-button-secondary"
            >
              Close
            </button>
            <button
              onClick={() => setIsEditing(true)}
              disabled={isLoading}
              className="qt-button qt-button-primary"
            >
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  )

  // Inherited-layer summaries shown only for the chat tier (the merged view).
  const inheritedLayers: Array<{ label: string; keys: string[] }> = []
  if (entityType === 'chat') {
    if (projectState && Object.keys(projectState).length > 0) {
      inheritedLayers.push({ label: 'project', keys: Object.keys(projectState) })
    }
    if (groupState && Object.keys(groupState).length > 0) {
      inheritedLayers.push({ label: 'group', keys: Object.keys(groupState) })
    }
    if (generalState && Object.keys(generalState).length > 0) {
      inheritedLayers.push({ label: 'general', keys: Object.keys(generalState) })
    }
  }
  const ambiguousGroups = entityType === 'chat' && groupTier?.status === 'ambiguous'

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="2xl"
      footer={footer}
      closeOnClickOutside={!isEditing}
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <svg
            className="animate-spin h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="ml-2">Loading state...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Info section for chat state inheritance across the cascade */}
          {entityType === 'chat' && (inheritedLayers.length > 0 || ambiguousGroups) && (
            <div className="qt-text-xs p-3 qt-bg-muted rounded-md">
              <p className="mb-1">
                <strong>Note:</strong> The merged state below layers the cascade
                (chat over project over group over general — narrower tiers win).
              </p>
              {inheritedLayers.map((layer) => (
                <p key={layer.label} className="qt-text-secondary">
                  Inherited from {layer.label}: {layer.keys.join(', ')}
                </p>
              ))}
              {ambiguousGroups && (
                <p className="qt-text-secondary mt-1">
                  {groupTier!.candidates.length} groups apply — group state is not merged here.
                  Edit each group&rsquo;s state from its own page.
                </p>
              )}
            </div>
          )}

          {/* State editor */}
          <div>
            <label className="qt-label mb-2 flex items-center justify-between">
              <span>State (JSON)</span>
              {!hasState && !isEditing && (
                <span className="qt-text-xs qt-text-secondary">No state data</span>
              )}
            </label>
            <textarea
              value={stateText}
              onChange={(e) => handleTextChange(e.target.value)}
              readOnly={!isEditing}
              rows={12}
              className={`qt-textarea font-mono text-sm w-full ${
                isEditing ? '' : 'qt-bg-muted cursor-default'
              } ${jsonError ? 'qt-border-destructive' : ''}`}
              placeholder={isEditing ? '{\n  "key": "value"\n}' : 'No state data'}
            />
            {jsonError && isEditing && (
              <p className="qt-text-xs qt-text-destructive mt-1">
                {jsonError}
              </p>
            )}
          </div>

          {/* Help text */}
          <div className="qt-text-xs qt-text-secondary">
            <p className="mb-1">
              State is persistent JSON data that can be used for games, inventory tracking,
              session data, and other information.
            </p>
            <p>
              Keys starting with underscore (_) are user-only and will not be modified by AI.
            </p>
          </div>
        </div>
      )}
    </BaseModal>
  )
}
