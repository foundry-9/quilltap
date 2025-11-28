/**
 * Chats Repository
 *
 * Handles CRUD operations for Chat metadata and messages.
 * Chat metadata is stored in: data/chats/index.jsonl
 * Chat messages are stored in: data/chats/{chatId}.jsonl
 *
 * Chats use a participant-based model where each chat has an array of
 * ChatParticipant objects. Participants can be either CHARACTER (AI) or
 * PERSONA (user representation). Each CHARACTER participant has its own
 * connectionProfileId and optional imageProfileId.
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import {
  ChatMetadata,
  ChatMetadataBaseSchema,
  ChatMetadataLegacySchema,
  ChatEvent,
  ChatEventSchema,
  ChatParticipantBase,
  ChatParticipantBaseSchema,
} from '../schemas/types';

// Type for raw data that might be legacy or new format
type RawChatData = Record<string, unknown>;

export class ChatsRepository extends BaseRepository<ChatMetadata> {
  constructor(jsonStore: JsonStore) {
    // Use base schema for validation (without refinements that require participants)
    super(jsonStore, ChatMetadataBaseSchema);
  }

  /**
   * Get the chats index file path
   */
  private getIndexPath(): string {
    return 'chats/index.jsonl';
  }

  /**
   * Get the chat messages file path
   */
  private getChatPath(chatId: string): string {
    return `chats/${chatId}.jsonl`;
  }

  /**
   * Migrate legacy chat format to new participant-based format
   */
  private migrateFromLegacy(rawData: RawChatData): ChatMetadata {
    // Check if this is legacy format (has characterId at top level)
    if ('characterId' in rawData && !('participants' in rawData)) {
      const legacyResult = ChatMetadataLegacySchema.safeParse(rawData);

      if (legacyResult.success) {
        const legacy = legacyResult.data;
        const now = this.getCurrentTimestamp();

        // Create participants from legacy fields
        const participants: ChatParticipantBase[] = [];

        // Add character participant
        participants.push({
          id: this.generateId(),
          type: 'CHARACTER',
          characterId: legacy.characterId,
          personaId: null,
          connectionProfileId: legacy.connectionProfileId,
          imageProfileId: legacy.imageProfileId || null,
          systemPromptOverride: null,
          displayOrder: 0,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });

        // Add persona participant if present
        if (legacy.personaId) {
          participants.push({
            id: this.generateId(),
            type: 'PERSONA',
            characterId: null,
            personaId: legacy.personaId,
            connectionProfileId: null,
            imageProfileId: null,
            systemPromptOverride: null,
            displayOrder: 1,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Return migrated format
        return {
          id: legacy.id,
          userId: legacy.userId,
          participants,
          title: legacy.title,
          contextSummary: legacy.contextSummary,
          sillyTavernMetadata: legacy.sillyTavernMetadata,
          tags: legacy.tags,
          messageCount: legacy.messageCount,
          lastMessageAt: legacy.lastMessageAt,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt,
        };
      }
    }

    // Not legacy format or failed to parse as legacy, try new format
    return this.validate(rawData as ChatMetadata);
  }

  /**
   * Read all chat metadata from JSONL index, migrating legacy entries
   */
  private async readAllMetadata(): Promise<ChatMetadata[]> {
    try {
      const entries = await this.jsonStore.readJsonl<RawChatData>(this.getIndexPath());
      return entries.map(entry => this.migrateFromLegacy(entry));
    } catch (error) {
      return [];
    }
  }

  /**
   * Find a chat by ID
   */
  async findById(id: string): Promise<ChatMetadata | null> {
    const chats = await this.readAllMetadata();
    return chats.find(chat => chat.id === id) || null;
  }

  /**
   * Find all chats
   */
  async findAll(): Promise<ChatMetadata[]> {
    return await this.readAllMetadata();
  }

  /**
   * Find chats by user ID
   */
  async findByUserId(userId: string): Promise<ChatMetadata[]> {
    const chats = await this.readAllMetadata();
    return chats.filter(chat => chat.userId === userId);
  }

  /**
   * Find chats that include a specific character as a participant
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    const chats = await this.readAllMetadata();
    return chats.filter(chat =>
      chat.participants.some(p => p.type === 'CHARACTER' && p.characterId === characterId)
    );
  }

  /**
   * Find chats that include a specific persona as a participant
   */
  async findByPersonaId(personaId: string): Promise<ChatMetadata[]> {
    const chats = await this.readAllMetadata();
    return chats.filter(chat =>
      chat.participants.some(p => p.type === 'PERSONA' && p.personaId === personaId)
    );
  }

  /**
   * Find chats with a specific tag
   */
  async findByTag(tagId: string): Promise<ChatMetadata[]> {
    const chats = await this.readAllMetadata();
    return chats.filter(chat => chat.tags.includes(tagId));
  }

  /**
   * Create a new chat
   */
  async create(data: Omit<ChatMetadata, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChatMetadata> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const chat: ChatMetadata = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(chat);

    // Add to index
    await this.jsonStore.appendJsonl(this.getIndexPath(), [validated]);

    // Create empty messages file (as JSONL, not JSON array)
    await this.jsonStore.writeRaw(this.getChatPath(id), '');

    return validated;
  }

  /**
   * Update chat metadata
   */
  async update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null> {
    const chats = await this.readAllMetadata();
    const index = chats.findIndex(chat => chat.id === id);

    if (index === -1) {
      return null;
    }

    const existing = chats[index];
    const now = this.getCurrentTimestamp();

    const updated: ChatMetadata = {
      ...existing,
      ...data,
      id: existing.id, // Preserve ID
      createdAt: existing.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    chats[index] = validated;

    // Rewrite entire index file as JSONL
    await this.jsonStore.writeJsonl(this.getIndexPath(), chats);

    return validated;
  }

  /**
   * Delete a chat (removes both metadata and messages)
   */
  async delete(id: string): Promise<boolean> {
    const chats = await this.readAllMetadata();
    const initialLength = chats.length;

    const filtered = chats.filter(chat => chat.id !== id);

    if (filtered.length === initialLength) {
      return false; // Chat not found
    }

    // Rewrite index without deleted chat as JSONL
    await this.jsonStore.writeJsonl(this.getIndexPath(), filtered);

    // Delete messages file
    try {
      await this.jsonStore.deleteFile(this.getChatPath(id));
    } catch (error) {
      console.warn(`Failed to delete chat messages file for ${id}:`, error);
    }

    return true;
  }

  /**
   * Add a tag to a chat
   */
  async addTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) {
      return null;
    }

    if (!chat.tags.includes(tagId)) {
      chat.tags.push(tagId);
      return await this.update(chatId, { tags: chat.tags });
    }

    return chat;
  }

  /**
   * Remove a tag from a chat
   */
  async removeTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) {
      return null;
    }

    chat.tags = chat.tags.filter(tid => tid !== tagId);
    return await this.update(chatId, { tags: chat.tags });
  }

  // ============================================================================
  // PARTICIPANT OPERATIONS
  // ============================================================================

  /**
   * Add a participant to a chat
   */
  async addParticipant(
    chatId: string,
    participant: Omit<ChatParticipantBase, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const newParticipant: ChatParticipantBase = {
      ...participant,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    // Validate the participant
    ChatParticipantBaseSchema.parse(newParticipant);

    const participants = [...chat.participants, newParticipant];
    return await this.update(chatId, { participants });
  }

  /**
   * Update a participant in a chat
   */
  async updateParticipant(
    chatId: string,
    participantId: string,
    data: Partial<Omit<ChatParticipantBase, 'id' | 'createdAt'>>
  ): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) {
      return null;
    }

    const participantIndex = chat.participants.findIndex(p => p.id === participantId);
    if (participantIndex === -1) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const existingParticipant = chat.participants[participantIndex];
    const updatedParticipant: ChatParticipantBase = {
      ...existingParticipant,
      ...data,
      id: existingParticipant.id,
      createdAt: existingParticipant.createdAt,
      updatedAt: now,
    };

    // Validate the updated participant
    ChatParticipantBaseSchema.parse(updatedParticipant);

    const participants = [...chat.participants];
    participants[participantIndex] = updatedParticipant;

    return await this.update(chatId, { participants });
  }

  /**
   * Remove a participant from a chat
   */
  async removeParticipant(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    const chat = await this.findById(chatId);
    if (!chat) {
      return null;
    }

    const participants = chat.participants.filter(p => p.id !== participantId);

    // Don't allow removing all participants
    if (participants.length === 0) {
      throw new Error('Cannot remove the last participant from a chat');
    }

    return await this.update(chatId, { participants });
  }

  /**
   * Get all character participants from a chat
   */
  getCharacterParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return chat.participants.filter(p => p.type === 'CHARACTER');
  }

  /**
   * Get all persona participants from a chat
   */
  getPersonaParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return chat.participants.filter(p => p.type === 'PERSONA');
  }

  /**
   * Get active participants only
   */
  getActiveParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    return chat.participants.filter(p => p.isActive);
  }

  // ============================================================================
  // MESSAGE OPERATIONS
  // ============================================================================

  /**
   * Get all messages for a chat
   */
  async getMessages(chatId: string): Promise<ChatEvent[]> {
    try {
      const messages = await this.jsonStore.readJsonl<ChatEvent>(this.getChatPath(chatId));
      return messages.map(msg => ChatEventSchema.parse(msg));
    } catch (error) {
      return [];
    }
  }

  /**
   * Add a message to a chat
   */
  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    const validated = ChatEventSchema.parse(message);
    await this.jsonStore.appendJsonl(this.getChatPath(chatId), [validated]);

    // Update chat metadata with message count and last message timestamp
    const chat = await this.findById(chatId);
    if (chat) {
      const messages = await this.getMessages(chatId);
      await this.update(chatId, {
        messageCount: messages.length,
        lastMessageAt: this.getCurrentTimestamp(),
      });
    }

    return validated;
  }

  /**
   * Add multiple messages to a chat
   */
  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    const validated = messages.map(msg => ChatEventSchema.parse(msg));
    await this.jsonStore.appendJsonl(this.getChatPath(chatId), validated);

    // Update chat metadata
    const chat = await this.findById(chatId);
    if (chat) {
      const allMessages = await this.getMessages(chatId);
      await this.update(chatId, {
        messageCount: allMessages.length,
        lastMessageAt: this.getCurrentTimestamp(),
      });
    }

    return validated;
  }

  /**
   * Update a specific message in a chat
   */
  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    try {
      const messages = await this.getMessages(chatId);
      const messageIndex = messages.findIndex(m => m.id === messageId);

      if (messageIndex === -1) {
        return null;
      }

      // Merge updates with existing message
      const updatedMessage = { ...messages[messageIndex], ...updates };
      const validated = ChatEventSchema.parse(updatedMessage);

      // Replace all messages in the file with updated version
      messages[messageIndex] = validated;
      await this.jsonStore.writeJsonl(this.getChatPath(chatId), messages);

      return validated;
    } catch (error) {
      console.error(`Failed to update message ${messageId} in chat ${chatId}:`, error);
      return null;
    }
  }

  /**
   * Get message count for a chat
   */
  async getMessageCount(chatId: string): Promise<number> {
    const messages = await this.getMessages(chatId);
    return messages.length;
  }

  /**
   * Clear all messages from a chat (for testing)
   */
  async clearMessages(chatId: string): Promise<boolean> {
    try {
      await this.jsonStore.deleteFile(this.getChatPath(chatId));
      await this.jsonStore.writeJsonl(this.getChatPath(chatId), []);

      // Reset metadata
      const chat = await this.findById(chatId);
      if (chat) {
        await this.update(chatId, {
          messageCount: 0,
          lastMessageAt: null,
        });
      }

      return true;
    } catch (error) {
      console.error(`Failed to clear messages for chat ${chatId}:`, error);
      return false;
    }
  }

  // ============================================================================
  // MIGRATION UTILITIES
  // ============================================================================

  /**
   * Migrate all chats from legacy format to new participant-based format.
   * This reads all chats, converts them, and writes them back.
   * Safe to run multiple times - already migrated chats are unchanged.
   */
  async migrateAllToParticipants(): Promise<{ migrated: number; total: number }> {
    try {
      const rawEntries = await this.jsonStore.readJsonl<RawChatData>(this.getIndexPath());
      let migratedCount = 0;

      const migratedChats = rawEntries.map(entry => {
        // Check if this needs migration
        if ('characterId' in entry && !('participants' in entry)) {
          migratedCount++;
        }
        return this.migrateFromLegacy(entry);
      });

      // Only rewrite if we actually migrated something
      if (migratedCount > 0) {
        await this.jsonStore.writeJsonl(this.getIndexPath(), migratedChats);
      }

      return { migrated: migratedCount, total: rawEntries.length };
    } catch (error) {
      console.error('Failed to migrate chats:', error);
      return { migrated: 0, total: 0 };
    }
  }
}
