'use client'

import { useCallback, useEffect, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { AutonomousRoomCard } from './AutonomousRoomCard'
import { toAutonomousSettingsHint, type AutonomousSettingsHint } from './autonomous-settings-hint'
import type { NewChatAutonomousState } from './types'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

interface EditEnclaveModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Current room title, shown pre-filled and editable. */
  currentTitle: string
  /** Fired after a successful save with the (trimmed) new title. */
  onSaved?: (newTitle: string) => void
}

/** The room settings as they arrive from the autonomous-room status endpoint (milliseconds). */
interface RoomStatus {
  scheduleCron: string | null
  scheduleFreshnessWindowMs: number | null
  budgetMaxTurns: number | null
  budgetMaxTokens: number | null
  budgetMaxWallClockMs: number | null
  budgetEstimatedSpendCapUSD: number | null
  budgetExcludeCacheHits: number | null
  runVisibility: 'owner_only' | 'household' | 'open' | null
  runDestructiveToolsAllowed: number | null
}

const EMPTY_STATE: NewChatAutonomousState = {
  enabled: true,
  scheduleCron: '',
  scheduleFreshnessHours: null,
  budgetMaxTurns: null,
  budgetMaxTokens: null,
  budgetMaxWallClockMinutes: null,
  budgetEstimatedSpendCapUSD: null,
  runVisibility: null,
  runDestructiveToolsAllowed: false,
  budgetExcludeCacheHits: true,
}

/** Convert the status payload (ms) into the human-units form state the card edits. */
function statusToFormState(s: RoomStatus): NewChatAutonomousState {
  return {
    enabled: true,
    scheduleCron: s.scheduleCron ?? '',
    scheduleFreshnessHours:
      s.scheduleFreshnessWindowMs == null
        ? null
        : Math.round(s.scheduleFreshnessWindowMs / MS_PER_HOUR),
    budgetMaxTurns: s.budgetMaxTurns ?? null,
    budgetMaxTokens: s.budgetMaxTokens ?? null,
    budgetMaxWallClockMinutes:
      s.budgetMaxWallClockMs == null ? null : Math.round(s.budgetMaxWallClockMs / MS_PER_MINUTE),
    budgetEstimatedSpendCapUSD: s.budgetEstimatedSpendCapUSD ?? null,
    runVisibility: s.runVisibility ?? null,
    runDestructiveToolsAllowed: s.runDestructiveToolsAllowed === 1,
    // Default to excluding cache hits when the column is null/absent.
    budgetExcludeCacheHits: (s.budgetExcludeCacheHits ?? 1) === 1,
  }
}

/**
 * Edit Enclave modal — reuses the New Room form's AutonomousRoomCard to edit an
 * existing autonomous room ("enclave") in place. Reached from the Scheduled
 * Autonomous Rooms settings card and from the Salon sidebar's Organize card.
 *
 * Edits land on the live chat row and take effect on the running run's next turn
 * (the turn handler re-reads budget caps / cache mode / destructive flag every
 * turn) as well as becoming the settings for future runs. The card speaks human
 * units (hours, minutes); we convert ⇄ milliseconds at this API boundary only.
 */
export function EditEnclaveModal({
  isOpen,
  onClose,
  chatId,
  currentTitle,
  onSaved,
}: EditEnclaveModalProps) {
  const [title, setTitle] = useState(currentTitle)
  const [auto, setAuto] = useState<NewChatAutonomousState>(EMPTY_STATE)
  const [settingsHint, setSettingsHint] = useState<AutonomousSettingsHint | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Load current settings + the user-level hints each time the modal opens.
  useEffect(() => {
    if (!isOpen || !chatId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setLoadError(null)
      setTitle(currentTitle)
      try {
        const [statusRes, settingsRes] = await Promise.all([
          fetch(`/api/v1/chats/${chatId}/autonomous-room`),
          fetch('/api/v1/settings/chat'),
        ])
        if (cancelled) return

        if (!statusRes.ok) {
          throw new Error('Could not load this enclave’s settings.')
        }
        const status = (await statusRes.json()) as RoomStatus
        setAuto(statusToFormState(status))

        if (settingsRes.ok) {
          const settings = await settingsRes.json()
          setSettingsHint(toAutonomousSettingsHint(settings))
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Failed to load enclave settings'
        setLoadError(msg)
        console.error('[EditEnclaveModal] Failed to load settings', { chatId, error: msg })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [isOpen, chatId, currentTitle])

  const updateAuto = useCallback((patch: Partial<NewChatAutonomousState>) => {
    setAuto((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleSave = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      showErrorToast('Title cannot be empty')
      return
    }

    // Convert the card's human units back to the milliseconds the API/DB speak.
    // null clears a previously-set value; a number sets it.
    const body = {
      title: trimmedTitle,
      scheduleCron: auto.scheduleCron.trim(),
      scheduleFreshnessWindowMs:
        auto.scheduleFreshnessHours != null && auto.scheduleFreshnessHours > 0
          ? auto.scheduleFreshnessHours * MS_PER_HOUR
          : null,
      budgetMaxTurns: auto.budgetMaxTurns ?? null,
      budgetMaxTokens: auto.budgetMaxTokens ?? null,
      budgetMaxWallClockMs:
        auto.budgetMaxWallClockMinutes != null && auto.budgetMaxWallClockMinutes > 0
          ? auto.budgetMaxWallClockMinutes * MS_PER_MINUTE
          : null,
      budgetEstimatedSpendCapUSD: auto.budgetEstimatedSpendCapUSD ?? null,
      runVisibility: auto.runVisibility,
      runDestructiveToolsAllowed: auto.runDestructiveToolsAllowed,
      budgetExcludeCacheHits: auto.budgetExcludeCacheHits,
    }

    try {
      setSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}/autonomous-room?action=update-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to update enclave')
      }
      showSuccessToast('Enclave updated')
      onSaved?.(trimmedTitle)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update enclave'
      showErrorToast(msg)
      console.error('[EditEnclaveModal] Failed to save', { chatId, error: msg })
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={saving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || loading || !!loadError || !title.trim()}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Enclave"
      maxWidth="2xl"
      showCloseButton
      footer={footer}
    >
      {loadError ? (
        <div className="qt-alert-error">{loadError}</div>
      ) : loading ? (
        <div className="qt-text-secondary py-8 text-center">Loading enclave settings…</div>
      ) : (
        <div className="space-y-5">
          <div>
            <label htmlFor="edit-enclave-title" className="qt-label mb-1">
              Room Title
            </label>
            <input
              id="edit-enclave-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              placeholder="Name this enclave…"
              className="qt-input"
            />
            <p className="mt-1 qt-text-xs qt-text-muted">
              Setting a title here pins it — the automatic titler will leave it be.
            </p>
          </div>

          <AutonomousRoomCard
            value={auto}
            onChange={updateAuto}
            settingsHint={settingsHint}
            disabled={saving}
          />
        </div>
      )}
    </BaseModal>
  )
}

export default EditEnclaveModal
