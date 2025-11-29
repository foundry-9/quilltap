'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'

interface QuickHideTag {
  id: string
  name: string
}

interface QuickHideContextValue {
  quickHideTags: QuickHideTag[]
  hiddenTagIds: Set<string>
  loading: boolean
  toggleTag: (tagId: string) => void
  refresh: () => Promise<void>
  shouldHideByIds: (tagIds?: Array<string | null | undefined>) => boolean
}

const STORAGE_KEY = 'quilltap.quickHide.activeTags'

const QuickHideContext = createContext<QuickHideContextValue | null>(null)

async function fetchQuickHideTags(): Promise<QuickHideTag[]> {
  const res = await fetch('/api/tags', { cache: 'no-store' })
  if (!res.ok) {
    throw new Error('Failed to load tags')
  }

  const data = await res.json()
  return (data.tags || [])
    .filter((tag: any) => Boolean(tag.quickHide))
    .map((tag: any) => ({ id: tag.id as string, name: tag.name as string }))
}

export function QuickHideProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const [quickHideTags, setQuickHideTags] = useState<QuickHideTag[]>([])
  const [hiddenTagIds, setHiddenTagIds] = useState<Set<string>>(new Set())
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
      console.warn('Unable to load quick-hide tags', error)
      setQuickHideTags([])
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setHiddenTagIds(new Set(parsed.filter((id) => typeof id === 'string')))
        }
      }
    } catch (error) {
      console.warn('Unable to load quick-hide preferences', error)
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
    } catch (error) {
      console.warn('Unable to persist quick-hide preferences', error)
    }
  }, [hiddenTagIds, storageReady])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const parsed = JSON.parse(event.newValue)
        if (Array.isArray(parsed)) {
          setHiddenTagIds(new Set(parsed.filter((id) => typeof id === 'string')))
        }
      } catch {
        // ignore
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const toggleTag = useCallback((tagId: string) => {
    setHiddenTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
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

  const value = useMemo<QuickHideContextValue>(
    () => ({
      quickHideTags,
      hiddenTagIds,
      loading,
      toggleTag,
      refresh: loadTags,
      shouldHideByIds,
    }),
    [quickHideTags, hiddenTagIds, loading, toggleTag, loadTags, shouldHideByIds]
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
