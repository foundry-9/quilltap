/**
 * Chats Repository
 *
 * Backend-agnostic repository for Chat metadata and messages.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations for Chat metadata and messages using two collections:
 * - 'chats': stores ChatMetadata documents
 * - 'chat_messages': stores messages as individual rows (SQLite) or embedded arrays (legacy data)
 *
 * Chats use a participant-based model where each chat has an array of
 * ChatParticipant objects. All participants are CHARACTER type (user-controlled
 * characters have controlledBy: 'user'). Each CHARACTER participant has its own
 * connectionProfileId and optional imageProfileId.
 *
 * Operations are split into focused modules via composition:
 * - ChatParticipantsOps: participant add/update/remove/query
 * - ChatImpersonationOps: impersonation management
 * - ChatTokenTrackingOps: token usage aggregates
 * - ChatMessagesOps: message CRUD
 * - ChatSearchReplaceOps: text search and replace in messages
 */

import { TaggableBaseRepository, CreateOptions } from './base.repository';
import {
  ChatMetadata,
  ChatMetadataBaseSchema,
  ChatMetadataInput,
  ChatEvent,
  ChatParticipantBase,
  ChatParticipantBaseInput,
  ParticipantStatus,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, QueryFilter, DatabaseCollection } from '../interfaces';
import { getDatabaseAsync, getBackendType, ensureCollection } from '../manager';
import type { EquippedSlots, EquippedOutfitState } from '@/lib/schemas/wardrobe.types';
import { WARDROBE_SLOT_TYPES, normalizeEquippedSlots } from '@/lib/schemas/wardrobe.types';
import { ChatOpsContext } from './chats-ops-context';
import { ChatParticipantsOps } from './chats-participants.ops';
import { ChatImpersonationOps } from './chats-impersonation.ops';
import { ChatTokenTrackingOps } from './chats-tokens.ops';
import { ChatMessagesOps, ChatMessageRowSchema } from './chats-messages.ops';
import { ChatSearchReplaceOps } from './chats-search.ops';

/**
 * Chats repository with database abstraction layer backend
 */
export class ChatsRepository extends TaggableBaseRepository<ChatMetadata> {
  private messagesCollectionName = 'chat_messages';
  private messagesCollectionInitialized = false;

  // Ops modules
  private participantsOps: ChatParticipantsOps;
  private impersonationOps: ChatImpersonationOps;
  private tokensOps: ChatTokenTrackingOps;
  private messagesOps: ChatMessagesOps;
  private searchOps: ChatSearchReplaceOps;

  constructor() {
    super('chats', ChatMetadataBaseSchema);

    // Build the shared context from bound methods
    const ctx: ChatOpsContext = {
      findById: this.findById.bind(this),
      update: this.update.bind(this),
      getCollection: this.getCollection.bind(this),
      getMessagesCollection: this.getMessagesCollection.bind(this),
      isSQLiteBackend: this.isSQLiteBackend.bind(this),
      generateId: this.generateId.bind(this),
      getCurrentTimestamp: this.getCurrentTimestamp.bind(this),
    };

    this.participantsOps = new ChatParticipantsOps(ctx);
    this.impersonationOps = new ChatImpersonationOps(ctx);
    this.tokensOps = new ChatTokenTrackingOps(ctx);
    this.messagesOps = new ChatMessagesOps(ctx);
    this.searchOps = new ChatSearchReplaceOps(ctx, this.messagesOps);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Check if using SQLite backend (normalized messages) vs legacy embedded array format
   */
  private isSQLiteBackend(): boolean {
    return getBackendType() === 'sqlite';
  }

  /**
   * Ensure the messages collection is initialized with proper schema (for SQLite JSON column detection)
   */
  private async ensureMessagesCollectionInitialized(): Promise<void> {
    if (this.messagesCollectionInitialized) {
      return;
    }

    try {
      // Ensure collection is initialized with proper schema for JSON column detection
      if (this.isSQLiteBackend()) {
        await ensureCollection(this.messagesCollectionName, ChatMessageRowSchema);
      }
      this.messagesCollectionInitialized = true;
    } catch (error) {
      logger.error('Failed to ensure chat_messages collection', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - allow continued operation even if schema setup fails
    }
  }

  /**
   * Get the messages collection
   */
  private async getMessagesCollection(): Promise<DatabaseCollection> {
    return this.safeQuery(
      async () => {
        // Ensure collection is initialized with proper schema for JSON column detection
        await this.ensureMessagesCollectionInitialized();

        const db = await getDatabaseAsync();
        return db.getCollection(this.messagesCollectionName);
      },
      'Failed to get chat messages collection',
      { messagesCollection: this.messagesCollectionName }
    );
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Find a chat by ID (metadata only)
   */
  async findById(id: string): Promise<ChatMetadata | null> {
    return this._findById(id);
  }

  /**
   * Find all chats
   */
  async findAll(): Promise<ChatMetadata[]> {
    return this._findAll();
  }

  /**
   * Find chats by user ID
   */
  async findByUserId(userId: string): Promise<ChatMetadata[]> {
    return this.findByFilter({ userId });
  }

  /**
   * Find chats that include a specific character as a participant
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    return this.safeQuery(
      async () => {
        const chats = await this.findByFilter({
          'participants.characterId': characterId,
        } as TypedQueryFilter<ChatMetadata>);
        return chats;
      },
      'Failed to find chats by character ID',
      { characterId }
    );
  }

  /**
   * Find the N most-recent salon chats for a character that have a contextSummary,
   * sorted by lastMessageAt descending. Used by the memory-recap "Recent Conversations"
   * block. Filter, sort, and limit are all pushed to SQL.
   *
   * Note: the participants JSON-array filter is the bottleneck at scale (no index can
   * cover it cheaply). If this is moved to a per-message hot path, consider denormalizing
   * participants into a join table.
   */
  async findRecentSummarizedByCharacter(
    characterId: string,
    options: { limit: number; excludeChatId?: string }
  ): Promise<ChatMetadata[]> {
    return this.safeQuery(
      async () => {
        const filter: Record<string, unknown> = {
          'participants.characterId': characterId,
          contextSummary: { $exists: true },
          // Exclude the stripped-down floating surfaces (Help Chat, Brahma
          // Console) from the per-character memory-recap "Recent Conversations"
          // pool. Any new non-salon type should be added here too.
          chatType: { $nin: ['help', 'brahma'] },
        };
        if (options.excludeChatId) {
          filter.id = { $ne: options.excludeChatId };
        }
        return this.findByFilter(filter as TypedQueryFilter<ChatMetadata>, {
          sort: { lastMessageAt: 'desc' },
          limit: options.limit,
        });
      },
      'Failed to find recent summarized chats by character',
      { characterId, limit: options.limit }
    );
  }

  /**
   * Find chats by user ID and chat type
   */
  async findByType(userId: string, chatType: 'salon' | 'help' | 'brahma'): Promise<ChatMetadata[]> {
    return this.findByFilter({ userId, chatType } as TypedQueryFilter<ChatMetadata>);
  }

  /**
   * Create a new chat
   * @param data The chat data (without id, createdAt, updatedAt). Fields with defaults are optional.
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   */
  async create(
    data: Omit<ChatMetadataInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ChatMetadata> {
    return this.safeQuery(
      async () => {
        // Ensure required defaults for ChatMetadata from ChatMetadataInput
        const chatData = {
          ...data,
          tags: data.tags ?? [],
          participants: data.participants ?? [],
          impersonatingParticipantIds: data.impersonatingParticipantIds ?? [],
        } as Omit<ChatMetadata, 'id' | 'createdAt' | 'updatedAt'>;

        const chat = await this._create(chatData, options);

        // Legacy data compatibility: Create empty messages document for backward compat (not needed for SQLite - messages are individual rows)
        if (!this.isSQLiteBackend()) {
          try {
            const messagesCollection = await this.getMessagesCollection();
            const now = this.getCurrentTimestamp();

            const messagesDoc = {
              chatId: chat.id,
              messages: [],
              createdAt: now,
              updatedAt: now,
            };

            await messagesCollection.insertOne(messagesDoc as any);
          } catch (error) {
            logger.warn('Failed to create chat messages collection', {
              chatId: chat.id,
              error: error instanceof Error ? error.message : String(error),
            });
            // Don't fail the chat creation if messages collection creation fails
          }
        }

        logger.info('Chat created successfully', {
          chatId: chat.id,
          userId: data.userId,
          title: data.title,
        });

        return chat;
      },
      'Failed to create chat',
      {}
    );
  }

  /**
   * Update chat metadata
   * updatedAt is NOT automatically set — only new messages should update it.
   * To update updatedAt, explicitly include it in the data parameter.
   * Background jobs (danger classification, title update, etc.) must NOT
   * pass updatedAt so the chat's modified timestamp reflects the last message.
   */
  async update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null> {
    // Preserve existing updatedAt unless the caller explicitly provides it
    if (!('updatedAt' in data)) {
      const existing = await this.findById(id);
      if (existing) {
        return this._update(id, { ...data, updatedAt: existing.updatedAt });
      }
    }
    return this._update(id, data);
  }

  /**
   * Delete a chat (removes both metadata and messages).
   *
   * @param options.syncVaults When true (default), sweep this conversation's
   *   summary file out of every participant character's vault. Bulk callers
   *   that manage vaults wholesale (backup restore, import) pass `false`.
   */
  async delete(id: string, options?: { syncVaults?: boolean }): Promise<boolean> {
    const syncVaults = options?.syncVaults ?? true;
    return this.safeQuery(
      async () => {
        // Capture participants before the row is gone so we know which vaults
        // to sweep. Read fails closed — no participants means no cleanup.
        let participantCharacterIds: string[] = [];
        if (syncVaults) {
          try {
            const chat = await this.findById(id);
            if (chat) {
              participantCharacterIds = Array.from(
                new Set(chat.participants.map(p => p.characterId))
              );
            }
          } catch {
            // best-effort — proceed with the delete regardless
          }
        }

        const result = await this._delete(id);

        if (!result) {
          return false;
        }

        // Delete messages
        try {
          const messagesCollection = await this.getMessagesCollection();
          if (this.isSQLiteBackend()) {
            // SQLite: Delete all message rows for this chat
            await messagesCollection.deleteMany({ chatId: id } as QueryFilter);
          } else {
            // Legacy data compatibility: Delete the single messages document
            await messagesCollection.deleteOne({ chatId: id } as QueryFilter);
          }
        } catch (error) {
          logger.warn('Failed to delete chat messages', {
            chatId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Sweep this conversation's per-message annotations. They live on no
        // FK cascade, so without this a deleted chat leaks its annotation rows
        // — and a later restore of a migrated instance collides on the
        // UNIQUE(chatId, messageIndex, characterName) constraint (Bug 10).
        try {
          const { getRepositories } = await import('@/lib/repositories/factory');
          await getRepositories().conversationAnnotations.deleteAllForChat(id);
        } catch (error) {
          logger.warn('Failed to delete conversation annotations for chat', {
            chatId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Sweep the conversation's summary file out of each participant vault.
        if (syncVaults && participantCharacterIds.length > 0) {
          try {
            const { removeConversationSummariesFromVaults } = await import(
              '@/lib/file-storage/conversation-summary-vault-bridge'
            );
            await removeConversationSummariesFromVaults({
              chatId: id,
              participantCharacterIds,
            });
          } catch (error) {
            logger.warn('Failed to sweep conversation summaries from vaults', {
              chatId: id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('Chat deleted', { chatId: id });
        return true;
      },
      'Failed to delete chat',
      { chatId: id }
    );
  }

  // ============================================================================
  // TOKEN USAGE TRACKING (delegated to ChatTokenTrackingOps)
  // ============================================================================

  async incrementTokenAggregates(
    chatId: string,
    promptTokens: number,
    completionTokens: number,
    estimatedCost: number | null,
    priceSource?: string
  ): Promise<void> {
    return this.tokensOps.incrementTokenAggregates(chatId, promptTokens, completionTokens, estimatedCost, priceSource);
  }

  async resetTokenAggregates(chatId: string): Promise<ChatMetadata | null> {
    return this.tokensOps.resetTokenAggregates(chatId);
  }

  // ============================================================================
  // PARTICIPANT OPERATIONS (delegated to ChatParticipantsOps)
  // ============================================================================

  async addParticipant(
    chatId: string,
    participant: Omit<ChatParticipantBaseInput, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ChatMetadata | null> {
    return this.participantsOps.addParticipant(chatId, participant);
  }

  async updateParticipant(
    chatId: string,
    participantId: string,
    data: Partial<Omit<ChatParticipantBase, 'id' | 'createdAt'>>
  ): Promise<ChatMetadata | null> {
    return this.participantsOps.updateParticipant(chatId, participantId, data);
  }

  async removeParticipant(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return this.participantsOps.removeParticipant(chatId, participantId);
  }

  async setParticipantStatus(
    chatId: string,
    participantId: string,
    newStatus: ParticipantStatus
  ): Promise<{ chat: ChatMetadata | null; oldStatus: ParticipantStatus }> {
    return this.participantsOps.setParticipantStatus(chatId, participantId, newStatus);
  }

  getCharacterParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getCharacterParticipants(chat);
  }

  getActiveParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getActiveParticipants(chat);
  }

  getLLMControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getLLMControlledParticipants(chat);
  }

  getUserControlledParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return this.participantsOps.getUserControlledParticipants(chat);
  }

  // ============================================================================
  // IMPERSONATION OPERATIONS (delegated to ChatImpersonationOps)
  // ============================================================================

  async addImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return this.impersonationOps.addImpersonation(chatId, participantId);
  }

  async removeImpersonation(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    return this.impersonationOps.removeImpersonation(chatId, participantId);
  }

  async getImpersonatedParticipantIds(chatId: string): Promise<string[]> {
    return this.impersonationOps.getImpersonatedParticipantIds(chatId);
  }

  async setActiveTypingParticipant(chatId: string, participantId: string | null): Promise<ChatMetadata | null> {
    return this.impersonationOps.setActiveTypingParticipant(chatId, participantId);
  }

  async updateAllLLMPauseTurnCount(chatId: string, count: number): Promise<ChatMetadata | null> {
    return this.impersonationOps.updateAllLLMPauseTurnCount(chatId, count);
  }

  // ============================================================================
  // MESSAGE OPERATIONS (delegated to ChatMessagesOps)
  // ============================================================================

  async getMessages(chatId: string): Promise<ChatEvent[]> {
    return this.messagesOps.getMessages(chatId);
  }

  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    return this.messagesOps.addMessage(chatId, message);
  }

  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    return this.messagesOps.addMessages(chatId, messages);
  }

  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    return this.messagesOps.updateMessage(chatId, messageId, updates);
  }

  async findChatIdForMessage(messageId: string): Promise<string | null> {
    return this.messagesOps.findChatIdForMessage(messageId);
  }

  async getMessageCount(chatId: string): Promise<number> {
    return this.messagesOps.getMessageCount(chatId);
  }

  async getLastPlayedMessageAt(chatId: string): Promise<string | null> {
    return this.messagesOps.getLastPlayedMessageAt(chatId);
  }

  async clearMessages(chatId: string): Promise<boolean> {
    return this.messagesOps.clearMessages(chatId);
  }

  async deleteMessagesByIds(chatId: string, messageIds: string[]): Promise<number> {
    return this.messagesOps.deleteMessagesByIds(chatId, messageIds);
  }

  // ============================================================================
  // SEARCH AND REPLACE OPERATIONS (delegated to ChatSearchReplaceOps)
  // ============================================================================

  async countMessagesWithText(chatId: string, searchText: string): Promise<number> {
    return this.searchOps.countMessagesWithText(chatId, searchText);
  }

  async findMessagesWithText(
    chatId: string,
    searchText: string
  ): Promise<Array<{ messageId: string; content: string; chatId: string }>> {
    return this.searchOps.findMessagesWithText(chatId, searchText);
  }

  async replaceInMessages(
    chatId: string,
    searchText: string,
    replaceText: string
  ): Promise<number> {
    return this.searchOps.replaceInMessages(chatId, searchText, replaceText);
  }

  async searchMessagesGlobal(
    chatIds: string[],
    searchText: string,
    limit?: number
  ): Promise<Array<{ messageId: string; content: string; chatId: string; role: string; createdAt: string }>> {
    return this.searchOps.searchMessagesGlobal(chatIds, searchText, limit);
  }

  // ============================================================================
  // EQUIPPED OUTFIT STATE
  // ============================================================================

  /**
   * Get the full equipped outfit state for a chat (all characters)
   */
  async getEquippedOutfit(chatId: string): Promise<EquippedOutfitState | null> {
    return this.safeQuery(
      async () => {
        const chat = await this.findById(chatId);
        if (!chat || !chat.equippedOutfit) {
          return null;
        }
        // `equippedOutfit` is unconstrained JSON: rows written before a slot
        // existed carry fewer keys than `EquippedSlots` declares, and a raw
        // cast hands readers an `undefined` slot they then iterate. Normalize
        // on the way out so every consumer sees all five slots.
        const stored = chat.equippedOutfit as Record<string, unknown>;
        return Object.fromEntries(
          Object.entries(stored).map(([characterId, slots]) => [characterId, normalizeEquippedSlots(slots)]),
        ) as EquippedOutfitState;
      },
      'Failed to get equipped outfit',
      { chatId, context: 'wardrobe' },
      null
    );
  }

  /**
   * Get equipped slots for a specific character in a chat
   */
  async getEquippedOutfitForCharacter(chatId: string, characterId: string): Promise<EquippedSlots | null> {
    return this.safeQuery(
      async () => {
        const state = await this.getEquippedOutfit(chatId);
        if (!state || !state[characterId]) {
          return null;
        }
        return state[characterId];
      },
      'Failed to get equipped outfit for character',
      { chatId, characterId, context: 'wardrobe' },
      null
    );
  }

  /**
   * Set the entire equipped outfit for a character in a chat
   */
  async setEquippedOutfit(
    chatId: string,
    characterId: string,
    slots: EquippedSlots
  ): Promise<EquippedSlots | null> {
    return this.safeQuery(
      async () => {
        const existing = await this.getEquippedOutfit(chatId);
        const state: EquippedOutfitState = existing ?? {};

        state[characterId] = slots;

        await this.update(chatId, { equippedOutfit: state } as Partial<ChatMetadata>);

        return slots;
      },
      'Failed to set equipped outfit',
      { chatId, characterId, context: 'wardrobe' },
      null
    );
  }
  /**
   * Remove a wardrobe item from equipped outfits across all chats.
   * When a wardrobe item is deleted, any equipped slot referencing that item
   * is set to null so the outfit state remains valid.
   *
   * @param itemId The wardrobe item ID being removed
   * @returns Number of chats modified
   */
  async removeEquippedItemFromAllChats(itemId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const allChats = await this._findAll();
        let modifiedCount = 0;

        for (const chat of allChats) {
          if (!chat.equippedOutfit) {
            continue;
          }

          const state = chat.equippedOutfit as EquippedOutfitState;
          let chatModified = false;

          for (const characterId of Object.keys(state)) {
            const slots = state[characterId];
            for (const slotKey of WARDROBE_SLOT_TYPES) {
              const before = slots[slotKey] ?? [];
              if (before.includes(itemId)) {
                slots[slotKey] = before.filter((id) => id !== itemId);
                chatModified = true;
              }
            }
          }

          if (chatModified) {
            await this.update(chat.id, { equippedOutfit: state } as Partial<ChatMetadata>);
            modifiedCount++;
          }
        }

        if (modifiedCount > 0) {
          logger.info('Removed wardrobe item from equipped outfits across chats', {
            itemId,
            chatsModified: modifiedCount,
            context: 'wardrobe',
          });
        }

        return modifiedCount;
      },
      'Error removing equipped item from all chats',
      { itemId, context: 'wardrobe' }
    );
  }
}

