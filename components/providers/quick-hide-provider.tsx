'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/providers/session-provider'
import { conciergeStateUsesUncensoredRoute, type ConciergeState } from '@/lib/services/dangerous-content/chat-override'

interface QuickHideTag {
  id: string
  name: string
}

interface QuickHideContextValue {
  quickHideTags: QuickHideTag[]
  hiddenTagIds: Set<string>
  hideDangerousChats: boolean
  /**
   * When true, /salon includes autonomous rooms even when the user-level
   * visibility default would otherwise hide them. Persisted in localStorage
   * so the choice survives reloads.
   */
  includeAutonomousRooms: boolean
  loading: boolean
  toggleTag: (tagId: string) => void
  toggleHideDangerousChats: () => void
  toggleIncludeAutonomousRooms: () => void
  clearAllHidden: () => void
  refresh: () => Promise<void>
  shouldHideByIds: (tagIds?: Array<string | null | undefined>) => boolean
  /**
   * THE quick-hide rule for a chat, in one place. "Dangerous Chats" hides
   * whatever takes the uncensored route — Flagged (the Concierge's verdict)
   * and Uncensored (the operator's) — never a Vouched Safe chat that merely
   * carries a preserved label underneath.
   */
  shouldHideChat: (chat: { characterTags?: Array<string | null | undefined>; conciergeState?: ConciergeState }) => boolean
}

const STORAGE_KEY = 'quilltap.quickHide.activeTags'
const DANGER_STORAGE_KEY = 'quilltap.quickHide.hideDangerous'
const AUTONOMOUS_STORAGE_KEY = 'quilltap.quickHide.includeAutonomousRooms'

const QuickHideContext = createContext<QuickHideContextValue | null>(null)

async function fetchQuickHideTags(): Promise<QuickHideTag[]> {
  const res = await fetch('/api/v1/tags', { cache: 'no-store' })
  if (!res.ok) {
    throw new Error('Failed to load tags')
  }

  const data = await res.json()
  const allTags = data.tags || []
  const filtered = allTags.filter((tag: any) => Boolean(tag.quickHide))
  return filtered.map((tag: any) => ({ id: tag.id as string, name: tag.name as string }))
}

export function QuickHideProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const [quickHideTags, setQuickHideTags] = useState<QuickHideTag[]>([])
  const [hiddenTagIds, setHiddenTagIds] = useState<Set<string>>(new Set())
  const [hideDangerousChats, setHideDangerousChats] = useState(false)
  const [includeAutonomousRooms, setIncludeAutonomousRooms] = useState(false)
  const [loading, setLoading] = useState(true)
  const [storageReady, setStorageReady] = useState(false)

  const loadTags = useCallback(async () => {
    if (status !== 'authenticated') {
      setLoading(false)
      if (status === 'unauthenticated') {
        setQuickHideTags([])
      }
      return
    }

    try {
      setLoading(true)
      const tags = await fetchQuickHideTags()
      setQuickHideTags(tags)
      setHiddenTagIds(prev => {
        const allowed = new Set(tags.map(tag => tag.id))
        const next = new Set([...prev].filter(id => allowed.has(id)))
        return next.size === prev.size ? prev : next
      })
    } catch (error) {
      console.warn('Unable to load quick-hide tags', { error: error instanceof Error ? error.message : String(error) })
      setQuickHideTags([])
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; return signature contract predates useSWR migration
    loadTags()
  }, [loadTags])

  // localStorage read must happen after hydration; a lazy useState initializer
  // would cause an SSR mismatch (server renders with defaults, client with
  // localStorage values).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
          setHiddenTagIds(new Set(parsed.filter((id) => typeof id === 'string')))
        }
      }
      const dangerRaw = window.localStorage.getItem(DANGER_STORAGE_KEY)
      if (dangerRaw === 'true') {
        setHideDangerousChats(true)
      }
      const autoRaw = window.localStorage.getItem(AUTONOMOUS_STORAGE_KEY)
      if (autoRaw === 'true') {
        setIncludeAutonomousRooms(true)
      }
    } catch (error) {
      console.warn('Unable to load quick-hide preferences', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      setStorageReady(true)
    }
  }, [])

  useEffect(() => {
    if (!storageReady || typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(hiddenTagIds)))
      window.localStorage.setItem(DANGER_STORAGE_KEY, hideDangerousChats ? 'true' : 'false')
      window.localStorage.setItem(AUTONOMOUS_STORAGE_KEY, includeAutonomousRooms ? 'true' : 'false')
    } catch (error) {
      console.warn('Unable to persist quick-hide preferences', { error: error instanceof Error ? error.message : String(error) })
    }
  }, [hiddenTagIds, hideDangerousChats, includeAutonomousRooms, storageReady])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue)
          if (Array.isArray(parsed)) {
            setHiddenTagIds(new Set(parsed.filter((id) => typeof id === 'string')))
          }
        } catch {
          // ignore
        }
      }
      if (event.key === DANGER_STORAGE_KEY && event.newValue) {
        setHideDangerousChats(event.newValue === 'true')
      }
      if (event.key === AUTONOMOUS_STORAGE_KEY && event.newValue) {
        setIncludeAutonomousRooms(event.newValue === 'true')
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const toggleTag = useCallback((tagId: string) => {
    setHiddenTagIds((prev) => {
      const next = new Set(prev)
      const wasHidden = next.has(tagId)
      if (wasHidden) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
  }, [])

  const toggleHideDangerousChats = useCallback(() => {
    setHideDangerousChats(prev => !prev)
  }, [])

  const toggleIncludeAutonomousRooms = useCallback(() => {
    setIncludeAutonomousRooms(prev => !prev)
  }, [])

  const clearAllHidden = useCallback(() => {
    setHiddenTagIds(new Set())
    setHideDangerousChats(false)
    // Note: includeAutonomousRooms is an "include" toggle (adds items),
    // not a "hide" toggle, so it is not reset by Clear All Hidden.
  }, [])

  const shouldHideByIds = useCallback(
    (tagIds?: Array<string | null | undefined>) => {
      if (!tagIds || tagIds.length === 0) {
        return false
      }
      for (const tagId of tagIds) {
        if (tagId && hiddenTagIds.has(tagId)) {
          return true
        }
      }
      return false
    },
    [hiddenTagIds]
  )

  const shouldHideChat = useCallback(
    (chat: { characterTags?: Array<string | null | undefined>; conciergeState?: ConciergeState }) => {
      if (shouldHideByIds(chat.characterTags)) {
        return true
      }
      if (hideDangerousChats && chat.conciergeState && conciergeStateUsesUncensoredRoute(chat.conciergeState)) {
        return true
      }
      return false
    },
    [shouldHideByIds, hideDangerousChats]
  )

  const value = useMemo<QuickHideContextValue>(
    () => ({
      quickHideTags,
      hiddenTagIds,
      hideDangerousChats,
      includeAutonomousRooms,
      loading,
      toggleTag,
      toggleHideDangerousChats,
      toggleIncludeAutonomousRooms,
      clearAllHidden,
      refresh: loadTags,
      shouldHideByIds,
      shouldHideChat,
    }),
    [quickHideTags, hiddenTagIds, hideDangerousChats, includeAutonomousRooms, loading, toggleTag, toggleHideDangerousChats, toggleIncludeAutonomousRooms, clearAllHidden, loadTags, shouldHideByIds, shouldHideChat]
  )

  return <QuickHideContext.Provider value={value}>{children}</QuickHideContext.Provider>
}

export function useQuickHide() {
  const ctx = useContext(QuickHideContext)
  if (!ctx) {
    throw new Error('useQuickHide must be used within a QuickHideProvider')
  }
  return ctx
}
