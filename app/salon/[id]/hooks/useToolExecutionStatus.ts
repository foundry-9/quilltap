/**
 * The Salon's tool-execution notice — the strip above the composer that reads
 * "Generating image..." and then "Successfully generated 1 image!".
 *
 * Ownership of the notice's lifetime lives here rather than at the call sites
 * (bug 77). The banner used to be cleared only from the send path's `onDone`,
 * so any turn that finished by another route — a chain's intermediate done,
 * continue mode, an error, an autonomous turn — left it pinned above the
 * composer for the rest of the session with no affordance to remove it.
 *
 * @module app/salon/[id]/hooks/useToolExecutionStatus
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToolExecutionStatus {
  tool: string
  status: 'pending' | 'success' | 'error'
  message: string
}

/** How long a settled tool-execution notice lingers before it dismisses itself. */
export const TOOL_STATUS_DISMISS_MS = 6000

export interface ToolExecutionStatusController {
  /** The notice to render, or null for none. */
  toolExecutionStatus: ToolExecutionStatus | null
  /**
   * The single door for raising the notice. A `pending` status stays up until
   * it settles or the turn ends; a settled (`success`/`error`) one schedules
   * its own dismissal, so no caller has to remember to tear it down.
   */
  publishToolExecutionStatus: (status: ToolExecutionStatus) => void
  /** Clear the notice and any pending auto-dismiss timer, now. */
  dismissToolExecutionStatus: () => void
  /**
   * Turn-boundary cleanup: drop a notice that is still `pending` (its tool
   * result never arrived). A settled notice is left alone — its own
   * auto-dismiss countdown is already running, and cutting it short would rob
   * the user of the outcome they were waiting to read.
   */
  clearPendingToolExecutionStatus: () => void
}

export function useToolExecutionStatus(): ToolExecutionStatusController {
  const [toolExecutionStatus, setToolExecutionStatus] = useState<ToolExecutionStatus | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Never set state after teardown.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const dismissToolExecutionStatus = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToolExecutionStatus(null)
  }, [])

  const clearPendingToolExecutionStatus = useCallback(() => {
    setToolExecutionStatus(prev => (prev?.status === 'pending' ? null : prev))
  }, [])

  const publishToolExecutionStatus = useCallback((status: ToolExecutionStatus) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToolExecutionStatus(status)
    if (status.status !== 'pending') {
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setToolExecutionStatus(null)
      }, TOOL_STATUS_DISMISS_MS)
    }
  }, [])

  return {
    toolExecutionStatus,
    publishToolExecutionStatus,
    dismissToolExecutionStatus,
    clearPendingToolExecutionStatus,
  }
}
