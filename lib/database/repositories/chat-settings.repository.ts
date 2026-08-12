/**
 * Chat Settings Repository
 *
 * Backend-agnostic repository for ChatSettings entities.
 * Works with SQLite through the database abstraction layer.
 */

import { logger } from '@/lib/logger';
import { ChatSettings, ChatSettingsSchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';

/**
 * Chat Settings Repository
 * Implements CRUD operations for chat settings with user-scoping.
 * Uses AbstractBaseRepository since we override findByUserId with different return type.
 */
export class ChatSettingsRepository extends AbstractBaseRepository<ChatSettings> {
  constructor() {
    super('chat_settings', ChatSettingsSchema);
  }

  /**
   * Find chat settings by ID
   */
  async findById(id: string): Promise<ChatSettings | null> {
    return this.safeQuery(
      () => this._findById(id),
      'Error finding chat settings by ID',
      { chatSettingsId: id },
      null
    );
  }

  /**
   * Find chat settings by user ID
   */
  async findByUserId(userId: string): Promise<ChatSettings | null> {
    return this.safeQuery(
      () => this.findOneByFilter({ userId }),
      'Error finding chat settings by user ID',
      { userId },
      null
    );
  }

  /**
   * Find all chat settings
   */
  async findAll(): Promise<ChatSettings[]> {
    return this.safeQuery(
      () => this._findAll(),
      'Error finding all chat settings',
      {},
      []
    );
  }

  /**
   * Create new chat settings
   * @param data The chat settings data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<ChatSettings> The created chat settings with generated id and timestamps
   */
  async create(
    data: Omit<ChatSettings, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ChatSettings> {
    return this.safeQuery(
      async () => {
        const result = await this._create(data, options);
        logger.info('Chat settings created successfully', {
          chatSettingsId: result.id,
          userId: data.userId,
        });
        return result;
      },
      'Error creating chat settings',
      { userId: data.userId }
    );
  }

  /**
   * Update chat settings
   * @param id The chat settings ID
   * @param data Partial chat settings data to update
   * @returns Promise<ChatSettings | null> The updated chat settings if found, null otherwise
   */
  async update(id: string, data: Partial<ChatSettings>): Promise<ChatSettings | null> {
    return this.safeQuery(
      async () => {
        const result = await this._update(id, data);
        if (!result) {
          logger.warn('Chat settings not found for update', { chatSettingsId: id });
        }
        return result;
      },
      'Error updating chat settings',
      { chatSettingsId: id }
    );
  }

  /**
   * Delete chat settings
   * @param id The chat settings ID
   * @returns Promise<boolean> True if chat settings were deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);
        if (!result) {
          logger.warn('Chat settings not found for deletion', { chatSettingsId: id });
        }
        return result;
      },
      'Error deleting chat settings',
      { chatSettingsId: id }
    );
  }

  /**
   * Create chat settings for a user
   * @param userId The user ID
   * @param data The chat settings data (without id, userId, createdAt, updatedAt)
   * @returns Promise<ChatSettings> The created chat settings
   */
  async createForUser(
    userId: string,
    data: Omit<ChatSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<ChatSettings> {
    return this.create({ ...data, userId });
  }

  /**
   * Update chat settings for a user (creates if not exists)
   * @param userId The user ID
   * @param data Partial chat settings data to update
   * @returns Promise<ChatSettings | null> The updated/created chat settings
   */
  async updateForUser(userId: string, data: Partial<ChatSettings>): Promise<ChatSettings | null> {
    return this.safeQuery(
      async () => {
        // Check if settings exist
        const existing = await this.findByUserId(userId);

        if (!existing) {
          // Create new settings with defaults
          // Default roleplay template will be set by the user or by the first access flow
          // We don't query for templates here to avoid circular dependencies
          const defaultRoleplayTemplateId: string | null = null;

          const defaultSettings: Omit<ChatSettings, 'id' | 'createdAt' | 'updatedAt'> = {
            userId,
            avatarDisplayMode: 'ALWAYS',
            avatarDisplayStyle: 'CIRCULAR',
            tagStyles: {},
            cheapLLMSettings: {
              strategy: 'PROVIDER_CHEAPEST',
              fallbackToLocal: true,
              embeddingProvider: 'OPENAI',
            },
            themePreference: {
              activeThemeId: null,
              colorMode: 'system',
              showNavThemeSelector: false,
            },
            defaultTimestampConfig: {
              mode: 'NONE',
              format: 'FRIENDLY',
              useFictionalTime: false,
              autoPrepend: true,
              intervalMinutes: 15,
            },
            memoryCascadePreferences: {
              onMessageDelete: 'ASK_EVERY_TIME',
              onSwipeRegenerate: 'DELETE_MEMORIES',
            },
            autoHousekeepingSettings: {
              enabled: false,
              perCharacterCap: 2000,
              perCharacterCapOverrides: {},
              autoMergeSimilarThreshold: 0.90,
              mergeSimilar: false,
            },
            memoryExtractionLimits: {
              enabled: false,
              maxPerHour: 20,
              softStartFraction: 0.7,
              softFloor: 0.7,
            },
            autonomousRoomSettings: {
              dailyTokenBudget: null,
              defaultFreshnessWindowMs: 12 * 60 * 60 * 1000,
              visibilityDefault: 'owner_only',
              destructiveToolPolicy: 'opt_in_per_room',
            },
            tokenDisplaySettings: {
              showPerMessageTokens: false,
              showPerMessageCost: false,
              showChatTotals: false,
              showSystemEvents: false,
            },
            contextCompressionSettings: {
              enabled: true,
              windowSize: 5,
              compressionTargetTokens: 800,
              systemPromptTargetTokens: 1500,
              projectContextReinjectInterval: 5,
            },
            llmLoggingSettings: {
              enabled: true,
              verboseMode: false,
              retentionDays: 30,
            },
            autoDetectRng: true,
            customTools: true,
            compositionModeDefault: false,
            composerSpellcheck: true,
            textReplacementsEnabled: true,
            autoScrollOnResponseComplete: false,
            agentModeSettings: {
              maxTurns: 10,
              defaultEnabled: false,
            },
            storyBackgroundsSettings: {
              enabled: false,
              defaultImageProfileId: null,
            },
            dangerousContentSettings: {
              mode: 'OFF',
              threshold: 0.7,
              scanTextChat: true,
              scanImagePrompts: true,
              scanImageGeneration: false,
              displayMode: 'SHOW',
              showWarningBadges: true,
            },
            autoLockSettings: {
              enabled: false,
              idleMinutes: 15,
            },
            coreWhisper: {
              enabled: true,
              interval: 12,
              silenceThreshold: 3,
              packetTokenBudget: 4096,
              fireOnContextTransition: true,
            },
            thinkingDisplay: {
              defaultVisible: true,
              defaultCollapsed: true,
            },
            answerConfirmationSettings: {
              enabled: false,
            },
            defaultRoleplayTemplateId,
            ...data,
          };
          return await this.create(defaultSettings);
        }

        // Update existing settings
        const result = await this.update(existing.id, data);

        return result;
      },
      'Error updating chat settings for user',
      { userId }
    );
  }
}
