'use client'

/**
 * Thin wrapper around the Terminals + Chats APIs for the salon Terminal Mode.
 */

import { patchChat } from '@/lib/chat/patch-chat'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type TerminalMode = 'normal' | 'split' | 'focus'

export interface TerminalSessionMeta {
  id: string
  chatId: string
  shell: string
  cwd: string
  label?: string | null
  startedAt: string
  exitedAt?: string | null
  exitCode?: number | null
}

interface SessionListResponse {
  sessions: TerminalSessionMeta[]
}

interface SessionGetResponse {
  session: TerminalSessionMeta
  ringBuffer: string | null
}

interface SpawnResponse {
  session: TerminalSessionMeta
}

async function expectOk(response: Response, fallbackMessage: string): Promise<void> {
  if (!response.ok) {
    let message = fallbackMessage
    try {
      const body = await response.text()
      if (body) message = body
    } catch {
      // swallow
    }
    throw new Error(message)
  }
}

async function parseJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  await expectOk(response, fallbackMessage)
  return response.json() as Promise<T>
}

export async function persistChatTerminalState(
  chatId: string,
  updates: Partial<{
    terminalMode: TerminalMode
    activeTerminalSessionId: string | null
    rightPaneVerticalSplit: number
  }>,
): Promise<void> {
  await patchChat(chatId, updates)
}

export async function listTerminalSessions(chatId: string): Promise<TerminalSessionMeta[]> {
  const response = await fetch(`/api/v1/terminals?chatId=${encodeURIComponent(chatId)}`)
  const data = await parseJson<SessionListResponse>(response, 'Failed to list terminal sessions')
  return data.sessions ?? []
}

export async function getTerminalSession(sessionId: string): Promise<TerminalSessionMeta | null> {
  const response = await fetch(`/api/v1/terminals/${sessionId}`)
  if (response.status === 404) return null
  const data = await parseJson<SessionGetResponse>(response, 'Failed to load terminal session')
  return data.session
}

export async function spawnTerminalSession(chatId: string): Promise<TerminalSessionMeta> {
  const response = await fetch('/api/v1/terminals', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chatId }),
  })
  const data = await parseJson<SpawnResponse>(response, 'Failed to spawn terminal session')
  return data.session
}

export async function killTerminalSessionApi(sessionId: string): Promise<void> {
  const response = await fetch(`/api/v1/terminals/${sessionId}?action=kill`, {
    method: 'POST',
  })
  await expectOk(response, 'Failed to terminate session')
}

export function isLiveSession(meta: TerminalSessionMeta | null): boolean {
  if (!meta) return false
  return !meta.exitedAt
}
