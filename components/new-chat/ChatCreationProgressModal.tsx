'use client'

/**
 * ChatCreationProgressModal — "The Green Room".
 *
 * A blocking, non-dismissable status dialog shown while a new conversation is
 * being assembled (both fresh starts and "Continue Elsewhere"). It narrates the
 * slow, otherwise-silent creation window: setup milestones, and — for each
 * LLM-run character choosing what to wear — a "consulting the wardrobe" panel
 * that resolves into the decided four-slot outfit. A scrolling activity log runs
 * beneath.
 *
 * It cannot be dismissed while creation runs (backdrop click and Escape are
 * disabled, no close button); it closes on its own when the create request
 * resolves. Only on failure does it offer a Close button.
 *
 * @module components/new-chat/ChatCreationProgressModal
 */

import { useEffect, useRef } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { OutfitSlotsPreview } from '@/components/wardrobe/OutfitSlotsPreview'
import type { CreationProgressState } from '@/components/providers/creation-progress-provider'

interface ChatCreationProgressModalProps {
  state: CreationProgressState
  onClose: () => void
}

function logColor(level: 'info' | 'warn' | 'error'): string {
  if (level === 'error') return 'qt-text-danger'
  if (level === 'warn') return 'qt-text-warning'
  return 'qt-text-secondary'
}

export function ChatCreationProgressModal({ state, onClose }: ChatCreationProgressModalProps) {
  const logRef = useRef<HTMLDivElement>(null)

  // Keep the newest log line in view as entries stream in.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.logs])

  const isError = state.phase === 'error'
  const isDone = state.phase === 'done'

  return (
    <BaseModal
      isOpen={state.open}
      onClose={onClose}
      title="The Green Room"
      maxWidth="2xl"
      showCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      footer={
        isError ? (
          <div className="flex justify-end">
            <button type="button" className="qt-button-primary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {/* Headline: what's going on right now */}
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          {!isError && !isDone && (
            <span className="qt-bg-accent inline-block h-2 w-2 flex-shrink-0 animate-pulse rounded-full" />
          )}
          <span className="qt-text-primary text-sm font-medium">
            {state.status || 'Setting the stage…'}
          </span>
        </div>

        {isError && state.errorMessage && (
          <div className="qt-text-danger text-sm">{state.errorMessage}</div>
        )}

        {/* Per-character wardrobe consultations */}
        {state.wardrobe.length > 0 && (
          <div className="flex flex-col gap-3">
            {state.wardrobe.map((panel) => (
              <div key={panel.characterId} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {panel.slots === null && (
                    <span className="border-t-transparent inline-block h-3 w-3 animate-spin rounded-full border-2 border-current opacity-70" />
                  )}
                  <span className="qt-text-primary text-sm font-semibold">{panel.characterName}</span>
                  <span className="qt-text-tertiary text-xs">
                    {panel.slots === null ? 'consulting the wardrobe…' : 'is wearing'}
                  </span>
                </div>
                {panel.slots !== null && <OutfitSlotsPreview slots={panel.slots} />}
              </div>
            ))}
          </div>
        )}

        {/* Scrolling activity log */}
        {state.logs.length > 0 && (
          <div className="qt-divider mt-1 border-t pt-3">
            <div className="qt-text-tertiary mb-2 text-xs uppercase tracking-wide">Activity</div>
            <div ref={logRef} className="max-h-40 overflow-y-auto pr-1">
              <ul className="flex flex-col gap-1 text-sm">
                {state.logs.map((entry, i) => (
                  <li key={`${entry.ts}-${i}`} className={logColor(entry.level)}>
                    <span className="qt-text-tertiary mr-2 tabular-nums">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                    {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  )
}

export default ChatCreationProgressModal
