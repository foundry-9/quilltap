/**
 * Database Abstraction Layer - Chat Documents Repository
 *
 * Backend-agnostic repository for ChatDocument entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles document associations for Scriptorium Phase 3.5 Document Mode —
 * tracks which documents are open alongside each chat in the split-panel editor.
 * Closed documents are kept as inactive records for quick-reopen.
 */

import {
  ChatDocument,
  ChatDocumentSchema,
} from '@/lib/schemas/chat-document.types';
import { AbstractBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

/**
 * Chat Documents Repository
 * Implements CRUD operations for chat-document associations.
 * Several documents may be open (`isActive`) per chat at once — each surfaces
 * as its own tab in the tabbed workspace. Closed documents are kept as inactive
 * rows for quick-reopen history.
 */
export class ChatDocumentsRepository extends AbstractBaseRepository<ChatDocument> {
  constructor() {
    super('chat_documents', ChatDocumentSchema);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<ChatDocument, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<ChatDocument> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ChatDocument>): Promise<ChatDocument | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find an active document for a chat.
   *
   * Multi-document Document Mode allows several open (`isActive`) documents per
   * chat, so this returns the earliest-opened active row — used by the legacy
   * single-pane `/salon/[id]` route and as the default target for doc tools that
   * don't name a specific document. Prefer {@link findOpenForChat} when you need
   * the full open set.
   */
  async findActiveForChat(chatId: string): Promise<ChatDocument | null> {
    return this.safeQuery(
      async () => {
        const results = await this.findOpenForChat(chatId);
        return results.length > 0 ? results[0] : null;
      },
      'Error finding active document for chat',
      { chatId },
      null
    );
  }

  /**
   * Find every open (`isActive`) document for a chat, oldest-opened first.
   *
   * This is the source of truth for which documents are open as tabs in the
   * tabbed workspace; the client restores one pane per row on chat reopen.
   * Ordered by createdAt so tab order is stable across cold reloads (the
   * workspace's own localStorage tracks user reordering within a session).
   */
  async findOpenForChat(chatId: string): Promise<ChatDocument[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          chatId,
          isActive: true,
        } as TypedQueryFilter<ChatDocument>);
        return results.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      },
      'Error finding open documents for chat',
      { chatId },
      []
    );
  }

  /**
   * Find all documents associated with a chat (including inactive)
   */
  async findByChatId(chatId: string): Promise<ChatDocument[]> {
    return this.safeQuery(
      async () => {
        return this.findByFilter({ chatId } as TypedQueryFilter<ChatDocument>);
      },
      'Error finding documents by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find recent inactive documents for a chat, sorted by most recently updated.
   * Used by the document picker for quick-reopen options.
   */
  async findRecentForChat(chatId: string, limit = 5): Promise<ChatDocument[]> {
    return this.safeQuery(
      async () => {
        const allDocs = await this.findByFilter({ chatId } as TypedQueryFilter<ChatDocument>);
        return allDocs
          .filter(doc => !doc.isActive)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, limit);
      },
      'Error finding recent documents for chat',
      { chatId },
      []
    );
  }

  /**
   * Find the most recently updated documents across ALL chats, newest first.
   * Used by the Open-Document picker so recent files persist beyond the
   * current chat. Callers over-fetch and then dedupe by file identity and
   * re-rank current-chat-first before capping.
   */
  async findRecentAcrossChats(limit: number): Promise<ChatDocument[]> {
    return this.safeQuery(
      async () => {
        const all = await this.findAll();
        return all
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, limit);
      },
      'Error finding recent documents across chats',
      { limit },
      []
    );
  }

  /**
   * Open a document for a chat. Several documents may be open at once (each
   * becomes its own workspace tab), so previously-open documents are left
   * active — this is the difference from the old single-document policy.
   * If the requested document was previously opened, reactivates that row
   * instead of creating a duplicate. Auto-saves are handled by the caller
   * before this method is invoked.
   */
  async openDocument(chatId: string, data: {
    filePath: string;
    scope: string;
    mountPoint?: string | null;
    displayTitle?: string | null;
  }): Promise<ChatDocument> {
    // Check if this document was previously opened (reactivate instead of duplicate)
    const allDocs = await this.findByChatId(chatId);
    const existingDoc = allDocs.find(doc =>
      doc.filePath === data.filePath &&
      doc.scope === data.scope &&
      (doc.mountPoint || null) === (data.mountPoint || null)
    );

    if (existingDoc) {
      const updated = await this.update(existingDoc.id, {
        isActive: true,
        displayTitle: data.displayTitle ?? existingDoc.displayTitle,
      });

      return updated || existingDoc;
    }

    // Create a new document association
    const doc = await this.create({
      chatId,
      filePath: data.filePath,
      scope: data.scope as 'project' | 'document_store' | 'general',
      mountPoint: data.mountPoint ?? null,
      displayTitle: data.displayTitle ?? null,
      isActive: true,
    });

    return doc;
  }

  /**
   * Close a single open document for a chat by its row id (multi-document
   * Document Mode closes one tab at a time). Deactivates instead of deleting,
   * preserving history for quick-reopen. Returns false if the row doesn't exist
   * or doesn't belong to the chat.
   */
  async closeDocumentById(chatId: string, chatDocumentId: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const doc = await this.findById(chatDocumentId);
        if (!doc || doc.chatId !== chatId) {
          return false;
        }
        await this.update(doc.id, { isActive: false });
        return true;
      },
      'Error closing document by id',
      { chatId, chatDocumentId },
      false,
    );
  }

  /**
   * Close the earliest-opened active document for a chat. Retained for the
   * legacy single-pane route, which doesn't track per-document ids. Deactivates
   * instead of deleting, preserving history for quick-reopen.
   */
  async closeDocument(chatId: string): Promise<boolean> {
    const currentDoc = await this.findActiveForChat(chatId);
    if (!currentDoc) {
      return false;
    }

    await this.update(currentDoc.id, { isActive: false });

    return true;
  }

  /**
   * Rewrite every chat_documents row whose filePath exactly matches `oldPath`
   * to carry `newPath` instead. Used by startup migrations when an overlay or
   * scaffold file is renamed, so split-panel editor state from old sessions
   * does not 404 on next chat open. Returns the number of rows updated.
   */
  async renameFilePath(oldPath: string, newPath: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const stale = await this.findByFilter({
          filePath: oldPath,
        } as TypedQueryFilter<ChatDocument>);
        let count = 0;
        for (const row of stale) {
          const updated = await this.update(row.id, { filePath: newPath });
          if (updated) count++;
        }
        return count;
      },
      'Error renaming chat document filePath',
      { oldPath, newPath },
      0,
    );
  }

  /**
   * Rewrite chat_documents rows in a specific (scope, mountPoint) whose
   * filePath exactly matches `oldPath`. Used after `doc_move_file` succeeds
   * so any chat with the moved file open in Document Mode keeps tracking it
   * at the new path instead of 404'ing on the next reload. The displayTitle
   * is refreshed to the new basename, matching the convention used by both
   * `openDocument` and the UI-initiated rename.
   */
  async renameFilePathInStore(
    scope: string,
    mountPoint: string | null | undefined,
    oldPath: string,
    newPath: string,
    newDisplayTitle: string,
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        const normalizedMount = mountPoint ?? null;
        const stale = await this.findByFilter({
          scope,
          filePath: oldPath,
        } as TypedQueryFilter<ChatDocument>);
        const matching = stale.filter(r => (r.mountPoint ?? null) === normalizedMount);
        let count = 0;
        for (const row of matching) {
          const updated = await this.update(row.id, {
            filePath: newPath,
            displayTitle: newDisplayTitle,
          });
          if (updated) count++;
        }
        return count;
      },
      'Error renaming chat document filePath in store',
      { scope, mountPoint, oldPath, newPath },
      0,
    );
  }

  /**
   * Rewrite chat_documents rows in a specific (scope, mountPoint) whose
   * filePath sits under `oldFolderPath` after a folder is moved/renamed.
   * Rewrites the prefix to `newFolderPath` and refreshes displayTitle to
   * the new basename. Used after `doc_move_folder` succeeds.
   */
  async renameFolderPathInStore(
    scope: string,
    mountPoint: string | null | undefined,
    oldFolderPath: string,
    newFolderPath: string,
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        const normalizedMount = mountPoint ?? null;
        const oldPrefix = oldFolderPath.endsWith('/') ? oldFolderPath : `${oldFolderPath}/`;
        const newPrefix = newFolderPath.endsWith('/') ? newFolderPath : `${newFolderPath}/`;
        const all = await this.findByFilter({ scope } as TypedQueryFilter<ChatDocument>);
        const matching = all.filter(r =>
          (r.mountPoint ?? null) === normalizedMount &&
          r.filePath.startsWith(oldPrefix)
        );
        let count = 0;
        for (const row of matching) {
          const newFilePath = newPrefix + row.filePath.slice(oldPrefix.length);
          const slash = newFilePath.lastIndexOf('/');
          const newDisplayTitle = slash >= 0 ? newFilePath.slice(slash + 1) : newFilePath;
          const updated = await this.update(row.id, {
            filePath: newFilePath,
            displayTitle: newDisplayTitle,
          });
          if (updated) count++;
        }
        return count;
      },
      'Error renaming chat document folder path in store',
      { scope, mountPoint, oldFolderPath, newFolderPath },
      0,
    );
  }

  /**
   * Delete all document associations for a chat (cascade cleanup)
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const docs = await this.findByChatId(chatId);
        let count = 0;
        for (const doc of docs) {
          const deleted = await this.delete(doc.id);
          if (deleted) count++;
        }
        return count;
      },
      'Error deleting documents by chat ID',
      { chatId },
      0
    );
  }
}
