'use client'

/**
 * useInTabDrilldown
 *
 * The in-place drill-down scaffolding a list view needs when it is rendered
 * inside a workspace tab: whether it *is* in a tab (so picking an entry renders
 * its detail in place, keep-alive, instead of routing), which entry is picked,
 * and a re-sync when a deep-link re-open refreshes the tab payload with a new
 * `initialId`. Shared by Aurora (groups), Prospero (projects) and the
 * Scriptorium (stores).
 */

import { useState } from 'react'
import { useWorkspaceTabId } from './workspace-tab-context'

export interface InTabDrilldown {
  /** True when rendered inside a workspace tab, where detail renders in place. */
  inTab: boolean
  /** The entry currently drilled into, or `null` for the list. */
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}

/**
 * @param initialId The entry the tab payload asks to open, if any. A change
 *   in this prop (a deep-link re-open) follows into that entry.
 */
export function useInTabDrilldown(initialId?: string): InTabDrilldown {
  const inTab = useWorkspaceTabId() != null
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null)

  // A deep-link re-open refreshes the tab payload; follow it into the entry.
  // Adjusting state during render is React's sanctioned derive-from-prop-change
  // pattern (re-renders immediately, nothing committed in between).
  const [prevInitialId, setPrevInitialId] = useState(initialId)
  if (initialId !== prevInitialId) {
    setPrevInitialId(initialId)
    if (initialId) setSelectedId(initialId)
  }

  return { inTab, selectedId, setSelectedId }
}
