'use client'

/**
 * useCloseSelfTab — dismiss the workspace tab the caller is rendered in.
 *
 * Returns a function that, when invoked from inside the workspace, closes the
 * current tab and returns `true`. Outside the workspace (a legacy route) it does
 * nothing and returns `false`, so the caller can fall back to a router push.
 *
 * Used by editor/creator views (character edit, character new, the provider
 * setup wizard) whose "save"/"cancel" should dismiss their own tab rather than
 * navigate: closing returns focus to the adjacent, kept-alive tab they were
 * opened from — e.g. the Aurora grid, or the character detail still showing
 * exactly where the user left it (it was never unmounted).
 *
 * @module components/workspace/useCloseSelfTab
 */

import { useCallback } from 'react'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'

export function useCloseSelfTab(): () => boolean {
  const ws = useWorkspaceOptional()
  const tabId = useWorkspaceTabId()
  return useCallback(() => {
    if (ws && tabId) {
      ws.closeTab(tabId)
      return true
    }
    return false
  }, [ws, tabId])
}
