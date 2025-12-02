/**
 * Migration: Enable Provider Plugins
 *
 * Ensures that all provider plugins needed by existing connection profiles are enabled.
 * This migration bridges the gap between the built-in provider system and the plugin-based system.
 *
 * What it does:
 * 1. Scans all connection profiles, image profiles, and embedding profiles
 * 2. Identifies which providers are in use
 * 3. Enables the corresponding provider plugins
 * 4. Marks the migration as complete so it doesn't run again
 *
 * After this migration:
 * - All LLM connectivity works via provider plugins
 * - The plugin-factory.ts will use plugin providers instead of built-in providers
 * - Users can manage providers through the plugin system
 */

import { JsonStore } from '@/lib/json-store/core/json-store';
import { ConnectionProfilesRepository } from '@/lib/json-store/repositories/connection-profiles.repository';
import { ImageProfilesRepository } from '@/lib/json-store/repositories/image-profiles.repository';
import { EmbeddingProfilesRepository } from '@/lib/json-store/repositories/embedding-profiles.repository';
import { pluginRegistry } from '@/lib/plugins/registry';
import { logger } from '@/lib/logger';
import type { Migration, MigrationResult } from '../migration-types';

/**
 * Mapping from provider enum values to plugin names
 */
const PROVIDER_TO_PLUGIN: Record<string, string> = {
  'OPENAI': 'qtap-plugin-openai',
  'ANTHROPIC': 'qtap-plugin-anthropic',
  'OLLAMA': 'qtap-plugin-ollama',
  'OPENROUTER': 'qtap-plugin-openrouter',
  'OPENAI_COMPATIBLE': 'qtap-plugin-openai-compatible',
  'GROK': 'qtap-plugin-grok',
  'GAB_AI': 'qtap-plugin-gab-ai',
  'GOOGLE': 'qtap-plugin-google',
  // Image-specific providers
  'GOOGLE_IMAGEN': 'qtap-plugin-google',  // Google Imagen is part of the Google plugin
};

/**
 * Get all providers currently in use across all profile types
 */
async function getProvidersInUse(): Promise<Set<string>> {
  const jsonStore = new JsonStore();
  const providers = new Set<string>();

  try {
    // Check connection profiles
    const connectionRepo = new ConnectionProfilesRepository(jsonStore);
    const connectionProfiles = await connectionRepo.findAll();
    for (const profile of connectionProfiles) {
      if (profile.provider) {
        providers.add(profile.provider);
      }
    }

    // Check image profiles
    const imageRepo = new ImageProfilesRepository(jsonStore);
    const imageProfiles = await imageRepo.findAll();
    for (const profile of imageProfiles) {
      if (profile.provider) {
        providers.add(profile.provider);
      }
    }

    // Check embedding profiles
    const embeddingRepo = new EmbeddingProfilesRepository(jsonStore);
    const embeddingProfiles = await embeddingRepo.findAll();
    for (const profile of embeddingProfiles) {
      if (profile.provider) {
        providers.add(profile.provider);
      }
    }
  } catch (error) {
    logger.warn('Error reading profiles for provider detection', {
      context: 'migration.enable-provider-plugins',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return providers;
}

/**
 * Check if any provider plugins need to be enabled
 */
async function checkProvidersNeedEnabling(): Promise<{ needsEnabling: string[]; alreadyEnabled: string[] }> {
  const providersInUse = await getProvidersInUse();
  const needsEnabling: string[] = [];
  const alreadyEnabled: string[] = [];

  for (const provider of providersInUse) {
    const pluginName = PROVIDER_TO_PLUGIN[provider];
    if (!pluginName) {
      logger.warn('Unknown provider, no plugin mapping', {
        context: 'migration.enable-provider-plugins',
        provider,
      });
      continue;
    }

    const plugin = pluginRegistry.get(pluginName);
    if (!plugin) {
      logger.warn('Provider plugin not found', {
        context: 'migration.enable-provider-plugins',
        provider,
        pluginName,
      });
      continue;
    }

    if (plugin.enabled) {
      alreadyEnabled.push(pluginName);
    } else {
      needsEnabling.push(pluginName);
    }
  }

  return { needsEnabling, alreadyEnabled };
}

/**
 * Enable Provider Plugins Migration
 */
export const enableProviderPluginsMigration: Migration = {
  id: 'enable-provider-plugins-v1',
  description: 'Enable provider plugins for all providers currently in use by profiles',
  introducedInVersion: '1.8.0',
  dependsOn: ['convert-openrouter-profiles-v1'],  // Run after OpenRouter conversion

  async shouldRun(): Promise<boolean> {
    // Check if plugin registry is initialized
    if (!pluginRegistry.isInitialized()) {
      logger.debug('Plugin registry not initialized yet, deferring migration', {
        context: 'migration.enable-provider-plugins',
      });
      return false;
    }

    const { needsEnabling } = await checkProvidersNeedEnabling();
    return needsEnabling.length > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const enabledPlugins: string[] = [];
    const errors: Array<{ pluginName: string; error: string }> = [];

    logger.info('Starting provider plugin enablement migration', {
      context: 'migration.enable-provider-plugins',
    });

    const { needsEnabling, alreadyEnabled } = await checkProvidersNeedEnabling();

    logger.info('Provider plugin status', {
      context: 'migration.enable-provider-plugins',
      needsEnabling: needsEnabling.length,
      alreadyEnabled: alreadyEnabled.length,
    });

    for (const pluginName of needsEnabling) {
      try {
        const success = pluginRegistry.enable(pluginName);
        if (success) {
          enabledPlugins.push(pluginName);
          logger.info('Enabled provider plugin', {
            context: 'migration.enable-provider-plugins',
            pluginName,
          });
        } else {
          errors.push({
            pluginName,
            error: 'Failed to enable plugin (registry returned false)',
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          pluginName,
          error: errorMessage,
        });
        logger.error('Failed to enable provider plugin', {
          context: 'migration.enable-provider-plugins',
          pluginName,
          error: errorMessage,
        });
      }
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    return {
      id: 'enable-provider-plugins-v1',
      success,
      itemsAffected: enabledPlugins.length,
      message: success
        ? `Enabled ${enabledPlugins.length} provider plugins: ${enabledPlugins.join(', ')}`
        : `Enabled ${enabledPlugins.length} plugins with ${errors.length} errors`,
      error: errors.length > 0
        ? `Failed plugins: ${errors.map(e => `${e.pluginName}: ${e.error}`).join('; ')}`
        : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
