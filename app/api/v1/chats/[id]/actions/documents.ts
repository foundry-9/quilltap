/**
 * Chats API v1 - Document Mode Actions
 *
 * Handles document mode actions for Scriptorium Phase 3.5:
 * - active-document: Get the active document for a chat
 * - open-document: Open a document alongside the chat
 * - close-document: Close the document pane
 * - read-document: Read file content for the document editor
 * - write-document: Write file content from the document editor
 * - rename-document: Rename the active document's file (filesystem or database-backed)
 *
 * The file mechanics (path resolution, blank-document naming, read/write with
 * mtime checks, rename/delete moves) live in the shared core
 * `lib/documents/operator-doc-actions`, which the chat-less standalone route
 * (`/api/v1/documents`) drives too. This module adds what is chat-specific:
 * chat_documents row tracking, the chat's documentMode flag, and Librarian
 * announcements.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, notFound, serverError, errorResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import type { DocEditScope } from '@/lib/doc-edit';
import { resolveGroupMountPointIdsForCharacter } from '@/lib/mount-index/tiered-mount-pool';
import {
  resolveOperatorDocPath,
  resolvedPathExists,
  classifyResolvedTarget,
  openDocumentFile,
  listAllEnabledStores,
  documentAccessContextForChat,
  DocumentMissingError,
  type DocumentAccessContext,
  type AccessibleStoreOption,
} from '@/lib/documents/operator-doc-actions';
import {
  documentTargetFields,
  openDocumentFields,
  writeDocumentFields,
  readDocumentResponse,
  writeDocumentResponse,
  resolveRenameTarget,
  renameDocumentResponse,
  sweepRenamedDocumentTracking,
  deleteDocumentResponse,
  dedupeRecentDocuments,
  type DocumentHttpLog,
} from '@/lib/documents/operator-doc-http';
import {
  postLibrarianOpenAnnouncement,
  postLibrarianRenameAnnouncement,
  postLibrarianSaveAnnouncement,
  postLibrarianDeleteAnnouncement,
  contentHiddenFromCharacters,
  documentHiddenFromCharacters,
} from '@/lib/services/librarian-notifications/writer';
import { getErrorMessage } from '@/lib/error-utils';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { MAX_RECENT_DOCUMENTS } from '@/lib/chat-documents/constants';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import path from 'path';

export type {
  AccessibleStoreKind,
  AccessibleStoreOption,
} from '@/lib/documents/operator-doc-actions';

// ============================================================================
// Schemas
// ============================================================================

// A chat has a project to resolve the legacy on-disk `project` scope against,
// and it is the default: the standalone route cannot offer it.
const chatScopeSchema = z.enum(['project', 'document_store', 'general']).default('project');

const openDocumentSchema = z.object({
  ...openDocumentFields(chatScopeSchema),
  mode: z.enum(['split', 'focus']).default('split'),
});

const readDocumentSchema = z.object(documentTargetFields(chatScopeSchema));

const writeDocumentSchema = z.object({
  ...writeDocumentFields(chatScopeSchema),
  /** Pre-formatted diff content from the client; when present, a Librarian save announcement is posted */
  diffContent: z.string().optional(),
});

const renameDocumentSchema = z.object({
  newTitle: z.string().min(1),
  /** Row id of the specific open document to rename. Omitted by the legacy
   * single-pane route, which renames the earliest-opened active document. */
  chatDocumentId: z.string().optional(),
});

/**
 * Resolve the chat_documents row a per-document action targets: the named row
 * (verified to belong to the chat) when `chatDocumentId` is given, otherwise the
 * earliest-opened active document (legacy single-pane fallback).
 */
async function resolveTargetDocument(
  repos: RequestContext['repos'],
  chatId: string,
  chatDocumentId: string | undefined,
): Promise<ChatDocument | null> {
  if (chatDocumentId) {
    const doc = await repos.chatDocuments.findById(chatDocumentId);
    return doc && doc.chatId === chatId ? doc : null;
  }
  return repos.chatDocuments.findActiveForChat(chatId);
}

async function getChatContext(
  chatId: string,
  { repos }: RequestContext
): Promise<DocumentAccessContext | null> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return null;
  }
  return documentAccessContextForChat(chat);
}

/** How this route's log lines name the file, and the chat they belong to. */
function documentLog(chatId: string): DocumentHttpLog {
  return { subject: 'document', fields: { chatId } };
}

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Recent documents for the Open-Document picker.
 *
 * Starts with the current chat's documents, then folds in recently-opened
 * documents from other chats (every opened doc persists as a chat_documents
 * row, so this is durable across chats). The list is deduped by file identity
 * — current-chat rows win the dedupe so a file touched in this chat keeps its
 * "this chat first" placement — and capped at MAX_RECENT_DOCUMENTS.
 */
export async function handleRecentDocuments(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    // This chat's own documents (always shown first, in full) plus a window of
    // the most-recently-updated documents from every other chat. Fetching the
    // current chat separately guarantees its docs lead even when other chats
    // have churned past the global window.
    const fetchLimit = Math.max(MAX_RECENT_DOCUMENTS * 5, 50);
    const [thisChatDocs, globalRecent] = await Promise.all([
      repos.chatDocuments.findByChatId(chatId),
      repos.chatDocuments.findRecentAcrossChats(fetchLimit),
    ]);

    const byUpdatedDesc = (a: ChatDocument, b: ChatDocument) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    const thisChat = [...thisChatDocs].sort(byUpdatedDesc);
    const otherChats = globalRecent.filter(doc => doc.chatId !== chatId); // already newest-first

    // Dedupe over the concatenation (this-chat ahead of others) so a file opened
    // in both this chat and elsewhere keeps its "this chat first" placement.
    const ordered = dedupeRecentDocuments([...thisChat, ...otherChats], MAX_RECENT_DOCUMENTS);

    const thisChatReturned = ordered.filter(doc => doc.chatId === chatId).length;
    logger.debug('Resolved recent documents for picker', {
      chatId,
      thisChatTotal: thisChat.length,
      otherChatsWindow: otherChats.length,
      returned: ordered.length,
      fromThisChat: thisChatReturned,
      fromOtherChats: ordered.length - thisChatReturned,
    });

    return successResponse({
      documents: ordered.map(doc => ({
        id: doc.id,
        chatId: doc.chatId,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
        // "Continue editing" only makes sense for the doc active in THIS chat;
        // an other-chat row is offered as a fresh "Reopen" here.
        isActive: doc.isActive && doc.chatId === chatId,
        fromCurrentChat: doc.chatId === chatId,
        updatedAt: doc.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to get recent documents', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get recent documents');
  }
}

/**
 * The project's official document store, surfaced as the picker's left-column
 * "Project library" button so it browses and opens the same mount the
 * `project` scope resolves to. Null when the chat has no project or the project
 * has no official mount (legacy on-disk project files — the button falls back
 * to `project` scope there).
 */
export interface ProjectLibraryTarget {
  mountPointId: string;
  /** Canonical mount name — what `document_store` opens resolve against. */
  name: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
}

/**
 * Document stores reachable from this chat, for the Open-Document picker's
 * right-column accordions. Mirrors `collectAccessibleMountPointIds`: every
 * participant's character vault, the official + linked stores of every group a
 * character participant belongs to, each document store linked to the chat's
 * project, plus the instance-wide "Quilltap General" mount (always accessible).
 * The client buckets the result by storeType/mountType into Character Vaults /
 * Group Files / Database-backed / Filesystem-backed. Group stores carry
 * `isGroupStore: true` so they bucket into Group Files regardless of backing.
 *
 * Only the project's *official* mount is held back — that one is the dedicated
 * left-column "Project library" button (returned separately as `projectLibrary`
 * so the button can browse/open the real mount). Quilltap General is NOT held
 * back: the left-column "General library" button still points at the legacy
 * on-disk general store, so the Quilltap General *mount* would otherwise be
 * unreachable.
 *
 * When `opts.all` is set (the picker's "look everywhere" mode) the chat-reach
 * restriction is dropped and EVERY enabled store is returned — character vaults
 * labelled by their owning character's name — still holding back only the
 * project-official mount. The operator may open any of these because the
 * operator document actions resolve with `operatorOverride`.
 */
export async function handleAccessibleStores(
  chatId: string,
  { repos }: RequestContext,
  opts: { all?: boolean } = {}
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    // The project's official mount is surfaced as the left-column "Project
    // library" button, so keep it out of the accordions to avoid duplication.
    // (Quilltap General is intentionally NOT excluded — see the doc comment.)
    const seen = new Set<string>();
    let projectLibrary: ProjectLibraryTarget | null = null;
    if (chat.projectId) {
      const project = await repos.projects.findById(chat.projectId);
      if (project?.officialMountPointId) {
        seen.add(project.officialMountPointId);
        const officialMp = await repos.docMountPoints.findById(project.officialMountPointId);
        if (officialMp?.enabled) {
          projectLibrary = {
            mountPointId: officialMp.id,
            name: officialMp.name,
            mountType: officialMp.mountType,
          };
        }
      }
    }

    // Group stores reachable from this chat: the union of every group's
    // official + linked stores across all (non-removed) character participants.
    // Surfaced as their own "Group Files" bucket in both default and
    // look-everywhere modes. Resolved once and reused to tag/collect below.
    const groupMountIds = new Set<string>();
    for (const participant of chat.participants) {
      if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
      if (participant.status === 'removed') continue;
      const ids = await resolveGroupMountPointIdsForCharacter(participant.characterId);
      for (const id of ids) groupMountIds.add(id);
    }

    let stores: AccessibleStoreOption[];

    if (opts.all) {
      // "Look everywhere": every enabled store, regardless of chat reach.
      stores = await listAllEnabledStores(repos, { exclude: seen, groupMountIds });
    } else {
      // Default: only stores reachable from this chat.
      stores = [];

      // 1. Participant character vaults.
      for (const participant of chat.participants) {
        if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
        if (participant.status === 'removed') continue;
        const vault = await getCharacterVaultStore(participant.characterId);
        if (!vault || seen.has(vault.mountPointId)) continue;
        const mp = await repos.docMountPoints.findById(vault.mountPointId);
        if (!mp) continue;
        const character = await repos.characters.findById(participant.characterId);
        stores.push({
          mountPointId: mp.id,
          name: mp.name,
          label: character?.name ?? mp.name,
          kind: 'character' as const,
          mountType: mp.mountType,
          storeType: mp.storeType,
          characterId: participant.characterId,
        });
        seen.add(mp.id);
      }

      // 2. Group stores — official + linked stores of every group a character
      //    participant belongs to. Resolved above; collected before project
      //    links so group precedence holds (character > group > project).
      for (const id of groupMountIds) {
        if (seen.has(id)) continue;
        const mp = await repos.docMountPoints.findById(id);
        if (!mp || !mp.enabled) continue;
        stores.push({
          mountPointId: mp.id,
          name: mp.name,
          label: mp.name,
          kind: 'document-store' as const,
          mountType: mp.mountType,
          storeType: mp.storeType,
          isGroupStore: true,
        });
        seen.add(mp.id);
      }

      // 3. Document stores linked to the chat's project.
      if (chat.projectId) {
        const links = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
        for (const link of links) {
          if (seen.has(link.mountPointId)) continue;
          const mp = await repos.docMountPoints.findById(link.mountPointId);
          if (!mp) continue;
          stores.push({
            mountPointId: mp.id,
            name: mp.name,
            label: mp.name,
            kind: 'document-store' as const,
            mountType: mp.mountType,
            storeType: mp.storeType,
          });
          seen.add(mp.id);
        }
      }

      // 4. Quilltap General — always accessible to every chat, so it always
      // appears (under Database-backed, normally). Mirrors path-resolver.
      const generalId = await getGeneralMountPointId();
      if (generalId && !seen.has(generalId)) {
        const mp = await repos.docMountPoints.findById(generalId);
        if (mp?.enabled) {
          stores.push({
            mountPointId: mp.id,
            name: mp.name,
            label: mp.name,
            kind: 'document-store' as const,
            mountType: mp.mountType,
            storeType: mp.storeType,
          });
          seen.add(mp.id);
        }
      }
    }

    logger.debug('Resolved accessible document stores for picker', {
      chatId,
      mode: opts.all ? 'all' : 'chat',
      total: stores.length,
      hasProjectLibrary: projectLibrary !== null,
      characterVaults: stores.filter(s => s.storeType === 'character').length,
      groupStores: stores.filter(s => s.isGroupStore).length,
      databaseStores: stores.filter(s => s.storeType === 'documents' && s.mountType === 'database' && !s.isGroupStore).length,
      filesystemStores: stores.filter(s => s.storeType === 'documents' && s.mountType !== 'database' && !s.isGroupStore).length,
    });

    return successResponse({ stores, projectLibrary });
  } catch (error) {
    logger.error('Failed to resolve accessible document stores', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to resolve accessible document stores');
  }
}

/**
 * Recompute a chat's coarse `documentMode` flag from how many documents remain
 * open. With multiple documents allowed at once, the flag means "is Document
 * Mode engaged" — `split` while any document is open, `normal` once the last
 * one closes. The legacy single-pane route still reads this to decide whether to
 * show a pane. A `focus`-mode chat keeps `focus` while documents remain open so
 * the legacy route's full-width layout survives a sibling close.
 */
async function refreshDocumentMode(
  repos: RequestContext['repos'],
  chatId: string,
): Promise<void> {
  const open = await repos.chatDocuments.findOpenForChat(chatId);
  if (open.length === 0) {
    await repos.chats.update(chatId, { documentMode: 'normal' } as Record<string, unknown>);
    return;
  }
  const chat = await repos.chats.findById(chatId);
  const current = (chat as { documentMode?: string } | null)?.documentMode;
  if (current !== 'split' && current !== 'focus') {
    await repos.chats.update(chatId, { documentMode: 'split' } as Record<string, unknown>);
  }
}

/**
 * Get an active document for a chat (the earliest-opened). Retained for the
 * legacy single-pane route; the workspace uses `open-documents` instead.
 */
export async function handleActiveDocument(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const doc = await repos.chatDocuments.findActiveForChat(chatId);

    return successResponse({
      document: doc ? {
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      } : null,
    });
  } catch (error) {
    logger.error('Failed to get active document', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get active document');
  }
}

/**
 * List every open document for a chat (oldest-opened first). The tabbed
 * workspace calls this on mount to restore one editor pane/tab per open
 * document. Content is fetched separately per document via `read-document`.
 */
export async function handleOpenDocuments(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const docs = await repos.chatDocuments.findOpenForChat(chatId);

    return successResponse({
      documents: docs.map(doc => ({
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      })),
    });
  } catch (error) {
    logger.error('Failed to list open documents', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to list open documents');
  }
}

/**
 * Open a document alongside the chat
 */
export async function handleOpenDocument(
  req: NextRequest,
  chatId: string,
  context: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = openDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  const { repos } = context;
  const requestedScope = data.scope as DocEditScope;
  const effectiveScope: DocEditScope = !data.filePath && requestedScope === 'project' && !chatContext.projectId
    ? 'general'
    : requestedScope;

  let opened;
  try {
    opened = await openDocumentFile(chatContext, {
      filePath: data.filePath,
      title: data.title,
      scope: effectiveScope,
      mountPoint: data.mountPoint,
      targetFolder: data.targetFolder,
    });
  } catch (error) {
    if (error instanceof DocumentMissingError) {
      // 404 (not 400) so the client can distinguish a genuinely missing file
      // from a malformed request and surface a friendly toast instead of the
      // dev error overlay.
      return errorResponse(error.message, 404);
    }
    return serverError(`Failed to create blank document: ${getErrorMessage(error)}`);
  }

  const { filePath, displayTitle, content, mtime } = opened;

  try {
    const doc = await repos.chatDocuments.openDocument(chatId, {
      filePath,
      scope: effectiveScope,
      mountPoint: data.mountPoint,
      displayTitle,
    });

    await repos.chats.update(chatId, {
      documentMode: data.mode,
    } as Record<string, unknown>);


    const librarianMessage = await postLibrarianOpenAnnouncement({
      chatId,
      displayTitle,
      filePath,
      scope: effectiveScope,
      mountPoint: data.mountPoint,
      isNew: opened.isNew,
      origin: { kind: 'opened-by-user' },
      // A character_read:false document must not be announced to characters.
      hiddenFromCharacters: contentHiddenFromCharacters(content),
    });

    return successResponse({
      document: {
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      },
      content,
      mtime,
      librarianMessage: librarianMessage ?? null,
    });
  } catch (error) {
    logger.error('Failed to open document', {
      chatId,
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to open document');
  }
}

const closeDocumentSchema = z.object({
  /** Row id of the specific open document to close. Omitted by the legacy
   * single-pane route, which closes the earliest-opened active document. */
  chatDocumentId: z.string().optional(),
});

/**
 * Close one open document pane. With multiple documents open, the caller names
 * which one via `chatDocumentId`; the legacy single-pane route omits it and the
 * earliest-opened document is closed. `documentMode` is recomputed from the
 * remaining open set, so it only returns to `normal` once the last one closes.
 */
export async function handleCloseDocument(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const { chatDocumentId } = closeDocumentSchema.parse(body ?? {});

    if (chatDocumentId) {
      await repos.chatDocuments.closeDocumentById(chatId, chatDocumentId);
    } else {
      await repos.chatDocuments.closeDocument(chatId);
    }
    await refreshDocumentMode(repos, chatId);

    return successResponse({ success: true });
  } catch (error) {
    logger.error('Failed to close document', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to close document');
  }
}

/**
 * Read file content for the document editor
 */
export async function handleReadDocument(
  req: NextRequest,
  chatId: string,
  context: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = readDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  return readDocumentResponse(
    chatContext,
    { scope: data.scope as DocEditScope, filePath: data.filePath, mountPoint: data.mountPoint },
    documentLog(chatId),
  );
}

/**
 * Existence probe for a Document-Mode target — used to gate clickable
 * `qtap://` links in the Salon. Resolves `{ filePath, scope, mountPoint }`
 * through the same access-controlled path the read/open actions use and
 * returns `{ exists }` WITHOUT returning the file's bytes. Any resolution
 * failure (invalid path, inaccessible store, not found) yields
 * `{ exists: false }` so an unreachable URI simply stays plain text. The
 * reserved `self` authority resolves only when the chat has exactly one
 * character participant (its vault); otherwise it is treated as non-existent.
 */
export async function handleResolveDocument(
  req: NextRequest,
  chatId: string,
  context: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = readDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  try {
    const isSelf =
      data.scope === 'document_store' && (data.mountPoint ?? '').toLowerCase() === 'self';
    const selfCharacterId =
      isSelf && chatContext.characterIds.length === 1 ? chatContext.characterIds[0] : undefined;

    const resolved = await resolveOperatorDocPath(chatContext, {
      scope: data.scope as DocEditScope,
      filePath: data.filePath,
      mountPoint: data.mountPoint,
      // Operator surface (the human's Salon), matching read/open-document.
      characterId: selfCharacterId,
    });

    const exists = await resolvedPathExists(resolved);
    const kind = exists ? await classifyResolvedTarget(context.repos, resolved) : 'other'
    return successResponse({ exists, kind });
  } catch (error) {
    logger.debug('resolve-document: path not resolvable; treating as non-existent', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      error: getErrorMessage(error),
    });
    return successResponse({ exists: false, kind: 'other' });
  }
}

/**
 * Write file content from the document editor
 */
export async function handleWriteDocument(
  req: NextRequest,
  chatId: string,
  context: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = writeDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  const written = await writeDocumentResponse(
    chatContext,
    context.repos,
    {
      filePath: data.filePath,
      scope: data.scope as DocEditScope,
      mountPoint: data.mountPoint,
      content: data.content,
      mtime: data.mtime,
    },
    documentLog(chatId),
  );
  if (!written.ok) {
    return written.response;
  }

  const librarianMessage = data.diffContent
    ? await postLibrarianSaveAnnouncement({
        chatId,
        diffContent: data.diffContent,
        // Derive from the content just written — its frontmatter is the
        // authority, and a brand-new hidden file isn't indexed yet.
        hiddenFromCharacters: contentHiddenFromCharacters(data.content),
      })
    : null;

  return successResponse({
    success: true,
    mtime: written.mtime,
    librarianMessage: librarianMessage ?? null,
  });
}

/**
 * Rename the active document's underlying file.
 *
 * The user types a new name in the DocumentPane title input; we treat that
 * input as the new basename (directory preserved). If the input has no
 * extension, the old extension is appended so users can type "backstory"
 * and get "backstory.md". Path separators are rejected — this is a rename
 * within the current directory, not a move.
 */
export async function handleRenameDocument(
  req: NextRequest,
  chatId: string,
  context: RequestContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = renameDocumentSchema.parse(body);

  const { repos } = context;
  const doc = await resolveTargetDocument(repos, chatId, data.chatDocumentId);
  if (!doc) {
    return badRequest('No active document to rename');
  }

  const target = resolveRenameTarget(doc.filePath, data.newTitle);
  if (!target.ok) {
    return target.response;
  }
  const { newFilePath, newDisplayTitle } = target;

  if (target.unchanged) {
    return successResponse({
      document: {
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      },
    });
  }

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  // Capture the read-policy BEFORE the rename moves the link off the old path,
  // so a character_read:false document isn't announced to characters.
  let resolvedOld;
  try {
    resolvedOld = await resolveOperatorDocPath(chatContext, {
      scope: doc.scope as DocEditScope,
      filePath: doc.filePath,
      mountPoint: doc.mountPoint ?? undefined,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn('Failed to resolve document path for rename', {
      chatId,
      from: doc.filePath,
      to: newFilePath,
      error: message,
    });
    return badRequest(`Could not resolve path: ${message}`);
  }
  const hiddenFromCharacters = await documentHiddenFromCharacters(
    resolvedOld.mountPointId,
    resolvedOld.relativePath,
  );

  const renamed = await renameDocumentResponse(
    chatContext,
    repos,
    {
      scope: doc.scope as DocEditScope,
      mountPoint: doc.mountPoint ?? undefined,
      oldFilePath: doc.filePath,
      newFilePath,
    },
    documentLog(chatId),
  );
  if (!renamed.ok) {
    return renamed.response;
  }

  const oldDisplayTitle = doc.displayTitle || path.basename(doc.filePath);
  const updated = await repos.chatDocuments.update(doc.id, {
    filePath: newFilePath,
    displayTitle: newDisplayTitle,
  });

  // Sweep any other chats' (or the standalone) recent-document rows still
  // pointing at the old path. The row above is already at newFilePath, so it
  // won't re-match here.
  await sweepRenamedDocumentTracking(
    repos,
    {
      scope: doc.scope,
      mountPoint: doc.mountPoint,
      oldFilePath: doc.filePath,
      newFilePath,
      newDisplayTitle,
    },
    documentLog(chatId),
  );

  const librarianMessage = await postLibrarianRenameAnnouncement({
    chatId,
    oldDisplayTitle,
    newDisplayTitle,
    oldFilePath: doc.filePath,
    newFilePath,
    scope: doc.scope as 'project' | 'document_store' | 'general',
    mountPoint: doc.mountPoint,
    hiddenFromCharacters,
  });

  const result = updated ?? doc;
  return successResponse({
    document: {
      id: result.id,
      filePath: newFilePath,
      scope: doc.scope,
      mountPoint: doc.mountPoint,
      displayTitle: newDisplayTitle,
    },
    librarianMessage: librarianMessage ?? null,
  });
}

/**
 * Delete the active document's underlying file. Database-backed stores route
 * through deleteDatabaseDocument; filesystem scopes use fs.unlink. The chat's
 * document association is deactivated (mirrors handleCloseDocument), and the
 * Librarian announces the removal so characters present know the file is gone.
 */
export async function handleDeleteDocument(
  req: NextRequest,
  chatId: string,
  context: RequestContext
): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const { chatDocumentId } = closeDocumentSchema.parse(body ?? {});

  const { repos } = context;
  const doc = await resolveTargetDocument(repos, chatId, chatDocumentId);
  if (!doc) {
    return badRequest('No active document to delete');
  }

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  let resolved;
  try {
    resolved = await resolveOperatorDocPath(chatContext, {
      scope: doc.scope as DocEditScope,
      filePath: doc.filePath,
      mountPoint: doc.mountPoint ?? undefined,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn('Failed to resolve document path for delete', {
      chatId,
      filePath: doc.filePath,
      error: message,
    });
    return badRequest(`Could not resolve path: ${message}`);
  }

  // Capture the read-policy BEFORE the delete removes the link row, so a
  // character_read:false document isn't announced to characters.
  const hiddenFromCharacters = await documentHiddenFromCharacters(
    resolved.mountPointId,
    resolved.relativePath,
  );

  const deleted = await deleteDocumentResponse(
    chatContext,
    {
      scope: doc.scope as DocEditScope,
      mountPoint: doc.mountPoint ?? undefined,
      filePath: doc.filePath,
    },
    documentLog(chatId),
  );
  if (!deleted.ok) {
    return deleted.response;
  }

  await repos.chatDocuments.closeDocumentById(chatId, doc.id);
  await refreshDocumentMode(repos, chatId);

  const displayTitle = doc.displayTitle || path.basename(doc.filePath);

  const librarianMessage = await postLibrarianDeleteAnnouncement({
    chatId,
    displayTitle,
    filePath: doc.filePath,
    scope: doc.scope as 'project' | 'document_store' | 'general',
    mountPoint: doc.mountPoint,
    origin: { kind: 'by-user' },
    hiddenFromCharacters,
  });

  return successResponse({
    success: true,
    librarianMessage: librarianMessage ?? null,
  });
}
