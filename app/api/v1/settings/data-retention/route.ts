/**
 * Data Retention Settings Routes (v1)
 *
 * GET /api/v1/settings/data-retention - Read the instance-wide stale-chat retention window
 * PUT /api/v1/settings/data-retention - Update the retention window
 *
 * Instance-wide setting (`instance_settings['dataRetention']`), not a
 * `chat_settings` column — same class as the memory-recall knobs. Read daily
 * by the maintenance sweep (`lib/background-jobs/scheduled-maintenance.ts`)
 * to decide when a quiet chat's regenerable caches and cold-tier embeddings
 * are collapsed.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, serverError, validationError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  getDataRetentionSettings,
  setDataRetentionSettings,
  DataRetentionSettingsSchema,
} from '@/lib/instance-settings';

export const GET = createContextHandler(async () => {
  try {
    const settings = await getDataRetentionSettings();
    return successResponse(settings);
  } catch (error) {
    logger.error('[Settings v1] Error fetching data-retention settings', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch data-retention settings');
  }
});

export const PUT = createContextHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const current = await getDataRetentionSettings();
    const parsed = DataRetentionSettingsSchema.safeParse({ ...current, ...body });
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await setDataRetentionSettings(parsed.data);
    logger.info('[Settings v1] Data-retention settings updated (instance-wide)', {
      staleChatDays: parsed.data.staleChatDays,
    });
    return successResponse(parsed.data);
  } catch (error) {
    logger.error('[Settings v1] Error updating data-retention settings', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to update data-retention settings');
  }
});
