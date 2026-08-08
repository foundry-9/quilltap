/**
 * Brahma Console Settings Routes (v1)
 *
 * GET /api/v1/settings/brahma-console - Read the instance-wide Console settings
 * PUT /api/v1/settings/brahma-console - Update the Console settings
 *
 * Instance-wide setting (`instance_settings['brahmaConsole']`), not a
 * `chat_settings` column — same class as the data-retention knob. Holds the
 * agent-turn budget the streaming orchestrator and the one-shot `@Brahma` path
 * read via `resolveBrahmaMaxAgentTurns`.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, serverError, validationError } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import {
  getBrahmaConsoleSettings,
  setBrahmaConsoleSettings,
  BrahmaConsoleSettingsSchema,
} from '@/lib/instance-settings';

export const GET = createContextHandler(async () => {
  try {
    const settings = await getBrahmaConsoleSettings();
    return successResponse(settings);
  } catch (error) {
    logger.error('[Settings v1] Error fetching brahma-console settings', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch brahma-console settings');
  }
});

export const PUT = createContextHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const current = await getBrahmaConsoleSettings();
    const parsed = BrahmaConsoleSettingsSchema.safeParse({ ...current, ...body });
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    await setBrahmaConsoleSettings(parsed.data);
    logger.info('[Settings v1] Brahma-console settings updated (instance-wide)', {
      maxAgentTurns: parsed.data.maxAgentTurns,
    });
    return successResponse(parsed.data);
  } catch (error) {
    logger.error('[Settings v1] Error updating brahma-console settings', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to update brahma-console settings');
  }
});
