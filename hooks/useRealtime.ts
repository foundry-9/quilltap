'use client'

/**
 * React bindings for the realtime hub.
 *
 * Two things components need from the socket: whether it is up, and what
 * interval to fall back to while it is not.
 *
 * @module hooks/useRealtime
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
  getRealtimeStatus,
  subscribeRealtime,
  subscribeRealtimeStatus,
} from '@/lib/realtime/client'

/**
 * Whether the realtime socket is currently connected.
 *
 * Re-renders on every connection-state change, which is exactly what makes
 * {@link useRealtimeRefetchInterval} work: TanStack re-reads a query's options
 * on re-render, so the fallback interval engages the moment the socket drops.
 */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    subscribeRealtimeStatus,
    () => getRealtimeStatus() === 'connected',
    // The server never has a socket, and a poll is the honest SSR answer.
    () => false,
  )
}

/**
 * A `refetchInterval` value that polls only while the socket is down.
 *
 * Every migrated site keeps its original cadence wired but gated this way, so
 * a dropped connection degrades to the behaviour that shipped before realtime
 * existed rather than to a frozen screen.
 *
 * @param pollMs The pre-realtime cadence, or `false` to disable polling
 *   outright (e.g. a watch that has already seen what it was waiting for).
 *
 * @example
 * const { data } = useQuery({
 *   queryKey: queryKeys.system.autonomousRooms,
 *   queryFn: …,
 *   refetchInterval: useRealtimeRefetchInterval(5_000),
 * })
 */
export function useRealtimeRefetchInterval(pollMs: number | false): number | false {
  const connected = useRealtimeConnected()
  if (pollMs === false) return false
  return connected ? false : pollMs
}

/**
 * Run `onTick` on a timer, but only while the socket is down — and, when
 * `active` is given, only while it is true (e.g. while a sweep is in flight).
 *
 * The offline half of the housekeeping-card pattern: {@link useRealtimeTopic}
 * carries the live path, and this keeps the pre-realtime cadence as the
 * fallback so a dropped connection degrades to the behaviour that shipped
 * before realtime existed rather than to a frozen screen.
 *
 * The handler is held in a ref, so an inline arrow function won't churn the
 * interval on every render.
 *
 * @param onTick Called on each poll tick.
 * @param pollMs The pre-realtime cadence.
 * @param active Optional gate; omit to poll whenever the socket is down.
 */
export function useRealtimeFallbackPoll(onTick: () => void, pollMs: number, active?: boolean): void {
  const connected = useRealtimeConnected()
  const handlerRef = useRef(onTick)
  useEffect(() => {
    handlerRef.current = onTick
  }, [onTick])

  useEffect(() => {
    if (connected || active === false) return
    const interval = setInterval(() => {
      handlerRef.current()
    }, pollMs)
    return () => clearInterval(interval)
  }, [connected, active, pollMs])
}

/**
 * Run `onChange` whenever the server announces a change under `topic`.
 *
 * The escape hatch for readouts that aren't (yet) TanStack queries — the
 * housekeeping cards in Settings, and the Salon's avatar watch, still drive
 * their own `fetch` calls. Those keep their interval as the offline fallback
 * and use this for the live path.
 *
 * The handler is held in a ref, so an inline arrow function won't churn the
 * subscription on every render.
 *
 * @param topic The topic to listen for, e.g. `'jobs'`.
 * @param onChange Called on a matching event, and again on every (re)connect —
 *   a reconnecting client has no idea what it missed.
 * @param id Optional entity id. When given, only events for that row fire — plus
 *   collection-wide events for the topic, which carry no id and therefore say
 *   nothing about which rows they cover.
 */
export function useRealtimeTopic(topic: string, onChange: () => void, id?: string): void {
  const handlerRef = useRef(onChange)
  useEffect(() => {
    handlerRef.current = onChange
  }, [onChange])

  useEffect(() => {
    return subscribeRealtime({
      onEvent: (event) => {
        if (event.topic !== topic) return
        if (id && event.id && event.id !== id) return
        handlerRef.current()
      },
      onOpen: () => handlerRef.current(),
    })
  }, [topic, id])
}
