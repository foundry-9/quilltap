/**
 * Model Classes API v1
 *
 * GET /api/v1/model-classes - List all available model classes
 */

import { createContextHandler } from '@/lib/api/middleware';
import { MODEL_CLASSES } from '@/lib/llm/model-classes';
import { logger } from '@/lib/logger';
import { serverError, successResponse } from '@/lib/api/responses';

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/v1/model-classes
 * Returns the list of available model class definitions
 */
export const GET = createContextHandler(async () => {
  try {
    return successResponse({
      modelClasses: MODEL_CLASSES,
      count: MODEL_CLASSES.length,
    });
  } catch (error) {
    logger.error('[Model Classes v1] Error listing model classes', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch model classes');
  }
});
