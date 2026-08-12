/**
 * Taboo Settings Routes (v1)
 *
 * GET /api/v1/settings/taboo - Read the instance-wide forbidden-phrase list
 * PUT /api/v1/settings/taboo - Replace the forbidden-phrase list
 *
 * Instance-wide setting (`instance_settings['taboo']`), not a `chat_settings`
 * column — same class as the data-retention window. Read once per turn on the
 * conversational path (`lib/chat/context-manager.ts`) and rendered into the
 * cacheable prefix of every character's system prompt.
 *
 * PUT merges the body over the stored value, so a partial body ({} in
 * particular) never wipes the list. The response echoes what was actually
 * stored — `setTabooSettings` trims, drops empties, and dedupes
 * case-insensitively — so the UI's local cache matches the database.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, serverError, validationError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  getTabooSettings,
  setTabooSettings,
  TabooSettingsSchema,
} from '@/lib/instance-settings';

export const GET = createContextHandler(async () => {
  try {
    const settings = await getTabooSettings();
    logger.debug('[Settings v1] Taboo settings fetched', {
      phraseCount: settings.phrases.length,
    });
    return successResponse(settings);
  } catch (error) {
    logger.error('[Settings v1] Error fetching taboo settings', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch taboo settings');
  }
});

export const PUT = createContextHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const current = await getTabooSettings();
    const parsed = TabooSettingsSchema.safeParse({ ...current, ...body });
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const saved = await setTabooSettings(parsed.data);
    logger.info('[Settings v1] Taboo settings updated (instance-wide)', {
      phraseCount: saved.phrases.length,
    });
    return successResponse(saved);
  } catch (error) {
    logger.error('[Settings v1] Error updating taboo settings', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to update taboo settings');
  }
});
