/**
 * Plugin Configuration Repository
 *
 * Backend-agnostic repository for plugin configuration entities.
 * Works with SQLite through the database abstraction layer.
 * Configuration is stored per-user, per-plugin.
 */

import { PluginConfig, PluginConfigSchema } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { TypedQueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';

/**
 * Plugin Configuration Repository
 * Implements CRUD operations for plugin configs with user-scoping and plugin-specific queries.
 */
export class PluginConfigRepository extends UserOwnedBaseRepository<PluginConfig> {
  constructor() {
    super('plugin_configs', PluginConfigSchema);
  }

  /**
   * Find plugin config by user ID and plugin name
   * @param userId The user ID
   * @param pluginName The plugin name
   * @returns Promise<PluginConfig | null> The config if found, null otherwise
   */
  async findByUserAndPlugin(userId: string, pluginName: string): Promise<PluginConfig | null> {
    return this.safeQuery(
      () => this.findOneByFilter({
        userId,
        pluginName,
      }),
      'Error finding plugin config by user and plugin',
      { userId, pluginName },
      null
    );
  }

  /**
   * Find all plugin configs for a user
   * @param userId The user ID
   * @returns Promise<PluginConfig[]> Array of plugin configs for the user
   */
  async findByUserId(userId: string): Promise<PluginConfig[]> {
    const configs = await this.findByFilter({ userId });
    return configs;
  }

  /**
   * Create new plugin config
   * @param data The plugin config data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<PluginConfig> The created plugin config with generated id and timestamps
   */
  async create(
    data: Omit<PluginConfig, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<PluginConfig> {
    return this.safeQuery(
      async () => {
        const config = await this._create(data, options);

        logger.info('Plugin config created successfully', {
          pluginConfigId: config.id,
          userId: data.userId,
          pluginName: data.pluginName,
        });

        return config;
      },
      'Error creating plugin config',
      { userId: data.userId, pluginName: data.pluginName }
    );
  }

  /**
   * Update plugin config
   * @param id The plugin config ID
   * @param data Partial plugin config data to update
   * @returns Promise<PluginConfig | null> The updated config if found, null otherwise
   */
  async update(id: string, data: Partial<PluginConfig>): Promise<PluginConfig | null> {
    return this.safeQuery(
      async () => {
        const config = await this._update(id, data);

        if (config) {
          logger.info('Plugin config updated successfully', { pluginConfigId: id });
        }

        return config;
      },
      'Error updating plugin config',
      { pluginConfigId: id }
    );
  }

  /**
   * Delete plugin config
   * @param id The plugin config ID
   * @returns Promise<boolean> True if config was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Plugin config deleted successfully', { pluginConfigId: id });
        }

        return result;
      },
      'Error deleting plugin config',
      { pluginConfigId: id }
    );
  }

  /**
   * Get or create plugin config for a user/plugin combination
   * @param userId The user ID
   * @param pluginName The plugin name
   * @param defaultConfig Default configuration values to use if creating new
   * @returns Promise<PluginConfig> The existing or newly created config
   */
  async getOrCreate(
    userId: string,
    pluginName: string,
    defaultConfig: Record<string, unknown> = {}
  ): Promise<PluginConfig> {
    const existing = await this.findByUserAndPlugin(userId, pluginName);
    if (existing) {
      return existing;
    }
    return this.create({
      userId,
      pluginName,
      config: defaultConfig,
    });
  }

  /**
   * Update config for a user/plugin combination (creates if not exists)
   * @param userId The user ID
   * @param pluginName The plugin name
   * @param config The configuration values to set
   * @param enabled Optional per-user enable flag. Omit to leave it untouched;
   *   backup restore and `.qtap` import both pass it so a plugin the user had
   *   switched off doesn't come back on.
   * @returns Promise<PluginConfig> The updated or created config
   */
  async upsertForUserPlugin(
    userId: string,
    pluginName: string,
    config: Record<string, unknown>,
    enabled?: boolean
  ): Promise<PluginConfig> {
    const existing = await this.findByUserAndPlugin(userId, pluginName);

    if (existing) {
      // Merge the new config with existing config
      const mergedConfig = {
        ...existing.config,
        ...config,
      };
      const updated = await this.update(existing.id, {
        config: mergedConfig,
        ...(enabled !== undefined && { enabled }),
      });
      if (!updated) {
        throw new Error(`Failed to update plugin config for ${pluginName}`);
      }
      return updated;
    }
    return this.create({
      userId,
      pluginName,
      config,
      ...(enabled !== undefined && { enabled }),
    });
  }

  /**
   * Delete all configs for a specific plugin (used when uninstalling)
   * @param pluginName The plugin name
   * @returns Promise<number> Number of configs deleted
   */
  async deleteByPlugin(pluginName: string): Promise<number> {
    return this.safeQuery(
      () => this.deleteMany({ pluginName }),
      'Error deleting plugin configs',
      { pluginName }
    );
  }
}
