'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ImportWizard } from '@/components/import/import-wizard'
import { ChatCard } from '@/components/chat/ChatCard'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import {
  confirmAndDeleteChat,
  transformSalonChatToCardData,
  type SalonChatShape,
} from '@/lib/chat-utils'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'

type Chat = SalonChatShape

interface ChatSettingsResponse {
  autonomousRoomSettings?: {
    visibilityDefault?: 'owner_only' | 'household' | 'open'
  }
}

interface AutonomousRoomsListResponse {
  rooms: Array<{ id: string }>
}

export function SalonListView() {
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)
  const { shouldHideByIds, hideDangerousChats, includeAutonomousRooms } = useQuickHide()
  const bgStyle = useSubsystemBackgroundStyle('salon')

  const { data: chatSettings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettingsResponse>('/api/v1/settings/chat', { signal }),
  })
  const visibilityDefault = chatSettings?.autonomousRoomSettings?.visibilityDefault ?? 'owner_only'
  const wantsAutonomousByDefault = visibilityDefault !== 'owner_only'
  const effectiveIncludeAutonomous = wantsAutonomousByDefault || includeAutonomousRooms

  const { data: chatsData, isLoading: chatsLoading, error: chatsError, refetch: mutateChats } = useQuery({
    queryKey: queryKeys.chats.list({ includeAutonomous: effectiveIncludeAutonomous }),
    queryFn: ({ signal }) =>
      apiFetch<{ chats: Chat[] }>(
        effectiveIncludeAutonomous ? '/api/v1/chats?includeAutonomous=true' : '/api/v1/chats',
        { signal }
      ),
  })
  const { data: charactersData, isLoading: charactersLoading } = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) =>
      apiFetch<{ characters: Array<{ id: string; name: string; title?: string | null }> }>('/api/v1/characters', { signal }),
  })
  const { data: profilesData, isLoading: profilesLoading } = useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) =>
      apiFetch<{ profiles: Array<{ id: string; name: string }> }>('/api/v1/connection-profiles', { signal }),
  })

  // Whether the user actually owns any autonomous rooms — used to decide
  // whether to surface the "hidden" hint when the toggle is off. Cheap GET;
  // the management endpoint is already user-scoped.
  const { data: autonomousRoomsData } = useQuery({
    queryKey: queryKeys.system.autonomousRooms,
    queryFn: ({ signal }) => apiFetch<AutonomousRoomsListResponse>('/api/v1/system/autonomous-rooms', { signal }),
    enabled: !effectiveIncludeAutonomous,
  })
  const hasHiddenAutonomous = !effectiveIncludeAutonomous && (autonomousRoomsData?.rooms?.length ?? 0) > 0

  const chats = useMemo(() => chatsData?.chats ?? [], [chatsData])
  const characters = useMemo(
    () => (charactersData?.characters ?? []).map((c) => ({ id: c.id, name: c.name, title: c.title })),
    [charactersData]
  )
  const profiles = useMemo(
    () => (profilesData?.profiles ?? []).map((p) => ({ id: p.id, name: p.name })),
    [profilesData]
  )
  const loading = chatsLoading || charactersLoading || profilesLoading
  const error = chatsError ? (chatsError instanceof Error ? chatsError.message : 'An error occurred') : null

  const visibleChats = useMemo(
    () => chats.filter(chat => {
      // Collect all tag IDs: chat tags + all participant tags
      const allTagIds: string[] = chat.tags.map(ct => ct.tag.id)

      for (const participant of chat.participants) {
        if (participant.character?.tags) {
          allTagIds.push(...participant.character.tags)
        }
      }

      if (shouldHideByIds(allTagIds)) {
        return false
      }

      // Check danger filter using full chat metadata
      if (hideDangerousChats && chat.isDangerousChat === true) {
        return false
      }

      return true
    }),
    [chats, shouldHideByIds, hideDangerousChats]
  )

  // Auto-scroll and highlight imported chat
  useEffect(() => {
    if (highlightedChatId && importedChatRef.current) {
      importedChatRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Clear the highlight after animation completes (2.5 seconds)
      const timer = setTimeout(() => {
        setHighlightedChatId(null)
      }, 2500)

      return () => clearTimeout(timer)
    }
  }, [highlightedChatId])

  const deleteChat = async (id: string) => {
    if (await confirmAndDeleteChat(id)) {
      await mutateChats()
    }
  }

  const handleReextractMemories = useCallback(async (chatId: string) => {
    const confirmed = await showConfirmation(
      'This will delete all existing memories from this chat and re-extract them from the conversation. Are you sure?'
    )
    if (!confirmed) return

    try {
      await fetch(`/api/v1/memories?chatId=${chatId}`, { method: 'DELETE' })

      const res = await fetch(`/api/v1/chats/${chatId}?action=queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast(`Queued ${data.jobCount} memory extraction jobs`)
        notifyQueueChange()
        await mutateChats()
      } else {
        showErrorToast(data.error || 'Failed to queue memory extraction')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to re-extract memories')
    }
  }, [mutateChats])

  const handleRenderConversation = useCallback(async (chatId: string) => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=render-conversation`, {
        method: 'POST',
      })
      const data = await res.json()

      if (res.ok) {
        showSuccessToast('Conversation rendering queued')
        notifyQueueChange()
        await mutateChats()
      } else {
        showErrorToast(data.error || 'Failed to queue conversation rendering')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to render conversation')
    }
  }, [mutateChats])

  /**
   * Handle import completion from the new wizard
   */
  const handleImportComplete = useCallback(async (chatId: string) => {
    // Highlight the imported chat
    setHighlightedChatId(chatId)
    setImportDialogOpen(false)
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading chats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="chat-page qt-page-container text-foreground" style={bgStyle}>
      {/* Highlight animation styles */}
      <style>{`
        @keyframes chatCardHighlight {
          0% { opacity: 1; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(10px); }
          100% { opacity: 0; transform: translateX(10px); }
        }
        .chat-card-highlight-arrow {
          animation: chatCardHighlight 2.5s ease-out forwards;
        }
      `}</style>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <h1 className="qt-heading-1 leading-tight">Chats</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button chat-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import SillyTavern Chat
          </button>
          <Link
            href="/salon/new?autonomous=1"
            className="qt-button chat-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Create an autonomous character-to-character room"
          >
            New Autonomous Room
          </Link>
          <Link
            href="/salon/new"
            className="qt-button chat-toolbar__button chat-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-md transition hover:qt-bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New Chat
          </Link>
        </div>
      </div>

      {hasHiddenAutonomous && (
        <div className="mb-6 rounded-lg border qt-border-default qt-bg-muted/40 px-4 py-3 qt-text-secondary qt-body-sm">
          You have autonomous rooms hidden by your visibility default. Toggle <em>Show Autonomous Rooms</em> in the user menu to include them.
        </div>
      )}

      {visibleChats.length === 0 ? (
        <div className="chat-empty-state mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
          <p className="mb-4 text-lg qt-text-small">No chats yet</p>
          <Link
            href="/salon/new"
            className="font-medium text-primary hover:text-primary/80"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <div className="chat-card-stack space-y-4">
          {visibleChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={transformSalonChatToCardData(chat)}
              showAvatars={true}
              showProject={true}
              actionType="delete"
              onDelete={deleteChat}
              onReextractMemories={handleReextractMemories}
              onRenderConversation={handleRenderConversation}
              highlighted={highlightedChatId === chat.id}
              cardRef={highlightedChatId === chat.id ? importedChatRef : undefined}
            />
          ))}
        </div>
      )}

      {/* Import Wizard */}
      {importDialogOpen && (
        <ImportWizard
          characters={characters}
          profiles={profiles}
          onClose={() => setImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
        />
      )}
    </div>
  )
}
