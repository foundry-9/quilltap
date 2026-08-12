'use client'

/**
 * CreationProgressProvider — drives the blocking chat-creation status dialog
 * ("The Green Room").
 *
 * When the user starts a fresh conversation (or "Continue Elsewhere"),
 * `useNewChat` generates a `progressId`, calls {@link begin} to open the dialog
 * and subscribe to `GET /api/v1/chats/creation-progress?id=…`, then POSTs the
 * create request carrying that same id. The server publishes setup milestones
 * and per-character LLM wardrobe choices; this provider accumulates them and
 * renders {@link ChatCreationProgressModal}.
 *
 * The dialog is non-dismissable while creation runs; the POST resolving is the
 * authoritative "ready" signal ({@link complete}) that closes it and lets
 * navigation into the Salon proceed. On failure ({@link fail} or a server
 * `error` event) it surfaces a Close button.
 *
 * Mounted just OUTSIDE NewChatProvider so the dialog outlives the NewChatModal
 * closing.
 *
 * @module components/providers/creation-progress-provider
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { CreationProgressEvent, OutfitPreviewSlots } from '@/lib/chat/creation-progress'
import { ChatCreationProgressModal } from '@/components/new-chat/ChatCreationProgressModal'

export interface CreationProgressLogEntry {
  message: string
  level: 'info' | 'warn' | 'error'
  ts: number
}

export interface CreationProgressWardrobePanel {
  characterId: string
  characterName: string
  /** null while the character is still "consulting the wardrobe". */
  slots: OutfitPreviewSlots | null
}

export interface CreationProgressState {
  open: boolean
  status: string
  logs: CreationProgressLogEntry[]
  wardrobe: CreationProgressWardrobePanel[]
  phase: 'running' | 'done' | 'error'
  errorMessage: string | null
}

const INITIAL: CreationProgressState = {
  open: false,
  status: '',
  logs: [],
  wardrobe: [],
  phase: 'running',
  errorMessage: null,
}

const MAX_LOGS = 100

interface CreationProgressContextValue {
  /** Open the dialog and start streaming progress for this correlation id. */
  begin: (progressId: string) => void
  /** Creation succeeded (POST resolved) — close the dialog. */
  complete: () => void
  /** Creation failed — surface the message and a Close button. */
  fail: (message: string) => void
}

const CreationProgressContext = createContext<CreationProgressContextValue | null>(null)

function appendLog(
  logs: CreationProgressLogEntry[],
  entry: CreationProgressLogEntry,
): CreationProgressLogEntry[] {
  const next = [...logs, entry]
  return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
}

function upsertWardrobe(
  panels: CreationProgressWardrobePanel[],
  panel: CreationProgressWardrobePanel,
): CreationProgressWardrobePanel[] {
  const idx = panels.findIndex((p) => p.characterId === panel.characterId)
  if (idx === -1) return [...panels, panel]
  const next = [...panels]
  // Keep an already-resolved outfit if a later event lacks slots.
  next[idx] = { ...next[idx], ...panel, slots: panel.slots ?? next[idx].slots }
  return next
}

export function CreationProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CreationProgressState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  const applyEvent = useCallback((evt: CreationProgressEvent) => {
    setState((prev) => {
      if (!prev.open) return prev
      switch (evt.kind) {
        case 'status':
          return {
            ...prev,
            status: evt.message,
            logs: appendLog(prev.logs, { message: evt.message, level: 'info', ts: evt.ts }),
          }
        case 'log':
          return {
            ...prev,
            logs: appendLog(prev.logs, {
              message: evt.message,
              level: evt.level ?? 'info',
              ts: evt.ts,
            }),
          }
        case 'wardrobe-start':
          return {
            ...prev,
            wardrobe: upsertWardrobe(prev.wardrobe, {
              characterId: evt.characterId,
              characterName: evt.characterName,
              slots: null,
            }),
            logs: appendLog(prev.logs, {
              message: `Consulting the wardrobe for ${evt.characterName}…`,
              level: 'info',
              ts: evt.ts,
            }),
          }
        case 'wardrobe-result':
          return {
            ...prev,
            wardrobe: upsertWardrobe(prev.wardrobe, {
              characterId: evt.characterId,
              characterName: evt.characterName,
              slots: evt.slots,
            }),
            logs: appendLog(prev.logs, {
              message: `${evt.characterName} is dressed and ready.`,
              level: 'info',
              ts: evt.ts,
            }),
          }
        case 'done':
          return { ...prev, phase: 'done', status: prev.status || 'The players are ready.' }
        case 'error':
          return {
            ...prev,
            phase: 'error',
            errorMessage: evt.message,
            status: 'Something went awry.',
          }
        default:
          return prev
      }
    })
  }, [])

  const startReader = useCallback(
    async (progressId: string, signal: AbortSignal) => {
      try {
        const res = await fetch(
          `/api/v1/chats/creation-progress?id=${encodeURIComponent(progressId)}`,
          { signal, headers: { Accept: 'text/event-stream' } },
        )
        if (!res.ok || !res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw) continue
            try {
              applyEvent(JSON.parse(raw) as CreationProgressEvent)
            } catch {
              // Ignore chunking artifacts / malformed frames.
            }
          }
        }
      } catch {
        // Aborted (dialog closed) or a transient network error — the POST's own
        // resolution drives dialog closure, so nothing to do here.
      }
    },
    [applyEvent],
  )

  const close = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(INITIAL)
  }, [])

  const begin = useCallback(
    (progressId: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState({
        ...INITIAL,
        open: true,
        status: 'Fetching the players from the green room…',
      })
      void startReader(progressId, controller.signal)
    },
    [startReader],
  )

  const complete = useCallback(() => {
    close()
  }, [close])

  const fail = useCallback((message: string) => {
    // Stop streaming but KEEP the dialog open so the user can read the error and
    // dismiss it deliberately.
    abortRef.current?.abort()
    abortRef.current = null
    setState((prev) =>
      prev.open
        ? { ...prev, phase: 'error', errorMessage: message, status: 'Something went awry.' }
        : prev,
    )
  }, [])

  const value = useMemo<CreationProgressContextValue>(
    () => ({ begin, complete, fail }),
    [begin, complete, fail],
  )

  return (
    <CreationProgressContext.Provider value={value}>
      {children}
      <ChatCreationProgressModal state={state} onClose={close} />
    </CreationProgressContext.Provider>
  )
}

/** Controller for the chat-creation status dialog, or null outside the provider. */
export function useCreationProgress(): CreationProgressContextValue | null {
  return useContext(CreationProgressContext)
}
