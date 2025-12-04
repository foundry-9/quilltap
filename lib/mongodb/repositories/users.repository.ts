/**
 * MongoDB Users Repository
 *
 * Handles CRUD operations for User and ChatSettings entities.
 * Manages two collections: 'users' and 'chat_settings'.
 * Provides compound operations for GeneralSettings (user + chat settings).
 */

import { Collection } from 'mongodb';
import {
  User,
  UserSchema,
  ChatSettings,
  ChatSettingsSchema,
  GeneralSettings,
  GeneralSettingsSchema
} from '@/lib/json-store/schemas/types';
import { logger } from '@/lib/logger';
import { getMongoDatabase } from '../client';

/**
 * MongoDB Users Repository
 * Manages users and their associated chat settings across two collections
 */
export class UsersRepository {
  private usersCollectionName = 'users';
  private chatSettingsCollectionName = 'chat_settings';
  private userSchema = UserSchema;
  private chatSettingsSchema = ChatSettingsSchema;
  private generalSettingsSchema = GeneralSettingsSchema;

  /**
   * Get the users MongoDB collection
   */
  private async getUsersCollection(): Promise<Collection> {
    const db = await getMongoDatabase();
    const collection = db.collection(this.usersCollectionName);

    logger.debug('Retrieved MongoDB users collection', {
      collectionName: this.usersCollectionName,
    });

    return collection;
  }

  /**
   * Get the chat_settings MongoDB collection
   */
  private async getChatSettingsCollection(): Promise<Collection> {
    const db = await getMongoDatabase();
    const collection = db.collection(this.chatSettingsCollectionName);

    logger.debug('Retrieved MongoDB chat_settings collection', {
      collectionName: this.chatSettingsCollectionName,
    });

    return collection;
  }

  /**
   * Validate user data against schema
   */
  private validateUser(data: unknown): User {
    return this.userSchema.parse(data) as User;
  }

  /**
   * Validate chat settings data against schema
   */
  private validateChatSettings(data: unknown): ChatSettings {
    return this.chatSettingsSchema.parse(data) as ChatSettings;
  }

  /**
   * Validate general settings data against schema
   */
  private validateGeneralSettings(data: unknown): GeneralSettings {
    return this.generalSettingsSchema.parse(data) as GeneralSettings;
  }

  /**
   * Safely validate user data without throwing
   */
  private validateUserSafe(data: unknown): { success: boolean; data?: User; error?: string } {
    try {
      const validated = this.validateUser(data);
      return { success: true, data: validated };
    } catch (error: any) {
      logger.warn('User validation failed', {
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Safely validate chat settings data without throwing
   */
  private validateChatSettingsSafe(data: unknown): { success: boolean; data?: ChatSettings; error?: string } {
    try {
      const validated = this.validateChatSettings(data);
      return { success: true, data: validated };
    } catch (error: any) {
      logger.warn('ChatSettings validation failed', {
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Safely validate general settings data without throwing
   */
  private validateGeneralSettingsSafe(data: unknown): { success: boolean; data?: GeneralSettings; error?: string } {
    try {
      const validated = this.validateGeneralSettings(data);
      return { success: true, data: validated };
    } catch (error: any) {
      logger.warn('GeneralSettings validation failed', {
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate UUID v4
   */
  private generateId(): string {
    logger.debug('Generating UUID v4');
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current ISO-8601 timestamp
   */
  private getCurrentTimestamp(): string {
    const timestamp = new Date().toISOString();
    logger.debug('Generated timestamp', { timestamp });
    return timestamp;
  }

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  /**
   * Find a user by ID
   */
  async findById(id: string): Promise<User | null> {
    const collection = await this.getUsersCollection();

    logger.debug('Finding user by ID', {
      userId: id,
    });

    try {
      const user = await collection.findOne({ id });

      if (!user) {
        logger.debug('User not found', {
          userId: id,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...userData } = user as any;

      const validationResult = this.validateUserSafe(userData);
      if (!validationResult.success) {
        logger.warn('User validation failed', {
          userId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('User found by ID', {
        userId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding user by ID', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const collection = await this.getUsersCollection();

    logger.debug('Finding user by email', {
      email,
    });

    try {
      const user = await collection.findOne({ email });

      if (!user) {
        logger.debug('User not found by email', {
          email,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...userData } = user as any;

      const validationResult = this.validateUserSafe(userData);
      if (!validationResult.success) {
        logger.warn('User validation failed', {
          email,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('User found by email', {
        email,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding user by email', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all users
   */
  async findAll(): Promise<User[]> {
    const collection = await this.getUsersCollection();

    logger.debug('Finding all users');

    try {
      const users = await collection.find({}).toArray();

      logger.debug('Retrieved all users', {
        count: users.length,
      });

      // Map MongoDB documents to User objects, removing _id field
      const validatedUsers: User[] = [];
      for (const user of users) {
        const { _id, ...userData } = user as any;
        const validationResult = this.validateUserSafe(userData);
        if (validationResult.success && validationResult.data) {
          validatedUsers.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid user during findAll', {
            error: validationResult.error,
          });
        }
      }

      return validatedUsers;
    } catch (error) {
      logger.error('Error finding all users', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const collection = await this.getUsersCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating new user', {
      email: data.email,
    });

    try {
      const user: User = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validateUser(user);

      // Insert into MongoDB
      const result = await collection.insertOne(validated as any);

      logger.info('User created successfully', {
        userId: id,
        email: data.email,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating user', {
        email: data.email,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a user
   */
  async update(id: string, data: Partial<User>): Promise<User | null> {
    const collection = await this.getUsersCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating user', {
      userId: id,
    });

    try {
      // Prepare update data
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      // Remove id and createdAt to prevent accidental overwrites
      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('User not found during update', {
          userId: id,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...userData } = result as any;

      const validationResult = this.validateUserSafe(userData);
      if (!validationResult.success) {
        logger.warn('Updated user validation failed', {
          userId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('User updated successfully', {
        userId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error updating user', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a user
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getUsersCollection();

    logger.debug('Deleting user', {
      userId: id,
    });

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('User not found during delete', {
          userId: id,
        });
        return false;
      }

      logger.info('User deleted successfully', {
        userId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting user', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // CHAT SETTINGS OPERATIONS
  // ============================================================================

  /**
   * Get chat settings for a user
   */
  async getChatSettings(userId: string): Promise<ChatSettings | null> {
    const collection = await this.getChatSettingsCollection();

    logger.debug('Getting chat settings for user', {
      userId,
    });

    try {
      const chatSettings = await collection.findOne({ userId });

      if (!chatSettings) {
        logger.debug('Chat settings not found for user', {
          userId,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...settingsData } = chatSettings as any;

      const validationResult = this.validateChatSettingsSafe(settingsData);
      if (!validationResult.success) {
        logger.warn('ChatSettings validation failed', {
          userId,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Chat settings retrieved for user', {
        userId,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error getting chat settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create chat settings for a user
   */
  async createChatSettings(userId: string, data: Omit<ChatSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<ChatSettings> {
    const collection = await this.getChatSettingsCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating chat settings for user', {
      userId,
    });

    try {
      const chatSettings: ChatSettings = {
        ...data,
        id,
        userId,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validateChatSettings(chatSettings);

      // Insert into MongoDB
      const result = await collection.insertOne(validated as any);

      logger.info('Chat settings created successfully', {
        chatSettingsId: id,
        userId,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating chat settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update chat settings for a user
   */
  async updateChatSettings(userId: string, data: Partial<ChatSettings>): Promise<ChatSettings | null> {
    const collection = await this.getChatSettingsCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating chat settings for user', {
      userId,
    });

    try {
      // Prepare update data
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      // Remove id, userId, and createdAt to prevent accidental overwrites
      delete updateData.id;
      delete updateData.userId;
      delete updateData.createdAt;

      const result = await collection.findOneAndUpdate(
        { userId },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Chat settings not found during update', {
          userId,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...settingsData } = result as any;

      const validationResult = this.validateChatSettingsSafe(settingsData);
      if (!validationResult.success) {
        logger.warn('Updated chat settings validation failed', {
          userId,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Chat settings updated successfully', {
        userId,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error updating chat settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // GENERAL SETTINGS COMPOUND OPERATIONS
  // ============================================================================

  /**
   * Get general settings (user + chat settings combined)
   * Returns a compound object with version, user, chatSettings, and timestamps
   */
  async getGeneralSettings(userId: string): Promise<GeneralSettings | null> {
    logger.debug('Getting general settings for user', {
      userId,
    });

    try {
      // Fetch user and chat settings in parallel
      const [user, chatSettings] = await Promise.all([
        this.findById(userId),
        this.getChatSettings(userId),
      ]);

      if (!user) {
        logger.warn('User not found when retrieving general settings', {
          userId,
        });
        return null;
      }

      if (!chatSettings) {
        logger.warn('Chat settings not found when retrieving general settings', {
          userId,
        });
        return null;
      }

      // Create the compound general settings object
      const now = new Date().toISOString();
      const generalSettings: GeneralSettings = {
        version: 1,
        user,
        chatSettings,
        createdAt: now,
        updatedAt: now,
      };

      const validationResult = this.validateGeneralSettingsSafe(generalSettings);
      if (!validationResult.success) {
        logger.warn('GeneralSettings validation failed', {
          userId,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('General settings retrieved for user', {
        userId,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error getting general settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update general settings (user + chat settings)
   * Updates both collections atomically
   */
  async updateGeneralSettings(userId: string, data: Partial<GeneralSettings>): Promise<GeneralSettings | null> {
    logger.debug('Updating general settings for user', {
      userId,
    });

    try {
      // Update user if provided
      if (data.user) {
        logger.debug('Updating user from general settings', {
          userId,
        });
        const updatedUser = await this.update(userId, data.user);
        if (!updatedUser) {
          logger.error('Failed to update user during general settings update', {
            userId,
          });
          return null;
        }
      }

      // Update chat settings if provided
      if (data.chatSettings) {
        logger.debug('Updating chat settings from general settings', {
          userId,
        });
        const updatedChatSettings = await this.updateChatSettings(userId, data.chatSettings);
        if (!updatedChatSettings) {
          logger.error('Failed to update chat settings during general settings update', {
            userId,
          });
          return null;
        }
      }

      // Fetch and return the updated general settings
      const generalSettings = await this.getGeneralSettings(userId);

      if (!generalSettings) {
        logger.error('Failed to retrieve updated general settings', {
          userId,
        });
        return null;
      }

      logger.info('General settings updated successfully', {
        userId,
      });

      return generalSettings;
    } catch (error) {
      logger.error('Error updating general settings', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
