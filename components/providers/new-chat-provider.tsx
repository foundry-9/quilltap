'use client'

/**
 * NewChatProvider — opens the new-chat experience as an app-level modal so the
 * "Start a chat" entry points don't navigate to the full-page `/salon/new`
 * route (which, inside the workspace, would remount everything and tear down a
 * streaming Salon). It is mounted INSIDE the workspace providers so the modal's
 * `useNewChat` → `useWorkspaceNavigate` opens the new chat as a tab in place.
 *
 * The {@link WorkspaceLinkInterceptor} calls `open(...)` for `/salon/new` links,
 * including autonomous-room creation (`?autonomous=1`).
 *
 * @module components/providers/new-chat-provider
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { NewChatModal } from '@/components/new-chat/NewChatModal'

export interface NewChatModalOptions {
  characterId?: string
  characterName?: string
  projectId?: string
  continuationFromChatId?: string
  initialSelectedCharacterIds?: string[]
  initialUserCharacterId?: string | null
  initialImageProfileId?: string | null
  initialAvatarGenerationEnabled?: boolean
  /** Open in autonomous-room creation mode. */
  autonomous?: boolean
}

interface NewChatContextValue {
  open: (opts?: NewChatModalOptions) => void
}

const NewChatContext = createContext<NewChatContextValue | null>(null)

export function NewChatProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<NewChatModalOptions | null>(null)

  const open = useCallback((next: NewChatModalOptions = {}) => setOpts(next), [])
  const close = useCallback(() => setOpts(null), [])

  const value = useMemo<NewChatContextValue>(() => ({ open }), [open])

  return (
    <NewChatContext.Provider value={value}>
      {children}
      {opts && (
        <NewChatModal
          isOpen
          onClose={close}
          characterId={opts.characterId ?? ''}
          characterName={opts.characterName ?? ''}
          projectId={opts.projectId}
          continuationFromChatId={opts.continuationFromChatId}
          initialSelectedCharacterIds={opts.initialSelectedCharacterIds}
          initialUserCharacterId={opts.initialUserCharacterId}
          initialImageProfileId={opts.initialImageProfileId}
          initialAvatarGenerationEnabled={opts.initialAvatarGenerationEnabled}
          autonomous={opts.autonomous}
        />
      )}
    </NewChatContext.Provider>
  )
}

/** Returns the new-chat modal controller, or null outside the provider. */
export function useNewChatModalOptional(): NewChatContextValue | null {
  return useContext(NewChatContext)
}
