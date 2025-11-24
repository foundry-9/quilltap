/**
 * Users Repository
 *
 * Handles CRUD operations for User and ChatSettings entities.
 * User data is stored in: data/settings/general.json
 */

import { JsonStore } from '../core/json-store';
import { BaseRepository } from './base.repository';
import {
  User,
  UserSchema,
  ChatSettings,
  ChatSettingsSchema,
  GeneralSettings,
  GeneralSettingsSchema,
  AvatarDisplayMode,
} from '../schemas/types';

export class UsersRepository extends BaseRepository<User> {
  constructor(jsonStore: JsonStore) {
    super(jsonStore, UserSchema);
  }

  /**
   * Get the general settings file path
   */
  private getFilePath(): string {
    return 'settings/general.json';
  }

  /**
   * Read general settings file with default structure
   */
  private async readGeneralSettings(): Promise<GeneralSettings> {
    try {
      const filePath = this.getFilePath();
      const data = await this.jsonStore.readJson<GeneralSettings>(filePath);
      return GeneralSettingsSchema.parse(data);
    } catch (error) {
      throw new Error('General settings file not found or invalid');
    }
  }

  /**
   * Write general settings file with validation
   */
  private async writeGeneralSettings(data: GeneralSettings): Promise<void> {
    const validated = GeneralSettingsSchema.parse({
      ...data,
      updatedAt: this.getCurrentTimestamp(),
    });
    await this.jsonStore.writeJson(this.getFilePath(), validated);
  }

  /**
   * Find user by ID (single-user assumption: returns the configured user)
   */
  async findById(id: string): Promise<User | null> {
    try {
      const settings = await this.readGeneralSettings();
      return settings.user.id === id ? settings.user : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    try {
      const settings = await this.readGeneralSettings();
      return settings.user.email === email ? settings.user : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get current user (single-user system)
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const settings = await this.readGeneralSettings();
      return settings.user;
    } catch (error) {
      return null;
    }
  }

  /**
   * Find all users (returns array with single user for compatibility)
   */
  async findAll(): Promise<User[]> {
    const user = await this.getCurrentUser();
    return user ? [user] : [];
  }

  /**
   * Create a new user (overwrites existing in single-user system)
   */
  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    const user: User = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const validated = this.validate(user);

    // Try to read existing settings, or create new ones
    let settings: GeneralSettings;
    try {
      settings = await this.readGeneralSettings();
      settings.user = validated;
    } catch {
      settings = {
        version: 1,
        user: validated,
        chatSettings: {
          id: this.generateId(),
          userId: id,
          avatarDisplayMode: 'ALWAYS' as AvatarDisplayMode,
          avatarDisplayStyle: 'CIRCULAR',
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };
    }

    await this.writeGeneralSettings(settings);
    return validated;
  }

  /**
   * Update user
   */
  async update(id: string, data: Partial<User>): Promise<User | null> {
    const settings = await this.readGeneralSettings();
    if (settings.user.id !== id) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const updated: User = {
      ...settings.user,
      ...data,
      id: settings.user.id, // Preserve ID
      createdAt: settings.user.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = this.validate(updated);
    settings.user = validated;
    await this.writeGeneralSettings(settings);

    return validated;
  }

  /**
   * Delete user (not supported in single-user system)
   */
  async delete(id: string): Promise<boolean> {
    console.warn('User deletion not supported in single-user system');
    return false;
  }

  /**
   * Get chat settings for user
   */
  async getChatSettings(userId: string): Promise<ChatSettings | null> {
    try {
      const settings = await this.readGeneralSettings();
      return settings.user.id === userId ? settings.chatSettings : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update chat settings
   */
  async updateChatSettings(
    userId: string,
    data: Partial<ChatSettings>
  ): Promise<ChatSettings | null> {
    const settings = await this.readGeneralSettings();
    if (settings.user.id !== userId) {
      return null;
    }

    const now = this.getCurrentTimestamp();
    const updated: ChatSettings = {
      ...settings.chatSettings,
      ...data,
      id: settings.chatSettings.id, // Preserve ID
      userId: settings.chatSettings.userId, // Preserve user ID
      createdAt: settings.chatSettings.createdAt, // Preserve creation timestamp
      updatedAt: now,
    };

    const validated = ChatSettingsSchema.parse(updated);
    settings.chatSettings = validated;
    await this.writeGeneralSettings(settings);

    return validated;
  }
}
