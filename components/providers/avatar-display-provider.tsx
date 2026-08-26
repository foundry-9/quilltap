'use client'

/**
 * Avatar Display Provider
 *
 * Manages the avatar display style preference (circular vs rectangular) globally.
 * Fetches the preference from the API once and shares it with all components via context.
 * This prevents multiple components from making redundant API calls and ensures
 * consistent avatar styling across the entire application.
 *
 * @module components/providers/avatar-display-provider
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'

interface AvatarDisplayContextValue {
  /** Current avatar display style */
  style: AvatarDisplayStyle
  /** Whether the style is still being loaded */
  loading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Update the avatar display style (persists to API) */
  updateStyle: (newStyle: AvatarDisplayStyle) => Promise<void>
  /** Sync the avatar display style locally (does not call API - for use when API was already called elsewhere) */
  syncStyle: (newStyle: AvatarDisplayStyle) => void
}

const AvatarDisplayContext = createContext<AvatarDisplayContextValue | null>(null)

export function AvatarDisplayProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyle] = useState<AvatarDisplayStyle>('CIRCULAR')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Update CSS variable when style changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const radius = style === 'RECTANGULAR' ? 'var(--radius-md)' : '9999px'
      document.documentElement.style.setProperty('--qt-avatar-radius', radius)
    }
  }, [style])

  // Fetch avatar display style on mount
  useEffect(() => {
    const fetchAvatarDisplayStyle = async () => {
      try {
        setLoading(true)

        const res = await fetch('/api/v1/settings/chat')
        if (!res.ok) {
          // 401 is expected when not logged in - don't log as error
          if (res.status === 401) {
            setStyle('CIRCULAR')
            return
          }
          throw new Error(`Failed to fetch chat settings: ${res.status} ${res.statusText}`)
        }

        // Parse JSON separately to catch parse errors
        let data
        try {
          data = await res.json()
        } catch {
          setStyle('CIRCULAR')
          return
        }

        const fetchedStyle = (data.avatarDisplayStyle || 'CIRCULAR') as AvatarDisplayStyle
        setStyle(fetchedStyle)
      } catch (err) {
        // Network errors (like CORS, offline, etc.) are expected in some cases
        if (err instanceof TypeError && err.message.includes('fetch')) {
          setStyle('CIRCULAR')
          return
        }

        // Robust error extraction
        let errorMessage = 'Unknown error'
        if (err instanceof Error) {
          errorMessage = err.message || err.name || 'Error (no message)'
        } else if (typeof err === 'string') {
          errorMessage = err || 'Empty string error'
        } else if (err !== null && err !== undefined) {
          try {
            const stringified = JSON.stringify(err)
            errorMessage = stringified !== '{}' ? stringified : 'Empty object error'
          } catch {
            errorMessage = String(err) || 'Unstringifiable error'
          }
        }
        console.warn('AvatarDisplayProvider: Error fetching style', {
          error: errorMessage,
          errorType: err?.constructor?.name || typeof err
        })
        setError(errorMessage)
        // Default to circular on error
        setStyle('CIRCULAR')
      } finally {
        setLoading(false)
      }
    }

    fetchAvatarDisplayStyle()
  }, [])

  // Sync style locally without API call (used when API was already called elsewhere)
  const syncStyle = useCallback((newStyle: AvatarDisplayStyle) => {
    setStyle(newStyle)
  }, [])

  const updateStyle = useCallback(async (newStyle: AvatarDisplayStyle) => {
    const previousStyle = style
    try {
      // Optimistic update
      setStyle(newStyle)

      const res = await fetch('/api/v1/settings/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayStyle: newStyle }),
      })

      if (!res.ok) {
        throw new Error(`Failed to update avatar display style: ${res.status} ${res.statusText}`)
      }

      // Parse JSON separately to catch parse errors
      let data
      try {
        data = await res.json()
      } catch {
        // Update succeeded but response parse failed - keep the optimistic update
        return
      }

      const confirmedStyle = (data.avatarDisplayStyle || 'CIRCULAR') as AvatarDisplayStyle
      setStyle(confirmedStyle)
    } catch (err) {
      // Robust error extraction
      let errorMessage = 'Unknown error'
      if (err instanceof Error) {
        errorMessage = err.message || err.name || 'Error (no message)'
      } else if (typeof err === 'string') {
        errorMessage = err || 'Empty string error'
      } else if (err !== null && err !== undefined) {
        try {
          const stringified = JSON.stringify(err)
          errorMessage = stringified !== '{}' ? stringified : 'Empty object error'
        } catch {
          errorMessage = String(err) || 'Unstringifiable error'
        }
      }
      console.error('AvatarDisplayProvider: Error updating style', {
        error: errorMessage,
        errorType: err?.constructor?.name || typeof err,
        attemptedStyle: newStyle
      })
      setError(errorMessage)
      // Revert to previous style on error
      setStyle(previousStyle)
    }
  }, [style])

  const value = useMemo<AvatarDisplayContextValue>(
    () => ({
      style,
      loading,
      error,
      updateStyle,
      syncStyle,
    }),
    [style, loading, error, updateStyle, syncStyle]
  )

  return (
    <AvatarDisplayContext.Provider value={value}>
      {children}
    </AvatarDisplayContext.Provider>
  )
}

/**
 * Hook to access the avatar display context.
 * Must be used within an AvatarDisplayProvider.
 */
export function useAvatarDisplayContext() {
  const ctx = useContext(AvatarDisplayContext)
  if (!ctx) {
    throw new Error('useAvatarDisplayContext must be used within an AvatarDisplayProvider')
  }
  return ctx
}
