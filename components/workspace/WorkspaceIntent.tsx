'use client'

/**
 * WorkspaceIntent
 *
 * Consumes a transient `?open=` intent on the `/workspace` URL — opening (or
 * focusing) the requested tab — then strips the params so the resting URL is a
 * clean `/workspace`. This is the target the old per-surface routes redirect to
 * (Phase 6) and a convenient way to deep-link a tab.
 *
 * Examples:
 *   /workspace?open=aurora
 *   /workspace?open=salon&chatId=abc
 *   /workspace?open=settings&tab=system&section=memory
 *
 * @module components/workspace/WorkspaceIntent
 */

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { useNewChatModalOptional } from '@/components/providers/new-chat-provider'
import { standaloneDocKey, type DocumentStandaloneTabPayload, type TabKind } from '@/lib/workspace/types'

const OPENABLE_KINDS: ReadonlySet<TabKind> = new Set<TabKind>([
  'home',
  'salon',
  'salon-list',
  'terminal',
  'document',
  'aurora',
  'prospero',
  'scriptorium',
  'settings',
  'files',
  'photos',
  'scenarios',
  'brahma',
  'wardrobe',
  'profile',
  'about',
  'generate-image',
  'document-standalone',
  'character-new',
  'character-edit',
  'character-view',
  'settings-wizard',
  'custom-tools',
])

const CHAT_KINDS: ReadonlySet<TabKind> = new Set<TabKind>(['salon', 'terminal', 'document'])

export function WorkspaceIntent() {
  const { openTab, hydrated } = useWorkspace()
  const openNewChat = useNewChatModalOptional()?.open
  const router = useRouter()
  const searchParams = useSearchParams()
  const handledRef = useRef(false)

  useEffect(() => {
    // Wait for localStorage hydration first: applying the intent before the
    // provider's hydrate effect runs would let the subsequent REPLACE_STATE
    // clobber the just-opened tab (effects run child-first).
    if (!hydrated) return
    const open = searchParams.get('open')
    if (!open || handledRef.current) return
    handledRef.current = true

    // `open=new-chat` (the /salon/new redirect) is a modal, not a tab.
    if (open === 'new-chat') {
      openNewChat?.({
        projectId: searchParams.get('projectId') ?? undefined,
        characterId: searchParams.get('characterId') ?? undefined,
        autonomous: searchParams.get('autonomous') === '1',
      })
      router.replace('/workspace')
      return
    }

    const kind = open as TabKind
    if (OPENABLE_KINDS.has(kind)) {
      const chatId = searchParams.get('chatId') || undefined
      const tab = searchParams.get('tab') || undefined
      const section = searchParams.get('section') || undefined
      const characterId = searchParams.get('characterId') || undefined

      let payload: unknown
      if (CHAT_KINDS.has(kind)) payload = chatId ? { chatId } : undefined
      else if (kind === 'settings') payload = { tab, section }
      else if (kind === 'custom-tools') {
        const mountPointId = searchParams.get('mount') || undefined
        const path = searchParams.get('path') || undefined
        const create = searchParams.get('new') === '1' || undefined
        payload = mountPointId || path || create ? { mountPointId, path, create } : undefined
      }
      else if (kind === 'wardrobe') payload = characterId ? { characterId } : undefined
      else if (kind === 'character-edit' || kind === 'character-view') payload = characterId ? { characterId, tab } : undefined
      else if (kind === 'prospero') {
        const projectId = searchParams.get('projectId') || undefined
        payload = projectId ? { projectId } : undefined
      }
      else if (kind === 'scriptorium') {
        const storeId = searchParams.get('storeId') || undefined
        payload = storeId ? { storeId } : undefined
      }
      else if (kind === 'aurora') {
        const groupId = searchParams.get('groupId') || undefined
        payload = groupId ? { groupId } : undefined
      }
      else if (kind === 'document-standalone') {
        // Standalone Document Mode deep-link (the sidebar's legacy-shell path).
        const scope: DocumentStandaloneTabPayload['scope'] =
          searchParams.get('scope') === 'document_store' ? 'document_store' : 'general'
        const filePath = searchParams.get('filePath') || undefined
        const mountPoint = searchParams.get('mountPoint') || undefined
        const targetFolder = searchParams.get('targetFolder') || undefined
        payload = {
          docKey: standaloneDocKey(scope, mountPoint ?? null, filePath),
          scope,
          mountPoint: mountPoint ?? null,
          filePath,
          targetFolder,
        } satisfies DocumentStandaloneTabPayload
      }

      // Chat-bound kinds need a chatId and the character editor/detail needs a
      // characterId; skip opening when the required id is missing.
      const missingChatId = CHAT_KINDS.has(kind) && !chatId
      const missingCharacterId = (kind === 'character-edit' || kind === 'character-view') && !characterId
      if (!missingChatId && !missingCharacterId) {
        if (kind === 'terminal' && chatId) {
          // A terminal tab is a portal fed by its Salon view — open (and mount)
          // the conversation first, then the terminal as its child tab.
          const salonTabId = openTab('salon', { chatId })
          const sessionId = searchParams.get('sessionId') || undefined
          openTab('terminal', { chatId, sessionId }, { parentTabId: salonTabId })
        } else {
          openTab(kind, payload)
          // The character detail's `?action=chat` deep-link: also pop the
          // new-chat modal with the character preselected (legacy-page parity).
          if (kind === 'character-view' && characterId && searchParams.get('action') === 'chat') {
            openNewChat?.({ characterId })
          }
        }
      }
    }

    // Strip the intent params; keep the resting URL clean.
    router.replace('/workspace')
  }, [hydrated, searchParams, openTab, openNewChat, router])

  return null
}
