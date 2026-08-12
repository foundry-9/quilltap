'use client'

import type { Message } from '../types'
import type { ActiveDocument, DocumentMode } from './useDocumentMode'

type DocumentScope = ActiveDocument['scope']

interface ActiveDocumentRecord {
  id: string
  filePath: string
  scope: DocumentScope
  mountPoint?: string | null
  displayTitle?: string
}

interface ActiveDocumentResponse {
  document: ActiveDocumentRecord | null
}

interface OpenDocumentsResponse {
  documents: ActiveDocumentRecord[]
}

interface ReadDocumentResponse {
  content?: string
  mtime?: number
}

interface ResolveDocumentResponse {
  exists: boolean
  kind: 'document' | 'image' | 'other'
}

interface OpenDocumentResponse {
  document: ActiveDocumentRecord
  content?: string
  mtime?: number
  /** Librarian announcement message posted alongside the open (null if chat not found) */
  librarianMessage?: Message | null
}

interface ChatStateResponse {
  chat?: {
    documentMode?: DocumentMode
    dividerPosition?: number
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function getResponseMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const text = await response.text()
    return text || fallbackMessage
  } catch {
    return fallbackMessage
  }
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await getResponseMessage(response, fallbackMessage))
  }

  return response.json() as Promise<T>
}

export function toActiveDocument(
  document: ActiveDocumentRecord,
  content = '',
  mtime?: number,
): ActiveDocument {
  return {
    id: document.id,
    filePath: document.filePath,
    scope: document.scope,
    mountPoint: document.mountPoint,
    displayTitle: document.displayTitle || document.filePath,
    content,
    mtime,
  }
}

export async function persistChatDocumentState(
  chatId: string,
  updates: Partial<{ documentMode: DocumentMode; dividerPosition: number }>,
): Promise<void> {
  await fetch(`/api/v1/chats/${chatId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chat: updates }),
  })
}

export async function fetchActiveDocumentRecord(chatId: string): Promise<ActiveDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=active-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
  })

  return parseJsonResponse<ActiveDocumentResponse>(response, 'Failed to load active document')
}

/**
 * List every open document for the chat. The tabbed workspace restores one
 * editor pane per record on mount and after LLM open/close tool calls.
 */
export async function fetchOpenDocumentRecords(chatId: string): Promise<OpenDocumentsResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=open-documents`, {
    method: 'POST',
    headers: JSON_HEADERS,
  })

  return parseJsonResponse<OpenDocumentsResponse>(response, 'Failed to load open documents')
}

export async function readDocumentContentForChat(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string | null
  },
): Promise<ReadDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=read-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })

  return parseJsonResponse<ReadDocumentResponse>(response, 'Failed to read document content')
}

/**
 * Existence probe for a `qtap://` document target, used to gate clickable links
 * in the Salon transcript. Returns `{ exists: false }` for an unreachable,
 * inaccessible, or missing document (the server never reveals bytes here).
 */
export async function resolveDocumentExistsForChat(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string
  },
): Promise<ResolveDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=resolve-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })

  return parseJsonResponse<ResolveDocumentResponse>(response, 'Failed to resolve document')
}

export async function openDocumentForChat(
  chatId: string,
  params: {
    filePath?: string
    title?: string
    scope: DocumentScope
    mountPoint?: string
    mode: 'split' | 'focus'
    /**
     * Folder (relative to scope root) to drop a new blank document in. Used
     * only when `filePath` is omitted; the server picks an unused
     * "Untitled Document.md" name within that folder.
     */
    targetFolder?: string
  },
): Promise<OpenDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=open-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })

  return parseJsonResponse<OpenDocumentResponse>(response, 'Failed to open document')
}

export async function closeDocumentForChat(chatId: string, chatDocumentId?: string): Promise<void> {
  await fetch(`/api/v1/chats/${chatId}?action=close-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chatDocumentId }),
  })
}

export async function requestDocumentWrite(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string | null
    content: string
    mtime?: number
    /** Optional pre-formatted diff — when provided, the server posts a Librarian save announcement */
    diffContent?: string
  },
): Promise<Response> {
  return fetch(`/api/v1/chats/${chatId}?action=write-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })
}

export async function fetchChatDocumentState(chatId: string): Promise<ChatStateResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}`)
  return parseJsonResponse<ChatStateResponse>(response, 'Failed to load chat state')
}

interface RenameDocumentResponse {
  document: ActiveDocumentRecord
  /** Librarian announcement message posted alongside the rename (null if chat not found) */
  librarianMessage?: Message | null
}

export async function renameDocumentForChat(
  chatId: string,
  newTitle: string,
  chatDocumentId?: string,
): Promise<RenameDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=rename-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ newTitle, chatDocumentId }),
  })

  return parseJsonResponse<RenameDocumentResponse>(response, 'Failed to rename document')
}

interface DeleteDocumentResponse {
  success: boolean
  /** Librarian announcement message posted alongside the delete (null if chat not found) */
  librarianMessage?: Message | null
}

export async function deleteDocumentForChat(
  chatId: string,
  chatDocumentId?: string,
): Promise<DeleteDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=delete-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chatDocumentId }),
  })

  return parseJsonResponse<DeleteDocumentResponse>(response, 'Failed to delete document')
}
