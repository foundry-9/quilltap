'use client'

/**
 * Realtime Provider
 *
 * Wires the shared invalidation socket to this tab's QueryClient. Mounts once,
 * inside `QueryProvider`, and renders nothing.
 *
 * The contract is deliberately one-way and content-free: the server says
 * *something under this topic changed*, and we mark the matching query keys
 * stale. TanStack then refetches whatever is actually on screen through the
 * ordinary HTTP API, which stays the single source of truth for what the data
 * is. Invalidating a key nothing is watching is a no-op, which is why the
 * server can broadcast every event to every tab without a subscription
 * protocol.
 *
 * On (re)connect we invalidate every prefix this build knows about. A client
 * that was disconnected has no way to learn what it missed, so it re-reads
 * everything the socket could have told it about — the catch-up that makes a
 * dropped connection a latency problem rather than a correctness one.
 *
 * @module components/providers/realtime-provider
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { subscribeRealtime } from '@/lib/realtime/client'
import { ALL_REALTIME_PREFIXES, queryKeysForTopic } from '@/lib/realtime/topic-map'

export function RealtimeProvider({ children }: { children?: React.ReactNode }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    return subscribeRealtime({
      onEvent: (event) => {
        const prefixes = queryKeysForTopic(event.topic, event.id)
        if (prefixes.length === 0) {
          // An older client meeting a newer server. Shrug and carry on.
          if (process.env.NODE_ENV === 'development') {
            console.debug('[realtime] ignoring unknown topic', event.topic)
          }
          return
        }
        for (const queryKey of prefixes) {
          void queryClient.invalidateQueries({ queryKey })
        }
      },
      onOpen: () => {
        for (const queryKey of ALL_REALTIME_PREFIXES) {
          void queryClient.invalidateQueries({ queryKey })
        }
      },
    })
  }, [queryClient])

  return <>{children}</>
}
