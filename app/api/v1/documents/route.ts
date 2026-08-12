/**
 * Documents API v1 — Standalone (chat-less) Document Mode
 *
 * The left rail's Document Mode: open, read, write, rename, and delete
 * documents with no chat attached. Drives the same shared core as the
 * chat-scoped document actions (`lib/documents/operator-doc-actions`) but
 * creates no chat_documents rows and posts no Librarian announcements —
 * there is no conversation to notify.
 *
 * GET  /api/v1/documents?action=accessible-stores - every enabled store (always "look everywhere")
 * POST /api/v1/documents?action=recent-documents  - recently-opened documents across all chats
 * POST /api/v1/documents?action=open-document     - read a document, or create a blank one
 * POST /api/v1/documents?action=read-document     - read file content for the editor
 * POST /api/v1/documents?action=write-document    - write file content (mtime-checked)
 * POST /api/v1/documents?action=rename-document   - rename the underlying file
 * POST /api/v1/documents?action=delete-document   - delete the underlying file
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { successResponse, badRequest, conflict, notFound, serverError, errorResponse } from '@/lib/api/responses';
import { readFileWithMtime, type DocEditScope } from '@/lib/doc-edit';
import { DatabaseStoreError } from '@/lib/mount-index/database-store';
import {
  STANDALONE_ACCESS_CONTEXT,
  resolveOperatorDocPath,
  openDocumentFile,
  writeDocumentFile,
  computeRenameTarget,
  renameDocumentFile,
  deleteDocumentFile,
  listAllEnabledStores,
  DocumentConflictError,
  DocumentMissingError,
} from '@/lib/documents/operator-doc-actions';
import { getErrorMessage } from '@/lib/error-utils';
import { MAX_RECENT_DOCUMENTS, STANDALONE_CHAT_ID } from '@/lib/chat-documents/constants';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';

// ============================================================================
// Schemas
// ============================================================================

// No chat means no project context, so the legacy on-disk `project` scope is
// unresolvable here. Project files remain reachable through their project's
// official document store (`document_store` scope by mount name).
const standaloneScopeSchema = z.enum(['document_store', 'general']);

const openDocumentSchema = z.object({
  filePath: z.string().optional(),
  title: z.string().optional(),
  scope: standaloneScopeSchema.default('general'),
  mountPoint: z.string().optional(),
  /** Folder (relative to scope root) for a new blank document; ignored when `filePath` is set. */
  targetFolder: z.string().optional(),
});

const readDocumentSchema = z.object({
  filePath: z.string(),
  scope: standaloneScopeSchema.default('general'),
  mountPoint: z.string().optional(),
});

const writeDocumentSchema = z.object({
  filePath: z.string(),
  scope: standaloneScopeSchema.default('general'),
  mountPoint: z.string().optional(),
  content: z.string(),
  mtime: z.number().optional(),
});

const renameDocumentSchema = z.object({
  filePath: z.string(),
  scope: standaloneScopeSchema.default('general'),
  mountPoint: z.string().optional(),
  newTitle: z.string().min(1),
});

const deleteDocumentSchema = z.object({
  filePath: z.string(),
  scope: standaloneScopeSchema.default('general'),
  mountPoint: z.string().optional(),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * Every enabled store — the standalone picker is always in "look everywhere"
 * mode, since with no chat there is no narrower reach to default to. No
 * `projectLibrary` either (that button is the chat picker's project shortcut);
 * project-official mounts appear in the store accordions like any other store.
 */
async function handleAccessibleStores(
  _req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  try {
    const stores = await listAllEnabledStores(repos);
    return successResponse({ stores, projectLibrary: null });
  } catch (error) {
    logger.error('Failed to resolve stores for standalone document picker', {
      error: getErrorMessage(error),
    });
    return serverError('Failed to resolve accessible document stores');
  }
}

/**
 * Recently-opened documents across every chat (each open persists as a
 * chat_documents row). Project-scoped rows are filtered out — the standalone
 * surface has no project context to resolve them against.
 */
async function handleRecentDocuments(
  _req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  try {
    const fetchLimit = Math.max(MAX_RECENT_DOCUMENTS * 5, 50);
    const globalRecent = await repos.chatDocuments.findRecentAcrossChats(fetchLimit);

    const seen = new Set<string>();
    const ordered: ChatDocument[] = [];
    for (const doc of globalRecent) { // already newest-first
      if (doc.scope === 'project') continue;
      const key = `${doc.scope} ${doc.mountPoint ?? ''} ${doc.filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(doc);
      if (ordered.length >= MAX_RECENT_DOCUMENTS) break;
    }

    return successResponse({
      documents: ordered.map(doc => ({
        id: doc.id,
        chatId: doc.chatId,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
        isActive: false,
        fromCurrentChat: false,
        updatedAt: doc.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to get recent documents for standalone picker', {
      error: getErrorMessage(error),
    });
    return serverError('Failed to get recent documents');
  }
}

/**
 * Open a document standalone: read an existing file, or create a blank
 * "Untitled Document.md" when no `filePath` is given. The open is recorded as a
 * `chat_documents` row under the reserved {@link STANDALONE_CHAT_ID} sentinel so
 * it joins the cross-chat recent-documents history the picker reads — the left
 * rail's Document Mode has no conversation to attach the row to. No Librarian
 * announcement is posted (there is no chat to notify).
 */
async function handleOpenDocument(
  req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = openDocumentSchema.parse(body);

  try {
    const opened = await openDocumentFile(STANDALONE_ACCESS_CONTEXT, {
      filePath: data.filePath,
      title: data.title,
      scope: data.scope as DocEditScope,
      mountPoint: data.mountPoint,
      targetFolder: data.targetFolder,
    });

    // Record the open in recent-documents history. Failing to track must not
    // sink the open itself, so log and continue if the write throws.
    try {
      await repos.chatDocuments.openDocument(STANDALONE_CHAT_ID, {
        filePath: opened.filePath,
        scope: data.scope,
        mountPoint: data.mountPoint ?? null,
        displayTitle: opened.displayTitle,
      });
    } catch (trackError) {
      logger.warn('Failed to record standalone document in recent history', {
        filePath: opened.filePath,
        scope: data.scope,
        mountPoint: data.mountPoint,
        error: getErrorMessage(trackError),
      });
    }

    return successResponse({
      document: {
        filePath: opened.filePath,
        scope: data.scope,
        mountPoint: data.mountPoint ?? null,
        displayTitle: opened.displayTitle,
      },
      content: opened.content,
      mtime: opened.mtime,
      isNew: opened.isNew,
    });
  } catch (error) {
    if (error instanceof DocumentMissingError) {
      // 404 (not 400) so the client can surface a friendly "file not found"
      // toast, matching the chat route's open-document behaviour.
      return errorResponse(error.message, 404);
    }
    logger.error('Failed to open standalone document', {
      filePath: data.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      error: getErrorMessage(error),
    });
    return serverError(`Failed to open document: ${getErrorMessage(error)}`);
  }
}

/** Read file content for the standalone editor. */
async function handleReadDocument(
  req: NextRequest,
  _ctx: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = readDocumentSchema.parse(body);

  let resolved;
  try {
    resolved = await resolveOperatorDocPath(STANDALONE_ACCESS_CONTEXT, {
      scope: data.scope as DocEditScope,
      filePath: data.filePath,
      mountPoint: data.mountPoint,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn('Failed to resolve standalone document path for read', {
      filePath: data.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      error: message,
    });
    return badRequest(`Could not resolve ${data.filePath}: ${message}`);
  }

  try {
    const fileData = await readFileWithMtime(resolved);
    return successResponse({
      content: fileData.content,
      mtime: fileData.mtime,
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') {
      return errorResponse(`File not found: ${data.filePath}`, 404);
    }
    logger.error('Failed to read standalone document', {
      filePath: data.filePath,
      scope: data.scope,
      code,
      error: getErrorMessage(error),
    });
    return serverError(`Failed to read document: ${getErrorMessage(error)}`);
  }
}

/** Write file content from the standalone editor (mtime-checked, no Librarian). */
async function handleWriteDocument(
  req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = writeDocumentSchema.parse(body);

  try {
    const { mtime } = await writeDocumentFile(STANDALONE_ACCESS_CONTEXT, repos, {
      filePath: data.filePath,
      scope: data.scope as DocEditScope,
      mountPoint: data.mountPoint,
      content: data.content,
      mtime: data.mtime,
    });

    return successResponse({ success: true, mtime });
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes('mtime mismatch') || message.includes('modified by another process')) {
      logger.warn('Standalone document save conflict detected', {
        filePath: data.filePath,
        error: message,
      });
      return conflict('Document changed elsewhere. Reload it and try again.');
    }
    logger.error('Failed to write standalone document', {
      filePath: data.filePath,
      scope: data.scope,
      error: message,
    });
    return serverError(`Failed to write document: ${message}`);
  }
}

/**
 * Rename a standalone document's underlying file. Same basename semantics as
 * the chat route: the new title keeps the directory, inherits the old
 * extension when none is typed, and may not contain path separators.
 */
async function handleRenameDocument(
  req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = renameDocumentSchema.parse(body);

  const target = computeRenameTarget(data.filePath, data.newTitle);
  if (!target.ok) {
    return badRequest(target.reason);
  }
  const { newFilePath, newDisplayTitle } = target;

  if (newFilePath === data.filePath) {
    return successResponse({
      document: {
        filePath: data.filePath,
        scope: data.scope,
        mountPoint: data.mountPoint ?? null,
        displayTitle: newDisplayTitle,
      },
    });
  }

  try {
    await renameDocumentFile(STANDALONE_ACCESS_CONTEXT, repos, {
      scope: data.scope as DocEditScope,
      mountPoint: data.mountPoint,
      oldFilePath: data.filePath,
      newFilePath,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (error instanceof DocumentConflictError) {
      return conflict('A file already exists at that name.');
    }
    if (error instanceof DatabaseStoreError && error.code === 'UNSUPPORTED') {
      return badRequest(message);
    }
    logger.error('Failed to rename standalone document', {
      from: data.filePath,
      to: newFilePath,
      scope: data.scope,
      error: message,
    });
    return serverError(`Failed to rename document: ${message}`);
  }

  // Keep the recent-documents history pointing at the new name. Best-effort:
  // the rename already succeeded on disk, so a tracking hiccup must not fail
  // the request. Mirrors syncChatDocumentsAfterFileMove for doc_move_file.
  try {
    await repos.chatDocuments.renameFilePathInStore(
      data.scope,
      data.mountPoint ?? null,
      data.filePath,
      newFilePath,
      newDisplayTitle,
    );
  } catch (trackError) {
    logger.warn('Failed to update recent-document tracking after standalone rename', {
      from: data.filePath,
      to: newFilePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      error: getErrorMessage(trackError),
    });
  }

  return successResponse({
    document: {
      filePath: newFilePath,
      scope: data.scope,
      mountPoint: data.mountPoint ?? null,
      displayTitle: newDisplayTitle,
    },
  });
}

/** Delete a standalone document's underlying file. */
async function handleDeleteDocument(
  req: NextRequest,
  _ctx: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = deleteDocumentSchema.parse(body);

  try {
    const outcome = await deleteDocumentFile(STANDALONE_ACCESS_CONTEXT, {
      scope: data.scope as DocEditScope,
      mountPoint: data.mountPoint,
      filePath: data.filePath,
    });
    if (outcome === 'not-found') {
      return notFound('File');
    }
    if (outcome === 'not-a-file') {
      return badRequest(`Path is not a file: ${data.filePath}`);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error('Failed to delete standalone document', {
      filePath: data.filePath,
      scope: data.scope,
      error: message,
    });
    return serverError(`Failed to delete document: ${message}`);
  }

  return successResponse({ success: true });
}

// ============================================================================
// Route exports
// ============================================================================

export const GET = createContextHandler(
  withCollectionActionDispatch({
    'accessible-stores': handleAccessibleStores,
  })
);

export const POST = createContextHandler(
  withCollectionActionDispatch({
    'recent-documents': handleRecentDocuments,
    'open-document': handleOpenDocument,
    'read-document': handleReadDocument,
    'write-document': handleWriteDocument,
    'rename-document': handleRenameDocument,
    'delete-document': handleDeleteDocument,
  })
);
