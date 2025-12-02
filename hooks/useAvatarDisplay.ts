import { useEffect, useState } from 'react'
import type { AvatarDisplayStyle } from '@/lib/avatar-styles'
import { clientLogger } from '@/lib/client-logger'

/**
 * Hook to get the current avatar display style setting from the user's preferences
 * Fetches from the API on mount and provides the style preference
 */
export function useAvatarDisplay() {
  const [style, setStyle] = useState<AvatarDisplayStyle>('CIRCULAR')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAvatarDisplayStyle = async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/chat-settings')
        if (!res.ok) {
          throw new Error('Failed to fetch chat settings')
        }
        const data = await res.json()
        setStyle((data.avatarDisplayStyle || 'CIRCULAR') as AvatarDisplayStyle)
      } catch (err) {
        clientLogger.error('Error fetching avatar display style:', { error: err instanceof Error ? err.message : String(err) })
        setError(err instanceof Error ? err.message : 'Unknown error')
        // Default to circular on error
        setStyle('CIRCULAR')
      } finally {
        setLoading(false)
      }
    }

    fetchAvatarDisplayStyle()
  }, [])

  const updateAvatarDisplayStyle = async (newStyle: AvatarDisplayStyle) => {
    try {
      setStyle(newStyle)
      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarDisplayStyle: newStyle }),
      })

      if (!res.ok) {
        throw new Error('Failed to update avatar display style')
      }

      const data = await res.json()
      setStyle((data.avatarDisplayStyle || 'CIRCULAR') as AvatarDisplayStyle)
    } catch (err) {
      clientLogger.error('Error updating avatar display style:', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : 'Unknown error')
      // Revert to previous style on error
      setStyle(style === 'CIRCULAR' ? 'RECTANGULAR' : 'CIRCULAR')
    }
  }

  return { style, loading, error, updateAvatarDisplayStyle }
}
