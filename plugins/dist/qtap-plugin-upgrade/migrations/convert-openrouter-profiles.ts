/**
 * Migration: Convert OpenRouter Profiles
 *
 * Converts OPENAI_COMPATIBLE profiles using OpenRouter endpoint to native OPENROUTER provider.
 * Originally located at lib/llm/convert-openrouter-profiles.ts
 */

import { JsonStore } from '@/lib/json-store/core/json-store';
import { ConnectionProfilesRepository } from '@/lib/json-store/repositories/connection-profiles.repository';
import { logger } from '@/lib/logger';
import type { Migration, MigrationResult } from '../migration-types';

/**
 * Checks if a base URL is an OpenRouter endpoint
 */
export function isOpenRouterEndpoint(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;

  try {
    const url = new URL(baseUrl);
    // Only accept http or https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return url.hostname === 'openrouter.ai' || url.hostname.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/**
 * Check how many profiles would be converted
 */
async function countProfilesToConvert(): Promise<number> {
  const jsonStore = new JsonStore();
  const repo = new ConnectionProfilesRepository(jsonStore);

  try {
    const profiles = await repo.findAll();
    let count = 0;

    for (const profile of profiles) {
      if (profile.provider === 'OPENAI_COMPATIBLE' && isOpenRouterEndpoint(profile.baseUrl)) {
        count++;
      }
    }

    return count;
  } catch {
    return 0;
  }
}

/**
 * Convert OpenRouter profiles migration
 */
export const convertOpenRouterProfilesMigration: Migration = {
  id: 'convert-openrouter-profiles-v1',
  description: 'Convert OPENAI_COMPATIBLE profiles using OpenRouter endpoint to native OPENROUTER provider',
  introducedInVersion: '1.7.0',

  async shouldRun(): Promise<boolean> {
    const count = await countProfilesToConvert();
    return count > 0;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const jsonStore = new JsonStore();
    const repo = new ConnectionProfilesRepository(jsonStore);

    let converted = 0;
    const errors: Array<{ profileId: string; error: string }> = [];

    try {
      const profiles = await repo.findAll();

      for (const profile of profiles) {
        if (profile.provider === 'OPENAI_COMPATIBLE' && isOpenRouterEndpoint(profile.baseUrl)) {
          try {
            await repo.update(profile.id, {
              provider: 'OPENROUTER',
              baseUrl: null, // OpenRouter provider doesn't use baseUrl
              updatedAt: new Date().toISOString(),
            });
            converted++;

            logger.debug('Converted profile from OPENAI_COMPATIBLE to OPENROUTER', {
              context: 'migration.convert-openrouter-profiles',
              profileId: profile.id,
              profileName: profile.name,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push({
              profileId: profile.id,
              error: errorMessage,
            });
            logger.error('Failed to convert profile', {
              context: 'migration.convert-openrouter-profiles',
              profileId: profile.id,
            }, error instanceof Error ? error : undefined);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to read profiles', {
        context: 'migration.convert-openrouter-profiles',
      }, error instanceof Error ? error : undefined);

      return {
        id: 'convert-openrouter-profiles-v1',
        success: false,
        itemsAffected: converted,
        message: 'Failed to read profiles',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    const success = errors.length === 0;
    return {
      id: 'convert-openrouter-profiles-v1',
      success,
      itemsAffected: converted,
      message: success
        ? `Successfully converted ${converted} OpenRouter profiles`
        : `Converted ${converted} profiles with ${errors.length} errors`,
      error: errors.length > 0 ? `Failed on profiles: ${errors.map(e => e.profileId).join(', ')}` : undefined,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  },
};
