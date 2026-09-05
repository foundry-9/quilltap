/**
 * Operator Document Actions — HTTP mapping
 *
 * The layer between the shared document core (`operator-doc-actions`) and the
 * two routes that drive it: the chat-scoped actions
 * (`/api/v1/chats/[id]?action=…-document`) and the chat-less standalone route
 * (`/api/v1/documents?action=…`). Each helper here maps the core's outcomes
 * onto the status codes and messages the two routes share — a resolution
 * failure is a 400, a missing file a 404, a stale mtime or a taken rename
 * target a 409, anything else a 500 — so a route keeps only what is its own:
 * chat_documents rows, Librarian announcements, the standalone history
 * sentinel.
 *
 * The Zod shapes both routes validate against live here too, so the request
 * contract cannot drift between them; each route `.extend()`s with its own
 * additions (the chat route's editor `mode` and `diffContent`).
 *
 * @module lib/documents/operator-doc-http
 */

import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, conflict, notFound, serverError, errorResponse } from '@/lib/api/responses';
import { readFileWithMtime, type DocEditScope } from '@/lib/doc-edit';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import {
  resolveOperatorDocPath,
  writeDocumentFile,
  computeRenameTarget,
  renameDocumentFile,
  deleteDocumentFile,
  DocumentConflictError,
  type DocumentAccessContext,
} from './operator-doc-actions';

// ============================================================================
// Request shapes
// ============================================================================

/**
 * The fields that name a document: its path, the scope it is addressed under,
 * and (for `document_store`) the mount. `scope` is the route's own enum —
 * the chat route accepts `project`, the standalone route cannot resolve it.
 */
export function documentTargetFields<S extends z.ZodType>(scope: S) {
  return {
    filePath: z.string(),
    scope,
    mountPoint: z.string().optional(),
  };
}

/** Open-document request: an existing `filePath`, or none to create a blank document. */
export function openDocumentFields<S extends z.ZodType>(scope: S) {
  return {
    filePath: z.string().optional(),
    title: z.string().optional(),
    scope,
    mountPoint: z.string().optional(),
    /**
     * Folder (relative to scope root) where a new blank document should land.
     * Forward-slash separated; ignored when `filePath` is provided. Empty/unset
     * means scope root.
     */
    targetFolder: z.string().optional(),
  };
}

/** Write-document request: the target plus the content and the mtime it was read at. */
export function writeDocumentFields<S extends z.ZodType>(scope: S) {
  return {
    ...documentTargetFields(scope),
    content: z.string(),
    mtime: z.number().optional(),
  };
}

// ============================================================================
// Shared outcome shapes
// ============================================================================

/** A document identified by the request (scope already narrowed to the core's type). */
export interface DocumentTarget {
  filePath: string;
  scope: DocEditScope;
  mountPoint?: string;
}

/** The route should send this response and stop. */
export interface DocumentHttpFailure {
  ok: false;
  response: NextResponse;
}

/**
 * How a route's log lines name the file and what they carry. The chat route
 * says `document` and adds `chatId`; the standalone route says
 * `standalone document`.
 */
export interface DocumentHttpLog {
  subject: string;
  fields?: Record<string, unknown>;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ============================================================================
// Read
// ============================================================================

/**
 * Read a document for the editor: `{ content, mtime }` on success, 400 when
 * the path does not resolve, 404 when the file is missing, 500 otherwise.
 */
export async function readDocumentResponse(
  ctx: DocumentAccessContext,
  target: DocumentTarget,
  log: DocumentHttpLog,
): Promise<NextResponse> {
  let resolved;
  try {
    resolved = await resolveOperatorDocPath(ctx, target);
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn(`Failed to resolve ${log.subject} path for read`, {
      ...log.fields,
      filePath: target.filePath,
      scope: target.scope,
      mountPoint: target.mountPoint,
      error: message,
    });
    return badRequest(`Could not resolve ${target.filePath}: ${message}`);
  }

  try {
    const fileData = await readFileWithMtime(resolved);
    return successResponse({
      content: fileData.content,
      mtime: fileData.mtime,
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    const message = getErrorMessage(error);

    if (code === 'ENOENT') {
      // notFound() appends "not found" to its argument, which would produce
      // "File not found: X not found" — use errorResponse so the client sees
      // the same shape as open-document's missing-file response.
      return errorResponse(`File not found: ${target.filePath}`, 404);
    }

    logger.error(`Failed to read ${log.subject}`, {
      ...log.fields,
      filePath: target.filePath,
      scope: target.scope,
      code,
      error: message,
    });
    return serverError(`Failed to read document: ${message}`);
  }
}

// ============================================================================
// Write
// ============================================================================

/**
 * Write a document from the editor. A stale mtime ({@link DocumentConflictError})
 * is a 409 telling the user to reload; any other failure a 500.
 */
export async function writeDocumentResponse(
  ctx: DocumentAccessContext,
  repos: RepositoryContainer,
  params: DocumentTarget & { content: string; mtime?: number },
  log: DocumentHttpLog,
): Promise<{ ok: true; mtime: number } | DocumentHttpFailure> {
  try {
    const { mtime } = await writeDocumentFile(ctx, repos, params);
    return { ok: true, mtime };
  } catch (error) {
    const message = getErrorMessage(error);

    if (error instanceof DocumentConflictError) {
      logger.warn(`${capitalize(log.subject)} save conflict detected`, {
        ...log.fields,
        filePath: params.filePath,
        error: message,
      });
      return { ok: false, response: conflict('Document changed elsewhere. Reload it and try again.') };
    }

    logger.error(`Failed to write ${log.subject}`, {
      ...log.fields,
      filePath: params.filePath,
      scope: params.scope,
      error: message,
    });
    return { ok: false, response: serverError(`Failed to write document: ${message}`) };
  }
}

// ============================================================================
// Rename
// ============================================================================

/**
 * Turn the user-typed title into the rename target, or the 400 that rejects
 * it. `unchanged` means the title resolves to the current path — the route
 * answers with the document as it stands and touches nothing.
 */
export function resolveRenameTarget(
  currentFilePath: string,
  newTitle: string,
): { ok: true; newFilePath: string; newDisplayTitle: string; unchanged: boolean } | DocumentHttpFailure {
  const target = computeRenameTarget(currentFilePath, newTitle);
  if (!target.ok) {
    return { ok: false, response: badRequest(target.reason) };
  }
  return {
    ok: true,
    newFilePath: target.newFilePath,
    newDisplayTitle: target.newDisplayTitle,
    unchanged: target.newFilePath === currentFilePath,
  };
}

/**
 * Move the underlying file to its rename target. A taken destination is a
 * 409, a store that cannot rename (`DatabaseStoreError` UNSUPPORTED) a 400,
 * anything else a 500.
 */
export async function renameDocumentResponse(
  ctx: DocumentAccessContext,
  repos: RepositoryContainer,
  params: { scope: DocEditScope; mountPoint?: string; oldFilePath: string; newFilePath: string },
  log: DocumentHttpLog,
): Promise<{ ok: true } | DocumentHttpFailure> {
  try {
    await renameDocumentFile(ctx, repos, params);
    return { ok: true };
  } catch (error) {
    const message = getErrorMessage(error);
    if (error instanceof DocumentConflictError) {
      return { ok: false, response: conflict('A file already exists at that name.') };
    }
    if (error instanceof DatabaseStoreError && error.code === 'UNSUPPORTED') {
      return { ok: false, response: badRequest(message) };
    }
    logger.error(`Failed to rename ${log.subject}`, {
      ...log.fields,
      from: params.oldFilePath,
      to: params.newFilePath,
      scope: params.scope,
      error: message,
    });
    return { ok: false, response: serverError(`Failed to rename document: ${message}`) };
  }
}

/**
 * Keep every recent-document row still pointing at the old path (other chats',
 * or the standalone sentinel's) in step with a rename, so the shared recent
 * list stays consistent. Best-effort: the rename already succeeded on disk, so
 * a tracking hiccup is logged, never surfaced. Mirrors
 * `syncChatDocumentsAfterFileMove` for `doc_move_file`.
 */
export async function sweepRenamedDocumentTracking(
  repos: RepositoryContainer,
  params: {
    scope: string;
    mountPoint: string | null | undefined;
    oldFilePath: string;
    newFilePath: string;
    newDisplayTitle: string;
  },
  log: DocumentHttpLog,
): Promise<void> {
  try {
    await repos.chatDocuments.renameFilePathInStore(
      params.scope,
      params.mountPoint ?? null,
      params.oldFilePath,
      params.newFilePath,
      params.newDisplayTitle,
    );
  } catch (trackError) {
    logger.warn('Failed to sweep recent-document tracking after rename', {
      ...log.fields,
      from: params.oldFilePath,
      to: params.newFilePath,
      scope: params.scope,
      mountPoint: params.mountPoint,
      error: getErrorMessage(trackError),
    });
  }
}

// ============================================================================
// Delete
// ============================================================================

/**
 * Delete the underlying file: 404 when there is nothing there, 400 when the
 * path is not a file, 500 on any other failure.
 */
export async function deleteDocumentResponse(
  ctx: DocumentAccessContext,
  target: DocumentTarget,
  log: DocumentHttpLog,
): Promise<{ ok: true } | DocumentHttpFailure> {
  try {
    const outcome = await deleteDocumentFile(ctx, target);
    if (outcome === 'not-found') {
      return { ok: false, response: notFound('File') };
    }
    if (outcome === 'not-a-file') {
      return { ok: false, response: badRequest(`Path is not a file: ${target.filePath}`) };
    }
    return { ok: true };
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error(`Failed to delete ${log.subject}`, {
      ...log.fields,
      filePath: target.filePath,
      scope: target.scope,
      error: message,
    });
    return { ok: false, response: serverError(`Failed to delete document: ${message}`) };
  }
}

// ============================================================================
// Recent-documents list
// ============================================================================

/** The identity two chat_documents rows share when they are the same file. */
export function documentIdentityKey(doc: Pick<ChatDocument, 'scope' | 'mountPoint' | 'filePath'>): string {
  return `${doc.scope} ${doc.mountPoint ?? ''} ${doc.filePath}`;
}

/**
 * First-seen-wins dedupe by file identity, capped at `limit`. Callers order
 * `docs` the way they want ties to resolve (the chat route puts its own rows
 * first so a file open in both places keeps its "this chat first" placement).
 */
export function dedupeRecentDocuments<T extends Pick<ChatDocument, 'scope' | 'mountPoint' | 'filePath'>>(
  docs: T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const doc of docs) {
    const key = documentIdentityKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(doc);
    if (ordered.length >= limit) break;
  }
  return ordered;
}
