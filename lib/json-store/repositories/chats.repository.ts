/**
 * Chats Repository
 *
 * Handles CRUD operations for Chat metadata and messages.
 * Chat metadata is stored in: data/chats/index.jsonl
 * Chat messages are stored in: data/chats/{chatId}.jsonl
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import { ChatMetadata, ChatMetadataSchema, ChatEvent, ChatEventSchema } from '../schemas/types';

export class ChatsRepository extends BaseRepository<ChatMetadata> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, ChatMetadataSchema);
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
   * Read all chat metadata from JSONL index
   */
  private async readAllMetadata(): Promise<ChatMetadata[]> {
    try {
      const entries = await this.jsonStore.readJsonl<ChatMetadata>(this.getIndexPath());
      return entries.map(entry => this.validate(entry));
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
   * Find chats by character ID
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    const chats = await this.readAllMetadata();
    return chats.filter(chat => chat.characterId === characterId);
  }

  /**
   * Find chats by persona ID
   */
  async findByPersonaId(personaId: string): Promise<ChatMetadata[]> {
    const chats = await this.readAllMetadata();
    return chats.filter(chat => chat.personaId === personaId);
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

    chat.tags = chat.tags.filter(id => id !== tagId);
    return await this.update(chatId, { tags: chat.tags });
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
}
