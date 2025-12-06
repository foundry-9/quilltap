/**
 * MongoDB Chats Repository
 *
 * Handles CRUD operations for Chat metadata and messages using MongoDB.
 * Uses two collections:
 * - 'chats': stores ChatMetadata documents
 * - 'chat_messages': stores messages as { chatId, messages: ChatEvent[] }
 *
 * Chats use a participant-based model where each chat has an array of
 * ChatParticipant objects. Participants can be either CHARACTER (AI) or
 * PERSONA (user representation). Each CHARACTER participant has its own
 * connectionProfileId and optional imageProfileId.
 */

import { Collection, Filter } from 'mongodb';
import { z } from 'zod';
import { MongoBaseRepository } from './base.repository';
import {
  ChatMetadata,
  ChatMetadataBaseSchema,
  ChatEvent,
  ChatEventSchema,
  ChatParticipantBase,
  ChatParticipantBaseSchema,
} from '@/lib/schemas/types';
import { logger } from '@/lib/logger';

/**
 * Chats repository with MongoDB backend
 */
export class MongoChatsRepository extends MongoBaseRepository<ChatMetadata> {
  private messagesCollectionName = 'chat_messages';

  constructor() {
    super('chats', ChatMetadataBaseSchema);
    logger.debug('Initialized MongoChatsRepository');
  }

  /**
   * Get the messages collection
   */
  private async getMessagesCollection(): Promise<Collection> {
    try {
      const db = await (this as any).getCollection(); // Reuse parent's getCollection pattern
      const dbInstance = (await (this as any).getCollection()).db;
      logger.debug('Retrieved chat messages collection', {
        collection: this.messagesCollectionName
      });
      return dbInstance.collection(this.messagesCollectionName);
    } catch (error) {
      logger.error('Failed to get chat messages collection', {
        collection: this.messagesCollectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find a chat by ID (metadata only)
   */
  async findById(id: string): Promise<ChatMetadata | null> {
    try {
      logger.debug('Finding chat by ID', { chatId: id });
      const collection = await (this as any).getCollection();
      const chat = await collection.findOne({ id });

      if (!chat) {
        logger.debug('Chat not found', { chatId: id });
        return null;
      }

      const validated = this.validate(chat);
      logger.debug('Chat found and validated', { chatId: id });
      return validated;
    } catch (error) {
      logger.error('Failed to find chat by ID', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all chats
   */
  async findAll(): Promise<ChatMetadata[]> {
    try {
      logger.debug('Finding all chats');
      const collection = await (this as any).getCollection();
      const chats = await collection.find({}).toArray();

      const validated = chats.map((chat: unknown) => this.validate(chat));
      logger.debug('Found all chats', { count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to find all chats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats by user ID
   */
  async findByUserId(userId: string): Promise<ChatMetadata[]> {
    try {
      logger.debug('Finding chats by user ID', { userId });
      const collection = await (this as any).getCollection();
      const chats = await collection.find({ userId }).toArray();

      const validated = chats.map((chat: unknown) => this.validate(chat));
      logger.debug('Found chats for user', { userId, count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to find chats by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats that include a specific character as a participant
   */
  async findByCharacterId(characterId: string): Promise<ChatMetadata[]> {
    try {
      logger.debug('Finding chats by character ID', { characterId });
      const collection = await (this as any).getCollection();
      const chats = await collection.find({
        'participants.type': 'CHARACTER',
        'participants.characterId': characterId,
      }).toArray();

      const validated = chats.map((chat: unknown) => this.validate(chat));
      logger.debug('Found chats with character', { characterId, count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to find chats by character ID', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats that include a specific persona as a participant
   */
  async findByPersonaId(personaId: string): Promise<ChatMetadata[]> {
    try {
      logger.debug('Finding chats by persona ID', { personaId });
      const collection = await (this as any).getCollection();
      const chats = await collection.find({
        'participants.type': 'PERSONA',
        'participants.personaId': personaId,
      }).toArray();

      const validated = chats.map((chat: unknown) => this.validate(chat));
      logger.debug('Found chats with persona', { personaId, count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to find chats by persona ID', {
        personaId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find chats with a specific tag
   */
  async findByTag(tagId: string): Promise<ChatMetadata[]> {
    try {
      logger.debug('Finding chats by tag', { tagId });
      const collection = await (this as any).getCollection();
      const chats = await collection.find({ tags: tagId }).toArray();

      const validated = chats.map((chat: unknown) => this.validate(chat));
      logger.debug('Found chats with tag', { tagId, count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to find chats by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new chat
   */
  async create(data: Omit<ChatMetadata, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChatMetadata> {
    try {
      logger.debug('Creating new chat', { userId: data.userId, title: data.title });

      const id = (this as any).generateId();
      const now = (this as any).getCurrentTimestamp();

      const chat: ChatMetadata = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(chat);
      const collection = await (this as any).getCollection();

      // Insert into chats collection
      await collection.insertOne(validated as any);

      // Create empty messages document
      const messagesDoc = {
        chatId: id,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };

      const messagesCollection = await (this as any).getCollection();
      const msgDb = messagesCollection.db;
      await msgDb.collection(this.messagesCollectionName).insertOne(messagesDoc);

      logger.info('Chat created successfully', {
        chatId: id,
        userId: data.userId,
        title: data.title,
      });

      return validated;
    } catch (error) {
      logger.error('Failed to create chat', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update chat metadata
   */
  async update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null> {
    try {
      logger.debug('Updating chat', { chatId: id });

      const now = (this as any).getCurrentTimestamp();
      const collection = await (this as any).getCollection();

      // Prepare update data, excluding id and createdAt
      const { id: _id, createdAt: _createdAt, ...updateFields } = data as Record<string, unknown>;
      const updateData = {
        $set: {
          ...updateFields,
          updatedAt: now,
        },
      };

      const result = await collection.findOneAndUpdate(
        { id } as Filter<ChatMetadata>,
        updateData,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.debug('Chat not found for update', { chatId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Chat updated successfully', { chatId: id });
      return validated;
    } catch (error) {
      logger.error('Failed to update chat', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a chat (removes both metadata and messages)
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting chat', { chatId: id });

      const collection = await (this as any).getCollection();
      const result = await collection.deleteOne({ id } as Filter<ChatMetadata>);

      if (result.deletedCount === 0) {
        logger.debug('Chat not found for deletion', { chatId: id });
        return false;
      }

      // Delete messages document
      try {
        const messagesCollection = await (this as any).getCollection();
        const msgDb = messagesCollection.db;
        await msgDb.collection(this.messagesCollectionName).deleteOne({ chatId: id });
        logger.debug('Chat messages deleted', { chatId: id });
      } catch (error) {
        logger.warn('Failed to delete chat messages', {
          chatId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      logger.info('Chat deleted successfully', { chatId: id });
      return true;
    } catch (error) {
      logger.error('Failed to delete chat', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // TAG OPERATIONS
  // ============================================================================

  /**
   * Add a tag to a chat
   */
  async addTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    try {
      logger.debug('Adding tag to chat', { chatId, tagId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for tag operation', { chatId });
        return null;
      }

      if (!chat.tags.includes(tagId)) {
        const updatedTags = [...chat.tags, tagId];
        return await this.update(chatId, { tags: updatedTags });
      }

      return chat;
    } catch (error) {
      logger.error('Failed to add tag to chat', {
        chatId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from a chat
   */
  async removeTag(chatId: string, tagId: string): Promise<ChatMetadata | null> {
    try {
      logger.debug('Removing tag from chat', { chatId, tagId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for tag operation', { chatId });
        return null;
      }

      const updatedTags = chat.tags.filter(tid => tid !== tagId);
      return await this.update(chatId, { tags: updatedTags });
    } catch (error) {
      logger.error('Failed to remove tag from chat', {
        chatId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    try {
      logger.debug('Adding participant to chat', {
        chatId,
        type: participant.type,
        characterId: participant.characterId,
        personaId: participant.personaId,
      });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for participant operation', { chatId });
        return null;
      }

      const now = (this as any).getCurrentTimestamp();
      const newParticipant: ChatParticipantBase = {
        ...participant,
        id: (this as any).generateId(),
        createdAt: now,
        updatedAt: now,
      };

      // Validate the participant
      ChatParticipantBaseSchema.parse(newParticipant);

      const participants = [...chat.participants, newParticipant];
      return await this.update(chatId, { participants });
    } catch (error) {
      logger.error('Failed to add participant to chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a participant in a chat
   */
  async updateParticipant(
    chatId: string,
    participantId: string,
    data: Partial<Omit<ChatParticipantBase, 'id' | 'createdAt'>>
  ): Promise<ChatMetadata | null> {
    try {
      logger.debug('Updating participant in chat', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for participant operation', { chatId });
        return null;
      }

      const participantIndex = chat.participants.findIndex(p => p.id === participantId);
      if (participantIndex === -1) {
        logger.debug('Participant not found', { chatId, participantId });
        return null;
      }

      const now = (this as any).getCurrentTimestamp();
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
    } catch (error) {
      logger.error('Failed to update participant in chat', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a participant from a chat
   */
  async removeParticipant(chatId: string, participantId: string): Promise<ChatMetadata | null> {
    try {
      logger.debug('Removing participant from chat', { chatId, participantId });

      const chat = await this.findById(chatId);
      if (!chat) {
        logger.debug('Chat not found for participant operation', { chatId });
        return null;
      }

      const participants = chat.participants.filter(p => p.id !== participantId);

      // Don't allow removing all participants
      if (participants.length === 0) {
        const error = new Error('Cannot remove the last participant from a chat');
        logger.error('Cannot remove last participant', { chatId, participantId });
        throw error;
      }

      return await this.update(chatId, { participants });
    } catch (error) {
      logger.error('Failed to remove participant from chat', {
        chatId,
        participantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all character participants from a chat
   */
  getCharacterParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    logger.debug('Getting character participants', {
      chatId: chat.id,
      count: chat.participants.filter(p => p.type === 'CHARACTER').length,
    });
    return chat.participants.filter(p => p.type === 'CHARACTER');
  }

  /**
   * Get all persona participants from a chat
   */
  getPersonaParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    logger.debug('Getting persona participants', {
      chatId: chat.id,
      count: chat.participants.filter(p => p.type === 'PERSONA').length,
    });
    return chat.participants.filter(p => p.type === 'PERSONA');
  }

  /**
   * Get active participants only
   */
  getActiveParticipants(chat: ChatMetadata): ChatParticipantBase[] {
    logger.debug('Getting active participants', {
      chatId: chat.id,
      count: chat.participants.filter(p => p.isActive).length,
    });
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
      logger.debug('Getting messages for chat', { chatId });

      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const messagesDoc = await messagesCollection.findOne({ chatId });

      if (!messagesDoc) {
        logger.debug('No messages document found', { chatId });
        return [];
      }

      const messages = (messagesDoc as any).messages || [];
      const validated = messages.map((msg: any) => ChatEventSchema.parse(msg));
      logger.debug('Retrieved messages for chat', { chatId, count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to get messages for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Add a message to a chat
   */
  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    try {
      logger.debug('Adding message to chat', {
        chatId,
        messageId: message.id,
        type: message.type,
      });

      const validated = ChatEventSchema.parse(message);
      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Use updateOne with upsert to handle both creating and updating messages document
      await messagesCollection.updateOne(
        { chatId },
        {
          $push: { messages: validated },
          $set: { updatedAt: now },
        },
        { upsert: true }
      );

      // Update chat metadata with message count and last message timestamp
      const chat = await this.findById(chatId);
      if (chat) {
        const messages = await this.getMessages(chatId);
        await this.update(chatId, {
          messageCount: messages.length,
          lastMessageAt: now,
        });
      }

      logger.debug('Message added to chat', { chatId, messageId: message.id });
      return validated;
    } catch (error) {
      logger.error('Failed to add message to chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add multiple messages to a chat
   */
  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    try {
      logger.debug('Adding messages to chat', {
        chatId,
        count: messages.length,
      });

      const validated = messages.map(msg => ChatEventSchema.parse(msg));
      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Use updateOne with upsert to handle both creating and updating messages document
      await messagesCollection.updateOne(
        { chatId },
        {
          $push: { messages: { $each: validated } },
          $set: { updatedAt: now },
        },
        { upsert: true }
      );

      // Update chat metadata
      const chat = await this.findById(chatId);
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        await this.update(chatId, {
          messageCount: allMessages.length,
          lastMessageAt: now,
        });
      }

      logger.debug('Messages added to chat', { chatId, count: validated.length });
      return validated;
    } catch (error) {
      logger.error('Failed to add messages to chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a specific message in a chat
   */
  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    try {
      logger.debug('Updating message in chat', { chatId, messageId });

      const messages = await this.getMessages(chatId);
      const messageIndex = messages.findIndex(m => m.id === messageId);

      if (messageIndex === -1) {
        logger.debug('Message not found', { chatId, messageId });
        return null;
      }

      // Merge updates with existing message
      const updatedMessage = { ...messages[messageIndex], ...updates };
      const validated = ChatEventSchema.parse(updatedMessage);

      // Replace message in array
      messages[messageIndex] = validated;

      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Update entire messages array
      await messagesCollection.updateOne(
        { chatId },
        {
          $set: {
            messages: messages,
            updatedAt: now,
          },
        }
      );

      logger.debug('Message updated in chat', { chatId, messageId });
      return validated;
    } catch (error) {
      logger.error('Failed to update message in chat', {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get message count for a chat
   */
  async getMessageCount(chatId: string): Promise<number> {
    try {
      logger.debug('Getting message count for chat', { chatId });

      const messages = await this.getMessages(chatId);
      logger.debug('Retrieved message count', { chatId, count: messages.length });
      return messages.length;
    } catch (error) {
      logger.error('Failed to get message count for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Clear all messages from a chat
   */
  async clearMessages(chatId: string): Promise<boolean> {
    try {
      logger.debug('Clearing messages for chat', { chatId });

      const collection = await (this as any).getCollection();
      const msgDb = collection.db;
      const messagesCollection = msgDb.collection(this.messagesCollectionName);

      const now = (this as any).getCurrentTimestamp();

      // Clear messages array
      await messagesCollection.updateOne(
        { chatId },
        {
          $set: {
            messages: [],
            updatedAt: now,
          },
        },
        { upsert: true }
      );

      // Reset metadata
      const chat = await this.findById(chatId);
      if (chat) {
        await this.update(chatId, {
          messageCount: 0,
          lastMessageAt: null,
        });
      }

      logger.info('Messages cleared for chat', { chatId });
      return true;
    } catch (error) {
      logger.error('Failed to clear messages for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

// Export singleton instance
export const mongoChatsRepository = new MongoChatsRepository();
